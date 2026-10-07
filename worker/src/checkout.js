// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Lending at the counter: appointment check-out and walk-in loans ──────────────
// Appointment gemachs (e.g. dress gemachs) confirm a time but reserve nothing; at the visit the
// borrower picks what she actually takes, often not what she asked to see. These routes lend the
// chosen items on the spot (Active loans, no Reserved step):
//
//   GET  /admin/checkout/options[?request=<id>]  — everything the "Check out" / "New loan" sheet needs:
//        every active item type with its units and open loans, appointments that plan to look at each
//        type ("held" hints), the gemach's usual loan length, and (with ?request) that request.
//   POST /admin/requests/:id/checkout  — appointment request → Active loans linked back by Source Request
//        (so the borrower's manage link shows them); request gets Visit Outcome "Checked out".
//   POST /admin/requests/:id/visit     — { outcome: "nothing" | "noshow" }: close the visit without a loan.
//   POST /admin/loans                  — walk-in: same as checkout, with borrower details instead of a request.
//
// Body items: [{ itemTypeId, itemId? (numbered units), quantity? (quantity items / add-ons) }].
// Add-ons are handed over at once (Status Returned), like "Mark handed over".
import { logEvent, logEvents } from "./activity.js";
import { Q, belongs, fetchByIds, firstLink, getOwned, linkedId, linkedName } from "./airtable.js";
import { alertBorrowerEmailFailed } from "./alerts.js";
import { itemAttrsFor } from "./attributes.js";
import { findOrCreateBorrower } from "./borrowers.js";
import { REC_RE, T } from "./config.js";
import { addDays, isValidDate, nyLocalToUtc, nyToday } from "./dates.js";
import { buildEmailHtml, sendEmail } from "./email.js";
import { selName } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { getNextLoanId } from "./ids.js";
import { manageUrl } from "./manage.js";
import { addonPrice, isAddonType, isQtyType, lendableQty, loanQty, loanWindow, parseQtyMap, qtyLabel, typePhoto, typePhotos } from "./quantity.js";
import { emailSignature } from "./settings.js";

const MAX_ITEMS = 20;          // keeps one check-out well inside the 50-queries-per-request D1 limit
const MAX_ADDON = 500;
const MAX_DUE_DAYS = 730;
const MAX_MESSAGE = 5000;
const VISIT = { checkedOut: "Checked out", nothing: "Nothing borrowed", noshow: "No-show" };

const isAppt = rec => selName(rec?.fields?.["Request Type"]) === "Appointment";
const visitOf = rec => String(rec?.fields?.["Visit Outcome"] || "").trim() || null;

// ─── Picker data ──────────────────────────────────────────────────────────────

async function handleCheckoutOptions(c) {
  const { db, g, env, url } = c;
  const reqId = url?.searchParams.get("request") || null;
  const t = nyToday();
  const since = new Date(nyLocalToUtc(t, "00:00")).toISOString(); // "held" hints: appointments from today on
  const [types, units, loans, appts, reqRec] = await Promise.all([
    db.listAll(T.ITEM_TYPES, { scope: g, where: [Q.isTrue("Active")], sort: [{ field: "Display Order", direction: "asc" }],
      fields: ["Name", "Active", "Display Order", "Tracking", "Quantity Owned", "Out of Service", "Price", "R2 Photo URL", "More Photos", "Attributes", "Gemach"] }),
    db.listAll(T.ITEMS, { scope: g, where: [Q.isTrue("Active")], sort: [{ field: "Item ID", direction: "asc" }], fields: ["Item ID", "Item Type", "Active", "Condition", "Gemach"] }),
    db.listAll(T.LOANS, { scope: g, where: [Q.in("Status", ["Active", "Reserved"])],
      fields: ["Loan ID", "Item", "Item to Reserve", "Borrower", "Status", "Quantity", "Date Borrowed", "Expected Return", "Reservation Start", "Reservation End", "Gemach"] }),
    db.listAll(T.REQUESTS, { scope: g, where: [Q.eq("Request Type", "Appointment"), Q.eq("Status", "Converted"), Q.notBlank("Appointment At"), Q.notBefore("Appointment At", since)],
      fields: ["Request ID", "Name", "Items Requested", "Appointment At", "Status", "Request Type", "Visit Outcome", "Gemach"] }),
    reqId ? getOwned(db, T.REQUESTS, reqId, g) : null,
  ]);
  if (reqId && !reqRec) return json({ error: "Not found" }, 404);

  const borrowerIds = loans.filter(l => belongs(l, g)).map(l => linkedId(firstLink(l.fields["Borrower"]))).filter(Boolean);
  const borrowers = await fetchByIds(db, T.BORROWERS, borrowerIds, { g, fields: ["Name", "Gemach"] });
  const bName = Object.fromEntries(borrowers.map(b => [b.id, b.fields.Name || null]));

  const unitType = new Map();
  const unitsByType = {};
  for (const u of units) {
    if (!belongs(u, g)) continue;
    const tid = linkedId(firstLink(u.fields["Item Type"]));
    unitType.set(u.id, tid);
    (unitsByType[tid] ||= []).push({ id: u.id, itemId: u.fields["Item ID"] || "", needsRepair: u.fields["Condition"] === "Needs Repair" });
  }

  // Open loans per type: what's out now and what's booked ahead (for "on loan" and date-clash warnings).
  const bookingsByType = {};
  for (const l of loans) {
    if (!belongs(l, g)) continue;
    const f = l.fields;
    const unitId = linkedId(firstLink(f["Item"])) || null;
    const tid = linkedId(firstLink(f["Item to Reserve"])) || unitType.get(unitId);
    if (!tid) continue;
    const w = loanWindow(f, t);
    if (selName(f.Status) === "Reserved" && w.to != null && w.to < t) continue; // reservation already in the past
    (bookingsByType[tid] ||= []).push({
      status: selName(f.Status), unitId, from: w.from, to: w.to, quantity: loanQty(f),
      borrower: bName[linkedId(firstLink(f["Borrower"]))] || linkedName(firstLink(f["Borrower"])) || null,
    });
  }

  // "Held for appointment": upcoming appointments (other than this one) that plan to look at each type.
  const heldByType = {};
  for (const a of appts) {
    if (!belongs(a, g) || a.id === reqId || visitOf(a) || selName(a.fields.Status) !== "Converted") continue;
    if (!(a.fields["Appointment At"] >= since)) continue;
    for (const tid of (a.fields["Items Requested"] || []).map(linkedId)) {
      (heldByType[tid] ||= []).push({ at: a.fields["Appointment At"], name: a.fields.Name || null, requestId: a.fields["Request ID"] || null });
    }
  }
  for (const list of Object.values(heldByType)) list.sort((x, y) => x.at.localeCompare(y.at));

  const out = {
    today: t,
    defaultLoanDays: g.defaultLoanDays ?? null,
    types: types.filter(r => belongs(r, g)).map(r => {
      const tracking = isAddonType(r) ? "Add-on" : isQtyType(r) ? "Quantity" : "Units";
      const attrs = itemAttrsFor(r.fields["Attributes"], g.itemAttributes);
      return {
        id: r.id,
        name: r.fields.Name || "",
        tracking,
        photo: typePhoto(r),
        photos: typePhotos(r),
        attributes: attrs,
        price: tracking === "Add-on" ? addonPrice(r) : null,
        lendable: tracking === "Quantity" ? lendableQty(r) : null,
        units: tracking === "Units" ? unitsByType[r.id] || [] : [],
        bookings: bookingsByType[r.id] || [],
        held: heldByType[r.id] || [],
      };
    }),
  };
  if (reqRec) out.request = await requestPayload(env, reqRec);
  return json(out);
}

async function requestPayload(env, rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    requestId: f["Request ID"] || null,
    name: f.Name || null,
    phone: f.Phone || null,
    email: f.Email || null,
    preferredContact: f["Preferred Contact"] || null,
    requestType: isAppt(rec) ? "Appointment" : "Loan",
    status: selName(f.Status) || "New",
    visitOutcome: visitOf(rec),
    appointmentAt: f["Appointment At"] || null,
    eventDate: f["Event Date"] || null,
    notes: f.Notes || null,
    itemTypeIds: (f["Items Requested"] || []).map(linkedId),
    quantities: parseQtyMap(f["Item Quantities"]),
    manageUrl: await manageUrl(env, rec.id),
  };
}

// ─── Lending ──────────────────────────────────────────────────────────────────

/**
 * Check the body's items and due date against the gemach's inventory.
 * Returns { lines: [{ type, unit, quantity, tracking, label }], dueBack } or { error, status }.
 */
async function validateLending(db, g, body) {
  const raw = Array.isArray(body.items) ? body.items : null;
  if (!raw || !raw.length) return { error: "Choose at least one item.", status: 400 };
  if (raw.length > MAX_ITEMS) return { error: `That's more than ${MAX_ITEMS} items at once — please lend them in two goes.`, status: 400 };
  const t = nyToday();
  let dueBack = null;
  if (body.dueBack != null && body.dueBack !== "") {
    if (!isValidDate(body.dueBack)) return { error: "Choose a valid due-back date.", status: 400 };
    if (body.dueBack < t) return { error: "The due-back date can't be in the past.", status: 400 };
    if (body.dueBack > addDays(t, MAX_DUE_DAYS)) return { error: "The due-back date is too far ahead.", status: 400 };
    dueBack = body.dueBack;
  }
  for (const it of raw) {
    if (!it || typeof it !== "object" || !REC_RE.test(String(it.itemTypeId || ""))) return { error: "One of the items isn't valid.", status: 400 };
    if (it.itemId != null && it.itemId !== "" && !REC_RE.test(String(it.itemId))) return { error: "One of the items isn't valid.", status: 400 };
  }
  const typeIds = raw.map(i => i.itemTypeId);
  const unitIds = raw.map(i => i.itemId).filter(Boolean);
  if (new Set(unitIds).size !== unitIds.length) return { error: "The same item is listed twice.", status: 400 };
  const [types, units, out] = await Promise.all([
    fetchByIds(db, T.ITEM_TYPES, typeIds, { g, fields: ["Name", "Active", "Tracking", "Quantity Owned", "Out of Service", "Price", "Gemach"] }),
    fetchByIds(db, T.ITEMS, unitIds, { g, fields: ["Item ID", "Item Type", "Active", "Gemach"] }),
    unitIds.length ? db.listAll(T.LOANS, { scope: g, where: [Q.eq("Status", "Active")], fields: ["Item", "Status", "Gemach"] }) : [],
  ]);
  const unitsOut = new Set(out.filter(l => belongs(l, g) && selName(l.fields.Status) === "Active").map(l => linkedId(firstLink(l.fields["Item"]))).filter(Boolean));
  const typeMap = Object.fromEntries(types.filter(r => belongs(r, g)).map(r => [r.id, r]));
  const unitMap = Object.fromEntries(units.filter(r => belongs(r, g)).map(r => [r.id, r]));
  const seenCounted = new Set();
  const lines = [];
  for (const it of raw) {
    const type = typeMap[it.itemTypeId];
    if (!type) return { error: "One of the items isn't in this gemach's inventory.", status: 404 };
    const name = type.fields.Name || "Item";
    if (isAddonType(type) || isQtyType(type)) {
      if (seenCounted.has(type.id)) return { error: `${name} is listed twice — enter the total once.`, status: 400 };
      seenCounted.add(type.id);
      const n = it.quantity == null || it.quantity === "" ? 1 : Number(it.quantity);
      const max = isAddonType(type) ? MAX_ADDON : lendableQty(type);
      if (!Number.isInteger(n) || n < 1) return { error: `How many ${name}? Enter 1 or more.`, status: 400 };
      if (n > max) return { error: isAddonType(type) ? `How many ${name}? Enter up to ${MAX_ADDON}.` : `The gemach has ${max} ${name} it can lend — enter ${max} or fewer.`, status: 400 };
      lines.push({ type, unit: null, quantity: n, tracking: isAddonType(type) ? "Add-on" : "Quantity", label: qtyLabel(name, n) });
      continue;
    }
    const unit = unitMap[it.itemId];
    if (!it.itemId) return { error: `Choose which ${name} is going out.`, status: 400 };
    if (!unit || linkedId(firstLink(unit.fields["Item Type"])) !== type.id) return { error: `That ${name} wasn't found in inventory.`, status: 404 };
    if (!unit.fields.Active) return { error: `${unit.fields["Item ID"] || name} is marked inactive.`, status: 409 };
    if (unitsOut.has(unit.id)) return { error: `${unit.fields["Item ID"] || name} (${name}) is already out on loan.`, status: 409 };
    lines.push({ type, unit, quantity: null, tracking: "Units", label: name });
  }
  return { lines, dueBack };
}

/**
 * Create the loans for validated lines in one write. Returns { created: [{ id, loanId, label, tracking, itemCode }],
 * events } — the History rows to log (the caller adds its summary and logs them together).
 */
async function createLoans(c, { lines, dueBack, borrowerId, borrowerName, sourceRequestId = null, note, loanNotes = null }) {
  const { db, g } = c;
  const t = nyToday();
  const first = await getNextLoanId(db);
  const base = parseInt(first.slice(2), 10);
  const rows = lines.map((ln, i) => {
    const fields = {
      "Loan ID": `L-${String(base + i).padStart(3, "0")}`,
      "Borrower": [borrowerId],
      "Item to Reserve": [ln.type.id],
      "Gemach": [g.id],
      "Date Borrowed": t,
    };
    if (sourceRequestId) fields["Source Request"] = [sourceRequestId];
    if (loanNotes) fields["Notes"] = loanNotes;
    if (ln.tracking === "Add-on") {
      Object.assign(fields, { "Status": "Returned", "Quantity": ln.quantity, "Date Returned": t });
    } else {
      fields["Status"] = "Active";
      if (dueBack) fields["Expected Return"] = dueBack;
      if (ln.unit) fields["Item"] = [ln.unit.id];
      else fields["Quantity"] = ln.quantity;
    }
    return fields;
  });
  const recs = db.createMany ? await db.createMany(T.LOANS, rows) : await Promise.all(rows.map(f => db.create(T.LOANS, f)));
  const created = lines.map((ln, i) => ({ id: recs[i].id, loanId: rows[i]["Loan ID"], label: ln.label, tracking: ln.tracking, itemCode: ln.unit?.fields?.["Item ID"] || null }));
  const events = lines.map((ln, i) => ({
    eventType: ln.tracking === "Add-on" ? "Add-on Handed Over" : "Loan Created",
    itemCode: ln.unit?.fields?.["Item ID"] || null,
    itemType: ln.type.fields.Name || null,
    borrower: borrowerName || null,
    loanId: rows[i]["Loan ID"],
    admin: c.adminName || null,
    notes: ln.tracking === "Add-on" ? `${note}; handed over ${ln.quantity}` : ln.tracking === "Quantity" ? `${note}; ${ln.quantity} out` : note,
  }));
  return { created, events };
}

/** Send the admin-written message by email (when asked). Returns true / false (failed) / undefined (not sent). */
async function maybeEmail(c, { to, message, sendMessage }) {
  if (!sendMessage) return undefined;
  const text = String(message ?? "").trim();
  const addr = String(to || "").trim();
  if (!text || !addr) return undefined;
  const g = c.g;
  return sendEmail(c.env, g, {
    to: addr,
    subject: `What you borrowed — ${g.name || "Gemach"}`,
    text: text.slice(0, MAX_MESSAGE) + emailSignature(g),
    html: buildEmailHtml(g, text.slice(0, MAX_MESSAGE), { signature: true }),
  });
}

/** POST /admin/requests/:id/checkout */
async function handleRequestCheckout(c, id) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const rec = await getOwned(db, T.REQUESTS, id, g);
  if (!rec) return json({ error: "Not found" }, 404);
  const f = rec.fields;
  const st = selName(f.Status) || "New";
  if (!isAppt(rec)) return json({ error: "Only appointment requests are checked out here — confirm this request and use Pickup instead." }, 400);
  if (st === "Declined" || st === "Cancelled") return json({ error: `This request was ${st.toLowerCase()}.` }, 409);
  if (visitOf(rec) === VISIT.checkedOut) return json({ error: "This appointment was already checked out — see Loans." }, 409);

  const v = await validateLending(db, g, body);
  if (v.error) return json({ error: v.error }, v.status);

  let borrowerId;
  try {
    borrowerId = await findOrCreateBorrower(db, g, { name: f.Name || "Unknown", phone: f.Phone || null, email: f.Email || null, preferredContact: f["Preferred Contact"] || null });
  } catch (e) {
    return json({ error: e.message || "Couldn't save the borrower." }, 500);
  }
  const rid = f["Request ID"] || rec.id;
  const { created, events } = await createLoans(c, { lines: v.lines, dueBack: v.dueBack, borrowerId, borrowerName: f.Name, sourceRequestId: rec.id, note: `Checked out at appointment ${rid}` });

  const now = new Date().toISOString();
  await db.update(T.REQUESTS, rec.id, { "Status": "Converted", "Visit Outcome": VISIT.checkedOut, "Visited At": now });

  // One summary line in History: what was asked for vs taken.
  const asked = new Set((f["Items Requested"] || []).map(linkedId));
  const takenTypes = new Set(v.lines.map(l => l.type.id));
  const names = await typeNames(db, g, [...asked]);
  const notTaken = [...asked].filter(x => !takenTypes.has(x)).map(x => names[x]).filter(Boolean);
  const added = v.lines.filter(l => !asked.has(l.type.id)).map(l => l.label);
  logEvents(ctx, db, g, [...events, {
    eventType: "Checked Out",
    borrower: f.Name || null,
    itemType: v.lines.map(l => l.label).join(", "),
    loanId: rid,
    admin: c.adminName || null,
    notes: [`${created.length} item${created.length === 1 ? "" : "s"} out`, added.length ? `added: ${added.join(", ")}` : "",
      notTaken.length ? `not taken: ${notTaken.join(", ")}` : "", v.dueBack ? `due back ${v.dueBack}` : ""].filter(Boolean).join("; "),
  }]);

  const emailSent = await maybeEmail(c, { to: f.Email, message: body.message, sendMessage: body.sendMessage === true });
  if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "check-out", rid));
  return json({ success: true, loans: created, dueBack: v.dueBack, ...(emailSent === false ? { emailSent: false } : {}) });
}

/** POST /admin/requests/:id/visit — { outcome: "nothing" | "noshow" } */
async function handleRequestVisit(c, id) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const outcome = { nothing: VISIT.nothing, noshow: VISIT.noshow }[body.outcome];
  if (!outcome) return json({ error: "Choose what happened at the appointment." }, 400);
  const rec = await getOwned(db, T.REQUESTS, id, g);
  if (!rec) return json({ error: "Not found" }, 404);
  const st = selName(rec.fields.Status) || "New";
  if (!isAppt(rec)) return json({ error: "This isn't an appointment request." }, 400);
  if (st === "Declined" || st === "Cancelled") return json({ error: `This request was ${st.toLowerCase()}.` }, 409);
  if (outcome === VISIT.noshow && st !== "Converted") return json({ error: "Only a confirmed appointment can be a no-show." }, 409);
  if (visitOf(rec) === VISIT.checkedOut) return json({ error: "This appointment was already checked out — see Loans." }, 409);
  await db.update(T.REQUESTS, rec.id, { "Status": "Converted", "Visit Outcome": outcome, "Visited At": new Date().toISOString() });
  logEvent(ctx, db, g, {
    eventType: "Visit Closed",
    borrower: rec.fields.Name || null,
    loanId: rec.fields["Request ID"] || rec.id,
    admin: c.adminName || null,
    notes: outcome,
  });
  return json({ success: true, visitOutcome: outcome });
}

const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const CONTACTS = ["WhatsApp", "Phone", "SMS", "Text", "Email"];

/** POST /admin/loans — walk-in: { borrower: { name, phone, email, preferredContact }, items, dueBack, notes, message, sendMessage } */
async function handleWalkInLoan(c) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const b = body.borrower && typeof body.borrower === "object" ? body.borrower : {};
  const name = String(b.name || "").trim().replace(/\s+/g, " ");
  const phone = String(b.phone || "").trim();
  const email = String(b.email || "").trim();
  const pref = CONTACTS.includes(b.preferredContact) ? b.preferredContact : null;
  if (!name) return json({ error: "Enter the borrower's name." }, 400);
  if (name.length > 100 || phone.length > 40 || email.length > 200) return json({ error: "That borrower detail is too long." }, 400);
  if (!phone && !email) return json({ error: "Enter a phone number or email so the gemach can reach them." }, 400);
  if (phone && phone.replace(/\D/g, "").length < 7) return json({ error: "That phone number looks too short." }, 400);
  if (email && !EMAIL_RE.test(email)) return json({ error: "That email address doesn't look right." }, 400);
  const notes = String(body.notes || "").trim().slice(0, 1000) || null;

  const v = await validateLending(db, g, body);
  if (v.error) return json({ error: v.error }, v.status);
  let borrowerId;
  try {
    borrowerId = await findOrCreateBorrower(db, g, { name, phone: phone || null, email: email || null, preferredContact: pref });
  } catch (e) {
    return json({ error: e.message || "Couldn't save the borrower." }, 500);
  }
  const { created, events } = await createLoans(c, { lines: v.lines, dueBack: v.dueBack, borrowerId, borrowerName: name, note: "Walk-in loan", loanNotes: notes });
  logEvents(ctx, db, g, events);
  const emailSent = await maybeEmail(c, { to: email, message: body.message, sendMessage: body.sendMessage === true });
  if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "loan", created.map(l => l.loanId).join(", ")));
  return json({ success: true, loans: created, dueBack: v.dueBack, ...(emailSent === false ? { emailSent: false } : {}) });
}

async function typeNames(db, g, ids) {
  const recs = await fetchByIds(db, T.ITEM_TYPES, ids, { g, fields: ["Name", "Gemach"] });
  return Object.fromEntries(recs.filter(r => belongs(r, g)).map(r => [r.id, r.fields.Name || null]));
}

export { handleCheckoutOptions, handleRequestCheckout, handleRequestVisit, handleWalkInLoan, validateLending, createLoans, VISIT, MAX_ITEMS, EMAIL_RE };
