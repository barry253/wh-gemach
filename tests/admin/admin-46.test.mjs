// The phone's Back button (Nov 2026): closes an open sheet or the photo viewer (like Cancel), otherwise goes to
// the tab shown before; a sheet closed with its own buttons leaves no extra Back step; right after start
// there is nothing to go back to inside the app (Back leaves it, as the browser decides).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const G = { id: "recA", slug: "wh-medical", name: "WH", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Email", pickupAddress: "507 Walton" };
const RES = [{ id: "recRES00000000001", loanId: "L-3", borrowerName: "Chana Klein", borrowerEmail: "c@x.com", itemTypeName: "Walker",
  reservationStart: iso(2), reservationEnd: iso(9), manageUrl: "https://whgemachs.org/r/x.y" }];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
// a page before admin, standing in for "leaving the app" (on a phone Back would close it here)
await page.route("http://before.test/**", r => r.fulfill({ contentType: "text/html", body: "<title>before</title>before" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: "WH" }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 1 });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://before.test/");
await page.goto("http://admin.test/admin");
await page.waitForTimeout(700);
const tab = () => page.evaluate(() => navTab());
const back = async () => { await page.goBack({ waitUntil: "commit" }).catch(() => {}); await page.waitForTimeout(250); };
const where = () => page.evaluate(() => location.host);
const open = id => page.$eval("#" + id, e => e.classList.contains("open"));

// 1. just started: Back leaves admin
await back();
ok(await where() === "before.test", "right after start, Back leaves the app");
await page.goForward(); await page.waitForTimeout(700);
ok(await where() === "admin.test" && await tab() === "dashboard", "back in admin on the Dashboard");

// 2. Barry's steps: Reservations → reservation → Send pickup info → Cancel → Back → Dashboard (not out of the app)
await page.click('.nav-tab:has-text("Reservations")'); await page.waitForTimeout(400);
ok(await tab() === "reservations", "on Reservations");
await page.evaluate(r => openPickupInstructions(r, "Walker"), RES[0]);
await page.waitForTimeout(200);
ok(await open("pickup-instructions-sheet"), "pickup sheet open");
await page.click("#pickup-instructions-sheet .sheet-actions .btn-ghost"); // Cancel
await page.waitForTimeout(300);
ok(!(await open("pickup-instructions-sheet")), "Cancel closed it");
await back();
ok(await where() === "admin.test" && await tab() === "dashboard", "Back after Cancel → previous tab (Dashboard), no blank page");
await back();
ok(await where() === "before.test", "Back again on the first screen leaves the app");
await page.goForward(); await page.waitForTimeout(700);

// 3. Back closes an open sheet (like Cancel: typed text isn't asked about), and stays on the tab
await page.click('.nav-tab:has-text("Loans")'); await page.waitForTimeout(300);
await page.click('.nav-tab:has-text("Reservations")'); await page.waitForTimeout(300);
await page.evaluate(r => openPickupInstructions(r, "Walker"), RES[0]); await page.waitForTimeout(200);
await page.fill("#pickup-instructions-message", "typed something");
let dialogs = 0; page.on("dialog", d => { dialogs++; d.accept(); });
await back();
ok(!(await open("pickup-instructions-sheet")) && await tab() === "reservations" && dialogs === 0, "Back closes the sheet, no question, still on Reservations");
await back();
ok(await tab() === "loans", "next Back → Loans");
await back();
ok(await tab() === "dashboard", "next Back → Dashboard");

// 4. stacked sheets: Back closes the top one only; Save-style close then a new sheet keeps history in step
await page.click('.nav-tab:has-text("Reservations")'); await page.waitForTimeout(300);
await page.evaluate(r => { openPickupInstructions(r, "Walker"); openSheet("reminder-sheet"); }, RES[0]); await page.waitForTimeout(200);
await back();
ok(!(await open("reminder-sheet")) && await open("pickup-instructions-sheet"), "stacked: Back closes only the top sheet");
await back();
ok(!(await open("pickup-instructions-sheet")) && await tab() === "reservations", "then the one under it");
await page.evaluate(r => { openPickupInstructions(r, "Walker"); }, RES[0]); await page.waitForTimeout(100);
await page.evaluate(() => { closeSheet("pickup-instructions-sheet"); openSheet("reminder-sheet"); }); // e.g. one sheet leading to the next
await page.waitForTimeout(300);
await back();
ok(!(await open("reminder-sheet")) && await tab() === "reservations", "close + open right away: one Back closes the new sheet");
await back();
ok(await tab() === "dashboard", "…and the next Back goes to the previous tab");
await back();
ok(await where() === "before.test", "…and then leaves the app (no leftover steps)");
ok(!errors.length, "no errors " + errors.join(" | "));
await browser.close();
