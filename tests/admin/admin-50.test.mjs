// Inventory: item photos open the same full-screen photo viewer borrowers get on the public page —
// from the group header thumbnail, and from a tile in the item type's photo editor (unsaved order included).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const G = {
  id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", email: "gemach@example.com", phone: "(718) 986-7345",
  templates: {}, rawTemplates: {}, canEdit: true, primaryContact: "Email", itemAttributes: [],
};
const TYPES = [
  { id: "recTYPENAVY00001", name: "Navy Gown", description: "", displayOrder: 1, active: true, tracking: "Units", attributes: {},
    r2PhotoUrl: "https://photos.test/navy.png", morePhotos: ["https://photos.test/navy2.png"] },
  { id: "recTYPECHAIR0001", name: "Chairs", description: "", displayOrder: 2, active: true, tracking: "Quantity", attributes: {},
    quantityOwned: 5, availableToday: 5, outNow: 0, reservedAhead: 0, outOfService: 0 },
];

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://photos.test/**", r => r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#c9a"/></svg>' }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url()), p = u.pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: G.slug, name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/catalog/item-types") return J(TYPES);
  if (p === "/admin/inventory") return J([]);
  if (p === "/admin/catalog/items") return J({ items: [], itemTypes: TYPES.map(t => ({ id: t.id, name: t.name })) });
  if (p === "/admin/catalog/categories") return J([]);
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);

await page.click(".nav-tab:has-text('Inventory')");
await page.waitForSelector(".inventory-group");
const groupId = "#inv-group-recTYPENAVY00001";

// ── (a) Inventory thumbnail opens the viewer, doesn't toggle the group ──
ok((await page.getAttribute(groupId, "data-collapsed")) !== "true", "group starts expanded");
ok((await page.getAttribute(`${groupId} .row-thumb-btn`, "aria-label")) === "View photos of Navy Gown", "thumbnail has an accessible label");
await page.click(`${groupId} .row-thumb-btn`);
ok(await page.isVisible("#photo-viewer") && (await page.textContent("#pv-name")) === "Navy Gown" && (await page.textContent("#pv-count")) === "1 / 2", "tap: viewer opens at the cover with both photos");
ok((await page.getAttribute(groupId, "data-collapsed")) !== "true", "group still expanded — the click didn't bubble to toggleGroup");
await page.screenshot({ path: "shot-inv-thumb-viewer.png" });
await page.click("#pv-next");
ok((await page.getAttribute("#pv-img", "src")) === "https://photos.test/navy2.png", "swipe/next reaches the second photo");
await page.keyboard.press("Escape");
ok(!(await page.isVisible("#photo-viewer")), "Escape closes the viewer");

// ── (c) No-photo item still opens the edit sheet ──
await page.click("#inv-group-recTYPECHAIR0001 .inv-thumb-missing");
await page.waitForSelector("#item-type-sheet.open");
ok((await page.textContent("#item-type-sheet-subtitle")) === "Chairs", "tapping 'No photo' opens that item type's sheet, as before");
await page.evaluate(() => closeSheet("item-type-sheet"));
await page.waitForTimeout(200);

// ── (b) Photo editor tile opens the viewer at that index, using the unsaved order; close keeps the sheet ──
await page.click(`${groupId} [title='Edit item type']`);
await page.waitForSelector("#it-photos .photo-tile");
const tiles = () => page.$$eval("#it-photos .photo-tile img", i => i.map(x => x.getAttribute("src").replace("https://photos.test/", "")));
ok((await tiles()).join(",") === "navy.png,navy2.png", "strip starts cover first");
await page.click("#it-photos .photo-tile:nth-child(2) button[title='Make cover']"); // unsaved reorder
ok((await tiles()).join(",") === "navy2.png,navy.png", "unsaved reorder applied in the strip");

await page.click("#it-photos .photo-tile:nth-child(1) .photo-tile-img");
ok(await page.isVisible("#photo-viewer") && (await page.textContent("#pv-count")) === "1 / 2" && (await page.getAttribute("#pv-img", "src")) === "https://photos.test/navy2.png",
  "tile tap opens the viewer at that index, showing the reordered (unsaved) photo");
await page.click("#pv-next");
ok((await page.getAttribute("#pv-img", "src")) === "https://photos.test/navy.png", "next shows the other unsaved-order photo");
await page.click("#pv-close");
ok(!(await page.isVisible("#photo-viewer")), "viewer closed");
ok(await page.$eval("#item-type-sheet", el => el.classList.contains("open")), "closing the viewer leaves the sheet open");
ok((await tiles()).join(",") === "navy2.png,navy.png", "unsaved reorder still intact after closing the viewer");

// Phone Back closes just the viewer, not the sheet underneath it
await page.click("#it-photos .photo-tile:nth-child(2) .photo-tile-img");
ok(await page.isVisible("#photo-viewer") && (await page.textContent("#pv-count")) === "2 / 2", "reopened the viewer at the second tile");
await page.goBack();
await page.waitForTimeout(200);
ok(!(await page.isVisible("#photo-viewer")), "Back closed the viewer");
ok(await page.$eval("#item-type-sheet", el => el.classList.contains("open")), "Back left the sheet open underneath it");

ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
