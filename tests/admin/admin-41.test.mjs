// Multi-item reservations (Oct 28, 2026): the items are a checklist, all checked, with one "Mark all picked up"
// button. Several checked → one pickup sheet: a unit pre-chosen per unit item (never the same one twice), a
// count for quantity items and add-ons. Items already picked up show on the card and the row.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const REQ = { requestId: "R-031", receivedAt: new Date(Date.now() - 2 * 86400000).toISOString(), source: null };
const who = { borrowerName: "Rivka Stern", borrowerPhone: "5165551111", borrowerEmail: "rs@example.com", borrowerContact: "Email",
  reservationStart: iso(1), reservationEnd: iso(14), requestRecId: "recREQRIVKA0001", request: REQ, bookingPickedUp: [] };
const RES = [
  { id: "recRESRIVKA00001", loanId: "L-40", ...who, itemTypeName: "Wheelchair", itemTypeId: "recTWC", itemRecId: null },
  { id: "recRESRIVKA00002", loanId: "L-41", ...who, itemTypeName: "Wheelchair", itemTypeId: "recTWC", itemRecId: null },
  { id: "recRESRIVKA00003", loanId: "L-42", ...who, itemTypeName: "Shower Seat", itemTypeId: "recTSH", itemRecId: "recUSH2", itemId: "SH-002" },
  { id: "recRESRIVKA00004", loanId: "L-43", ...who, itemTypeName: "Folding Chair", itemTypeId: "recTFC", isQuantity: true, quantity: 20 },
  { id: "recRESRIVKA00005", loanId: "L-44", ...who, itemTypeName: "Family Sweatshirt", itemTypeId: "recTSW", isAddon: true, price: 40, quantity: 4 },
  { id: "recRESPART000001", loanId: "L-50", borrowerName: "Part Pick", borrowerPhone: "5165552222", borrowerContact: "Call", itemTypeName: "Walker", itemTypeId: "recTWK",
    reservationStart: iso(2), reservationEnd: iso(9), requestRecId: "recREQPART00002", request: { ...REQ, requestId: "R-032" },
    bookingPickedUp: [{ id: "recRESPART000002", itemTypeName: "Crutches", itemId: "CR-001", status: "Active", datePickedUp: iso(0) }] },
];
const UNITS = [
  { id: "recUWC1", itemId: "WC-001", itemTypeId: "recTWC", active: true, status: "On Loan" },
  { id: "recUWC2", itemId: "WC-002", itemTypeId: "recTWC", active: true, status: "Available" },
  { id: "recUWC4", itemId: "WC-004", itemTypeId: "recTWC", active: true, status: "Available" },
];
const G = { id: "recA", slug: "wh-medical", name: "Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], posts = [];
let failId = null;
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const p = new URL(r.request().url()).pathname;
  const J = (d, s = 200) => r.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(d) });
  if (r.request().method() === "POST") {
    posts.push({ p, body: r.request().postDataJSON() });
    if (failId && p.includes(failId)) return J({ error: "WC-004 is already out on loan (L-9). Choose another, or mark that one returned first." }, 409);
    return J({ success: true });
  }
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 6 });
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/catalog/items") return J({ items: UNITS, itemTypes: [] });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(400);
await page.evaluate(() => switchTab("reservations"));
await page.waitForSelector("#reservations-list .loan-row");

// ── Partly picked up booking
ok(/1 picked up · 1 reserved/i.test(await page.innerText("#res-row-recRESPART000001")), "row tag: picked up / reserved");
await page.click("#res-row-recRESPART000001");
const pp = (await page.innerText("#res-panel-recRESPART000001")).replace(/\s+/g, " ");
ok(/1 of 2 items picked up · 1 still reserved/.test(pp) && /Crutches.*Picked up.*now on Loans/.test(pp), "card summary + picked-up item: " + pp);
ok(!(await page.$("#res-retall-recRESPART000001")) && /Mark picked up/.test(pp), "one item left: its own button");

// ── Five items: all checked, one button
await page.click("#res-row-recRESRIVKA00001");
const P = "#res-panel-recRESRIVKA00001";
ok(await page.$$eval(`${P} .bk-ret-box`, e => e.length === 5 && e.every(x => x.checked)), "every item starts checked (add-on too)");
ok((await page.textContent("#res-retall-recRESRIVKA00001")).includes("Mark all picked up"), "button: Mark all picked up");
ok(/Uncheck anything they aren't taking today/.test(await page.innerText(P)), "help says Uncheck");
await page.screenshot({ path: "shot-mark-all-picked-up.png", fullPage: true });
await page.uncheck("#pk-recRESRIVKA00001-2");
ok((await page.textContent("#res-retall-recRESRIVKA00001")).includes("Mark 4 of 5 picked up"), "count follows the checkboxes");
await page.check("#pk-recRESRIVKA00001-2");

// ── The sheet
await page.click("#res-retall-recRESRIVKA00001");
await page.waitForSelector("#pickup-multi select");
ok(/5 items/.test(await page.textContent("#pickup-subtitle")), "subtitle counts the items");
const picks = await page.$$eval("#pickup-multi select", e => e.map(s => s.options[s.selectedIndex].text));
ok(picks.join() === "WC-002,WC-004", "two wheelchairs get two different available units: " + picks);
ok(/SH-002/.test(await page.innerText("#pickup-multi")), "unit already chosen: just shown");
ok(await page.$$eval("#pickup-multi [data-pkq]", e => e.map(i => i.value).join()) === "20,4", "counts for chairs and the add-on");
ok(/Confirm pickup of 5/.test(await page.textContent("#pickup-submit-btn")), "button counts");
await page.screenshot({ path: "shot-pickup-many.png", fullPage: true });
// Same unit twice is caught before anything is saved
await page.selectOption("#pickup-multi [data-pku='1']", "recUWC2");
let n0 = posts.length;
await page.click("#pickup-submit-btn");
await page.waitForTimeout(200);
ok(posts.length === n0 && /already chosen above/.test(await page.innerText("#pickup-multi")), "same unit twice: stopped, nothing saved");
await page.selectOption("#pickup-multi [data-pku='1']", "recUWC4");
await page.fill("#pickup-multi [data-pkq='3']", "18");
// One fails on the server: the rest are saved, it stays with the reason
failId = "recRESRIVKA00002";
n0 = posts.length;
await page.click("#pickup-submit-btn");
await page.waitForTimeout(500);
let sent = posts.slice(n0);
ok(sent.length === 5, "five pickup calls: " + sent.length);
ok(sent[0].body.itemId === "recUWC2" && sent[1].body.itemId === "recUWC4", "units sent");
ok(sent[3].body.quantity === 18 && sent[4].body.quantity === 4, "counts sent");
ok(sent.every(x => x.body.pickupDate), "each with the date");
ok(await page.$eval("#pickup-sheet", e => e.classList.contains("open")), "sheet stays open for the one that failed");
ok(/already out on loan/.test(await page.innerText("#pickup-multi")) && (await page.$$eval("#pickup-multi .pk-done", e => e.length)) === 4, "4 done, 1 with its reason");
ok(/Confirm pickup of 1/.test(await page.textContent("#pickup-submit-btn")), "button: what's left");
// Fix it and try again: only that one is sent
failId = null;
await page.selectOption("#pickup-multi [data-pku='1']", "recUWC1");
n0 = posts.length;
await page.click("#pickup-submit-btn");
await page.waitForTimeout(400);
sent = posts.slice(n0);
ok(sent.length === 1 && /RIVKA00002/.test(sent[0].p) && sent[0].body.itemId === "recUWC1", "retry sends only the one left");
ok(!(await page.$eval("#pickup-sheet", e => e.classList.contains("open"))), "sheet closes when all are done");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
