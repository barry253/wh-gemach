// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fAnd, fStr, linkedId, scopeF, today } from "./airtable.js";
import { REC_RE, T } from "./config.js";
import { DAY_MS, addDays, dateToUtcMs, isValidDate, nyToday } from "./dates.js";
import { json } from "./http.js";
import { isAddonType, isQtyType, lendableQty, loadQtyBookings, qtyAvailable } from "./quantity.js";

// ─── Dashboard ────────────────────────────────────────────────────────────────

function isOverdue(fields, todayStr) {
  const borrowed = fields["Date Borrowed"];
  if (!borrowed) return false;
  const expectedReturn = fields["Expected Return"];
  if (expectedReturn) return todayStr > expectedReturn;
  return (new Date(todayStr) - new Date(borrowed)) / 86400000 > 14;
}

async function handleDashboard({ db, g }) {
  const [requests, loans, reservations] = await Promise.all([
    db.listAll(T.REQUESTS, { filter: fAnd(scopeF(g), `{Status}="New"`), fields: ["Request ID"] }),
    db.listAll(T.LOANS, { filter: fAnd(scopeF(g), `{Status}="Active"`), fields: ["Date Borrowed", "Expected Return"] }),
    db.listAll(T.LOANS, { filter: fAnd(scopeF(g), `{Status}="Reserved"`), fields: ["Loan ID"] }),
  ]);
  const t = today();
  return json({
    newRequests: requests.length,
    activeLoans: loans.length,
    overdueLoans: loans.filter(l => isOverdue(l.fields, t)).length,
    upcomingReservations: reservations.length,
  });
}


// ─── Stats (Dashboard) ────────────────────────────────────────────────────────

const median = arr => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

async function handleStats({ db, g, url }) {
  const days = [30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 90;
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - days * DAY_MS).toISOString();
  const sinceDate = addDays(nyToday(), -days);
  const DECISIONS = ["Request Confirmed", "Request Declined"];

  const [requests, waiting, decisions, types, items, returned] = await Promise.all([
    db.listAll(T.REQUESTS, { filter: fAnd(scopeF(g), `IS_AFTER({Received At},${fStr(sinceIso)})`),
      fields: ["Request ID", "Status", "Received At", "Items Requested", "Request Type"] }),
    db.listAll(T.REQUESTS, { filter: fAnd(scopeF(g), `{Status}="New"`), fields: ["Request ID", "Name", "Received At"] }),
    db.listAll(T.LOG, { filter: fAnd(scopeF(g), `OR(${DECISIONS.map(d => `{Event Type}=${fStr(d)}`).join(",")})`, `IS_AFTER({Timestamp},${fStr(sinceIso)})`),
      fields: ["Loan ID", "Timestamp", "Event Type"] }),
    db.listAll(T.ITEM_TYPES, { filter: scopeF(g), fields: ["Name", "Active", "Tracking", "Quantity Owned", "Out of Service"] }),
    db.listAll(T.ITEMS, { filter: scopeF(g), fields: ["Item Type", "Status", "Active", "Loan Statuses"] }),
    db.listAll(T.LOANS, { filter: fAnd(scopeF(g), `{Status}="Returned"`, `IS_AFTER({Date Returned},${fStr(addDays(sinceDate, -1))})`),
      fields: ["Date Borrowed", "Date Returned", "Item Type (from Item)", "Item", "Item to Reserve"] }),
  ]);
  const qtyTypes = types.filter(isQtyType);
  const addonIds = new Set(types.filter(isAddonType).map(t => t.id)); // add-ons are sold, not lent
  const qtyBookings = qtyTypes.length ? await loadQtyBookings(db, g, qtyTypes.map(t => t.id)) : {};

  const typeName = new Map(types.map(t => [t.id, t.fields.Name || "Item"]));
  const itemType = new Map(items.map(i => [i.id, linkedId((i.fields["Item Type"] || [])[0])]));
  const nameOf = v => (typeof v === "string" && REC_RE.test(v) ? typeName.get(v) : v) || null;

  // Requests received in the period
  const count = st => requests.filter(r => r.fields.Status === st).length;
  const received = new Map(requests.map(r => [r.fields["Request ID"], Date.parse(r.fields["Received At"] || r.createdTime)]));

  // Response time: first decision logged for a request received in the period
  const firstDecision = new Map();
  for (const d of decisions) {
    const id = d.fields["Loan ID"], t = Date.parse(d.fields.Timestamp || "");
    if (!id || !received.has(id) || !Number.isFinite(t)) continue;
    if (!firstDecision.has(id) || t < firstDecision.get(id)) firstDecision.set(id, t);
  }
  const hours = [...firstDecision].map(([id, t]) => Math.max(0, (t - received.get(id)) / 3600e3)).filter(Number.isFinite);

  // Waiting > 48h (any age)
  const old = waiting
    .map(r => ({ requestId: r.fields["Request ID"] || null, name: r.fields.Name || null, receivedAt: r.fields["Received At"] || r.createdTime }))
    .filter(r => nowMs - Date.parse(r.receivedAt) > 48 * 3600e3)
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));

  // Inventory per type
  const inv = new Map();
  const bucket = id => inv.get(id) || inv.set(id, { units: 0, available: 0, neverLent: 0 }).get(id);
  const oldEnough = nowMs - 60 * DAY_MS;
  for (const i of items) {
    if (!i.fields.Active) continue;
    const tId = itemType.get(i.id); if (!tId) continue;
    const b = bucket(tId); b.units++;
    if (i.fields.Status === "Available") b.available++;
    const st = (i.fields["Loan Statuses"] || []).join(",");
    if (!/Active|Returned/.test(st) && Date.parse(i.createdTime) < oldEnough) b.neverLent++;
  }
  // Quantity types: "units" = lendable count, "available" = free today (never counted as never-lent).
  const todayNy = nyToday();
  for (const t of qtyTypes) {
    const b = bucket(t.id);
    b.units = lendableQty(t);
    b.available = qtyAvailable(b.units, qtyBookings[t.id], todayNy, todayNy);
  }

  // Most requested item types
  const asked = new Map();
  for (const r of requests) for (const id of new Set((r.fields["Items Requested"] || []).map(linkedId))) asked.set(id, (asked.get(id) || 0) + 1);
  const topRequested = [...asked].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({
    name: typeName.get(id) || "Item", requests: n, units: inv.get(id)?.units || 0, available: inv.get(id)?.available || 0,
    ...(addonIds.has(id) ? { addon: true } : {}),
  }));

  // How long loans actually last (returned in the period), by item type
  const lengths = new Map();
  for (const l of returned) {
    const a = l.fields["Date Borrowed"], z = l.fields["Date Returned"];
    if (!isValidDate(a) || !isValidDate(z) || z < sinceDate) continue;
    const itemId = linkedId((l.fields.Item || [])[0]);
    if (!itemId && addonIds.has(linkedId((l.fields["Item to Reserve"] || [])[0]))) continue; // handed-over add-on, not a loan
    const n = nameOf((l.fields["Item Type (from Item)"] || [])[0]) || typeName.get(itemType.get(itemId))
      || typeName.get(linkedId((l.fields["Item to Reserve"] || [])[0])) || "Item";
    (lengths.get(n) || lengths.set(n, []).get(n)).push(Math.max(0, (dateToUtcMs(z) - dateToUtcMs(a)) / DAY_MS));
  }
  const loanLength = [...lengths].map(([name, arr]) => ({ name, loans: arr.length, medianDays: Math.round(median(arr)) }))
    .sort((a, b) => b.loans - a.loans).slice(0, 8);

  const neverLentTypes = [...inv].filter(([, b]) => b.neverLent > 0)
    .map(([id, b]) => ({ name: typeName.get(id) || "Item", count: b.neverLent, units: b.units }))
    .sort((a, b) => b.count - a.count);

  return json({
    days,
    requests: { received: requests.length, confirmed: count("Converted"), declined: count("Declined"), waiting: count("New") },
    response: {
      answered: hours.length,
      medianHours: hours.length ? Math.round(median(hours) * 10) / 10 : null,
      within24hPct: hours.length ? Math.round(100 * hours.filter(h => h <= 24).length / hours.length) : null,
    },
    waitingOver48h: { count: old.length, oldest: old.slice(0, 5) },
    topRequested,
    loanLength,
    loansReturned: [...lengths.values()].reduce((n, a) => n + a.length, 0),
    neverLent: { count: neverLentTypes.reduce((n, t) => n + t.count, 0), types: neverLentTypes.slice(0, 10) },
  });
}

export { isOverdue, handleDashboard, median, handleStats };
