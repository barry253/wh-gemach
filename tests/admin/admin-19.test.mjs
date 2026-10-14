// Network tab split into sub-tabs (Gemachs / Admins / Categories / Analytics); Analytics loads only when opened,
// shows network numbers, a by-gemach table (sortable), most requested and the no-result searches.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const TODAY = nyToday();
const plus = n => { const [y, m, d] = TODAY.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const hoursAgo = h => new Date(Date.now() - h * 3600e3).toISOString();

const G = { id: "recA", slug: "wh-medical", name: "WH Medical", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [] };
const OVERVIEW = {
  gemachs: [
    { id: "recA", slug: "wh-medical", name: "WH Medical", active: true, comingSoon: false, mode: "Full", category: "Medical", itemCount: 12, adminCount: 2 },
    { id: "recS", slug: "simcha-dress", name: "Simcha Dress", active: true, comingSoon: false, mode: "Full", category: "Clothing", itemCount: 451, adminCount: 1 },
  ],
  admins: [{ id: "recADM1", name: "Barry", email: "b@x", role: "Network Admin", active: true, gemachs: [] }],
  categories: [{ id: "recCAT1", name: "Walkers", icon: "🚶", keywords: "", displayOrder: 10, active: true, itemCount: 0 }],
};
const row = (o) => ({ mode: "Full", status: "Live", requests: 0, confirmed: 0, declined: 0, adminBookings: 0, waiting: 0, waitingOver48h: 0, reserved: 0, out: 0,
  overdue: 0, loansStarted: 0, loansReturned: 0, borrowers: 0, itemTypes: 0, medianReplyHours: null, lastActivity: null, ...o });
const ANALYTICS = days => ({
  days, since: plus(-days), today: TODAY,
  gemachs: { live: 2, comingSoon: 1, hidden: 0 },
  now: { waiting: 5, waitingOver48h: 2, reserved: 7, out: 23, overdue: 3, borrowers: 140, itemTypes: 860 },
  period: { requests: 48, confirmed: 39, declined: 4, cancelled: 2, stillWaiting: 3, adminBookings: 6, loansStarted: 41, loansReturned: 30, answered: 43, medianReplyHours: 5.5, within24hPct: 88 },
  people: { total: 212, records: 230, withLoanNow: 19, withReservationNow: 6, overdue: 2, borrowedInPeriod: 37, newInPeriod: 22, returningInPeriod: 15,
    repeat: 41, multiGemach: 9, requesters: 44, requestersNeverBorrowed: 18, loansPerPerson: 1.8 },
  trend: { by: days === 365 ? "month" : "week", buckets: Array.from({ length: days === 365 ? 13 : Math.ceil(days / 7) }, (_, i) => ({ start: plus(-7 * (12 - i) - 6), requests: i % 5, loans: (i * 2) % 4 })) },
  topRequested: [{ name: "Wheelchair", gemach: "WH Medical", requests: 14 }, { name: "Navy <b>gown</b> – size 8", gemach: "Simcha Dress", requests: 6 }],
  topLooked: [{ name: "Navy gown – size 8", gemach: "Simcha Dress", photos: 41, picks: 9, shares: 4, linkOpens: 7, requests: 6 }, { name: "Gold gown – size 12", gemach: "Simcha Dress", photos: 25, picks: 3, requests: 0 }],
  siteHealth: { jsErrors: 4, loadFails: 3, top: [
    { kind: "js-error", label: "TypeError: <img src=x> is undefined", count: 4, days: 2, lastAt: hoursAgo(3), page: "/g/simcha-dress", src: "/assets/gemach.js", line: 412, browser: "iPhone/iPad Safari" },
    { kind: "load-fail", label: "gemach", count: 3, days: 3, lastAt: hoursAgo(30), page: "/g/wh-medical", src: null, line: null, browser: "Android Chrome" },
  ] },
  byGemach: [
    row({ id: "recA", slug: "wh-medical", name: "WH Medical", peopleInPeriod: 21, requests: 30, confirmed: 26, waiting: 1, reserved: 4, out: 15, overdue: 3, loansStarted: 28, medianReplyHours: 3, lastActivity: hoursAgo(2), adminBookings: 4 }),
    row({ id: "recS", slug: "simcha-dress", name: "Simcha Dress", requests: 18, waiting: 4, waitingOver48h: 2, reserved: 3, out: 8, loansStarted: 13, medianReplyHours: 30, lastActivity: hoursAgo(24 * 9) }),
    row({ id: "recC", slug: "coming", name: "Aardvark Coming", status: "Coming soon" }),
  ],
});
const TRAFFIC = days => ({
  configured: true, days, since: plus(-days + 1), today: TODAY, problems: [],
  visitors: {
    visits: 820, pageViews: 2460, botsExcluded: true, from: plus(-days + 1),
    byDate: Array.from({ length: 20 }, (_, i) => ({ date: plus(-i * 4), visits: 10 + (i % 7) * 3, pageViews: 30 + i })),
    sources: [{ name: "Direct (typed, bookmark or app)", visits: 410 }, { name: "WhatsApp", visits: 220 }, { name: "Google", visits: 120 }, { name: "anshei.org", visits: 40 }, { name: "evil<b>host</b>.com", visits: 30 }],
    devices: [{ name: "mobile", visits: 690, pageViews: 2000 }, { name: "desktop", visits: 130, pageViews: 460 }],
    countries: [{ name: "US", visits: 800, pageViews: 2400 }, { name: "IL", visits: 20, pageViews: 60 }],
    pages: [{ name: "/", pageViews: 900, visits: 500 }, { name: "/g/simcha-dress", pageViews: 700, visits: 200 }, { name: "/g/wh-medical", pageViews: 400, visits: 90 }, { name: "/r/…", pageViews: 40, visits: 30 }],
    gemachViews: { "simcha-dress": { pageViews: 700, visits: 200 }, "wh-medical": { pageViews: 400, visits: 90 } },
  },
  worker: { days: 30, requests: 51234, errors: 9, byStatus: { exceededResources: 7, scriptThrewException: 2, clientDisconnected: 40 }, byDate: [] },
  http: { days: 30, site4xx: 64, site5xx: 1, api4xx: 120, api5xx: 3, top: [{ path: "/wp-login.php", status: 404, count: 40 }, { path: "/g/old-gemach", status: 404, count: 6 }, { path: "/about", status: 502, count: 1 }] },
});
let TRAFFIC_MODE = "on";
const SEARCHES = { days: 90, total: 1, searches: [{ id: "recS1", query: "hospital bed", count: 4, nothingFound: 4, allOnLoan: 0, lastSearched: hoursAgo(5) }] };

const reqs = [];
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url()), p = u.pathname;
  reqs.push({ path: p, search: u.search });
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Network Admin", gemachs: [{ id: "recA", slug: G.slug, name: G.name, active: true }, { id: "recS", slug: "simcha-dress", name: "Simcha Dress", active: true }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
  if (p === "/admin/stats") return J({ requests: {} });
  if (p === "/admin/network/overview") return J(OVERVIEW);
  if (p === "/admin/network/analytics") return J(ANALYTICS(Number(u.searchParams.get("days"))));
  if (p === "/admin/network/traffic") return J(TRAFFIC_MODE === "off" ? { configured: false, days: 90 } : TRAFFIC(Number(u.searchParams.get("days"))));
  if (p === "/admin/network/searches") return J({ ...SEARCHES, days: Number(u.searchParams.get("days")) });
  return J([]);
});
await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); if (!sessionStorage.getItem("t_init")) { localStorage.setItem("gemach_slug", "wh-medical"); sessionStorage.setItem("t_init", "1"); } });
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(500);

await page.click(".nav-tab:has-text('Network')");
await page.waitForSelector("#ng-row-recA");
const tabs = (await page.$$eval(".net-tabs .set-tab", b => b.map(x => x.innerText.trim()))).join("|");
ok(tabs === "Gemachs|Admins|Categories|Analytics", "four sub-tabs: " + tabs);
ok(await page.isVisible("#net-area-gemachs") && !(await page.isVisible("#net-area-admins")) && !(await page.isVisible("#net-area-analytics")), "Gemachs shown first, others hidden");
ok(!reqs.some(r => r.path === "/admin/network/analytics" || r.path === "/admin/network/searches"), "analytics and searches not loaded until opened");
await page.screenshot({ path: "shot-net-tabs-gemachs.png" });

await page.click("#net-tab-admins");
ok(await page.isVisible("#net-admins") && !(await page.isVisible("#net-gemachs")), "Admins tab shows the admin list");
ok(await page.getAttribute("#net-tab-admins", "aria-selected") === "true" && await page.getAttribute("#net-tab-gemachs", "aria-selected") === "false", "aria-selected follows");
await page.click("#net-tab-categories");
ok(await page.isVisible("#net-categories") && /Walkers/.test(await page.textContent("#net-categories")), "Categories tab");

await page.click("#net-tab-analytics");
await page.waitForSelector("#net-analytics .kpi-grid");
await page.waitForSelector("#net-searches table");
ok(reqs.some(r => r.path === "/admin/network/analytics" && r.search === "?days=90"), "analytics loaded for 90 days");
const t = await page.$eval("#net-analytics", e => e.innerText);
ok(/5\s*Waiting for a reply\s*2 over 2 days/.test(t), "waiting KPI: " + t.slice(0, 200));
ok(/23\s*Out on loan\s*3 overdue/.test(t) && /7\s*Reserved/.test(t), "out / reserved KPIs");
ok(/3\s*Gemachs\s*2 live · 1 coming soon · 0 hidden/.test(t), "gemach count KPI");
ok(/48\s*Requests received\s*39 confirmed · 4 declined · 2 cancelled · 3 waiting/.test(t), "requests KPI");
ok(/6 hours\s*Typical time to reply\s*88% within a day/.test(t), "reply KPI");
ok(/41\s*Loans went out\s*30 returned · 6 booked in admin/.test(t), "loans KPI");
ok(/212\s*People on file\s*9 use more than one gemach/.test(t) && /19\s*Have something out now\s*2 with an overdue loan/.test(t), "people KPIs: on file, out now");
ok(/37\s*Borrowed in 90 days\s*22 new · 15 returning/.test(t) && /41\s*Borrowed 2\+ times\s*1.8 loans per person/.test(t), "people KPIs: period, repeat");
ok(/44\s*Asked online in 90 days\s*18 never borrowed before/.test(t) && /6\s*Waiting to pick up/.test(t), "people KPIs: requesters, waiting to pick up");
ok(await page.$$eval(".net-an-chartcard", c => c.map(x => x.querySelectorAll(".net-an-col").length).join(",")) === "13,13", "13 weekly columns in the requests and visits charts");
ok(/Requests and loans by week/.test(t) && /Requests/.test(await page.textContent(".net-an-legend")), "chart title + legend");
await page.hover(".net-an-col >> nth=1");
ok(/Week of .*: 1 request, 2 loans went out/.test(await page.textContent(".net-an-tip >> nth=0")), "hover shows the week's numbers: " + await page.textContent(".net-an-tip >> nth=0"));
ok(await page.$$eval(".net-an-table", t => t[0].querySelectorAll("tbody tr").length) === 13, "table view of the chart");
// Visitors (Cloudflare)
await page.waitForFunction(() => /Where visitors come from/.test(document.getElementById("net-analytics").innerText));
const t2 = await page.$eval("#net-analytics", e => e.innerText);
ok(/820\s*Visits\s*bots left out/.test(t2), "visits KPI");
ok(/2460\s*Page views\s*3 pages per visit/.test(t2) && /5.9\s*Requests per 100 visits\s*48 online requests/.test(t2), "page views + requests per 100 visits: " + t2.match(/Visits[\s\S]{0,200}/)?.[0]);
ok(/Visits by week/.test(t2) && !/Cloudflare only has visitor numbers/.test(t2), "visits chart; no 'only has numbers from' note when it has the whole period");
ok(/Where visitors come from[\s\S]*WhatsApp\s*220\s*27%/.test(t2), "sources with share: " + t2.match(/Where visitors come from[\s\S]{0,200}/)?.[0]);
ok(/Mobile\s*690\s*84%/.test(t2) && /US\s*800/.test(t2), "devices and countries");
ok(/Most viewed pages[\s\S]*Home page\s*900[\s\S]*Simcha Dress\s*700[\s\S]*Borrower request links/.test(t2), "page names readable");
const heads = (await page.$$eval(".net-an-gemachs th", h => h.map(x => x.innerText.replace(/[▲▼]/g, "").trim()))).join("|");
ok(heads === "Gemach|Views|Requests|Req / 100 views|Reply|Waiting|Reserved|Out|Lent|People|Last activity", "views columns: " + heads);
ok(/Simcha Dress\s*700\s*18\s*2.6/.test(await page.$eval(".net-an-gemachs", e => e.innerText)), "simcha views + per 100");
// Most looked at + site health
ok(/Most looked at[\s\S]*Navy gown – size 8\s*Simcha Dress\s*41\s*9\s*4\s*7\s*6/.test(t2) && /Shared\s*Link opened/.test(t2) && /Gold gown – size 12[\s\S]*no requests/.test(t2), "most looked at: " + t2.match(/Most looked at[\s\S]{0,250}/)?.[0]);
ok(/9\s*Server errors \(30 days\)\s*7 over the CPU limit · 2 crashed/.test(t2), "server errors KPI (client disconnects left out)");
ok(/65\s*Pages not found or failed \(30 days\)\s*1 failed · API 3 failed/.test(t2), "page errors KPI");
ok(/7\s*Problems in visitors' browsers\s*3 couldn't load · 4 script errors/.test(t2), "browser problems KPI");
ok(/TypeError: <img src=x> is undefined[\s\S]*Simcha Dress · \/assets\/gemach.js:412 · iPhone\/iPad Safari/.test(t2) && await page.$("#net-analytics img") === null, "problem rows (escaped)");
ok(/Couldn't load the gemach page\s*WH Medical · Android Chrome/.test(t2), "load failure row");
ok(/\/wp-login.php\s*404\s*40/.test(t2) && await page.$(".tag-red >> text=502") !== null, "not-found addresses with failed ones flagged");
ok(/evil<b>host<\/b>\.com/.test(t2), "source names escaped");
const order = async () => (await page.$$eval(".net-an-gemachs tbody tr td:first-child a", a => a.map(x => x.textContent))).join("|");
ok(await order() === "WH Medical|Simcha Dress|Aardvark Coming", "busiest first by default: " + await order());
const sd = await page.$eval(".net-an-gemachs tbody tr:nth-child(2)", e => e.innerText);
ok(/\b21\b/.test(await page.$eval(".net-an-gemachs tbody tr:nth-child(1)", e => e.innerText)), "people column");
ok(/2 > 2 days/.test(sd) && /2 days/.test(sd) && /9 days ago/.test(sd), "Simcha row: waiting flag, reply, last activity: " + sd);
ok(/Coming soon/.test(await page.textContent(".net-an-gemachs tbody tr:nth-child(3)")), "status tag on non-live gemach");
await page.click(".net-an-gemachs th >> text=Waiting");
ok(await order() === "Simcha Dress|WH Medical|Aardvark Coming", "sort by waiting: " + await order());
await page.click(".net-an-gemachs th >> text=Waiting");
ok(await order() === "Aardvark Coming|WH Medical|Simcha Dress", "tap again: smallest first: " + await order());
await page.click(".net-an-gemachs th >> text=Gemach");
ok(await order() === "Aardvark Coming|Simcha Dress|WH Medical", "sort by name");
ok(/Navy <b>gown<\/b>/.test(t) && await page.$("#net-analytics b") === null, "names escaped");
ok(/hospital bed/.test(await page.textContent("#net-searches")), "no-result searches on the Analytics tab");
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page scroll");
await page.locator("#net-area-analytics").screenshot({ path: "shot-net-analytics.png" });

await page.selectOption("#net-an-days", "365");
await page.waitForFunction(() => /by month/.test(document.getElementById("net-analytics").innerText));
ok(reqs.some(r => r.path === "/admin/network/analytics" && r.search === "?days=365") && reqs.some(r => r.path === "/admin/network/searches" && r.search === "?days=365"), "period changes both");

// The chosen sub-tab is remembered for the session.
await page.reload();
await page.waitForTimeout(500);
await page.click(".nav-tab:has-text('Network')");
await page.waitForSelector("#net-analytics .kpi-grid");
ok(await page.isVisible("#net-area-analytics") && !(await page.isVisible("#net-area-gemachs")), "Analytics reopens after reload");

// Tapping a gemach opens it.
const n0 = reqs.length;
await page.click(".net-an-gemachs tbody a >> text=Simcha Dress");
await page.waitForTimeout(1200);
ok(await page.evaluate(() => localStorage.getItem("gemach_slug")) === "simcha-dress" && reqs.length > n0, "gemach link switches into that gemach");

const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await p2.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await p2.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await p2.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await p2.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url()), p = u.pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Network Admin", gemachs: [{ id: "recA", slug: G.slug, name: G.name, active: true }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/network/overview") return J(OVERVIEW);
  if (p === "/admin/network/analytics") return J(ANALYTICS(90));
  if (p === "/admin/network/traffic") return J(TRAFFIC(90));
  if (p === "/admin/network/searches") return J(SEARCHES);
  return J([]);
});
await p2.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); sessionStorage.setItem("whg_network_area", "analytics"); });
await p2.goto("http://admin.test/admin.html");
await p2.waitForTimeout(500);
await p2.click(".nav-tab:has-text('Network')");
await p2.waitForSelector("#net-analytics .kpi-grid");
await p2.waitForFunction(() => /Where visitors come from/.test(document.getElementById("net-analytics").innerText));
await p2.locator("#net-area-analytics").screenshot({ path: "shot-net-analytics-desktop.png" });

await p2.close();
// Without the Cloudflare token: says so, everything else still there.
TRAFFIC_MODE = "off";
const p3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
p3.on("pageerror", e => errors.push(String(e)));
await p3.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await p3.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await p3.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await p3.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const u = new URL(r.request().url()), p = u.pathname;
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Network Admin", gemachs: [{ id: "recA", slug: G.slug, name: G.name, active: true }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/network/overview") return J(OVERVIEW);
  if (p === "/admin/network/analytics") return J({ ...ANALYTICS(90), siteHealth: undefined, topLooked: undefined });
  if (p === "/admin/network/traffic") return J({ configured: false, days: 90 });
  if (p === "/admin/network/searches") return J(SEARCHES);
  return J([]);
});
await p3.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); sessionStorage.setItem("whg_network_area", "analytics"); });
await p3.goto("http://admin.test/admin.html");
await p3.waitForTimeout(500);
await p3.click(".nav-tab:has-text('Network')");
await p3.waitForSelector("#net-analytics .kpi-grid");
await p3.waitForFunction(() => /Visitor numbers aren't connected yet/.test(document.getElementById("net-analytics").innerText));
const t3 = await p3.$eval("#net-analytics", e => e.innerText);
ok(/CF_ANALYTICS_TOKEN/.test(t3) && /needs the Cloudflare token/.test(t3) && !/Views/.test(await p3.$eval(".net-an-gemachs thead", e => e.innerText)), "not connected: explained; no views column");
ok(/Nothing counted yet/.test(t3) && /0\s*Problems in visitors' browsers/.test(t3), "older API answer without site events still renders");
await p3.close();

ok(!errors.length, "no page errors: " + errors.join(" | "));
await page.close();
await browser.close();
