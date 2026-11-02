// Dates in the admin page follow New York, not the phone's own time zone (e.g. an admin on a trip to Israel).
// Clock: 9 pm New York on Tue Dec 15, 2026 = 4 am Wed Dec 16 in Jerusalem.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Jerusalem" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.clock.setFixedTime(new Date("2026-12-15T21:00:00-05:00"));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: "WH Medical" }] });
  if (p === "/admin/gemach") return J({ id: "recA", slug: "wh-medical", name: "WH Medical", templates: {}, rawTemplates: {}, canEdit: true });
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(600);

ok(await page.evaluate(() => new Date().getDate()) === 16 && await page.evaluate(() => nyTodayStr()) === "2026-12-15", "setup: the phone says Dec 16, New York says Dec 15");

// 1. {due_back} in message templates
ok(await page.evaluate(() => dueBackText("2026-12-15")) === "is due back today", "due today in New York reads 'is due back today'");
ok(/^is due back on /.test(await page.evaluate(() => dueBackText("2026-12-16"))), "tomorrow in New York is still upcoming");

// 2. Inventory holds: "within a week" counts from New York's today (Dec 22 is in, Dec 23 is out)
const holds = await page.evaluate(() => {
  inventoryData = [{ id: "u1", itemTypeId: "recT1", status: "Available", active: true, condition: "Good" }];
  const run = start => { inventoryHolds = [{ itemTypeId: "recT1", borrowerName: "Dina", reservationStart: start }]; return holdsHtml({ id: "recT1", name: "Wheelchair" }); };
  return { in: run("2026-12-22"), out: run("2026-12-23") };
});
ok(/class="inv-holds warn"/.test(holds.in), "a reservation 7 days out (New York) counts as soon");
ok(!/warn/.test(holds.out), "a reservation 8 days out (New York) doesn't, even though it's 7 days out on the phone");

// 3. "New for …" button: counted from New York's today
ok(await page.evaluate(() => { setNewUntil(30); return document.getElementById("it-new-until").value; }) === "2027-01-14", "New until = New York today + 30 days");

// 4. Settings example for Event-style gemachs: the next Sunday at least two weeks out from New York's today.
//    9 pm Sun Dec 13 in New York (Mon Dec 14 on the phone): Dec 27 is a Sunday; the phone's date would give Jan 3.
await page.clock.setFixedTime(new Date("2026-12-13T21:00:00-05:00"));
await page.evaluate(() => switchTab("settings"));
await page.waitForSelector('input[name="set-requestStyle"][value="Event"]', { state: "attached", timeout: 10000 }).catch(() => {});
const example = await page.evaluate(() => {
  document.querySelector('input[name="set-requestStyle"][value="Event"]').checked = true;
  updateRequestStyleUi();
  return document.getElementById("event-example").textContent;
});
ok(/Sun,? Dec 27\b/.test(example), "Event example uses New York's today: " + example);

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
