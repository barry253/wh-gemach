// History filters (Nov 2026, option B): one swipeable row of groups, a chosen group's kinds in a second row,
// dates as presets in an "Any time" menu (Pick dates… shows From / To), sort beside the summary line.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = { id: "recA", slug: "wh-medical", name: "WH", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [] };
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], hist = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url());
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (u.pathname === "/admin/me") return J({ email: "v@x", name: "Vol", role: "Volunteer", gemachs: [{ id: "recA", slug: "wh-medical", name: "WH" }] });
  if (u.pathname === "/admin/gemach") return J(G);
  if (u.pathname === "/admin/history") {
    hist.push(Object.fromEntries(u.searchParams));
    return J({ records: [{ id: "recL1", timestamp: new Date().toISOString(), eventType: "Request Declined", borrower: "Moshe Klein", loanId: "R-1" }], offset: null });
  }
  if (u.pathname === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin?device=mobile");
await page.waitForTimeout(700);
await page.evaluate(() => switchTab("history"));
await page.waitForSelector(".history-entry");
const last = () => hist[hist.length - 1];
const settle = () => page.waitForTimeout(250);

const groups = await page.$$eval("#history-groups .history-chip", els => els.map(e => [e.textContent.trim(), e.classList.contains("active")]));
ok(groups.length === 7 && groups[0][0] === "All" && groups[0][1] && groups[1][0] === "Requests", "group row: All + 6 groups " + JSON.stringify(groups));
ok(await page.$eval("#history-types", e => e.hidden), "no kinds row until a group is chosen");
ok(await page.$eval("#history-date-row", e => e.hidden), "From / To hidden by default");
ok(!last().eventType && !last().since && !last().dateFrom, "first load: everything");
ok((await page.textContent("#history-summary")) === "All activity", "summary: All activity");
const h = await page.$eval(".history-controls", e => e.getBoundingClientRect().height);
ok(h < 150, `filters take ${Math.round(h)}px on a phone (was ~420)`);
ok(await page.$eval("#history-groups", e => getComputedStyle(e).overflowX === "auto" && getComputedStyle(e).flexWrap === "nowrap"), "groups scroll sideways, one row");

// a group: all its kinds; then one kind
await page.click('#history-groups .history-chip:has-text("Requests")');
await settle();
ok(last().eventType === "Request Received,Request Confirmed,Request Declined,Request Cancelled", "group sends its kinds: " + last().eventType);
const kinds = await page.$$eval("#history-types .history-chip", els => els.map(e => e.textContent.trim()));
ok(!(await page.$eval("#history-types", e => e.hidden)) && kinds[0] === "All requests" && kinds.length === 5, "kinds row " + JSON.stringify(kinds));
ok((await page.textContent("#history-summary")) === "Requests", "summary: the group");
await page.click('#history-types .history-chip:has-text("Request Declined")');
await settle();
ok(last().eventType === "Request Declined", "one kind");
ok(await page.$eval('#history-types .history-chip:has-text("Request Declined")', e => e.classList.contains("active") && e.getAttribute("aria-pressed") === "true"), "the kind is marked chosen");
ok((await page.textContent("#history-summary")) === "Request Declined", "summary: the kind");
await page.click('#history-groups .history-chip:has-text("People")');
await settle();
ok(last().eventType === "Borrower Created" && await page.$eval("#history-types", e => e.hidden), "a one-kind group has no second row");
// every kind in every group has its color
const missing = await page.evaluate(() => HISTORY_GROUPS.flatMap(g => g.types).filter(t => !HISTORY_DOT_COLORS[t]));
ok(!missing.length, "every kind has a dot color " + missing);

// dates: presets
await page.click("#history-when-btn");
ok(!(await page.$eval("#history-when-menu", e => e.hidden)) && (await page.getAttribute("#history-when-btn", "aria-expanded")) === "true", "menu opens");
await page.click('#history-when-menu button:has-text("Last 7 days")');
await settle();
const exp = await page.evaluate(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 6); return d.toISOString(); });
ok(last().since === exp && !last().dateFrom && last().eventType === "Borrower Created", "Last 7 days = since this device's midnight 6 days ago, group kept");
ok(await page.$eval("#history-when-menu", e => e.hidden), "menu closes after a choice");
ok((await page.textContent("#history-when-label")) === "Last 7 days" && await page.$eval("#history-when-btn", e => e.classList.contains("on")), "button shows the choice, highlighted");
ok((await page.textContent("#history-summary")) === "People · last 7 days", "summary includes the dates");
// custom dates
await page.click("#history-when-btn");
const n = hist.length;
await page.click('#history-when-menu button:has-text("Pick dates")');
await settle();
ok(!(await page.$eval("#history-date-row", e => e.hidden)) && hist.length === n, "Pick dates shows From / To, waits for a date");
await page.fill("#history-from", "2026-11-01");
await page.dispatchEvent("#history-from", "change");
await settle();
ok(last().dateFrom === "2026-11-01" && !last().since, "custom From sent, no since");
ok((await page.textContent("#history-when-label")) === "From Nov 1", "button: From Nov 1");
// back to any time
await page.click("#history-when-btn");
await page.click('#history-when-menu button:has-text("Any time")');
await settle();
ok(!last().dateFrom && !last().since && await page.$eval("#history-date-row", e => e.hidden), "Any time clears dates");
// clicking elsewhere closes the menu
await page.click("#history-when-btn");
await page.click("#history-summary");
ok(await page.$eval("#history-when-menu", e => e.hidden), "click outside closes the menu");
// All again, sort still works
await page.click('#history-groups .history-chip:has-text("All")');
await settle();
ok(!last().eventType, "All: no type filter");
await page.click("#history-sort-btn");
await settle();
ok(last().sort === "asc" && /Oldest/.test(await page.textContent("#history-sort-btn")), "sort toggles");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
