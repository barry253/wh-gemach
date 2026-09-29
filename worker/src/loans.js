// Part of the Gemach Network worker (see index.js for routes and env vars).
import { logEvent } from "./activity.js";
import { AirtableError, fAnd, fetchByIds, firstLink, getOwned, linkedId, linkedName, scopeF, today } from "./airtable.js";
import { findOrCreateBorrower } from "./borrowers.js";
import { DATE_RE, T } from "./config.js";
import { isValidDate } from "./dates.js";
import { json, readJson } from "./http.js";
import { getNextLoanId } from "./ids.js";
import { MAX_QTY, isAddonType, isQtyType, itemTypeInfoMap, loanQty, wholeNum } from "./quantity.js";
import { itemTypeNameMap } from "./requests.js";

// ─── Loans / reservations shared lookups ──────────────────────────────────────

function borrowerInfo(r) {
  return {
    name: r.fields["Name"] || null,
    phone: r.fields["Phone"] || null,
    email: r.fields["Email"] || null,
    preferredContact: r.fields["Preferred Contact"] || null,
  };
}

/** Given loan records, batch-load borrowers, items, and item type names (all scoped). */
async function loadLoanRelations(db, g, loans, { includeItemToReserve = false } = {}) {
  const borrowerIds = loans.map(l => linkedId(firstLink(l.fields["Borrower"]))).filter(Boolean);
  const itemIds = loans.map(l => linkedId(firstLink(l.fields["Item"]))).filter(Boolean);
  const [borrowers, items] = await Promise.all([
    fetchByIds(db, T.BORROWERS, borrowerIds, { g }),
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

async function handleGetLoans({ db, g }) {
  const loans = await db.listAll(T.LOANS, {
    filter: fAnd(scopeF(g), `{Status}="Active"`),
    sort: [{ field: "Date Borrowed", direction: "asc" }],
  });
  const { borrowerMap, itemMap, itemTypeMap, typeInfo } = await loadLoanRelations(db, g, loans, { includeItemToReserve: true });
  const now = new Date();
  const t = today();

  const records = loans.map(r => {
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
      isQuantity: q.isQuantity,
      quantity: q.quantity,
      borrowerName: borrower.name || linkedName(bRaw) || "Unknown",
      borrowerPhone: borrower.phone || null,
      borrowerEmail: borrower.email || null,
      borrowerContact: borrower.preferredContact || null,
      dateBorrowed: borrowed || null,
      expectedReturn,
      daysOut: daysDiff,
      overdue: expectedReturn ? t > expectedReturn : (daysDiff > 14),
      notes: f["Notes"] || null,
      requestNote: (f["Request Note"] || []).join("") || null,
    };
  });
  return json(records);
}

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

async function handleReturnLoan(c, id) {
  const { db, g, ctx } = c;
  const body = await readJson(c.request);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
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
    if (missing && body.reduceOwned === true) {
      const owned = wholeNum(typeRec.fields["Quantity Owned"]);
      const next = Math.max(0, owned - missing);
      const oos = wholeNum(typeRec.fields["Out of Service"]);
      await db.update(T.ITEM_TYPES, typeRec.id, { "Quantity Owned": next, ...(oos > next ? { "Out of Service": next } : {}) });
      notes += `; ${typeRec.fields.Name || "item"} owned ${owned} → ${next}`;
    }
  }

  await db.update(T.LOANS, id, fields);

  logEvent(ctx, db, g, {
    eventType: "Item Returned",
    ...(await loanLogDetails(db, g, loan, body)),
    admin: c.adminName || body.adminName || null,
    notes,
  });
  return json({ success: true, ...(typeRec ? { missing } : {}) });
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
  // Add-on order (made to order, for purchase): handing it over completes it — it never goes "out on loan".
  const addonRec = await addonTypeForLoan(db, g, loan);
  if (addonRec) {
    let n = loanQty(loan.fields);
    if (body.quantity != null && body.quantity !== "") {
      n = Number(body.quantity);
      if (!Number.isInteger(n) || n < 1 || n > 500) return json({ error: "How many are being handed over? Enter 1 or more." }, 400);
    }
    const day = DATE_RE.test(body.pickupDate || "") ? body.pickupDate : today();
    await db.update(T.LOANS, id, { "Status": "Returned", "Quantity": n, "Date Borrowed": day, "Date Returned": day });
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
    if (body.itemId && !(await getOwned(db, T.ITEMS, body.itemId, g))) return json({ error: "Item not found" }, 404);
    if (!body.itemId && !(loan.fields["Item"] || []).length) {
      return json({ error: "Choose which item is being picked up." }, 400);
    }
    if (body.itemId) fields["Item"] = [body.itemId];
  }
  await db.update(T.LOANS, id, fields);

  logEvent(ctx, db, g, {
    eventType: "Loan Created",
    ...(await loanLogDetails(db, g, loan, body, { itemRecId: typeRec ? null : body.itemId || null })),
    admin: c.adminName || body.adminName || null,
    notes,
  });
  return json({ success: true });
}

async function handleGetReservations({ db, g }) {
  const loans = await db.listAll(T.LOANS, {
    filter: fAnd(scopeF(g), `{Status}="Reserved"`),
    sort: [{ field: "Reservation Start", direction: "asc" }],
  });
  const { borrowerMap, itemMap, itemTypeMap, typeInfo } = await loadLoanRelations(db, g, loans, { includeItemToReserve: true });

  const records = loans.map(r => {
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
      itemTypeName: item.itemTypeName || itemTypeMap[linkedId(itRaw)] || linkedName(itRaw) || linkedName(iRaw) || "Unknown",
      itemId: item.itemId || null,
      itemRecId: linkedId(iRaw) || null,
      itemTypeId: item.itemTypeId || linkedId(itRaw) || null,
      isQuantity: q.isQuantity,
      isAddon: q.isAddon,
      price: q.price,
      quantity: q.quantity,
      reservationStart: f["Reservation Start"] || null,
      reservationEnd: f["Reservation End"] || null,
      notes: f["Notes"] || null,
      requestNote: (f["Request Note"] || []).join("") || null,
    };
  });
  return json(records);
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
  let data;
  try {
    data = await db.update(T.LOANS, id, { "Status": "Cancelled" });
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
  const { status, borrowerName, borrowerPhone, borrowerEmail, borrowerContact,
          dateBorrowed, reservationStart, reservationEnd, notes, existingLoanId } = body;
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
        filter: fAnd(scopeF(g), `OR({Status}="Active",{Status}="Reserved")`),
        fields: ["Item", "Status"],
      });
      const mine = loans.filter(l => (l.fields["Item"] || []).map(linkedId).includes(itemRecId));
      await Promise.all(mine.map(l => db.update(T.LOANS, l.id, { "Status": "Returned", "Date Returned": t })));
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

  let borrowerId;
  try {
    borrowerId = await findOrCreateBorrower(db, g, { name: borrowerName, phone: borrowerPhone, email: borrowerEmail, preferredContact: borrowerContact });
  } catch (e) {
    return json({ success: false, error: e.message }, 500);
  }

  if (existingLoanId) {
    const updateFields = { "Borrower": [borrowerId], "Status": status === "Reserved" ? "Reserved" : "Active" };
    if (notes) updateFields["Notes"] = notes;
    if (status === "On Loan") updateFields["Date Borrowed"] = dateBorrowed || today();
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
  if (status === "On Loan") loanFields["Date Borrowed"] = dateBorrowed || today();
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

export { borrowerInfo, loadLoanRelations, loanQtyInfo, handleGetLoans, loanLogDetails, handleReturnLoan, qtyTypeForLoan, handleMarkPickedUp, handleGetReservations, handleUpdateReservation, handleCancelReservation, handleAssignItem };
