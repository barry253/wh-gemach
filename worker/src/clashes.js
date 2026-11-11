// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Double-booking check for the Reservations list ───────────────────────────────
// A reservation is double-booked when, at some point in its window, its item type has more pieces / units
// promised (Reserved + Active loans, this one included) than the gemach can lend. Same counting as the
// availability checks elsewhere (quantity.js loanWindow): overdue Active loans block through today,
// a blank end is open-ended, reservations already over are ignored, add-ons never count.
//
// reservationClashes(db, g, reserved) — reserved: this gemach's Reserved loans → { [loanRecId]: { cap, booked, others: [...] } } for the clashing ones only.
// Reads: item types, units, Active loans, then borrowers + requests of the other loans (5 D1 queries).
import { Q, belongs, fetchByIds, firstLink, linkedId, linkedName } from "./records.js";
import { T } from "./config.js";
import { nyToday } from "./dates.js";
import { selName } from "./gemachs.js";
import { isAddonType, isQtyType, lendableQty, loanQty, loanWindow } from "./quantity.js";

const overlaps = (a, from, to) => (to == null || a.from <= to) && (a.to == null || a.to >= from);

/** Most pieces tied up at once over [from, to] by these bookings. */
function peakLoad(list, from, to) {
  const over = list.filter(b => overlaps(b, from, to));
  let peak = 0;
  for (const p of [from, ...over.map(b => b.from).filter(d => d > from)]) {
    peak = Math.max(peak, over.filter(b => b.from <= p && (b.to == null || b.to >= p)).reduce((n, b) => n + b.qty, 0));
  }
  return peak;
}

async function reservationClashes(db, g, reserved) {
  const today = nyToday();
  // `reserved` comes from a query scoped to g (its fields may not include Gemach).
  const mine = reserved.filter(l => selName(l.fields.Status) === "Reserved");
  if (!mine.length) return {};
  const [units, active] = await Promise.all([
    db.listAll(T.ITEMS, { scope: g, fields: ["Item ID", "Item Type", "Active", "Gemach"] }),
    db.listAll(T.LOANS, { scope: g, where: [Q.eq("Status", "Active")],
      fields: ["Loan ID", "Item", "Item to Reserve", "Borrower", "Status", "Quantity", "Date Borrowed", "Expected Return", "Reservation Start", "Reservation End", "Source Request", "Gemach"] }),
  ]);
  const unitType = new Map(), capUnits = {};
  for (const u of units) {
    if (!belongs(u, g)) continue;
    const tid = linkedId(firstLink(u.fields["Item Type"]));
    unitType.set(u.id, tid);
    if (u.fields["Active"]) capUnits[tid] = (capUnits[tid] || 0) + 1;
  }
  const typeOf = l => linkedId(firstLink(l.fields["Item to Reserve"])) || unitType.get(linkedId(firstLink(l.fields["Item"]))) || null;
  const typeIds = [...new Set(mine.map(typeOf).filter(Boolean))];
  const types = await fetchByIds(db, T.ITEM_TYPES, typeIds, { g, fields: ["Name", "Tracking", "Quantity Owned", "Out of Service", "Gemach"] });
  const typeMap = Object.fromEntries(types.filter(t => belongs(t, g)).map(t => [t.id, t]));

  // Every open booking per counted type.
  const byType = {};
  for (const l of [...mine, ...active.filter(l => belongs(l, g))]) {
    const tid = typeOf(l), type = typeMap[tid];
    if (!type || isAddonType(type)) continue;
    const w = loanWindow(l.fields, today);
    if (w.to != null && w.to < today) continue; // already over
    (byType[tid] ||= []).push({ rec: l, from: w.from, to: w.to, qty: isQtyType(type) ? loanQty(l.fields) : 1 });
  }

  const found = {};
  for (const [tid, list] of Object.entries(byType)) {
    const type = typeMap[tid];
    const cap = isQtyType(type) ? lendableQty(type) : capUnits[tid] || 0;
    if (!cap) continue; // nothing counted to lend: not a double-booking question
    for (const b of list) {
      if (selName(b.rec.fields.Status) !== "Reserved") continue;
      const booked = peakLoad(list, b.from, b.to);
      if (booked <= cap) continue;
      found[b.rec.id] = { cap, booked, others: list.filter(o => o !== b && overlaps(o, b.from, b.to)) };
    }
  }
  if (!Object.keys(found).length) return {};

  // Names and request numbers of the bookings it clashes with.
  const otherRecs = [...new Set(Object.values(found).flatMap(f => f.others.map(o => o.rec)))];
  const [borrowers, requests] = await Promise.all([
    fetchByIds(db, T.BORROWERS, otherRecs.map(l => linkedId(firstLink(l.fields["Borrower"]))).filter(Boolean), { g, fields: ["Name", "Gemach"] }),
    fetchByIds(db, T.REQUESTS, otherRecs.map(l => linkedId(firstLink(l.fields["Source Request"]))).filter(Boolean), { g, fields: ["Request ID", "Gemach"] }),
  ]);
  const bName = Object.fromEntries(borrowers.map(b => [b.id, b.fields.Name || null]));
  const rId = Object.fromEntries(requests.map(r => [r.id, r.fields["Request ID"] || null]));
  const out = {};
  for (const [id, f] of Object.entries(found)) {
    out[id] = {
      cap: f.cap, booked: f.booked,
      others: f.others.sort((a, b) => a.from.localeCompare(b.from)).map(o => {
        const bRaw = firstLink(o.rec.fields["Borrower"]);
        return {
          id: o.rec.id, loanId: o.rec.fields["Loan ID"] || null, status: selName(o.rec.fields.Status),
          borrower: bName[linkedId(bRaw)] || linkedName(bRaw) || null,
          requestId: rId[linkedId(firstLink(o.rec.fields["Source Request"]))] || null,
          from: o.from, to: o.to, quantity: o.qty,
        };
      }),
    };
  }
  return out;
}

export { reservationClashes, peakLoad };
