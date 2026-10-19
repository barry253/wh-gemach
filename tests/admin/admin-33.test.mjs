// Dashboard Calendar | Overview (Oct 19, 2026): Calendar is the default view — a month grid with ↑ pickups / ↓ due back
// counts per day and the chosen day listed below (by borrower, or by item type when busy); overdue and uncollected
// pickups sit in a banner. Overview is the old dashboard plus a 7-day strip. The chosen view is remembered.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const NY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const iso = n => { const [y, m, d] = NY().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const T = NY(), D2 = iso(2), D3 = iso(3);
const LOANS = [
  { id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Moshe Levy", itemTypeName: "Walker", itemId: "WK-001", dateBorrowed: iso(-5), expectedReturn: D2, overdue: false },
  { id: "recLOAN0000000002", loanId: "L-2", borrowerName: "Sara Weiss", itemTypeName: "Rollator", itemId: "RL-002", dateBorrowed: iso(-20), expectedReturn: iso(-3), overdue: true },
  { id: "recLOAN0000000003", loanId: "L-3", borrowerName: "Open Ended", itemTypeName: "Cane", dateBorrowed: iso(-2), expectedReturn: null, overdue: false },
];
// Two items for one family on D2, and a busy D3 (8 borrowers → rolled up by type)
const RES = [
  { id: "recRES00000000001", loanId: "L-10", borrowerName: "Chana Klein", borrowerPhone: "5165551111", itemTypeName: "Wheelchair", reservationStart: D2, reservationEnd: iso(9) },
  { id: "recRES00000000002", loanId: "L-11", borrowerName: "Chana Klein", itemTypeName: "Shower seat", reservationStart: D2, reservationEnd: iso(9) },
  { id: "recRES00000000003", loanId: "L-12", borrowerName: "Late Pickup", itemTypeName: "Crutches", reservationStart: iso(-1), reservationEnd: iso(6) },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `recRES0000000010${i}`, loanId: `L-2${i}`, borrowerName: `Family ${i}`, itemTypeName: i < 5 ? "Wheelchair" : "Walker", reservationStart: D3, reservationEnd: null })),
];
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

async function open(view) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
    const p = new URL(r.request().url()).pathname;
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 3, overdueLoans: 1, upcomingReservations: 11 });
    if (p === "/admin/stats") return J({ days: 90, requests: {}, response: {} });
    if (p === "/admin/upcoming") return J({ today: T, days: 7, until: iso(7), items: [] });
    if (p === "/admin/loans") return J(LOANS);
    if (p === "/admin/reservations") return J(RES);
    return J([]);
  });
  await page.addInitScript(v => {
    localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical");
    if (v && !sessionStorage.getItem("seeded")) { localStorage.setItem("whg_dash_view", v); sessionStorage.setItem("seeded", "1"); }
  }, view);
  await page.goto("http://admin.test/admin.html");
  await page.waitForSelector("#cal-grid .cal-day-btn", { state: "attached" });
  return { page, errors };
}

// ── Default: Calendar ──
{
  const { page, errors } = await open(null);
  ok(await page.isVisible("#dash-calendar") && !(await page.isVisible("#dash-overview")), "Calendar is the default view");
  ok(await page.getAttribute("#dash-tab-calendar", "aria-pressed") === "true", "…and its toggle is pressed");
  const order = await page.$$eval(".dash-switch button", b => b.map(x => x.textContent.trim()));
  ok(order.join() === "Calendar,Overview", "Calendar comes first, then Overview");

  const cell = d => page.locator(`.cal-day-btn[data-date="${d}"]`);
  // Navigate to the month holding D2 if it's next month
  if (D2.slice(0, 7) !== T.slice(0, 7)) await page.click("#cal-next");
  ok(/↑2/.test(await cell(D2).textContent()) && /↓1/.test(await cell(D2).textContent()), "D2 shows 2 pickups and 1 due back");
  ok(/2 pickups, 1 due back/.test(await cell(D2).getAttribute("aria-label")), "…and says so to screen readers");
  ok(await cell(T).evaluate(e => e.classList.contains("today") && e.getAttribute("aria-pressed") === "true"), "today is marked and selected");

  // Open-ended loans add nothing; overdue / uncollected go to the banner, not the grid
  ok(await page.isVisible("#cal-late") && /1 overdue · 1 pickup not collected/.test(await page.textContent("#cal-late")), "banner: 1 overdue, 1 pickup not collected");
  await page.click("#cal-late");
  const day = await page.textContent("#cal-day");
  ok(/Sara Weiss/.test(day) && /Late Pickup/.test(day) && /Was due/.test(day), "the banner lists who is late");

  // A day with a family picking up two things: one borrower group, two items, Picked up buttons
  await cell(D2).click();
  ok(await page.$$eval("#cal-day .cal-sec.pickup + .cal-who .cal-item", e => e.length) === 2, "D2: Chana Klein's two items under one name");
  ok(/Moshe Levy/.test(await page.textContent("#cal-day")) && /WK-001/.test(await page.textContent("#cal-day")), "D2 due back: Moshe Levy, WK-001");
  await page.click("#cal-day .cal-item button:has-text('Picked up')");
  await page.waitForSelector("#pickup-sheet.open, .sheet.open", { timeout: 3000 }).catch(() => {});
  ok(/Chana Klein/.test(await page.textContent("#pickup-subtitle")), "Picked up opens the pickup sheet for that reservation");
  await page.keyboard.press("Escape");

  // Busy day: rolled up by item type
  if (D3.slice(0, 7) !== D2.slice(0, 7)) await page.click("#cal-next");
  await cell(D3).click();
  const types = await page.$$eval("#cal-day details.cal-type summary", s => s.map(x => x.textContent.replace(/\s+/g, " ").trim()));
  ok(types.length === 2 && /Wheelchair\s*×5/.test(types[0]) && /Walker\s*×3/.test(types[1]), "8 borrowers → grouped by type, biggest first: " + types.join(" | "));

  // Can't go before the current month
  while (!(await page.isDisabled("#cal-prev"))) await page.click("#cal-prev");
  ok(await page.textContent("#cal-title") === new Date(Date.UTC(+T.slice(0, 4), +T.slice(5, 7) - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" }), "Previous stops at this month");

  // Switch to Overview → remembered after reload
  await page.click("#dash-tab-overview");
  ok(await page.isVisible("#dash-overview") && await page.isVisible("#stat-grid") && !(await page.isVisible("#cal-grid")), "Overview shows the counts, not the grid");
  ok(await page.evaluate(() => localStorage.getItem("whg_dash_view")) === "overview", "the choice is saved");
  await page.reload();
  await page.waitForSelector("#week-strip .wk-day");
  ok(await page.isVisible("#dash-overview") && await page.getAttribute("#dash-tab-overview", "aria-pressed") === "true", "…and Overview is still chosen after reloading");

  // Week strip: 7 days, counts, tap opens Calendar on that day
  ok(await page.$$eval("#week-strip .wk-day", e => e.length) === 7, "the strip has 7 days");
  const strip2 = page.locator("#week-strip .wk-day").nth(2);
  ok(/↑2/.test(await strip2.textContent()) && /↓1/.test(await strip2.textContent()), "strip day +2 shows ↑2 ↓1");
  await strip2.click();
  ok(await page.isVisible("#dash-calendar") && await page.getAttribute(`.cal-day-btn[data-date="${D2}"]`, "aria-pressed") === "true", "tapping it opens the Calendar on that day");
  ok(await page.evaluate(() => localStorage.getItem("whg_dash_view")) === "calendar", "…and Calendar is remembered again");
  ok(!errors.length, "no page errors " + errors.join(" | "));
  await page.close();
}

await browser.close();
