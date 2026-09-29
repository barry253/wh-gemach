// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fAnd, fetchByIds, firstLink, linkedId, scopeF } from "./airtable.js";
import { T } from "./config.js";
import { json } from "./http.js";
import { borrowerInfo } from "./loans.js";

// ─── Admin inventory ──────────────────────────────────────────────────────────

async function handleAdminInventory({ db, g }) {
  const [items, itemTypes, activeLoans] = await Promise.all([
    db.listAll(T.ITEMS, { filter: scopeF(g), sort: [{ field: "Item ID", direction: "asc" }] }),
    db.listAll(T.ITEM_TYPES, { filter: scopeF(g), sort: [{ field: "Display Order", direction: "asc" }], fields: ["Name"] }),
    db.listAll(T.LOANS, {
      filter: fAnd(scopeF(g), `OR({Status}="Active",{Status}="Reserved")`),
      sort: [{ field: "Loan ID", direction: "asc" }],
    }),
  ]);
  const itemTypeMap = Object.fromEntries(itemTypes.map(r => [r.id, r.fields["Name"]]));

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

  const borrowers = await fetchByIds(db, T.BORROWERS, Object.values(loanByItem).map(l => l.borrowerId), { g });
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
      itemTypeName: itemTypeMap[itemTypeId] || itemTypeId || "Unknown",
      condition: r.fields["Condition"] || "Unknown",
      status: r.fields["Status"] || "Unknown",
      active: r.fields["Active"] || false,
      notes: r.fields["Notes"] || null,
      currentLoan,
    };
  });
  return json(records);
}

export { handleAdminInventory };
