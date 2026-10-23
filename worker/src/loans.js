// Part of the Gemach Network worker (see index.js for routes and env vars).
import { logEvent } from "./activity.js";
import { AirtableError, Q, fetchByIds, firstLink, getOwned, linkedId, linkedName, today } from "./airtable.js";
import { findOrCreateBorrower } from "./borrowers.js";
import { cleanCityState } from "./places.js";
import { DATE_RE, T } from "./config.js";
import { selName } from "./gemachs.js";
import { isValidDate } from "./dates.js";
import { json, readJson } from "./http.js";
import { getNextLoanId } from "./ids.js";
import { MAX_QTY, isAddonType, isQtyType, itemTypeInfoMap, loanQty, wholeNum } from "./quantity.js";
import { itemTypeNameMap } from "./requests.js";
import { manageUrl } from "./manage.js";
import { buildEmailHtml, sendEmail } from "./email.js";
import { emailSignature } from "./settings.js";

// ─── Loans / reservations shared lookups ──────────────────────────────────────

const BORROWER_FIELDS = ["Name", "Phone", "Email", "Preferred Contact", "City", "State"]; // what borrowerInfo reads
// What the Loans / Reservations lists read from each loan (incl. loanQtyInfo and the manage link).
const LOAN_LIST_FIELDS = ["Loan ID", "Item", "Item to Reserve", "Borrower", "Status", "Quantity", "Date Borrowed", "Expected Return",
  "Reservation Start", "Reservation End", "Notes", "Request Note", "Ready To Return At", "Reminder Sent At", "Reminder Sent Via", "Source Request"];

function borrowerInfo(r) {
  return {
    name: r.fields["Name"] || null,
    phone: r.fields["Phone"] || null,
    email: r.fields["Email"] || null,
    preferredContact: r.fields["Preferred Contact"] || null,
    city: r.fields["City"] || null, state: r.fields["State"] || null,
  };
}

// What the Loans / Reservations lists show about the request a loan came from (the request card's details).
const SOURCE_REQUEST_FIELDS = ["Request ID", "Received At", "Source", "Test", "Event Date", "Deposit Acknowledged", "Town", "State", "Payment Tier"];

/** Source request record id → the request-card details shown on a booking (one batched read). */
async function sourceRequestMap(db, g, loans) {
  const ids = loans.map(l => linkedId(firstLink(l.fields["Source Request"]))).filter(Boolean);
  const recs = await fetchByIds(db, T.REQUESTS, ids, { g, fields: SOURCE_REQUEST_FIELDS });
  return Object.fromEntries(recs.map(r => {
    const f = r.fields;
    return [r.id, {
      requestId: f["Request ID"] || null,
      receivedAt: f["Received At"] || null,
      source: f["Source"] || null, // "Admin" = made in admin (New reservation / appointment); blank = the public form
      eventDate: f["Event Date"] || null,
      depositAcknowledged: !!f["Deposit Acknowledged"],
      town: f["Town"] || null, state: f["State"] || null,
      paymentTier: ["Local", "Standard"].includes(f["Payment Tier"]) ? f["Payment Tier"] : null,
      ...(f["Test"] ? { test: true } : {}),
    }];
  }));
}

/** The booking a loan belongs to: its source request's id and details (both null for walk-ins / Inventory assigns). */
function requestFields(f, reqMap) {
  const id = linkedId(firstLink(f["Source Request"])) || null;
  return { requestRecId: id, request: (id && reqMap[id]) || null };
}

/** Given loan records, batch-load borrowers, items, and item type names (all scoped). */
async function loadLoanRelations(db, g, loans, { includeItemToReserve = false } = {}) {
  const borrowerIds = loans.map(l => linkedId(firstLink(l.fields["Borrower"]))).filter(Boolean);
  const itemIds = loans.map(l => linkedId(firstLink(l.fields["Item"]))).filter(Boolean);
  const [borrowers, items] = await Promise.all([
    fetchByIds(db, T.BORROWERS, borrowerIds, { g, fields: BORROWER_FIELDS }),
    fetchByIds(db, T.ITEMS, itemIds, { g, fields: ["Item ID", "Item Type", "Gemach"] }),
  ]);
  const borrowerMap = Object.fromEntries(borrowers.map(r => [r.id, borrowerInfo(r)]));

  const typeIds = items.map(r => linkedId(firstLink(r.fields["Item Type"]))).filter(Boolean);
  if (includeItemToReserve) loans.forEach(l => { const id = linkedId(firstLink(l.fields["Item to Reserve"])); if (id) typeIds.push(id); });
  const typeInfo = await itemTypeInfoMap(db, typeIds, g);
  const itemTypeMap = Object.fromEntries(Object.entries(typeInfo).map(([id, t]) => [id, t.name]));

  const itemMap = {};
  items.forEach(r => {
    const itRaw = firstLink(r.fields["Item Type"]);
    itemMap[r.id] = {
      itemId: r.fields["Item ID"] || null,
      itemTypeId: linkedId(itRaw) || null,
      itemTypeName: linkedName(itRaw) || itemTypeMap[linkedId(itRaw)] || null,
    };
  });
  return { borrowerMap, itemMap, itemTypeMap, typeInfo };
}

/** Quantity fields for a loan row: { isQuantity, quantity } (quantity null for unit loans). */
function loanQtyInfo(f, typeInfo) {
  const t = typeInfo[linkedId(firstLink(f["Item to Reserve"]))];
  const noUnit = !(f["Item"] || []).length;
  const isAddon = !!t?.addon && noUnit;
  const isQuantity = !!t?.qty && noUnit;
  return { isQuantity, isAddon, price: isAddon ? t.price : null, quantity: isQuantity || isAddon ? loanQty(f) : null };
}

async function handleGetLoans({ db, g, env }) {
  const loans = await db.listAll(T.LOANS, {
    scope: g, where: [Q.eq("Status", "Active")],
    sort: [{ field: "Date Borrowed", direction: "asc" }],
    fields: LOAN_LIST_FIELDS,
  });
  const [{ borrowerMap, itemMap, itemTypeMap, typeInfo }, reqMap] = await Promise.all([
    loadLoanRelations(db, g, loans, { includeItemToReserve: true }),
    sourceRequestMap(db, g, loans),
  ]);
  const now = new Date();
  const t = today();

  const records = await Promise.all(loans.map(async r => {
    const f = r.fields;
    const borrowed = f["Date Borrowed"];
    const q = loanQtyInfo(f, typeInfo);
    const expectedReturn = f["Expected Return"] || (q.isQuantity ? f["Reservation End"] || null : null);
    const daysDiff = borrowed ? Math.floor((now - new Date(borrowed)) / 86400000) : null;
    const bRaw = firstLink(f["Borrower"]);
    const iRaw = firstLink(f["Item"]);
    const borrower = borrowerMap[linkedId(bRaw)] || {};
    const item = itemMap[linkedId(iRaw)] || {};
    return {
      id: r.id,
      loanId: f["Loan ID"],
      itemId: item.itemId || linkedName(iRaw) || null,
      itemTypeName: item.itemTypeName || itemTypeMap[linkedId(firstLink(f["Item to Reserve"]))] || null,
      itemTypeId: item.itemTypeId || linkedId(firstLink(f["Item to Reserve"])) || null,
      photo: typeInfo[item.itemTypeId || linkedId(firstLink(f["Item to Reserve"]))]?.photo || null,
      photos: typeInfo[item.itemTypeId || linkedId(firstLink(f["Item to Reserve"]))]?.photos || [],
      isQuantity: q.isQuantity,
      quantity: q.quantity,
      borrowerName: borrower.name || linkedName(bRaw) || "Unknown",
      borrowerPhone: borrower.phone || null,
      borrowerEmail: borrower.email || null,
      borrowerContact: borrower.preferredContact || null,
      borrowerCity: borrower.city || null, borrowerState: borrower.state || null,
      dateBorrowed: borrowed || null,
      expectedReturn,
      daysOut: daysDiff,
      overdue: expectedReturn ? t > expectedReturn : (daysDiff > 14),
      notes: f["Notes"] || null,
      requestNote: (f["Request Note"] || []).join("") || null,
      readyToReturnAt: f["Ready To Return At"] || null, // borrower tapped "Ready to return" on their manage page
      reminderSentAt: f["Reminder Sent At"] || null,     // last "time to return" reminder (manual or automatic)
      reminderSentVia: f["Reminder Sent Via"] || null,
      manageUrl: await sourceManageUrl(env, f),
      ...requestFields(f, reqMap),
    };
  }));
  return json(records);
}

/** The borrower's manage link for a loan made from a request (null for loans created in admin). */
const sourceManageUrl = (env, f) => {
  const src = linkedId(firstLink(f["Source Request"]));
  return src ? manageUrl(env, src) : null;
};

/**
 * History details for a loan, derived from the loan record itself (Borrower, Item, Item to Reserve, Loan ID);
 * request-body values are only a fallback. itemRecId overrides the linked item (pickup assigns a unit).
 */
async function loanLogDetails(db, g, loan, body = {}, { itemRecId = null } = {}) {
  const f = loan?.fields || {};
  const bId = linkedId(firstLink(f["Borrower"]));
  const iId = itemRecId || linkedId(firstLink(f["Item"]));
  const tId = linkedId(firstLink(f["Item to Reserve"]));
  const [borrowers, items] = await Promise.all([
    bId ? fetchByIds(db, T.BORROWERS, [bId], { g, fields: ["Name"] }) : [],
    iId ? fetchByIds(db, T.ITEMS, [iId], { g, fields: ["Item ID", "Item Type"] }) : [],
  ]);
  const item = items[0];
  const typeId = linkedId(firstLink(item?.fields?.["Item Type"])) || tId;
  const typeNames = typeId ? await itemTypeNameMap(db, [typeId], g) : {};
  const str = v => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  return {
    borrower: borrowers[0]?.fields?.Name || linkedName(firstLink(f["Borrower"])) || str(body.borrower),
    itemCode: item?.fields?.["Item ID"] || str(body.itemCode),
    itemType: typeNames[typeId] || linkedName(firstLink(f["Item to Reserve"])) || str(body.itemType),
    loanId: f["Loan ID"] || str(body.loanId),
  };
}

const MAX_MESSAGE = 5000;

/** "Wheelchair" / "Folding Chair × 40" for a loan. */
async function loanItemLabel(db, g, loan) {
  const d = await loanLogDetails(db, g, loan, {});
  const q = loanQty(loan.fields);
  return (d.itemType || "item") + (!(loan.fields["Item"] || []).length && q > 1 ? ` × ${q}` : "");
}

/** Email the loan's borrower an admin-written message (the borrower's address comes from Airtable, never the request). */
async function emailBorrower(c, loan, message, subject) {
  const { db, g, env } = c;
  const text = String(message ?? "").trim();
  if (!text) return { error: "Write a message first.", status: 400 };
  if (text.length > MAX_MESSAGE) return { error: "That message is too long.", status: 400 };
  const bId = linkedId(firstLink(loan.fields["Borrower"]));
  const [b] = bId ? await fetchByIds(db, T.BORROWERS, [bId], { g, fields: ["Email"] }) : [];
  const to = String(b?.fields?.Email || "").trim();
  if (!to) return { error: "This borrower has no email address.", status: 400 };
  const ok = await sendEmail(env, g, { to, subject, text: text + emailSignature(g), html: buildEmailHtml(g, text, { signature: true }) });
  if (!ok) return { error: "The email didn't go through. Try again, or send it by WhatsApp or text.", status: 422 }; // the admin sees it right away; not a server error
  return { ok: true, to };
}

/** POST /admin/loans/:id/pickup-email — email the pickup details (admin-edited) to the borrower of a reservation. */
async function handlePickupEmail(c, id) {
  const { db, g } = c;
  const body = await readJson(c.request);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
  if (!["Reserved", "Active"].includes(selName(loan.fields.Status))) return json({ error: "This reservation isn't open any more." }, 409);
  const sent = await emailBorrower(c, loan, body.message, `Pickup details — ${g.name || "Gemach"}`);
  if (sent.error) return json({ error: sent.error }, sent.status);
  return json({ success: true });
}

/** An admin sent a "time to return" reminder (email from us, or WhatsApp / text from their phone): stamp the loan and log it. */
async function handleLoanReminder(c, id) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
  if (selName(loan.fields.Status) !== "Active") return json({ error: "This loan isn't out right now." }, 409);
  const via = { whatsapp: "WhatsApp", sms: "text message", email: "email" }[body.via] || null;
  // Email is sent by us (branded, from noreply, replies to the gemach); WhatsApp / text are sent from the admin's phone.
  if (body.via === "email") {
    const sent = await emailBorrower(c, loan, body.message, `Reminder: please return the ${await loanItemLabel(db, g, loan)} — ${g.name || "Gemach"}`);
    if (sent.error) return json({ error: sent.error }, sent.status);
  }
  // WhatsApp / text from the admin's phone: the same message is also emailed, as the borrower's record (when they have an address).
  let emailSent;
  if ((body.via === "whatsapp" || body.via === "sms") && body.emailCopy === true && String(body.message ?? "").trim()) {
    const sent = await emailBorrower(c, loan, body.message, `Reminder: please return the ${await loanItemLabel(db, g, loan)} — ${g.name || "Gemach"}`);
    if (sent.ok) emailSent = true;
    else if (sent.status === 422) emailSent = false;    // no address or empty message: nothing to copy
  }
  const now = new Date().toISOString();
  await db.update(T.LOANS, id, { "Reminder Sent At": now, ...(via ? { "Reminder Sent Via": via } : {}) });
  logEvent(ctx, db, g, {
    eventType: "Return Reminder Sent",
    ...(await loanLogDetails(db, g, loan, body)),
    admin: c.adminName || null,
    notes: via ? `Sent by ${via}${emailSent ? " (copy emailed)" : ""}` : null,
  });
  return json({ success: true, reminderSentAt: now, reminderSentVia: via, ...(emailSent !== undefined ? { emailSent } : {}) });
}

async function handleReturnLoan(c, id) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
  if (selName(loan.fields.Status) !== "Active") return wrongLoanState(loan, "mark it returned");
  const returnDate = DATE_RE.test(body.returnDate || "") ? body.returnDate : today();
  const fields = { "Status": "Returned", "Date Returned": returnDate };

  // Quantity loans: how many came back (default: all). Optionally take the missing ones out of inventory.
  const typeRec = await qtyTypeForLoan(db, g, loan);
  let notes = null, missing = 0;
  if (typeRec) {
    const q = loanQty(loan.fields);
    let back = q;
    if (body.quantityReturned != null && body.quantityReturned !== "") {
      back = Number(body.quantityReturned);
      if (!Number.isInteger(back) || back < 0 || back > q) return json({ error: `How many came back? Enter a number from 0 to ${q}.` }, 400);
    }
    missing = q - back;
    fields["Quantity Returned"] = back;
    notes = missing ? `${back} of ${q} returned — ${missing} missing` : `All ${q} returned`;
  }
  // Only the call that moves the loan from Active to Returned goes on (a double tap can't count it twice).
  if (!(await db.updateIf(T.LOANS, id, [Q.eq("Status", "Active")], fields))) return wrongLoanState((await db.get(T.LOANS, id)) || loan, "mark it returned");
  if (typeRec && missing && body.reduceOwned === true) {
    // Missing pieces gone for good: take them out of the count owned.
    const owned = wholeNum(typeRec.fields["Quantity Owned"]);
    const next = Math.max(0, owned - missing);
    const oos = wholeNum(typeRec.fields["Out of Service"]);
    await db.update(T.ITEM_TYPES, typeRec.id, { "Quantity Owned": next, ...(oos > next ? { "Out of Service": next } : {}) });
    notes += `; ${typeRec.fields.Name || "item"} owned ${owned} → ${next}`;
  }

  // "Item returned" message (Settings → Message templates): emailed by us when Email was chosen, or as the
  // email copy of a WhatsApp / text sent from the admin's phone. The return stands even if the email fails.
  let emailSent, emailError;
  const via = { whatsapp: "WhatsApp", sms: "text message", email: "email" }[body.via] || null;
  if ((body.via === "email" || ((body.via === "whatsapp" || body.via === "sms") && body.emailCopy === true)) && String(body.message ?? "").trim()) {
    const sent = await emailBorrower(c, loan, body.message, `Thank you for returning the ${await loanItemLabel(db, g, loan)} — ${g.name || "Gemach"}`);
    emailSent = !!sent.ok;
    if (!sent.ok) emailError = sent.error;
  }
  const sentNote = via ? `Thank-you sent by ${via}${body.via !== "email" && emailSent ? " (copy emailed)" : ""}${body.via === "email" && !emailSent ? " — email failed" : ""}` : null;

  logEvent(ctx, db, g, {
    eventType: "Item Returned",
    ...(await loanLogDetails(db, g, loan, body)),
    admin: c.adminName || body.adminName || null,
    notes: [notes, sentNote].filter(Boolean).join("; ") || null,
  });
  return json({ success: true, ...(typeRec ? { missing } : {}), ...(emailSent !== undefined ? { emailSent } : {}), ...(emailError ? { emailError } : {}) });
}

/** 409 when a loan isn't in the state an action needs (already returned, cancelled, picked up…). */
function wrongLoanState(loan, action) {
  const st = selName(loan.fields.Status) || "unknown";
  const now = st === "Active" ? "already out on loan" : st === "Reserved" ? "still a reservation (not picked up)" : st === "Returned" ? "already returned" : st === "Cancelled" ? "cancelled" : `marked ${st}`;
  return json({ error: `Can't ${action}: this loan is ${now}. Refresh to see the latest.`, current: st }, 409);
}

/** The loan's item type record when it's an add-on order (add-on type, no unit linked), else null. */
async function addonTypeForLoan(db, g, loan) {
  if ((loan.fields["Item"] || []).length) return null;
  const typeId = linkedId(firstLink(loan.fields["Item to Reserve"]));
  const rec = typeId ? await getOwned(db, T.ITEM_TYPES, typeId, g) : null;
  return isAddonType(rec) ? rec : null;
}

/** The loan's item type record when it's a quantity loan (quantity type, no unit linked), else null. */
async function qtyTypeForLoan(db, g, loan) {
  if ((loan.fields["Item"] || []).length) return null;
  const typeId = linkedId(firstLink(loan.fields["Item to Reserve"]));
  const rec = typeId ? await getOwned(db, T.ITEM_TYPES, typeId, g) : null;
  return isQtyType(rec) ? rec : null;
}

async function handleMarkPickedUp(c, id) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
  if (selName(loan.fields.Status) !== "Reserved") return wrongLoanState(loan, "mark it picked up");
  // Add-on order (made to order, for purchase): handing it over completes it — it never goes "out on loan".
  const addonRec = await addonTypeForLoan(db, g, loan);
  if (addonRec) {
    let n = loanQty(loan.fields);
    if (body.quantity != null && body.quantity !== "") {
      n = Number(body.quantity);
      if (!Number.isInteger(n) || n < 1 || n > 500) return json({ error: "How many are being handed over? Enter 1 or more." }, 400);
    }
    const day = DATE_RE.test(body.pickupDate || "") ? body.pickupDate : today();
    if (!(await db.updateIf(T.LOANS, id, [Q.eq("Status", "Reserved")], { "Status": "Returned", "Quantity": n, "Date Borrowed": day, "Date Returned": day }))) {
      return wrongLoanState((await db.get(T.LOANS, id)) || loan, "mark it handed over");
    }
    logEvent(ctx, db, g, {
      eventType: "Add-on Handed Over",
      ...(await loanLogDetails(db, g, loan, body)),
      admin: c.adminName || body.adminName || null,
      notes: `Handed over ${n}`,
    });
    return json({ success: true, handedOver: true });
  }
  const typeRec = await qtyTypeForLoan(db, g, loan);
  const fields = {
    "Status": "Active",
    "Date Borrowed": DATE_RE.test(body.pickupDate || "") ? body.pickupDate : today(),
  };
  let notes = "Picked up / activated from reservation";
  if (typeRec) {
    // Quantity loan: no unit to choose; the count taken can differ from what was reserved.
    let n = loanQty(loan.fields);
    if (body.quantity != null && body.quantity !== "") {
      n = Number(body.quantity);
      if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return json({ error: "How many are being picked up? Enter 1 or more." }, 400);
    }
    fields["Quantity"] = n;
    if (!loan.fields["Expected Return"] && isValidDate(loan.fields["Reservation End"])) fields["Expected Return"] = loan.fields["Reservation End"];
    notes = `Picked up ${n}`;
  } else {
    const unitId = body.itemId || linkedId(firstLink(loan.fields["Item"]));
    if (!unitId) return json({ error: "Choose which item is being picked up." }, 400);
    const unit = await getOwned(db, T.ITEMS, unitId, g);
    if (!unit) return json({ error: "Item not found" }, 404);
    const typeId = linkedId(firstLink(loan.fields["Item to Reserve"]));
    if (typeId && linkedId(firstLink(unit.fields["Item Type"])) !== typeId) return json({ error: "That unit isn't the item that was reserved. Choose one of the reserved item's units." }, 400);
    if (!unit.fields.Active) return json({ error: `${unit.fields["Item ID"] || "That unit"} is marked inactive.` }, 409);
    const out = await db.listAll(T.LOANS, { scope: g, where: [Q.eq("Status", "Active"), Q.linksTo("Item", unitId, unit.fields["Item ID"] || "")], fields: ["Loan ID", "Item"] });
    if (out.some(l => l.id !== id && linkedId(firstLink(l.fields["Item"])) === unitId)) return json({ error: `${unit.fields["Item ID"] || "That unit"} is already out on loan (${out[0].fields["Loan ID"] || "another loan"}). Choose another, or mark that one returned first.` }, 409);
    if (body.itemId) fields["Item"] = [body.itemId];
  }
  // Due back = the reservation's end date when nothing else was set (reminders and "overdue" need one).
  if (!loan.fields["Expected Return"] && !fields["Expected Return"] && isValidDate(loan.fields["Reservation End"])) fields["Expected Return"] = loan.fields["Reservation End"];
  if (!(await db.updateIf(T.LOANS, id, [Q.eq("Status", "Reserved")], fields))) return wrongLoanState((await db.get(T.LOANS, id)) || loan, "mark it picked up");

  logEvent(ctx, db, g, {
    eventType: "Loan Created",
    ...(await loanLogDetails(db, g, loan, body, { itemRecId: typeRec ? null : body.itemId || null })),
    admin: c.adminName || body.adminName || null,
    notes,
  });
  return json({ success: true });
}

async function handleGetReservations({ db, g, env }) {
  const loans = await db.listAll(T.LOANS, {
    scope: g, where: [Q.eq("Status", "Reserved")],
    sort: [{ field: "Reservation Start", direction: "asc" }],
    fields: LOAN_LIST_FIELDS,
  });
  return json(await reservationRecords(db, g, env, loans));
}

/** Reserved loans → the rows the Reservations list (and Dashboard "Upcoming") show and act on. */
async function reservationRecords(db, g, env, loans) {
  const [{ borrowerMap, itemMap, itemTypeMap, typeInfo }, reqMap] = await Promise.all([
    loadLoanRelations(db, g, loans, { includeItemToReserve: true }),
    sourceRequestMap(db, g, loans),
  ]);

  return Promise.all(loans.map(async r => {
    const f = r.fields;
    const q = loanQtyInfo(f, typeInfo);
    const bRaw = firstLink(f["Borrower"]);
    const iRaw = firstLink(f["Item"]);
    const itRaw = firstLink(f["Item to Reserve"]);
    const borrower = borrowerMap[linkedId(bRaw)] || {};
    const item = itemMap[linkedId(iRaw)] || {};
    return {
      id: r.id,
      loanId: f["Loan ID"],
      borrowerName: borrower.name || linkedName(bRaw) || "Unknown",
      borrowerPhone: borrower.phone || null,
      borrowerEmail: borrower.email || null,
      borrowerContact: borrower.preferredContact || null,
      borrowerCity: borrower.city || null, borrowerState: borrower.state || null,
      itemTypeName: item.itemTypeName || itemTypeMap[linkedId(itRaw)] || linkedName(itRaw) || linkedName(iRaw) || "Unknown",
      itemId: item.itemId || null,
      itemRecId: linkedId(iRaw) || null,
      itemTypeId: item.itemTypeId || linkedId(itRaw) || null,
      photo: typeInfo[item.itemTypeId || linkedId(itRaw)]?.photo || null,
      photos: typeInfo[item.itemTypeId || linkedId(itRaw)]?.photos || [],
      isQuantity: q.isQuantity,
      isAddon: q.isAddon,
      price: q.price,
      quantity: q.quantity,
      reservationStart: f["Reservation Start"] || null,
      reservationEnd: f["Reservation End"] || null,
      notes: f["Notes"] || null,
      requestNote: (f["Request Note"] || []).join("") || null,
      manageUrl: await sourceManageUrl(env, f),
      ...requestFields(f, reqMap),
    };
  }));
}

async function handleUpdateReservation(c, id) {
  const { db, g } = c;
  const body = await readJson(c.request);
  if (!(await getOwned(db, T.LOANS, id, g))) return json({ error: "Not found" }, 404);
  const fields = {};
  if (body.reservationStart !== undefined) fields["Reservation Start"] = body.reservationStart || null;
  if (body.reservationEnd   !== undefined) fields["Reservation End"]   = body.reservationEnd   || null;
  if (body.notes            !== undefined) fields["Notes"]             = body.notes             || null;
  if (body.quantity !== undefined && body.quantity !== null && body.quantity !== "") {
    const n = Number(body.quantity);
    if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) return json({ error: "Quantity must be 1 or more." }, 400);
    fields["Quantity"] = n;
  }
  try {
    return json(await db.update(T.LOANS, id, fields));
  } catch (e) {
    if (e instanceof AirtableError) return json(e.detail || { error: e.message }, 500);
    throw e;
  }
}

async function handleCancelReservation(c, id) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
  if (selName(loan.fields.Status) !== "Reserved") return wrongLoanState(loan, "cancel it");
  let data;
  try {
    if (!(await db.updateIf(T.LOANS, id, [Q.eq("Status", "Reserved")], { "Status": "Cancelled" }))) return wrongLoanState((await db.get(T.LOANS, id)) || loan, "cancel it");
    data = await db.get(T.LOANS, id);
  } catch (e) {
    if (e instanceof AirtableError) return json(e.detail || { error: e.message }, 500);
    throw e;
  }
  logEvent(ctx, db, g, {
    eventType: "Reservation Cancelled",
    ...(await loanLogDetails(db, g, loan, body)),
    admin: c.adminName || body.adminName || null,
  });
  return json(data);
}


// ─── Assign item ──────────────────────────────────────────────────────────────

async function handleAssignItem(c, itemRecId) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const { status, borrowerName, borrowerPhone, borrowerEmail, borrowerContact, borrowerCity, borrowerState,
          dateBorrowed, reservationStart, reservationEnd, notes, existingLoanId } = body;
  const hasExpected = Object.prototype.hasOwnProperty.call(body, "expectedReturn");
  const expectedReturn = hasExpected && body.expectedReturn ? String(body.expectedReturn) : null;
  const admin = c.adminName || body.adminName || null;

  const [item, existingLoan] = await Promise.all([
    getOwned(db, T.ITEMS, itemRecId, g),
    existingLoanId ? getOwned(db, T.LOANS, existingLoanId, g) : Promise.resolve(null),
  ]);
  if (!item) return json({ error: "Item not found" }, 404);
  if (existingLoanId && !existingLoan) return json({ error: "Loan not found" }, 404);
  // NOTE: Items.Status is a formula field (READ ONLY) — never PATCH it.

  if (status === "Needs Repair") {
    try {
      const data = await db.update(T.ITEMS, itemRecId, { "Condition": "Needs Repair" });
      logEvent(ctx, db, g, { eventType: "Marked for Repair", itemCode: body.itemCode || null, itemType: body.itemType || null, admin });
      return json({ success: true, data });
    } catch (e) {
      if (e instanceof AirtableError) return json({ success: false, data: e.detail }, 500);
      throw e;
    }
  }

  if (status === "Available") {
    const t = today();
    if (existingLoanId) {
      await db.update(T.LOANS, existingLoanId, { "Status": "Returned", "Date Returned": t });
    } else {
      // Fallback: find this gemach's active/reserved loans linked to this item and close them.
      const loans = await db.listAll(T.LOANS, {
        scope: g, where: [Q.in("Status", ["Active", "Reserved"])],
        fields: ["Item", "Status"],
      });
      const mine = loans.filter(l => (l.fields["Item"] || []).map(linkedId).includes(itemRecId));
      // Out on loan → returned; a reservation that never went out → cancelled (not a phantom return).
      await Promise.all(mine.map(l => db.update(T.LOANS, l.id, selName(l.fields.Status) === "Reserved" ? { "Status": "Cancelled" } : { "Status": "Returned", "Date Returned": t })));
    }
    await db.update(T.ITEMS, itemRecId, { "Condition": "Good" });
    logEvent(ctx, db, g, {
      eventType: "Item Returned",
      itemCode: body.itemCode || null,
      itemType: body.itemType || null,
      loanId: body.existingLoanLabel || null,
      admin,
      notes: "Marked available",
    });
    return json({ success: true });
  }

  if (!borrowerName) return json({ error: "Borrower name required" }, 400);
  const place = cleanCityState(borrowerCity, borrowerState); // optional
  if (place.error) return json({ error: place.error }, 400);
  // Projected return date (On Loan only; optional). Must be a real date, not before the day it went out.
  if (status === "On Loan" && expectedReturn) {
    if (!isValidDate(expectedReturn)) return json({ error: "Choose a valid expected return date." }, 400);
    const out = isValidDate(dateBorrowed || "") ? dateBorrowed : today();
    if (expectedReturn < out) return json({ error: "The expected return date is before the date borrowed." }, 400);
  }

  let borrowerId;
  try {
    borrowerId = await findOrCreateBorrower(db, g, { name: borrowerName, phone: borrowerPhone, email: borrowerEmail, preferredContact: borrowerContact, city: place.city, state: place.state });
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }

  if (existingLoanId) {
    const updateFields = { "Borrower": [borrowerId], "Status": status === "Reserved" ? "Reserved" : "Active" };
    if (notes) updateFields["Notes"] = notes;
    if (status === "On Loan") {
      updateFields["Date Borrowed"] = dateBorrowed || today();
      if (hasExpected) updateFields["Expected Return"] = expectedReturn; // blank clears it
    }
    if (status === "Reserved") {
      if (reservationStart) updateFields["Reservation Start"] = reservationStart;
      if (reservationEnd)   updateFields["Reservation End"]   = reservationEnd;
    }
    let loanData, ok = true;
    try { loanData = await db.update(T.LOANS, existingLoanId, updateFields); }
    catch (e) { if (!(e instanceof AirtableError)) throw e; ok = false; loanData = e.detail; }
    const label = loanData?.fields?.["Loan ID"] || existingLoan.fields["Loan ID"] || existingLoanId;
    if (ok) {
      logEvent(ctx, db, g, {
        eventType: status === "Reserved" ? "Item Reserved" : "Loan Created",
        itemCode: body.itemCode || null, itemType: body.itemType || null,
        borrower: borrowerName, loanId: label, admin, notes: "Updated existing loan",
      });
    }
    return json({ success: ok, loanId: label, data: loanData }, ok ? 200 : 500);
  }

  const loanId = await getNextLoanId(db);
  const loanFields = {
    "Loan ID": loanId,
    "Borrower": [borrowerId],
    "Item": [itemRecId],
    "Status": status === "Reserved" ? "Reserved" : "Active",
    "Gemach": [g.id],
  };
  if (notes) loanFields["Notes"] = notes;
  if (status === "On Loan") {
    loanFields["Date Borrowed"] = dateBorrowed || today();
    if (expectedReturn) loanFields["Expected Return"] = expectedReturn;
  }
  if (status === "Reserved") {
    if (reservationStart) loanFields["Reservation Start"] = reservationStart;
    if (reservationEnd)   loanFields["Reservation End"]   = reservationEnd;
  }

  let loanData;
  try {
    loanData = await db.create(T.LOANS, loanFields);
  } catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Loan creation failed. Fields:", JSON.stringify(loanFields), "Response:", JSON.stringify(e.detail));
    return json({ success: false, error: e.message || "Airtable error", detail: e.detail }, 500);
  }

  logEvent(ctx, db, g, {
    eventType: status === "Reserved" ? "Item Reserved" : "Loan Created",
    itemCode: body.itemCode || null, itemType: body.itemType || null,
    borrower: borrowerName, loanId, admin,
  });
  return json({ success: true, loanId, data: loanData });
}

export { reservationRecords, handlePickupEmail, handleLoanReminder, borrowerInfo, loadLoanRelations, loanQtyInfo, handleGetLoans, loanLogDetails, handleReturnLoan, qtyTypeForLoan, handleMarkPickedUp, handleGetReservations, handleUpdateReservation, handleCancelReservation, handleAssignItem, BORROWER_FIELDS, LOAN_LIST_FIELDS };
