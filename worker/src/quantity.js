// Part of the Gemach Network worker (see index.js for routes and env vars).
import { belongs, fAnd, fetchByIds, firstLink, linkedId, scopeF, today } from "./airtable.js";
import { REC_RE, T } from "./config.js";
import { isValidDate, nyToday } from "./dates.js";
import { selName } from "./gemachs.js";

// ─── Quantity-tracked item types (e.g. 60 folding chairs; no per-unit Item records) ─
//
// Item Types.Tracking = "Quantity" (blank/"Units" = the classic one-record-per-unit model).
// Such a type has Quantity Owned / Out of Service counts; its loans link only "Item to Reserve"
// (never "Item") and carry Loans.Quantity. What's free depends on the dates asked for.

const isQtyType = rec => selName(rec?.fields?.["Tracking"]) === "Quantity";
// Item Types.Tracking = "Add-on": something the gemach makes/sells to order (e.g. a personalized sweatshirt).
// Never lent, never returned, no Items records, never counted in availability. Can have a Price.
const isAddonType = rec => selName(rec?.fields?.["Tracking"]) === "Add-on";
const addonPrice = rec => { const v = rec?.fields?.["Price"]; const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n >= 0 ? n : null; };
const money = n => (n == null || !Number.isFinite(n) ? "" : "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2)));
const wholeNum = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
/** Pieces on a loan record (blank = 1). */
const loanQty = f => { const n = Number(f?.["Quantity"]); return Number.isInteger(n) && n > 0 ? n : 1; };
/** Lendable pieces: Quantity Owned − Out of Service. */
const lendableQty = rec => Math.max(0, wholeNum(rec?.fields?.["Quantity Owned"]) - wholeNum(rec?.fields?.["Out of Service"]));
const MAX_QTY = 10000;
/**
 * Package size for quantity types lent in sets, e.g. tablecloths in bags of 6:
 * Item Types."Package Size" (blank/1 = single pieces) and optional "Package Unit" ("bag").
 * Counts (Quantity Owned, loan Quantity) stay in single pieces; borrowers may only ask for
 * whole packages. Admin can always set any count (e.g. a bag that's down to 4).
 */
const PACKAGE_UNIT_MAX = 30, PACKAGE_SIZE_MAX = 1000;
const packageSize = rec => isQtyType(rec) ? Math.max(1, Math.min(PACKAGE_SIZE_MAX, wholeNum(rec?.fields?.["Package Size"]))) : 1;
const packageUnit = rec => String(rec?.fields?.["Package Unit"] || "").trim() || null;
/** body.packageSize / body.packageUnit from admin → { fields } | { error } (only the keys that were sent). */
function packageFields(body) {
  const fields = {};
  if (body.packageSize !== undefined) {
    const v = body.packageSize;
    if (v === null || v === "" || Number(v) === 1) fields["Package Size"] = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > PACKAGE_SIZE_MAX) return { error: `Package size must be a whole number from 1 to ${PACKAGE_SIZE_MAX}.` };
      fields["Package Size"] = n;
    }
  }
  if (body.packageUnit !== undefined) {
    const u = String(body.packageUnit ?? "").trim();
    if (u.length > PACKAGE_UNIT_MAX) return { error: `The package word can be up to ${PACKAGE_UNIT_MAX} characters.` };
    fields["Package Unit"] = u || null;
  }
  return { fields };
}

/** "Chairs × 40" for quantity types, plain name otherwise. */
const qtyLabel = (name, n) => (n ? `${name} × ${n}` : name);
const LOAN_WINDOW_FIELDS = ["Item to Reserve", "Status", "Quantity", "Reservation Start", "Reservation End", "Date Borrowed", "Expected Return", "Gemach"];

/** Requests."Item Quantities" JSON -> { typeId: n } (bad JSON / values ignored). */
function parseQtyMap(raw) {
  let o;
  try { o = JSON.parse(raw || "{}"); } catch { return {}; }
  const out = {};
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) if (REC_RE.test(k) && Number.isInteger(v) && v > 0) out[k] = v;
  }
  return out;
}

/**
 * Inclusive date window an open quantity loan ties up; to=null = open-ended.
 * Active: Date Borrowed → Expected Return (else Reservation End); an overdue one stays out through today.
 * Reserved: Reservation Start → Reservation End.
 */
function loanWindow(f, todayStr) {
  if (f["Status"] === "Active") {
    const from = isValidDate(f["Date Borrowed"]) ? f["Date Borrowed"] : todayStr;
    const end = [f["Expected Return"], f["Reservation End"]].find(isValidDate) || null;
    return { from, to: end && end < todayStr ? todayStr : end };
  }
  return {
    from: isValidDate(f["Reservation Start"]) ? f["Reservation Start"] : todayStr,
    to: isValidDate(f["Reservation End"]) ? f["Reservation End"] : null,
  };
}

/**
 * Open (Reserved/Active) loans of the given quantity types that still matter (not over before today):
 * { typeId: [{ from, to, qty, status, loanRecId }] }. g = null reads every gemach (directory).
 */
async function loadQtyBookings(db, g, typeIds, { exceptLoanId = null } = {}) {
  const want = new Set(typeIds || []);
  if (!want.size) return {};
  const loans = await db.listAll(T.LOANS, {
    filter: fAnd(g && scopeF(g), `OR({Status}="Active",{Status}="Reserved")`),
    fields: LOAN_WINDOW_FIELDS,
  });
  const t = nyToday();
  const out = {};
  for (const l of loans) {
    if (l.id === exceptLoanId || (g && !belongs(l, g))) continue;
    const typeId = linkedId(firstLink(l.fields["Item to Reserve"]));
    if (!want.has(typeId)) continue;
    const w = loanWindow(l.fields, t);
    if (w.to != null && w.to < t) continue;
    (out[typeId] ||= []).push({ ...w, qty: loanQty(l.fields), status: l.fields["Status"], loanRecId: l.id });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.from.localeCompare(b.from));
  return out;
}

/** Fewest pieces free at any point of [from, to] (to=null: open-ended), i.e. what can be promised for the whole window. */
function qtyAvailable(total, bookings, from, to = from) {
  const overlap = (bookings || []).filter(b => (to == null || b.from <= to) && (b.to == null || b.to >= from));
  let peak = 0;
  for (const p of [from, ...overlap.map(b => b.from).filter(d => d > from)]) {
    let used = 0;
    for (const b of overlap) if (b.from <= p && (b.to == null || b.to >= p)) used += b.qty;
    peak = Math.max(peak, used);
  }
  return Math.max(0, total - peak);
}

/** Item type facts for ids (scoped): { id: { name, qty: bool, lendable, owned, outOfService } }. */
/** The item type's cover photo for admin lists: our own (R2) copy, else Airtable's small thumbnail (those links expire after a few hours). */
function typePhoto(r) {
  const own = r.fields["R2 Photo URL"];
  if (typeof own === "string" && /^https:\/\//i.test(own)) return own;
  const a = r.fields["Photo"]?.[0];
  return a?.thumbnails?.large?.url || a?.url || null;
}

async function itemTypeInfoMap(db, ids, g) {
  const recs = await fetchByIds(db, T.ITEM_TYPES, ids, { g, fields: ["Name", "Tracking", "Quantity Owned", "Out of Service", "Price", "R2 Photo URL", "Photo"] });
  return Object.fromEntries(recs.map(r => [r.id, {
    name: r.fields.Name || r.id,
    photo: typePhoto(r),
    qty: isQtyType(r),
    addon: isAddonType(r),
    price: addonPrice(r),
    lendable: lendableQty(r),
    owned: wholeNum(r.fields["Quantity Owned"]),
    outOfService: wholeNum(r.fields["Out of Service"]),
  }]));
}

/** The date window a request asks for (to=null = open-ended), or null for appointments / no dates. */
function requestWindow(f) {
  const from = isValidDate(f["Needed From"]) ? f["Needed From"] : null;
  if (!from) return null;
  const to = !f["Open-ended duration"] && isValidDate(f["Needed Until"]) ? f["Needed Until"] : null;
  return { from, to };
}

/**
 * For a new request: how many of each requested item type are free for the whole window.
 * Unit types count active numbered units against open (Reserved/Active) loans; quantity types use
 * lendable pieces vs booked pieces. Returns { typeId: { capacity, needed, free, status, backBy } }:
 * status "ok" | "short" (some, not enough) | "none" (nothing free) | "none-owned" (gemach has none listed);
 * backBy = soonest date something overlapping is due back (null if unknown / open-ended).
 */
async function requestAvailability(db, g, typeRecs, qtyMap, win) {
  typeRecs = typeRecs.filter(r => !isAddonType(r)); // add-ons are made to order: nothing to check
  const wanted = new Map(typeRecs.map(r => [r.id, r]));
  if (!wanted.size) return {};
  const unitTypes = typeRecs.filter(r => !isQtyType(r)).map(r => r.id);
  const [loans, units] = await Promise.all([
    db.listAll(T.LOANS, { filter: fAnd(scopeF(g), `OR({Status}="Active",{Status}="Reserved")`), fields: [...LOAN_WINDOW_FIELDS, "Item"] }),
    unitTypes.length ? db.listAll(T.ITEMS, { filter: fAnd(scopeF(g), `{Active}=1`), fields: ["Item Type", "Gemach"] }) : [],
  ]);
  const unitType = new Map();
  const capacity = {};
  for (const u of units) {
    if (!belongs(u, g)) continue;
    const t = linkedId(firstLink(u.fields["Item Type"]));
    unitType.set(u.id, t);
    if (wanted.has(t)) capacity[t] = (capacity[t] || 0) + 1;
  }
  const today = nyToday();
  const bookings = {};
  for (const l of loans) {
    if (!belongs(l, g)) continue;
    const t = linkedId(firstLink(l.fields["Item to Reserve"])) || unitType.get(linkedId(firstLink(l.fields["Item"])));
    const rec = wanted.get(t);
    if (!rec) continue;
    const w = loanWindow(l.fields, today);
    if (w.to != null && w.to < today) continue;
    (bookings[t] ||= []).push({ ...w, qty: isQtyType(rec) ? loanQty(l.fields) : 1 });
  }
  const out = {};
  for (const [id, rec] of wanted) {
    const cap = isQtyType(rec) ? lendableQty(rec) : capacity[id] || 0;
    const needed = isQtyType(rec) ? qtyMap[id] || 1 : 1;
    const free = qtyAvailable(cap, bookings[id], win.from, win.to);
    const overlapping = (bookings[id] || []).filter(b => (win.to == null || b.from <= win.to) && (b.to == null || b.to >= win.from));
    const back = overlapping.map(b => b.to).filter(Boolean).sort()[0] || null;
    out[id] = {
      capacity: cap, needed, free,
      status: cap === 0 ? "none-owned" : free >= needed ? "ok" : free === 0 ? "none" : "short",
      backBy: free >= needed ? null : back,
    };
  }
  return out;
}

export { packageSize, packageUnit, packageFields, isQtyType, wholeNum, loanQty, lendableQty, MAX_QTY, qtyLabel, LOAN_WINDOW_FIELDS, parseQtyMap, loanWindow, loadQtyBookings, qtyAvailable, itemTypeInfoMap, requestWindow, requestAvailability, isAddonType, addonPrice, money, typePhoto };
