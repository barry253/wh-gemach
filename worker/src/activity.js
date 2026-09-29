// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, fAnd, fStr, scopeF } from "./airtable.js";
import { DATE_RE, T } from "./config.js";
import { json } from "./http.js";

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
  return json({ records, offset: page.offset || null });
}

export { logEvent, handleGetHistory };
