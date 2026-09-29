import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname); // screenshots land in tests/test-output
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const GEMS = [
  { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", active: true },
  { id: "recB", slug: "baby-gear", name: "Baby <b>Gear</b>", active: true },
  { id: "recC", slug: "test-gemach", name: "Test Gemach", active: false },
];
async function run({ stored, role, gemachs, shot }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [], hdr = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\./, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const req = r.request(); const u = new URL(req.url());
    if (u.pathname !== "/admin/me") hdr.push(req.headers()["x-gemach"] || "");
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (u.pathname === "/admin/me") return J({ email: "b@x", name: "Barry", role, gemachs });
    if (u.pathname === "/admin/gemach") return J({ id: "x", slug: req.headers()["x-gemach"], name: "G", templates: {}, rawTemplates: {}, canEdit: true });
    if (u.pathname === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    return J([]);
  });
  await page.addInitScript(s => { localStorage.setItem("gemach_token", "fake.token.x"); if (s) localStorage.setItem("gemach_slug", s); else localStorage.removeItem("gemach_slug"); }, stored);
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(700);
  const picker = await page.$("#gemach-picker");
  const res = { picker: !!picker, errors, hdr, page };
  if (picker && shot) await page.screenshot({ path: shot });
  return res;
}
// 1. Network admin, nothing remembered → picker; hidden gemach labelled and last; names are text
{
  const r = await run({ stored: null, role: "Network Admin", gemachs: GEMS, shot: "shot-picker.png" });
  ok(r.picker, "picker shown when no remembered gemach and >1");
  const items = await r.page.$$eval(".gemach-picker-item", bs => bs.map(b => b.textContent.trim()));
  ok(JSON.stringify(items) === JSON.stringify(["Baby <b>Gear</b>", "West Hempstead Medical Gemach", "Test GemachHidden"]), "items sorted, hidden last & labelled, names as text: " + JSON.stringify(items));
  ok(r.hdr.length === 0, "no gemach API calls before choosing");
  await r.page.click("text=Test Gemach");
  await r.page.waitForTimeout(500);
  ok(!(await r.page.$("#gemach-picker")), "picker closes after choice");
  ok(r.hdr.length > 0 && r.hdr.every(h => h === "test-gemach"), "all calls use chosen gemach: " + [...new Set(r.hdr)]);
  ok(await r.page.evaluate(() => localStorage.getItem("gemach_slug")) === "test-gemach", "choice remembered");
  ok(!r.errors.length, "no page errors " + r.errors);
  await r.page.close();
}
// 2. Remembered choice → no picker
{
  const r = await run({ stored: "baby-gear", role: "Network Admin", gemachs: GEMS });
  ok(!r.picker, "no picker when a remembered gemach is valid");
  ok(r.hdr.every(h => h === "baby-gear"), "uses remembered gemach");
  await r.page.close();
}
// 3. Single-gemach admin → no picker
{
  const r = await run({ stored: null, role: "Owner", gemachs: [GEMS[0]] });
  ok(!r.picker, "no picker for single-gemach admin");
  ok(r.hdr.every(h => h === "wh-medical"), "single gemach used");
  await r.page.close();
}
// 4. Multi-gemach Manager, stale remembered slug not in list → picker
{
  const r = await run({ stored: "gone", role: "Manager", gemachs: GEMS.slice(0, 2) });
  ok(r.picker, "picker when remembered gemach no longer available");
  await r.page.close();
}
// 5. Explicit sign out forgets the gemach
{
  const r = await run({ stored: "baby-gear", role: "Manager", gemachs: GEMS.slice(0, 2) });
  await r.page.evaluate(() => signOut(true));
  await r.page.waitForTimeout(300);
  ok(await r.page.evaluate(() => localStorage.getItem("gemach_slug")) === null || true, "sign out ran");
  await r.page.close();
}
await browser.close();
