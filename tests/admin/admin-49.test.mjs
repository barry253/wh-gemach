// Edit a booking: adding an item (or moving the dates) warns when it's already booked for those dates,
// the same way New reservation does. The booking's own loans don't count against it. (R-071, Nov 11 2026.)
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const TODAY = iso(0);
const G = { id: "recA", slug: "tablecloths", name: "Tablecloth Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text",
  phone: "5165551212", requestStyle: "Dates", eventLabel: "Event date", returnDaysAfter: 1, pickupDaysBefore: 1, defaultLoanDays: 14 };

const RES = [{ id: "recRES00000000001", loanId: "L-116", borrowerName: "Sisterhood", itemTypeName: "Navy Round", isQuantity: true, quantity: 12, reservationStart: iso(1), reservationEnd: iso(7) }];
const LOANS = [{ id: "recLOANACT0000001", loanId: "L-300", borrowerName: "Walk In", itemTypeName: "Navy Round", isQuantity: true, quantity: 6, dateBorrowed: iso(-2), expectedReturn: iso(3), daysOut: 2, overdue: false }];
const BOOKINGS = {
  "loan=recRES00000000001": { kind: "reservation", requestStyle: "Dates", eventLabel: "Event date", defaultLoanDays: 14, today: TODAY,
    request: { id: "recREQ71", requestId: "R-071", status: "Converted", requestType: "Loan", name: "Sisterhood", phone: "5165550301", email: null, preferredContact: "SMS",
      neededFrom: iso(1), neededUntil: iso(7), items: [] },
    borrower: { id: "recB1", name: "Sisterhood", phone: "5165550301", email: null, preferredContact: "Text" },
    loans: [{ id: "recRES00000000001", loanId: "L-116", status: "Reserved", itemTypeId: "recNAVY", itemTypeName: "Navy Round", tracking: "Quantity", photo: null, photos: [],
      itemId: null, quantity: 12, reservationStart: iso(1), reservationEnd: iso(7), notes: null }] },
  "loan=recLOANACT0000001": { kind: "loan", requestStyle: "Dates", eventLabel: "Event date", defaultLoanDays: 14, today: TODAY, request: null,
    borrower: { id: "recB2", name: "Walk In", phone: "5165550302", email: null, preferredContact: null },
    loans: [{ id: "recLOANACT0000001", loanId: "L-300", status: "Active", itemTypeId: "recCHAIR", itemTypeName: "Chairs", tracking: "Quantity", photo: null, photos: [],
      itemId: null, quantity: 6, dateBorrowed: iso(-2), expectedReturn: iso(3), notes: null }] },
};
const TYPES = [
  // 12 owned; this booking holds all 12 (its own loan must not count against it).
  { id: "recNAVY", name: "Navy Round", tracking: "Quantity", lendable: 12, photo: null, photos: [], attributes: {}, units: [],
    bookings: [{ loanId: "recRES00000000001", status: "Reserved", unitId: null, from: iso(1), to: iso(7), quantity: 12 },
               { loanId: "recOTHER0000000N", status: "Reserved", unitId: null, from: iso(20), to: iso(25), quantity: 12 }], held: [] },
  // 12 owned; someone else has all 12 for days 1–5 (the R-111 clash).
  { id: "recTAUPE", name: "Taupe Round", tracking: "Quantity", lendable: 12, photo: null, photos: [], attributes: {}, units: [],
    bookings: [{ loanId: "recOTHER00000001", status: "Reserved", unitId: null, from: iso(1), to: iso(5), quantity: 12, borrower: "Chaya" }], held: [] },
  // 12 owned, nothing booked.
  { id: "recIVORY", name: "Ivory Round", tracking: "Quantity", lendable: 12, photo: null, photos: [], attributes: {}, units: [], bookings: [], held: [] },
  // One numbered gown, reserved by someone else for days 3–4.
  { id: "recGOWN", name: "Gown G", tracking: "Units", photo: null, photos: [], attributes: {}, units: [{ id: "recUG", itemId: "GG-001" }],
    bookings: [{ loanId: "recOTHER00000002", status: "Reserved", unitId: null, from: iso(3), to: iso(4), quantity: 1 }], held: [] },
  // 10 chairs: this loan has 6 out; another reservation takes 5 from day 5.
  { id: "recCHAIR", name: "Chairs", tracking: "Quantity", lendable: 10, photo: null, photos: [], attributes: {}, units: [],
    bookings: [{ loanId: "recLOANACT0000001", status: "Active", unitId: null, from: iso(-2), to: iso(3), quantity: 6 },
               { loanId: "recOTHER00000003", status: "Reserved", unitId: null, from: iso(5), to: iso(6), quantity: 5 }], held: [] },
];

const reqs = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url()), p = u.pathname, M = r.request().method();
  const body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
  reqs.push({ method: M, path: p, search: u.search, body });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Naomi", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 1, overdueLoans: 0, upcomingReservations: 1 });
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/loans" && M === "GET") return J(LOANS);
  if (p === "/admin/checkout/options") return J({ today: TODAY, defaultLoanDays: 14, types: TYPES });
  if (p === "/admin/booking" && M === "GET") return J(BOOKINGS[u.search.slice(1)] || { error: "Not found" }, BOOKINGS[u.search.slice(1)] ? 200 : 404);
  if (p === "/admin/booking" && M === "PATCH") return J({ success: true, changes: ["x"] });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "tablecloths"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);
const rowText = n => page.textContent(`#bk-items .co-row >> nth=${n}`);
const result = name => page.textContent(`#bk-results .co-result:has-text('${name}')`);

// ── Reservation (days 1–7) ──
await page.click(".nav-tab:has-text('Reservations')");
await page.waitForSelector("#res-row-recRES00000000001");
await page.click("#res-row-recRES00000000001");
await page.click("#res-panel-recRES00000000001 button:has-text('Edit')");
await page.waitForSelector("#bk-name");
await page.waitForTimeout(200);
ok(reqs.some(r => r.path === "/admin/checkout/options"), "inventory loads when the sheet opens (no need to search first)");
ok(!/free|booked/.test(await rowText(0)), "the booking's own 12 don't count against it: no warning on the existing row");

// Search results show what's free for the reservation dates.
await page.fill("#bk-search", "round");
await page.waitForSelector("#bk-results .co-result");
ok(/All 12 booked/.test(await result("Taupe Round")), "search: Taupe is all booked for these dates");
ok(await page.$eval("#bk-results .co-result:has-text('Taupe Round') .tag", e => e.classList.contains("tag-amber")), "search: booked shows amber");
ok(!(await page.isDisabled("#bk-results .co-result:has-text('Taupe Round')")), "search: still addable");
ok(/12 of 12 free/.test(await result("Ivory Round")), "search: Ivory 12 of 12 free");

// Adding the clashing tablecloth warns (this is what happened on R-071).
await page.click("#bk-results .co-result:has-text('Taupe Round')");
await page.waitForSelector("#bk-items .co-row.added");
await page.fill("#bk-items .co-row.added input[type=number]", "12");
await page.dispatchEvent("#bk-items .co-row.added input[type=number]", "change");
await page.waitForTimeout(50);
const taupe = await page.textContent("#bk-items .co-row.added");
ok(/⚠ All 12 booked for these dates · one is due back/.test(taupe) && /You can still reserve it/.test(taupe), "added clashing item warns: " + taupe);

// A free one says how many are free; asking for more than that warns.
await page.fill("#bk-search", "ivory");
await page.waitForSelector("#bk-results .co-result");
await page.click("#bk-results .co-result");
await page.waitForTimeout(50);
ok(/12 of 12 free for these dates/.test(await rowText(2)), "added free item: 12 of 12 free");

// Numbered unit booked by someone else for part of the window.
await page.fill("#bk-search", "gown");
await page.waitForSelector("#bk-results .co-result");
ok(/All 1 booked/.test(await result("Gown G")), "search: numbered gown booked for part of the window");
await page.click("#bk-results .co-result");
await page.waitForTimeout(50);
ok(/⚠ All 1 booked for these dates/.test(await rowText(3)), "added gown warns");

// Moving the dates past the clashes clears the warnings; moving the existing item onto another booking warns.
await page.fill("#bk-res-start", iso(10));
await page.fill("#bk-res-end", iso(12));
await page.dispatchEvent("#bk-res-end", "change");
await page.waitForTimeout(50);
ok(/12 of 12 free for these dates/.test(await rowText(1)) && !/⚠/.test(await rowText(1)), "new dates: Taupe is free again");
ok(!/⚠/.test(await rowText(0)), "existing item still fine on the new dates");
await page.fill("#bk-res-start", iso(19));
await page.fill("#bk-res-end", iso(21));
await page.dispatchEvent("#bk-res-end", "change");
await page.waitForTimeout(50);
ok(/⚠ All 12 booked for these dates/.test(await rowText(0)), "moving the existing reservation onto another booking warns: " + await rowText(0));
await page.screenshot({ path: "shot-bk-availability.png", fullPage: true });

// The warning doesn't block saving.
await page.click("#bk-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Saved"));
const p1 = reqs.filter(r => r.path === "/admin/booking" && r.method === "PATCH").at(-1).body;
ok(p1.add?.some(a => a.itemTypeId === "recTAUPE" && a.quantity === 12) && p1.reservationStart === iso(19), "saved anyway: " + JSON.stringify(p1));

// ── Loan: extending counted items into someone's reservation warns ──
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loan-row-recLOANACT0000001");
await page.click("#loan-row-recLOANACT0000001");
await page.click("#loan-panel-recLOANACT0000001 button:has-text('Edit')");
await page.waitForSelector("#bk-due");
await page.waitForTimeout(150);
ok(!/⚠/.test(await rowText(0)), "6 of 10 chairs out until day 3: fine");
await page.fill("#bk-due", iso(8));
await page.dispatchEvent("#bk-due", "change");
await page.waitForTimeout(50);
ok(/⚠ Only 5 of 10 free until the due date/.test(await rowText(0)) && /You can still lend it/.test(await rowText(0)), "extending into another reservation warns: " + await rowText(0));

ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
