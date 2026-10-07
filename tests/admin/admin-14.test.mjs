// Lending at the counter: appointment "Check out" (untick what wasn't taken, add what was), "Nothing borrowed" /
// "No-show", walk-in "New loan", and the optional usual loan length in Settings.
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
const G = { id: "recA", slug: "simcha-dress", name: "Simcha Dress Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text",
  phone: "5165551212", requestStyle: "Appointment", eventLabel: "Simcha date", returnDaysAfter: 1, pickupDaysBefore: 7, defaultLoanDays: 21 };

const TYPES = [
  { id: "recGOWNA000000001", name: "Navy gown – size 8", tracking: "Units", photo: null, photos: [], attributes: { Size: ["8"], Color: ["Navy"] },
    units: [{ id: "recUNITA000000001", itemId: "SD-001", needsRepair: false }], bookings: [], held: [] },
  { id: "recGOWNB000000001", name: "Gold gown – size 10", tracking: "Units", photo: null, photos: [], attributes: { Size: ["10"] },
    units: [{ id: "recUNITB000000001", itemId: "SD-002", needsRepair: false }], bookings: [],
    held: [{ at: atIso(3, 19), name: "Rivka", requestId: "R-951" }] },
  { id: "recGOWNO000000001", name: "Red gown – size 12", tracking: "Units", photo: null, photos: [], attributes: {},
    units: [{ id: "recUNITO000000001", itemId: "SD-004", needsRepair: false }],
    bookings: [{ status: "Active", unitId: "recUNITO000000001", from: iso(-5), to: iso(9), quantity: 1, borrower: "Dina" }], held: [] },
  { id: "recDRESSC00000001", name: "Black dress – size 6", tracking: "Units", photo: null, photos: [], attributes: { Color: ["Black"] },
    units: [{ id: "recUNITC000000001", itemId: "SD-003", needsRepair: false }],
    bookings: [{ status: "Reserved", unitId: null, from: iso(10), to: iso(12), quantity: 1, borrower: "Malka" }], held: [] },
  { id: "recCHAIRS00000001", name: "Chairs", tracking: "Quantity", photo: null, photos: [], attributes: {}, lendable: 8, units: [],
    bookings: [{ status: "Active", unitId: null, from: iso(-1), to: iso(5), quantity: 3, borrower: "X" }], held: [] },
];
const SALLY = { id: "recSALLY00000001", requestId: "R-950", name: "Sally Katz", phone: "5165550101", email: "sally@example.com", preferredContact: "Email",
  requestType: "Appointment", status: "Converted", visitOutcome: null, appointmentAt: atIso(0, 18), eventDate: iso(20), notes: null,
  itemTypeIds: ["recGOWNA000000001", "recGOWNB000000001", "recGOWNO000000001"], quantities: {}, manageUrl: "https://whgemachs.org/r/recSALLY00000001.sig" };
const APPTS = [
  { id: "recPAST000000001", requestId: "R-940", name: "Past Person", phone: "5165550000", appointmentAt: atIso(-2, 18), past: true, itemNames: ["Gold gown – size 10"], itemTypeIds: ["recGOWNB000000001"] },
  { id: SALLY.id, requestId: "R-950", name: "Sally Katz", phone: SALLY.phone, email: SALLY.email, preferredContact: "Email", appointmentAt: SALLY.appointmentAt, past: false,
    itemNames: ["Navy gown – size 8", "Gold gown – size 10", "Red gown – size 12"], itemTypeIds: SALLY.itemTypeIds },
];

const reqs = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
let appts = APPTS.slice();
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url()), p = u.pathname, M = r.request().method();
  const body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
  reqs.push({ method: M, path: p, search: u.search, body });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach" && M === "PATCH") { Object.assign(G, body); return J(G); }
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/appointments") return J(appts);
  if (p === "/admin/checkout/options") return J({ today: TODAY, defaultLoanDays: G.defaultLoanDays, types: TYPES, ...(u.searchParams.get("request") ? { request: SALLY } : {}) });
  if (p === `/admin/requests/${SALLY.id}/checkout`) { appts = appts.filter(a => a.id !== SALLY.id); return J({ success: true, loans: body.items.map((x, i) => ({ id: "recL" + i, loanId: "L-" + i })) }); }
  if (p === "/admin/requests/recPAST000000001/visit") { appts = appts.filter(a => a.id !== "recPAST000000001"); return J({ success: true, visitOutcome: "No-show" }); }
  if (p === "/admin/loans" && M === "POST") {
    if (!body.items.length) return J({ error: "Choose at least one item." }, 400);
    return J({ success: true, loans: body.items.map((x, i) => ({ id: "recW" + i, loanId: "L-9" + i })) });
  }
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "simcha-dress"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);

// ── Appointments: upcoming + past (to close) with the new buttons ──
await page.click(".nav-tab:has-text('Reservations')");
await page.waitForSelector("#appointments-list .card");
ok(/Appointments \(2\) · 1 to close/.test(await page.textContent("#appointments-section-label")), "section label counts the ones to close");
ok((await page.textContent(`#appt-recPAST000000001 .tag`)) === "Did they come?", "past appointment asks whether they came");
ok(!!(await page.$(`#appt-recPAST000000001 button:has-text('No-show')`)) && !(await page.$(`#appt-${SALLY.id} button:has-text('No-show')`)), "No-show only on past appointments");
await page.screenshot({ path: "shot-co-appointments.png" });

// ── Check out Sally: requested items ticked; on-loan one blocked; held hint; due date from the usual length ──
await page.click(`#appt-${SALLY.id} button:has-text('Check out')`);
await page.waitForSelector("#co-asked-list .co-row");
ok(reqs.some(r => r.path === "/admin/checkout/options" && r.search === `?request=${SALLY.id}`), "options loaded for this request");
ok((await page.textContent("#checkout-title")) === "Check out — Sally Katz", "title names the borrower");
const asked = await page.$$eval("#co-asked-list .co-row", rs => rs.map(r => ({ on: r.querySelector("input[type=checkbox]").checked, dis: r.querySelector("input[type=checkbox]").disabled, text: r.textContent })));
ok(asked.length === 3 && asked[0].on && asked[1].on && !asked[2].on && asked[2].dis, "requested items start ticked; the one on loan is blocked");
ok(/On loan to Dina · due back/.test(asked[2].text), "blocked row says who has it and when it's due");
ok(/Rivka has an appointment to see this/.test(asked[1].text), "held-for-appointment hint");
ok((await page.inputValue("#checkout-due")) === iso(21), "due date = today + usual loan length");
const chips = await page.$$eval("#checkout-due-chips .co-chip", bs => bs.map(b => b.textContent));
ok(chips[0] === "In 21 days · after the simcha" && chips.at(-1) === "No date", "due-date shortcuts; same day as the simcha return merges: " + chips.join(" | "));
await page.screenshot({ path: "shot-co-sheet.png", fullPage: true });

// Untick the gold gown, add the black dress she also took
await page.uncheck("#co-asked-list .co-row >> nth=1 >> input[type=checkbox]");
await page.waitForFunction(() => document.querySelectorAll("#co-asked-list .co-row.off").length === 2);
await page.fill("#co-search", "black");
await page.waitForSelector("#co-results .co-result");
ok((await page.$$("#co-results .co-result")).length === 1, "search by color finds the black dress");
await page.click("#co-results .co-result");
await page.waitForSelector("#co-extra-list .co-row");
ok(/Reserved for Malka .* lending this may leave them without one/.test(await page.textContent("#co-extra-list .co-row")), "her 21-day loan would clash with Malka's reservation: warned");
await page.fill("#checkout-due", iso(9));
await page.dispatchEvent("#checkout-due", "change");
ok(!/Reserved for Malka/.test(await page.textContent("#co-extra-list .co-row")), "back before Malka's dates: no warning");
await page.click(".co-chip:has-text('1 week')");
ok((await page.inputValue("#checkout-due")) === iso(7) && (await page.getAttribute(".co-chip:has-text('1 week')", "class")).includes("active"), "shortcut sets the date");
await page.fill("#checkout-due", iso(11));
await page.dispatchEvent("#checkout-due", "change");
ok(/Reserved for Malka/.test(await page.textContent("#co-extra-list .co-row")), "a clash with a later reservation warns once the due date overlaps");
await page.fill("#checkout-due", iso(9));
await page.dispatchEvent("#checkout-due", "change");
const msg = await page.inputValue("#checkout-message");
ok(/You're borrowing Navy gown – size 8 and Black dress – size 6\./.test(msg), "message lists what's going out: " + msg);
ok(msg.includes("Due back:") && msg.includes("https://whgemachs.org/r/recSALLY00000001.sig"), "message has the due date and her manage link");
ok(/2 items going out to Sally Katz/.test(await page.textContent("#checkout-summary")), "summary counts the items");
ok((await page.textContent("#checkout-submit-btn")) === "Lend & email", "send by email (her preference)");
await page.screenshot({ path: "shot-co-sheet-ready.png", fullPage: true });
await page.click("#checkout-submit-btn");
await page.waitForFunction(() => document.body.textContent.includes("Lent 2 items to Sally Katz"));
const co = reqs.find(r => r.path === `/admin/requests/${SALLY.id}/checkout`).body;
ok(JSON.stringify(co.items) === JSON.stringify([{ itemTypeId: "recGOWNA000000001", itemId: "recUNITA000000001" }, { itemTypeId: "recDRESSC00000001", itemId: "recUNITC000000001" }]), "POST items: taken + added, not the unticked one");
ok(co.dueBack === iso(9) && co.sendMessage === true && /Navy gown/.test(co.message), "POST due date + email message");
ok(!(await page.isVisible("#checkout-sheet .sheet")), "sheet closed");
ok(!(await page.$(`#appt-${SALLY.id}`)), "appointment card gone");

// ── No-show on the past appointment ──
await page.click("#appt-recPAST000000001 button:has-text('No-show')");
await page.waitForFunction(() => document.body.textContent.includes("Marked as a no-show"));
ok(reqs.some(r => r.path === "/admin/requests/recPAST000000001/visit" && r.body.outcome === "noshow"), "no-show POSTed");

// ── Walk-in: New loan on the Loans tab ──
await page.click(".nav-tab:has-text('Loans')");
await page.click("#new-loan-btn");
await page.waitForSelector("#co-name");
ok((await page.textContent("#checkout-title")) === "New loan" && !(await page.$("#co-asked-list")), "walk-in sheet: no requested list");
ok(await page.isDisabled("#checkout-submit-btn"), "nothing to lend yet: button disabled");
await page.fill("#co-search", "chair");
await page.click("#co-results .co-result");
await page.fill("#co-extra-list input[type=number]", "6");
await page.dispatchEvent("#co-extra-list input[type=number]", "change");
await page.waitForFunction(() => /Only 5 of 8 free/.test(document.querySelector("#co-extra-list .co-row").textContent), null, { timeout: 3000 }).catch(() => {});
ok(/Only 5 of 8 free/.test(await page.textContent("#co-extra-list .co-row")), "quantity over what's free warns");
await page.click("#checkout-submit-btn");
ok(/borrower's name/.test(await page.textContent("#checkout-error")), "name required");
await page.fill("#co-name", "Leah Gold");
await page.click("#checkout-submit-btn");
ok(/phone number or email/.test(await page.textContent("#checkout-error")), "phone or email required");
await page.fill("#co-phone", "516-555-0199");
await page.dispatchEvent("#co-phone", "change");
await page.fill("#checkout-notes", "Paid in cash");
await page.click(".co-send-none, #checkout-send-by [data-send='none']");
await page.screenshot({ path: "shot-co-walkin.png", fullPage: true });
await page.click("#checkout-submit-btn");
await page.waitForFunction(() => document.body.textContent.includes("Lent 1 item to Leah Gold"));
const w = reqs.filter(r => r.path === "/admin/loans" && r.method === "POST").at(-1).body;
ok(w.borrower.name === "Leah Gold" && w.borrower.phone === "516-555-0199" && w.notes === "Paid in cash", "walk-in POST: borrower + note");
ok(JSON.stringify(w.items) === JSON.stringify([{ itemTypeId: "recCHAIRS00000001", quantity: 6 }]) && w.sendMessage === false, "walk-in POST: quantity item, no message");

// ── Settings: usual loan length (optional) ──
await page.click("text=Settings");
await page.waitForSelector("#set-defaultLoanDays", { state: "attached" });
await page.evaluate(() => typeof showSettingsArea === "function" && showSettingsArea("requests"));
ok((await page.inputValue("#set-defaultLoanDays")) === "21", "setting loaded");
await page.fill("#set-defaultLoanDays", "400");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("1 to 365"));
await page.fill("#set-defaultLoanDays", "");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
const sp = reqs.filter(r => r.method === "PATCH" && r.path === "/admin/gemach").at(-1).body;
ok(JSON.stringify(sp) === JSON.stringify({ defaultLoanDays: null }), "blank clears it: " + JSON.stringify(sp));

ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
