// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, fAnd, fStr, scopeF } from "./airtable.js";
import { DATE_RE, T } from "./config.js";
import { json } from "./http.js";
import { typePhotos } from "./quantity.js";

// ─── Activity Log ─────────────────────────────────────────────────────────────

// Fire-and-forget; never throws. Always stamps the gemach.
function logEvent(ctx, db, g, { eventType, itemCode, itemType, borrower, loanId, admin, notes }) {
  const fields = { "Timestamp": new Date().toISOString(), "Event Type": eventType, "Gemach": [g.id] };
  if (itemCode) fields["Item Code"] = String(itemCode);
  if (itemType) fields["Item Type"] = String(itemType);
  if (borrower) fields["Borrower"] = String(borrower);
  if (loanId)   fields["Loan ID"] = String(loanId);
  if (admin)    fields["Admin"] = String(admin);
  if (notes)    fields["Notes"] = String(notes);
  const p = db.create(T.LOG, fields).catch(e => console.error("logEvent failed:", e.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

async function handleGetHistory({ db, g, url }) {
  const eventType = url.searchParams.get("eventType") || null;
  const search    = url.searchParams.get("search") || null;
  const dateFrom  = url.searchParams.get("dateFrom") || null;
  const dateTo    = url.searchParams.get("dateTo") || null;
  const sortDir   = url.searchParams.get("sort") === "asc" ? "asc" : "desc";
  const offset    = url.searchParams.get("offset") || null;

  const filters = [scopeF(g)];
  if (eventType) filters.push(`{Event Type}=${fStr(eventType)}`);
  if (dateFrom && DATE_RE.test(dateFrom)) filters.push(`IS_AFTER({Timestamp},"${dateFrom}T00:00:00.000Z")`);
  if (dateTo && DATE_RE.test(dateTo))     filters.push(`IS_BEFORE({Timestamp},"${dateTo}T23:59:59.999Z")`);

  let page;
  try {
    page = await db.listPage(T.LOG, {
      filter: fAnd(...filters),
      sort: [{ field: "Timestamp", direction: sortDir }],
      pageSize: 50,
      offset,
    });
  } catch (e) {
    if (e instanceof AirtableError && e.status === 422 && offset) return json({ error: "Invalid or expired offset" }, 400);
    throw e;
  }

  let records = page.records.map(r => ({
    id: r.id,
    timestamp: r.fields["Timestamp"] || null,
    eventType: r.fields["Event Type"] || null,
    itemCode: r.fields["Item Code"] || null,
    itemType: r.fields["Item Type"] || null,
    borrower: r.fields["Borrower"] || null,
    loanId: r.fields["Loan ID"] || null,
    admin: r.fields["Admin"] || null,
    notes: r.fields["Notes"] || null,
  }));

  if (search) {
    const q = search.toLowerCase();
    records = records.filter(r =>
      (r.borrower || "").toLowerCase().includes(q) ||
      (r.itemCode || "").toLowerCase().includes(q) ||
      (r.itemType || "").toLowerCase().includes(q) ||
      (r.loanId || "").toLowerCase().includes(q) ||
      (r.notes || "").toLowerCase().includes(q)
    );
  }
  await attachPhotos(db, g, records);
  return json({ records, offset: page.offset || null });
}

// Log entries name their item type in text ("Wheelchair", or "Wheelchair, Walker" for a request), so photos are
// matched by name against this gemach's item types: records get photos: [{ name, photos: [cover, ...more] }].
// A type renamed since the entry was written simply has no photo. One extra Airtable read, only when needed.
async function attachPhotos(db, g, records) {
  if (!records.some(r => r.itemType)) return;
  let types;
  try { types = await db.listAll(T.ITEM_TYPES, { filter: scopeF(g), fields: ["Name", "R2 Photo URL", "Photo", "More Photos"] }); }
  catch (e) { console.error("History photos skipped:", e.message); return; }
  const key = s => String(s || "").replace(/\s*×\s*\d+\s*$/, "").trim().toLowerCase(); // "Folding Chair × 40" → the type
  const byName = new Map();
  for (const t of types) { const list = typePhotos(t); if (list.length && !byName.has(key(t.fields.Name))) byName.set(key(t.fields.Name), { name: t.fields.Name, photos: list }); }
  if (!byName.size) return;
  for (const r of records) {
    if (!r.itemType) continue;
    const whole = byName.get(key(r.itemType));
    const found = whole ? [whole] : [...new Set(r.itemType.split(/,\s*/).map(key))].map(n => byName.get(n)).filter(Boolean);
    if (found.length) r.photos = found;
  }
}

export { logEvent, handleGetHistory };
