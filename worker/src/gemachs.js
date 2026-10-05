// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fStr, linkedId } from "./airtable.js";
import { CACHE_TTL_MS, LEGACY_SLUG, NETWORK_ADMIN_ROLE, SLUG_RE, T } from "./config.js";
import { isLiveNetworkAdmin } from "./network.js";
import { parseAttrDefs } from "./attributes.js";

// ─── Gemach lookup ────────────────────────────────────────────────────────────

const gemachMemo = new Map(); // slug -> { g, at }  (plain data only; per-isolate, 60s)

const nonBlank = v => (typeof v === "string" ? (v.trim() ? v : null) : v ?? null);
const GEMACH_MODES = new Set(["Full", "Directory", "Info"]); // Online requests / Listing only / Info only
const ITEM_VIEWS = ["List", "Grid", "Photos"]; // Gemachs.Item View: public page layout (List = classic rows)
const CONTACT_METHODS = ["Call", "Text", "WhatsApp", "Email"];
const REQUEST_STYLES = ["Dates", "Event", "Appointment"];
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const DEFAULT_THEME = "#1B3A4B";
const DEFAULT_EVENT_LABEL = "Event date";
const selName = v => (typeof v === "string" ? v : v?.name ?? null);
const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v);
  if (v == null || v === "" || !Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

function gemachFromRecord(r) {
  const f = r.fields || {};
  const mode = typeof f.Mode === "string" ? f.Mode : f.Mode?.name;
  const order = Number(f["Display Order"]);
  return {
    id: r.id,
    slug: f.Slug || null,
    name: f.Name || "",
    tagline: nonBlank(f.Tagline),
    email: f.Email || null,
    phone: f.Phone || null,
    whatsapp: f.WhatsApp || null,
    website: nonBlank(f.Website),
    donationUrl: nonBlank(f["Donation URL"]),
    donationInfo: nonBlank(f["Donation Info"]),
    hours: nonBlank(f.Hours),
    description: f.Description || "",
    category: f.Category || null,
    mode: GEMACH_MODES.has(mode) ? mode : "Full",
    primaryContact: CONTACT_METHODS.includes(selName(f["Primary Contact"])) ? selName(f["Primary Contact"]) : null,
    secondaryContact: CONTACT_METHODS.includes(selName(f["Secondary Contact"])) ? selName(f["Secondary Contact"]) : null,
    themeColor: HEX_RE.test(String(f["Theme Color"] || "").trim()) ? String(f["Theme Color"]).trim().toUpperCase() : DEFAULT_THEME,
    accentColor: HEX_RE.test(String(f["Accent Color"] || "").trim()) ? String(f["Accent Color"]).trim().toUpperCase() : null,
    depositRequired: !!f["Deposit Required"],
    chargeType: selName(f["Charge Type"]) === "Payment" ? "Payment" : "Deposit", // Deposit = refundable; Payment = a fee
    itemView: ITEM_VIEWS.includes(selName(f["Item View"])) ? selName(f["Item View"]) : "List", // how items first show on the public page
    depositInfo: nonBlank(f["Deposit Info"]),
    gemachInfo: nonBlank(f["Gemach Info"]),
    requestStyle: REQUEST_STYLES.includes(selName(f["Request Style"])) ? selName(f["Request Style"]) : "Dates",
    eventLabel: nonBlank(f["Event Label"]) ? String(f["Event Label"]).trim() : DEFAULT_EVENT_LABEL,
    pickupDaysBefore: clampInt(f["Pickup Days Before"], 0, 14, 1),
    returnDaysAfter: clampInt(f["Return Days After"], 0, 14, 1),
    shabbosAdjust: !!f["Shabbos Adjust"],
    logoUrlField: nonBlank(f["Logo URL"]),
    displayOrder: f["Display Order"] != null && f["Display Order"] !== "" && Number.isFinite(order) ? order : null,
    pickupAddress: nonBlank(f["Pickup Address"]),
    pickupInstructions: nonBlank(f["Pickup Instructions"]),       // PRIVATE
    rawTemplates: {                                               // PRIVATE
      confirm: nonBlank(f["Confirm Message"]),
      decline: nonBlank(f["Decline Message"]),
      pickup: nonBlank(f["Pickup Message"]),
      appointment: nonBlank(f["Appointment Message"]),
      returnReminder: nonBlank(f["Return Reminder Message"]),
    },
    active: !!f.Active,
    logoUrl: nonBlank(f["Logo URL"]) || f.Logo?.[0]?.url || null,
    logoDarkUrl: /^https:\/\//i.test(nonBlank(f["Logo On Dark URL"]) || "") ? nonBlank(f["Logo On Dark URL"]) : null,
    communityIds: (f.Community || []).map(linkedId),
    itemAttributes: parseAttrDefs(f["Item Attributes"]),
    comingSoon: !!f["Coming Soon"],                              // listed, not searchable, no requests (only meaningful when active)
    browseCategoryIds: (f["Browse Categories"] || []).map(linkedId).filter(Boolean),
  };
}

/** Display Order ascending (blank last), then name. */
function byOrderThenName(a, b) {
  const ao = a.displayOrder, bo = b.displayOrder;
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if ((ao == null) !== (bo == null)) return ao == null ? 1 : -1;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

async function loadGemachBySlug(db, slug) {
  if (!SLUG_RE.test(slug || "")) return null;
  const hit = gemachMemo.get(slug);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.g;
  const recs = await db.listAll(T.GEMACHS, { filter: `{Slug}=${fStr(slug)}`, maxRecords: 2 });
  const g = recs.length === 1 ? gemachFromRecord(recs[0]) : null;
  if (recs.length > 1) console.error(`Duplicate gemach slug: ${slug}`);
  if (g) gemachMemo.set(slug, { g, at: Date.now() });
  return g;
}

async function listActiveGemachs(db) {
  const recs = await db.listAll(T.GEMACHS, {
    filter: `AND({Active}=1,{Slug}!="")`,
    sort: [{ field: "Name", direction: "asc" }],
  });
  return recs.map(gemachFromRecord).filter(g => SLUG_RE.test(g.slug || "")).sort(byOrderThenName);
}

/** Every gemach with a valid slug (active and hidden) — for Network Admins. Sorted by name. */
async function listAllGemachs(db) {
  const recs = await db.listAll(T.GEMACHS, { filter: `{Slug}!=""` });
  return recs.map(gemachFromRecord).filter(g => SLUG_RE.test(g.slug || "")).sort((a, b) => a.name.localeCompare(b.name));
}
const gemachRef = g => ({ id: g.id, slug: g.slug, name: g.name, active: !!g.active });

async function resolveAdminGemach(request, url, db, user) {
  const jwtG = Array.isArray(user.gemachs) ? user.gemachs : [];
  const isNet = user.role === NETWORK_ADMIN_ROLE;
  let slug = (url.searchParams.get("g") || request.headers.get("X-Gemach") || "").trim().toLowerCase();
  if (!slug) {
    if (jwtG.length === 1) slug = jwtG[0].slug;
    // Legacy admin.html never sends ?g — keep it on WH Medical for multi-gemach/network admins.
    else if (isNet || jwtG.some(x => x.slug === LEGACY_SLUG)) slug = LEGACY_SLUG;
    else return { status: 400, error: "Gemach not specified (use ?g=<slug>)", gemachs: jwtG };
  }
  if (!SLUG_RE.test(slug)) return { status: 400, error: "Invalid gemach" };

  // A JWT can be up to 12h old: a demoted or deactivated Network Admin must not keep cross-gemach
  // access until the refresh, so re-check the role live (memoized ~60s per isolate). 401 makes the
  // client sign in again and pick up its current role/gemachs.
  if (isNet && !(await isLiveNetworkAdminMemo(db, user.email))) return { status: 401, error: "Unauthorized" };

  const g = await loadGemachBySlug(db, slug);
  // Record id is the source of truth (the JWT's slugs go stale when a gemach's slug is renamed).
  const assigned = g ? jwtG.find(x => x.id === g.id) : null;
  if (!g) return isNet ? { status: 404, error: "Unknown gemach" } : { status: 403, error: "Forbidden for this gemach" };
  if (!assigned && !isNet) return { status: 403, error: "Forbidden for this gemach" };
  if (!assigned && !g.active && !isNet) return { status: 403, error: "Gemach is not active" };
  return { g };
}

const liveNetMemo = new Map(); // email -> { ok, at }  (per-isolate, 60s)
async function isLiveNetworkAdminMemo(db, email) {
  const key = String(email || "").toLowerCase();
  const hit = liveNetMemo.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ok;
  const ok = await isLiveNetworkAdmin(db, key);
  liveNetMemo.set(key, { ok, at: Date.now() });
  return ok;
}

export { ITEM_VIEWS, gemachMemo, nonBlank, GEMACH_MODES, CONTACT_METHODS, REQUEST_STYLES, HEX_RE, DEFAULT_THEME, DEFAULT_EVENT_LABEL, selName, clampInt, gemachFromRecord, byOrderThenName, loadGemachBySlug, listActiveGemachs, listAllGemachs, gemachRef, resolveAdminGemach, liveNetMemo, isLiveNetworkAdminMemo };
