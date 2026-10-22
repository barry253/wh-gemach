// Dashboard (Oct 22, 2026): one Summary — compact counts, a month grid (↑ pickups / ↓ due back per day, counted per
// booking or borrower, up to 60 days ahead) and Upcoming below. Tapping a date lists that date plus the next 3/7/14/30
// days, including due-backs from active loans; the date starts at today on every visit, the period is remembered.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const NY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const iso = n => { const [y, m, d] = NY().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const T = NY(), D2 = iso(2), D9 = iso(9);
const LOANS = [
  { id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Moshe Levy", borrowerPhone: "5165551111", itemTypeName: "Walker", itemId: "WK-001", dateBorrowed: iso(-5), expectedReturn: D2, overdue: false },
  { id: "recLOAN0000000004", loanId: "L-4", borrowerName: "Moshe Levy", borrowerPhone: "5165551111", itemTypeName: "Shower seat", itemId: "SS-001", dateBorrowed: iso(-5), expectedReturn: D2, overdue: false },
  { id: "recLOAN0000000002", loanId: "L-2", borrowerName: "Sara Weiss", itemTypeName: "Rollator", itemId: "RL-002", dateBorrowed: iso(-20), expectedReturn: iso(-3), overdue: true },
  { id: "recLOAN0000000003", loanId: "L-3", borrowerName: "Open Ended", itemTypeName: "Cane", dateBorrowed: iso(-2), expectedReturn: null, overdue: false },
  { id: "recLOAN0000000005", loanId: "L-5", borrowerName: "Far Away", itemTypeName: "Wheelchair", dateBorrowed: iso(-2), expectedReturn: D9, overdue: false },
];
const R = (id, name, date, items, extra = {}) => ({ kind: "reservation", date, end: iso(20), name, items, requestId: null, photos: [], ref: { loan: id },
  loans: [{ id, loanId: id, borrowerName: name, itemTypeName: items[0], reservationStart: date }], ...extra });
const UPCOMING = { today: T, days: 60, until: iso(60), items: [
  R("recRES00000000003", "Late Pickup", iso(-1), ["Crutches"], { late: true }),
  R("recRES00000000001", "Chana Klein", D2, ["Wheelchair", "Shower seat"]),
  R("recRES00000000009", "Next Week", iso(8), ["Walker"]),
] };
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
const errors = [], reqs = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const u = new URL(r.request().url()), p = u.pathname;
  reqs.push(p + u.search);
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 5, overdueLoans: 1, upcomingReservations: 3 });
  if (p === "/admin/stats") return J({ days: 90, requests: {}, response: {} });
  if (p === "/admin/upcoming") return J(UPCOMING);
  if (p === "/admin/loans") return J(LOANS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); localStorage.setItem("whg_dash_view", "overview"); });
await page.goto("http://admin.test/admin.html");
await page.waitForSelector("#cal-grid .cal-day-btn");
await page.waitForSelector("#upcoming-body .up-row");
const cell = d => page.locator(`.cal-day-btn[data-date="${d}"]`);
const toMonth = async d => { while ((await page.$(`.cal-day-btn[data-date="${d}"]:not(.out)`)) == null && !(await page.isDisabled("#cal-next"))) await page.click("#cal-next"); };

// Layout: one screen — no toggle or strip; counts, then grid, then Upcoming, then stats
ok(!(await page.$(".dash-switch")) && !(await page.$("#week-strip")), "no Calendar | Overview toggle and no 7-day strip");
const top = sel => page.$eval(sel, e => e.getBoundingClientRect().top);
ok(await top("#stat-grid") < await top("#cal-grid") && await top("#cal-grid") < await top("#upcoming-body") && await top("#upcoming-body") < await top("#stats-body"), "counts → calendar → Upcoming → How it's going");
ok(await page.$eval("#stat-grid", e => getComputedStyle(e).gridTemplateColumns.split(" ").length) === 4, "the 4 counts sit in one row");
ok(await page.isVisible("#stats-body"), "How it's going is shown");
ok(reqs.some(r => r === "/admin/upcoming?days=60") && !reqs.some(r => r.startsWith("/admin/reservations")), "loads 60 days of Upcoming once");

// Today, by default: late things first, then today + 6 days, with due-backs
ok(await cell(T).evaluate(e => e.classList.contains("sel") && e.getAttribute("aria-pressed") === "true"), "today is selected");
ok((await page.textContent("#upcoming-range")).startsWith("Today – ") && await page.isHidden("#up-today"), "range says Today – …, no Today link");
const heads = await page.$$eval("#upcoming-body .upcoming-day", h => h.map(x => x.textContent));
ok(heads[0] === "Overdue — still out" && heads[1].startsWith("Pickup date passed"), "today starts with overdue loans, then missed pickups: " + heads.join(" | "));
const body = await page.textContent("#upcoming-body");
ok(/Chana Klein/.test(body) && /Moshe Levy/.test(body) && !/Next Week/.test(body) && !/Far Away/.test(body) && !/Open Ended/.test(body), "7 days: D2's pickup + due-back; not day 8/9; open-ended loans never");
ok(await page.$$eval("#upcoming-body .up-row .tag", t => t.filter(x => x.textContent === "Due back").length) === 1, "Moshe's two items due the same day are one Due back row");

// Grid counts match the rows (per booking / per borrower), late things are not on the grid
await toMonth(D2);
const c2 = await cell(D2).textContent();
ok(/↑1/.test(c2) && /↓1/.test(c2), "D2 shows ↑1 ↓1 (one booking, one borrower): " + c2.replace(/\s+/g, " "));
ok(/1 pickup, 1 due back/.test(await cell(D2).getAttribute("aria-label")), "…and says so to screen readers");

// Due-back row actions
await page.click("#upcoming-body .up-row:has(.tag-green) .up-open");
const panel = await page.innerText("#upcoming-body .up-row.open .up-panel");
ok(/Walker/.test(panel) && /Shower seat/.test(panel) && (panel.match(/✓ Returned/g) || []).length === 2 && /Send reminder/.test(panel), "due-back row: Returned per item + Send reminder");
await page.click("#upcoming-body .up-row.open .up-item >> nth=1 >> button");
await page.waitForFunction(() => document.getElementById("return-sheet")?.classList.contains("open"));
ok(/Moshe Levy · SS-001/.test(await page.textContent("#return-subtitle")), "Returned opens the return sheet for that item");
await page.keyboard.press("Escape");

// Tap a later date: list starts there, range shaded, Today link appears
await toMonth(iso(8));
await cell(iso(8)).click();
ok(await cell(iso(8)).getAttribute("aria-pressed") === "true", "tapped date is selected");
ok(!(await page.isHidden("#up-today")) && !(await page.textContent("#upcoming-range")).startsWith("Today"), "range starts at the tapped date; Today link shown: " + await page.textContent("#upcoming-range"));
const body2 = await page.textContent("#upcoming-body");
ok(/Next Week/.test(body2) && /Far Away/.test(body2) && !/Chana Klein/.test(body2) && !/Overdue/.test(body2), "list: day 8 onward, no late section");
ok(await page.$$eval(".cal-day-btn.inrange", e => e.length) >= 1 && await cell(iso(9)).evaluate(e => e.classList.contains("inrange")), "the following days are shaded");
await page.selectOption("#upcoming-days", "3");
ok((await page.textContent("#upcoming-range")).endsWith(await page.evaluate(d => fmtDay(d), iso(10))), "3 days: tapped date + 2");
ok(await page.evaluate(() => localStorage.getItem("whg_upcoming_days")) === "3", "period remembered");
await page.click("#up-today");
ok((await page.textContent("#upcoming-range")).startsWith("Today"), "Today link goes back to today");

// 60-day limit; past days and days beyond can't be tapped
while (!(await page.isDisabled("#cal-next"))) await page.click("#cal-next");
const beyond = await page.$$eval(".cal-day-btn.beyond", e => e.every(x => x.disabled));
ok(beyond, "days past 60 days ahead are disabled");
ok(await page.$(`.cal-day-btn[data-date="${iso(61)}"]`) == null || await cell(iso(61)).isDisabled(), "day 61 can't be tapped");

// Reload: back to today, period kept; the old view setting is cleared
await cell(iso(60)).click();
await page.reload();
await page.waitForSelector("#upcoming-body .up-row");
ok((await page.textContent("#upcoming-range")).startsWith("Today") && await page.inputValue("#upcoming-days") === "3", "after reopening: today again, 3 days kept");
ok(await page.evaluate(() => localStorage.getItem("whg_dash_view")) === null, "old Calendar | Overview setting removed");
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
