// History → "View email" (Nov 2026): events that sent a borrower email open a copy of it (sandboxed, no scripts);
// failed / not-sent copies say so; copies older than a year show "no longer available". Pickup info by WhatsApp
// to a borrower without email is still logged (pickup-email with via, no copy).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = { id: "recA", slug: "wh-medical", name: "WH", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Email", pickupAddress: "507 Walton" };
const now = new Date().toISOString();
const HISTORY = [
  { id: "recL1", timestamp: now, eventType: "Request Confirmed", borrower: "Copy Person", loanId: "R-1", emailId: "recSENT0000000001", emailStatus: "Sent" },
  { id: "recL2", timestamp: now, eventType: "Pickup Info Not Sent", borrower: "Fail Person", loanId: "L-2", emailId: "recSENT0000000002", emailStatus: "Failed" },
  { id: "recL3", timestamp: now, eventType: "Pickup Info Sent", borrower: "Old Person", loanId: "L-3", emailId: "recSENT0000000003", emailStatus: "Gone" },
  { id: "recL4", timestamp: now, eventType: "Item Returned", borrower: "Plain Person", loanId: "L-4" },
];
const EMAILS = {
  recSENT0000000001: { id: "recSENT0000000001", sentAt: now, kind: "confirm", to: "copy@example.com", subject: "Your WH Request — Confirmed", status: "Sent",
    text: "Hi Copy", html: '<p id="msg">Hi Copy, it is reserved.</p><script>parent.document.title="HACKED"</script>', files: ["appointment.ics"], photos: 0 },
  recSENT0000000002: { id: "recSENT0000000002", sentAt: now, kind: "pickup", to: "fail@example.com", subject: "Pickup details — WH", status: "Failed",
    error: "The email service didn't accept it.", text: "Ready at the door", html: null, files: [], photos: 2 },
};
const RES = [{ id: "recRES00000000001", loanId: "L-9", borrowerName: "Phone Only", borrowerPhone: "5165554444", borrowerEmail: "", borrowerContact: "WhatsApp",
  itemTypeName: "Walker", reservationStart: null, reservationEnd: null }];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [], calls = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request();
  const p = new URL(req.url()).pathname;
  calls.push({ method: req.method(), path: p, body: req.postData() ? JSON.parse(req.postData()) : null });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "v@x", name: "Vol", role: "Volunteer", gemachs: [{ id: "recA", slug: "wh-medical", name: "WH" }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/history") return J({ records: HISTORY, offset: null });
  if (p === "/admin/reservations") return J(RES);
  let m;
  if ((m = p.match(/^\/admin\/emails\/(.+)$/))) return EMAILS[m[1]] ? J(EMAILS[m[1]]) : J({ error: "This email is no longer available. Copies are kept for a year." }, 404);
  if (/\/pickup-email$/.test(p)) return J({ success: true });
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  return J([]);
});
await page.addInitScript(() => {
  try { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); } catch {} // (also runs in the sandboxed email frame)
  window.__opened = [];
  window.open = u => { window.__opened.push(String(u)); return null; };
});
await page.goto("http://admin.test/admin?device=mobile");
await page.waitForTimeout(700);
await page.evaluate(() => switchTab("history"));
await page.waitForSelector(".history-entry");

const btns = await page.$$eval(".history-email", els => els.map(e => [e.tagName, e.textContent.trim(), e.className]));
ok(btns.length === 3, "three events carry an email " + JSON.stringify(btns));
ok(btns[0][0] === "BUTTON" && /View email/.test(btns[0][1]) && !/bad/.test(btns[0][2]), "sent: View email");
ok(btns[1][0] === "BUTTON" && /didn't send/.test(btns[1][1]) && /bad/.test(btns[1][2]), "failed: says so, in red");
ok(btns[2][0] === "DIV" && /no longer available/.test(btns[2][1]), "older than a year: no button");
ok((await page.$$eval(".history-entry", els => els[3].querySelector(".history-email"))) === null, "no email, no link");

// open a sent one: to / subject / attachment, rendered in a sandboxed frame without scripts
await page.click(".history-email >> nth=0");
await page.waitForSelector("#email-view-sheet.open .email-view-frame");
const body = await page.textContent("#email-view-body");
ok(/copy@example\.com/.test(body) && /Your WH Request — Confirmed/.test(body) && /Attached: appointment\.ics/.test(body), "to, subject, attachment shown");
const sandbox = await page.$eval(".email-view-frame", f => f.getAttribute("sandbox"));
ok(sandbox !== null && !/allow-scripts|allow-same-origin/.test(sandbox), "sandboxed: no scripts, no access to admin " + sandbox);
const frame = await (await page.$(".email-view-frame")).contentFrame();
await page.waitForTimeout(200);
ok(/it is reserved/.test(await frame.textContent("#msg")), "the email shows in the frame");
ok(await page.title() !== "HACKED", "script in the email didn't run");
await page.click("#email-view-sheet .sheet-close");
await page.waitForTimeout(250);
ok(!(await page.$eval("#email-view-sheet", e => e.classList.contains("open"))), "× closes it");

// a failed one: red note, plain text, photos noted
await page.click(".history-email >> nth=1");
await page.waitForSelector("#email-view-sheet.open .email-view-text");
const fb = await page.textContent("#email-view-body");
ok(/didn't send/.test(fb) && /meant to go/.test(fb), "failed: explains");
ok(/2 pickup photos were attached/.test(fb), "photos noted");
ok((await page.textContent(".email-view-text")) === "Ready at the door", "plain text when there's no HTML");
await page.click("#email-view-sheet .sheet-close");
await page.waitForTimeout(250);

// an id that's gone (opened from an old page): the server's message
await page.evaluate(() => openSentEmail("recSENT0000000009"));
await page.waitForTimeout(300);
ok(/no longer available/.test(await page.textContent("#email-view-body")), "deleted copy: says so");
await page.click("#email-view-sheet .sheet-close");
await page.waitForTimeout(250);

// Pickup info by WhatsApp, borrower has no email: still logged (via whatsapp, no copy asked)
await page.evaluate(() => switchTab("reservations"));
await page.waitForTimeout(400);
await page.evaluate(r => openPickupInstructions(r, "Walker"), RES[0]);
await page.waitForSelector(`#pickup-instructions-send-by [data-send="whatsapp"]`, { state: "visible" });
await page.click(`#pickup-instructions-send-by [data-send="whatsapp"]`);
await page.click("#pickup-instructions-send-btn");
await page.waitForTimeout(400);
const pe = calls.filter(c => /\/pickup-email$/.test(c.path));
ok(pe.length === 1 && pe[0].body.via === "whatsapp" && pe[0].body.emailCopy === false, "logged with via WhatsApp, no email copy " + JSON.stringify(pe.map(c => c.body)));
ok((await page.evaluate(() => window.__opened)).some(u => /wa\.me|whatsapp/.test(u)), "WhatsApp opened");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
