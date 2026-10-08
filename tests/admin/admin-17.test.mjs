// Dashboard quick actions + Upcoming, and New reservation / New appointment on someone's behalf.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const TODAY = nyToday();
const plus = n => { const [y, m, d] = TODAY.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const nyAt = (n, h, min = 0) => new Date(`${plus(n)}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00-04:00`).toISOString();

const TYPES = [
  { id: "recWC", name: "Wheelchair", tracking: "Units", photo: null, photos: [], attributes: {}, units: [{ id: "recU1", itemId: "WC-001" }, { id: "recU2", itemId: "WC-002" }],
    bookings: [{ status: "Active", unitId: "recU1", from: plus(-3), to: plus(4), quantity: 1, borrower: "A" }, { status: "Reserved", unitId: null, from: plus(1), to: plus(3), quantity: 1, borrower: "B" }], held: [] },
  { id: "recWK", name: "Walker", tracking: "Units", photo: null, photos: [], attributes: {}, units: [{ id: "recU3", itemId: "WK-001" }], bookings: [], held: [] },
  { id: "recCH", name: "Folding chairs", tracking: "Quantity", lendable: 40, photo: null, photos: [], attributes: {}, units: [], bookings: [{ status: "Reserved", unitId: null, from: plus(2), to: plus(2), quantity: 30 }], held: [] },
];
const UPCOMING = { today: TODAY, days: 7, until: plus(7), items: [
  { kind: "reservation", date: plus(-1), late: true, end: plus(5), name: "Late Larry", items: ["Walker"], requestId: "R-10", photos: [], ref: { request: "recREQLATE0000001" } },
  { kind: "appointment", at: nyAt(0, 19, 30), date: TODAY, name: "Tova Stein", items: ["Navy gown"], requestId: "R-11", photos: [], ref: { request: "recAPPTTODAY00001" } },
  { kind: "reservation", date: TODAY, end: plus(6), name: "Moshe Klein", items: ["Wheelchair", "Folding chairs × 20"], requestId: "R-12", photos: [], ref: { request: "recREQMOSHE000001" } },
  { kind: "reservation", date: plus(1), end: null, name: "Open Ended", items: ["Walker"], requestId: null, photos: [], ref: { loan: "recLOANOPEN000001" } },
  { kind: "appointment", at: nyAt(3, 11), date: plus(3), name: "Future Appt", items: [], requestId: "R-13", photos: [], ref: { request: "recAPPTFUTURE0001" } },
] };

async function run(G) {
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
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 3, overdueLoans: 0, upcomingReservations: 4 });
    if (p === "/admin/upcoming") return J({ ...UPCOMING, days: Number(u.searchParams.get("days")) || 7 });
    if (p === "/admin/stats") return J({ requests: { received: 0, confirmed: 0, declined: 0, waiting: 0 } });
    if (p === "/admin/checkout/options") return J({ today: TODAY, defaultLoanDays: G.defaultLoanDays ?? null, types: TYPES,
      ...(u.searchParams.get("request") ? { request: { id: u.searchParams.get("request"), requestId: "R-11", name: "Tova Stein", phone: "5165550111", requestType: "Appointment",
        status: "Converted", appointmentAt: nyAt(0, 19, 30), itemTypeIds: [], quantities: {}, manageUrl: "https://whgemachs.org/r/x.sig" } } : {}) });
    if (p === "/admin/booking") return J({ error: "Not found" }, 404);
    if (p === "/admin/reservations" && M === "POST") return J({ success: true, request: "recNEWREQ0000001", requestId: "R-200", manageUrl: "https://whgemachs.org/r/recNEWREQ0000001.sig", loans: ["L-1", "L-2"] });
    if (p === "/admin/appointments" && M === "POST") return J({ success: true, request: "recNEWAPPT000001", requestId: "R-201", manageUrl: "https://whgemachs.org/r/recNEWAPPT000001.sig" });
    return J([]);
  });
  await page.addInitScript(slug => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", slug); }, G.slug);
  await page.goto("http://admin.test/admin.html");
  await page.waitForSelector("#quick-actions .quick-action");
  return { page, reqs, errors };
}

// ── A dates-style gemach (WH Medical) ──
{
  const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text",
    phone: "5165551212", requestStyle: "Dates", eventLabel: "Event date", defaultLoanDays: 14, pickupAddress: "12 Main St" };
  const { page, reqs, errors } = await run(G);
  await page.waitForFunction(() => document.querySelectorAll("#quick-actions .quick-action").length === 2);
  ok((await page.$$eval("#quick-actions .quick-action", bs => bs.map(b => b.textContent.trim()))).join("|") === "📅New reservation|🤝New loan", "quick actions: New reservation + New loan");
  ok((await page.$eval("#quick-actions", el => el.getBoundingClientRect().top)) < (await page.$eval("#stat-grid", el => el.getBoundingClientRect().top)), "quick actions at the top");

  // Upcoming
  await page.waitForSelector("#upcoming-body .up-row");
  ok((await page.$eval("#upcoming-body", el => el.getBoundingClientRect().top)) < (await page.$eval("#stats-body", el => el.getBoundingClientRect().top)), "Upcoming sits above How it's going");
  const heads = await page.$$eval("#upcoming-body .upcoming-day", hs => hs.map(h => h.textContent));
  ok(heads[0].startsWith("Pickup date passed") && /^Today · /.test(heads[1]) && /^Tomorrow · /.test(heads[2]) && heads.length === 4, "grouped: late pickups, Today, Tomorrow, later: " + heads.join(" | "));
  const rows = await page.$$eval("#upcoming-body .up-row", rs => rs.map(r => r.innerText.replace(/\s+/g, " ").trim()));
  ok(/7:30 PM Appointment Tova Stein Navy gown · R-11 Appt Check out/i.test(rows[1]), "today's appointment: time + Check out: " + rows[1]);
  ok(/Pickup until .* Moshe Klein Wheelchair, Folding chairs × 20 · R-12 Reserved/i.test(rows[2]), "reservation row: items + until: " + rows[2]);
  ok(/Pickup open-ended/.test(rows[3]) && /Pickup was due/.test(rows[0]), "open-ended and late rows");
  ok(!/Check out/.test(rows[4]), "future appointment: no Check out yet");
  await page.screenshot({ path: "shot-dash-upcoming.png", fullPage: true });
  await page.click("#upcoming-body .up-row >> nth=2 >> .up-open");
  await page.waitForFunction(() => document.getElementById("booking-sheet").classList.contains("open"));
  ok(reqs.some(r => r.path === "/admin/booking" && r.search === "?request=recREQMOSHE000001"), "tap a row → its Edit sheet");
  await page.click("#booking-sheet .sheet-close");
  await page.click("#upcoming-body .up-row >> nth=1 >> button:has-text('Check out')");
  await page.waitForFunction(() => document.getElementById("checkout-sheet").classList.contains("open"));
  ok(reqs.some(r => r.path === "/admin/checkout/options" && r.search === "?request=recAPPTTODAY00001"), "Check out from Upcoming");
  await page.click("#checkout-sheet .sheet-close");
  await page.selectOption("#upcoming-days", "14");
  await page.waitForFunction(() => true);
  await page.waitForTimeout(200);
  ok(reqs.some(r => r.path === "/admin/upcoming" && r.search === "?days=14"), "changing the period reloads");
  ok(await page.evaluate(() => localStorage.getItem("whg_upcoming_days")) === "14", "period remembered on this device");

  // New reservation from Quick actions
  await page.click("#quick-actions [data-qa='reservation']");
  await page.waitForSelector("#nb-name");
  ok((await page.textContent("#nb-title")) === "New reservation" && (await page.inputValue("#nb-from")) === TODAY && (await page.inputValue("#nb-until")) === plus(14), "dates default to today + usual loan length");
  await page.click("#nb-save-btn");
  ok(/borrower's name/.test(await page.textContent("#nb-error")), "name required");
  await page.fill("#nb-name", "Chaya Gold");
  await page.click("#nb-save-btn");
  ok(/phone number or email/.test(await page.textContent("#nb-error")), "contact required");
  await page.fill("#nb-phone", "516-555-0101");
  await page.dispatchEvent("#nb-phone", "change");
  await page.click("#nb-save-btn");
  ok(/at least one item/.test(await page.textContent("#nb-error")), "an item required");
  await page.fill("#nb-from", plus(1)); await page.fill("#nb-until", plus(3));
  await page.dispatchEvent("#nb-until", "change");
  await page.fill("#nb-search", "wheel");
  await page.waitForSelector("#nb-results .co-result");
  ok(/0 of 2 free/.test(await page.textContent("#nb-results .co-result")), "search shows how many are free for the dates");
  await page.click("#nb-results .co-result");
  await page.waitForSelector("#nb-items .co-row");
  ok(/All 2 booked for these dates · one is due back/.test(await page.textContent("#nb-items .co-row")), "warns when every unit is booked, can still reserve");
  await page.fill("#nb-from", plus(5)); await page.fill("#nb-until", plus(8));
  await page.dispatchEvent("#nb-until", "change");
  await page.waitForFunction(() => /2 of 2 free for these dates/.test(document.querySelector("#nb-items .co-row").textContent));
  ok(true, "free count follows the dates");
  await page.fill("#nb-search", "chairs");
  await page.click("#nb-results .co-result");
  await page.fill("#nb-items .co-row >> nth=1 >> input[type=number]", "25");
  await page.dispatchEvent("#nb-items .co-row >> nth=1 >> input[type=number]", "change");
  await page.waitForFunction(() => /40 of 40 free/.test(document.querySelectorAll("#nb-items .co-row")[1].textContent));
  ok(true, "quantity items: free pieces for the dates");
  await page.fill("#nb-notes", "Called Sunday");
  const msg = await page.inputValue("#nb-message");
  ok(/^Hi Chaya, great news — we have Wheelchair and Folding chairs × 25 available/.test(msg) && /Reserved for .* – /.test(msg) && msg.includes("{manage_link}"), "message from the confirm template + dates + link placeholder: " + msg);
  ok((await page.textContent("#nb-save-btn")) === "Save, then WhatsApp", "phone, no preference: WhatsApp first, like the other sheets");
await page.click("#nb-send-by [data-send='sms']");
ok((await page.textContent("#nb-save-btn")) === "Save, then text", "choose text instead");
  await page.screenshot({ path: "shot-new-reservation.png", fullPage: true });
  await page.click("#nb-save-btn");
  await page.waitForSelector("#nb-send-now");
  const post = reqs.find(r => r.path === "/admin/reservations" && r.method === "POST").body;
  ok(post.borrower.name === "Chaya Gold" && post.borrower.phone === "516-555-0101" && post.reservationStart === plus(5) && post.reservationEnd === plus(8) && post.notes === "Called Sunday", "POST: borrower, dates, note");
  ok(JSON.stringify(post.items) === JSON.stringify([{ itemTypeId: "recWC" }, { itemTypeId: "recCH", quantity: 25 }]) && !post.sendMessage, "POST items; text goes from the phone, not the server");
  ok(/Reservation saved · R-200/.test(await page.textContent("#nb-done")), "saved, then a tap to send the text");
  await page.screenshot({ path: "shot-new-reservation-done.png" });
  await page.evaluate(() => { window.__clicked = []; HTMLAnchorElement.prototype.click = function () { window.__clicked.push(this.href); }; });
  await page.click("#nb-send-now");
  const href = (await page.evaluate(() => window.__clicked))[0] || "";
  ok(href.startsWith("sms:5165550101") && decodeURIComponent(href).includes("https://whgemachs.org/r/recNEWREQ0000001.sig"), "text opens with the real manage link");

  // Reservations page toolbar
  await page.click(".nav-tab:has-text('Reservations')");
  ok(await page.isVisible("#new-res-btn") && !(await page.isVisible("#new-appt-btn")), "Reservations: + New reservation (no appointment button for a dates gemach)");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await page.close();
}

// ── An appointment gemach (Stead to Wed) ──
{
  const G = { id: "recA", slug: "stead-to-wed", name: "From Stead to Wed", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text",
    phone: "5165551313", email: "s2w@example.com", requestStyle: "Appointment", eventLabel: "Wedding date", defaultLoanDays: null };
  const { page, reqs, errors } = await run(G);
  await page.waitForFunction(() => document.querySelectorAll("#quick-actions .quick-action").length === 3);
  ok((await page.$$eval("#quick-actions .quick-action", bs => bs.map(b => b.textContent.trim()))).join("|") === "📅New reservation|🤝New loan|🕒New appointment", "appointment gemach: also New appointment");
  await page.click(".nav-tab:has-text('Reservations')");
  ok(await page.isVisible("#new-appt-btn"), "Reservations: + New appointment");
  await page.click("#new-appt-btn");
  await page.waitForSelector("#nb-appt-date");
  ok((await page.textContent("#nb-title")) === "New appointment" && !(await page.$("#nb-from")), "appointment sheet: date + time, no reservation dates");
  await page.fill("#nb-name", "Rina Katz");
  await page.fill("#nb-email", "rina@example.com");
  await page.dispatchEvent("#nb-email", "change");
  await page.click("#nb-save-btn");
  ok(/appointment date and time/.test(await page.textContent("#nb-error")), "time required");
  await page.fill("#nb-appt-date", plus(4));
  await page.fill("#nb-appt-time", "19:30");
  await page.dispatchEvent("#nb-appt-time", "change");
  await page.fill("#nb-event", plus(60));
  await page.fill("#nb-search", "walker");
  await page.click("#nb-results .co-result");
  const msg = await page.inputValue("#nb-message");
  ok(/your appointment at the From Stead to Wed is set for .* at 7:30 PM/.test(msg) && msg.includes("{manage_link}"), "appointment template: " + msg);
  ok((await page.textContent("#nb-save-btn")) === "Save & email", "email only: Save & email");
  await page.screenshot({ path: "shot-new-appointment.png", fullPage: true });
  await page.click("#nb-save-btn");
  await page.waitForFunction(() => document.body.textContent.includes("Appointment booked · R-201"));
  const post = reqs.find(r => r.path === "/admin/appointments" && r.method === "POST").body;
  ok(post.appointmentAt === `${plus(4)}T19:30` && post.eventDate === plus(60) && JSON.stringify(post.items) === JSON.stringify([{ itemTypeId: "recWK" }]), "POST appointment: time, event date, items");
  ok(post.sendMessage === true && post.message.includes("{manage_link}"), "email sent by the server, which fills in the link");
  ok(!(await page.isVisible("#newbk-sheet .sheet")), "sheet closes after an email save");
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await page.close();
}
await browser.close();
