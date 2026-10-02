// Saved copies: tabs show the last answer at once (paused, "Updating…"), then the fresh one.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const req = (n, name) => ({ id: "recREQSNAP0000" + n, requestId: "R-" + n, name, phone: "5165551234", email: "x@example.com", preferredContact: "Email",
  itemNames: ["Walker"], items: [{ id: "recTYPEWALK000001", name: "Walker", quantity: null }], neededFrom: "2026-11-01", neededUntil: "2026-11-03",
  openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" });
let REQS = [req(101, "Old Person")];
let LOANS = [{ id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Loan One", borrowerPhone: "5165553333", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: "2026-09-01", daysOut: 30 },
  { id: "recLOAN0000000002", loanId: "L-2", borrowerName: "Loan Two", borrowerPhone: "5165553334", borrowerContact: "Text", itemTypeName: "Wheelchair", dateBorrowed: "2026-09-02", daysOut: 29 }];
let delay = 0, meDelay = 0;
const TYPES = [{ id: "recTYPEWC00000001", name: "Wheelchair", tracking: "Units", active: true, displayOrder: 1, itemCount: 2 },
  { id: "recTYPEWALK000001", name: "Walker", tracking: "Units", active: true, displayOrder: 2, itemCount: 3 }];
const unit = (n, type, typeName, status, condition = "Good") => ({ id: "recITEM" + n, itemId: n, itemTypeId: type, itemTypeName: typeName, condition, status, active: true, notes: null });
const UNITS = [unit("WC-001", "recTYPEWC00000001", "Wheelchair", "Available"), unit("WC-002", "recTYPEWC00000001", "Wheelchair", "On Loan"),
  unit("WK-001", "recTYPEWALK000001", "Walker", "Available"), unit("WK-002", "recTYPEWALK000001", "Walker", "Available"), unit("WK-003", "recTYPEWALK000001", "Walker", "Available", "Needs Repair")];
const todayIso = new Date().toLocaleDateString("en-CA");
const HOLDS = [{ loanRecId: "recLH1", loanId: "L-901", itemTypeId: "recTYPEWC00000001", itemTypeName: "Wheelchair", borrowerName: "Moshe Wasserman", reservationStart: todayIso, reservationEnd: null },
  { loanRecId: "recLH2", loanId: "L-902", itemTypeId: "recTYPEWALK000001", itemTypeName: "Walker", borrowerName: "Cynthia Berdy", reservationStart: "2099-01-05", reservationEnd: null }];
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], calls = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const rq = r.request(); const p = new URL(rq.url()).pathname;
  calls.push({ method: rq.method(), path: p, at: Date.now() });
  const J = async (d, ms = delay) => { if (ms) await new Promise(res => setTimeout(res, ms)); return r.fulfill({ contentType: "application/json", body: JSON.stringify(d) }).catch(() => {}); };
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] }, meDelay);
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: REQS.length, activeLoans: LOANS.length, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/stats") return J({ days: 30, requests: {}, response: {} });
  if (p === "/admin/requests") return J(REQS);
  if (p === "/admin/loans") return J(LOANS);
  if (/\/decline$/.test(p)) return J({ success: true }, 0);
  if (p === "/admin/catalog/item-types") return J(TYPES);
  if (p === "/admin/catalog/items") return J({ items: [], itemTypes: TYPES.map(t => ({ id: t.id, name: t.name })) });
  if (p === "/admin/inventory") return J(new URL(rq.url()).searchParams.get("holds") === "1" ? { items: UNITS, holds: HOLDS } : UNITS);
  return J([]);
});
await page.addInitScript(() => {
  if (!localStorage.getItem("gemach_token") && !localStorage.getItem("test_signed_out")) localStorage.setItem("gemach_token", "fake.token.x");
  localStorage.setItem("gemach_slug", "wh-medical");
});
const snapKeys = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("whg_snap:")));

// 1. First visit: nothing saved yet → "Loading…", then the list, and a saved copy is kept.
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);
await page.click("#tab-requests");
await page.waitForSelector("#requests-list .card");
ok((await snapKeys()).some(k => k.endsWith("|/admin/requests")), "requests saved on this device, keyed by gemach");

// 2. Next visit with Airtable slow and something new: the saved list shows at once, paused, then the fresh one.
REQS = [req(101, "Old Person"), req(102, "New Person")];
delay = 1500;
await page.reload();
await page.waitForTimeout(300);
await page.click("#tab-requests");
await page.waitForTimeout(150);
let t = await page.textContent("#requests-list");
ok(/Old Person/.test(t) && !/New Person/.test(t), "saved copy shown right away");
ok(await page.evaluate(() => document.getElementById("requests-list").classList.contains("is-stale")), "marked as updating");
ok(await page.evaluate(() => getComputedStyle(document.querySelector("#requests-list > *")).pointerEvents === "none"), "buttons paused on the saved copy");
await page.screenshot({ path: "shot-admin-snapshot-updating.png" });
await page.waitForFunction(() => /New Person/.test(document.getElementById("requests-list").textContent), null, { timeout: 5000 });
ok(!(await page.evaluate(() => document.getElementById("requests-list").classList.contains("is-stale"))), "fresh list replaces it and is usable");

// 3. Dashboard starts alongside the sign-in check, not after it.
meDelay = 1200; delay = 0;
const before = calls.length;
await page.reload();
await page.waitForTimeout(1600);
const after = calls.slice(before);
const me = after.find(c => c.path === "/admin/me"), dash = after.find(c => c.path === "/admin/dashboard");
ok(me && dash && dash.at < me.at + 1000, "dashboard requested without waiting for /admin/me");
ok(after.filter(c => c.path === "/admin/dashboard").length === 1, "dashboard loaded once");
meDelay = 0;

// 4. Loans: a refresh with changes keeps the admin's filter.
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loans-list .loan-row");
delay = 800;
LOANS = LOANS.concat([{ id: "recLOAN0000000003", loanId: "L-3", borrowerName: "Loan Three", borrowerPhone: "5165553335", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: "2026-09-03", daysOut: 28 }]);
await page.click("#tab-requests"); await page.click(".nav-tab:has-text('Loans')");
await page.waitForTimeout(100);
await page.evaluate(() => setLoanTypeFilter("Walker"));
await page.waitForFunction(() => /Loan Three/.test(document.getElementById("loans-list").textContent), null, { timeout: 5000 });
t = await page.textContent("#loans-list");
ok(/Loan One/.test(t) && /Loan Three/.test(t) && !/Loan Two/.test(t), "filter kept after the fresh list arrives");
delay = 0;

// 4b. Inventory: reservations without a unit show on the type; amber when they use up the ready units.
await page.click(".nav-tab:has-text('Inventory')");
await page.waitForSelector(".inv-holds");
const wc = await page.textContent("#inventory-list .inventory-group:has-text('Wheelchair') .inv-holds");
ok(/The available unit is spoken for/.test(wc) && /Moshe Wasserman \(from /.test(wc), "wheelchair: reservation shown, warning: " + wc);
ok(await page.evaluate(() => document.querySelector(".inventory-group .inv-holds").classList.contains("warn")), "amber when spoken for");
const wk = await page.textContent("#inventory-list .inventory-group:has-text('Walker') .inv-holds");
ok(/Cynthia Berdy/.test(wk) && !/spoken for|Only/.test(wk), "walker: far-off reservation is just noted (2 ready units; the one needing repair doesn't count)");
await page.screenshot({ path: "shot-inventory-holds.png" });

// 5. Any change clears every saved copy, so a pre-change list never reappears.
ok((await snapKeys()).length >= 2, "several saved copies before the change");
await page.evaluate(() => api("/admin/requests/recREQSNAP0000101/decline", "POST", {}));
ok((await snapKeys()).length === 0, "a successful change clears saved copies");

// 6. Signing out clears them too.
await page.click("#tab-requests"); await page.waitForSelector("#requests-list .card");
ok((await snapKeys()).length > 0, "saved again");
await page.evaluate(() => { localStorage.setItem("test_signed_out", "1"); });
await Promise.all([page.waitForEvent("load"), page.evaluate(() => signOut(true))]);
ok((await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("whg_snap:")).length)) === 0, "sign-out clears saved copies");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
