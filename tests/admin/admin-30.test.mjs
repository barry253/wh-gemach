// Network → Categories: delete a home page category (refused while item types use it; confirms; removes it from the list).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [] };
const GEMACHS = [{ id: "recA", slug: "wh-medical", name: G.name, active: true, adminCount: 1, itemCount: 0, email: "", phone: "", mode: "Full", category: "Medical", displayOrder: null, browseCategoryIds: ["recC1", "recC2"] }];
let CATS = [
  { id: "recC1", name: "Wheelchairs", icon: "🦽", active: true, displayOrder: 1, keywords: [], itemTypeCount: 2 },
  { id: "recC2", name: "Baby Headphones", icon: "🎧", active: false, displayOrder: 2, keywords: [], itemTypeCount: 0 },
];
const calls = []; const dialogs = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("dialog", d => { dialogs.push(d.message()); d.accept(); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const rq = r.request(); const p = new URL(rq.url()).pathname; const m = rq.method();
  calls.push({ m, p });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  let mm;
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Network Admin", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/network/overview") return J({ gemachs: GEMACHS, admins: [], categories: CATS });
  if (p === "/admin/network/gemach-types") return J([]);
  if ((mm = p.match(/^\/admin\/network\/categories\/(rec\w+)$/)) && m === "DELETE") { CATS = CATS.filter(c => c.id !== mm[1]); return J({ ok: true, id: mm[1] }); }
  if (p === "/admin/network/searches") return J({ days: 30, total: 0, top: [], misses: [] });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(400);
await page.click(".nav-tab:has-text('Network')");
await page.click("#net-tab-categories");
await page.waitForSelector("#net-categories .net-row");
await page.click("#nc-row-recC1 button:has-text('Delete')");
ok(!calls.some(c => c.m === "DELETE") && dialogs.length === 0, "category with item types: not deleted, no prompt");
ok(/2 item types are in/.test(await page.textContent("#toast, .toast, body")), "says why");
await page.click("#nc-row-recC2 button:has-text('Delete')");
await page.waitForFunction(() => !document.getElementById("nc-row-recC2"));
ok(dialogs.length === 1 && /Baby Headphones/.test(dialogs[0]) && /removed from 1 gemach/.test(dialogs[0]), "asks first, mentions the gemach it's removed from: " + dialogs[0]);
ok(calls.some(c => c.m === "DELETE" && c.p === "/admin/network/categories/recC2"), "DELETE sent");
ok(!!(await page.$("#nc-row-recC1")), "other category stays");
await page.screenshot({ path: "shot-network-category-delete.png" });
ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
