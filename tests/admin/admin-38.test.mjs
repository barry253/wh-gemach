// "Item returned" message (Oct 22, 2026): the Return sheet offers the gemach's "Item returned" template
// (Settings → Message templates), filled with its donation details from Settings → Donations. Email is sent by the
// server with the return; WhatsApp / text open on the phone with an email copy. When other items from the same
// booking are still out, the sheet starts on "Don't send".
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const P = (name, phone, email) => ({ borrowerName: name, borrowerPhone: phone, borrowerEmail: email, borrowerContact: "Email" });
const LOANS = [
  // Rivka: two items from one request
  { id: "recLOANRIVKA0001", status: "Active", ...P("Rivka Adler", "5165551111", "rivka@example.com"), itemTypeName: "Wheelchair", itemId: "WC-001",
    dateBorrowed: "2026-10-01", requestRecId: "recREQRIVKA0001", request: { requestId: "R-101" } },
  { id: "recLOANRIVKA0002", status: "Active", ...P("Rivka Adler", "5165551111", "rivka@example.com"), itemTypeName: "Walker", itemId: "WK-002",
    dateBorrowed: "2026-10-01", requestRecId: "recREQRIVKA0001", request: { requestId: "R-101" } },
  // Dina: one item
  { id: "recLOANDINA00001", status: "Active", ...P("Dina Stern", "5165552222", "dina@example.com"), itemTypeName: "Shower chair", itemId: "SC-003",
    dateBorrowed: "2026-10-05", requestRecId: null, request: null },
];
const G = { id: "recA", slug: "wh-medical", name: "WH Medical Gemach", requestStyle: "Dates", templates: {}, rawTemplates: {}, canEdit: true,
  placeholders: ["first_name", "items", "gemach", "donation_info", "donation_link"],
  donationInfo: "Donations of any amount help us buy new equipment.", donationUrl: "https://example.org/donate", returnedMessageOn: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
const posts = [];
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (r.request().method() === "POST") {
    const body = JSON.parse(r.request().postData() || "{}");
    posts.push({ p, body });
    return J({ success: true, ...(body.via === "email" || body.emailCopy ? { emailSent: true } : {}) });
  }
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 3, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/loans") return J(LOANS);
  return J([]);
});
await page.addInitScript(() => {
  localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical");
  window.__opened = [];
  window.open = (u) => { window.__opened.push(String(u)); return null; };
});
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForFunction(() => typeof switchTab === "function" && document.getElementById("app")?.style.display !== "none");
await page.evaluate(() => switchTab("loans"));
await page.waitForFunction(() => document.querySelectorAll("#loans-list .loan-row, #loans-list [data-loans]").length >= 2, null, { timeout: 8000 });
const toasts = () => page.evaluate(() => [...document.querySelectorAll("body > div")].map(d => d.textContent).filter(t => t && t.length < 300));

// 1. Single-item loan: message with donation details, Email chosen
await page.evaluate(() => openReturn(allLoans.find(l => l.id === "recLOANDINA00001")));
await page.waitForTimeout(150);
let msg = await page.inputValue("#return-message");
ok(/^Hi Dina, thank you for returning the Shower chair to the WH Medical Gemach/.test(msg), "message starts with the template: " + JSON.stringify(msg));
ok(msg.includes("Donations of any amount help us buy new equipment.") && msg.includes("Donate online: https://example.org/donate"), "donation info + link filled in");
ok(await page.isHidden("#return-msg-note"), "no 'still out' note for a single-item booking");
ok(await page.textContent("#return-submit-btn") === "Return & email", "button says Return & email: " + await page.textContent("#return-submit-btn"));
await page.fill("#return-message", "Thanks Dina! Donate at example.org.");
await page.click("#return-submit-btn");
await page.waitForTimeout(400);
let post = posts.find(x => x.p === "/admin/loans/recLOANDINA00001/return");
ok(post && post.body.via === "email" && post.body.message === "Thanks Dina! Donate at example.org." && !post.body.emailCopy, "return posts via email with the edited message " + JSON.stringify(post?.body));
ok((await toasts()).some(t => /thank-you emailed/.test(t)), "toast: thank-you emailed");

// 2. Booking with another item still out: starts on Don't send, with a note
await page.evaluate(() => openReturn(allLoans.find(l => l.id === "recLOANRIVKA0001")));
await page.waitForTimeout(150);
ok(await page.isVisible("#return-msg-note") && /1 other item is from this booking still out/.test(await page.textContent("#return-msg-note")), "note: other item still out");
ok(await page.evaluate(() => SEND_BY.return.choice) === "none" && await page.textContent("#return-submit-btn") === "Confirm return", "starts on Don't send");
await page.click("#return-submit-btn");
await page.waitForTimeout(400);
post = posts.find(x => x.p === "/admin/loans/recLOANRIVKA0001/return");
ok(post && !post.body.via && !post.body.message, "Don't send: no message posted " + JSON.stringify(post?.body));

// 3. WhatsApp from the phone, with an email copy
await page.evaluate(() => openReturn(allLoans.find(l => l.id === "recLOANRIVKA0002")));
await page.waitForTimeout(150);
await page.click('#return-send-by [data-send="whatsapp"]');
ok(await page.textContent("#return-submit-btn") === "Return & open WhatsApp", "WhatsApp button label");
await page.click("#return-submit-btn");
await page.waitForTimeout(400);
const opened = await page.evaluate(() => window.__opened.splice(0));
ok(opened.length === 1 && opened[0].startsWith("https://wa.me/15165551111?text=Hi%20Rivka"), "wa.me opened with the message " + JSON.stringify(opened));
post = posts.find(x => x.p === "/admin/loans/recLOANRIVKA0002/return");
ok(post && post.body.via === "whatsapp" && post.body.emailCopy === true && /^Hi Rivka/.test(post.body.message), "posted via WhatsApp with emailCopy");

// 4. No donation details: those lines drop out
const plain = await page.evaluate(() => { GEMACH.donationInfo = null; GEMACH.donationUrl = null; return renderMessage("returned", "Dina", "Shower chair", {}); });
ok(!/Donate|donation|\{/.test(plain) && /We hope it helped!\n\nThank you!$/.test(plain), "without donation details the message is a plain thank-you: " + JSON.stringify(plain));

// 5. Setting off (the default): the sheet just marks it returned, as before
await page.evaluate(() => { GEMACH.returnedMessageOn = false; openReturn(allLoans.find(l => l.id === "recLOANDINA00001")); });
await page.waitForTimeout(150);
ok(await page.isHidden("#return-msg-group") && await page.isHidden("#return-send-by"), "off: no message or send choice");
ok(await page.textContent("#return-submit-btn") === "Confirm return", "off: button says Confirm return");
posts.length = 0;
await page.click("#return-submit-btn");
await page.waitForTimeout(400);
post = posts.find(x => x.p === "/admin/loans/recLOANDINA00001/return");
ok(post && !post.body.via && !post.body.message, "off: plain return posted " + JSON.stringify(post?.body));

// 6. Settings lists the template (default shown as placeholder) and the on/off switch
await page.evaluate(() => { switchTab("settings"); });
await page.waitForSelector("#set-returnedMessage", { state: "attached", timeout: 8000 });
ok(/\{donation_info\}/.test(await page.getAttribute("#set-returnedMessage", "placeholder")), "Settings has the Item returned template");
ok(await page.$("#set-returnedMessageOn") && await page.isChecked("#set-returnedMessageOn"), "Settings switch shows the saved value (on)");

ok(errors.length === 0, "no page errors " + errors.join(" | "));
await browser.close();
