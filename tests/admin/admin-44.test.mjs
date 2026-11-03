// Settings → Your page → Gemach info: "Gemach policies" (multi-line, saved with line breaks; cleared with blank);
// the Confirm message carries them before the manage link (or where the template puts {policies}).
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
  templates: { confirm: "Hi {first_name}, we have {items} for you.\n\nManage or cancel: {manage_link}\n\nThank you!", decline: "x", pickup: "x", appointment: "x" },
  itemAttributes: [], requestStyle: "Dates", availabilityMode: "Now",
  depositRequired: true, chargeType: "Payment", depositInfo: "$75 for 24 tablecloths.", localPlaces: [], localDepositInfo: null, policies: null,
};
const soon = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const REQS = [{ id: "recR1", requestId: "R-1", name: "Leah Katz", phone: "(516) 555-0001", email: "l@x.com", preferredContact: "Email", requestType: "Loan",
  itemNames: ["Navy Round × 6"], items: [{ id: "recT1", name: "Navy Round", quantity: 6, available: 12, owned: 12 }], manageUrl: "https://whgemachs.org/r/abc.def",
  neededFrom: soon(5), neededUntil: soon(7), receivedAt: new Date().toISOString(), depositAcknowledged: true, town: "Lynbrook" }];
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
    body = { ...body }; if (body.policies === "") body.policies = null;
    Object.assign(G, body); return J(G);
  }
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/requests") return J(REQS);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/history") return J({ records: [], offset: null });
  return J([]);
});
await page.addInitScript(slug => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", slug); }, G.slug);
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(600);
const lastPatch = () => calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);

await page.click("text=Settings");
await page.click("#set-tab-page");
await page.waitForSelector("#set-policies");
ok((await page.textContent('label[for="set-policies"]')).trim() === "Gemach policies", "field is labelled “Gemach policies”");
ok(/I’ve read the gemach’s policies/.test(await page.textContent("#grp-policies")), "hint explains the borrower's check");
ok(await page.$eval("#set-policies", e => e.tagName === "TEXTAREA" && e.maxLength === 5000), "multi-line, up to 5000 characters");
const text = "Cleaning: $5 per tablecloth.\n\nReturn within 2 days.";
await page.fill("#set-policies", text);
await page.evaluate(() => document.getElementById("grp-policies").scrollIntoView({ block: "center" }));
await page.screenshot({ path: "shot-policies-settings.png" });
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
let sp = lastPatch();
ok(sp && sp.body.policies === text && Object.keys(sp.body).length === 1, "PATCH sends the policies with line breaks " + JSON.stringify(sp && sp.body));
await page.waitForTimeout(400);
ok(await page.inputValue("#set-policies") === text, "kept after save");

// Confirm message: policies go in before the manage link
const confirmMsg = async () => {
  await page.evaluate(() => switchTab("requests"));
  await page.waitForSelector("#requests-list .card");
  await page.click("#requests-list .card:nth-child(1) button.btn-primary");
  await page.waitForSelector("#confirm-message");
  const m = await page.inputValue("#confirm-message");
  await page.evaluate(() => closeSheet("confirm-sheet"));
  return m;
};
const setTpl = t => page.evaluate(t => { GEMACH.templates.confirm = t; }, t);
let msg = await confirmMsg();
ok(msg === "Hi Leah, we have Navy Round × 6 for you.\n\nPlease read our policies:\nCleaning: $5 per tablecloth.\n\nReturn within 2 days.\n\nManage or cancel: https://whgemachs.org/r/abc.def\n\nThank you!", "confirm message has the policies before the link: " + JSON.stringify(msg));
await setTpl("Hi {first_name}, {items} are yours.\n\nOur rules:\n{policies}");
msg = await confirmMsg();
ok(msg.includes("Our rules:\nCleaning: $5") && (msg.match(/Cleaning/g) || []).length === 1 && !msg.includes("Please read our policies"), "{policies} in the template: placed there, not repeated");
await setTpl("Hi {first_name}, {items} are yours.");
msg = await confirmMsg();
ok(/are yours\.\n\nPlease read our policies:\nCleaning[\s\S]*\n\nManage or cancel: https/.test(msg), "template without the link: policies, then the link line " + JSON.stringify(msg));
await page.click("text=Settings");
await page.click("#set-tab-page");
await page.waitForSelector("#set-policies");
await page.fill("#set-policies", "");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
sp = lastPatch();
ok(sp && sp.body.policies === "", "blank clears them");
await page.waitForTimeout(400);
await setTpl("Hi {first_name}, we have {items} for you.\n\nManage or cancel: {manage_link}\n\nThank you!");
msg = await confirmMsg();
ok(!/polic/i.test(msg), "no policies → message unchanged");
ok(!errors.length, "no errors " + errors.join(" | "));
await browser.close();
