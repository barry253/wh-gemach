import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname); // screenshots land in tests/test-output
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

// Inventory has one sheet per unit: status, borrower, one Notes field (saved on the item), condition, and a
// collapsed "Item details" (ID / type / active) + Delete. Notes must save for every status.
const ITEMS = [
  { id: "recITEM1", itemId: "WC-001", itemTypeId: "recT1", itemTypeName: "Wheelchair", condition: "Good", status: "Available", active: true, notes: null, currentLoan: null },
  { id: "recITEM2", itemId: "WC-002", itemTypeId: "recT1", itemTypeName: "Wheelchair", condition: "Good", status: "On Loan", active: true, notes: "Blue",
    currentLoan: { loanRecId: "recLOAN2", loanId: "L-2", status: "Active", dateBorrowed: "2026-10-10", reservationStart: null, reservationEnd: null, notes: "Loan note stays put",
      borrowerName: "Dina Cohen", borrowerPhone: "5165550100", borrowerEmail: "d@example.com", borrowerContact: "Email" } },
];
const calls = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request(); const p = new URL(req.url()).pathname; const M = req.method();
  let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
  calls.push({ method: M, path: p, body });
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: "WH Medical" }] });
  if (p === "/admin/gemach") return J({ id: "recA", slug: "wh-medical", name: "WH Medical", templates: {}, rawTemplates: {}, canEdit: true });
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/inventory") return J(ITEMS);
  if (p === "/admin/catalog/item-types" && M === "GET") return J([{ id: "recT1", name: "Wheelchair", description: "", displayOrder: 1, active: true, itemCount: 2 }]);
  if (p === "/admin/catalog/items" && M === "GET") return J({ items: [], itemTypes: [{ id: "recT1", name: "Wheelchair" }, { id: "recT2", name: "Walker" }] });
  if (p === "/admin/catalog/categories") return J([]);
  if (/^\/admin\/inventory\/[^/]+\/assign$/.test(p)) return J({ success: true, loanId: "L-9" });
  if (/^\/admin\/catalog\/items\/[^/]+$/.test(p)) return J(M === "DELETE" ? { deleted: true } : { id: p.split("/").pop(), fields: body });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(600);
await page.evaluate(() => switchTab("inventory"));
await page.waitForSelector(".inventory-item");
const open = async n => { await page.click(`.inventory-item:nth-of-type(${n})`).catch(async () => { await page.locator(".inventory-item").nth(n - 1).click(); }); await page.waitForSelector("#assign-item-sheet.open"); };
const wait = () => page.waitForFunction(() => !document.getElementById("assign-item-sheet").classList.contains("open"));
const sent = (m, re) => calls.filter(c => c.method === m && re.test(c.path));

// 1. One sheet: a single Notes field, Item details collapsed, no second screen to open.
await page.locator(".inventory-item").nth(0).click();
await page.waitForSelector("#assign-item-sheet.open");
ok(await page.locator("#assign-item-sheet textarea, #assign-item-sheet input[type=text]").evaluateAll(els => els.filter(e => /notes/i.test(e.id)).length) === 1, "exactly one Notes field on the sheet");
ok(await page.$eval("#assign-details", e => !e.open), "Item details are collapsed");
ok(await page.$("#assign-edit-details-btn") === null, "no 'Edit item details' button");
ok(await page.$eval("#assign-item-delete-btn", e => e.offsetParent !== null), "Delete is on the same sheet");
await page.screenshot({ path: "shot-r27-item-sheet.png" });

// 2. Notes on an Available item save to the item, with no status call (no History entry).
await page.fill("#assign-notes", "Blue, new tyres");
await page.click("#assign-item-submit-btn"); await wait(); await page.waitForTimeout(200);
const p1 = sent("PATCH", /catalog\/items\/recITEM1$/);
ok(p1.length === 1 && JSON.stringify(p1[0].body) === JSON.stringify({ notes: "Blue, new tyres" }), "Available: only notes PATCHed to the item: " + JSON.stringify(p1.map(c => c.body)));
ok(sent("POST", /\/assign$/).length === 0, "saving a note alone does not call /assign");

// 3. Needs Repair status + a note: assign sets the condition, the note goes to the item.
await page.locator(".inventory-item").nth(0).click();
await page.waitForSelector("#assign-item-sheet.open");
await page.click('#assign-status-btns button[data-status="Needs Repair"]');
await page.fill("#assign-notes", "Broken armrest");
await page.click("#assign-item-submit-btn"); await wait(); await page.waitForTimeout(200);
const a1 = sent("POST", /recITEM1\/assign$/);
ok(a1.length === 1 && a1[0].body.status === "Needs Repair" && !("notes" in a1[0].body), "Needs Repair: /assign carries the status, not the note");
const p2 = sent("PATCH", /catalog\/items\/recITEM1$/).at(-1);
ok(p2.body.notes === "Broken armrest" && !("condition" in p2.body), "Needs Repair: note saved on the item, condition left to /assign: " + JSON.stringify(p2.body));

// 4. On Loan item: the note shown is the item's (not the loan's); editing it never touches the loan.
await page.locator(".inventory-item").nth(1).click();
await page.waitForSelector("#assign-item-sheet.open");
ok(await page.inputValue("#assign-notes") === "Blue", "On Loan: Notes shows the item's note, not the loan note");
await page.fill("#assign-notes", "Blue, left wheel squeaks");
await page.click("#assign-item-submit-btn"); await wait(); await page.waitForTimeout(200);
ok(sent("POST", /recITEM2\/assign$/).length === 0, "On Loan: note-only edit does not rewrite the loan");
const p3 = sent("PATCH", /catalog\/items\/recITEM2$/).at(-1);
ok(p3 && p3.body.notes === "Blue, left wheel squeaks", "On Loan: note PATCHed to the item");

// 5. Borrower edit on a loan still updates that loan (existing loan id, no notes).
await page.locator(".inventory-item").nth(1).click();
await page.waitForSelector("#assign-item-sheet.open");
await page.fill("#assign-borrower-phone", "5165559999");
await page.click("#assign-item-submit-btn"); await wait(); await page.waitForTimeout(200);
const a2 = sent("POST", /recITEM2\/assign$/).at(-1);
ok(a2 && a2.body.existingLoanId === "recLOAN2" && a2.body.borrowerPhone === "5165559999" && !("notes" in a2.body), "borrower edit updates the existing loan without notes");

// 6. Item details (ID / type / active) save in the same PATCH.
await page.locator(".inventory-item").nth(0).click();
await page.waitForSelector("#assign-item-sheet.open");
await page.click("#assign-details summary");
await page.fill("#assign-itemid", "WC-010");
await page.selectOption("#assign-type", "recT2");
await page.selectOption("#assign-active", "false");
await page.click("#assign-item-submit-btn"); await wait(); await page.waitForTimeout(200);
const p4 = sent("PATCH", /catalog\/items\/recITEM1$/).at(-1).body;
ok(p4.itemId === "WC-010" && p4.itemTypeId === "recT2" && p4.active === false, "ID, type and active saved together: " + JSON.stringify(p4));

// 7. Delete from the same sheet.
await page.locator(".inventory-item").nth(0).click();
await page.waitForSelector("#assign-item-sheet.open");
await page.click("#assign-item-delete-btn"); await wait(); await page.waitForTimeout(200);
ok(sent("DELETE", /catalog\/items\/recITEM1$/).length === 1, "Delete removes the item");

ok(errors.length === 0, "no console errors " + errors.join(" | "));
await browser.close();
