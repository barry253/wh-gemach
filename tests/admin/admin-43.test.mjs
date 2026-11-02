// Settings → Vacations: list / add / edit / delete (saved right away, not by the Save bar), the bookings already dated
// in a vacation, view-only for volunteers; New reservation's default dates skip a vacation; date fields warn (never block).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };
const todayNY = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = n => { const d = new Date(todayNY() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function setup({ role = "Owner", vacations = [] } = {}) {
  const G = {
    id: "recA", slug: "wh-medical", name: "Dress Gemach", email: "d@example.com", phone: "(516) 555-1234", mode: "Full",
    pickupAddress: "", pickupInstructions: "", templates: { confirm: "x", decline: "x", pickup: "x", appointment: "x" }, rawTemplates: {}, canEdit: role !== "Volunteer",
    primaryContact: "Email", itemAttributes: [], requestStyle: "Dates", availabilityMode: "Now", defaultLoanDays: 7, vacations,
  };
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [], calls = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", d => d.accept());
  await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
  await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
  await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
    const req = r.request(); const p = new URL(req.url()).pathname;
    let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
    calls.push({ method: req.method(), path: p, body });
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role, gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/vacations" && req.method() === "POST") {
      const list = [...body.vacations].sort((a, b) => a.start.localeCompare(b.start));
      if (list.some((v, i) => i && v.start <= list[i - 1].end)) return J({ error: "Two vacations overlap." });
      G.vacations = list;
      return J({ success: true, today: todayNY(), vacations: list,
        conflicts: list.length ? [{ kind: "reservation", name: "Dina Away", what: "pickup", date: list[0].start, ref: { request: "recREQ0000000001" } }] : [] });
    }
    if (p === "/admin/checkout/options") return J({ today: todayNY(), defaultLoanDays: 7, types: [] });
    if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/history") return J({ records: [], offset: null });
    return J([]);
  });
  await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(600);
  return { page, errors, calls, G };
}
const posts = calls => calls.filter(c => c.method === "POST" && c.path === "/admin/vacations");

// ── Owner: add, edit, delete ──
{
  const { page, errors, calls } = await setup();
  await page.click("text=Settings");
  await page.click("#set-tab-vacations");
  await page.waitForSelector("#vac-list");
  ok((await page.textContent("#vac-list")).includes("No vacations coming up"), "empty state");

  await page.click("#vac-add-btn");
  await page.fill("#vac-start", plus(10));
  await page.dispatchEvent("#vac-start", "change");
  ok(await page.inputValue("#vac-end") === plus(10), "last day starts as the first day");
  await page.fill("#vac-end", plus(14));
  ok(await page.isHidden("#settings-savebar"), "typing here doesn't bring up the Save bar");
  await page.click("#vac-save-btn");
  await page.waitForSelector("#vac-row-0");
  ok(JSON.stringify(posts(calls).at(-1).body) === JSON.stringify({ vacations: [{ start: plus(10), end: plus(14) }] }), "saved right away with the whole list");
  ok(/Upcoming/.test(await page.textContent("#vac-row-0")), "listed as upcoming");
  ok(/Already booked during a vacation/.test(await page.textContent("#vac-conflicts")) && /Dina Away/.test(await page.textContent("#vac-conflicts")), "bookings in the vacation are listed");
  await page.screenshot({ path: "shot-vacations.png", fullPage: true });

  // a second one, on now
  await page.click("#vac-add-btn");
  await page.fill("#vac-start", plus(0));
  await page.fill("#vac-end", plus(2));
  await page.click("#vac-save-btn");
  await page.waitForSelector("#vac-row-1");
  ok(/On now/.test(await page.textContent("#vac-row-0")), "the current one is first, marked On now");

  // overlapping → error toast, list unchanged
  await page.click("#vac-row-1 >> text=Edit");
  await page.fill("#vac-start", plus(1));
  await page.click("#vac-save-btn");
  await page.waitForTimeout(300);
  ok(await page.isVisible("#vac-save-btn"), "an overlap keeps the form open");
  await page.fill("#vac-start", plus(11));
  await page.click("#vac-save-btn");
  await page.waitForFunction(() => !document.getElementById("vac-save-btn"));
  ok(JSON.stringify(posts(calls).at(-1).body.vacations[1]) === JSON.stringify({ start: plus(11), end: plus(14) }), "edit replaces that vacation");

  await page.click("#vac-row-0 >> text=Delete");
  await page.waitForFunction(() => !document.getElementById("vac-row-1"));
  ok(posts(calls).at(-1).body.vacations.length === 1, "delete saves the list without it");
  ok(!calls.some(c => c.method === "PATCH" && c.path === "/admin/gemach"), "never goes through the Settings Save");
  ok(!errors.length, "no errors " + errors.join(" | "));
  await page.close();
}

// ── Volunteer: view only ──
{
  const { page, errors } = await setup({ role: "Volunteer", vacations: [{ start: plus(5), end: plus(6) }] });
  await page.click("text=Settings");
  await page.click("#set-tab-vacations");
  await page.waitForSelector("#vac-row-0");
  ok(!(await page.$("#vac-add-btn")) && !(await page.$("#vac-row-0 >> text=Edit")), "volunteers see the list without buttons");
  ok(!errors.length, "no errors " + errors.join(" | "));
  await page.close();
}

// ── New reservation during a vacation: defaults move past it; a vacation day only warns ──
{
  const { page, errors } = await setup({ vacations: [{ start: plus(-1), end: plus(3) }, { start: plus(9), end: plus(12) }] });
  await page.evaluate(() => openNewBooking("reservation"));
  await page.waitForSelector("#nb-from");
  ok(await page.inputValue("#nb-from") === plus(4), "pickup defaults to the day after the vacation");
  ok(await page.inputValue("#nb-until") === plus(13), "return (7 days later, in the next vacation) moves past that one too");
  ok(/after your vacation/.test(await page.textContent("#nb-body")), "says why the date moved");
  ok(!(await page.$("#nb-body .vac-note")), "no warning on the defaults");
  await page.fill("#nb-from", plus(10));
  await page.dispatchEvent("#nb-from", "change");
  ok(/You're on vacation then/.test(await page.textContent("#nb-body .vac-note") || ""), "a vacation day gets a warning");
  ok(await page.isEnabled("#nb-save-btn"), "…but saving isn't blocked");
  await page.screenshot({ path: "shot-vacation-newbooking.png" });
  await page.fill("#nb-from", plus(20));
  await page.dispatchEvent("#nb-from", "change");
  ok(!(await page.$("#nb-from + .vac-note")), "warning goes away outside the vacation");
  ok(!errors.length, "no errors " + errors.join(" | "));
  await page.close();
}
await browser.close();
