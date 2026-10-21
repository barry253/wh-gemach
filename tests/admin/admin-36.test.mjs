// City + State in admin: New reservation / New loan / Inventory unit sheet (always optional here; NY preselected;
// the borrower lookup fills them), and shown on Loans rows and Inventory units.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const G = { id: "recA", slug: "wh-medical", name: "Medical Gemach", email: "m@example.com", phone: "(516) 555-1234", mode: "Full", canEdit: true,
  rawTemplates: {}, templates: { confirm: "x", decline: "x", pickup: "x", appointment: "x" }, placeholders: [], primaryContact: "Call", requestStyle: "Dates",
  itemAttributes: [], defaultLoanDays: 30, requireTown: true, eventLabel: "Event date" };
const T1 = "recTYPEWHEEL00001";
const TYPES = [{ id: T1, name: "Wheelchair", tracking: "Units", photo: null, photos: [], attributes: {}, units: [{ id: "recU1", itemId: "WC-01" }, { id: "recU2", itemId: "WC-02" }], bookings: [], held: [] }];
const CAT_TYPES = [{ id: T1, name: "Wheelchair", description: "", displayOrder: 0, active: true, itemCount: 2, tracking: "Units", price: null, quantityOwned: 0, outOfService: 0, attributes: {} }];
const INV = { items: [
  { id: "recU1", itemId: "WC-01", itemTypeId: T1, itemTypeName: "Wheelchair", condition: "Good", status: "On Loan", active: true, notes: null,
    currentLoan: { loanRecId: "recLOAN000000001", loanId: "L-001", status: "Active", dateBorrowed: iso(-5), expectedReturn: iso(20), borrowerName: "Rivka Cohen", borrowerPhone: "(516) 555-0101",
      borrowerEmail: null, borrowerContact: "Text", borrowerCity: "West Hempstead", borrowerState: "NY" } },
  { id: "recU2", itemId: "WC-02", itemTypeId: T1, itemTypeName: "Wheelchair", condition: "Good", status: "On Loan", active: true, notes: null,
    currentLoan: { loanRecId: "recLOAN000000002", loanId: "L-002", status: "Active", dateBorrowed: iso(-2), expectedReturn: null, borrowerName: "Old Loan", borrowerPhone: "(516) 555-0102",
      borrowerEmail: null, borrowerContact: "Text" } },
], holds: [] };
const loan = (id, name, extra) => ({ id, loanId: "L-" + id.slice(-3), itemId: "WC-01", itemTypeName: "Wheelchair", itemTypeId: T1, photo: null, photos: [], isQuantity: false, quantity: null,
  borrowerName: name, borrowerPhone: "(516) 555-0101", borrowerEmail: null, borrowerContact: "Text", dateBorrowed: iso(-5), expectedReturn: iso(20), daysOut: 5, overdue: false,
  notes: null, requestNote: null, readyToReturnAt: null, reminderSentAt: null, reminderSentVia: null, manageUrl: null, requestRecId: null, request: null, ...extra });
const LOANS = [
  loan("recLOAN000000001", "Rivka Cohen", { borrowerCity: "West Hempstead", borrowerState: "NY" }),
  loan("recLOAN000000003", "Online Person", { requestRecId: "recREQ0000000001", request: { requestId: "R-1", receivedAt: new Date().toISOString(), town: "Lakewood", state: "NJ" }, borrowerCity: "Old Town", borrowerState: "NY" }),
  loan("recLOAN000000004", "No City", {}),
];
const BORROWERS = [{ id: "recBOR0000000001", name: "Rivka Cohen", phone: "(516) 555-0101", email: "rivka@example.com", preferredContact: "Text", city: "West Hempstead", state: "NY", loans: 1, lastAt: iso(-5), out: 1, dueBack: iso(20) }];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [], posts = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.dismiss());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request(), p = new URL(req.url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (req.method() === "POST") { posts.push({ path: p, body: JSON.parse(req.postData() || "{}") }); }
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 3, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/loans" && req.method() === "POST") return J({ success: true, loans: [{ id: "recNEWLOAN000001", loanId: "L-010" }] });
  if (p === "/admin/reservations" && req.method() === "POST") return J({ success: true, request: "recNEWREQ0000001", requestId: "R-10", manageUrl: "https://whgemachs.org/r/x", loans: ["L-011"] });
  if (/\/assign$/.test(p)) return J({ success: true, loanId: "L-001" });
  if (p === "/admin/loans") return J(LOANS);
  if (p === "/admin/inventory") return J(INV);
  if (p === "/admin/catalog/item-types") return J(CAT_TYPES);
  if (p === "/admin/catalog/items") return J({ items: [], itemTypes: CAT_TYPES.map(t => ({ id: t.id, name: t.name })) });
  if (p === "/admin/checkout/options") return J({ today: iso(0), defaultLoanDays: 30, types: TYPES });
  if (p === "/admin/borrowers") return J({ borrowers: BORROWERS });
  if (p === "/admin/history") return J({ records: [], offset: null });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(800);
const lastPost = path => posts.filter(x => x.path === path).at(-1);

// ── New reservation: City + State, optional, NY preselected; lookup fills them
await page.evaluate(() => openNewBooking("reservation"));
await page.waitForSelector("#nb-city");
ok(await page.inputValue("#nb-state") === "NY" && (await page.$$eval("#nb-state option", o => o.length)) === 52, "state dropdown: NY preselected, 52 codes");
ok(!(await page.textContent('label[for="nb-city"]')).includes("*"), "city not marked required for admins (even when the gemach requires it online)");
await page.fill("#nb-name", "Riv");
await page.waitForSelector("#nb-name-matches [data-bid]");
await page.click("#nb-name-matches [data-bid]");
ok(await page.inputValue("#nb-city") === "West Hempstead" && await page.inputValue("#nb-state") === "NY", "picking a borrower fills city + state");
await page.fill("#nb-city", "Woodmere");
await page.fill("#nb-search", "Wheel");
await page.click("#nb-results .co-result");
await page.locator("#nb-city").scrollIntoViewIfNeeded();
await page.screenshot({ path: "shot-admin-city-reservation.png" });
await page.click("#nb-save-btn");
await page.waitForTimeout(500);
let sp = lastPost("/admin/reservations");
ok(sp && sp.body.borrower.city === "Woodmere" && sp.body.borrower.state === "NY" && sp.body.borrower.id === "recBOR0000000001", "reservation sends city + state " + JSON.stringify(sp && sp.body.borrower));
await page.evaluate(() => closeSheet("newbk-sheet"));

// ── New loan: blank city is fine (optional); state not sent without a city
await page.evaluate(() => openCheckout());
await page.waitForSelector("#co-city");
await page.fill("#co-name", "Leah Stern"); await page.fill("#co-phone", "(201) 555-0188");
await page.selectOption("#co-state", "NJ");
await page.fill("#co-search", "Wheel");
await page.click("#co-results .co-result");
await page.locator("#co-city").scrollIntoViewIfNeeded();
await page.screenshot({ path: "shot-admin-city-newloan.png" });
await page.click("#checkout-sheet .btn-primary:visible");
await page.waitForTimeout(500);
sp = lastPost("/admin/loans");
ok(sp && sp.body.borrower.name === "Leah Stern" && !("city" in sp.body.borrower) && !("state" in sp.body.borrower), "new loan without a city saves (city optional) " + JSON.stringify(sp && sp.body.borrower));
await page.evaluate(() => closeSheet("checkout-sheet"));

// ── Loans: 📍 city on each row (request's city first, else the borrower's; none when unknown)
await page.evaluate(() => switchTab("loans"));
await page.waitForSelector(".loan-row");
const rows = await page.$$eval(".loan-row", els => els.map(e => e.innerText));
const rowOf = n => rows.find(t => t.includes(n)) || "";
ok(/📍 West Hempstead, NY/.test(rowOf("Rivka Cohen")), "walk-in row shows the borrower's city");
ok(/📍 Lakewood, NJ/.test(rowOf("Online Person")) && !/Old Town/.test(rowOf("Online Person")), "online request row shows the request's city");
ok(!/📍/.test(rowOf("No City")), "no city → no line");
await page.screenshot({ path: "shot-admin-city-loans.png" });

// ── Inventory: "name · city" under units that are out; unit sheet prefilled and saved
await page.evaluate(() => switchTab("inventory"));
await page.waitForSelector(".inventory-item");
const units = await page.$$eval(".inventory-item", els => els.map(e => e.innerText));
ok(units.some(t => /WC-01[\s\S]*Rivka Cohen · West Hempstead, NY/.test(t)), "unit shows who has it and their city");
ok(units.some(t => /WC-02[\s\S]*Old Loan/.test(t) && !/Old Loan ·/.test(t)), "no city → just the name");
await page.screenshot({ path: "shot-admin-city-inventory.png" });
await page.locator(".inventory-item").first().click();
await page.waitForSelector("#assign-borrower-city");
ok(await page.inputValue("#assign-borrower-city") === "West Hempstead" && await page.inputValue("#assign-borrower-state") === "NY", "unit sheet shows the borrower's city + state");
await page.fill("#assign-borrower-city", "Franklin Square");
await page.click("#assign-item-submit-btn");
await page.waitForTimeout(500);
sp = posts.filter(x => /\/assign$/.test(x.path)).at(-1);
ok(sp && sp.body.borrowerCity === "Franklin Square" && sp.body.borrowerState === "NY", "unit sheet saves city + state " + JSON.stringify(sp && sp.body));

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
