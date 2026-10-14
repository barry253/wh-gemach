// Part of the Gemach Network worker (see index.js for routes and env vars).
import { Q, fetchByIds, firstLink, getOwned, linkedId } from "./airtable.js";
import { cacheKey, cachedJson } from "./cache.js";
import { LEGACY_SLUG, REC_RE, SLUG_RE, T } from "./config.js";
import { nyToday } from "./dates.js";
import { DEFAULT_EVENT_LABEL, DEFAULT_THEME, byOrderThenName, listActiveGemachs, loadGemachBySlug, nonBlank } from "./gemachs.js";
import { json } from "./http.js";
import { itemAttrsFor } from "./attributes.js";
import { publicTypeExtras } from "./extras.js";
import { parseMorePhotos } from "./photos.js";
import { inTestMode } from "./testmode.js";
import { addonPrice, isAddonType, isQtyType, lendableQty, LOAN_WINDOW_FIELDS, packageSize, packageUnit, qtyAvailable, qtyBookingsFromLoans, TYPE_PUBLIC_FIELDS } from "./quantity.js";

// ─── Public inventory / directory ─────────────────────────────────────────────

/**
 * Public item type. Quantity types add tracking:"quantity" (totalUnits = lendable count, availableCount = free today)
 * and, with withBookings, the open loans' date windows and counts (no names) so the page can work out
 * what's free for the dates a person picks.
 */
function publicItemType(type, units, { withCategory = false, bookings = null, withBookings = false, attrDefs = null } = {}) {
  const photoUrl = type.fields["R2 Photo URL"] || null;
  const out = {
    id: type.id,
    name: type.fields["Name"],
    description: type.fields["Description"] || "",
    totalUnits: units?.total[type.id] || 0,
    availableCount: units?.free[type.id] || 0,
    hasPhoto: !!photoUrl,
    photoUrl,
  };
  if (withBookings) { // gemach page only (the home page shows just the cover): cover + more photos, in order
    const more = photoUrl ? parseMorePhotos(type.fields["More Photos"]) : [];
    if (more.length) out.photos = [photoUrl, ...more];
  }
  if (isQtyType(type)) {
    const list = bookings?.[type.id] || [];
    const t = nyToday();
    out.tracking = "quantity";
    out.totalUnits = lendableQty(type);
    out.availableCount = qtyAvailable(out.totalUnits, list, t, t);
    if (withBookings) out.bookings = list.map(b => ({ from: b.from, to: b.to, qty: b.qty }));
    const ps = packageSize(type); // lent in whole packages, e.g. bags of 6 tablecloths
    if (ps > 1) { out.packageSize = ps; out.packageUnit = packageUnit(type); }
  }
  if (isAddonType(type)) { // made to order for purchase: no stock, never "on loan"
    out.tracking = "addon";
    out.price = addonPrice(type);
    out.totalUnits = 0;
    out.availableCount = null;
  }
  if (attrDefs?.length) { // the gemach's item filters (e.g. Size, Color): only values it still offers
    const a = itemAttrsFor(type.fields["Attributes"], attrDefs);
    if (Object.keys(a).length) out.attributes = a;
  }
  Object.assign(out, publicTypeExtras(type, nyToday())); // byline, search words, featured, new (only when set)
  if (withCategory) out.categoryId = linkedId(firstLink(type.fields["Product Category"])) || null;
  return out;
}

/**
 * Numbered units per item type, from the active units and the open loans (read once, also used for quantity
 * bookings): { total: { typeId: n }, free: { typeId: n } }. A unit is free when no Active or Reserved loan has it
 * (the same rule as Items.Status) and it isn't marked Needs Repair. Reading plain columns, not the computed
 * Items.Status / Item Types.Items, keeps a page rebuild to a few hundred row reads.
 */
function unitStats(units, openLoans) {
  const busy = new Set(openLoans.filter(l => ["Active", "Reserved"].includes(l.fields["Status"])).map(l => linkedId(firstLink(l.fields["Item"]))).filter(Boolean));
  const total = {}, free = {};
  for (const u of units) {
    const typeId = linkedId(firstLink(u.fields["Item Type"]));
    if (!typeId) continue;
    total[typeId] = (total[typeId] || 0) + 1;
    if (!busy.has(u.id) && u.fields["Condition"] !== "Needs Repair") free[typeId] = (free[typeId] || 0) + 1;
  }
  return { total, free };
}
const PUBLIC_UNIT_FIELDS = ["Item Type", "Condition", "Gemach"];
const publicLoanFields = () => [...LOAN_WINDOW_FIELDS, "Item"]; // a function: quantity.js may load after this module

async function loadInventory(db, g, opts = {}) {
  const [types, units, openLoans] = await Promise.all([
    db.listAll(T.ITEM_TYPES, { scope: g, where: [Q.isTrue("Active")], sort: [{ field: "Display Order", direction: "asc" }], fields: TYPE_PUBLIC_FIELDS }),
    db.listAll(T.ITEMS, { scope: g, where: [Q.isTrue("Active")], fields: PUBLIC_UNIT_FIELDS }),
    db.listAll(T.LOANS, { scope: g, where: [Q.in("Status", ["Active", "Reserved"])], fields: publicLoanFields() }),
  ]);
  const stats = unitStats(units, openLoans);
  const bookings = qtyBookingsFromLoans(openLoans, types.filter(isQtyType).map(t => t.id), g);
  return types.map(t => publicItemType(t, stats, { ...opts, bookings, attrDefs: g.itemAttributes }));
}

// Public profile fields only — NEVER pickupAddress / pickupInstructions / templates.
// The directory and the public gemach page leave out the contact details (withContact: false); the page
// gets them from GET /public/contact/:slug (see handlePublicContact) so the whole network's phones and
// emails aren't sitting in one easily scraped response. Manage page and admin keep them inline.
const CONTACT_KEYS = ["phone", "email", "whatsapp", "primaryContact", "secondaryContact"];
function publicGemach(g, communityName, { withContact = true } = {}) {
  const out = {
    id: g.id, slug: g.slug, name: g.name, tagline: g.tagline, description: g.description, category: g.category,
    mode: g.mode || "Full",
    phone: g.phone, email: g.email, whatsapp: g.whatsapp,
    website: g.website, donationUrl: g.donationUrl, donationInfo: g.donationInfo ?? null, hours: g.hours,
    logoUrl: g.logoUrl, logoDarkUrl: g.logoDarkUrl ?? null, communityName: communityName || null, displayOrder: g.displayOrder ?? null,
    primaryContact: g.primaryContact ?? null, secondaryContact: g.secondaryContact ?? null,
    themeColor: g.themeColor || DEFAULT_THEME, accentColor: g.accentColor ?? null,
    depositRequired: !!g.depositRequired, chargeType: g.chargeType || "Deposit", itemView: g.itemView || "List", depositInfo: g.depositInfo ?? null, gemachInfo: g.gemachInfo ?? null,
    requestFormUrl: g.requestFormUrl ?? null,
    requestStyle: g.requestStyle || "Dates", eventLabel: g.eventLabel || DEFAULT_EVENT_LABEL,
    pickupDaysBefore: g.pickupDaysBefore ?? 1, returnDaysAfter: g.returnDaysAfter ?? 1, shabbosAdjust: !!g.shabbosAdjust,
    itemAttributes: g.itemAttributes || [],
    photoShape: g.photoShape || "Landscape", groupBy: g.groupBy ?? null, spotlightFilter: g.spotlightFilter ?? null, borrowNote: g.borrowNote ?? null,
    comingSoon: !!g.comingSoon,
    browseCategoryIds: g.browseCategoryIds || [],
  };
  if (!withContact) for (const k of CONTACT_KEYS) delete out[k];
  return out;
}

/** Just the contact details: { phone, email, whatsapp, primaryContact, secondaryContact } (blank → null). */
function publicContact(g) {
  return {
    phone: nonBlank(g.phone), email: nonBlank(g.email), whatsapp: nonBlank(g.whatsapp),
    primaryContact: g.primaryContact ?? null, secondaryContact: g.secondaryContact ?? null,
  };
}

/**
 * Light encoding so plain-text harvesters (regexes for "@" and phone numbers) find nothing in the response:
 * JSON → UTF-8 → base64 → reversed. Not secret — the site decodes it (site.js W.decodeContact).
 */
function encodeContact(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).split("").reverse().join("");
}
function decodeContact(c) {
  const bin = atob(String(c).split("").reverse().join(""));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
}

/** GET /public/contact/:slug[?test=] → { c } (encoded contact). Live and Coming-soon gemachs; Hidden only via a test link. */
async function handlePublicContact(db, env, ctx, slug, testToken = null) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return json({ error: "Not found" }, 404);
  if (testToken) {
    const g = await loadGemachBySlug(db, slug);
    if (await inTestMode(env, g, testToken)) {
      return json({ c: encodeContact(publicContact(g)) }, 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    }
  }
  return cachedJson(env, ctx, cacheKey(env, `contact/${slug}`), async () => {
    const g = await loadGemachBySlug(db, slug);
    if (!g || !g.active) return { status: 404, data: { error: "Not found" } };
    return { status: 200, data: { c: encodeContact(publicContact(g)) } };
  });
}

/**
 * GET /public/meta/:slug → { name, tagline, description, logoUrl, comingSoon } for link previews
 * (the site's /g/:slug page function puts these in <title> and the og: tags). Live and Coming-soon only.
 */
function publicMeta(g) {
  const text = String(nonBlank(g.tagline) || nonBlank(g.description) || "").replace(/\s+/g, " ").trim();
  const logo = nonBlank(g.logoUrl);
  return {
    name: g.name, tagline: nonBlank(g.tagline),
    description: text.length > 200 ? text.slice(0, 197).replace(/\s+\S*$/, "") + "…" : text || null,
    logoUrl: logo && /^https:\/\//.test(logo) ? logo : null,
    comingSoon: !!g.comingSoon,
  };
}
/** One listed item for a shared item link: { id, name, description (short), photoUrl } or null. */
function publicMetaItem(type) {
  const text = String(type.fields["Description"] || "").replace(/\s+/g, " ").trim();
  const photo = nonBlank(type.fields["R2 Photo URL"]);
  return {
    id: type.id, name: type.fields["Name"] || "Item",
    description: text.length > 200 ? text.slice(0, 197).replace(/\s+\S*$/, "") + "…" : text || null,
    photoUrl: photo && /^https:\/\//.test(photo) ? photo : null,
  };
}
/**
 * GET /public/meta/:slug[?item=<item type id>] — with ?item=, also { item } when that item is listed on the
 * gemach's public page (active, this gemach, not an Info-only gemach); item: null otherwise.
 */
async function handlePublicMeta(db, env, ctx, slug, itemId = null) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return json({ error: "Not found" }, 404);
  const withItem = typeof itemId === "string" && REC_RE.test(itemId);
  return cachedJson(env, ctx, cacheKey(env, withItem ? `meta/${slug}/item/${itemId}` : `meta/${slug}`), async () => {
    const g = await loadGemachBySlug(db, slug);
    if (!g || !g.active) return { status: 404, data: { error: "Not found" } };
    const data = publicMeta(g);
    if (withItem) {
      const t = g.mode === "Info" ? null : await getOwned(db, T.ITEM_TYPES, itemId, g);
      data.item = t && t.fields["Active"] ? publicMetaItem(t) : null;
    }
    return { status: 200, data };
  });
}

/** Active Product Categories, sorted by Display Order (blank last) then name. */
async function loadCategories(db) {
  const recs = await db.listAll(T.PRODUCT_CATEGORIES, { where: [Q.isTrue("Active")], fields: ["Name", "Icon", "Keywords", "Display Order", "Active"] });
  return recs
    .filter(r => r.fields.Active && r.fields.Name)
    .map(r => {
      const order = Number(r.fields["Display Order"]);
      return {
        id: r.id,
        name: r.fields.Name,
        icon: nonBlank(r.fields.Icon),
        keywords: String(r.fields.Keywords || "").split(/[,\n]/).map(k => k.trim()).filter(Boolean),
        displayOrder: r.fields["Display Order"] != null && Number.isFinite(order) ? order : null,
      };
    })
    .sort(byOrderThenName);
}

// Legacy: exact shape of the original /inventory, for wh-medical only.
async function handleLegacyInventory(db) {
  try {
    const g = await loadGemachBySlug(db, LEGACY_SLUG);
    if (!g || !g.active) return json([]);
    return json(await loadInventory(db, g));
  } catch (e) {
    console.error("Inventory failed:", e.message);
    return json({ error: "Failed to fetch inventory." }, 500);
  }
}

async function buildDirectory(db) {
  const [gemachs, types, units, openLoans, categories] = await Promise.all([
    listActiveGemachs(db),
    db.listAll(T.ITEM_TYPES, { where: [Q.isTrue("Active")], sort: [{ field: "Display Order", direction: "asc" }], fields: TYPE_PUBLIC_FIELDS }),
    db.listAll(T.ITEMS, { where: [Q.isTrue("Active")], fields: PUBLIC_UNIT_FIELDS }),
    db.listAll(T.LOANS, { where: [Q.in("Status", ["Active", "Reserved"])], fields: publicLoanFields() }),
    loadCategories(db),
  ]);
  const communities = await fetchByIds(db, T.COMMUNITIES, gemachs.flatMap(g => g.communityIds), { fields: ["Name"] });
  const communityName = Object.fromEntries(communities.map(r => [r.id, r.fields.Name || null]));
  const stats = unitStats(units, openLoans);
  const bookings = qtyBookingsFromLoans(openLoans, types.filter(isQtyType).map(t => t.id), null);
  const typesByGemach = {};
  const defsById = Object.fromEntries(gemachs.map(g => [g.id, g.itemAttributes]));
  for (const t of types) {
    const links = (t.fields["Gemach"] || []).map(linkedId);
    if (links.length !== 1) continue; // item types must belong to exactly one gemach
    (typesByGemach[links[0]] ||= []).push(publicItemType(t, stats, { withCategory: true, bookings, attrDefs: defsById[links[0]] }));
  }
  return {
    categories,
    gemachs: gemachs.map(g => ({
      ...publicGemach(g, communityName[g.communityIds[0]], { withContact: false }),
      items: g.mode === "Info" ? [] : typesByGemach[g.id] || [], // Info only: no online listings
    })),
    generatedAt: new Date().toISOString(),
  };
}

const directoryBuilder = db => async () => ({ status: 200, data: await buildDirectory(db) });

async function handleDirectory(db, env, ctx) {
  return cachedJson(env, ctx, cacheKey(env, "directory"), directoryBuilder(db));
}

async function handlePublicGemach(db, env, ctx, slug, testToken = null) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return json({ error: "Not found" }, 404);
  if (testToken) { // test link (testmode.js): built fresh for this visitor, never cached or shared
    const g = await loadGemachBySlug(db, slug);
    if (await inTestMode(env, g, testToken)) {
      const data = await gemachPageData(db, g);
      data.gemach = { ...data.gemach, comingSoon: false, testMode: true };
      return json(data, 200, { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" });
    }
  }
  return cachedJson(env, ctx, cacheKey(env, `gemach/${slug}`), gemachBuilder(db, slug));
}

function gemachBuilder(db, slug) {
  return async () => {
    const g = await loadGemachBySlug(db, slug);
    if (!g || !g.active) return { status: 404, data: { error: "Not found" } };
    return { status: 200, data: await gemachPageData(db, g) };
  };
}

/** The public gemach page's data (also served fresh, uncached, through a test link). */
async function gemachPageData(db, g) {
  const [items, communities, categories] = await Promise.all([
    g.mode === "Info" ? [] : loadInventory(db, g, { withCategory: true, withBookings: true }), // Info only: no online listings
    fetchByIds(db, T.COMMUNITIES, g.communityIds.slice(0, 1), { fields: ["Name"] }),
    loadCategories(db),
  ]);
  return { gemach: publicGemach(g, communities[0]?.fields?.Name, { withContact: false }), items, categories };
}

export { publicItemType, loadInventory, publicGemach, publicContact, encodeContact, decodeContact, handlePublicContact, handlePublicMeta, publicMeta, loadCategories, handleLegacyInventory, buildDirectory, directoryBuilder, handleDirectory, handlePublicGemach, gemachBuilder };
