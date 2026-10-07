// Notifications (🔔): the per-device sheet in every state, turning on/off, choices, test, other devices,
// sign-out unsubscribing, and links into admin (?tab=…&req=…|loan=…) from a tapped notification.
// The browser's Push API and service worker are faked (tests run on http://admin.test, which has neither).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const GEMACHS = [{ id: "recGEMACHKALLAH01", slug: "kallah", name: "Kallah Gemach" }, { id: "recGEMACHOTHER001", slug: "other", name: "Other Gemach" }];
const G = { id: GEMACHS[0].id, slug: "kallah", name: "Kallah Gemach", canEdit: true, rawTemplates: {}, templates: {}, placeholders: [], requestStyle: "Dates", eventLabel: "Event date" };
const REQS = [{ id: "recREQNEW00000001", requestId: "R-971", name: "New Person", phone: "5165550304", receivedAt: new Date().toISOString(), requestType: "Loan",
  neededFrom: iso(8), neededUntil: iso(9), items: [{ id: "recTY", name: "Gown Y" }], itemNames: ["Gown Y"] }];
const LOANS = [{ id: "recLOANACT0000001", loanId: "L-810", borrowerName: "Walk In", itemTypeName: "Gown Z", itemId: "BZ-001", dateBorrowed: iso(-2), expectedReturn: iso(3), daysOut: 2, overdue: false, readyToReturnAt: new Date().toISOString() }];
const KEY = "BFakeServerKeyBFakeServerKeyBFakeServerKeyBFakeServerKeyBFakeServerKeyBFakeServerKeyBFakeServerK";

async function setup({ ua, push = true, standalone = false, configured = true, devices = [] } = {}) {
  const state = { reqs: [], devices: devices.map(d => ({ ...d })) };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  state.errors = [];
  page.on("pageerror", e => state.errors.push(String(e)));
  page.on("dialog", d => d.accept());
  await page.addInitScript(({ push, standalone }) => {
    localStorage.setItem("gemach_token", "tok"); localStorage.setItem("gemach_name", "Barry"); localStorage.setItem("gemach_slug", "kallah");
    if (standalone) window.matchMedia = q => ({ matches: /standalone/.test(q), addEventListener() {}, removeEventListener() {} });
    if (!push) return;
    // Fake Push API + service worker (records what admin does with them).
    const T = window.__push = { perm: "default", sub: null, listeners: [], registered: null, unsubscribed: 0 };
    const makeSub = key => ({
      endpoint: "https://fcm.googleapis.com/fcm/send/this-device", options: { applicationServerKey: key },
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: "BPub", auth: "Auth" } }; },
      async unsubscribe() { T.unsubscribed++; T.sub = null; return true; },
    });
    const reg = { pushManager: {
      async getSubscription() { return T.sub; },
      async subscribe(o) { T.subscribeOpts = { userVisibleOnly: o.userVisibleOnly, keyLen: o.applicationServerKey.length }; T.sub = makeSub(o.applicationServerKey.buffer); return T.sub; },
    } };
    Object.defineProperty(window, "isSecureContext", { get: () => true, configurable: true });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {
      async register(url, o) { T.registered = { url, scope: o && o.scope }; return reg; },
      ready: Promise.resolve(reg), async getRegistration() { return reg; },
      addEventListener(type, fn) { if (type === "message") T.listeners.push(fn); },
    } });
    window.PushManager = function PushManager() {};
    window.Notification = { get permission() { return T.perm; }, async requestPermission() { T.perm = "granted"; return "granted"; } };
  }, { push, standalone });
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const u = new URL(r.request().url()), p = u.pathname, M = r.request().method();
    const body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
    state.reqs.push({ method: M, path: p, body, auth: r.request().headers().authorization });
    const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: GEMACHS });
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: 1, activeLoans: 1, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/requests") return J(REQS);
    if (p === "/admin/loans" && M === "GET") return J(LOANS);
    if (p === "/admin/reservations") return J([]);
    if (p === "/admin/appointments") return J([]);
    if (p === "/admin/stats") return J({});
    if (p === "/admin/push" && M === "GET") return J({ configured, publicKey: configured ? KEY : null, events: ["request", "cancel", "ready"], devices: state.devices });
    if (p === "/admin/push/subscribe") {
      const d = { id: "recPUSHTHISDEVICE", device: body.device, endpoint: body.subscription.endpoint, events: ["request", "cancel", "ready"], gemachs: null, createdAt: new Date().toISOString() };
      state.devices = state.devices.filter(x => x.endpoint !== d.endpoint).concat(d);
      return J({ success: true, device: d });
    }
    if (p === "/admin/push/unsubscribe") { state.devices = state.devices.filter(x => x.endpoint !== body.endpoint); return J({ success: true }); }
    if (p === "/admin/push/test") return J({ success: true, sent: 1 });
    const m = p.match(/^\/admin\/push\/(rec\w+)$/);
    if (m && M === "PATCH") { const d = state.devices.find(x => x.id === m[1]); Object.assign(d, body); return J({ success: true, device: d }); }
    if (m && M === "DELETE") { state.devices = state.devices.filter(x => x.id !== m[1]); return J({ success: true }); }
    return J({});
  });
  return { page, ctx, state, find: (M, path) => state.reqs.filter(x => x.method === M && x.path === path) };
}
const statusText = page => page.locator("#ntf-status").innerText();
const openBell = async page => { await page.click("#btn-bell"); await page.waitForFunction(() => !/Checking/.test(document.getElementById("ntf-status").textContent)); };

// 1. Not set up on the server
{
  const { page, ctx } = await setup({ configured: false });
  await page.goto("http://admin.test/");
  await page.waitForSelector("#btn-bell");
  await openBell(page);
  ok(/Not available yet/.test(await statusText(page)), "server not set up → 'Not available yet'");
  ok(await page.locator("#ntf-on").count() === 0, "no turn-on button");
  await ctx.close();
}

// 2. iPhone in Safari (not the Home Screen app): how to add it
{
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
  const { page, ctx } = await setup({ ua, push: false, devices: [{ id: "recPUSHOLDPHONE01", device: "Android phone", endpoint: "https://fcm.googleapis.com/x/old", events: ["request"], gemachs: null, lastSentAt: new Date(Date.now() - 3 * 3600e3).toISOString() }] });
  await page.goto("http://admin.test/");
  await page.waitForSelector("#btn-bell");
  await openBell(page);
  const t = await statusText(page);
  await page.screenshot({ path: "admin-16-iphone-steps.png" });
  ok(/Add Gemach Admin to your Home Screen/i.test(t) && /Add to Home Screen/.test(t) && await page.locator(".ntf-steps li").count() === 4, "iPhone Safari → Home Screen steps");
  ok(/Android phone/.test(await page.locator("#ntf-others").innerText()) && /Last notified 3h ago/.test(await page.locator("#ntf-others").innerText()), "other devices still listed (can remove them from here)");
  await ctx.close();
}

// 3. Desktop browser with no Push API
{
  const { page, ctx } = await setup({ push: false });
  await page.goto("http://admin.test/");
  await page.waitForSelector("#btn-bell");
  await openBell(page);
  ok(/can't show notifications/.test(await statusText(page)), "no Push API → explains");
  await ctx.close();
}

// 4. Turn on, choose, test, other devices, turn off, sign out
{
  const other = { id: "recPUSHLAPTOP0001", device: "Mac · Chrome", endpoint: "https://fcm.googleapis.com/fcm/send/laptop", events: ["request"], gemachs: null, createdAt: new Date(Date.now() - 2 * 864e5).toISOString() };
  const { page, ctx, state, find } = await setup({ ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36", devices: [other] });
  await page.goto("http://admin.test/");
  await page.waitForSelector("#btn-bell");
  await page.waitForFunction(() => window.__push.registered);
  const reg = await page.evaluate(() => window.__push.registered);
  ok(reg.url === "/admin-sw.js" && reg.scope === "/admin", "service worker registered for /admin after sign-in");
  await openBell(page);
  ok(/Off on this device/.test(await statusText(page)), "starts off");
  ok(/Mac · Chrome/.test(await page.locator("#ntf-others").innerText()) && /Added 2d ago/.test(await page.locator("#ntf-others").innerText()), "other device listed");
  await page.click("#ntf-on");
  await page.waitForFunction(() => /On for this device/.test(document.getElementById("ntf-status").textContent));
  const sub = find("POST", "/admin/push/subscribe")[0];
  ok(sub && sub.body.subscription.endpoint === "https://fcm.googleapis.com/fcm/send/this-device" && sub.body.subscription.keys.auth === "Auth", "subscription sent to the server");
  ok(sub && sub.body.device === "Android phone", `device label (${sub && sub.body.device})`);
  const opts = await page.evaluate(() => window.__push.subscribeOpts);
  ok(opts.userVisibleOnly === true && opts.keyLen > 0, "subscribed with the server's public key");
  const labels = await page.locator("#ntf-events .check-row").allInnerTexts();
  ok(labels.join("|") === "New requests|A borrower cancels|A borrower is ready to return", `event choices (${labels.join("|")})`);
  ok(await page.locator("#ntf-events input:checked").count() === 3, "all on by default");
  ok(await page.locator("#ntf-gemachs .check-row").count() === 2 && await page.locator("#ntf-gemachs input:checked").count() === 2, "two gemachs, both on");
  await page.screenshot({ path: "admin-16-notifications-on.png" });

  await page.locator("#ntf-events .check-row", { hasText: "cancels" }).locator("input").uncheck();
  await page.waitForTimeout(150);
  let patch = find("PATCH", "/admin/push/recPUSHTHISDEVICE").at(-1);
  ok(patch && JSON.stringify(patch.body.events) === JSON.stringify(["request", "ready"]) && patch.body.gemachs === null, "unticking an event saves it");
  await page.locator("#ntf-gemachs .check-row", { hasText: "Other Gemach" }).locator("input").uncheck();
  await page.waitForTimeout(150);
  patch = find("PATCH", "/admin/push/recPUSHTHISDEVICE").at(-1);
  ok(patch && JSON.stringify(patch.body.gemachs) === JSON.stringify(["recGEMACHKALLAH01"]), "one gemach only");
  const before = find("PATCH", "/admin/push/recPUSHTHISDEVICE").length;
  await page.locator("#ntf-gemachs .check-row", { hasText: "Kallah" }).locator("input").click();
  await page.waitForTimeout(150);
  ok(await page.locator("#ntf-gemachs .check-row", { hasText: "Kallah" }).locator("input").isChecked() && find("PATCH", "/admin/push/recPUSHTHISDEVICE").length === before, "can't untick the last gemach");

  await page.click("#ntf-test");
  await page.waitForTimeout(150);
  ok(find("POST", "/admin/push/test")[0]?.body.endpoint === "https://fcm.googleapis.com/fcm/send/this-device", "test goes to this device");

  await page.locator("#ntf-others .ntf-device", { hasText: "Mac · Chrome" }).locator("button").click();
  await page.waitForTimeout(250);
  ok(find("DELETE", "/admin/push/recPUSHLAPTOP0001").length === 1 && await page.locator("#ntf-others-group").isHidden(), "other device removed");

  await page.click("#ntf-off");
  await page.waitForFunction(() => /Off on this device/.test(document.getElementById("ntf-status").textContent));
  ok(find("POST", "/admin/push/unsubscribe")[0]?.body.endpoint === "https://fcm.googleapis.com/fcm/send/this-device" && await page.evaluate(() => window.__push.unsubscribed) === 1, "turn off: server told + browser unsubscribed");

  // On again, then sign out: this device stops getting notifications.
  await page.click("#ntf-on");
  await page.waitForFunction(() => /On for this device/.test(document.getElementById("ntf-status").textContent));
  await page.evaluate(() => closeSheet("notif-sheet"));
  const n = find("POST", "/admin/push/unsubscribe").length;
  await Promise.all([page.waitForEvent("load"), page.click(".btn-signout")]);
  const last = find("POST", "/admin/push/unsubscribe");
  ok(last.length === n + 1 && last.at(-1).auth === "Bearer tok", "sign out unsubscribes this device with the old session");
  ok(!state.errors.length, "no page errors: " + state.errors.join(" | "));
  await ctx.close();
}

// 5. Links into admin from a notification
{
  const { page, ctx, state } = await setup();
  await page.goto("http://admin.test/admin?g=kallah&tab=requests&req=recREQNEW00000001");
  await page.waitForSelector("#req-recREQNEW00000001.deep-hl", { timeout: 8000 }).catch(() => {});
  ok(await page.locator("#screen-requests.active").count() === 1, "?tab=requests opens Requests");
  ok(await page.locator("#req-recREQNEW00000001.deep-hl").count() === 1, "the request is pointed out");
  ok(!/tab=|req=/.test(page.url()), `link tidied from the address bar (${page.url()})`);

  // Admin already open: the service worker posts the tapped notification's link.
  await page.waitForFunction(() => window.__push.listeners.length > 0);
  await page.evaluate(() => window.__push.listeners.forEach(fn => fn({ data: { type: "open-url", url: "/admin?g=kallah&tab=loans&loan=recLOANACT0000001" } })));
  await page.waitForSelector("#loan-row-recLOANACT0000001.deep-hl", { timeout: 8000 }).catch(() => {});
  ok(await page.locator("#screen-loans.active").count() === 1, "tap while open → Loans tab");
  ok(await page.locator("#loan-row-recLOANACT0000001.deep-hl").count() === 1 && await page.locator("#loan-panel-recLOANACT0000001.open").count() === 1, "the loan is pointed out and opened");

  // A notification for another of my gemachs reloads into that gemach.
  await Promise.all([page.waitForURL(/g=other/), page.evaluate(() => window.__push.listeners.forEach(fn => fn({ data: { type: "open-url", url: "/admin?g=other&tab=requests" } })))]);
  await page.waitForFunction(() => localStorage.getItem("gemach_slug") === "other" && document.querySelector("#screen-requests.active"), null, { timeout: 8000 }).catch(() => {});
  ok(await page.evaluate(() => localStorage.getItem("gemach_slug")) === "other" && await page.locator("#screen-requests.active").count() === 1, "other gemach → reload into it, on Requests");
  ok(!state.errors.length, "no page errors: " + state.errors.join(" | "));
  await ctx.close();
}

// 6. The service worker (site/admin-sw.js): shows the message, and a tap opens only our own admin page.
{
  const vm = await import("node:vm");
  const code = fs.readFileSync(new URL("../../site/admin-sw.js", import.meta.url), "utf8");
  const handlers = {}, shown = [], posted = [], opened = [];
  let windows = [], badge = 0;
  const self = {
    location: { origin: "https://whgemachs.org" },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async u => { opened.push(u); } },
    registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); } },
    navigator: { setAppBadge: async () => { badge++; } },
  };
  vm.runInNewContext(code, { self, URL, Promise, Date, console });
  const run = async (type, ev) => { let p; handlers[type]({ ...ev, waitUntil: x => { p = x; } }); await p; };
  const pushEv = d => ({ data: { json: () => d, text: () => JSON.stringify(d) } });
  await run("push", pushEv({ title: "New request · Kallah Gemach", body: "1 item · needed Sun, Oct 18", url: "/admin?g=kallah&tab=requests&req=recX", tag: "request-R-1", event: "request" }));
  const n = shown.at(-1);
  ok(n.title === "New request · Kallah Gemach" && n.body === "1 item · needed Sun, Oct 18" && n.tag === "request-R-1" && n.renotify === true, "SW: shows title, body, tag");
  ok(n.badge === "/assets/brand/wh-gemachs-badge-96.png" && n.icon === "/assets/brand/wh-gemachs-icon-192.png" && badge === 1, "SW: icon, Android badge, app-icon dot for new requests");
  await run("push", pushEv({ title: "x", url: "https://evil.example/phish" }));
  ok(shown.at(-1).data.url === "/admin", "SW: a link to another site is replaced by /admin");
  const close = { closed: 0 };
  const clickEv = url => ({ notification: { data: { url }, close() { close.closed++; } } });
  await run("notificationclick", clickEv("/admin?g=kallah&tab=loans&loan=recL"));
  ok(opened.at(-1) === "/admin?g=kallah&tab=loans&loan=recL" && close.closed === 1, "SW: tap with admin closed → opens the link");
  let focused = 0;
  windows = [{ url: "https://whgemachs.org/g/kallah", focus: async () => {}, postMessage() { throw new Error("wrong window"); } },
             { url: "https://whgemachs.org/admin", focus: async () => { focused++; }, postMessage: m => posted.push(m) }];
  await run("notificationclick", clickEv("/admin?tab=network"));
  ok(focused === 1 && posted.at(-1)?.type === "open-url" && posted.at(-1).url === "/admin?tab=network" && opened.length === 1, "SW: tap with admin open → focus it and pass the link");
}

await browser.close();
