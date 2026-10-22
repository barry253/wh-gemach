// Reservations search and filters (Oct 22, 2026): the same search box, item filter and sort as
// Loans, with reservation pills (All upcoming / This week / Pickup passed). The search also narrows the appointments;
// pills, item filter and sort apply to reservations only. Filters reset when the tab is opened, not after a pickup.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

// New York dates, whatever time zone the test machine is in
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const iso = n => { const d = new Date(nyToday() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const req = (id, rid, daysAgo) => ({ requestRecId: id, request: { requestId: rid, receivedAt: new Date(Date.now() - daysAgo * 86400000).toISOString() } });
const P = (name, phone, email) => ({ borrowerName: name, borrowerPhone: phone, borrowerEmail: email, borrowerContact: "Email" });
const RES = [
  // Rivka: two items in one booking, pickup in 2 days
  { id: "recRESRIVKA00001", ...P("Rivka Adler", "5165551111", "rivka@example.com"), itemTypeName: "Gold Jacquard · Round", isQuantity: true, quantity: 12,
    reservationStart: iso(2), reservationEnd: iso(9), ...req("recREQRIVKA0001", "R-101", 1) },
  { id: "recRESRIVKA00002", ...P("Rivka Adler", "5165551111", "rivka@example.com"), itemTypeName: "Solid Navy · Rectangle", isQuantity: true, quantity: 6,
    reservationStart: iso(2), reservationEnd: iso(9), ...req("recREQRIVKA0001", "R-101", 1) },
  // Rivka again, a second booking 20 days out
  { id: "recRESRIVKA00003", ...P("Rivka Adler", "5165551111", "rivka@example.com"), itemTypeName: "Lily · Round", isQuantity: true, quantity: 6,
    reservationStart: iso(20), reservationEnd: iso(24), ...req("recREQRIVKA0002", "R-110", 0) },
  // Bracha: pickup date passed, not picked up
  { id: "recRESBRACHA0001", ...P("Bracha Zeller", "7185552222", null), itemTypeName: "Solid Navy · Rectangle", isQuantity: true, quantity: 12,
    reservationStart: iso(-3), reservationEnd: iso(4), ...req("recREQBRACHA001", "R-090", 9) },
  // Aviva: walk-in reservation (no request), unit item, 10 days out
  { id: "recRESAVIVA00001", ...P("Aviva Cohen", null, "aviva@example.com"), itemTypeName: "Wheelchair", itemId: "WC-007",
    reservationStart: iso(10), reservationEnd: iso(12), requestRecId: null, request: null },
];
const APPTS = [
  { id: "recAPPTMIRI00001", name: "Miri Gold", phone: "5165553333", email: "miri@example.com", appointmentAt: iso(1) + "T19:00:00.000Z",
    itemNames: ["Navy gown – size 8"], items: [{ name: "Navy gown – size 8", units: ["SD-044"], tracking: "Units", attributes: {} }] },
  { id: "recAPPTSHIRA0001", name: "Shira Klein", phone: "5165554444", email: null, appointmentAt: iso(3) + "T19:00:00.000Z", itemNames: [], items: [] },
];
const G = { id: "recA", slug: "wh-medical", name: "Simcha Dress Gemach", requestStyle: "Appointment", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
let resData = RES;
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (r.request().method() === "POST") return J({ success: true });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 5 });
  if (p === "/admin/reservations") return J(resData);
  if (p === "/admin/appointments") return J(APPTS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForFunction(() => window.GEMACH?.requestStyle || (typeof GEMACH !== "undefined" && GEMACH?.requestStyle));
await page.waitForTimeout(300);

const rows = () => page.$$eval("#reservations-list .loan-row", e => e.map(x => x.id.replace("res-row-", "")));
const count = () => page.textContent("#res-count");
const apptShown = () => page.$$eval("#appointments-list > .card", e => e.filter(x => !x.hidden).map(x => x.id));

await page.evaluate(() => switchTab("reservations"));
await page.waitForSelector("#reservations-list .loan-row");
await page.waitForSelector("#appointments-list .card");

// ── Defaults
ok(await page.isVisible("#res-search") && await page.isVisible("#res-tools"), "search box and tools show");
ok(JSON.stringify(await rows()) === JSON.stringify(["recRESBRACHA0001", "recRESRIVKA00001", "recRESAVIVA00001", "recRESRIVKA00003"]),
  "sorted by pickup date: " + (await rows()).join());
ok(/^4 reservations · 5 items/.test(await count()), "count: " + await count());
const pills = (await page.innerText("#res-pills")).replace(/\s+/g, " ");
ok(/All upcoming 4/.test(pills) && /This week 1/.test(pills) && /Pickup passed 1/.test(pills), "pills: " + pills);
ok(await page.$eval("#res-sort", e => e.value) === "start", "default sort is pickup date");
ok(/Appointments \(2\)/.test(await page.textContent("#appointments-section-label")), "appointments label unchanged");

// ── Pills
await page.click("#res-pills button:has-text('Pickup passed')");
ok(JSON.stringify(await rows()) === JSON.stringify(["recRESBRACHA0001"]), "Pickup passed: Bracha only");
ok(await page.$eval("#res-pills .loans-pill.amber", e => e.classList.contains("active")), "Pickup passed pill is amber when on");
ok(/1 of 4 reservations/.test(await count()) && await page.isVisible("#res-count .link-btn"), "count shows the filter with Clear");
ok((await apptShown()).length === 2, "pills don't hide appointments");
await page.click("#res-pills button:has-text('This week')");
ok(JSON.stringify(await rows()) === JSON.stringify(["recRESRIVKA00001"]), "This week: pickup in the next 7 days (not the passed one)");
await page.click("#res-pills button:has-text('All upcoming')");

// ── Search: reservations and appointments
await page.fill("#res-search", "navy");
ok(JSON.stringify(await rows()) === JSON.stringify(["recRESBRACHA0001", "recRESRIVKA00001"]), "search by item finds bookings with that item: " + (await rows()).join());
ok(JSON.stringify(await apptShown()) === JSON.stringify(["appt-recAPPTMIRI00001"]), "and appointments asking to see it");
ok(/Appointments \(1 of 2\)/.test(await page.textContent("#appointments-section-label")), "appointments label says 1 of 2");
await page.fill("#res-search", "wc-007");
ok(JSON.stringify(await rows()) === JSON.stringify(["recRESAVIVA00001"]), "unit number");
ok(/none match/.test(await page.textContent("#appointments-section-label")), "no appointment matches");
await page.fill("#res-search", "4444");
ok((await rows()).length === 0 && /No reservations match/.test(await page.textContent("#reservations-list")), "phone digits: no reservation");
ok(JSON.stringify(await apptShown()) === JSON.stringify(["appt-recAPPTSHIRA0001"]), "phone digits find the appointment");
await page.fill("#res-search", "sd-044");
ok(JSON.stringify(await apptShown()) === JSON.stringify(["appt-recAPPTMIRI00001"]), "appointment unit number");
await page.fill("#res-search", "rivka");
ok((await rows()).length === 2, "borrower name");

await page.click("#res-count .link-btn");
ok(await page.$eval("#res-search", e => e.value) === "" && (await rows()).length === 4 && (await apptShown()).length === 2, "Clear resets search and shows everything");

// ── Item filter
await page.click("#res-item-btn");
ok(/What's reserved/.test(await page.textContent("#loan-item-sub")), "sheet subtitle for reservations");
const opts = await page.$$eval("#loan-item-list .loan-item-opt", e => e.map(x => x.innerText.replace(/\s+/g, " ").trim()));
ok(opts.join("|") === "All item types 5|Gold Jacquard · Round 1|Lily · Round 1|Solid Navy · Rectangle 2|Wheelchair 1", "item counts: " + opts.join("|"));
await page.click("#loan-item-list .loan-item-opt:has-text('Lily')");
ok(JSON.stringify(await rows()) === JSON.stringify(["recRESRIVKA00003"]) && /Item: Lily/.test(await page.textContent("#res-item-btn")), "item filter");
ok((await apptShown()).length === 2, "item filter doesn't hide appointments");

// ── Filters stay after a refresh (a pickup / edit), reset when the tab is opened again
resData = RES.filter(r => r.id !== "recRESRIVKA00002");
await page.evaluate(() => loadReservations());
await page.waitForTimeout(300);
ok(/Item: Lily/.test(await page.textContent("#res-item-btn")) && (await rows()).length === 1, "filters kept after a refresh");
await page.evaluate(() => switchTab("dashboard"));
await page.evaluate(() => switchTab("reservations"));
await page.waitForTimeout(300);
ok(/Item: All/.test(await page.textContent("#res-item-btn")) && (await rows()).length === 4, "reset when the tab opens");

// ── Sorts, remembered on this device separately from Loans
const sortRows = async v => { await page.selectOption("#res-sort", v); return (await rows()).join(); };
ok(await sortRows("end") === "recRESBRACHA0001,recRESRIVKA00001,recRESAVIVA00001,recRESRIVKA00003", "return date");
ok(await sortRows("borrower") === "recRESAVIVA00001,recRESBRACHA0001,recRESRIVKA00001,recRESRIVKA00003", "borrower A–Z, then pickup");
ok(await sortRows("item") === "recRESRIVKA00001,recRESRIVKA00003,recRESBRACHA0001,recRESAVIVA00001", "item A–Z");
ok(await sortRows("recent") === "recRESRIVKA00003,recRESRIVKA00001,recRESBRACHA0001,recRESAVIVA00001", "recently made (no request last)");
const saved = await page.evaluate(() => ({ r: localStorage.getItem("whg_res_view"), l: localStorage.getItem("whg_loans_view") }));
ok(JSON.stringify(JSON.parse(saved.r)) === '{"sort":"recent"}' && !saved.l, "sort saved for Reservations only");
ok(!(await page.$("#res-group")) && !(await page.$("#loans-group")), "no Group by borrower on either tab");
await page.screenshot({ path: "shot-res-search.png", fullPage: true });

// ── Nothing reserved, but appointments: search still shows, tools don't
resData = [];
await page.evaluate(() => loadReservations(true));
await page.waitForTimeout(300);
ok(await page.isVisible("#res-search") && !(await page.isVisible("#res-tools")), "only appointments: search shows, tools hidden");
ok(/No upcoming reservations/.test(await page.textContent("#reservations-list")), "empty state");

// ── Desktop width: search and both buttons on one line
await page.setViewportSize({ width: 1280, height: 800 });
const tops = await page.$$eval("#res-bar .loans-row > *", e => e.filter(x => x.offsetParent).map(x => Math.round(x.getBoundingClientRect().top)));
ok(new Set(tops).size === 1, "desktop: one row " + tops.join());

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
