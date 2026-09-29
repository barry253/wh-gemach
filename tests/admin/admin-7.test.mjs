import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../.out/", import.meta.url).pathname); // screenshots land in tests/.out
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const REQS = [
  { id: "recREQWA000000001", requestId: "R-101", name: "Rivka Klein", phone: "(516) 555-1234", email: "rivka@example.com", preferredContact: "WhatsApp",
    itemNames: ["Knee Scooter"], neededFrom: "2026-09-29", neededUntil: "2026-10-05", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
  { id: "recREQEM000000002", requestId: "R-102", name: "Moshe Adler", phone: "5165559876", email: "moshe@example.com", preferredContact: "Email",
    itemNames: ["Walker"], neededFrom: "2026-09-30", neededUntil: null, openEnded: true, receivedAt: "not a date", requestType: "Loan" },
  { id: "recREQNP000000003", requestId: "R-103", name: "No Pref", phone: "5165550000", email: "np@example.com", preferredContact: null,
    itemNames: ["Crutches"], neededFrom: null, neededUntil: null, openEnded: false, receivedAt: null, requestType: "Loan" },
  { id: "recREQSM000000004", requestId: "R-104", name: "Sara Text", phone: "5165551111", email: null, preferredContact: "SMS",
    itemNames: ["Cane"], neededFrom: "2026-10-01", neededUntil: "", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
  { id: "recREQPH000000005", requestId: "R-105", name: "Phil Phone", phone: "5165552222", email: null, preferredContact: "Phone",
    itemNames: ["Cane"], neededFrom: "garbage", neededUntil: "2026-13-45", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
];
const LOANS = [{ id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Loan Nodate", borrowerPhone: "5165553333", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: null, daysOut: null }];
const RES = [
  { id: "recRES00000000001", loanId: "L-2", borrowerName: "Res Nodate", borrowerPhone: "5165554444", borrowerEmail: "res@example.com", borrowerContact: "WhatsApp", itemTypeName: "Crib", reservationStart: null, reservationEnd: null },
  { id: "recRES00000000002", loanId: "L-3", borrowerName: "Res Bad", borrowerPhone: "", borrowerEmail: "rb@example.com", borrowerContact: "Phone", itemTypeName: "Crib", reservationStart: "2026-10-02", reservationEnd: "bad" },
];
const APPTS = [{ id: "recREQAP000000009", requestId: "R-109", name: "Appt Person", phone: "5165556666", email: "ap@example.com", preferredContact: "Email", appointmentAt: "2026-10-04T23:00:00.000Z", itemNames: [] }];
const HIST = { records: [{ id: "recH1", timestamp: "nope", eventType: "Loan Created", borrower: "X" }, { id: "recH2", timestamp: null, eventType: "Item Returned" }], offset: null };
const G = {
  id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", email: "gemach@example.com", phone: "(718) 986-7345",
  pickupAddress: "507 Walton Court", pickupInstructions: "In the driveway.",
  templates: { confirm: "Hi {first_name}, {items} is ready from the {gemach}.", decline: "Sorry {first_name}.", pickup: "Hi {first_name}, pick up at {pickup_address}.", appointment: "Hi {first_name}, see you {appointment_time}." },
  rawTemplates: {}, canEdit: true,
};

async function setup() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname;
    let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
    calls.push({ method: req.method(), path: p, body, gemach: req.headers()["x-gemach"] });
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Network Admin", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name, active: true }] });
    if (p === "/admin/stats") return J(STATS[u.searchParams.get("days")] || STATS["90"]);
    if (p === "/admin/network/searches") return J(SEARCHES);
    if (p === "/admin/network/gemachs") return J([]);
    if (p === "/admin/network/admins") return J([]);
    if (p === "/admin/network/categories") return J([]);
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: REQS.length, activeLoans: 1, overdueLoans: 0, upcomingReservations: 2 });
    if (p === "/admin/requests") return J(REQS);
    if (p === "/admin/loans") return J(LOANS);
    if (p === "/admin/reservations") return J(RES);
    if (p === "/admin/appointments") return J(APPTS);
    if (p === "/admin/history") return J(HIST);
    if (/\/confirm$|\/decline$/.test(p)) return J({ success: true });
    return J([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("gemach_token", "fake.token.x");
    localStorage.setItem("gemach_slug", "wh-medical");
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push({ how: "window.open", url: String(u) }); return null; };
    document.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a");
      if (a && /^(sms|mailto|tel):/.test(a.getAttribute("href") || "")) { e.preventDefault(); window.__opened.push({ how: "anchor", url: a.href }); }
    }, true);
  });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(600);
  return { page, errors, calls };
}
const bodyText = page => page.evaluate(() => document.body.innerText);


const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
const STATS = {
  "90": { days: 90, requests: { received: 42, confirmed: 33, declined: 5, waiting: 4 }, response: { answered: 38, medianHours: 5.5, within24hPct: 84 },
    waitingOver48h: { count: 2, oldest: [{ requestId: "R-88", name: "Leah <b>Gold</b>", receivedAt: ago(120) }, { requestId: "R-91", name: "Yossi K", receivedAt: ago(55) }] },
    topRequested: [{ name: "Knee Scooter", requests: 11, units: 2, available: 0 }, { name: "Wheelchair", requests: 9, units: 6, available: 3 }, { name: "Hospital Bed", requests: 3, units: 0, available: 0 }],
    loanLength: [{ name: "Wheelchair", loans: 12, medianDays: 18 }, { name: "Knee Scooter", loans: 7, medianDays: 34 }, { name: "Cane", loans: 1, medianDays: 1 }],
    loansReturned: 20, neverLent: { count: 3, types: [{ name: "Shower Chair", count: 2, units: 4 }, { name: "Commode", count: 1, units: 1 }] } },
  "30": { days: 30, requests: { received: 0, confirmed: 0, declined: 0, waiting: 0 }, response: { answered: 0, medianHours: null, within24hPct: null },
    waitingOver48h: { count: 0, oldest: [] }, topRequested: [], loanLength: [], loansReturned: 0, neverLent: { count: 0, types: [] } },
};
const SEARCHES = { days: 90, total: 3, searches: [
  { query: "hospital bed", count: 7, nothingFound: 7, allOnLoan: 0, category: null, lastSearched: ago(20) },
  { query: "knee scooter", count: 4, nothingFound: 0, allOnLoan: 4, category: "Knee Scooters", lastSearched: ago(3) },
  { query: "<img src=x onerror=alert(1)>", count: 1, nothingFound: 1, allOnLoan: 0, category: null, lastSearched: ago(1) },
] };

for (const [w, h, tag] of [[390, 844, "m"], [1100, 900, "d"]]) {
  const { page, errors } = await setup();
  await page.setViewportSize({ width: w, height: h });
  await page.evaluate(() => switchTab("dashboard"));
  await page.waitForSelector("#stats-body .kpi-grid");
  const t = await page.$eval("#stats-body", e => e.innerText);
  ok(/42\s*Requests received/.test(t) && t.includes("33 confirmed · 5 declined · 4 waiting"), tag + " requests KPI");
  ok(t.includes("6 hours") && t.includes("84%"), tag + " reply time KPIs: " + t.slice(0, 200));
  ok(t.includes("2 requests waiting more than 2 days") && t.includes("5 days") && t.includes("55 hours"), tag + " waiting block");
  ok(t.includes("Leah <b>Gold</b>"), tag + " names escaped");
  ok(/Knee Scooter\s*All out/i.test(t) && /Hospital Bed\s*None in stock/i.test(t), tag + " stock tags");
  ok(t.includes("34 days") && t.includes("1 day"), tag + " loan lengths");
  ok(t.includes("3 units never lent out") && t.includes("2 of 4"), tag + " never lent");
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  ok(noHScroll, tag + " no horizontal scroll");
  await page.locator("#screen-dashboard").screenshot({ path: `shot-v7-${tag}-dashboard.png` });
  await page.selectOption("#stats-days", "30");
  await page.waitForFunction(() => /No requests in the last 30 days/.test(document.getElementById("stats-body").innerText));
  const t30 = await page.$eval("#stats-body", e => e.innerText);
  ok(!/waiting more than/.test(t30) && !/never lent/.test(t30) && t30.includes("no replies yet") && t30.includes("—"), tag + " empty period");
  await page.evaluate(() => switchTab("network"));
  await page.waitForSelector("#net-searches table");
  const ns = await page.$eval("#net-searches", e => e.innerText);
  ok(ns.includes("hospital bed") && /Nothing found/i.test(ns) && /All on loan/i.test(ns) && ns.includes("in Knee Scooters"), tag + " network searches");
  ok(await page.$("#net-searches img") === null, tag + " search text escaped");
  if (tag === "m") await page.locator("#net-searches").screenshot({ path: "shot-v7-searches.png" });
  ok(!errors.length, tag + " no page errors " + errors.join(" | "));
  await page.close();
}
await browser.close();
