// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Booking on someone's behalf, and what's coming up (admin) ─────────────────
//   POST /admin/reservations  — New reservation: { borrower: { name, phone, email, preferredContact },
//        items: [{ itemTypeId, quantity? }], reservationStart, reservationEnd (null = open-ended), eventDate?,
//        notes?, message?, sendMessage? }. Saved as a confirmed request (Source "Admin") with one Reserved
//        loan per item — exactly what confirming an online request makes, so the borrower gets a manage link
//        and it edits / picks up / cancels like any other reservation. Units are chosen at pickup.
//   POST /admin/appointments  — New appointment (appointment gemachs): { borrower, items? (to show her),
//        appointmentAt: "YYYY-MM-DDTHH:MM" New York, eventDate?, notes?, message?, sendMessage? }.
//   GET  /admin/upcoming?days=N (1–60, default 7) — reservations starting by then (incl. ones whose pickup
//        date passed and still aren't picked up) and appointments from today, one row per booking, soonest first.
// A message may contain {manage_link}; the email gets the real link (WhatsApp / text are sent from the
// admin's phone after saving, with the link the answer returns).
import { logEvents } from "./activity.js";
import { Q, belongs, fetchByIds, firstLink, linkedId, linkedName } from "./airtable.js";
import { alertBorrowerEmailFailed } from "./alerts.js";
import { checkBorrower, checkDate, checkRequestedItems, checkReservedAdds, createReserved, REQUEST_CONTACT, sendNote } from "./booking.js";
import { findOrCreateBorrower } from "./borrowers.js";
import { T } from "./config.js";
import { addDays, formatNy, isValidDate, nyLocalToUtc, nyToday } from "./dates.js";
import { selName } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { getNextRequestId } from "./ids.js";
import { manageUrl } from "./manage.js";
import { itemTypeInfoMap, loanQty, qtyLabel } from "./quantity.js";
import { APPT_AT_RE } from "./requests.js";

const MAX_ITEMS = 20;
const MAX_NOTE = 1000;
const ADMIN_SOURCE = "Admin";

/** Borrower block → validated values + the matching Borrowers record id. */
async function borrowerFrom(db, g, raw) {
  const v = checkBorrower(raw || {}, { name: "", phone: "", email: "" });
  if (v.error) return v;
  const id = await findOrCreateBorrower(db, g, { name: v.name, phone: v.phone || null, email: v.email || null, preferredContact: v.pref || null });
  return { ...v, id };
}

/** Request fields shared by both kinds. */
function requestFields(g, v, { requestId, type, ids, qty, eventDate, notes }) {
  const f = {
    "Request ID": requestId, "Name": v.name, "Status": "Converted", "Request Type": type, "Source": ADMIN_SOURCE, "Gemach": [g.id],
    "Items Requested": ids,
  };
  if (v.phone) f["Phone"] = v.phone;
  if (v.email) f["Email"] = v.email;
  if (v.pref && REQUEST_CONTACT[v.pref]) f["Preferred Contact"] = REQUEST_CONTACT[v.pref];
  if (Object.keys(qty || {}).length) f["Item Quantities"] = JSON.stringify(qty);
  if (eventDate) f["Event Date"] = eventDate;
  if (notes) f["Notes"] = notes;
  return f;
}

const noteOf = body => String(body.notes ?? "").trim().slice(0, MAX_NOTE) || null;
const withLink = (message, url) => String(message ?? "").replace(/\{manage_link\}/g, url || "");

async function handleNewReservation(c) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const t = nyToday();
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return json({ error: "Add at least one item." }, 400);
  if (raw.length > MAX_ITEMS) return json({ error: `Reserve up to ${MAX_ITEMS} items at a time.` }, 400);
  const start = body.reservationStart, end = body.reservationEnd == null || body.reservationEnd === "" ? null : body.reservationEnd;
  if (!isValidDate(start || "")) return json({ error: "Choose the date it's needed from." }, 400);
  for (const [d, label] of [[start, "start date"], [end, "end date"]]) {
    const e = checkDate(d, label, { notPast: true, t });
    if (e) return json({ error: e.error }, e.status);
  }
  if (end && end < start) return json({ error: "The end date is before the start date." }, 400);
  let eventDate = null;
  if (body.eventDate) {
    const e = checkDate(body.eventDate, "event date", { t });
    if (e) return json({ error: e.error }, e.status);
    eventDate = body.eventDate;
  }
  const lines = await checkReservedAdds(db, g, raw);
  if (lines.error) return json({ error: lines.error }, lines.status);
  const v = await borrowerFrom(db, g, body.borrower);
  if (v.error) return json({ error: v.error }, v.status);

  const ids = [...new Set(lines.lines.map(l => l.type.id))];
  const qty = Object.fromEntries(lines.lines.filter(l => l.quantity).map(l => [l.type.id, l.quantity]));
  const requestId = await getNextRequestId(db);
  const notes = noteOf(body);
  const req = await db.create(T.REQUESTS, {
    ...requestFields(g, v, { requestId, type: "Loan", ids, qty, eventDate }),
    "Needed From": start, ...(end ? { "Needed Until": end } : { "Open-ended duration": true }),
  });
  const events = await createReserved(c, { lines: lines.lines, start, end, borrowerId: v.id, borrowerName: v.name, sourceRequestId: req.id,
    note: `Made in admin (${requestId})`, loanNotes: notes });
  const url = await manageUrl(env, req.id);
  events.unshift({ eventType: "Reservation Made", borrower: v.name, itemType: lines.lines.map(l => l.label).join(", "), loanId: requestId, admin: c.adminName || null,
    notes: `${start} → ${end || "open-ended"}${notes ? `; ${notes}` : ""}` });
  logEvents(ctx, db, g, events);

  const emailSent = await sendNote(c, { to: v.email, message: withLink(body.message, url), sendMessage: body.sendMessage === true, subject: `Your ${g.name || "Gemach"} Request — Confirmed` });
  if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "reservation", requestId));
  return json({ success: true, request: req.id, requestId, manageUrl: url, loans: events.filter(e => e.eventType !== "Reservation Made").map(e => e.loanId), ...(emailSent === false ? { emailSent: false } : {}) });
}

async function handleNewAppointment(c) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const t = nyToday();
  const m = String(body.appointmentAt || "").match(APPT_AT_RE);
  if (!m || !isValidDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return json({ error: "Choose an appointment date and time." }, 400);
  if (m[1] < t) return json({ error: "The appointment can't be in the past." }, 400);
  if (m[1] > addDays(t, 730)) return json({ error: "The appointment is too far ahead." }, 400);
  let eventDate = null;
  if (body.eventDate) {
    const e = checkDate(body.eventDate, "event date", { t });
    if (e) return json({ error: e.error }, e.status);
    eventDate = body.eventDate;
  }
  const items = await checkRequestedItems(db, g, Array.isArray(body.items) ? body.items : [], { allowEmpty: true });
  if (items.error) return json({ error: items.error }, items.status);
  const v = await borrowerFrom(db, g, body.borrower);
  if (v.error) return json({ error: v.error }, v.status);

  const startMs = nyLocalToUtc(m[1], `${m[2]}:${m[3]}`);
  const requestId = await getNextRequestId(db);
  const notes = noteOf(body);
  const req = await db.create(T.REQUESTS, { ...requestFields(g, v, { requestId, type: "Appointment", ids: items.ids, qty: items.qty, eventDate, notes }),
    "Appointment At": new Date(startMs).toISOString() });
  const url = await manageUrl(env, req.id);
  logEvents(ctx, db, g, [{ eventType: "Appointment Booked", borrower: v.name, itemType: items.names.join(", ") || "Appointment", loanId: requestId, admin: c.adminName || null,
    notes: `Appointment ${formatNy(startMs)}${notes ? `; ${notes}` : ""}` }]);
  const emailSent = await sendNote(c, { to: v.email, message: withLink(body.message, url), sendMessage: body.sendMessage === true,
    subject: `Your ${g.name || "Gemach"} Request — Confirmed`, ics: { req, startMs } });
  if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "appointment", requestId));
  return json({ success: true, request: req.id, requestId, manageUrl: url, appointmentAt: new Date(startMs).toISOString(), ...(emailSent === false ? { emailSent: false } : {}) });
}

// ─── Upcoming ─────────────────────────────────────────────────────────────────

async function handleUpcoming({ db, g, url }) {
  const n = Number(url.searchParams.get("days"));
  const days = Number.isInteger(n) && n >= 1 && n <= 60 ? n : 7;
  const t = nyToday(), until = addDays(t, days);
  const fromIso = new Date(nyLocalToUtc(t, "00:00")).toISOString();
  const untilIso = new Date(nyLocalToUtc(addDays(until, 1), "00:00")).toISOString();
  const [loans, appts] = await Promise.all([
    db.listAll(T.LOANS, { scope: g, where: [Q.eq("Status", "Reserved")],
      fields: ["Loan ID", "Item to Reserve", "Borrower", "Status", "Quantity", "Reservation Start", "Reservation End", "Source Request", "Gemach"] }),
    db.listAll(T.REQUESTS, { scope: g, where: [Q.eq("Request Type", "Appointment"), Q.eq("Status", "Converted"), Q.notBlank("Appointment At"), Q.notBefore("Appointment At", fromIso)],
      sort: [{ field: "Appointment At", direction: "asc" }],
      fields: ["Request ID", "Name", "Phone", "Email", "Preferred Contact", "Items Requested", "Item Quantities", "Appointment At", "Event Date", "Status", "Request Type", "Visit Outcome", "Gemach"] }),
  ]);
  // Reservations starting by `until` (a missing start counts as now); grouped per request / per loan.
  const due = loans.filter(l => belongs(l, g) && selName(l.fields.Status) === "Reserved" && (l.fields["Reservation Start"] || t) <= until);
  const groups = new Map();
  for (const l of due) {
    const key = linkedId(firstLink(l.fields["Source Request"])) || l.id;
    (groups.get(key) || groups.set(key, []).get(key)).push(l);
  }
  const reqIds = [...groups.keys()].filter(k => groups.get(k)[0].id !== k);
  const bIds = due.map(l => linkedId(firstLink(l.fields["Borrower"]))).filter(Boolean);
  const visibleAppts = appts.filter(a => belongs(a, g) && !String(a.fields["Visit Outcome"] || "").trim() && a.fields["Appointment At"] >= fromIso && a.fields["Appointment At"] < untilIso);
  const [reqs, borrowers, info] = await Promise.all([
    fetchByIds(db, T.REQUESTS, reqIds, { g, fields: ["Request ID", "Event Date", "Gemach"] }),
    fetchByIds(db, T.BORROWERS, bIds, { g, fields: ["Name", "Phone", "Email", "Preferred Contact", "Gemach"] }),
    itemTypeInfoMap(db, [...due.map(l => linkedId(firstLink(l.fields["Item to Reserve"]))), ...visibleAppts.flatMap(a => (a.fields["Items Requested"] || []).map(linkedId))].filter(Boolean), g),
  ]);
  const reqMap = Object.fromEntries(reqs.map(r => [r.id, r]));
  const bMap = Object.fromEntries(borrowers.map(b => [b.id, b]));
  const out = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => String(a.fields["Reservation Start"] || "").localeCompare(String(b.fields["Reservation Start"] || "")));
    const f0 = list[0].fields;
    const b = bMap[linkedId(firstLink(f0["Borrower"]))]?.fields || {};
    const rq = reqMap[key];
    const start = f0["Reservation Start"] || t;
    out.push({
      kind: "reservation",
      date: start,
      late: start < t,                                   // pickup date passed, not picked up yet
      end: list.map(l => l.fields["Reservation End"]).filter(Boolean).sort().at(-1) || null,
      name: b.Name || linkedName(firstLink(f0["Borrower"])) || "Unknown",
      phone: b.Phone || null, email: b.Email || null, preferredContact: b["Preferred Contact"] || null,
      requestId: rq?.fields?.["Request ID"] || null,
      eventDate: rq?.fields?.["Event Date"] || null,
      items: list.map(l => {
        const ti = info[linkedId(firstLink(l.fields["Item to Reserve"]))];
        return qtyLabel(ti?.name || "Item", ti?.qty || ti?.addon ? loanQty(l.fields) : null);
      }),
      photos: list.map(l => info[linkedId(firstLink(l.fields["Item to Reserve"]))]).filter(x => x?.photo).slice(0, 4).map(x => ({ name: x.name, photo: x.photo, photos: x.photos })),
      ref: rq ? { request: rq.id } : { loan: list[0].id },
    });
  }
  for (const a of visibleAppts) {
    const f = a.fields, ids = (f["Items Requested"] || []).map(linkedId).filter(id => info[id]);
    out.push({
      kind: "appointment",
      at: f["Appointment At"],
      date: nyDateOf(f["Appointment At"]),
      name: f.Name || "Unknown", phone: f.Phone || null, email: f.Email || null, preferredContact: f["Preferred Contact"] || null,
      requestId: f["Request ID"] || null,
      eventDate: f["Event Date"] || null,
      items: ids.map(id => info[id].name),
      photos: ids.map(id => info[id]).filter(x => x.photo).slice(0, 4).map(x => ({ name: x.name, photo: x.photo, photos: x.photos })),
      ref: { request: a.id },
    });
  }
  out.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === y.kind ? String(x.at || "").localeCompare(String(y.at || "")) : x.kind === "appointment" ? -1 : 1) || x.name.localeCompare(y.name));
  return json({ today: t, days, until, items: out });
}

const nyDateOf = iso => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

export { handleNewReservation, handleNewAppointment, handleUpcoming, ADMIN_SOURCE };
