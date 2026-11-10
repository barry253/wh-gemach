// Network tab → "Older borrower emails" (Nov 2026, one-off): Preview pages through the email service and says what
// would come in; Import is only possible after a preview and carries on page by page; errors stop with a note.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = { id: "recA", slug: "wh-medical", name: "WH", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [] };
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], calls = [];
let failNext = false;
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const rq = r.request(); const p = new URL(rq.url()).pathname;
  const body = rq.postData() ? JSON.parse(rq.postData()) : null;
  calls.push({ method: rq.method(), path: p, body });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "n@x", name: "N", role: "Network Admin", gemachs: [{ id: "recA", slug: "wh-medical", name: "WH" }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/network/overview") return J({ gemachs: [], admins: [], categories: [] });
  if (p === "/admin/network/searches") return J({ days: 30, total: 0, top: [], misses: [] });
  if (p === "/admin/network/email-import") {
    if (failNext) { failNext = false; return J({ error: "Couldn't read the email service's list. Resend 500: boom" }, 502); }
    const first = !body.cursor;
    const page1 = { seen: 100, linked: 40, pickup: 5, unsure: 3, notBorrower: 52, saved: body.dryRun ? 0 : 45, oldest: "2026-10-12T10:00:00Z", cursor: "e100", done: false,
      rows: [{ outcome: "unsure", reason: "no matching History entry" }, { outcome: "unsure", reason: "no matching History entry" }, { outcome: "unsure", reason: "more than one possible History entry" }] };
    const page2 = { seen: 20, linked: 10, pickup: 0, unsure: 0, notBorrower: 10, saved: body.dryRun ? 0 : 10, oldest: "2026-10-10T10:00:00Z", cursor: "e120", done: true, rows: [] };
    return J(first ? page1 : page2);
  }
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
await page.goto("http://admin.test/admin");
await page.waitForTimeout(700);
await page.evaluate(() => switchTab("network"));
await page.waitForTimeout(300);
await page.evaluate(() => showNetworkArea("analytics"));
await page.waitForSelector("#net-email-import");
ok(await page.$eval("#net-ei-go", b => b.disabled), "Import waits for a preview");
await page.click("#net-ei-preview");
await page.waitForFunction(() => /The email service has/.test(document.getElementById("net-ei-result").textContent));
const t = await page.textContent("#net-ei-result");
ok(/has 120 emails back to Oct 10/.test(t) && /50 borrower emails match/.test(t) && /5 pickup emails/.test(t), "preview totals over both pages: " + t);
ok(/3 borrower emails can't be matched for sure/.test(t) && /2 no matching History entry/.test(t) && /62 weren't to borrowers/.test(t), "unsure + why, and not-borrower count");
ok(calls.filter(c => c.path === "/admin/network/email-import").every(c => c.body.dryRun === true), "preview never imports");
ok(!(await page.$eval("#net-ei-go", b => b.disabled)), "Import enabled after the preview");
// a failure stops with a note
failNext = true;
await page.click("#net-ei-go");
await page.waitForFunction(() => /Stopped/.test(document.getElementById("net-ei-result").textContent));
ok(/carries on safely/.test(await page.textContent("#net-ei-result")), "import error: says running again is safe");
// import runs to the end
const n = calls.length;
await page.click("#net-ei-go");
await page.waitForFunction(() => /^Done/.test(document.getElementById("net-ei-result").textContent));
const imp = calls.slice(n).filter(c => c.path === "/admin/network/email-import");
ok(imp.length === 2 && imp[0].body.dryRun === false && imp[1].body.cursor === "e100", "import pages through with the cursor");
ok(/55 emails saved/.test(await page.textContent("#net-ei-result")), "done: count saved");
ok(await page.$eval("#net-ei-go", b => b.disabled), "Import off again until the next preview");
ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
