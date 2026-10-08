// Borrower lookup in New reservation / New appointment / New loan: search, pick fills details, borrower.id sent, "on file" hint.
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
  { kind: "reservation", date: TODAY, end: plus(6), name: "Moshe Klein", phone: "5165550500", preferredContact: "Text", items: ["Wheelchair", "Folding chairs × 20"], requestId: "R-12", photos: [], ref: { request: "recREQMOSHE000001" },
    loans: [
      { id: "recLOANMOSHE00001", loanId: "L-51", borrowerName: "Moshe Klein", borrowerPhone: "5165550500", itemTypeName: "Wheelchair", itemTypeId: "recWC", itemRecId: null, isQuantity: false, isAddon: false, quantity: null,
        reservationStart: TODAY, reservationEnd: plus(6), notes: "Needs it for a wedding", requestNote: null, manageUrl: "https://whgemachs.org/r/recREQMOSHE000001.sig" },
      { id: "recLOANMOSHE00002", loanId: "L-52", borrowerName: "Moshe Klein", borrowerPhone: "5165550500", itemTypeName: "Folding chairs", itemTypeId: "recCH", itemRecId: null, isQuantity: true, isAddon: false, quantity: 20,
        reservationStart: TODAY, reservationEnd: plus(6), notes: null, requestNote: null, manageUrl: "https://whgemachs.org/r/recREQMOSHE000001.sig" },
    ] },
  { kind: "reservation", date: plus(1), end: null, name: "Open Ended", items: ["Walker"], requestId: null, photos: [], ref: { loan: "recLOANOPEN000001" },
    loans: [{ id: "recLOANOPEN000001", loanId: "L-53", borrowerName: "Open Ended", itemTypeName: "Walker", itemTypeId: "recWK", isQuantity: false, isAddon: false, quantity: null, reservationStart: plus(1) }] },
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
    if (p === "/admin/borrowers") return J({ borrowers: BORROWERS });
    if (p === "/admin/loans" && M === "POST") return J({ success: true, loans: [{ id: "recLOANNEW000001", loanId: "L-300" }], dueBack: null });
    if (p === "/admin/booking/cancel") return J({ success: true, cancelled: 2, requestCancelled: true });
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

const BORROWERS = [
  { id: "recBORRIVKA00001", name: "Rivka Cohen", phone: "(516) 555-1234", email: "rivka@example.com", preferredContact: "WhatsApp", loans: 3, lastAt: plus(-20), out: 1, dueBack: plus(5) },
  { id: "recBORRIVKA00002", name: "Rivka Adler", phone: "(516) 555-7777", email: null, preferredContact: "Text", loans: 1, lastAt: plus(-60), out: 0, dueBack: null },
  { id: "recBORMOSHE00001", name: "Moshe Klein", phone: "516-555-0500", email: "moshe@example.com", preferredContact: "Phone", loans: 2, lastAt: plus(-5), out: 0, dueBack: null },
];

{
  const G = { id: "recA", slug: "stead-to-wed", name: "From Stead to Wed", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text",
    phone: "5165551313", email: "s2w@example.com", requestStyle: "Appointment", eventLabel: "Wedding date", defaultLoanDays: 14 };
  const { page, reqs, errors } = await run(G);

  // New reservation: typing in Name lists matches; picking fills the rest
  await page.click("#quick-actions [data-qa='reservation']");
  await page.waitForSelector("#nb-name");
  await page.waitForFunction(() => window.BL && BL.list);
  ok(reqs.some(r => r.path === "/admin/borrowers"), "borrowers loaded when the sheet opens");
  await page.type("#nb-name", "r");
  ok((await page.$$("#nb-name-matches .bl-result")).length === 0, "nothing listed for one letter");
  await page.type("#nb-name", "iv");
  await page.waitForSelector("#nb-name-matches .bl-result");
  const rows = await page.$$eval("#nb-name-matches .bl-result", bs => bs.map(b => b.textContent));
  ok(rows.length === 2 && /Rivka Cohen/.test(rows[0]) && /Rivka Adler/.test(rows[1]), "both Rivkas listed: " + rows.join(" | "));
  ok(/1 out now · due/.test(rows[0]) && /last borrowed/.test(rows[0]) && /\(516\) 555-1234/.test(rows[0]), "row shows phone, last borrowed, what's out");
  await page.screenshot({ path: "shot-borrower-lookup-list.png" });
  await page.fill("#nb-name", "rivka co");
  await page.dispatchEvent("#nb-name", "input");
  ok((await page.$$("#nb-name-matches .bl-result")).length === 1, "more letters narrow it down");
  await page.click("#nb-name-matches .bl-result");
  ok(await page.inputValue("#nb-name") === "Rivka Cohen" && await page.inputValue("#nb-phone") === "(516) 555-1234" &&
     await page.inputValue("#nb-email") === "rivka@example.com" && await page.inputValue("#nb-pref") === "WhatsApp", "picking fills name, phone, email, prefers");
  ok(/Returning borrower · 3 past loans · 1 out now/.test(await page.textContent("#nb-name ~ .bl-note")) && !(await page.$("#nb-name-matches .bl-result")), "returning borrower line; list closes");
  await page.screenshot({ path: "shot-borrower-lookup-picked.png" });
  // Fix her email and save: borrower.id goes with it
  await page.fill("#nb-email", "rivka.c@example.com");
  await page.fill("#nb-search", "walker");
  await page.click("#nb-results .co-result");
  await page.click("#nb-send-by [data-send='none']").catch(() => {});
  await page.click("#nb-save-btn");
  await page.waitForFunction(() => document.getElementById("nb-done").style.display !== "none" || !document.getElementById("newbk-sheet").classList.contains("open"));
  const post = reqs.find(r => r.path === "/admin/reservations" && r.method === "POST").body;
  ok(post.borrower.id === "recBORRIVKA00001" && post.borrower.email === "rivka.c@example.com" && post.borrower.name === "Rivka Cohen", "POST carries the picked borrower id + edited email: " + JSON.stringify(post.borrower));

  // New appointment: "Not them? Clear" starts over; a phone already on file is pointed out
  await page.evaluate(() => closeSheet("newbk-sheet"));
  await page.click("#quick-actions [data-qa='appointment']");
  await page.waitForSelector("#nb-appt-date");
  await page.waitForFunction(() => window.BL && BL.list && BL.ids.name === "nb-name");
  await page.fill("#nb-name", "Mo");
  await page.dispatchEvent("#nb-name", "input");
  await page.click("#nb-name-matches .bl-result");
  await page.click("#nb-name ~ .bl-note [data-bl='clear']");
  ok(await page.inputValue("#nb-name") === "" && await page.inputValue("#nb-phone") === "" && !(await page.textContent("#nb-name ~ .bl-note")), "Clear empties the details");
  await page.fill("#nb-name", "Moishe K");
  await page.dispatchEvent("#nb-name", "input");
  await page.keyboard.press("Escape").catch(() => {});
  await page.fill("#nb-phone", "5165550500");
  await page.dispatchEvent("#nb-phone", "change");
  ok(/This number is on file for Moshe Klein/.test(await page.textContent("#nb-name ~ .bl-note")), "phone already on file → hint");
  await page.click("#nb-name ~ .bl-note [data-bl]");
  ok(await page.inputValue("#nb-name") === "Moshe Klein" && await page.inputValue("#nb-email") === "moshe@example.com" && await page.inputValue("#nb-pref") === "Phone", "Use their details fills them in");
  await page.fill("#nb-appt-date", plus(2)); await page.fill("#nb-appt-time", "11:00");
  await page.click("#nb-send-by [data-send='none']").catch(() => {});
  await page.click("#nb-save-btn");
  await page.waitForFunction(() => document.getElementById("nb-done").style.display !== "none" || !document.getElementById("newbk-sheet").classList.contains("open"));
  const ap = reqs.find(r => r.path === "/admin/appointments" && r.method === "POST").body;
  ok(ap.borrower.id === "recBORMOSHE00001", "appointment POST carries the id");
  await page.evaluate(() => closeSheet("newbk-sheet"));

  // New loan (walk-in): same lookup; typing a new name sends no id
  await page.click("#quick-actions [data-qa='loan']");
  await page.waitForSelector("#co-name");
  await page.waitForFunction(() => window.BL && BL.list && BL.ids.name === "co-name");
  await page.fill("#co-name", "Adler");
  await page.dispatchEvent("#co-name", "input");
  ok(/Rivka Adler/.test(await page.textContent("#co-name-matches")), "walk-in lists matches by last name");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  ok(await page.inputValue("#co-name") === "Rivka Adler" && await page.inputValue("#co-phone") === "(516) 555-7777" && await page.inputValue("#co-pref") === "Text", "keyboard pick fills the walk-in fields");
  await page.fill("#co-name", "");
  await page.dispatchEvent("#co-name", "input");
  ok(await page.inputValue("#co-phone") === "" && !(await page.evaluate(() => BL.picked)), "wiping the name forgets the pick");
  await page.fill("#co-name", "Brand New Person");
  await page.dispatchEvent("#co-name", "input");
  ok(!(await page.$("#co-name-matches .bl-result")), "no match for a new person");
  await page.fill("#co-phone", "5165550999");
  await page.fill("#co-search", "walker");
  await page.click("#co-results .co-result");
  await page.click("#checkout-send-by [data-send='none']").catch(() => {});
  await page.click("#checkout-submit-btn");
  await page.waitForFunction(() => document.querySelector("body").textContent.includes("L-300") || !document.getElementById("checkout-sheet").classList.contains("open"), null, { timeout: 5000 }).catch(() => {});
  const wl = reqs.filter(r => r.path === "/admin/loans" && r.method === "POST").at(-1)?.body;
  ok(wl && wl.borrower.name === "Brand New Person" && !("id" in wl.borrower), "new person: no borrower id sent");

  ok(!errors.length, "no page errors: " + errors.join(" | "));
  await page.close();
}
await browser.close();
