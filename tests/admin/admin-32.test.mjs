// Accessibility (Oct 19, 2026): the keyboard reaches everything a tap does — dashboard counts, loan and reservation
// rows (with aria-expanded), inventory units and group headers — and screen readers hear toasts (one persistent
// live region) and sheet errors (role=alert).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const LOANS = [{ id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Moshe Levy", borrowerPhone: "5165553333", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: iso(-5), daysOut: 5 }];
const RES = [{ id: "recRES00000000001", loanId: "L-3", borrowerName: "Chana Klein", itemTypeName: "Wheelchair", reservationStart: iso(2), reservationEnd: iso(9) }];
const TYPES = [{ id: "recTYPEWC00000001", name: "Wheelchair", tracking: "Units", active: true, itemCount: 1 }];
const UNITS = [{ id: "recITEMWC001", itemId: "WC-001", itemTypeId: "recTYPEWC00000001", itemTypeName: "Wheelchair", condition: "Good", status: "Available", active: true, notes: null }];
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", r => {
  const u = new URL(r.request().url()), p = u.pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 1, overdueLoans: 0, upcomingReservations: 1 });
  if (p === "/admin/stats") return J({ days: 30, requests: {}, response: {} });
  if (p === "/admin/loans") return J(LOANS);
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/catalog/item-types") return J(TYPES);
  if (p === "/admin/catalog/items") return J({ items: [], itemTypes: TYPES.map(t => ({ id: t.id, name: t.name })) });
  if (p === "/admin/inventory") return J(u.searchParams.get("holds") === "1" ? { items: UNITS, holds: [] } : UNITS);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html?device=desktop");
await page.waitForTimeout(500);
const active = () => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, text: a.textContent.replace(/\s+/g, " ").trim(), exp: a.getAttribute("aria-expanded") }; });
const tabTo = async (pred, max = 80) => { for (let i = 0; i < max; i++) { await page.keyboard.press("Tab"); if (pred(await active())) return true; } return false; };

// Dashboard counts are buttons
ok(await page.$$eval("#stat-grid .stat-card", els => els.length === 4 && els.every(e => e.tagName === "BUTTON")), "the 4 dashboard counts are buttons");
ok(await tabTo(a => a.tag === "BUTTON" && /Active loans/.test(a.text)), "Tab reaches the Active loans count");
await page.keyboard.press("Enter");
await page.waitForSelector("#screen-loans.active #loans-list .loan-row");

// Loan row: Tab to it, Enter opens the actions, which are then reachable
ok(await tabTo(a => a.tag === "BUTTON" && /Walker/.test(a.text) && a.exp === "false"), "Tab reaches the loan row (collapsed)");
await page.keyboard.press("Enter");
ok(await page.isVisible("#loan-panel-recLOAN0000000001 .card-actions") && (await active()).exp === "true", "Enter opens the loan's actions and says expanded");
ok(await tabTo(a => /Returned/.test(a.text), 4), "next Tab reaches ✓ Returned");
await page.keyboard.press("Shift+Tab");
await page.keyboard.press("Space");
ok(!(await page.isVisible("#loan-panel-recLOAN0000000001 .card-actions")) && (await active()).exp === "false", "Space closes it again");
// Mouse taps on the row (outside the button) still work
await page.click("#loan-row-recLOAN0000000001", { position: { x: 4, y: 10 } });
ok(await page.isVisible("#loan-panel-recLOAN0000000001 .card-actions"), "tapping the row edge still opens it");

// Reservation row
await page.evaluate(() => switchTab("reservations"));
await page.waitForSelector("#reservations-list .loan-row .row-open");
await page.focus("#reservations-list .row-open");
await page.keyboard.press("Enter");
ok(await page.isVisible("#res-panel-recRES00000000001 .card-actions") && (await active()).exp === "true", "Enter opens the reservation's actions");

// Inventory: group header toggles with aria-expanded; a unit opens its sheet
await page.evaluate(() => switchTab("inventory"));
await page.waitForSelector("button.inventory-item");
const grp = page.locator(".inventory-group .grp-open").first();
ok(await grp.getAttribute("aria-expanded") === "true", "group header starts expanded");
await grp.focus(); await page.keyboard.press("Enter");
ok(await grp.getAttribute("aria-expanded") === "false" && !(await page.isVisible("button.inventory-item")), "Enter collapses the group");
await page.keyboard.press("Enter");
ok(await grp.getAttribute("aria-expanded") === "true" && await page.isVisible("button.inventory-item"), "Enter expands it again");
await page.focus("button.inventory-item");
await page.keyboard.press("Enter");
await page.waitForSelector("#assign-item-sheet.open");
ok(true, "Enter on a unit opens its sheet");
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
ok(await page.evaluate(() => document.activeElement.classList.contains("inventory-item")), "…and Escape brings focus back to the unit");

// Toasts go through one persistent live region; the same message twice is read again
ok(await page.$eval("#sr-status", el => el.getAttribute("role") === "status" && !document.getElementById("app").contains(el)), "a live region exists from load, outside #app");
await page.evaluate(() => showToast("Saved"));
await page.waitForTimeout(150);
ok(await page.textContent("#sr-status") === "Saved", "toast text is announced");
await page.evaluate(() => showToast("Saved"));
ok(await page.textContent("#sr-status") === "", "…cleared first so a repeat is read again");
await page.waitForTimeout(150);
ok(await page.textContent("#sr-status") === "Saved", "…then set again");

// Sheet errors are alerts
ok(await page.$$eval("p.login-error", els => els.length >= 6 && els.every(e => e.getAttribute("role") === "alert")), "sheet and sign-in errors are role=alert");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
