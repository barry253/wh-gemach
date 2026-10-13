// Part of the Gemach Network worker (see index.js for routes and env vars).
// GET /admin/network/analytics?days=30|90|365[&fresh=1] — network-wide numbers for the admin Network → Analytics tab
// (Network Admins only; routed through networkDispatch, which checks the role).
import { Q, linkedId } from "./airtable.js";
import { T } from "./config.js";
import { DAY_MS, NY_TZ, addDays, dateToUtcMs, isValidDate, nyToday } from "./dates.js";
import { selName } from "./gemachs.js";
import { json } from "./http.js";
import { isOverdue, median } from "./stats.js";

// Covers 30–365 days, so a copy up to 5 minutes old is fine (per worker isolate). ?fresh=1 skips it.
const ANALYTICS_TTL_MS = 5 * 60 * 1000;
const analyticsMemo = new Map(); // days -> { data, at }

// One formatter for the whole module: building an Intl formatter per row costs real CPU (Workers Free: 10 ms).
// Made on first use (modules import each other in a cycle, so NY_TZ isn't ready at load time).
let NY_DATE = null;
const nyDateOf = ms => (NY_DATE ||= new Intl.DateTimeFormat("en-CA", { timeZone: NY_TZ, year: "numeric", month: "2-digit", day: "2-digit" })).format(new Date(ms)); // "YYYY-MM-DD"

const DECISIONS = new Set(["Request Confirmed", "Request Declined"]);
const first = v => linkedId((v || [])[0]);

async function handleNetworkAnalytics({ db, url }) {
  const days = [30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 90;
  const hit = analyticsMemo.get(days);
  if (hit && Date.now() - hit.at < ANALYTICS_TTL_MS && url.searchParams.get("fresh") !== "1") {
    return json({ ...hit.data, cachedAt: new Date(hit.at).toISOString() });
  }
  const data = await buildNetworkAnalytics(db, days);
  analyticsMemo.set(days, { data, at: Date.now() });
  return json(data);
}

async function buildNetworkAnalytics(db, days, nowMs = Date.now()) {
  const sinceIso = new Date(nowMs - days * DAY_MS).toISOString();
  const todayNy = nyDateOf(nowMs);
  const sinceDate = addDays(todayNy, -days);

  // 9 reads, all in parallel. Date conditions narrow the reads; every one is re-checked below as well.
  // Loans are read in full (a few fields): "new vs returning borrower" needs each person's whole history.
  const [gemachs, requests, waiting, testReqs, open, recent, log, types, borrowers] = await Promise.all([
    db.listAll(T.GEMACHS, { fields: ["Name", "Slug", "Active", "Coming Soon", "Mode"] }),
    db.listAll(T.REQUESTS, { where: [Q.after("Received At", sinceIso)],
      fields: ["Request ID", "Status", "Received At", "Items Requested", "Source", "Test", "Gemach", "Phone", "Email"] }),
    db.listAll(T.REQUESTS, { where: [Q.eq("Status", "New")], fields: ["Status", "Received At", "Test", "Gemach"] }),
    db.listAll(T.REQUESTS, { where: [Q.isTrue("Test")], fields: ["Test"] }),
    db.listAll(T.LOANS, { where: [Q.in("Status", ["Reserved", "Active"])],
      fields: ["Status", "Gemach", "Item", "Item to Reserve", "Quantity", "Date Borrowed", "Expected Return", "Source Request", "Borrower"] }),
    db.listAll(T.LOANS, {
      fields: ["Status", "Gemach", "Item", "Item to Reserve", "Date Borrowed", "Date Returned", "Source Request", "Borrower"] }),
    db.listAll(T.LOG, { where: [Q.after("Timestamp", sinceIso)], fields: ["Timestamp", "Event Type", "Loan ID", "Gemach"] }),
    db.listAll(T.ITEM_TYPES, { fields: ["Name", "Active", "Tracking", "Gemach"] }),
    db.listAll(T.BORROWERS, { fields: ["Gemach", "Phone", "Email"] }),
  ]);

  const testIds = new Set(testReqs.filter(r => r.fields.Test).map(r => r.id));
  const typeById = new Map(types.map(t => [t.id, t]));
  const isAddon = id => selName(typeById.get(id)?.fields?.Tracking) === "Add-on";
  // A loan row is a real loan unless it came from a test request or is an add-on (sold, not lent).
  const realLoan = l => !testIds.has(first(l.fields["Source Request"])) && !(!first(l.fields.Item) && isAddon(first(l.fields["Item to Reserve"])));
  const gOf = r => first(r.fields.Gemach);

  // Per-gemach rows, in the order gemachs are shown elsewhere (by name).
  const per = new Map();
  const statusOf = f => (!f.Active ? "Hidden" : f["Coming Soon"] ? "Coming soon" : "Live");
  for (const g of gemachs) {
    per.set(g.id, {
      id: g.id, name: g.fields.Name || "", slug: g.fields.Slug || null, status: statusOf(g.fields), mode: selName(g.fields.Mode) || "Full",
      requests: 0, confirmed: 0, declined: 0, adminBookings: 0, waiting: 0, waitingOver48h: 0,
      reserved: 0, out: 0, overdue: 0, loansStarted: 0, loansReturned: 0,
      borrowers: 0, itemTypes: 0, replyHours: [], lastActivity: null, people: new Set(),
    });
  }
  const row = id => per.get(id);

  // Requests received in the period (not test ones). Admin-made bookings counted apart, like the dashboard stats.
  const inPeriod = requests.filter(r => !r.fields.Test && Date.parse(r.fields["Received At"] || r.createdTime) >= Date.parse(sinceIso));
  const online = inPeriod.filter(r => String(r.fields.Source || "") !== "Admin");
  const received = new Map(); // Request ID -> { at, gemach }
  for (const r of inPeriod) {
    const p = row(gOf(r)); if (!p) continue;
    if (String(r.fields.Source || "") === "Admin") { p.adminBookings++; continue; }
    p.requests++;
    if (r.fields.Status === "Converted") p.confirmed++;
    if (r.fields.Status === "Declined") p.declined++;
    if (r.fields["Request ID"]) received.set(r.fields["Request ID"], { at: Date.parse(r.fields["Received At"] || r.createdTime), g: gOf(r) });
  }
  const outcome = st => online.filter(r => r.fields.Status === st).length;

  // Waiting for a reply right now (any age).
  for (const r of waiting) {
    if (r.fields.Test || r.fields.Status !== "New") continue;
    const p = row(gOf(r)); if (!p) continue;
    p.waiting++;
    if (nowMs - Date.parse(r.fields["Received At"] || r.createdTime) > 48 * 3600e3) p.waitingOver48h++;
  }

  // Open right now: reserved / out / overdue.
  for (const l of open) {
    if (!realLoan(l)) continue;
    const p = row(gOf(l)); if (!p) continue;
    if (l.fields.Status === "Reserved") p.reserved++;
    else if (l.fields.Status === "Active") { p.out++; if (isOverdue(l.fields, todayNy)) p.overdue++; }
  }

  // Lent out / returned in the period.
  for (const l of recent) {
    if (!realLoan(l)) continue;
    const p = row(gOf(l)); if (!p) continue;
    const b = l.fields["Date Borrowed"], z = l.fields["Date Returned"];
    if (isValidDate(b) && b >= sinceDate && ["Active", "Returned"].includes(l.fields.Status)) p.loansStarted++;
    if (isValidDate(z) && z >= sinceDate && l.fields.Status === "Returned") p.loansReturned++;
  }

  // Activity log: last activity per gemach and first reply to each request received in the period.
  const firstDecision = new Map();
  for (const e of log) {
    const t = Date.parse(e.fields.Timestamp || "");
    if (!Number.isFinite(t) || t < Date.parse(sinceIso)) continue;
    const p = row(gOf(e));
    if (p && (!p.lastActivity || t > Date.parse(p.lastActivity))) p.lastActivity = new Date(t).toISOString();
    const id = e.fields["Loan ID"];
    if (DECISIONS.has(e.fields["Event Type"]) && received.has(id) && (!firstDecision.has(id) || t < firstDecision.get(id))) firstDecision.set(id, t);
  }
  const allHours = [];
  for (const [id, t] of firstDecision) {
    const r = received.get(id), h = Math.max(0, (t - r.at) / 3600e3);
    allHours.push(h);
    row(r.g)?.replyHours.push(h);
  }

  for (const t of types) { if (t.fields.Active && !isAddon(t.id)) { const p = row(gOf(t)); if (p) p.itemTypes++; } }
  for (const b of borrowers) { const p = row(gOf(b)); if (p) p.borrowers++; }

  // Most requested items across the network (online requests and admin bookings: a phone call is demand too).
  const asked = new Map();
  for (const r of inPeriod) for (const id of new Set((r.fields["Items Requested"] || []).map(linkedId))) asked.set(id, (asked.get(id) || 0) + 1);
  const topRequested = [...asked]
    .map(([id, n]) => ({ id, n, name: typeById.get(id)?.fields?.Name || "Item", g: gOf(typeById.get(id) || { fields: {} }) }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 10)
    .map(x => ({ name: x.name, gemach: row(x.g)?.name || null, requests: x.n, ...(isAddon(x.id) ? { addon: true } : {}) }));

  // Trend: online requests and loans started, by week (30/90 days) or by month (365 days).
  const byMonth = days > 120;
  const bucketOf = date => {
    if (byMonth) return date.slice(0, 7) + "-01";
    const back = Math.floor((dateToUtcMs(todayNy) - dateToUtcMs(date)) / DAY_MS / 7); // whole weeks back from today
    return addDays(todayNy, -7 * back - 6); // each week ends today, 7 days before, …
  };
  const buckets = new Map();
  if (byMonth) {
    let d = sinceDate.slice(0, 7) + "-01";
    while (d <= todayNy) { buckets.set(d, { start: d, requests: 0, loans: 0 }); const [y, m] = d.split("-").map(Number); d = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`; }
  } else {
    for (let w = Math.ceil(days / 7) - 1; w >= 0; w--) { const s = addDays(todayNy, -7 * w - 6); buckets.set(s, { start: s, requests: 0, loans: 0 }); }
  }
  const bump = (date, key) => { const b = buckets.get(bucketOf(date)); if (b) b[key]++; };
  for (const r of online) bump(nyDateOf(Date.parse(r.fields["Received At"] || r.createdTime)), "requests");
  for (const l of recent) {
    const b = l.fields["Date Borrowed"];
    if (realLoan(l) && isValidDate(b) && b >= sinceDate && ["Active", "Returned"].includes(l.fields.Status)) bump(b, "loans");
  }

  // ── People ──
  // Each gemach has its own Borrowers record for a person, so the same person is matched across gemachs
  // by phone (last 10 digits) or email; records sharing either are one person.
  const parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = k => { if (!parent.has(k)) parent.set(k, k); return k; };
  const union = (a, b) => { a = find(add(a)); b = find(add(b)); if (a !== b) parent.set(b, a); };
  const keysOf = f => {
    const digits = String(f.Phone || "").replace(/\D/g, ""), email = String(f.Email || "").trim().toLowerCase();
    return [digits.length >= 10 ? "p:" + digits.slice(-10) : null, email.includes("@") ? "e:" + email : null].filter(Boolean);
  };
  for (const b of borrowers) { add("b:" + b.id); for (const k of keysOf(b.fields)) union("b:" + b.id, k); }
  const personOf = id => (id && parent.has("b:" + id) ? find("b:" + id) : null);
  const personGemachs = new Map(); // person -> Set(gemach)
  for (const b of borrowers) { const k = personOf(b.id); (personGemachs.get(k) || personGemachs.set(k, new Set()).get(k)).add(gOf(b)); }

  const withLoanNow = new Set(), withReservationNow = new Set(), overduePeople = new Set();
  for (const l of open) {
    if (!realLoan(l)) continue;
    const k = personOf(first(l.fields.Borrower)); if (!k) continue;
    if (l.fields.Status === "Active") { withLoanNow.add(k); if (isOverdue(l.fields, todayNy)) overduePeople.add(k); }
    else if (l.fields.Status === "Reserved") withReservationNow.add(k);
  }
  const firstBorrowed = new Map(), loansPer = new Map(), borrowedInPeriod = new Set();
  for (const l of recent) {
    const b = l.fields["Date Borrowed"];
    if (!realLoan(l) || !isValidDate(b) || !["Active", "Returned"].includes(l.fields.Status)) continue;
    const k = personOf(first(l.fields.Borrower)); if (!k) continue;
    loansPer.set(k, (loansPer.get(k) || 0) + 1);
    if (!firstBorrowed.has(k) || b < firstBorrowed.get(k)) firstBorrowed.set(k, b);
    if (b >= sinceDate) { borrowedInPeriod.add(k); row(gOf(l))?.people.add(k); }
  }
  const newPeople = [...borrowedInPeriod].filter(k => firstBorrowed.get(k) >= sinceDate).length;
  // Who sent online requests in the period, and how many of them have never borrowed anything (anywhere).
  const requesters = new Set();
  let requestersNeverBorrowed = 0;
  for (const r of online) {
    const ks = keysOf(r.fields); if (!ks.length) continue;
    const known = ks.find(k => parent.has(k));
    const id = known ? find(known) : "r:" + ks[0];
    if (requesters.has(id)) continue;
    requesters.add(id);
    if (!known || !loansPer.has(id)) requestersNeverBorrowed++;
  }
  const allPeople = new Set([...parent.keys()].filter(k => k.startsWith("b:")).map(find));
  const people = {
    total: allPeople.size,
    records: borrowers.length,
    withLoanNow: withLoanNow.size,
    withReservationNow: [...withReservationNow].filter(k => !withLoanNow.has(k)).length, // reserved only, nothing out yet
    overdue: overduePeople.size,
    borrowedInPeriod: borrowedInPeriod.size,
    newInPeriod: newPeople,
    returningInPeriod: borrowedInPeriod.size - newPeople,
    repeat: [...loansPer.values()].filter(n => n >= 2).length,
    multiGemach: [...personGemachs.values()].filter(s => s.size >= 2).length,
    requesters: requesters.size,
    requestersNeverBorrowed,
    loansPerPerson: loansPer.size ? Math.round(10 * [...loansPer.values()].reduce((a, b) => a + b, 0) / loansPer.size) / 10 : null,
  };

  const rows = [...per.values()].map(({ replyHours, people: ppl, ...p }) => ({
    ...p, peopleInPeriod: ppl.size, medianReplyHours: replyHours.length ? Math.round(median(replyHours) * 10) / 10 : null,
  })).sort((a, b) => a.name.localeCompare(b.name));
  const sum = k => rows.reduce((n, p) => n + p[k], 0);
  const hidden = new Set(rows.filter(p => p.status === "Hidden").map(p => p.id));

  return {
    days, since: sinceDate, today: todayNy,
    gemachs: { live: rows.filter(p => p.status === "Live").length, comingSoon: rows.filter(p => p.status === "Coming soon").length, hidden: hidden.size },
    now: {
      waiting: sum("waiting"), waitingOver48h: sum("waitingOver48h"), reserved: sum("reserved"), out: sum("out"), overdue: sum("overdue"),
      borrowers: sum("borrowers"), itemTypes: sum("itemTypes"),
    },
    period: {
      requests: online.length, confirmed: outcome("Converted"), declined: outcome("Declined"), cancelled: outcome("Cancelled"), stillWaiting: outcome("New"),
      adminBookings: sum("adminBookings"), loansStarted: sum("loansStarted"), loansReturned: sum("loansReturned"),
      answered: allHours.length,
      medianReplyHours: allHours.length ? Math.round(median(allHours) * 10) / 10 : null,
      within24hPct: allHours.length ? Math.round(100 * allHours.filter(h => h <= 24).length / allHours.length) : null,
    },
    people,
    trend: { by: byMonth ? "month" : "week", buckets: [...buckets.values()] },
    topRequested,
    byGemach: rows,
  };
}

export { handleNetworkAnalytics, buildNetworkAnalytics, analyticsMemo };
