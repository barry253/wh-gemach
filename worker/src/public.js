// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fAnd, fetchByIds, firstLink, linkedId, scopeF } from "./airtable.js";
import { cacheKey, cachedJson } from "./cache.js";
import { LEGACY_SLUG, SLUG_RE, T } from "./config.js";
import { nyToday } from "./dates.js";
import { DEFAULT_EVENT_LABEL, DEFAULT_THEME, byOrderThenName, listActiveGemachs, loadGemachBySlug, nonBlank } from "./gemachs.js";
import { json } from "./http.js";
import { itemAttrsFor } from "./attributes.js";
import { addonPrice, isAddonType, isQtyType, lendableQty, loadQtyBookings, qtyAvailable } from "./quantity.js";

// ─── Public inventory / directory ─────────────────────────────────────────────

/**
 * Public item type. Quantity types add tracking:"quantity" (totalUnits = lendable count, availableCount = free today)
 * and, with withBookings, the open loans' date windows and counts (no names) so the page can work out
 * what's free for the dates a person picks.
 */
function publicItemType(type, availableIds, { withCategory = false, bookings = null, withBookings = false, attrDefs = null } = {}) {
  const itemIds = (type.fields["Items"] || []).map(linkedId);
  const photoUrl = type.fields["R2 Photo URL"] || type.fields["Photo"]?.[0]?.url || null;
  const out = {
    id: type.id,
    name: type.fields["Name"],
    description: type.fields["Description"] || "",
    totalUnits: itemIds.length,
    availableCount: itemIds.filter(id => availableIds.has(id)).length,
    hasPhoto: !!photoUrl,
    photoUrl,
  };
  if (isQtyType(type)) {
    const list = bookings?.[type.id] || [];
    const t = nyToday();
    out.tracking = "quantity";
    out.totalUnits = lendableQty(type);
    out.availableCount = qtyAvailable(out.totalUnits, list, t, t);
    if (withBookings) out.bookings = list.map(b => ({ from: b.from, to: b.to, qty: b.qty }));
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
  if (withCategory) out.categoryId = linkedId(firstLink(type.fields["Product Category"])) || null;
  return out;
}

async function loadInventory(db, g, opts = {}) {
  const [types, avail] = await Promise.all([
    db.listAll(T.ITEM_TYPES, { filter: fAnd(scopeF(g), `{Active}=1`), sort: [{ field: "Display Order", direction: "asc" }] }),
    db.listAll(T.ITEMS, { filter: fAnd(scopeF(g), `{Active}=1`, `{Status}="Available"`), fields: ["Item ID"] }),
  ]);
  const availableIds = new Set(avail.map(r => r.id));
  const qtyIds = types.filter(isQtyType).map(t => t.id);
  const bookings = qtyIds.length ? await loadQtyBookings(db, g, qtyIds) : {};
  return types.map(t => publicItemType(t, availableIds, { ...opts, bookings, attrDefs: g.itemAttributes }));
}

// Public profile fields only — NEVER pickupAddress / pickupInstructions / templates.
function publicGemach(g, communityName) {
  return {
    id: g.id, slug: g.slug, name: g.name, tagline: g.tagline, description: g.description, category: g.category,
    mode: g.mode || "Full",
    phone: g.phone, email: g.email, whatsapp: g.whatsapp,
    website: g.website, donationUrl: g.donationUrl, donationInfo: g.donationInfo ?? null, hours: g.hours,
    logoUrl: g.logoUrl, logoDarkUrl: g.logoDarkUrl ?? null, communityName: communityName || null, displayOrder: g.displayOrder ?? null,
    primaryContact: g.primaryContact ?? null, secondaryContact: g.secondaryContact ?? null,
    themeColor: g.themeColor || DEFAULT_THEME, accentColor: g.accentColor ?? null,
    depositRequired: !!g.depositRequired, depositInfo: g.depositInfo ?? null, gemachInfo: g.gemachInfo ?? null,
    requestStyle: g.requestStyle || "Dates", eventLabel: g.eventLabel || DEFAULT_EVENT_LABEL,
    pickupDaysBefore: g.pickupDaysBefore ?? 1, returnDaysAfter: g.returnDaysAfter ?? 1, shabbosAdjust: !!g.shabbosAdjust,
    itemAttributes: g.itemAttributes || [],
  };
}

/** Active Product Categories, sorted by Display Order (blank last) then name. */
async function loadCategories(db) {
  const recs = await db.listAll(T.PRODUCT_CATEGORIES, { filter: `{Active}=1` });
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
  const [gemachs, types, avail, categories] = await Promise.all([
    listActiveGemachs(db),
    db.listAll(T.ITEM_TYPES, { filter: `{Active}=1`, sort: [{ field: "Display Order", direction: "asc" }] }),
    db.listAll(T.ITEMS, { filter: `AND({Active}=1,{Status}="Available")`, fields: ["Item ID"] }),
    loadCategories(db),
  ]);
  const communities = await fetchByIds(db, T.COMMUNITIES, gemachs.flatMap(g => g.communityIds), { fields: ["Name"] });
  const communityName = Object.fromEntries(communities.map(r => [r.id, r.fields.Name || null]));
  const availableIds = new Set(avail.map(r => r.id));
  const qtyIds = types.filter(isQtyType).map(t => t.id);
  const bookings = qtyIds.length ? await loadQtyBookings(db, null, qtyIds) : {};
  const typesByGemach = {};
  const defsById = Object.fromEntries(gemachs.map(g => [g.id, g.itemAttributes]));
  for (const t of types) {
    const links = (t.fields["Gemach"] || []).map(linkedId);
    if (links.length !== 1) continue; // item types must belong to exactly one gemach
    (typesByGemach[links[0]] ||= []).push(publicItemType(t, availableIds, { withCategory: true, bookings, attrDefs: defsById[links[0]] }));
  }
  return {
    categories,
    gemachs: gemachs.map(g => ({
      ...publicGemach(g, communityName[g.communityIds[0]]),
      items: typesByGemach[g.id] || [],
    })),
    generatedAt: new Date().toISOString(),
  };
}

const directoryBuilder = db => async () => ({ status: 200, data: await buildDirectory(db) });

async function handleDirectory(db, env, ctx) {
  return cachedJson(env, ctx, cacheKey(env, "directory"), directoryBuilder(db));
}

async function handlePublicGemach(db, env, ctx, slug) {
  slug = String(slug || "").toLowerCase();
  if (!SLUG_RE.test(slug)) return json({ error: "Not found" }, 404);
  return cachedJson(env, ctx, cacheKey(env, `gemach/${slug}`), gemachBuilder(db, slug));
}

function gemachBuilder(db, slug) {
  return async () => {
    const g = await loadGemachBySlug(db, slug);
    if (!g || !g.active) return { status: 404, data: { error: "Not found" } };
    const [items, communities, categories] = await Promise.all([
      loadInventory(db, g, { withCategory: true, withBookings: true }),
      fetchByIds(db, T.COMMUNITIES, g.communityIds.slice(0, 1), { fields: ["Name"] }),
      loadCategories(db),
    ]);
    return { status: 200, data: { gemach: publicGemach(g, communities[0]?.fields?.Name), items, categories } };
  };
}

export { publicItemType, loadInventory, publicGemach, loadCategories, handleLegacyInventory, buildDirectory, directoryBuilder, handleDirectory, handlePublicGemach, gemachBuilder };
