// Catalog extras in admin: sections / holiday spotlight / photo shape / borrow note settings; byline, search words, Featured, New until on item types
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const REQS = [], LOANS = [], RES = [], APPTS = [], UPLOADS = [];
const HIST = { records: [], offset: null };
const TYPES = [
  { id: "recTYPEBOOK000001", name: "Yossi and Laibel", description: "Twins.", displayOrder: 1, active: true, itemCount: 0, tracking: "Units", price: null, quantityOwned: 0, outOfService: 0,
    attributes: { Shelf: ["Middos"] }, byline: "Dina Rosenfeld · Hachai", searchWords: "series", featured: true, newUntil: null },
  { id: "recTYPEBOOK000002", name: "I Can Choose", description: "", displayOrder: 2, active: true, itemCount: 0, tracking: "Units", price: null, quantityOwned: 0, outOfService: 0,
    attributes: {}, byline: null, searchWords: null, featured: false, newUntil: "2099-01-01" }];
const G = {
  id: "recA", slug: "wh-medical", name: "Sefer Shelf", email: "ss@example.com", phone: "(516) 555-1234", mode: "Directory",
  pickupAddress: "", pickupInstructions: "", templates: { confirm: "x", decline: "x", pickup: "x", appointment: "x" }, rawTemplates: {}, canEdit: true, primaryContact: "Email",
  itemAttributes: [{ name: "Shelf", values: ["Middos", "Yom Tov"] }, { name: "Holiday", values: ["Chanukah", "Pesach"] }],
  groupBy: null, spotlightFilter: null, photoShape: "Landscape", borrowNote: null,
};
async function setup() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://photos.test/**", r => r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c9a"/></svg>' }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname;
    let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
    calls.push({ method: req.method(), path: p, body, gemach: req.headers()["x-gemach"] });
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
    if (p === "/admin/gemach" && req.method() === "PATCH") { Object.assign(G, body); return J(G); }
    if (p === "/admin/catalog/upload-photo") {
      const raw = req.postDataBuffer() || Buffer.alloc(0);
      const type = (raw.toString("latin1").match(/Content-Type: (image\/[a-z]+)/i) || [])[1] || null;
      UPLOADS.push({ type, bytes: raw.length });
      return J({ success: true, url: `https://photos.test/up-${UPLOADS.length}.svg` });
    }
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: REQS.length, activeLoans: 1, overdueLoans: 0, upcomingReservations: 2 });
    if (p === "/admin/requests") return J(REQS);
    if (p === "/admin/loans") return J(LOANS);
    if (p === "/admin/reservations") return J(RES);
    if (p === "/admin/appointments") return J(APPTS);
    if (p === "/admin/history") return J(HIST);
    if (/\/confirm$|\/decline$/.test(p)) return J({ success: true });
    if (/\/pickup$/.test(p)) return J({ success: true, handedOver: true });
    if (p === "/admin/catalog/item-types") return J(TYPES);
    if (p === "/admin/inventory") return J([]);
    if (p === "/admin/catalog/items") return J({ items: [], itemTypes: TYPES.map(t => ({ id: t.id, name: t.name })) });
    if (p === "/admin/catalog/categories") return J([{ id: "recCATGOWNS000001", name: "Gowns", icon: "👗" }, { id: "recCATSIMCHA00001", name: "Simchas", icon: "🍽️" }]);
    if (/\/admin\/catalog\/item-types\/[^/]+$/.test(p)) return J({ id: "x" });
    return J([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("gemach_token", "fake.token.x");
    localStorage.setItem("gemach_slug", "wh-medical");
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push({ how: "window.open", url: String(u) }); return null; };
    document.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a");
      if (a && /^(sms|mailto|tel):/.test(a.getAttribute("href") || "")) { e.preventDefault(); window.__opened.push({ how: "anchor", url: a.href }); }
    }, true);
  });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(600);
  return { page, errors, calls };
}
const bodyText = page => page.evaluate(() => document.body.innerText);


const { page, errors, calls } = await setup();
const lastPatch = () => calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);

// Settings → Your page: photo shape + sections + spotlight
await page.click("text=Settings");
await page.click("#set-tab-page");
await page.waitForSelector("#set-groupBy");
ok(await page.isChecked('input[name="set-photoShape"][value="Landscape"]'), "photo shape: Landscape by default");
ok((await page.$$eval("#set-groupBy option", o => o.map(x => x.textContent))).join("|") === "— none —|Shelf|Holiday", "sections list offers the filters");
await page.check('input[name="set-photoShape"][value="Portrait"]');
await page.selectOption("#set-groupBy", "Shelf");
await page.selectOption("#set-spotlightFilter", "Holiday");
ok(await page.isVisible("#settings-savebar"), "unsaved bar appears");
await page.evaluate(() => document.getElementById("set-groupBy").scrollIntoView());
await page.screenshot({ path: "shot-sections-settings.png" });
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
let sp = lastPatch();
ok(sp && JSON.stringify(sp.body) === '{"photoShape":"Portrait","groupBy":"Shelf","spotlightFilter":"Holiday"}', "PATCH sends shape + sections + spotlight " + JSON.stringify(sp && sp.body));
ok(await page.inputValue("#set-groupBy") === "Shelf" && await page.inputValue("#set-spotlightFilter") === "Holiday", "choices kept after save");

// Settings → Requests: how to borrow (Listing only)
await page.click("#set-tab-requests");
await page.waitForSelector("#set-borrowNote");
ok(await page.isVisible("#set-borrowNote"), "how-to-borrow box shown for a Listing only gemach");
await page.fill("#set-borrowNote", "Visit during open hours to borrow.");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
sp = lastPatch();
ok(sp && JSON.stringify(sp.body) === '{"borrowNote":"Visit during open hours to borrow."}', "PATCH sends the note only " + JSON.stringify(sp && sp.body));

// Inventory row + item type sheet
await page.waitForTimeout(500);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => switchTab("inventory"));
  try { await page.waitForSelector(".inventory-group", { timeout: 8000 }); break; } catch (e) { if (i === 2) throw e; }
}
const rows = await page.$$eval(".inventory-group", els => els.map(e => e.innerText));
ok(/Dina Rosenfeld · Hachai/.test(rows[0]) && /★ Featured/.test(rows[0]) && /New until 2099-01-01/.test(rows[1]), "inventory shows byline, Featured, New until");
await page.locator(".inventory-group").first().locator("[title='Edit item type']").click();
await page.waitForSelector("#it-byline");
ok(await page.inputValue("#it-byline") === "Dina Rosenfeld · Hachai" && await page.inputValue("#it-search") === "series" && await page.isChecked("#it-featured") && await page.inputValue("#it-new-until") === "", "sheet prefilled");
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
let pt = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path)).at(-1);
ok(pt && !["byline", "searchWords", "featured", "newUntil"].some(k => k in pt.body), "unchanged extras aren't sent " + JSON.stringify(pt && pt.body));
await page.locator(".inventory-group").first().locator("[title='Edit item type']").click();
await page.waitForSelector("#it-byline");
await page.fill("#it-byline", "  Dina   Rosenfeld ");
await page.uncheck("#it-featured");
await page.click("button:has-text('New for 6 months')");
const want = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 180); return d.toLocaleDateString("en-CA"); });
await page.screenshot({ path: "shot-item-extras-sheet.png" });
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
pt = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path)).at(-1);
ok(pt && pt.body.byline === "Dina Rosenfeld" && pt.body.featured === false && pt.body.newUntil === want && !("searchWords" in pt.body), "changed extras sent " + JSON.stringify(pt && pt.body));
await page.locator(".inventory-group").nth(1).locator("[title='Edit item type']").click();
await page.waitForSelector("#it-byline");
await page.click("button:has-text('Not new')");
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
pt = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path)).at(-1);
ok(pt && pt.body.newUntil === "", "Not new clears the date " + JSON.stringify(pt && pt.body));

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
