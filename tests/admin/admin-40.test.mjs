// Multi-item loans (Oct 27, 2026): the items are a checklist, all ticked, with one "Mark all returned" button.
// Unticking changes it to "Mark 1 of 2 returned"; one ticked item opens the usual single return. Items of the
// booking that already came back show on the card ("1 of 2 items returned · 1 still out") and on the row.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const REQ = { requestId: "R-018", receivedAt: new Date(Date.now() - 27 * 86400000).toISOString(), source: null };
const who = { borrowerName: "Sam Levi", borrowerPhone: "5164854417", borrowerEmail: "sam@example.com", borrowerContact: "Email" };
let LOANS = [
  { id: "recLOANMULTI0001", loanId: "L-20", ...who, itemTypeName: "Rollator Walker", itemId: "WS-005", dateBorrowed: iso(-23), expectedReturn: iso(-1), daysOut: 23, overdue: true,
    requestRecId: "recREQMULTI0001", request: REQ, bookingReturned: [] },
  { id: "recLOANMULTI0002", loanId: "L-21", ...who, itemTypeName: "Shower Seat", itemId: "SH-002", dateBorrowed: iso(-23), expectedReturn: iso(-1), daysOut: 23, overdue: true,
    requestRecId: "recREQMULTI0001", request: REQ, bookingReturned: [] },
  { id: "recLOANMULTI0003", loanId: "L-22", ...who, itemTypeName: "Folding Chair", isQuantity: true, quantity: 10, dateBorrowed: iso(-23), expectedReturn: iso(-1), daysOut: 23, overdue: true,
    requestRecId: "recREQMULTI0001", request: REQ, bookingReturned: [] },
  { id: "recLOANPART00001", loanId: "L-30", borrowerName: "Part Back", borrowerPhone: "5165550000", borrowerContact: "Call", itemTypeName: "Knee Scooter", itemId: "KS-001",
    dateBorrowed: iso(-5), expectedReturn: iso(5), daysOut: 5, overdue: false, requestRecId: "recREQPART00001", request: { ...REQ, requestId: "R-030" },
    bookingReturned: [{ id: "recLOANPART00002", itemTypeName: "Crutches", itemId: "CR-002", quantity: null, dateReturned: iso(-1), photo: null }] },
];
const G = { id: "recA", slug: "wh-medical", name: "Medical Gemach", returnedMessageOn: true, templates: { returned: "Thanks {first_name} for returning the {items}." }, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], posts = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (r.request().method() === "POST") {
    posts.push({ p, body: r.request().postDataJSON() });
    const m = p.match(/\/admin\/loans\/([^/]+)\/return$/);
    if (m) {
      const q = posts.at(-1).body.quantityReturned, l = LOANS.find(x => x.id === m[1]);
      return J({ success: true, ...(l?.isQuantity ? { missing: l.quantity - q } : {}), ...(posts.at(-1).body.via === "email" ? { emailSent: true } : {}) });
    }
    return J({ success: true });
  }
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 4, overdueLoans: 3, upcomingReservations: 0 });
  if (p === "/admin/loans") return J(LOANS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=mobile");
await page.waitForTimeout(400);
await page.evaluate(() => switchTab("loans"));
await page.waitForSelector("#loans-list .loan-row");

// ── Partly returned booking: shown on the row and the card
const partRow = (await page.innerText("#loan-row-recLOANPART00001")).replace(/\s+/g, " ");
ok(/1 returned · 1 out/i.test(partRow), "row says what came back and what's out: " + partRow);
await page.click("#loan-row-recLOANPART00001");
const partPanel = (await page.innerText("#loan-panel-recLOANPART00001")).replace(/\s+/g, " ");
ok(/1 of 2 items returned · 1 still out/.test(partPanel), "card summary: " + partPanel);
ok(/Crutches.*Returned/.test(partPanel) && await page.$$eval("#loan-panel-recLOANPART00001 .bk-back", e => e.length) === 1, "the returned item is listed, dimmed");
ok(await page.$$eval("#loan-panel-recLOANPART00001 .bk-line button", e => e.length) === 1 && !(await page.$("#loan-retall-recLOANPART00001")), "one item left: its own Returned button, no checklist");

// ── Three items out: all ticked, one button
await page.click("#loan-row-recLOANMULTI0001");
const boxes = "#loan-panel-recLOANMULTI0001 .bk-ret-box";
ok(await page.$$eval(boxes, e => e.length === 3 && e.every(x => x.checked)), "every item starts ticked");
ok((await page.textContent("#loan-retall-recLOANMULTI0001")).includes("Mark all returned"), "button: Mark all returned");
ok(/Uncheck anything that isn.t back yet/.test(await page.innerText("#loan-panel-recLOANMULTI0001")), "help says Uncheck");
await page.screenshot({ path: "shot-mark-all-returned.png", fullPage: true });
// Tapping the item's name unticks it
await page.click("#loan-panel-recLOANMULTI0001 label[for='ret-recLOANMULTI0001-1']");
ok(!(await page.$eval("#ret-recLOANMULTI0001-1", e => e.checked)), "tapping the name unticks it");
ok((await page.textContent("#loan-retall-recLOANMULTI0001")).includes("Mark 2 of 3 returned"), "button counts: " + await page.textContent("#loan-retall-recLOANMULTI0001"));
await page.uncheck("#ret-recLOANMULTI0001-2");
await page.uncheck("#ret-recLOANMULTI0001-0");
ok(/Check the items/.test(await page.textContent("#loan-retall-recLOANMULTI0001")), "nothing checked: says to check");
await page.click("#loan-retall-recLOANMULTI0001");
ok(!(await page.$eval("#return-sheet", e => e.classList.contains("open"))), "nothing ticked: no sheet");

// One ticked → the usual single-item return sheet
await page.check("#ret-recLOANMULTI0001-1");
await page.click("#loan-retall-recLOANMULTI0001");
await page.waitForTimeout(200);
ok(/Shower Seat|SH-002/.test(await page.textContent("#return-subtitle")), "one ticked: single return sheet for it");
await page.evaluate(() => closeSheet("return-sheet"));

// All ticked → one sheet for all three, one message, counts for the quantity item
await page.check("#ret-recLOANMULTI0001-0"); await page.check("#ret-recLOANMULTI0001-2");
await page.click("#loan-retall-recLOANMULTI0001");
await page.waitForTimeout(200);
ok(/3 items/.test(await page.textContent("#return-subtitle")), "sheet subtitle: " + await page.textContent("#return-subtitle"));
ok(/Rollator Walker, Shower Seat and Folding Chair × 10/.test(await page.inputValue("#return-message")), "one thank-you naming all items");
ok(await page.$$eval("#return-multi-qty [data-retq]", e => e.length) === 1, "a count for the quantity item");
await page.fill("#return-multi-qty [data-retq]", "8");
ok(await page.isVisible("#return-multi-reduce-row"), "short count: offer to lower inventory");
await page.screenshot({ path: "shot-return-many.png", fullPage: true });
const n0 = posts.length;
await page.click("#return-submit-btn");
await page.waitForTimeout(500);
const rets = posts.slice(n0).filter(x => /\/return$/.test(x.p));
ok(rets.length === 3, "three return calls: " + rets.map(x => x.p).join(", "));
ok(rets.filter(x => x.body.message).length === 1 && rets.at(-1).body.message && rets.at(-1).body.itemsLabel, "the message goes with the last one only");
ok(rets.find(x => /MULTI0003/.test(x.p)).body.quantityReturned === 8, "the count is sent");
ok(rets.every(x => x.body.returnDate), "each has the return date");
await page.waitForTimeout(100);
const said = await page.evaluate(() => document.getElementById("sr-status")?.textContent || "");
ok(/3 items marked as returned · 2 missing/.test(said), "toast: " + said);

// Wording: "Check / Uncheck", never "Tick / Untick" (not used in the US), anywhere on the site or in admin (Barry, Oct 28, 2026).
const root = new URL("../../", import.meta.url);
const files = ["admin.html", "embed.html", ...fs.readdirSync(new URL("site/", root), { recursive: true }).map(f => "site/" + f)]
  .filter(f => /\.(html|js|css)$/.test(f));
const ticky = files.flatMap(f => (fs.readFileSync(new URL(f, root), "utf8").match(/.{0,30}\b(un)?tick(ed|ing|s)?\b.{0,30}/gi) || []).map(m => `${f}: ${m}`));
ok(!ticky.length, "no Tick / Untick wording: " + ticky.join(" | "));
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
