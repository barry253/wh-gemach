import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname); // screenshots land in tests/test-output
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const REQS = [
  { id: "recREQADD00000001", requestId: "R-201", name: "Addon Person", phone: "5165551234", email: "ap@example.com", preferredContact: "Email",
    itemNames: ["Arch", "Family Sweatshirt × 4"], items: [{ id: "recTYPEARCH000001", name: "Arch", quantity: null, available: null, owned: null },
      { id: "recTYPEADD0000001", name: "Family Sweatshirt", quantity: 4, available: null, owned: null, addon: true, price: 40 }],
    neededFrom: "2026-11-01", neededUntil: "2026-11-03", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
];
const LOANS = [{ id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Loan Nodate", borrowerPhone: "5165553333", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: null, daysOut: null }];
const RES = [
  { id: "recRESADD00000001", loanId: "L-50", borrowerName: "Addon Person", borrowerPhone: "5165551234", borrowerEmail: "ap@example.com", borrowerContact: "Email",
    itemTypeName: "Family Sweatshirt", itemTypeId: "recTYPEADD0000001", isQuantity: false, isAddon: true, price: 40, quantity: 4, reservationStart: "2026-11-01", reservationEnd: "2026-11-03" },
];
const APPTS = [{ id: "recREQAP000000009", requestId: "R-109", name: "Appt Person", phone: "5165556666", email: "ap@example.com", preferredContact: "Email", appointmentAt: "2026-10-04T23:00:00.000Z", itemNames: [] }];
const TYPES = [{ id: "recTYPEGOWN000001", name: "Navy A-line", description: "", displayOrder: 1, active: true, itemCount: 0, tracking: "Units", price: null, quantityOwned: 0, outOfService: 0, attributes: { size: ["4"], Color: ["Navy", "Teal"] } },
  { id: "recTYPEGOWN000002", name: "Gold Mermaid", description: "", displayOrder: 2, active: true, itemCount: 0, tracking: "Units", price: null, quantityOwned: 0, outOfService: 0, attributes: {}, r2PhotoUrl: "https://photos.test/gold.svg" }];
const HIST = { records: [{ id: "recH1", timestamp: "nope", eventType: "Loan Created", borrower: "X" }, { id: "recH2", timestamp: null, eventType: "Item Returned" }], offset: null };
const G = {
  id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", email: "gemach@example.com", phone: "(718) 986-7345",
  pickupAddress: "507 Walton Court", pickupInstructions: "In the driveway.",
  templates: { confirm: "Hi {first_name}, {items} is ready from the {gemach}.", decline: "Sorry {first_name}.", pickup: "Hi {first_name}, pick up at {pickup_address}.", appointment: "Hi {first_name}, see you {appointment_time}." },
  rawTemplates: {}, canEdit: true, primaryContact: "Email",
  itemAttributes: [{ name: "Size", values: ["2", "4", "6", "8"] }, { name: "Color", values: ["Navy", "Gold"] }],
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
    if (p === "/admin/gemach" && req.method() === "PATCH") { if (body.itemAttributes) G.itemAttributes = body.itemAttributes; if (body.browseCategoryIds) G.browseCategoryIds = body.browseCategoryIds; return J(G); }
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

// Settings → Item filters
await page.click("text=Settings");
await page.waitForSelector("#attr-defs .attr-def");
ok(await page.inputValue("#attr-name-0") === "Size" && await page.inputValue("#attr-values-0") === "2, 4, 6, 8", "existing filters shown");
ok(/\+ Length/.test(await page.textContent("#attr-presets")) && !/\+ Size/.test(await page.textContent("#attr-presets")), "presets offered for filters not yet added");
await page.click("#attr-presets button:has-text('+ Length')");
ok(await page.inputValue("#attr-name-2") === "Length" && /Floor-length/.test(await page.inputValue("#attr-values-2")), "Length preset adds suggested choices");
await page.fill("#attr-values-0", "2, 4, 6, 8, 10");
await page.click("#attr-presets button:has-text('+ Other filter')");
await page.fill("#attr-name-3", "Fabric");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("List at least one choice for “Fabric”"));
ok(!calls.some(c => c.method === "PATCH" && c.path === "/admin/gemach"), "blank filter blocked client-side");
await page.click("#attr-defs .attr-def:last-child button");
await page.evaluate(() => document.getElementById("settings-sec-item-filters").scrollIntoView());
await page.screenshot({ path: "shot-item-filters-settings.png" });
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
const sp = calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);
ok(sp && JSON.stringify(sp.body.itemAttributes.map(a => a.name)) === '["Size","Color","Length"]' && sp.body.itemAttributes[0].values.join(",") === "2,4,6,8,10"
  && Object.keys(sp.body).length === 1, "PATCH sends only the filters " + JSON.stringify(sp && sp.body));

// Settings → Home page categories
await page.waitForSelector("#browse-cats .attr-chip");
ok((await page.$$eval("#browse-cats .attr-chip", els => els.map(e => e.textContent))).join("|") === "👗 Gowns|🍽️ Simchas", "category chips listed");
await page.click("#browse-cats .attr-chip:has-text('Simchas')");
await page.click("#settings-save-btn");
await page.waitForTimeout(300);
const bp = calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);
ok(bp && JSON.stringify(bp.body) === '{"browseCategoryIds":["recCATSIMCHA00001"]}', "PATCH sends chosen categories only " + JSON.stringify(bp && bp.body));
ok(await page.$eval("#browse-cats .attr-chip:has-text('Simchas')", b => b.getAttribute("aria-pressed")) === "true", "choice kept after save");
await page.evaluate(() => document.getElementById("settings-sec-home-page-categories").scrollIntoView());
await page.screenshot({ path: "shot-status-settings-cats.png" });

// Inventory shows the gown's values; item type sheet has chips
await page.evaluate(() => switchTab("inventory"));
await page.waitForSelector(".inventory-group");
ok(/Size 4 · Color Navy/.test(await page.$eval(".inventory-group", e => e.innerText)), "inventory shows values in the gemach's spelling");
const thumbs = await page.$$eval(".inventory-group", els => els.map(g => { const t = g.querySelector(".inv-thumb"); return t.tagName === "IMG" ? (t.naturalWidth > 0 ? "img:" + t.getAttribute("src") : "img-not-loaded") : t.textContent; }));
ok(thumbs[0] === "No photo", "missing photo flagged in the row: " + thumbs);
ok(thumbs[1] === "img:https://photos.test/gold.svg", "photo thumbnail shown in the row: " + thumbs);
await page.locator("#inventory-list").screenshot({ path: "shot-inventory-thumbs.png" });
await page.locator(".inventory-group .inv-thumb-missing").first().click();
await page.waitForSelector("#it-attrs .attr-chip");
ok(await page.textContent("#item-type-sheet-subtitle") === "Navy A-line", "tapping 'No photo' opens that item type to add one");
await page.evaluate(() => closeSheet("item-type-sheet"));
await page.waitForTimeout(300);
await page.click(".inventory-group [title='Edit item type']");
await page.waitForSelector("#it-attrs .attr-chip");
const pressed = await page.$$eval("#it-attrs .attr-chip[aria-pressed=true]", els => els.map(e => e.textContent));
ok(pressed.join(",") === "4,Navy", "current values pressed (case-insensitive): " + pressed);
ok(await page.$eval("#it-attrs", e => /Teal/.test(e.innerText) && e.querySelector(".attr-orphan")), "value no longer offered shown as dashed");
ok(await page.$$eval("#it-attrs .attr-picker-name", els => els.map(e => e.textContent).join(",")) === "Size,Color,Length", "a picker per filter, incl. the new one");
await page.click("#it-attrs .attr-chip:text-is('4')");
await page.click("#it-attrs .attr-chip:text-is('10')");
await page.click("#it-attrs .attr-chip:text-is('Gold')");
await page.click("#it-attrs .attr-chip:text-is('Floor-length')");
await page.screenshot({ path: "shot-item-filters-sheet.png" });
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
const pt = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path)).at(-1);
ok(pt && JSON.stringify(pt.body.attributes) === '{"Size":["10"],"Color":["Navy","Gold"],"Length":["Floor-length"]}', "PATCH sends picked values in list order " + JSON.stringify(pt && pt.body.attributes));

// Unchanged → attributes not sent
await page.click(".inventory-group [title='Edit item type']");
await page.waitForSelector("#it-attrs .attr-chip");
const n = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path)).length;
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
const pt2 = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path));
ok(pt2.length === n + 1 && !("attributes" in pt2.at(-1).body), "unchanged values aren't re-sent");
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
