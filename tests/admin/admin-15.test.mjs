// Edit a booking from Reservations, Loans, appointments and Requests: borrower, dates, items, notes,
// cancel, and an optional message. Only what changed is sent.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const TODAY = iso(0);
const atIso = (n, h) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const G = { id: "recA", slug: "kallah", name: "Kallah Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text",
  phone: "5165551212", requestStyle: "Dates", eventLabel: "Event date", returnDaysAfter: 1, pickupDaysBefore: 1, defaultLoanDays: 14 };

const RES = [
  { id: "recRES00000000001", loanId: "L-801", borrowerName: "Dana Fisch", itemTypeName: "Gown X", reservationStart: iso(5), reservationEnd: iso(10), borrowerPhone: "5165550301" },
  { id: "recRES00000000002", loanId: "L-802", borrowerName: "Dana Fisch", itemTypeName: "Chairs", isQuantity: true, quantity: 2, reservationStart: iso(5), reservationEnd: iso(10) },
];
const LOANS = [{ id: "recLOANACT0000001", loanId: "L-810", borrowerName: "Walk In", itemTypeName: "Gown Z", itemId: "BZ-001", dateBorrowed: iso(-2), expectedReturn: iso(3), daysOut: 2, overdue: false }];
const APPTS = [{ id: "recAPPT0000000001", requestId: "R-970", name: "Appt Person", phone: "5165550303", appointmentAt: atIso(4, 18), past: false, itemNames: ["Gown Y"], itemTypeIds: ["recTY"] }];
const REQS = [{ id: "recREQNEW00000001", requestId: "R-971", name: "New Person", phone: "5165550304", receivedAt: new Date().toISOString(), requestType: "Loan",
  neededFrom: iso(8), neededUntil: iso(9), items: [{ id: "recTY", name: "Gown Y" }], itemNames: ["Gown Y"] }];

const BOOKINGS = {
  "loan=recRES00000000001": { kind: "reservation", requestStyle: "Dates", eventLabel: "Event date", defaultLoanDays: 14, today: TODAY,
    request: { id: "recREQRES00000001", requestId: "R-960", status: "Converted", requestType: "Loan", name: "Dana Fisch", phone: "5165550301", email: "dana@example.com", preferredContact: "SMS",
      neededFrom: iso(5), neededUntil: iso(10), items: [], manageUrl: "https://whgemachs.org/r/recREQRES00000001.sig" },
    borrower: { id: "recB1", name: "Dana Fisch", phone: "5165550301", email: "dana@example.com", preferredContact: "Text" },
    loans: [
      { id: "recRES00000000001", loanId: "L-801", status: "Reserved", itemTypeId: "recTX", itemTypeName: "Gown X", tracking: "Units", photo: null, photos: [], itemId: null, quantity: null, reservationStart: iso(5), reservationEnd: iso(10), notes: null },
      { id: "recRES00000000002", loanId: "L-802", status: "Reserved", itemTypeId: "recCH", itemTypeName: "Chairs", tracking: "Quantity", photo: null, photos: [], itemId: null, quantity: 2, reservationStart: iso(5), reservationEnd: iso(10), notes: null },
    ] },
  "loan=recLOANACT0000001": { kind: "loan", requestStyle: "Dates", eventLabel: "Event date", defaultLoanDays: 14, today: TODAY, request: null,
    borrower: { id: "recB2", name: "Walk In", phone: "5165550302", email: null, preferredContact: null },
    loans: [{ id: "recLOANACT0000001", loanId: "L-810", status: "Active", itemTypeId: "recTZ", itemTypeName: "Gown Z", tracking: "Units", photo: null, photos: [], itemId: "BZ-001", quantity: null, dateBorrowed: iso(-2), expectedReturn: iso(3), notes: "Paid" }] },
  "request=recAPPT0000000001": { kind: "appointment", requestStyle: "Appointment", eventLabel: "Simcha date", defaultLoanDays: null, today: TODAY,
    request: { id: "recAPPT0000000001", requestId: "R-970", status: "Converted", requestType: "Appointment", name: "Appt Person", phone: "5165550303", email: "appt@example.com", preferredContact: "Email",
      appointmentAt: atIso(4, 18), eventDate: iso(30), items: [{ itemTypeId: "recTY", name: "Gown Y", tracking: "Units", photo: null, photos: [], quantity: null }], manageUrl: "https://whgemachs.org/r/recAPPT0000000001.sig" },
    borrower: null, loans: [] },
  "request=recREQNEW00000001": { kind: "request", requestStyle: "Dates", eventLabel: "Event date", defaultLoanDays: 14, today: TODAY,
    request: { id: "recREQNEW00000001", requestId: "R-971", status: "New", requestType: "Loan", name: "New Person", phone: "5165550304", email: null, preferredContact: null,
      neededFrom: iso(8), neededUntil: iso(9), openEnded: false, items: [{ itemTypeId: "recTY", name: "Gown Y", tracking: "Units", photo: null, photos: [], quantity: null }] },
    borrower: null, loans: [] },
};
const TYPES = [
  { id: "recTY", name: "Gown Y", tracking: "Units", photo: null, photos: [], attributes: {}, units: [{ id: "recUY", itemId: "BY-001" }], bookings: [], held: [] },
  { id: "recTW", name: "Gown W", tracking: "Units", photo: null, photos: [], attributes: {}, units: [{ id: "recUW1", itemId: "BW-001" }, { id: "recUW2", itemId: "BW-002" }],
    bookings: [{ status: "Active", unitId: "recUW1", from: iso(-1), to: iso(4), quantity: 1 }], held: [] },
  { id: "recCH", name: "Chairs", tracking: "Quantity", lendable: 8, photo: null, photos: [], attributes: {}, units: [], bookings: [], held: [] },
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
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 1, activeLoans: 1, overdueLoans: 0, upcomingReservations: 2 });
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/loans" && M === "GET") return J(LOANS);
  if (p === "/admin/appointments") return J(APPTS);
  if (p === "/admin/requests") return J(REQS);
  if (p === "/admin/checkout/options") return J({ today: TODAY, defaultLoanDays: 14, types: TYPES });
  if (p === "/admin/booking" && M === "GET") return J(BOOKINGS[u.search.slice(1)] || { error: "Not found" }, BOOKINGS[u.search.slice(1)] ? 200 : 404);
  if (p === "/admin/booking" && M === "PATCH") {
    if (body.expectedReturn && body.expectedReturn < iso(-2)) return J({ error: "The due-back date is before it was picked up." }, 400);
    return J({ success: true, changes: ["x"] });
  }
  if (p === "/admin/booking/cancel") return J({ success: true, cancelled: 2, requestCancelled: true });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "kallah"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);
const lastPatch = () => reqs.filter(r => r.path === "/admin/booking" && r.method === "PATCH").at(-1)?.body;

// ── Reservation: open from a row, edit contact + dates + count, remove one, add one, message by email ──
await page.click(".nav-tab:has-text('Reservations')");
await page.waitForSelector("#res-row-recRES00000000001");
await page.click("#res-row-recRES00000000001");
await page.click("#res-panel-recRES00000000001 button:has-text('Edit')");
await page.waitForSelector("#bk-name");
ok((await page.textContent("#bk-title")) === "Edit reservation — Dana Fisch", "title");
ok((await page.$$("#bk-items .co-row")).length === 2, "both reserved items of the request in one sheet");
ok((await page.inputValue("#bk-pref")) === "Text" && (await page.inputValue("#bk-res-start")) === iso(5), "fields filled from the booking");
await page.click("#bk-save-btn");
ok(/Nothing has changed/.test(await page.textContent("#bk-error")), "saving with no changes says so");
await page.fill("#bk-name", "Dana Fischer");
await page.fill("#bk-email", "dana.f@example.com");
await page.fill("#bk-res-end", iso(12));
await page.fill("#bk-items .co-row >> nth=1 >> input[type=number]", "4");
await page.dispatchEvent("#bk-items .co-row >> nth=1 >> input[type=number]", "change");
await page.click("#bk-items .co-row >> nth=0 >> .co-remove");
await page.waitForSelector("#bk-items .co-row.removed");
ok(/Will be removed — undo/.test(await page.textContent("#bk-items .co-row.removed")), "removed item is struck through with undo");
await page.fill("#bk-search", "bw-00");
await page.waitForSelector("#bk-results .co-result");
await page.click("#bk-results .co-result");
await page.waitForSelector("#bk-items .co-row.added");
ok(/will be reserved/.test(await page.textContent("#bk-items .co-row.added")), "added item will be reserved (no unit needed)");
const msg = await page.inputValue("#bk-message");
ok(/Hi Dana, we've updated your reservation/.test(msg) && /Items: Chairs × 4 and Gown W/.test(msg) && /Reserved: .* → /.test(msg) && msg.includes("https://whgemachs.org/r/recREQRES00000001.sig"), "message summarises the booking: " + msg);
ok((await page.textContent("#bk-save-btn")) === "Save changes" && (await page.getAttribute("#bk-send-by [data-send='none']", "aria-checked")) === "true", "message is optional: 'Don't send' by default");
await page.click("#bk-send-by [data-send='email']");
await page.screenshot({ path: "shot-bk-reservation.png", fullPage: true });
await page.click("#bk-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Saved"));
const p1 = lastPatch();
ok(p1.loan === "recRES00000000001" && p1.borrower?.name === "Dana Fischer" && p1.borrower?.email === "dana.f@example.com" && p1.borrower?.preferredContact === "Text", "borrower sent: " + JSON.stringify(p1.borrower));
ok(p1.reservationEnd === iso(12) && !("reservationStart" in p1), "only the changed date is sent");
ok(JSON.stringify(p1.quantities) === JSON.stringify({ recRES00000000002: 4 }) && JSON.stringify(p1.remove) === JSON.stringify(["recRES00000000001"]), "count + removal");
ok(JSON.stringify(p1.add) === JSON.stringify([{ itemTypeId: "recTW" }]) && p1.addAs === "reserved", "added item as a reservation");
ok(p1.sendMessage === true && /Gown W/.test(p1.message), "email message sent with the save");

// ── Loan: extend the due date with a chip, add an item lent now ──
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loan-row-recLOANACT0000001");
await page.click("#loan-row-recLOANACT0000001");
await page.click("#loan-panel-recLOANACT0000001 button:has-text('Edit')");
await page.waitForSelector("#bk-due");
ok((await page.textContent("#bk-title")) === "Edit loan — Walk In" && !(await page.$("#bk-danger button")), "loan: no cancel button (return instead)");
ok((await page.inputValue("#bk-due")) === iso(3) && (await page.inputValue("#bk-borrowed")) === iso(-2), "picked-up and due-back dates");
await page.click("#bk-due-chips .co-chip:has-text('+1 week')");
ok((await page.inputValue("#bk-due")) === iso(10), "+1 week extends from the current due date");
await page.fill("#bk-search", "bw-00");
await page.waitForSelector("#bk-results .co-result");
await page.click("#bk-results .co-result");
ok(/BW-002/.test(await page.textContent("#bk-items .co-row.added")) && /will be lent now/.test(await page.textContent("#bk-items .co-row.added")), "added item: the free unit, lent now");
await page.screenshot({ path: "shot-bk-loan.png", fullPage: true });
await page.click("#bk-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Saved"));
const p2 = lastPatch();
ok(p2.loan === "recLOANACT0000001" && p2.expectedReturn === iso(10) && !("dateBorrowed" in p2) && !("borrower" in p2), "only the due date + add: " + JSON.stringify(p2));
ok(JSON.stringify(p2.add) === JSON.stringify([{ itemTypeId: "recTW", itemId: "recUW2" }]) && p2.addAs === "active", "add as an active loan with its unit");

// ── Appointment: reschedule; cancel ──
await page.click(".nav-tab:has-text('Reservations')");
await page.waitForSelector("#appt-recAPPT0000000001");
await page.click("#appt-recAPPT0000000001 button:has-text('Edit')");
await page.waitForSelector("#bk-appt-date");
const nyTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(APPTS[0].appointmentAt));
ok((await page.textContent("#bk-title")) === "Edit appointment — Appt Person" && (await page.inputValue("#bk-appt-time")) === nyTime, "appointment time filled in New York time");
await page.fill("#bk-appt-date", iso(6));
await page.fill("#bk-appt-time", "19:30");
await page.dispatchEvent("#bk-appt-time", "change");
ok(/Appointment: .* at 7:30 PM/.test(await page.inputValue("#bk-message")), "message shows the new time");
await page.click("#bk-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Saved"));
ok(lastPatch().appointmentAt === `${iso(6)}T19:30` && lastPatch().request === "recAPPT0000000001", "reschedule sent");
await page.click("#appt-recAPPT0000000001 button:has-text('Edit')");
await page.waitForSelector("#bk-danger button");
ok((await page.textContent("#bk-danger button")).includes("Cancel appointment"), "cancel appointment button");
await page.click("#bk-danger button");
await page.waitForFunction(() => document.body.textContent.includes("Appointment cancelled"));
ok(reqs.some(r => r.path === "/admin/booking/cancel" && r.body.request === "recAPPT0000000001" && !r.body.sendMessage), "cancel POSTed (no message by default)");

// ── Request still waiting: change dates, make open-ended, swap the item ──
await page.click(".nav-tab:has-text('Requests')");
await page.waitForSelector("#requests-list .card");
await page.click("#requests-list .card button:has-text('Edit')");
await page.waitForSelector("#bk-from");
await page.fill("#bk-from", iso(9));
await page.check("#bk-open");
ok(await page.isDisabled("#bk-until"), "open-ended disables the end date");
await page.click("#bk-items .co-row .co-remove");
await page.fill("#bk-search", "chairs");
await page.waitForSelector("#bk-results .co-result");
await page.click("#bk-results .co-result");
await page.waitForSelector("#bk-items .co-row");
await page.screenshot({ path: "shot-bk-request.png", fullPage: true });
await page.click("#bk-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Saved"));
const p4 = lastPatch();
ok(p4.request === "recREQNEW00000001" && p4.neededFrom === iso(9) && p4.openEnded === true && !("neededUntil" in p4), "request dates: " + JSON.stringify(p4));
ok(JSON.stringify(p4.requestedItems) === JSON.stringify([{ itemTypeId: "recCH", quantity: 1 }]), "requested items replaced");

// ── Server errors are shown in the sheet ──
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loan-row-recLOANACT0000001");
await page.click("#loan-row-recLOANACT0000001");
await page.click("#loan-panel-recLOANACT0000001 button:has-text('Edit')");
await page.waitForSelector("#bk-due");
await page.fill("#bk-due", iso(-5));
await page.click("#bk-save-btn");
await page.waitForFunction(() => /before it was picked up/.test(document.getElementById("bk-error").textContent));
ok(await page.isVisible("#booking-sheet .sheet"), "error keeps the sheet open");

ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
