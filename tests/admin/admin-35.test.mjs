// Bookings (Oct 21, 2026): Reservations and Loans show one row per booking (a request's items together), and an
// opened booking reads like a request card: request number, photo strip, items, dates, payment, town, phone,
// email, notes. Cancel on Reservations cancels the whole booking after asking; per-item buttons stay inside.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const PHOTO = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>";
const REQ = { requestId: "R-092", receivedAt: new Date(Date.now() - 3 * 86400000).toISOString(), source: null, eventDate: null,
  depositAcknowledged: true, town: "Cedarhurst", state: null, paymentTier: "Standard" };
const who = { borrowerName: "Tova Isseroff", borrowerPhone: "9172828486", borrowerEmail: null, borrowerContact: "WhatsApp" };
const RES = [
  { id: "recRESTOVA000001", loanId: "L-1", ...who, itemTypeName: "Blue & White Toile · Round", itemTypeId: "recT1", isQuantity: true, quantity: 12,
    photo: "https://example.test/toile.jpg", photos: ["https://example.test/toile2.jpg"], reservationStart: iso(1), reservationEnd: iso(8),
    requestNote: "For a sheva brachos", requestRecId: "recREQTOVA00001", request: REQ },
  { id: "recRESTOVA000002", loanId: "L-2", ...who, itemTypeName: "Solid Navy · Rectangle", itemTypeId: "recT2", isQuantity: true, quantity: 6,
    photo: "https://example.test/navy.jpg", photos: [], reservationStart: iso(1), reservationEnd: iso(8), requestRecId: "recREQTOVA00001", request: REQ },
  { id: "recRESWALK000001", loanId: "L-3", borrowerName: "Chana Klein", borrowerPhone: null, borrowerEmail: "chana@example.com", borrowerContact: "Email",
    itemTypeName: "Lily · Round", itemTypeId: "recT3", isQuantity: true, quantity: 6, reservationStart: iso(3), reservationEnd: null, requestRecId: null, request: null },
];
const LOANS = [
  { id: "recLOANDEV000001", loanId: "L-10", borrowerName: "Devorah S", borrowerPhone: "5613229454", borrowerEmail: "d@example.com", borrowerContact: "Email",
    itemTypeName: "Gold gown – size 8", itemId: "SD-001", dateBorrowed: iso(-20), expectedReturn: iso(-2), daysOut: 20, overdue: true,
    requestRecId: "recREQDEV000001", request: { ...REQ, requestId: "R-080", paymentTier: "Local", town: "West Hempstead" } },
  { id: "recLOANDEV000002", loanId: "L-11", borrowerName: "Devorah S", borrowerPhone: "5613229454", borrowerEmail: "d@example.com", borrowerContact: "Email",
    itemTypeName: "Navy gown – size 8", itemId: "SD-002", dateBorrowed: iso(-20), expectedReturn: iso(5), daysOut: 20, overdue: false,
    requestRecId: "recREQDEV000001", request: { ...REQ, requestId: "R-080", paymentTier: "Local", town: "West Hempstead" } },
  { id: "recLOANWALKIN001", loanId: "L-12", borrowerName: "Walk In", borrowerPhone: "5165550000", borrowerContact: "Call",
    itemTypeName: "Walker", dateBorrowed: iso(-1), expectedReturn: null, daysOut: 1, overdue: false, requestRecId: null, request: null },
];
const G = { id: "recA", slug: "wh-medical", name: "Shulchan Yehuda", chargeType: "Payment", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], posts = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("https://example.test/**", r => r.fulfill({ contentType: "image/svg+xml", body: decodeURIComponent(PHOTO.split(",")[1]) }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (r.request().method() === "POST") { posts.push({ p, body: r.request().postDataJSON() }); return J({ success: true }); }
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 3, overdueLoans: 1, upcomingReservations: 3 });
  if (p === "/admin/loans") return J(LOANS);
  if (p === "/admin/reservations") return J(RES);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(400);

// ── Reservations
await page.evaluate(() => switchTab("reservations"));
await page.waitForSelector("#reservations-list .loan-row");
ok(await page.$$eval("#reservations-list .loan-row", e => e.length) === 2, "Tova's two items are one booking row (plus the walk-in reservation)");
ok(/2 reservations · 3 items/.test(await page.textContent("#res-count")), "count says bookings, then items: " + await page.textContent("#res-count"));
const row = await page.textContent("#res-row-recRESTOVA000001");
ok(/2 items/.test(row) && /Toile · Round × 12/.test(row) && /Navy · Rectangle × 6/.test(row), "row names both items");
await page.click("#res-row-recRESTOVA000001");
const panel = "#res-panel-recRESTOVA000001";
const pt = (await page.innerText(panel)).replace(/\s+/g, " ");
ok(/R-092 · 3d ago/.test(pt), "request number and when it came in: " + pt.slice(0, 40));
ok(await page.$$eval(`${panel} .bk-line .row-thumb-btn`, e => e.length) === 2, "each item line has its photo");
ok(!/📦/.test(pt) && !/📅/.test(pt) && !/📞/.test(pt) && (pt.match(/Blue & White Toile/g) || []).length === 1, "each item, date and number appears once in the opened card");
ok(await page.$$eval(`${panel} .bk-line`, e => e.map(x => x.innerText.replace(/\s+/g, " ").trim()).join("|")) === "2 Blue & White Toile · Round × 12 ✓ Picked up|Solid Navy · Rectangle × 6 ✓ Picked up", "one line per item with its button: " + await page.$$eval(`${panel} .bk-line`, e => e.map(x => x.innerText.replace(/\s+/g, " ").trim()).join("|")));
ok(/✓ Payment acknowledged/.test(pt) && /📍 Cedarhurst/.test(pt) && /Not local/i.test(pt), "payment and town with the tier tag");
ok(/\(917\) 282-8486 · no email/.test(await page.textContent(`${panel} .contact-caption`)), "number (formatted) and 'no email' in the contact line");
ok(/💬 For a sheva brachos/.test(pt), "the request's note");

ok(/Send pickup info/.test(pt) && /Edit/.test(pt) && /Cancel/.test(pt), "booking actions");
await page.screenshot({ path: "shot-booking-reservation.png", fullPage: true });

// Edit opens the whole booking (by request)
const bookingCalls = [];
await page.evaluate(() => { window.__ob = openBooking; openBooking = o => { window.__lastBooking = o; }; });
await page.click(`${panel} button:has-text('Edit')`);
ok(JSON.stringify(await page.evaluate(() => window.__lastBooking)) === JSON.stringify({ request: "recREQTOVA00001", from: "reservations" }), "Edit opens the booking by its request");
await page.evaluate(() => { openBooking = window.__ob; });

// Cancel: asks first, then cancels the whole booking
await page.click(`${panel} button:has-text('Cancel')`);
ok(await page.isVisible("#cancel-res-sheet .sheet") && /all 2 items/.test(await page.textContent("#cancel-res-explainer")) && /use Edit/.test(await page.textContent("#cancel-res-explainer")), "confirmation names the whole booking and points to Edit");
ok(/Yes, cancel all 2/.test(await page.textContent("#cancel-res-submit-btn")), "button says how many");
await page.click("#cancel-res-submit-btn");
await page.waitForTimeout(300);
const c = posts.find(x => x.p === "/admin/booking/cancel");
ok(c && c.body.request === "recREQTOVA00001", "cancel posts the booking by request " + JSON.stringify(c?.body));

// A reservation with no request
await page.click("#res-row-recRESWALK000001");
const wt = (await page.innerText("#res-panel-recRESWALK000001")).replace(/\s+/g, " ");
ok(/Reserved from admin/.test(wt) && /chana@example.com/.test(await page.textContent("#res-panel-recRESWALK000001 .contact-caption")) && /open-ended/.test(await page.textContent("#res-row-recRESWALK000001")), "walk-in booking: says so; email in the contact line, dates in the header");
ok(await page.$$eval("#res-panel-recRESWALK000001 .btn-primary", e => e.map(b => b.textContent.trim()).join()) === "✓ Mark picked up", "one item: Mark picked up is the main button");

// ── Loans
await page.evaluate(() => switchTab("loans"));
await page.waitForSelector("#loans-list .loan-row");
ok(await page.$$eval("#loans-list .loan-row", e => e.length) === 2, "Devorah's two gowns are one booking");
ok(/2 loans · 3 items/.test(await page.textContent("#loans-count")), "count line: " + await page.textContent("#loans-count"));
ok(/Overdue\s*1/.test(await page.textContent("#loans-pills")), "a booking with an overdue item counts as overdue");
await page.click("#loans-list .loan-row:has-text('Devorah')");
const lp = (await page.innerText("#loan-panel-recLOANDEV000001")).replace(/\s+/g, " ");
ok(/R-080/.test(lp) && /Local rate/i.test(lp) && /\(561\) 322-9454/.test(lp), "loan booking shows the request card lines");
ok(await page.$$eval("#loan-panel-recLOANDEV000001 .bk-line-sub", e => e.length) === 2 && /overdue/.test(lp), "different due dates: each gown's line has its own");
ok(await page.$$eval("#loan-panel-recLOANDEV000001 .bk-line button", e => e.length) === 2, "a Returned button per gown");
await page.screenshot({ path: "shot-booking-loan.png", fullPage: true });
// The search still finds a booking by any of its items
await page.fill("#loans-search", "navy");
ok(await page.$$eval("#loans-list .loan-row", e => e.length) === 1, "search by the second item finds the booking");
await page.fill("#loans-search", "");

// Deep link to the second loan of a booking points at its booking row
await page.evaluate(() => pointAt(["loan-row-recLOANDEV000002"]));
await page.waitForTimeout(300);
ok(await page.$eval("#loan-row-recLOANDEV000001", e => e.classList.contains("deep-hl")), "a link to any item finds its booking");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
