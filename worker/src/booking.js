// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Editing a booking (admin) ──────────────────────────────────────────────────
// A "booking" is everything that belongs together: a request and its open loans (Reserved / Active,
// linked by Source Request), or a single loan made without a request (walk-in, Inventory "assign").
// One sheet in admin edits it as a whole:
//
//   GET  /admin/booking?request=<id> | ?loan=<id>   — the booking (request, borrower, open loans)
//   PATCH /admin/booking                             — change it (only what's sent changes):
//     { request | loan,                               which booking
//       borrower: { name, phone, email, preferredContact },   → Borrowers record + the request
//       neededFrom, neededUntil, openEnded,          → a request still waiting (no loans yet)
//       eventDate,                                    → the request's event date
//       appointmentAt: "YYYY-MM-DDTHH:MM" (New York), → reschedule a confirmed appointment
//       reservationStart, reservationEnd,             → every Reserved loan (and the request's dates)
//       dateBorrowed, expectedReturn,                 → every Active loan (picked up / due back)
//       notes,                                        → every open loan
//       quantities: { loanId: n },                    → counted items / add-ons
//       remove: [loanId],                             → Reserved → Cancelled; Active (lent by mistake) → Cancelled
//       add: [{ itemTypeId, itemId?, quantity? }], addAs: "reserved" | "active",
//       requestedItems: [{ itemTypeId, quantity? }],  → what a waiting request / appointment asks for
//       message, sendMessage }                        → optional note to the borrower (email; .ics for a new appointment time)
//   POST /admin/booking/cancel { request | loan, message?, sendMessage? }
//        — cancels what hasn't gone out: Reserved loans, an appointment, a waiting request.
import { logEvent, logEvents } from "./activity.js";
import { Q, belongs, fetchByIds, firstLink, getOwned, linkedId } from "./airtable.js";
import { alertBorrowerEmailFailed } from "./alerts.js";
import { CONTACT_MAP } from "./borrowers.js";
import { createLoans, EMAIL_RE, validateLending } from "./checkout.js";
import { REC_RE, T } from "./config.js";
import { addDays, base64Utf8, buildIcs, formatNy, isValidDate, nyLocalToUtc, nyToday } from "./dates.js";
import { buildEmailHtml, sendEmail } from "./email.js";
import { selName } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { getNextLoanId } from "./ids.js";
import { manageUrl } from "./manage.js";
import { MAX_QTY, isAddonType, isQtyType, itemTypeInfoMap, lendableQty, loanQty, parseQtyMap, qtyLabel } from "./quantity.js";
import { APPT_AT_RE } from "./requests.js";
import { emailSignature } from "./settings.js";

const OPEN = ["Reserved", "Active"];
const MAX_GROUP = 40;           // loans edited at once (keeps a save inside D1's per-request query limit)
const MAX_ADD = 20;
const MAX_ADDON = 500;
const MAX_DAYS_AHEAD = 730;
const MAX_MESSAGE = 5000;
const LOAN_FIELDS = ["Loan ID", "Item", "Item to Reserve", "Borrower", "Status", "Quantity", "Date Borrowed", "Expected Return",
  "Reservation Start", "Reservation End", "Notes", "Source Request", "Gemach"];
// Request.Preferred Contact uses the form's words; Borrowers use CONTACT_MAP's.
const REQUEST_CONTACT = { WhatsApp: "WhatsApp", Text: "SMS", SMS: "SMS", Phone: "Phone", Call: "Phone", Email: "Email" };

const isAppt = rec => selName(rec?.fields?.["Request Type"]) === "Appointment";
const visitOf = rec => String(rec?.fields?.["Visit Outcome"] || "").trim() || null;
const statusOf = l => selName(l.fields.Status);
const bad = (error, status = 400) => ({ error, status });

/** The booking for ?request= / ?loan= (scoped), or null. */
async function loadBooking(db, g, { requestId = null, loanId = null }) {
  let req = null, loans = [];
  if (requestId) {
    req = await getOwned(db, T.REQUESTS, requestId, g);
    if (!req) return null;
  } else {
    const l = await getOwned(db, T.LOANS, loanId, g);
    if (!l) return null;
    const src = linkedId(firstLink(l.fields["Source Request"]));
    if (src) req = await getOwned(db, T.REQUESTS, src, g);
    if (!req) loans = OPEN.includes(statusOf(l)) ? [l] : [];
  }
  if (req) {
    const rid = req.fields["Request ID"] || "";
    loans = rid ? (await db.listAll(T.LOANS, { scope: g, where: [Q.linksTo("Source Request", req.id, rid)], fields: LOAN_FIELDS }))
      .filter(l => belongs(l, g) && (l.fields["Source Request"] || []).map(linkedId).includes(req.id) && OPEN.includes(statusOf(l))) : [];
  }
  const bId = loans.map(l => linkedId(firstLink(l.fields["Borrower"]))).find(Boolean) || null;
  const [borrower] = bId ? await fetchByIds(db, T.BORROWERS, [bId], { g, fields: ["Name", "Phone", "Email", "Preferred Contact", "Gemach"] }) : [];
  return { req, loans, borrower: borrower && belongs(borrower, g) ? borrower : null };
}

/** What kind of booking this is, for the sheet: request | appointment | reservation | loan | mixed | closed. */
function kindOf(b) {
  const st = new Set(b.loans.map(statusOf));
  if (st.has("Active") && st.has("Reserved")) return "mixed";
  if (st.has("Active")) return "loan";
  if (st.has("Reserved")) return "reservation";
  if (!b.req) return "closed";
  const rs = selName(b.req.fields.Status) || "New";
  if (rs === "New") return "request";
  if (rs === "Converted" && isAppt(b.req) && !visitOf(b.req)) return "appointment";
  return "closed";
}

async function bookingPayload(c, b) {
  const { db, g, env } = c;
  const f = b.req?.fields || {};
  const reqTypes = (f["Items Requested"] || []).map(linkedId);
  const loanTypes = b.loans.map(l => linkedId(firstLink(l.fields["Item to Reserve"]))).filter(Boolean);
  const unitIds = b.loans.map(l => linkedId(firstLink(l.fields["Item"]))).filter(Boolean);
  const [info, units] = await Promise.all([
    itemTypeInfoMap(db, [...reqTypes, ...loanTypes], g),
    fetchByIds(db, T.ITEMS, unitIds, { g, fields: ["Item ID", "Item Type"] }),
  ]);
  const unitMap = Object.fromEntries(units.map(u => [u.id, u]));
  // Unit-only loans (Inventory "assign") have no Item to Reserve: name them from the unit's type.
  const missing = units.map(u => linkedId(firstLink(u.fields["Item Type"]))).filter(t => t && !info[t]);
  if (missing.length) Object.assign(info, await itemTypeInfoMap(db, missing, g));
  const qmap = parseQtyMap(f["Item Quantities"]);
  const tracking = t => (t?.addon ? "Add-on" : t?.qty ? "Quantity" : "Units");
  const bf = b.borrower?.fields || {};
  return {
    kind: kindOf(b),
    request: b.req ? {
      id: b.req.id,
      requestId: f["Request ID"] || null,
      status: selName(f.Status) || "New",
      requestType: isAppt(b.req) ? "Appointment" : "Loan",
      name: f.Name || null, phone: f.Phone || null, email: f.Email || null, preferredContact: f["Preferred Contact"] || null,
      neededFrom: f["Needed From"] || null, neededUntil: f["Needed Until"] || null, openEnded: !!f["Open-ended duration"],
      eventDate: f["Event Date"] || null, appointmentAt: f["Appointment At"] || null,
      preferredTimes: f["Preferred Times"] || null, partySize: f["Party Size"] ?? null, notes: f.Notes || null,
      items: reqTypes.filter(id => info[id]).map(id => ({ itemTypeId: id, name: info[id].name, tracking: tracking(info[id]), photo: info[id].photo, photos: info[id].photos,
        quantity: info[id].qty || info[id].addon ? qmap[id] || 1 : null, price: info[id].addon ? info[id].price : null })),
      manageUrl: await manageUrl(env, b.req.id),
    } : null,
    borrower: b.borrower ? { id: b.borrower.id, name: bf.Name || null, phone: bf.Phone || null, email: bf.Email || null, preferredContact: bf["Preferred Contact"] || null } : null,
    loans: b.loans.map(l => {
      const lf = l.fields;
      const unit = unitMap[linkedId(firstLink(lf["Item"]))];
      const tid = linkedId(firstLink(lf["Item to Reserve"])) || linkedId(firstLink(unit?.fields?.["Item Type"]));
      const t = info[tid];
      const counted = !unit && (t?.qty || t?.addon);
      return {
        id: l.id, loanId: lf["Loan ID"] || null, status: statusOf(l),
        itemTypeId: tid || null, itemTypeName: t?.name || "Item", tracking: unit ? "Units" : tracking(t), photo: t?.photo || null, photos: t?.photos || [],
        itemId: unit?.fields?.["Item ID"] || null, quantity: counted ? loanQty(lf) : null, lendable: t?.qty ? t.lendable : null,
        reservationStart: lf["Reservation Start"] || null, reservationEnd: lf["Reservation End"] || null,
        dateBorrowed: lf["Date Borrowed"] || null, expectedReturn: lf["Expected Return"] || null, notes: lf.Notes || null,
      };
    }).sort((a, b2) => String(a.loanId || "").localeCompare(String(b2.loanId || ""), undefined, { numeric: true })),
    requestStyle: g.requestStyle, eventLabel: g.eventLabel, defaultLoanDays: g.defaultLoanDays ?? null, today: nyToday(),
  };
}

function refOf(src) {
  const requestId = typeof src.request === "string" && REC_RE.test(src.request) ? src.request : null;
  const loanId = typeof src.loan === "string" && REC_RE.test(src.loan) ? src.loan : null;
  return requestId || loanId ? { requestId, loanId: requestId ? null : loanId } : null;
}

async function handleGetBooking(c) {
  const ref = refOf({ request: c.url.searchParams.get("request"), loan: c.url.searchParams.get("loan") });
  if (!ref) return json({ error: "Which booking?" }, 400);
  const b = await loadBooking(c.db, c.g, ref);
  if (!b) return json({ error: "Not found" }, 404);
  return json(await bookingPayload(c, b));
}

// ─── Edit ─────────────────────────────────────────────────────────────────────

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const dateOrNull = v => (v === null || v === "" ? null : v);

/** Validate the borrower block → { name, phone, email, pref } or { error }. */
function checkBorrower(v, current) {
  if (!v || typeof v !== "object") return bad("Borrower details aren't valid.");
  const name = has(v, "name") ? String(v.name ?? "").trim().replace(/\s+/g, " ") : current.name;
  const phone = has(v, "phone") ? String(v.phone ?? "").trim() : current.phone;
  const email = has(v, "email") ? String(v.email ?? "").trim() : current.email;
  const pref = has(v, "preferredContact") ? (v.preferredContact ? String(v.preferredContact) : "") : null;
  if (!name) return bad("Enter the borrower's name.");
  if (name.length > 100 || phone.length > 40 || email.length > 200) return bad("That borrower detail is too long.");
  if (!phone && !email) return bad("Keep a phone number or email so the gemach can reach them.");
  if (phone && phone.replace(/\D/g, "").length < 7) return bad("That phone number looks too short.");
  if (email && !EMAIL_RE.test(email)) return bad("That email address doesn't look right.");
  if (pref && !CONTACT_MAP[pref] && !REQUEST_CONTACT[pref]) return bad("Choose how they prefer to be contacted.");
  return { name, phone, email, pref };
}

function checkDate(v, label, { notPast = false, notFuture = false, t }) {
  if (v === null) return null;
  if (!isValidDate(v)) return bad(`Choose a valid ${label}.`);
  if (notPast && v < t) return bad(`The ${label} can't be in the past.`);
  if (notFuture && v > t) return bad(`The ${label} can't be in the future.`);
  if (v > addDays(t, MAX_DAYS_AHEAD)) return bad(`The ${label} is too far ahead.`);
  return null;
}

async function handlePatchBooking(c) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const ref = refOf(body);
  if (!ref) return json({ error: "Which booking?" }, 400);
  const b = await loadBooking(db, g, ref);
  if (!b) return json({ error: "Not found" }, 404);
  const kind = kindOf(b);
  if (kind === "closed") return json({ error: "There's nothing open on this booking to change." }, 409);
  if (b.loans.length > MAX_GROUP) return json({ error: "This booking is too large to edit at once." }, 400);
  const t = nyToday();
  const req = b.req, rf = req?.fields || {};
  const reserved = b.loans.filter(l => statusOf(l) === "Reserved");
  const active = b.loans.filter(l => statusOf(l) === "Active");
  const byId = new Map(b.loans.map(l => [l.id, l]));
  const changes = [];           // History summary
  const reqUpdate = {};
  const borrowerUpdate = {};
  const resUpdate = {}, activeUpdate = {}, allUpdate = {};
  let apptStartMs = null;
  const fail = e => json({ error: e.error }, e.status);

  // Borrower / contact
  if (body.borrower !== undefined) {
    const bf = b.borrower?.fields || {};
    const cur = { name: bf.Name || rf.Name || "", phone: bf.Phone || rf.Phone || "", email: bf.Email || rf.Email || "" };
    const v = checkBorrower(body.borrower, cur);
    if (v.error) return fail(v);
    const diff = [];
    if (v.name !== cur.name) diff.push(`name ${cur.name || "—"} → ${v.name}`);
    if (v.phone !== cur.phone) diff.push("phone");
    if (v.email !== cur.email) diff.push("email");
    if (b.borrower) {
      Object.assign(borrowerUpdate, { "Name": v.name, "Phone": v.phone || null, "Email": v.email || null });
      if (v.pref !== null) borrowerUpdate["Preferred Contact"] = v.pref ? CONTACT_MAP[v.pref] || CONTACT_MAP[REQUEST_CONTACT[v.pref]] || null : null;
    }
    if (req) {
      Object.assign(reqUpdate, { "Name": v.name, "Phone": v.phone || null, "Email": v.email || null });
      if (v.pref !== null) reqUpdate["Preferred Contact"] = v.pref ? REQUEST_CONTACT[v.pref] || null : null;
    }
    if (v.pref !== null && v.pref !== (bf["Preferred Contact"] || rf["Preferred Contact"] || "")) diff.push("preferred contact");
    if (diff.length) changes.push(`Contact: ${diff.join(", ")}`);
  }

  // A request still waiting: its dates
  for (const [k, field, label] of [["neededFrom", "Needed From", "start date"], ["neededUntil", "Needed Until", "end date"]]) {
    if (!has(body, k)) continue;
    if (kind !== "request") return json({ error: "Those dates belong to a request that hasn't been confirmed — change the reservation dates instead." }, 400);
    const v = dateOrNull(body[k]);
    const e = checkDate(v, label, { t });
    if (e) return fail(e);
    reqUpdate[field] = v;
  }
  if (has(body, "openEnded")) {
    if (kind !== "request") return json({ error: "Open-ended applies to a request that hasn't been confirmed." }, 400);
    reqUpdate["Open-ended duration"] = !!body.openEnded;
    if (body.openEnded) reqUpdate["Needed Until"] = null;
  }
  if (has(reqUpdate, "Needed From") || has(reqUpdate, "Needed Until") || has(reqUpdate, "Open-ended duration")) {
    const from = has(reqUpdate, "Needed From") ? reqUpdate["Needed From"] : rf["Needed From"] || null;
    const until = has(reqUpdate, "Needed Until") ? reqUpdate["Needed Until"] : rf["Needed Until"] || null;
    if (from && until && until < from) return json({ error: "The end date is before the start date." }, 400);
    changes.push(`Dates ${from || "?"} → ${(reqUpdate["Open-ended duration"] ?? rf["Open-ended duration"]) ? "open-ended" : until || "?"}`);
  }

  // Event date
  if (has(body, "eventDate")) {
    if (!req) return json({ error: "This loan has no request to hold an event date." }, 400);
    const v = dateOrNull(body.eventDate);
    const e = checkDate(v, "event date", { t });
    if (e) return fail(e);
    if (v !== (rf["Event Date"] || null)) { reqUpdate["Event Date"] = v; changes.push(`${g.eventLabel || "Event date"} ${rf["Event Date"] || "—"} → ${v || "—"}`); }
  }

  // Reschedule an appointment
  if (has(body, "appointmentAt")) {
    if (!req || !isAppt(req)) return json({ error: "This isn't an appointment." }, 400);
    if ((selName(rf.Status) || "New") !== "Converted") return json({ error: "Confirm the appointment to set its time." }, 400);
    const m = String(body.appointmentAt || "").match(APPT_AT_RE);
    if (!m || !isValidDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) return json({ error: "Choose an appointment date and time." }, 400);
    apptStartMs = nyLocalToUtc(m[1], `${m[2]}:${m[3]}`);
    const iso = new Date(apptStartMs).toISOString();
    if (iso !== rf["Appointment At"]) {
      reqUpdate["Appointment At"] = iso;
      changes.push(`Appointment ${rf["Appointment At"] ? formatNy(Date.parse(rf["Appointment At"])) : "—"} → ${formatNy(apptStartMs)}`);
    } else apptStartMs = null;
  }

  // Reservation dates (every Reserved loan; the request's dates follow)
  if (has(body, "reservationStart") || has(body, "reservationEnd")) {
    if (!reserved.length) return json({ error: "Nothing here is reserved — change the due-back date instead." }, 400);
    const cur0 = reserved[0].fields;
    const start = has(body, "reservationStart") ? dateOrNull(body.reservationStart) : cur0["Reservation Start"] || null;
    const end = has(body, "reservationEnd") ? dateOrNull(body.reservationEnd) : cur0["Reservation End"] || null;
    for (const [v, label] of [[start, "reservation start"], [end, "reservation end"]]) { const e = checkDate(v, label, { t }); if (e) return fail(e); }
    if (start && end && end < start) return json({ error: "The reservation ends before it starts." }, 400);
    if (has(body, "reservationStart")) resUpdate["Reservation Start"] = start;
    if (has(body, "reservationEnd")) resUpdate["Reservation End"] = end;
    if (req && !isAppt(req)) {
      if (has(body, "reservationStart")) reqUpdate["Needed From"] = start;
      if (has(body, "reservationEnd")) { reqUpdate["Needed Until"] = end; reqUpdate["Open-ended duration"] = !end; }
    }
    if (start !== (cur0["Reservation Start"] || null) || end !== (cur0["Reservation End"] || null)) {
      changes.push(`Reserved ${cur0["Reservation Start"] || "?"}–${cur0["Reservation End"] || "open"} → ${start || "?"}–${end || "open"}`);
    }
  }

  // Loan dates (every Active loan)
  if (has(body, "dateBorrowed") || has(body, "expectedReturn")) {
    if (!active.length) return json({ error: "Nothing here is out on loan yet — change the reservation dates instead." }, 400);
    if (has(body, "dateBorrowed")) {
      const v = body.dateBorrowed;
      if (!isValidDate(v || "")) return json({ error: "Choose the date it was picked up." }, 400);
      const e = checkDate(v, "pick-up date", { notFuture: true, t });
      if (e) return fail(e);
      activeUpdate["Date Borrowed"] = v;
    }
    if (has(body, "expectedReturn")) {
      const v = dateOrNull(body.expectedReturn);
      const e = checkDate(v, "due-back date", { t });
      if (e) return fail(e);
      const borrowedMax = activeUpdate["Date Borrowed"] || active.map(l => l.fields["Date Borrowed"]).filter(Boolean).sort().at(-1) || null;
      if (v && borrowedMax && v < borrowedMax) return json({ error: "The due-back date is before it was picked up." }, 400);
      activeUpdate["Expected Return"] = v;
      const was = active.map(l => l.fields["Expected Return"] || null).sort().at(-1) || null;
      if (v !== was) changes.push(`Due back ${was || "—"} → ${v || "no date"}`);
    }
    if (has(activeUpdate, "Date Borrowed")) changes.push(`Picked up ${activeUpdate["Date Borrowed"]}`);
  }

  // Notes on every open loan
  if (has(body, "notes")) {
    if (!b.loans.length) return json({ error: "Notes are kept on reservations and loans." }, 400);
    const v = String(body.notes ?? "").trim();
    if (v.length > 1000) return json({ error: "That note is too long." }, 400);
    allUpdate["Notes"] = v || null;
    if (b.loans.some(l => (l.fields.Notes || null) !== (v || null))) changes.push("Notes");
  }

  // Counted items
  const qtyUpdates = [];
  if (body.quantities && typeof body.quantities === "object") {
    const ids = Object.keys(body.quantities);
    const loans = ids.map(id => byId.get(id));
    if (loans.some(l => !l)) return json({ error: "One of those items isn't part of this booking." }, 400);
    const typeRecs = await fetchByIds(db, T.ITEM_TYPES, loans.map(l => linkedId(firstLink(l.fields["Item to Reserve"]))), { g, fields: ["Name", "Tracking", "Quantity Owned", "Out of Service", "Gemach"] });
    const typeMap = Object.fromEntries(typeRecs.map(r => [r.id, r]));
    for (const l of loans) {
      const tr = typeMap[linkedId(firstLink(l.fields["Item to Reserve"]))];
      if (!tr || (l.fields.Item || []).length || !(isQtyType(tr) || isAddonType(tr))) return json({ error: "Only counted items have a quantity to change." }, 400);
      const n = Number(body.quantities[l.id]);
      const max = isAddonType(tr) ? MAX_ADDON : Math.min(MAX_QTY, lendableQty(tr));
      if (!Number.isInteger(n) || n < 1) return json({ error: `How many ${tr.fields.Name}? Enter 1 or more.` }, 400);
      if (n > max) return json({ error: `The gemach has ${max} ${tr.fields.Name} it can lend.` }, 400);
      if (n !== loanQty(l.fields)) { qtyUpdates.push([l, n]); changes.push(`${tr.fields.Name} ${loanQty(l.fields)} → ${n}`); }
    }
  }

  // Remove items
  const removeIds = Array.isArray(body.remove) ? [...new Set(body.remove)] : [];
  for (const id of removeIds) if (!byId.has(id)) return json({ error: "One of those items isn't part of this booking." }, 400);
  if (removeIds.length && removeIds.length >= b.loans.length && !(Array.isArray(body.add) && body.add.length)) {
    return json({ error: active.length ? "To end the loan, mark the items returned." : "To drop everything, cancel the reservation instead." }, 400);
  }

  // Add items
  let addLines = null, addAs = null;
  if (Array.isArray(body.add) && body.add.length) {
    if (body.add.length > MAX_ADD) return json({ error: `Add up to ${MAX_ADD} items at a time.` }, 400);
    if (!b.loans.length) return json({ error: "Add items to what the request asks for instead." }, 400);
    addAs = body.addAs === "active" ? "active" : body.addAs === "reserved" ? "reserved" : active.length ? "active" : "reserved";
    if (addAs === "active") {
      const v = await validateLending(db, g, { items: body.add });
      if (v.error) return fail(v);
      addLines = v.lines;
    } else {
      const v = await checkReservedAdds(db, g, body.add);
      if (v.error) return fail(v);
      addLines = v.lines;
    }
  }

  // Replace what a waiting request / appointment asks for
  let requestedItems = null;
  if (Array.isArray(body.requestedItems)) {
    if (!(kind === "request" || kind === "appointment")) return json({ error: "Once reserved, add or remove the reserved items instead." }, 400);
    const v = await checkRequestedItems(db, g, body.requestedItems, { allowEmpty: isAppt(req) });
    if (v.error) return fail(v);
    requestedItems = v;
    const before = new Set((rf["Items Requested"] || []).map(linkedId));
    const after = new Set(v.ids);
    const added = v.names.filter((n, i) => !before.has(v.ids[i]));
    const removedNames = (await itemTypeInfoMap(db, [...before].filter(x => !after.has(x)), g));
    const removedList = Object.values(removedNames).map(x => x.name);
    if (added.length) changes.push(`Asked for: added ${added.join(", ")}`);
    if (removedList.length) changes.push(`Asked for: removed ${removedList.join(", ")}`);
    const oldQ = parseQtyMap(rf["Item Quantities"]);
    for (const [id, n] of Object.entries(v.qty)) if (before.has(id) && oldQ[id] && oldQ[id] !== n) changes.push(`${v.names[v.ids.indexOf(id)]} ${oldQ[id]} → ${n}`);
    reqUpdate["Items Requested"] = v.ids;
    reqUpdate["Item Quantities"] = Object.keys(v.qty).length ? JSON.stringify(v.qty) : null;
  }

  // ── Write ──
  const writes = [];
  if (Object.keys(borrowerUpdate).length) writes.push(db.update(T.BORROWERS, b.borrower.id, borrowerUpdate));
  if (req && Object.keys(reqUpdate).length) writes.push(db.update(T.REQUESTS, req.id, reqUpdate));
  const keep = id => !removeIds.includes(id);
  if (Object.keys(resUpdate).length) writes.push(db.updateMany(T.LOANS, reserved.map(l => l.id).filter(keep), resUpdate));
  if (Object.keys(activeUpdate).length) writes.push(db.updateMany(T.LOANS, active.map(l => l.id).filter(keep), activeUpdate));
  if (Object.keys(allUpdate).length) writes.push(db.updateMany(T.LOANS, b.loans.map(l => l.id).filter(keep), allUpdate));
  for (const [l, n] of qtyUpdates) if (keep(l.id)) writes.push(db.update(T.LOANS, l.id, { "Quantity": n }));
  if (removeIds.length) writes.push(db.updateMany(T.LOANS, removeIds, { "Status": "Cancelled" }));
  await Promise.all(writes);

  const borrowerName = borrowerUpdate.Name || reqUpdate.Name || b.borrower?.fields?.Name || rf.Name || null;
  const events = [];
  const label = l => { const tid = linkedId(firstLink(l.fields["Item to Reserve"])); return tid; };
  if (removeIds.length) {
    const info = await itemTypeInfoMap(db, removeIds.map(id => label(byId.get(id))).filter(Boolean), g);
    for (const id of removeIds) {
      const l = byId.get(id);
      const nm = info[label(l)]?.name || "item";
      changes.push(`Removed ${nm}`);
      events.push({ eventType: statusOf(l) === "Active" ? "Loan Cancelled" : "Reservation Cancelled", itemType: nm, borrower: borrowerName, loanId: l.fields["Loan ID"] || null, admin: c.adminName || null, notes: "Removed in Edit" });
    }
  }
  if (addLines) {
    const borrowerId = b.borrower?.id || linkedId(firstLink(b.loans[0].fields["Borrower"]));
    if (addAs === "active") {
      const due = has(activeUpdate, "Expected Return") ? activeUpdate["Expected Return"] : active.map(l => l.fields["Expected Return"]).find(Boolean) || null;
      const r = await createLoans(c, { lines: addLines, dueBack: due, borrowerId, borrowerName, sourceRequestId: req?.id || null, note: "Added in Edit" });
      events.push(...r.events);
    } else {
      const start = has(resUpdate, "Reservation Start") ? resUpdate["Reservation Start"] : reserved[0]?.fields?.["Reservation Start"] || active[0]?.fields?.["Date Borrowed"] || t;
      const end = has(resUpdate, "Reservation End") ? resUpdate["Reservation End"] : reserved[0]?.fields?.["Reservation End"] || null;
      events.push(...await createReserved(c, { lines: addLines, start, end, borrowerId, borrowerName, sourceRequestId: req?.id || null }));
    }
    changes.push(`Added ${addLines.map(l => l.label).join(", ")}`);
  }

  const rid = rf["Request ID"] || b.loans[0]?.fields?.["Loan ID"] || null;
  if (changes.length) events.push({ eventType: "Booking Updated", borrower: borrowerName, loanId: rid, admin: c.adminName || null, notes: changes.join("; ").slice(0, 1000) });
  logEvents(ctx, db, g, events);

  // Optional note to the borrower (an appointment's new time comes with a calendar invite).
  const to = has(reqUpdate, "Email") ? reqUpdate.Email : has(borrowerUpdate, "Email") ? borrowerUpdate.Email : b.borrower?.fields?.Email || rf.Email || null;
  const emailSent = await sendNote(c, { to, message: body.message, sendMessage: body.sendMessage === true, subject: `Your ${g.name || "Gemach"} ${kind === "appointment" ? "appointment" : kind === "request" ? "request" : kind === "loan" ? "loan" : "reservation"} — updated`,
    ics: apptStartMs ? { req, startMs: apptStartMs } : null });
  if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "update", rid || "booking"));

  const fresh = await loadBooking(db, g, req ? { requestId: req.id } : { loanId: b.loans[0].id });
  return json({ success: true, changes, ...(emailSent === false ? { emailSent: false } : {}), booking: fresh ? await bookingPayload(c, fresh) : null });
}

/** Items to reserve (no unit yet — it's chosen at pickup): [{ itemTypeId, quantity? }] → { lines } or { error }. */
async function checkReservedAdds(db, g, raw) {
  for (const it of raw) if (!it || !REC_RE.test(String(it.itemTypeId || ""))) return bad("One of the items isn't valid.");
  const types = await fetchByIds(db, T.ITEM_TYPES, raw.map(i => i.itemTypeId), { g, fields: ["Name", "Active", "Tracking", "Quantity Owned", "Out of Service", "Gemach"] });
  const map = Object.fromEntries(types.filter(r => belongs(r, g)).map(r => [r.id, r]));
  const lines = [];
  for (const it of raw) {
    const type = map[it.itemTypeId];
    if (!type) return bad("One of the items isn't in this gemach's inventory.", 404);
    const name = type.fields.Name || "Item";
    if (isQtyType(type) || isAddonType(type)) {
      const n = it.quantity == null || it.quantity === "" ? 1 : Number(it.quantity);
      const max = isAddonType(type) ? MAX_ADDON : lendableQty(type);
      if (!Number.isInteger(n) || n < 1) return bad(`How many ${name}? Enter 1 or more.`);
      if (n > max) return bad(`The gemach has ${max} ${name} it can lend.`);
      lines.push({ type, quantity: n, addon: isAddonType(type), label: qtyLabel(name, n) });
    } else lines.push({ type, quantity: null, addon: false, label: name });
  }
  return { lines };
}

async function createReserved(c, { lines, start, end, borrowerId, borrowerName, sourceRequestId, note = "Added in Edit", loanNotes = null }) {
  const { db, g } = c;
  const first = await getNextLoanId(db);
  const base = parseInt(first.slice(2), 10);
  const rows = lines.map((ln, i) => {
    const f = { "Loan ID": `L-${String(base + i).padStart(3, "0")}`, "Borrower": [borrowerId], "Item to Reserve": [ln.type.id], "Status": "Reserved", "Gemach": [g.id] };
    if (start) f["Reservation Start"] = start;
    if (end) f["Reservation End"] = end;
    if (ln.quantity) f["Quantity"] = ln.quantity;
    if (sourceRequestId) f["Source Request"] = [sourceRequestId];
    if (loanNotes) f["Notes"] = loanNotes;
    return f;
  });
  await (db.createMany ? db.createMany(T.LOANS, rows) : Promise.all(rows.map(f => db.create(T.LOANS, f))));
  return lines.map((ln, i) => ({ eventType: ln.addon ? "Add-on Ordered" : "Item Reserved", itemType: ln.type.fields.Name || null, borrower: borrowerName, loanId: rows[i]["Loan ID"], admin: c.adminName || null, notes: note }));
}

/** [{ itemTypeId, quantity? }] → { ids, qty, names } (active, this gemach's) or { error }. */
async function checkRequestedItems(db, g, raw, { allowEmpty }) {
  if (!raw.length && !allowEmpty) return bad("Keep at least one item on the request.");
  if (raw.length > 30) return bad("That's too many items for one request.");
  for (const it of raw) if (!it || !REC_RE.test(String(it.itemTypeId || ""))) return bad("One of the items isn't valid.");
  const ids = [...new Set(raw.map(i => i.itemTypeId))];
  const types = await fetchByIds(db, T.ITEM_TYPES, ids, { g, fields: ["Name", "Active", "Tracking", "Quantity Owned", "Out of Service", "Gemach"] });
  const map = Object.fromEntries(types.filter(r => belongs(r, g)).map(r => [r.id, r]));
  const qty = {}, names = [];
  for (const id of ids) {
    const type = map[id];
    if (!type) return bad("One of the items isn't in this gemach's inventory.", 404);
    names.push(type.fields.Name || "Item");
    if (isQtyType(type) || isAddonType(type)) {
      const it = raw.find(x => x.itemTypeId === id);
      const n = it.quantity == null || it.quantity === "" ? 1 : Number(it.quantity);
      const max = isAddonType(type) ? MAX_ADDON : lendableQty(type);
      if (!Number.isInteger(n) || n < 1 || n > max) return bad(`How many ${type.fields.Name}? Enter 1 to ${max}.`);
      qty[id] = n;
    }
  }
  return { ids, qty, names };
}

/** Email the borrower when asked; true / false (failed) / undefined (not sent). */
async function sendNote(c, { to, message, sendMessage, subject, ics = null }) {
  const text = String(message ?? "").trim().slice(0, MAX_MESSAGE);
  const addr = String(to || "").trim();
  if (!sendMessage || !text || !addr) return undefined;
  const g = c.g;
  const mail = { to: addr, subject, text: text + emailSignature(g), html: buildEmailHtml(g, text, { signature: true }) };
  if (ics) {
    const title = `${g.name || "Gemach"} appointment`;
    const f = ics.req.fields;
    const cal = buildIcs({
      uid: `${f["Request ID"] || ics.req.id}-${ics.req.id}@whgemachs.org`, startMs: ics.startMs, durationMin: 60, title,
      description: `${title}${g.phone ? ` · ${g.phone}` : ""}${g.email ? ` · ${g.email}` : ""}`, location: g.pickupAddress || null,
    });
    mail.attachments = [{ filename: "appointment.ics", content: base64Utf8(cal) }];
  }
  return sendEmail(c.env, g, mail);
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

async function handleCancelBooking(c) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const ref = refOf(body);
  if (!ref) return json({ error: "Which booking?" }, 400);
  const b = await loadBooking(db, g, ref);
  if (!b) return json({ error: "Not found" }, 404);
  const kind = kindOf(b);
  const reserved = b.loans.filter(l => statusOf(l) === "Reserved");
  const active = b.loans.filter(l => statusOf(l) === "Active");
  if (kind === "closed") return json({ error: "There's nothing open on this booking to cancel." }, 409);
  if (kind === "loan") return json({ error: "Everything here is already out — mark the items returned instead." }, 409);
  const rf = b.req?.fields || {};
  const writes = [];
  if (reserved.length) writes.push(db.updateMany(T.LOANS, reserved.map(l => l.id), { "Status": "Cancelled" }));
  if (b.req && !active.length) writes.push(db.update(T.REQUESTS, b.req.id, { "Status": "Cancelled" }));
  await Promise.all(writes);
  const borrowerName = b.borrower?.fields?.Name || rf.Name || null;
  const info = await itemTypeInfoMap(db, [...reserved.map(l => linkedId(firstLink(l.fields["Item to Reserve"]))), ...(rf["Items Requested"] || []).map(linkedId)].filter(Boolean), g);
  const rid = rf["Request ID"] || reserved[0]?.fields?.["Loan ID"] || null;
  const what = kind === "appointment" ? "Appointment" : kind === "request" ? "Request" : "Reservation";
  logEvents(ctx, db, g, [
    ...reserved.map(l => ({ eventType: "Reservation Cancelled", itemType: info[linkedId(firstLink(l.fields["Item to Reserve"]))]?.name || null, borrower: borrowerName, loanId: l.fields["Loan ID"] || null, admin: c.adminName || null })),
    ...(b.req && !active.length ? [{ eventType: "Request Cancelled", borrower: borrowerName, loanId: rid,
      itemType: (rf["Items Requested"] || []).map(linkedId).map(id => info[id]?.name).filter(Boolean).join(", ") || (isAppt(b.req) ? "Appointment" : null),
      admin: c.adminName || null, notes: `${what} cancelled by the gemach` }] : []),
  ]);
  const to = b.borrower?.fields?.Email || rf.Email || null;
  const emailSent = await sendNote(c, { to, message: body.message, sendMessage: body.sendMessage === true, subject: `Your ${g.name || "Gemach"} ${what.toLowerCase()} — cancelled` });
  if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "cancellation", rid || "booking"));
  return json({ success: true, cancelled: reserved.length, requestCancelled: !!(b.req && !active.length), ...(emailSent === false ? { emailSent: false } : {}) });
}

export { handleGetBooking, handlePatchBooking, handleCancelBooking, loadBooking, kindOf, checkBorrower, checkDate, checkReservedAdds, checkRequestedItems, createReserved, sendNote, REQUEST_CONTACT };
