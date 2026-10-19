// Accessibility (Oct 18, 2026): every bottom sheet is a modal dialog for keyboard / screen-reader users —
// named by its heading, focus moves in, the page behind is inert, Escape closes the top sheet (asking first if
// something was typed), and focus returns to the button that opened it. Sheet "×" buttons are named "Close".
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const REQS = [{ id: "recREQA11Y0000001", requestId: "R-1", name: "Rivka Test", phone: "5165551234", email: "x@example.com", preferredContact: "Email",
  itemNames: ["Walker"], items: [{ id: "recTYPEWALK000001", name: "Walker", quantity: null }], neededFrom: "2026-11-01", neededUntil: "2026-11-03",
  openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" }];
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
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
  if (p === "/admin/dashboard") return J({ newRequests: 1, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/stats") return J({ days: 30, requests: {}, response: {} });
  if (p === "/admin/requests") return J(REQS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=desktop");
await page.waitForTimeout(400);

// Every sheet: dialog role, aria-modal, a name from its heading, a named Close button.
const sheets = await page.$$eval(".sheet-overlay", els => els.map(el => {
  const d = el.querySelector("[role=dialog]");
  const name = d && document.getElementById(d.getAttribute("aria-labelledby") || "")?.textContent.trim();
  const closes = [...el.querySelectorAll(".sheet-close")];
  return { id: el.id, dialog: !!d, modal: d?.getAttribute("aria-modal") === "true", name, closeOk: closes.every(b => b.getAttribute("aria-label") === "Close" && b.type === "button") };
}));
ok(sheets.length >= 20, `found the sheets (${sheets.length})`);
ok(sheets.every(s => s.dialog && s.modal), "every sheet is a modal dialog: " + sheets.filter(s => !s.dialog || !s.modal).map(s => s.id).join(", "));
ok(sheets.every(s => s.name), "every sheet is named by its heading: " + sheets.filter(s => !s.name).map(s => s.id).join(", "));
ok(sheets.every(s => s.closeOk), "every × is a button named Close");

// Open Decline from the request card with the keyboard.
await page.click("#tab-requests");
await page.waitForSelector("#requests-list .card");
const declineBtn = page.locator("#requests-list button", { hasText: "Decline" }).first();
await declineBtn.focus();
await page.keyboard.press("Enter");
await page.waitForSelector("#decline-sheet.open");
await page.waitForTimeout(50);
const sz = await page.$eval("#decline-sheet .sheet-close", b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
ok(sz[0] >= 44 && sz[1] >= 44, `× is at least 44px (${sz.map(Math.round).join("×")})`);
ok(await page.evaluate(() => document.getElementById("decline-sheet").contains(document.activeElement)), "focus moved into the sheet");
ok(await page.evaluate(() => document.getElementById("app").inert === true), "the page behind is inert");
let outside = 0;
for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => document.getElementById("decline-sheet").contains(document.activeElement) || document.activeElement === document.body))) outside++; }
ok(outside === 0, "Tab never reaches the page behind");

await page.keyboard.press("Escape");
await page.waitForTimeout(50);
ok(!(await page.isVisible("#decline-sheet.open")), "Escape closes the sheet");
ok(await page.evaluate(() => document.getElementById("app").inert === false && document.body.style.overflow === ""), "page usable again after close");
ok(await page.evaluate(() => /Decline/.test(document.activeElement?.textContent || "")), "focus returned to the Decline button");

// Typed something → Escape asks first; dismissing keeps the sheet and what was typed.
await page.keyboard.press("Enter");
await page.waitForSelector("#decline-sheet.open");
const field = page.locator("#decline-sheet textarea").first();
await field.fill("Sorry, all out this week");
let asked = 0;
page.once("dialog", d => { asked++; d.dismiss(); });
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
ok(asked === 1 && await page.isVisible("#decline-sheet.open"), "Escape after typing asks first and keeps the sheet when dismissed");
page.once("dialog", d => { asked++; d.accept(); });
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
ok(asked === 2 && !(await page.isVisible("#decline-sheet.open")), "…and closes when confirmed");

// Stacked sheets: the one underneath stays open and becomes active again.
await page.evaluate(() => { openSheet("decline-sheet"); openSheet("return-sheet"); });
await page.waitForTimeout(50);
ok(await page.evaluate(() => document.getElementById("decline-sheet").inert === true && document.getElementById("return-sheet").inert === false), "with two sheets open only the top one is usable");
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
ok(await page.evaluate(() => !document.getElementById("return-sheet").classList.contains("open") && document.getElementById("decline-sheet").classList.contains("open")
  && document.getElementById("decline-sheet").inert === false && document.getElementById("app").inert === true), "Escape closes only the top sheet");
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
ok(await page.evaluate(() => !document.querySelector(".sheet-overlay.open") && document.getElementById("app").inert === false), "second Escape closes the last one");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
