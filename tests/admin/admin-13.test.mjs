// Item photos on Loans, Reservations and Requests (the item type's cover photo; a plain box when there's none).
import { chromium } from "playwright";
import fs from "node:fs";
import zlib from "node:zlib";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

// A solid-colour PNG, so the photos are visible in screenshots.
function png(r, g, b, n = 64) {
  const crcT = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: n }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(n).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
const IMG = { "wc.png": png(70, 120, 160), "walker.png": png(200, 150, 60), "chair.png": png(120, 160, 90) };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], primaryContact: "Text", phone: "5165551212" };
const LOANS = [
  { id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Moshe Wasserman", itemTypeName: "Wheelchair", itemId: "WC-001", photo: "https://img.test/wc.png", dateBorrowed: iso(-10), expectedReturn: iso(4), daysOut: 10, overdue: false },
  { id: "recLOAN0000000002", loanId: "L-2", borrowerName: "Leah Stern", itemTypeName: "Shower Chair", photo: null, dateBorrowed: iso(-3), daysOut: 3, overdue: false },
];
const RES = [
  { id: "recRES00000000001", loanId: "L-3", borrowerName: "Chana Klein", itemTypeName: "Walker", photo: "https://img.test/walker.png", reservationStart: iso(2), reservationEnd: iso(9) },
];
const REQS = [
  { id: "recREQ00000000001", requestId: "R-1", name: "Rivka Levy", phone: "5165553333", receivedAt: new Date().toISOString(), requestType: "Loan", neededFrom: iso(3), neededUntil: iso(10),
    items: [{ id: "recT1", name: "Wheelchair", photo: "https://img.test/wc.png" }, { id: "recT2", name: "Folding Chair", photo: "https://img.test/chair.png", quantity: 20, available: 40 }, { id: "recT3", name: "Cane", photo: null }],
    itemNames: ["Wheelchair", "Folding Chair × 20", "Cane"] },
];

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("https://img.test/**", r => r.fulfill({ contentType: "image/png", body: IMG[new URL(r.request().url()).pathname.slice(1)] }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 1, activeLoans: 2, overdueLoans: 0, upcomingReservations: 1 });
  if (p === "/admin/loans") return J(LOANS);
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/requests") return J(REQS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);

const loaded = sel => page.$eval(sel, img => img.complete && img.naturalWidth > 0);
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loan-row-recLOAN0000000001 img.row-thumb");
await page.waitForFunction(() => document.querySelector("#loan-row-recLOAN0000000001 img.row-thumb")?.naturalWidth > 0);
ok(await loaded("#loan-row-recLOAN0000000001 img.row-thumb"), "loan row shows the item photo");
ok(await page.getAttribute("#loan-row-recLOAN0000000001 img.row-thumb", "alt") === "Wheelchair", "photo labelled with the item name");
ok(!!(await page.$("#loan-row-recLOAN0000000002 .row-thumb-none")), "no photo: plain box keeps rows aligned");
await page.screenshot({ path: "shot-loans-photos.png" });

await page.click(".nav-tab:has-text('Reservations')");
await page.waitForSelector("#reservations-list img.row-thumb");
await page.waitForFunction(() => document.querySelector("#reservations-list img.row-thumb")?.naturalWidth > 0);
ok(true, "reservation row shows the item photo");
await page.screenshot({ path: "shot-reservations-photos.png" });

await page.click(".nav-tab:has-text('Requests')");
await page.waitForSelector("#requests-list .req-thumbs img");
await page.waitForFunction(() => [...document.querySelectorAll("#requests-list .req-thumbs img")].every(i => i.naturalWidth > 0));
ok((await page.$$eval("#requests-list .req-thumbs img", is => is.map(i => i.alt))).join("|") === "Wheelchair|Folding Chair", "request card: one photo per requested item that has one");
await page.screenshot({ path: "shot-requests-photos.png" });
ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
