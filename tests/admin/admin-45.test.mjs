// Copy button on message boxes, and pickup photos on "Send pickup instructions" (Nov 2026).
// Copy: copies the box's text as is, sends nothing. Photos: one "Add photo" button (the phone's own picker),
// up to 3, uploaded to /admin/loans/:id/pickup-photo; the message gets one link after its first paragraph;
// removing deletes on the server; email sends { photos: set }; closing without sending deletes the set.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = {
  id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", email: "wh@example.com", phone: "(718) 986-7345", mode: "Full",
  pickupAddress: "507 Walton Court", pickupInstructions: "In the driveway", rawTemplates: {}, canEdit: true, primaryContact: "Email",
  templates: { confirm: "Hi {first_name}, we have {items} for you.\n\nManage or cancel: {manage_link}", decline: "x", appointment: "x",
    pickup: "Hi {first_name}, your {items} is ready for pickup at {pickup_address}, {pickup_instructions}.\n\nPlease let us know when it's picked up.\n\nManage your loan: {manage_link}" },
  itemAttributes: [], requestStyle: "Dates", availabilityMode: "Now", localPlaces: [], policies: null,
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [], calls = [];
let uploads = 0;
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request(); const p = new URL(req.url()).pathname;
  let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
  calls.push({ method: req.method(), path: p, body, multipart: /multipart/.test(req.headers()["content-type"] || "") });
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (/\/pickup-photo$/.test(p)) {
    uploads++;
    return J({ success: true, set: "SETSETSETSETSETSETSET1", url: "https://whgemachs.org/p/SETSETSETSETSETSETSET1", name: `${uploads}-abcdefgh.jpg` });
  }
  if (req.method() === "DELETE") return J({ success: true, photos: [] });
  if (/\/pickup-email$/.test(p)) return J({ success: true });
  return J([]);
});
// http://admin.test isn't a secure origin, so there's no real clipboard: record what's written.
await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async t => { window.__clip = t; } } }); });
await page.addInitScript(slug => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", slug); }, G.slug);
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(700);

const LOAN = { id: "recLOAN0000000001", borrowerName: "Sarah Horowitz", borrowerEmail: "sarah@example.com", borrowerPhone: "(516) 555-0101",
  preferredContact: "Email", itemTypeName: "Wheelchair", manageUrl: "https://whgemachs.org/r/abc.def" };
const openPI = () => page.evaluate(l => openPickupInstructions(l, "Wheelchair and Rollator Walker"), LOAN);
await openPI();
await page.waitForSelector("#pickup-instructions-sheet.open");

// ── Copy ──
for (const id of ["confirm-message", "appointment-message", "decline-message", "return-message", "checkout-message", "pickup-instructions-message", "reminder-message", "bk-message"])
  ok(await page.$(`.copy-msg-btn[data-copy-for="${id}"]`), `Copy button on ${id}`);
const msg0 = await page.inputValue("#pickup-instructions-message");
ok(msg0.includes("https://whgemachs.org/r/abc.def") && !msg0.includes("{manage_link}"), "message already has the real link");
const before = calls.length;
await page.click('.copy-msg-btn[data-copy-for="pickup-instructions-message"]');
await page.waitForTimeout(150);
ok(await page.evaluate(() => window.__clip) === msg0, "Copy puts the message on the clipboard");
ok((await page.textContent('.copy-msg-btn[data-copy-for="pickup-instructions-message"]')).includes("Copied"), "button says ✓ Copied");
ok(calls.length === before, "copying sends nothing");

// ── Photos ──
ok(await page.$eval("#pi-photo-input", e => e.accept === "image/*" && !e.hasAttribute("capture")), "one picker (no capture attribute: the phone offers camera or library)");
ok((await page.textContent("#pi-photo-btn")).includes("Add photo"), "Add photo button");
await page.setInputFiles("#pi-photo-input", { name: "a.png", mimeType: "image/png", buffer: PNG });
await page.waitForFunction(() => document.querySelectorAll("#pi-photos .pi-photo-x").length === 1);
let m = await page.inputValue("#pickup-instructions-message");
ok(/In the driveway\.\n\nPickup photo: https:\/\/whgemachs\.org\/p\/SETSETSETSETSETSETSET1\n\nPlease let us know/.test(m), "link goes after the first paragraph: " + JSON.stringify(m));
const up = calls.find(c => /\/admin\/loans\/recLOAN0000000001\/pickup-photo$/.test(c.path));
ok(up && up.multipart && up.method === "POST", "uploaded as a file for this loan");
await page.setInputFiles("#pi-photo-input", { name: "b.png", mimeType: "image/png", buffer: PNG });
await page.waitForFunction(() => document.querySelectorAll("#pi-photos .pi-photo-x").length === 2);
m = await page.inputValue("#pickup-instructions-message");
ok(m.includes("Pickup photos: https://whgemachs.org/p/SET") && (m.match(/whgemachs\.org\/p\//g) || []).length === 1, "still one link, now “Pickup photos”");
await page.setInputFiles("#pi-photo-input", { name: "c.png", mimeType: "image/png", buffer: PNG });
await page.waitForFunction(() => document.querySelectorAll("#pi-photos .pi-photo-x").length === 3);
ok(await page.$eval("#pi-photo-btn", e => getComputedStyle(e).display === "none"), "button hidden at 3 photos");
await page.screenshot({ path: "shot-pickup-photos.png" });
// remove one → that photo deleted on the server
await page.click('#pi-photos .pi-photo-x[aria-label="Remove photo 2"]');
await page.waitForTimeout(150);
ok(calls.some(c => c.method === "DELETE" && c.path === "/admin/pickup-photos/SETSETSETSETSETSETSET1/2-abcdefgh.jpg"), "removing deletes that photo");
ok(await page.$eval("#pi-photo-btn", e => getComputedStyle(e).display !== "none"), "button back under 3");
// send by email: photos go with it
await page.click("#pickup-instructions-send-btn");
await page.waitForTimeout(250);
const sent = calls.find(c => /\/pickup-email$/.test(c.path));
ok(sent && sent.body.photos === "SETSETSETSETSETSETSET1" && sent.body.message.includes("Pickup photos: https://whgemachs.org/p/"), "email sends the set + message with the link");
ok(!calls.some(c => c.method === "DELETE" && c.path === "/admin/pickup-photos/SETSETSETSETSETSETSET1"), "sent: photos kept");

// a fresh sheet starts empty; closing without sending deletes what was uploaded
await openPI();
await page.waitForSelector("#pickup-instructions-sheet.open");
ok(await page.$$eval("#pi-photos .pi-photo", x => x.length) === 0 && !(await page.inputValue("#pickup-instructions-message")).includes("/p/"), "next sheet starts without photos");
await page.setInputFiles("#pi-photo-input", { name: "d.png", mimeType: "image/png", buffer: PNG });
await page.waitForFunction(() => document.querySelectorAll("#pi-photos .pi-photo-x").length === 1);
// removing the only photo takes the link out of the message
await page.click('#pi-photos .pi-photo-x');
await page.waitForTimeout(150);
m = await page.inputValue("#pickup-instructions-message");
ok(!m.includes("/p/") && /In the driveway\.\n\nPlease let us know/.test(m), "last photo removed: link line gone " + JSON.stringify(m));
ok(calls.some(c => c.method === "DELETE" && c.path === "/admin/pickup-photos/SETSETSETSETSETSETSET1"), "…and the set deleted");
const nDel = calls.filter(c => c.method === "DELETE").length;
await page.setInputFiles("#pi-photo-input", { name: "e.png", mimeType: "image/png", buffer: PNG });
await page.waitForFunction(() => document.querySelectorAll("#pi-photos .pi-photo-x").length === 1);
await page.evaluate(() => closeSheet("pickup-instructions-sheet"));
await page.waitForTimeout(150);
ok(calls.filter(c => c.method === "DELETE").length === nDel + 1 && calls.at(-1).path === "/admin/pickup-photos/SETSETSETSETSETSETSET1", "closed without sending: photos deleted");

ok(!errors.length, "no errors " + errors.join(" | "));
await browser.close();
