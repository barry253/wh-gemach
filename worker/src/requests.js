// Part of the Gemach Network worker (see index.js for routes and env vars).
import { logEvent } from "./activity.js";
import { Q, belongs, fetchByIds, firstLink, getOwned, linkedId, linkedName, today } from "./airtable.js";
import { itemAttrsFor } from "./attributes.js";
import { alertBorrowerEmailFailed } from "./alerts.js";
import { findOrCreateBorrower } from "./borrowers.js";
import { DATE_RE, T } from "./config.js";
import { addDays, base64Utf8, buildIcs, formatNy, isValidDate, nyLocalToUtc, nyToday } from "./dates.js";
import { buildEmailHtml, sendEmail } from "./email.js";
import { selName } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { getNextLoanId } from "./ids.js";
import { MAX_QTY, isAddonType, isQtyType, itemTypeInfoMap, loadQtyBookings, parseQtyMap, qtyAvailable, qtyLabel, requestWindow, typePhoto, typePhotos } from "./quantity.js";
import { emailSignature } from "./settings.js";
import { manageUrl } from "./manage.js";

// ─── Requests ─────────────────────────────────────────────────────────────────

async function itemTypeNameMap(db, ids, g) {
  const recs = await fetchByIds(db, T.ITEM_TYPES, ids, { g, fields: ["Name"] });
  return Object.fromEntries(recs.map(r => [r.id, r.fields.Name || r.id]));
}

async function handleGetRequests({ db, g, env }) {
  const reqs = await db.listAll(T.REQUESTS, {
    scope: g, where: [Q.eq("Status", "New")],
    sort: [{ field: "Received At", direction: "asc" }],
    fields: ["Request ID", "Name", "Phone", "Email", "Preferred Contact", "Items Requested", "Item Quantities", "Needed From", "Needed Until",
      "Open-ended duration", "Notes", "Received At", "Request Type", "Event Date", "Preferred Times", "Party Size", "Deposit Acknowledged", "Appointment At", "Test"],
  });
  const info = await itemTypeInfoMap(db, reqs.flatMap(r => r.fields["Items Requested"] || []), g);
  const qtyTypeIds = Object.keys(info).filter(id => info[id].qty);
  const bookings = qtyTypeIds.length ? await loadQtyBookings(db, g, qtyTypeIds) : {};
  const records = await Promise.all(reqs.map(async r => {
    const f = r.fields;
    const qmap = parseQtyMap(f["Item Quantities"]);
    const win = requestWindow(f);
    // One entry per requested type; quantity types say how many and how many are free for the dates.
    const items = (f["Items Requested"] || []).map(linkedId).filter(id => info[id]).map(id => {
      const t = info[id];
      if (t.addon) return { id, name: t.name, photo: t.photo, photos: t.photos, quantity: qmap[id] || 1, available: null, owned: null, addon: true, price: t.price };
      if (!t.qty) return { id, name: t.name, photo: t.photo, photos: t.photos, quantity: null, available: null, owned: null };
      return {
        id, name: t.name, photo: t.photo, photos: t.photos, quantity: qmap[id] || 1, owned: t.lendable,
        available: win ? qtyAvailable(t.lendable, bookings[id], win.from, win.to) : null,
      };
    });
    return {
      id: r.id,
      requestId: f["Request ID"],
      name: f["Name"],
      phone: f["Phone"],
      email: f["Email"] || null,
      preferredContact: f["Preferred Contact"] || null,
      itemNames: items.map(i => qtyLabel(i.name, i.quantity)),
      items,
      neededFrom: f["Needed From"] || null,
      neededUntil: f["Needed Until"] || null,
      openEnded: f["Open-ended duration"] || false,
      notes: f["Notes"] || null,
      receivedAt: f["Received At"],
      requestType: selName(f["Request Type"]) === "Appointment" ? "Appointment" : "Loan",
      eventDate: f["Event Date"] || null,
      preferredTimes: f["Preferred Times"] || null,
      partySize: f["Party Size"] ?? null,
      depositAcknowledged: !!f["Deposit Acknowledged"],
      appointmentAt: f["Appointment At"] || null,
      manageUrl: await manageUrl(env, r.id), // for the {manage_link} template placeholder
      ...(f["Test"] ? { test: true } : {}), // sent from the gemach's test link (testmode.js)
    };
  }));
  return json(records);
}

async function handleRequestDecision(c, id, kind) {
  const { db, g, env, ctx } = c;
  const body = await readJson(c.request);
  const { message, sendMessage, adminName } = body;
  const rec = await getOwned(db, T.REQUESTS, id, g);
  if (!rec) return json({ error: "Not found" }, 404);
  if (kind === "confirm" && selName(rec.fields["Request Type"]) === "Appointment") return confirmAppointment(c, rec, body);

  const fields = rec.fields;
  const itemIds = (fields["Items Requested"] || []).map(linkedId);
  const info = await itemTypeInfoMap(db, itemIds, g);
  // Quantities: what was asked for, optionally changed by the admin when confirming (body.quantities).
  const qtyMap = parseQtyMap(fields["Item Quantities"]);
  const override = body.quantities && typeof body.quantities === "object" && !Array.isArray(body.quantities) ? body.quantities : {};
  for (const id of itemIds) {
    if (!info[id]?.qty && !info[id]?.addon) { delete qtyMap[id]; continue; }
    if (override[id] != null && override[id] !== "") {
      const n = Number(override[id]);
      if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return json({ error: `Please enter how many ${info[id].name} (1 or more).` }, 400);
      qtyMap[id] = n;
    } else if (!qtyMap[id]) qtyMap[id] = 1;
  }
  const nameMap = Object.fromEntries(Object.entries(info).map(([id, t]) => [id, qtyLabel(t.name, qtyMap[id])]));
  const itemNames = itemIds.filter(i => nameMap[i]).map(i => nameMap[i]);

  // Confirming turns the request into one reservation per requested item type (only once:
  // a request that is already Converted never creates duplicates).
  let reservations = [];
  if (kind === "confirm" && fields["Status"] !== "Converted") {
    try {
      const addonIds = new Set(itemIds.filter(i => info[i]?.addon));
      reservations = await createReservationsFromRequest(c, rec, itemIds.filter(i => nameMap[i]), nameMap, qtyMap, addonIds);
    } catch (e) {
      console.error("Reservation creation failed:", e.message, JSON.stringify(e.detail || ""));
      return json({ error: "Could not create reservations: " + (e.message || "Airtable error") }, 500);
    }
  }

  const reqUpdate = { "Status": kind === "confirm" ? "Converted" : "Declined" };
  if (kind === "confirm" && Object.keys(qtyMap).length) reqUpdate["Item Quantities"] = JSON.stringify(qtyMap);
  await db.update(T.REQUESTS, id, reqUpdate);

  logEvent(ctx, db, g, {
    eventType: kind === "confirm" ? "Request Confirmed" : "Request Declined",
    borrower: fields["Name"] || null,
    itemType: itemNames.join(", ") || null,
    loanId: fields["Request ID"] || id,
    admin: c.adminName || adminName || null,
  });

  let emailSent;
  if (sendMessage && message && fields["Email"]) {
    emailSent = await sendEmail(env, g, {
      to: fields["Email"],
      subject: kind === "confirm" ? `Your ${g.name || "Gemach"} Request — Confirmed` : `Your ${g.name || "Gemach"} Request`,
      text: String(message) + emailSignature(g),
      html: buildEmailHtml(g, String(message), { signature: true }),
    });
    if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, kind === "confirm" ? "confirmation" : "decline", fields["Request ID"] || id));
  }
  return json({ success: true, reservations, ...(emailSent === false ? { emailSent: false } : {}) });
}

const APPT_AT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Confirm an Appointment request: store the time, no reservations, optional email + .ics. */
async function confirmAppointment(c, rec, body) {
  const { db, g, env, ctx } = c;
  const m = String(body.appointmentAt || "").match(APPT_AT_RE);
  if (!m || !isValidDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) {
    return json({ error: "Please choose an appointment date and time." }, 400);
  }
  const startMs = nyLocalToUtc(m[1], `${m[2]}:${m[3]}`);
  const appointmentAt = new Date(startMs).toISOString();
  const when = formatNy(startMs);
  const f = rec.fields;

  await db.update(T.REQUESTS, rec.id, { "Status": "Converted", "Appointment At": appointmentAt });
  const nameMap = await itemTypeNameMap(db, (f["Items Requested"] || []).map(linkedId), g);
  logEvent(ctx, db, g, {
    eventType: "Request Confirmed",
    borrower: f["Name"] || null,
    itemType: Object.values(nameMap).join(", ") || null,
    loanId: f["Request ID"] || rec.id,
    admin: c.adminName || body.adminName || null,
    notes: `Appointment ${when}`,
  });

  let emailSent;
  if (body.sendMessage && body.message && f["Email"]) {
    const title = `${g.name || "Gemach"} appointment`;
    const ics = buildIcs({
      uid: `${f["Request ID"] || rec.id}-${rec.id}@whgemachs.org`,
      startMs, durationMin: 60, title,
      description: `${title}${g.phone ? ` · ${g.phone}` : ""}${g.email ? ` · ${g.email}` : ""}`,
      location: g.pickupAddress || null,
    });
    emailSent = await sendEmail(env, g, {
      to: f["Email"],
      subject: `Your ${g.name || "Gemach"} Request — Confirmed`,
      text: String(body.message) + emailSignature(g),
      html: buildEmailHtml(g, String(body.message), { signature: true }),
      attachments: [{ filename: "appointment.ics", content: base64Utf8(ics) }],
    });
    if (emailSent === false) ctx.waitUntil(alertBorrowerEmailFailed(env, g, "appointment", f["Request ID"] || rec.id));
  }
  return json({ success: true, reservations: [], appointmentAt, ...(emailSent === false ? { emailSent: false } : {}) });
}

const PAST_APPT_DAYS = 14; // appointments this recent that nobody marked as visited stay listed ("Did they come?")

/**
 * Confirmed appointments still to deal with, soonest first: upcoming ones (from the start of today, New York)
 * plus ones from the last PAST_APPT_DAYS days with no Visit Outcome yet (past: true). Checked-out / closed
 * visits drop off.
 */
async function handleGetAppointments({ db, g, env }) {
  const t = nyToday();
  const todayStart = new Date(nyLocalToUtc(t, "00:00")).toISOString();
  const since = new Date(nyLocalToUtc(addDays(t, -PAST_APPT_DAYS), "00:00")).toISOString();
  const recs = await db.listAll(T.REQUESTS, {
    scope: g, where: [Q.eq("Request Type", "Appointment"), Q.ne("Status", "Declined"), Q.ne("Status", "Cancelled"), Q.notBlank("Appointment At"), Q.notBefore("Appointment At", since)],
    sort: [{ field: "Appointment At", direction: "asc" }],
    fields: ["Request ID", "Name", "Phone", "Email", "Preferred Contact", "Items Requested", "Appointment At", "Party Size", "Event Date", "Notes", "Status", "Visit Outcome"],
  });
  const nameMap = await itemTypeNameMap(db, recs.flatMap(r => r.fields["Items Requested"] || []), g);
  const details = await appointmentItemDetails(db, g, recs.filter(r => !String(r.fields["Visit Outcome"] || "").trim()).flatMap(r => (r.fields["Items Requested"] || []).map(linkedId)));
  const out = (await Promise.all(recs
    .filter(r => r.fields["Appointment At"] && r.fields["Appointment At"] >= since && !["Cancelled", "Declined"].includes(selName(r.fields.Status))
      && !String(r.fields["Visit Outcome"] || "").trim())
    .map(async r => {
      const f = r.fields;
      const ids = (f["Items Requested"] || []).map(linkedId).filter(id => nameMap[id]);
      return {
        id: r.id,
        requestId: f["Request ID"] || null,
        name: f["Name"] || null,
        phone: f["Phone"] || null,
        email: f["Email"] || null,
        preferredContact: f["Preferred Contact"] || null,
        itemNames: ids.map(id => nameMap[id]),
        itemTypeIds: ids,
        items: ids.map(id => details[id]).filter(Boolean), // photo, description, filters, rack numbers, on loan now
        appointmentAt: f["Appointment At"],
        past: f["Appointment At"] < todayStart,
        partySize: f["Party Size"] ?? null,
        eventDate: f["Event Date"] || null,
        notes: f["Notes"] || null,
        manageUrl: await manageUrl(env, r.id),
      };
    })))
    .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt));
  return json(out);
}

/**
 * What the owner needs to get requested items ready for an appointment — some clothing gemachs can only
 * identify a garment by its picture: { typeId: { id, name, description, photo, photos, attributes, tracking,
 * units: ["SD-014"], out: [{ itemId, borrower, dueBack }] } }. Few queries whatever the list size: the types,
 * their units (by id), open loans, and the borrowers of the loans that are out.
 */
async function appointmentItemDetails(db, g, typeIds) {
  const ids = [...new Set(typeIds)];
  if (!ids.length) return {};
  const types = (await fetchByIds(db, T.ITEM_TYPES, ids, { g, fields: ["Name", "Description", "Tracking", "Attributes", "Items", "R2 Photo URL", "More Photos", "Gemach"] }))
    .filter(r => belongs(r, g));
  const unitIds = types.flatMap(r => (r.fields["Items"] || []).map(linkedId));
  const [units, loans] = await Promise.all([
    fetchByIds(db, T.ITEMS, unitIds, { g, fields: ["Item ID", "Item Type", "Active", "Gemach"] }),
    unitIds.length ? db.listAll(T.LOANS, { scope: g, where: [Q.eq("Status", "Active")], fields: ["Item", "Borrower", "Status", "Expected Return", "Gemach"] }) : [],
  ]);
  const outByUnit = new Map(loans.filter(l => belongs(l, g) && selName(l.fields.Status) === "Active")
    .map(l => [linkedId(firstLink(l.fields["Item"])), l]).filter(([u]) => u));
  const borrowers = await fetchByIds(db, T.BORROWERS, [...outByUnit.values()].map(l => linkedId(firstLink(l.fields["Borrower"]))), { g, fields: ["Name"] });
  const bName = Object.fromEntries(borrowers.map(b => [b.id, b.fields.Name || null]));
  const unitsByType = {};
  for (const u of units) {
    if (!belongs(u, g) || !u.fields.Active) continue;
    (unitsByType[linkedId(firstLink(u.fields["Item Type"]))] ||= []).push(u);
  }
  const out = {};
  for (const r of types) {
    const list = (unitsByType[r.id] || []).sort((a, b) => String(a.fields["Item ID"] || "").localeCompare(String(b.fields["Item ID"] || ""), undefined, { numeric: true }));
    out[r.id] = {
      id: r.id,
      name: r.fields.Name || "",
      description: String(r.fields.Description || "").trim() || null,
      photo: typePhoto(r),
      photos: typePhotos(r),
      attributes: itemAttrsFor(r.fields["Attributes"], g.itemAttributes),
      tracking: isAddonType(r) ? "Add-on" : isQtyType(r) ? "Quantity" : "Units",
      units: list.map(u => u.fields["Item ID"] || "").filter(Boolean),
      out: list.filter(u => outByUnit.has(u.id)).map(u => {
        const l = outByUnit.get(u.id);
        return { itemId: u.fields["Item ID"] || null, borrower: bName[linkedId(firstLink(l.fields["Borrower"]))] || linkedName(firstLink(l.fields["Borrower"])) || null, dueBack: l.fields["Expected Return"] || null };
      }),
    };
  }
  return out;
}

async function createReservationsFromRequest(c, rec, typeIds, nameMap, qtyMap = {}, addonIds = new Set()) {
  const { db, g, ctx } = c;
  if (!typeIds.length) return [];
  const f = rec.fields;
  const borrowerId = await findOrCreateBorrower(db, g, {
    name: f["Name"] || "Unknown",
    phone: f["Phone"] || null,
    email: f["Email"] || null,
    preferredContact: f["Preferred Contact"] || null,
  });
  const start = DATE_RE.test(f["Needed From"] || "") ? f["Needed From"] : today();
  const end = !f["Open-ended duration"] && DATE_RE.test(f["Needed Until"] || "") ? f["Needed Until"] : null;

  // Sequential Loan IDs: read the current max once, then count up.
  const first = await getNextLoanId(db);
  const base = parseInt(first.slice(2), 10);
  const created = [];
  for (let i = 0; i < typeIds.length; i++) {
    const loanId = `L-${String(base + i).padStart(3, "0")}`;
    const fields = {
      "Loan ID": loanId,
      "Borrower": [borrowerId],
      "Item to Reserve": [typeIds[i]],
      "Status": "Reserved",
      "Reservation Start": start,
      "Source Request": [rec.id],
      "Gemach": [g.id],
    };
    if (end) fields["Reservation End"] = end;
    if (qtyMap[typeIds[i]]) fields["Quantity"] = qtyMap[typeIds[i]];
    const data = await db.create(T.LOANS, fields);
    created.push({ id: data.id, loanId, itemTypeName: nameMap[typeIds[i]] || null, quantity: qtyMap[typeIds[i]] || null });
    logEvent(ctx, db, g, {
      eventType: addonIds.has(typeIds[i]) ? "Add-on Ordered" : "Item Reserved",
      itemType: nameMap[typeIds[i]] || null,
      borrower: f["Name"] || null,
      loanId,
      admin: c.adminName || null,
      notes: `From request ${f["Request ID"] || rec.id}`,
    });
  }
  return created;
}

export { itemTypeNameMap, handleGetRequests, handleRequestDecision, APPT_AT_RE, confirmAppointment, handleGetAppointments, createReservationsFromRequest };
