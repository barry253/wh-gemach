// Phone layout (Oct 27, 2026): on a 393px screen, reservation rows stack the dates over the tag (like Loans), so the
// borrower's name, item and town each stay on one line; Dashboard item codes (WC-004) don't split at the hyphen;
// the Inventory "+ New Item Type" button doesn't squeeze onto several lines.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(process.env.ADMIN || new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const lines = (sel) => page.$eval(sel, el => { const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.25; return Math.round(el.getBoundingClientRect().height / lh); });
const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true, requestStyle: "Dates" };
const RES = [
  { id: "recRES00000000001", loanId: "L-801", borrowerName: "Chana Tilis", itemTypeName: "Boot — Tall/Large", reservationStart: iso(0), reservationEnd: null, borrowerCity: "West Hempstead", borrowerState: "NY", requestNote: "hi" },
  { id: "recRES00000000002", loanId: "L-802", borrowerName: "Sarah Horowitz", itemTypeName: "Wheelchair", reservationStart: iso(10), reservationEnd: iso(17), requestRecId: "recRQ2", borrowerCity: "Woodmere", borrowerState: "NY", requestNote: "x" },
  { id: "recRES00000000003", loanId: "L-803", borrowerName: "Sarah Horowitz", itemTypeName: "Shower chair", reservationStart: iso(10), reservationEnd: iso(17), requestRecId: "recRQ2", borrowerCity: "Woodmere", borrowerState: "NY" },
];
const LOANS = [
  { id: "recLOAN0000000001", loanId: "L-1", status: "Active", borrowerName: "Moshe Wasserman", itemTypeName: "Knee scooter — Adult", itemId: "KS-001", dateBorrowed: iso(-9), expectedReturn: iso(2), daysOut: 9, borrowerCity: "West Hempstead", borrowerState: "NY" },
  { id: "recLOAN0000000002", loanId: "L-2", status: "Active", borrowerName: "Cynthia Berdy", itemTypeName: "Transport wheelchair", itemId: "WC-004", dateBorrowed: iso(-40), expectedReturn: iso(-3), daysOut: 40, overdue: true, borrowerCity: "Franklin Square", borrowerState: "NY" },
];
const REQS = [{ id: "recREQ00000000001", requestId: "R-101", name: "Yehudis Rosenblatt", phone: "5165551234", email: "x@example.com", preferredContact: "Email", status: "New",
  receivedAt: new Date().toISOString(), requestType: "Loan", neededFrom: iso(3), openEnded: true, town: "West Hempstead", state: "NY",
  items: [{ id: "recTY", name: "Boot — Tall/Large" }, { id: "recTW", name: "Shower chair with back" }], itemNames: ["Boot — Tall/Large", "Shower chair with back"], notes: "Grandmother visiting for Chanukah" }];
const TYPES = [{ id: "recTYPEWC00000001", name: "Transport wheelchair", tracking: "Units", active: true, displayOrder: 1, itemCount: 2 }];
const unit = (n, typeName, status) => ({ id: "recITEM" + n, itemId: n, itemTypeId: "recTYPEWC00000001", itemTypeName: typeName, condition: "Good", status, active: true, notes: null });
const UNITS = [unit("WC-004", "Transport wheelchair", "On Loan"), unit("WC-005", "Transport wheelchair", "Available")];
const page = await browser.newPage({ viewport: { width: 393, height: 1000 }, deviceScaleFactor: 2 });
page.on("pageerror", e => console.log("ERR", String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const u = new URL(r.request().url()), p = u.pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Binyamin", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 1, activeLoans: 2, overdueLoans: 1, upcomingReservations: 2 });
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/loans") return J(LOANS);
  if (p === "/admin/requests") return J(REQS);
  if (p === "/admin/catalog/item-types") return J(TYPES);
  if (p === "/admin/catalog/items") return J({ items: UNITS, itemTypes: TYPES });
  if (p === "/admin/inventory") return J(u.searchParams.get("holds") === "1" ? { items: UNITS, holds: [] } : UNITS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForFunction(() => typeof switchTab === "function" && document.getElementById("app")?.style.display !== "none");
await page.evaluate(() => switchTab("reservations"));
await page.waitForSelector("#res-row-recRES00000000001");
const R = "#res-row-recRES00000000001";
ok(await lines(`${R} .loan-row-name`) === 1, "reservation: borrower name on one line");
ok(await lines(`${R} .loan-row-item`) === 1, "reservation: item on one line");
ok(await lines(`${R} .row-city`) === 1, "reservation: town on one line");
ok(await page.$(`${R} .loan-row-side .loan-row-date`) && await page.$(`${R} .loan-row-side .loan-row-tag`), "reservation: dates and tag stacked on the side");

await page.evaluate(() => switchTab("dashboard"));
await page.waitForSelector("#upcoming-body .up-items .nw");
ok(await page.$$eval("#upcoming-body .up-items .nw", els => els.every(e => e.getClientRects().length === 1)), "dashboard: item codes not split");

await page.evaluate(() => switchTab("inventory"));
await page.waitForSelector("button[onclick='openAddItemType()']");
ok(await page.$eval("button[onclick='openAddItemType()']", b => b.getClientRects().length === 1 && b.getBoundingClientRect().height < 40), "inventory: New Item Type button on one line");
await browser.close();
