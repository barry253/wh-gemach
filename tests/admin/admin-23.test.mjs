// iPhone / iPad sign-in: on whgemachs.org the Google button is set to redirect mode (login_uri = /admin-login),
// other devices keep the popup; and when /admin-login hands back a Google token (sessionStorage), the admin page
// signs in with it and removes it.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const G = { id: "recA", slug: "goldenberg-medical", name: "Goldenberg Medical Gemach", canEdit: true, templates: {}, rawTemplates: {}, placeholders: [] };
const MINE = [{ id: "recA", slug: "goldenberg-medical", name: G.name, active: true }, { id: "recB", slug: "test-gemach", name: "Test Gemach", active: true }];

async function open({ ua, url, cred }) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [], logins = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route(url, r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route(/^https:\/\/(api\.whgemachs\.org|wh-gemach\.barry253-0f5\.workers\.dev)\//, async r => {
    const rq = r.request(), p = new URL(rq.url()).pathname;
    const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/login") { logins.push(JSON.parse(rq.postData() || "{}")); return J({ token: "t.o.k", name: "Joy Goldenberg", email: "j@x", role: "Manager", gemachs: MINE }); }
    if (p === "/admin/me") return J({ email: "j@x", name: "Joy Goldenberg", role: "Manager", gemachs: MINE });
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    return J([]);
  });
  if (cred) await page.addInitScript(c => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); sessionStorage.setItem("whg_google_cred", c); } }, cred);
  await page.goto(url);
  await page.waitForTimeout(500);
  return { ctx, page, errors, logins };
}

// 1. iPhone on whgemachs.org → redirect mode pointing at /admin-login
let t = await open({ ua: IPHONE, url: "https://whgemachs.org/admin" });
let attrs = await t.page.evaluate(() => { const e = document.getElementById("g_id_onload"); return { mode: e.getAttribute("data-ux_mode"), uri: e.getAttribute("data-login_uri") }; });
ok(attrs.mode === "redirect" && attrs.uri === "https://whgemachs.org/admin-login", "iPhone: Google button uses redirect mode to /admin-login " + JSON.stringify(attrs));
ok(!t.errors.length, "iPhone: no script errors " + t.errors.join(" | "));
await t.ctx.close();

// 2. iPad that reports a Mac user agent (iPadOS default) is treated the same
{
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", hasTouch: true, viewport: { width: 820, height: 1180 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 }));
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }));
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("https://whgemachs.org/admin", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://whgemachs.org/admin");
  const mode = await page.evaluate(() => document.getElementById("g_id_onload").getAttribute("data-ux_mode"));
  ok(mode === "redirect", "iPad (Mac user agent + touch): redirect mode");
  await ctx.close();
}

// 3. Everything else keeps the popup
t = await open({ ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", url: "https://whgemachs.org/admin" });
attrs = await t.page.evaluate(() => { const e = document.getElementById("g_id_onload"); return { mode: e.getAttribute("data-ux_mode"), uri: e.getAttribute("data-login_uri") }; });
ok(attrs.mode === null && attrs.uri === null, "computer: popup mode unchanged");
await t.ctx.close();

// 4. iPhone on another host (previews, tests) keeps the popup: the redirect address is only authorized for whgemachs.org
t = await open({ ua: IPHONE, url: "https://whgemachs.pages.dev/admin" });
attrs = await t.page.evaluate(() => document.getElementById("g_id_onload").getAttribute("data-ux_mode"));
ok(attrs === null, "iPhone on a preview host: popup mode");
await t.ctx.close();

// 5. Back from /admin-login with a Google token: signs in with it, shows the app, removes it
t = await open({ ua: IPHONE, url: "https://whgemachs.org/admin", cred: "aaa.bbb.ccc" });
ok(t.logins.length === 1 && t.logins[0].googleToken === "aaa.bbb.ccc", "the returned Google token is sent to POST /admin/login " + JSON.stringify(t.logins));
ok(await t.page.evaluate(() => getComputedStyle(document.getElementById("app")).display !== "none" && getComputedStyle(document.getElementById("login-screen")).display === "none"), "app is shown, sign-in screen gone");
ok(await t.page.evaluate(() => localStorage.getItem("gemach_token")) === "t.o.k", "session token saved");
ok(await t.page.evaluate(() => sessionStorage.getItem("whg_google_cred")) === null, "the Google token is removed from sessionStorage");
ok(!!(await t.page.$("#gemach-picker")), "two gemachs and no remembered one → the picker opens");
ok(!t.errors.length, "no script errors " + t.errors.join(" | "));
await t.page.reload();
await t.page.waitForTimeout(400);
ok(t.logins.length === 1, "reloading doesn't sign in a second time with the same token");
await t.ctx.close();

// 6. No returned token and no session: just the sign-in screen
t = await open({ ua: IPHONE, url: "https://whgemachs.org/admin" });
ok(t.logins.length === 0 && await t.page.evaluate(() => getComputedStyle(document.getElementById("login-screen")).display !== "none"), "plain visit shows the sign-in screen");
await t.ctx.close();

await browser.close();
