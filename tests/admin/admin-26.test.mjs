// Loans tab: sticky search + status pills, item filter sheet, sort, group by borrower, row layout, top bar fit.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const loan = (n, o) => ({ id: "recLOAN00000000" + String(n).padStart(2, "0"), loanId: "L-" + n, borrowerName: "X", borrowerPhone: null, borrowerEmail: null,
  borrowerContact: "Text", itemTypeName: "Cane - wood", itemId: null, dateBorrowed: "2026-10-01", expectedReturn: null, daysOut: 14, overdue: false,
  photo: null, photos: [], ...o });
const LOANS = [
  loan(1, { borrowerName: "Debbie Edelman", borrowerPhone: "5165550001", itemTypeName: "Wheelchair — Transport", itemId: "WT-001", dateBorrowed: "2026-09-06", expectedReturn: "2026-09-20", daysOut: 39, overdue: true }),
  loan(2, { borrowerName: "Judah Gomberg", borrowerPhone: "5165550002", itemTypeName: "Knee Scooter", itemId: "KS-001", dateBorrowed: "2026-09-11", expectedReturn: "2026-10-01", daysOut: 34, overdue: true, notes: "call first" }),
  loan(3, { borrowerName: "Aviva Epstein", borrowerEmail: "aviva@example.com", itemTypeName: "Knee Scooter", itemId: "KS-002", dateBorrowed: "2026-09-16", daysOut: 29, overdue: true, readyToReturnAt: new Date(Date.now() - 7200000).toISOString() }),
  loan(4, { borrowerName: "Debbie Edelman", borrowerPhone: "(516) 555-0001", itemTypeName: "Commode", itemId: "CM-001", dateBorrowed: "2026-10-05", expectedReturn: "2026-10-25", daysOut: 10 }),
  loan(5, { borrowerName: "Ruth Katz", borrowerPhone: "5165550005", itemTypeName: "Crutches", itemId: "CR-001", dateBorrowed: "2026-10-12", daysOut: 3 }),
  ...Array.from({ length: 14 }, (_, i) => loan(10 + i, { borrowerName: "Filler Person " + (i + 1), borrowerPhone: "51655599" + String(i).padStart(2, "0"), itemTypeName: "Shower Seat", itemId: "SS-0" + (10 + i), dateBorrowed: "2026-10-" + String(2 + (i % 9)).padStart(2, "0") })),
];
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const p = new URL(r.request().url()).pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) }).catch(() => {});
  if (p === "/admin/me") return J({ email: "b@x", name: "Binyamin", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }, { id: "recB", slug: "other", name: "Another Gemach With A Long Name" }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: LOANS.length, overdueLoans: 3, upcomingReservations: 0 });
  if (p === "/admin/loans") return J(LOANS);
  return J([]);
});
await page.addInitScript(() => {
  if (!localStorage.getItem("gemach_token")) localStorage.setItem("gemach_token", "fake.token.x");
  localStorage.setItem("gemach_slug", "wh-medical");
});
const names = () => page.$$eval("#loans-list .loan-row .loan-row-name, #loans-list .loan-group-name", e => e.map(x => x.textContent.trim()));
const rows = () => page.$$eval("#loans-list .loan-row", e => e.length);
const count = () => page.textContent("#loans-count");

await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loans-list .loan-row");

// 1. Compact controls: no wall of chips, first loan visible without scrolling.
ok(await page.$$eval(".filter-chip", e => e.length) === 0, "item types are no longer chips");
const firstTop = await page.$eval("#loans-list .loan-row", e => e.getBoundingClientRect().top);
ok(firstTop < 420, "first loan is on screen without scrolling (top " + Math.round(firstTop) + "px)");
ok(/19 loans/.test(await count()), "count line: " + (await count()));
ok(/Overdue\s*3/.test(await page.textContent("#loans-pills")) && /All out\s*19/.test(await page.textContent("#loans-pills")), "pills carry counts");
await page.screenshot({ path: "shot-loans-new.png" });

// 2. One search box: borrower, unit number, phone, email.
await page.fill("#loans-search", "gomb");
ok((await rows()) === 1 && /Judah/.test(await page.textContent("#loans-list")), "borrower name prefix");
await page.fill("#loans-search", "ks-");
ok((await rows()) === 2, "unit number part: " + (await rows()));
await page.fill("#loans-search", "555 0001".replace(" ", ""));
ok((await rows()) === 2 && !/Judah/.test(await page.textContent("#loans-list")), "phone digits (both of Debbie's loans, even typed differently)");
await page.fill("#loans-search", "aviva@");
ok((await rows()) === 1, "email");
await page.fill("#loans-search", "knee gomb");
ok((await rows()) === 1, "every word must match (item + borrower)");
await page.fill("#loans-search", "nobody here");
ok(/No loans match/.test(await page.textContent("#loans-list")), "empty result says so");
await page.click("#loans-list .link-btn");
ok((await rows()) === 19 && (await page.inputValue("#loans-search")) === "", "Clear brings everything back and empties the box");

// 3. Item filter sheet.
await page.click("#loans-item-btn");
const opts = await page.$$eval("#loan-item-list .loan-item-opt", e => e.map(x => x.innerText.replace(/\s+/g, " ").trim()));
ok(opts[0] === "All item types 19" && opts.includes("Knee Scooter 2") && opts.includes("Shower Seat 14"), "sheet lists types with counts: " + opts.join(" | "));
await page.click(".loan-item-opt:has-text('Knee Scooter')");
ok((await rows()) === 2 && /Item: Knee Scooter/.test(await page.textContent("#loans-item-btn")), "picking a type filters and shows it on the button");
ok(/2 of 19 loans/.test(await count()), "count says 2 of 19");
await page.click("#loans-count .link-btn");
ok((await rows()) === 19 && /Item: All/.test(await page.textContent("#loans-item-btn")), "Clear resets the item filter");

// 4. Status pills.
await page.click(".loans-pill:has-text('Overdue')");
ok((await rows()) === 3, "Overdue pill: 3 loans");
ok(/Ready to return\s*1/.test(await page.textContent("#loans-pills")), "Ready to return pill appears when there is one");
await page.click(".loans-pill:has-text('Ready to return')");
ok((await rows()) === 1 && /Aviva/.test(await page.textContent("#loans-list")), "Ready to return pill");
await page.click(".loans-pill:has-text('All out')");

// 5. Sort (remembered on this device).
await page.selectOption("#loans-sort", "borrower");
ok((await names())[0] === "Aviva Epstein", "Borrower A–Z: " + (await names()).slice(0, 3).join(", "));
await page.selectOption("#loans-sort", "due");
ok((await names()).slice(0, 2).join() === "Debbie Edelman,Judah Gomberg", "Due date: earliest due first (" + (await names()).slice(0, 3).join(", ") + ")");
await page.selectOption("#loans-sort", "item");
ok((await page.$$eval("#loans-list .loan-row-item", e => e[0].textContent.trim())) === "Commode", "Item A–Z");
await page.selectOption("#loans-sort", "recent");
ok((await names())[0] === "Ruth Katz", "Recently borrowed: newest first");
await page.reload();
await page.waitForTimeout(300);
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loans-list .loan-row");
ok((await page.inputValue("#loans-sort")) === "recent", "sort remembered after reload");
await page.selectOption("#loans-sort", "out");
ok((await names())[0] === "Debbie Edelman", "Longest out first is the default order");

// 6. Group by borrower.
await page.check("#loans-group");
const head = await page.textContent(".loan-group-head");
ok(/Debbie Edelman/.test(head) && /2 items out/.test(head) && /1 overdue/.test(head), "header for a borrower with 2 items: " + head.replace(/\s+/g, " "));
ok((await page.$$eval(".loan-group-rows .loan-row", e => e.length)) === 2 && (await page.$$eval(".loan-group-rows .loan-row-name", e => e.length)) === 0, "their items sit under it without repeating the name");
ok((await rows()) === 19 && /18 borrowers/.test(await count()), "single loans stay normal rows; count shows borrowers: " + (await count()));
await page.click("#loans-list .loan-group-rows .loan-row");
ok(await page.$eval("#loans-list .loan-group-rows .loan-actions-panel.open", e => /Returned/.test(e.innerText)), "row actions still open inside a group");
await page.reload();
await page.waitForTimeout(300);
await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loans-list .loan-row");
ok(await page.isChecked("#loans-group"), "grouping remembered after reload");
await page.screenshot({ path: "shot-loans-grouped.png" });
await page.uncheck("#loans-group");

// 7. The bar stays put while scrolling the list.
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(150);
const pos = await page.evaluate(() => ({ bar: document.getElementById("loans-bar").getBoundingClientRect(), top: document.querySelector(".topbar").getBoundingClientRect(), y: window.scrollY }));
ok(pos.y > 300, "page scrolled (" + Math.round(pos.y) + "px)");
ok(Math.abs(pos.bar.top - pos.top.bottom) <= 1 && pos.bar.height > 40, "search bar sticks just under the top bar");
await page.fill("#loans-search", "debbie");
ok((await rows()) === 2, "search still works while scrolled");
await page.screenshot({ path: "shot-loans-sticky.png" });
await page.fill("#loans-search", "");
await page.evaluate(() => window.scrollTo(0, 0));

// 8. Long item names wrap instead of running under the date.
await page.evaluate(() => { allLoans[0].itemTypeName = "Wheelchair — Transport Extra Wide With Elevating Leg Rests"; renderLoans(); });
const clash = await page.evaluate(() => {
  const row = document.querySelector("#loans-list .loan-row");
  const a = row.querySelector(".loan-row-item").getBoundingClientRect(), b = row.querySelector(".loan-row-date").getBoundingClientRect();
  return { overlap: a.right > b.left + 0.5 && a.left < b.right && a.bottom > b.top && a.top < b.bottom, date: row.querySelector(".loan-row-date").innerText.replace(/\s+/g, " ") };
});
ok(!clash.overlap, "item name does not overlap the date");
ok(/Out Sep 6/.test(clash.date) && /Due Sep 20/.test(clash.date), "date is labelled: " + clash.date);

// 9. Top bar: the gemach picker stays clear of the admin's name and the buttons.
const tb = await page.evaluate(() => {
  const r = id => document.querySelector(id)?.getBoundingClientRect();
  return { sw: r("#gemach-switcher"), name: r("#admin-name"), bell: r("#btn-bell"), vw: innerWidth };
});
ok(tb.sw && tb.sw.right <= tb.name.left + 0.5 && tb.sw.right <= tb.bell.left, "gemach picker ends before the admin name (" + Math.round(tb.sw?.right) + " vs " + Math.round(tb.name?.left) + ")");
ok(tb.bell.right <= tb.vw, "nothing pushed off the right edge");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
