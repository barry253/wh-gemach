// Network → Categories: gemach types (the label on each gemach) can be added, renamed and deleted.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [] };
let GEMACHS = [
  { id: "recA", slug: "wh-medical", name: G.name, active: true, adminCount: 1, itemCount: 0, email: "", phone: "", mode: "Full", category: "Medical", displayOrder: null, browseCategoryIds: [] },
  { id: "recB", slug: "ac", name: "Neighborhood A/C Gemach", active: true, comingSoon: true, adminCount: 1, itemCount: 0, email: "", phone: "", mode: "Full", category: "Other", displayOrder: null, browseCategoryIds: [] },
];
let TYPES = [{ id: "recT1", name: "Medical", gemachCount: 1 }, { id: "recT2", name: "Other", gemachCount: 1 }];
const calls = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => d.accept());
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const rq = r.request(); const p = new URL(rq.url()).pathname; const m = rq.method();
  let body = null; try { body = JSON.parse(rq.postData() || "null"); } catch {}
  calls.push({ m, p, body });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  let mm;
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Network Admin", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/network/overview") return J({ gemachs: GEMACHS, admins: [], categories: [] });
  if (p === "/admin/network/gemach-types" && m === "GET") return J(TYPES);
  if (p === "/admin/network/gemach-types" && m === "POST") { const t = { id: "recT3", name: body.name, gemachCount: 0 }; TYPES.push(t); return J(t, 201); }
  if ((mm = p.match(/^\/admin\/network\/gemach-types\/(rec\w+)$/)) && m === "PATCH") { const t = TYPES.find(x => x.id === mm[1]); t.name = body.name; return J(t); }
  if ((mm = p.match(/^\/admin\/network\/gemach-types\/(rec\w+)$/)) && m === "DELETE") { TYPES = TYPES.filter(x => x.id !== mm[1]); return J({ ok: true }); }
  if ((mm = p.match(/^\/admin\/network\/gemachs\/(rec\w+)$/)) && m === "PATCH") { const g = GEMACHS.find(x => x.id === mm[1]); Object.assign(g, body); return J(g); }
  if (p === "/admin/network/searches") return J({ days: 30, total: 0, top: [], misses: [] });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);
await page.click(".nav-tab:has-text('Network')");
await page.click("#net-tab-categories");
await page.waitForSelector("#net-types .net-row");
const typeRows = () => page.$$eval("#net-types .card-title", e => e.map(x => x.textContent.trim()).join("|"));
ok(await typeRows() === "Medical|Other", "types listed: " + await typeRows());
ok(/1 gemach/.test(await page.textContent("#nt-row-recT2")), "shows how many gemachs use each");
// add
await page.click("button:has-text('+ Add type')");
await page.fill("#nt-name", "Home & Appliances");
await page.click("#nt-submit-btn");
await page.waitForFunction(() => /Home & Appliances/.test(document.getElementById("net-types").textContent));
ok(calls.some(c => c.m === "POST" && c.p === "/admin/network/gemach-types" && c.body.name === "Home & Appliances"), "add sends the name");
// new type shows up in the gemach list dropdown; give A/C that type
await page.click("#net-tab-gemachs");
const opts = await page.$$eval("#ng-row-recB select[aria-label=Category] option", e => e.map(x => x.textContent));
ok(opts.includes("Home & Appliances"), "new type offered on each gemach: " + opts.join(","));
await page.selectOption("#ng-row-recB select[aria-label=Category]", "Home & Appliances");
await page.waitForFunction(() => document.querySelector("#ng-row-recB select[aria-label=Category]").value === "Home & Appliances");
ok(calls.some(c => c.m === "PATCH" && c.p === "/admin/network/gemachs/recB" && c.body.category === "Home & Appliances"), "gemach saved with the new type");
await page.click("#net-tab-categories");
ok(/1 gemach/.test(await page.textContent("#nt-row-recT3")) && /0 gemachs/.test(await page.textContent("#nt-row-recT2")), "counts follow the change");
// can't delete a used type; unused one deletes
await page.click("#nt-row-recT3 button:has-text('Delete')");
ok(!calls.some(c => c.m === "DELETE"), "used type is not deleted");
await page.click("#nt-row-recT2 button:has-text('Delete')");
await page.waitForFunction(() => !document.getElementById("nt-row-recT2"));
ok(calls.some(c => c.m === "DELETE" && c.p.endsWith("/recT2")), "unused type deleted");
// rename moves gemachs along
await page.click("#nt-row-recT3 button:has-text('Rename')");
await page.fill("#nt-name", "Household");
await page.click("#nt-submit-btn");
await page.waitForFunction(() => /Household/.test(document.getElementById("net-types").textContent));
await page.click("#net-tab-gemachs");
ok(await page.$eval("#ng-row-recB select[aria-label=Category]", e => e.value) === "Household", "gemach shows the renamed type");
await page.screenshot({ path: "shot-network-types.png" });
ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
