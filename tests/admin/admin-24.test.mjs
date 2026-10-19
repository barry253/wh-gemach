// Settings → Requests: "Availability shown as" (Right now / For a date)
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const G = {
  id: "recA", slug: "wh-medical", name: "Dress Gemach", email: "d@example.com", phone: "(516) 555-1234", mode: "Full",
  pickupAddress: "", pickupInstructions: "", templates: { confirm: "x", decline: "x", pickup: "x", appointment: "x" }, rawTemplates: {}, canEdit: true, primaryContact: "Email",
  itemAttributes: [], requestStyle: "Event", availabilityMode: "Now",
};
async function setup() {
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
    if (p === "/admin/gemach" && req.method() === "PATCH") { Object.assign(G, body); return J(G); }
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/history") return J({ records: [], offset: null });
    return J([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("gemach_token", "fake.token.x");
    localStorage.setItem("gemach_slug", "wh-medical");
  });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(600);
  return { page, errors, calls };
}

const { page, errors, calls } = await setup();
const lastPatch = () => calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);

await page.click("text=Settings");
await page.click("#set-tab-requests");
await page.waitForSelector('input[name="set-availabilityMode"]');
ok(await page.isChecked('input[name="set-availabilityMode"][value="Now"]'), "Right now is the default");
ok(await page.isVisible("#availability-wrap"), "shown for an Event-style gemach");

await page.check('input[name="set-availabilityMode"][value="Date"]');
ok(await page.waitForSelector("#settings-savebar", { state: "visible", timeout: 5000 }).then(() => true, () => false), "unsaved bar appears");
await page.evaluate(() => document.getElementById("availability-wrap").scrollIntoView());
await page.screenshot({ path: "shot-availability-settings.png" });
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
let sp = lastPatch();
ok(sp && JSON.stringify(sp.body) === '{"availabilityMode":"Date"}', "PATCH sends only the availability " + JSON.stringify(sp && sp.body));
ok(await page.isChecked('input[name="set-availabilityMode"][value="Date"]'), "choice kept after save");

// saving something else doesn't resend it
const patches = () => calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").length;
const before = patches();
// let the first save finish re-drawing the form before editing again (the save bar is rebuilt while it settles)
await page.waitForFunction(() => { const b = document.getElementById("settings-save-btn"); return !b || (!b.disabled && b.textContent.trim() === "Save") || !document.getElementById("settings-savebar") || document.getElementById("settings-savebar").offsetParent === null; });
// Flaky on CI (Oct 18, 3 timeouts here, never locally): a late redraw could wipe the typed value or the save bar.
// Let pending requests settle, then type and retry if the value was reset; report the form state if it still fails.
await page.waitForLoadState("networkidle").catch(() => {});
const saveReady = () => page.waitForFunction(() => { const b = document.getElementById("settings-save-btn"); return b && b.offsetParent !== null && !b.disabled && b.textContent.trim() === "Save"; }, null, { timeout: 5000 }).then(() => true, () => false);
let ready = false;
for (let i = 0; i < 3 && !ready; i++) {
  await page.fill("#set-defaultLoanDays", "10");
  ready = await saveReady();
}
if (!ready) console.log("save bar state:", JSON.stringify(await page.evaluate(() => {
  const b = document.getElementById("settings-save-btn"), bar = document.getElementById("settings-savebar");
  return { value: document.getElementById("set-defaultLoanDays")?.value, bar: !!bar, barHidden: bar?.hidden, btn: b && { text: b.textContent.trim(), disabled: b.disabled, shown: b.offsetParent !== null },
    settingsActive: document.getElementById("screen-settings")?.classList.contains("active") };
})));
ok(ready, "save bar comes back after editing again");
await page.click("#settings-save-btn");
for (let i = 0; i < 50 && patches() === before; i++) await page.waitForTimeout(100);
await page.waitForTimeout(200);
sp = lastPatch();
ok(sp && !("availabilityMode" in sp.body), "unchanged availability isn't resent " + JSON.stringify(sp && sp.body));

// Appointment gemachs reserve nothing: the choice is hidden
await page.check('input[name="set-requestStyle"][value="Appointment"]');
ok(!(await page.isVisible("#availability-wrap")), "hidden for appointment style");
await page.check('input[name="set-requestStyle"][value="Dates"]');
ok(await page.isVisible("#availability-wrap"), "back for Dates style");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
