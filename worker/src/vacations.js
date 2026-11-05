// Part of the Gemach Network worker (see index.js for routes and env vars).
// Vacations: periods (start → end, both days included, New York dates) when the gemach is away.
//   Gemachs."Vacations" = JSON [{ "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }, …] (stored sorted; past ones dropped on save).
//   Borrowers can't choose a pickup or return date inside one (request form + POST /public/requests).
//   Admin is only warned (admin.html). The gemach page shows a "currently on vacation" note above the contact buttons.
//   GET/POST /admin/vacations — list (current + upcoming) / replace the list (Owner, Manager, Network Admin);
//   POST answers with the bookings whose pickup / return / appointment falls inside a vacation (nothing is changed).
import { DbError, Q, belongs, fetchByIds, firstLink, linkedId } from "./records.js";
import { T } from "./config.js";
import { nyToday } from "./dates.js";
import { gemachFromRecord, gemachMemo, getGemachRecord, selName } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { canEditGemach } from "./settings.js";
import { parseVacations, validateVacations, vacationOn } from "./vacationrules.js";

/**
 * Open bookings with a date inside a vacation: waiting requests (needed from / until), reservations (start / end),
 * loans out (due back) and upcoming appointments. → [{ kind, name, what, date, ref }], soonest first. Max 5 queries.
 */
async function vacationConflicts(db, g, list) {
  if (!list.length) return [];
  const hit = d => (d ? vacationOn(list, String(d).slice(0, 10)) : null);
  const [reqs, loans] = await Promise.all([
    db.listAll(T.REQUESTS, { scope: g, where: [Q.or(Q.eq("Status", "New"), Q.eq("Status", "Converted"))],
      fields: ["Request ID", "Name", "Status", "Request Type", "Needed From", "Needed Until", "Appointment At", "Visit Outcome", "Gemach"] }),
    db.listAll(T.LOANS, { scope: g, where: [Q.or(Q.eq("Status", "Reserved"), Q.eq("Status", "Active"))],
      fields: ["Status", "Borrower", "Source Request", "Reservation Start", "Reservation End", "Expected Return", "Gemach"] }),
  ]);
  const out = [];
  const nyDate = iso => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  for (const r of reqs) {
    if (!belongs(r, g)) continue;
    const f = r.fields, status = selName(f.Status), type = selName(f["Request Type"]);
    if (type === "Appointment") {
      if (status !== "Converted" || !f["Appointment At"] || String(f["Visit Outcome"] || "").trim()) continue;
      const d = nyDate(f["Appointment At"]);
      if (hit(d)) out.push({ kind: "appointment", name: f.Name || "Unknown", what: "appointment", date: d, ref: { request: r.id } });
    } else if (status === "New") {
      for (const [what, d] of [["pickup", f["Needed From"]], ["return", f["Needed Until"]]]) {
        if (hit(d)) { out.push({ kind: "request", name: f.Name || "Unknown", what, date: d, ref: { request: r.id } }); break; }
      }
    }
  }
  // Loans: one row per booking (request, or the loan itself when it has no request).
  const seen = new Set(), pending = [];
  for (const l of loans) {
    if (!belongs(l, g)) continue;
    const f = l.fields, status = selName(f.Status);
    const dates = status === "Reserved" ? [["pickup", f["Reservation Start"]], ["return", f["Reservation End"]]] : [["return", f["Expected Return"]]];
    const found = dates.find(([, d]) => hit(d));
    if (!found) continue;
    const reqId = linkedId(firstLink(f["Source Request"]));
    const key = `${reqId || l.id}|${found[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({ kind: status === "Reserved" ? "reservation" : "loan", what: found[0], date: found[1], ref: reqId ? { request: reqId } : { loan: l.id },
      borrowerId: linkedId(firstLink(f.Borrower)) });
  }
  if (pending.length) {
    const ids = [...new Set(pending.map(p => p.borrowerId).filter(Boolean))];
    const bs = await fetchByIds(db, T.BORROWERS, ids, { g, fields: ["Name", "Gemach"] });
    const names = Object.fromEntries(bs.map(b => [b.id, b.fields?.Name]));
    for (const { borrowerId, ...p } of pending) out.push({ ...p, name: names[borrowerId] || "Unknown" });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return out.slice(0, 50);
}

async function handleGetVacations({ db, g }) {
  const rec = await getGemachRecord(db, g.id);
  const fresh = rec ? gemachFromRecord(rec) : g;
  return json({ today: nyToday(), vacations: parseVacations(fresh.vacations, nyToday()) });
}

async function handlePutVacations({ db, g, user, request }) {
  if (!canEditGemach(user)) return json({ error: "Only an Owner or Manager can change vacations." }, 403);
  const body = await readJson(request);
  const today = nyToday();
  const { value, error } = validateVacations(body?.vacations, today);
  if (error) return json({ error }, 400);
  try {
    await db.update(T.GEMACHS, g.id, { "Vacations": value.length ? JSON.stringify(value) : null });
  } catch (e) {
    if (!(e instanceof DbError)) throw e;
    console.error("Vacations update failed:", JSON.stringify(e.detail));
    return json({ error: "Could not save vacations. Please try again." }, 502);
  }
  gemachMemo.delete(g.slug);
  let conflicts = [];
  try { conflicts = await vacationConflicts(db, g, value); }
  catch (e) { console.error("vacation conflicts check failed:", e.message); conflicts = null; }
  return json({ success: true, today, vacations: value, conflicts }); // public caches purged by adminDispatch
}

export { vacationConflicts, handleGetVacations, handlePutVacations };
