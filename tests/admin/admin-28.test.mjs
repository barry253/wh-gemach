// Network tab → Edit gemach: pick the home page categories a gemach appears under.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [] };
const GM = { id: "recA", slug: "wh-medical", name: G.name, active: true, adminCount: 1, itemCount: 0, email: "whm@x", phone: "516", mode: "Full", category: "Medical", displayOrder: null, browseCategoryIds: ["recC1"] };
const CATS = [
  { id: "recC1", name: "Wheelchairs", icon: "🦽", active: true, displayOrder: 1, keywords: [] },
  { id: "recC2", name: "Air Conditioners", icon: "❄️", active: true, displayOrder: 2, keywords: [] },
  { id: "recC3", name: "Old Thing", icon: "", active: false, displayOrder: 3, keywords: [] },
];

async function open(role, gemach) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("dialog", d => d.accept());
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const rq = r.request(); const p = new URL(rq.url()).pathname; const m = rq.method();
    let body = null; try { body = JSON.parse(rq.postData() || "null"); } catch {}
    calls.push({ method: m, path: p, body });
    const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role, gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
    if (p === "/admin/gemach") return J(gemach);
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/network/gemachs/recA" && m === "PATCH") return J({ ...GM, browseCategoryIds: body.browseCategoryIds || GM.browseCategoryIds });
    if (p === "/admin/network/overview") return J({ gemachs: [GM], admins: [], categories: CATS });
    if (p === "/admin/network/searches") return J({ days: 30, total: 0, top: [], misses: [] });
    return J([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("gemach_token", "fake.token.x");
    localStorage.setItem("gemach_slug", "wh-medical");
  });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(400);
  return { page, errors, calls };
}


const { page, errors, calls } = await open("Network Admin", G);
await page.click(".nav-tab:has-text('Network')");
await page.click("#net-tab-gemachs");
await page.click("#ng-row-recA button:has-text('Edit')");
const state = () => page.$$eval("#eg-cats .attr-chip", e => e.map(x => x.dataset.cat + ":" + x.getAttribute("aria-pressed")).join(","));
ok(await state() === "recC2:false,recC1:true", "active categories shown A–Z, current one selected, off ones hidden: " + await state());
await page.click("#eg-cats [data-cat=recC2]");
await page.click("#eg-cats [data-cat=recC1]");
ok(await state() === "recC2:true,recC1:false", "chips toggle");
await page.click("#eg-cats [data-cat=recC1]");
await page.screenshot({ path: "shot-network-edit-gemach-cats.png" });
await page.click("#eg-submit-btn");
await page.waitForFunction(() => !document.getElementById("net-gemach-edit-sheet").classList.contains("open"));
const pg = calls.filter(c => c.method === "PATCH" && c.path === "/admin/network/gemachs/recA").at(-1);
ok(pg && JSON.stringify(pg.body.browseCategoryIds.slice().sort()) === '["recC1","recC2"]' && Object.keys(pg.body).length === 1, "only the categories sent: " + JSON.stringify(pg?.body));
// reopen: saved selection is remembered; no change -> no request
await page.click("#ng-row-recA button:has-text('Edit')");
ok(await state() === "recC2:true,recC1:true", "reopened with saved selection: " + await state());
const n = calls.filter(c => c.method === "PATCH").length;
await page.click("#eg-submit-btn");
await page.waitForTimeout(300);
ok(calls.filter(c => c.method === "PATCH").length === n, "no change, no request");
ok(!errors.length, "no page errors: " + errors.join(" | "));
await browser.close();
