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
const TYPES = [{ id: "recTYPEADD0000001", name: "Family Sweatshirt", description: "", displayOrder: 1, active: true, itemCount: 0, tracking: "Add-on", price: 40, quantityOwned: 0, outOfService: 0 }];
const HIST = { records: [{ id: "recH1", timestamp: "nope", eventType: "Loan Created", borrower: "X" }, { id: "recH2", timestamp: null, eventType: "Item Returned" }], offset: null };
const G = {
  id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", email: "gemach@example.com", phone: "(718) 986-7345",
  pickupAddress: "507 Walton Court", pickupInstructions: "In the driveway.",
  templates: { confirm: "Hi {first_name}, {items} is ready from the {gemach}.", decline: "Sorry {first_name}.", pickup: "Hi {first_name}, pick up at {pickup_address}.", appointment: "Hi {first_name}, see you {appointment_time}." },
  rawTemplates: {}, canEdit: true,
};

async function setup() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname;
    let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
    calls.push({ method: req.method(), path: p, body, gemach: req.headers()["x-gemach"] });
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
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
    if (p === "/admin/catalog/categories") return J([]);
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
// Request card
await page.evaluate(() => switchTab("requests"));
await page.waitForSelector("#requests-list .card");
const meta = await page.$eval("#requests-list .card .card-meta", e => e.innerText);
ok(/📦 Arch/.test(meta) && !/📦[^\n]*Sweatshirt/.test(meta), "loan items listed without add-ons: " + meta.replace(/\n/g, " / "));
ok(/🛍 Add-ons: Family Sweatshirt × 4 · \$160 \(separate payment\)/.test(meta), "add-on line with price total");
await page.click("#requests-list .card button.btn-primary");
await page.waitForSelector("#confirm-qty-list .qty-line");
const cq = await page.$eval("#confirm-qty-list", e => e.innerText);
ok(/Family Sweatshirt/.test(cq) && /Add-on · \$40 each/.test(cq) && !/null/.test(cq), "confirm sheet: add-on count editable, no 'null total': " + cq.replace(/\n/g, " / "));
await page.evaluate(() => closeSheet("confirm-sheet"));

// Reservation row: add-on order
await page.evaluate(() => switchTab("reservations"));
await page.waitForSelector("#reservations-list .loan-row");
const row = await page.$eval("#reservations-list .loan-row", e => e.innerText);
ok(/× 4 · \$160/.test(row) && /Add-on/i.test(row) && /For /.test(row) && !/Reserved/.test(row), "reservation row shows add-on order: " + row.replace(/\n/g, " / "));
await page.click("#reservations-list .loan-row");
const btn = await page.$eval("#reservations-list .loan-actions-panel button.btn-primary", b => b.textContent.trim());
ok(btn === "✓ Mark handed over", "action says handed over: " + btn);
await page.click("#reservations-list .loan-actions-panel button.btn-primary");
await page.waitForSelector("#pickup-sheet.open, #pickup-sheet.active, #pickup-sheet[style*='flex']", { timeout: 3000 }).catch(() => {});
ok(await page.textContent("#pickup-title") === "Mark as handed over" && /handed over/.test(await page.textContent("#pickup-qty-label")), "sheet wording for add-ons");
ok(await page.$eval("#pickup-item-group", e => e.style.display === "none") && await page.inputValue("#pickup-qty") === "4", "no unit picker; count prefilled");
await page.screenshot({ path: "shot-addon-handover.png" });
await page.click("#pickup-submit-btn");
await page.waitForTimeout(300);
const pc = calls.filter(c => /\/pickup$/.test(c.path)).at(-1);
ok(pc && pc.body.quantity === 4 && !pc.body.itemId, "hand-over POST: quantity only " + JSON.stringify(pc && pc.body));
ok(await page.evaluate(() => document.body.innerText.includes("Marked as handed over")), "toast says handed over");

// Inventory + item type sheet
await page.evaluate(() => switchTab("inventory"));
await page.waitForSelector(".inventory-group");
const inv = await page.$eval(".inventory-group", e => e.innerText);
ok(/Family Sweatshirt/.test(inv) && /Add-on · \$40/i.test(inv) && /Made to order/.test(inv) && !/Add Item/.test(inv), "inventory: add-on group, no units: " + inv.replace(/\n/g, " / "));
await page.click(".inventory-group .inventory-group-header button.btn-ghost:last-child");
await page.waitForTimeout(200);
ok(await page.$eval("#it-tracking", e => e.value) === "Add-on" && await page.$eval("#it-price-row", e => e.style.display !== "none") && await page.inputValue("#it-price") === "40", "item type sheet: Add-on + price");
await page.fill("#it-price", "42.5");
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
const pt = calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path)).at(-1);
ok(pt && pt.body.price === 42.5 && pt.body.tracking === undefined, "PATCH price only " + JSON.stringify(pt && pt.body));
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
