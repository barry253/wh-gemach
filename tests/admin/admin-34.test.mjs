// Settings → Gemach info: "Different amount for local borrowers" (local towns + local payment text);
// request cards show the borrower's town with Local rate / Not local; {deposit_info} uses the local text.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = {
  id: "recA", slug: "shulchan-yehuda", name: "Shulchan Yehuda", email: "s@example.com", phone: "(516) 555-1234", mode: "Full",
  pickupAddress: "", pickupInstructions: "", rawTemplates: {}, canEdit: true, primaryContact: "Email",
  templates: { confirm: "Hi {first_name}, {items} are yours. {deposit_info}", decline: "x", pickup: "x", appointment: "x" },
  itemAttributes: [], requestStyle: "Dates", availabilityMode: "Now",
  depositRequired: true, chargeType: "Payment", depositInfo: "Non-West Hempstead fee: $75 for 24 tablecloths.",
  localPlaces: [], localDepositInfo: null,
};
const soon = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const REQS = [
  { id: "recR1", requestId: "R-1", name: "Leah Local", phone: "(516) 555-0001", email: "l@x.com", preferredContact: "Email", requestType: "Loan",
    itemNames: ["Navy Round × 6"], items: [{ id: "recT1", name: "Navy Round", quantity: 6, available: 12, owned: 12 }],
    neededFrom: soon(5), neededUntil: soon(7), receivedAt: new Date().toISOString(), depositAcknowledged: true, town: "W. Hempstead", paymentTier: "Local" },
  { id: "recR2", requestId: "R-2", name: "Ora Away", phone: "(516) 555-0002", email: "o@x.com", preferredContact: "Email", requestType: "Loan",
    itemNames: ["Navy Round × 6"], items: [{ id: "recT1", name: "Navy Round", quantity: 6, available: 12, owned: 12 }],
    neededFrom: soon(5), neededUntil: soon(7), receivedAt: new Date().toISOString(), depositAcknowledged: true, town: "Teaneck, NJ", paymentTier: "Standard" },
];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [], calls = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request(); const p = new URL(req.url()).pathname;
  let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
  calls.push({ method: req.method(), path: p, body });
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach" && req.method() === "PATCH") {
    // like the worker: towns come back as a tidied list
    body = { ...body };
    if ("localPlaces" in body) body.localPlaces = String(body.localPlaces).split(",").map(s => s.trim()).filter(Boolean);
    if (body.localDepositInfo === "") body.localDepositInfo = null;
    Object.assign(G, body); return J(G);
  }
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/requests") return J(REQS);
  if (p === "/admin/dashboard") return J({ newRequests: 2, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/history") return J({ records: [], offset: null });
  return J([]);
});
await page.addInitScript(slug => {
  localStorage.setItem("gemach_token", "fake.token.x");
  localStorage.setItem("gemach_slug", slug);
}, G.slug);
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(600);
const lastPatch = () => calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);

await page.click("text=Settings");
await page.click("#set-tab-page");
await page.waitForSelector("#set-localTier");
ok(!(await page.isChecked("#set-localTier")) && !(await page.isVisible("#local-tier-wrap")), "off by default; towns hidden");
await page.check("#set-localTier");
ok(await page.isVisible("#set-localPlaces") && await page.isVisible("#set-localDepositInfo"), "ticking shows towns + local payment");
ok((await page.textContent('label[for="set-depositInfo"]')).includes("everyone else"), "main text relabelled “for everyone else”");
await page.click("#settings-save-btn");
await page.waitForTimeout(300);
ok(!lastPatch() && /local towns/.test(await page.textContent("body")), "can't save with the fields empty");
await page.fill("#set-localPlaces", "West Hempstead, W. Hempstead, WH, 11552, Franklin Square");
await page.fill("#set-localDepositInfo", "West Hempstead resident fee: $36 minimum donation.");
await page.evaluate(() => document.getElementById("local-tier-wrap").scrollIntoView());
await page.screenshot({ path: "shot-local-tier-settings.png" });
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
let sp = lastPatch();
ok(sp && sp.body.localPlaces === "West Hempstead, W. Hempstead, WH, 11552, Franklin Square" && /\$36/.test(sp.body.localDepositInfo), "PATCH sends towns + local text " + JSON.stringify(sp && sp.body));
await page.waitForTimeout(400);
ok(await page.isChecked("#set-localTier") && (await page.inputValue("#set-localPlaces")).includes("Franklin Square"), "kept after save (list shown comma-separated)");

// Request cards: town + tier tag; the confirm message's {deposit_info} follows the tier.
await page.evaluate(() => switchTab("requests"));
await page.waitForSelector("#requests-list .card");
const cards = await page.$$eval("#requests-list .card", els => els.map(e => e.textContent));
ok(/W\. Hempstead\s*Local rate/.test(cards[0]), "local request shows town + Local rate");
ok(/Teaneck, NJ\s*Not local/.test(cards[1]), "other request shows town + Not local");
await page.screenshot({ path: "shot-local-tier-requests.png" });
await page.click("#requests-list .card:nth-child(1) button.btn-primary");
await page.waitForSelector("#confirm-message");
ok(/\$36 minimum/.test(await page.inputValue("#confirm-message")), "confirm message: local text for a local borrower");
await page.evaluate(() => closeSheet("confirm-sheet"));
await page.click("#requests-list .card:nth-child(2) button.btn-primary");
await page.waitForTimeout(200);
ok(/\$75 for 24/.test(await page.inputValue("#confirm-message")), "confirm message: usual text otherwise");
await page.evaluate(() => closeSheet("confirm-sheet"));

// Unticking clears both.
await page.click("text=Settings");
await page.click("#set-tab-page");
await page.waitForSelector("#set-localTier");
await page.uncheck("#set-localTier");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
sp = lastPatch();
ok(sp && sp.body.localPlaces === "" && sp.body.localDepositInfo === "", "unticking clears both " + JSON.stringify(sp && sp.body));

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
