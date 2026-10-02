// Item type sheet: "Lent in packages of" (package size) for quantity items, e.g. bags of 6 tablecloths
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const TYPES = [
  { id: "recTYPEPKG0000001", name: "Gold Jacquard · Round", description: "", displayOrder: 1, active: true, itemCount: 0, tracking: "Quantity", quantityOwned: 12, outOfService: 0, packageSize: 6, packageUnit: "bag" },
  { id: "recTYPECHAIR00001", name: "Chairs", description: "", displayOrder: 2, active: true, itemCount: 0, tracking: "Quantity", quantityOwned: 60, outOfService: 0, packageSize: 1, packageUnit: null },
];
const G = { id: "recA", slug: "wh-medical", name: "Tablecloth Gemach", email: "g@example.com", templates: {}, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [], calls = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request(); const p = new URL(req.url()).pathname;
  let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
  calls.push({ method: req.method(), path: p, body });
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/catalog/item-types") return J(TYPES);
  if (p === "/admin/catalog/items") return J({ items: [], itemTypes: TYPES.map(t => ({ id: t.id, name: t.name })) });
  if (/\/admin\/catalog\/item-types\/[^/]+$/.test(p)) return J({ id: "x" });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(600);

const patches = () => calls.filter(c => c.method === "PATCH" && /item-types/.test(c.path));
const hint = () => page.$eval("#it-pkg-hint", e => e.style.display === "none" ? "" : e.textContent);

await page.evaluate(t => openEditItemType(t), TYPES[0]);
await page.waitForTimeout(200);
ok(await page.$eval("#it-pkg-row", e => e.style.display !== "none"), "package row shown for quantity items");
ok(await page.inputValue("#it-pkg-size") === "6" && await page.inputValue("#it-pkg-unit") === "bag", "package size + word filled in");
ok(/Borrowers choose 6, 12… \(lent in bags of 6\)/.test(await hint()) && !/isn't a multiple/.test(await hint()), "hint: " + await hint());
await page.screenshot({ path: "shot-admin-package.png" });
await page.fill("#it-owned", "10");
ok(/10 isn't a multiple of 6 — borrowers can only request up to 6/.test(await hint()), "warning when owned isn't a multiple: " + await hint());
await page.screenshot({ path: "shot-admin-package-warn.png" });
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
let pt = patches().at(-1);
ok(pt && pt.body.quantityOwned === 10 && pt.body.packageSize === undefined && pt.body.packageUnit === undefined, "unchanged package not sent: " + JSON.stringify(pt && pt.body));

await page.evaluate(t => openEditItemType(t), TYPES[0]);
await page.waitForTimeout(200);
await page.fill("#it-pkg-size", "4");
await page.fill("#it-pkg-unit", "box");
ok(/lent in boxes of 4/.test(await hint()), "plural box → boxes");
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
pt = patches().at(-1);
ok(pt && pt.body.packageSize === 4 && pt.body.packageUnit === "box", "changed package sent: " + JSON.stringify(pt && pt.body));

await page.evaluate(t => openEditItemType(t), TYPES[1]);
await page.waitForTimeout(200);
ok(await page.inputValue("#it-pkg-size") === "" && /Leave blank/.test(await hint()), "package size 1 shows blank + explanation");
await page.fill("#it-pkg-size", "1");
await page.click("#item-type-submit-btn");
await page.waitForTimeout(300);
pt = patches().at(-1);
ok(pt && pt.body.packageSize === undefined, "typing 1 = no change: " + JSON.stringify(pt && pt.body));

await page.evaluate(() => { document.getElementById("it-tracking").value = "Units"; updateTrackingUi(); });
ok(await page.$eval("#it-pkg-row", e => e.style.display === "none") && await hint() === "", "hidden for numbered units");
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
