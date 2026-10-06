// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fAnd, fetchByIds, firstLink, linkedId, scopeF } from "./airtable.js";
import { T } from "./config.js";
import { json } from "./http.js";
import { BORROWER_FIELDS, borrowerInfo } from "./loans.js";
import { isAddonType, isQtyType } from "./quantity.js";

// ─── Admin inventory ──────────────────────────────────────────────────────────

/**
 * Admin inventory: every unit with its current loan. With ?holds=1 the answer is { items, holds }, where
 * holds are reservations for a numbered item type that don't have a unit yet (the unit is picked at
 * pickup), so admin can show "1 reserved" on the type even though every unit still says Available.
 * Without it the answer stays the plain list older admin pages expect.
 */
async function handleAdminInventory({ db, g, url }) {
  const [items, itemTypes, activeLoans] = await Promise.all([
    db.listAll(T.ITEMS, { filter: scopeF(g), sort: [{ field: "Item ID", direction: "asc" }], fields: ["Item ID", "Item Type", "Condition", "Status", "Active", "Notes"] }),
    db.listAll(T.ITEM_TYPES, { filter: scopeF(g), sort: [{ field: "Display Order", direction: "asc" }], fields: ["Name", "Tracking"] }),
    db.listAll(T.LOANS, {
      filter: fAnd(scopeF(g), `OR({Status}="Active",{Status}="Reserved")`),
      sort: [{ field: "Loan ID", direction: "asc" }],
      fields: ["Loan ID", "Item", "Item to Reserve", "Status", "Date Borrowed", "Reservation Start", "Reservation End", "Notes", "Borrower"],
    }),
  ]);
  const itemTypeMap = Object.fromEntries(itemTypes.map(r => [r.id, r.fields["Name"]]));
  const wantHolds = url?.searchParams.get("holds") === "1";
  const unitTypes = new Set(itemTypes.filter(r => !isQtyType(r) && !isAddonType(r)).map(r => r.id));
  const holdLoans = wantHolds ? activeLoans.filter(l => l.fields["Status"] === "Reserved" && !(l.fields["Item"] || []).length
    && unitTypes.has(linkedId(firstLink(l.fields["Item to Reserve"])))) : [];

  const loanByItem = {};
  activeLoans.forEach(l => {
    const iId = linkedId(firstLink(l.fields["Item"]));
    if (iId && !loanByItem[iId]) {
      loanByItem[iId] = {
        loanRecId: l.id,
        loanId: l.fields["Loan ID"] || null,
        status: l.fields["Status"] || null,
        dateBorrowed: l.fields["Date Borrowed"] || null,
        reservationStart: l.fields["Reservation Start"] || null,
        reservationEnd: l.fields["Reservation End"] || null,
        notes: l.fields["Notes"] || null,
        borrowerId: linkedId(firstLink(l.fields["Borrower"])),
      };
    }
  });

  const borrowerIds = [...Object.values(loanByItem).map(l => l.borrowerId), ...holdLoans.map(l => linkedId(firstLink(l.fields["Borrower"])))];
  const borrowers = await fetchByIds(db, T.BORROWERS, [...new Set(borrowerIds.filter(Boolean))], { g, fields: BORROWER_FIELDS });
  const borrowerMap = Object.fromEntries(borrowers.map(r => [r.id, borrowerInfo(r)]));

  const records = items.map(r => {
    const itemTypeId = linkedId(firstLink(r.fields["Item Type"]));
    const loan = loanByItem[r.id] || null;
    let currentLoan = null;
    if (loan) {
      const b = borrowerMap[loan.borrowerId] || {};
      currentLoan = {
        loanRecId: loan.loanRecId, loanId: loan.loanId, status: loan.status,
        dateBorrowed: loan.dateBorrowed, reservationStart: loan.reservationStart,
        reservationEnd: loan.reservationEnd, notes: loan.notes,
        borrowerName: b.name || null, borrowerPhone: b.phone || null,
        borrowerEmail: b.email || null, borrowerContact: b.preferredContact || null,
      };
    }
    return {
      id: r.id,
      itemId: r.fields["Item ID"],
      itemTypeId: itemTypeId || null,
      itemTypeName: itemTypeMap[itemTypeId] || itemTypeId || "Unknown",
      condition: r.fields["Condition"] || "Unknown",
      status: r.fields["Status"] || "Unknown",
      active: r.fields["Active"] || false,
      notes: r.fields["Notes"] || null,
      currentLoan,
    };
  });
  if (!wantHolds) return json(records);
  const holds = holdLoans.map(l => {
    const typeId = linkedId(firstLink(l.fields["Item to Reserve"]));
    const b = borrowerMap[linkedId(firstLink(l.fields["Borrower"]))] || {};
    return {
      loanRecId: l.id, loanId: l.fields["Loan ID"] || null,
      itemTypeId: typeId, itemTypeName: itemTypeMap[typeId] || null,
      borrowerName: b.name || null,
      reservationStart: l.fields["Reservation Start"] || null,
      reservationEnd: l.fields["Reservation End"] || null,
    };
  }).sort((a, b) => String(a.reservationStart || "9999").localeCompare(String(b.reservationStart || "9999")));
  return json({ items: records, holds });
}

export { handleAdminInventory };
