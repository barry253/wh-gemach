import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname); // screenshots land in tests/test-output
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const REQS = [
  { id: "recREQPC000000001", requestId: "R-301", name: "Two Gowns", phone: "5165551234", email: "tg@example.com", preferredContact: "Email",
    itemNames: ["Navy gown – size 8", "Gold gown – size 10"],
    items: [
      { id: "recTYPEFREE000001", name: "Navy gown – size 8", quantity: null, available: null, owned: null, availability: { status: "ok", free: 1, capacity: 1, needed: 1, backBy: null } },
      { id: "recTYPETAKEN00001", name: "Gold gown – size 10", quantity: null, available: null, owned: null, availability: { status: "none", free: 0, capacity: 1, needed: 1, backBy: "2026-11-10" } },
    ],
    neededFrom: "2026-11-03", neededUntil: "2026-11-06", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan",
    manageUrl: "https://whgemachs.org/r/recREQPC000000001.AAAAAAAAAAAAAAAAAAAAAA" },
];
const G = {
  id: "recA", slug: "wh-medical", name: "Simcha Dress Gemach", email: "gemach@example.com", phone: "(718) 986-7345",
  pickupAddress: "507 Walton Court", pickupInstructions: "In the driveway.",
  templates: { confirm: "Hi {first_name}, great news — we have {items} available for you.\n\nManage or cancel: {manage_link}", decline: "Sorry {first_name}.", pickup: "x", appointment: "x" },
  rawTemplates: {}, canEdit: true,
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
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: REQS.length, activeLoans: 0, overdueLoans: 0, upcomingReservations: 0 });
    if (p === "/admin/requests") return J(REQS);
    if (/\/confirm$/.test(p)) return J({ success: true, reservations: [{ id: "recL1" }], declined: [{ id: "recTYPETAKEN00001", name: "Gold gown – size 10", note: null }] });
    return J([]);
  });
  await page.addInitScript(() => { localStorage.setItem("gemach_token", "fake.token.x"); localStorage.setItem("gemach_slug", "wh-medical"); });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(600);
  return { page, errors, calls };
}

const { page, errors, calls } = await setup();
await page.evaluate(() => switchTab("requests"));
await page.waitForSelector("#requests-list .card");
await page.click("#requests-list .card button.btn-primary");
await page.waitForSelector("#confirm-qty-list .ci-row");

// The taken item starts unticked with the reason; the free one is ticked.
const rows = await page.$$eval("#confirm-qty-list .ci-row", els => els.map(e => ({ text: e.innerText, on: e.querySelector("[data-ci-box]").checked })));
ok(rows.length === 2 && rows[0].on && !rows[1].on, "free item ticked, taken item unticked: " + JSON.stringify(rows.map(r => r.on)));
ok(/Free for these dates/.test(rows[0].text) && /None free for these dates/.test(rows[1].text) && /next due back/.test(rows[1].text), "each row says why: " + rows.map(r => r.text.replace(/\n/g, " / ")).join(" | "));
ok(await page.isVisible('[data-ci-note="recTYPETAKEN00001"]') && !(await page.isVisible('[data-ci-note="recTYPEFREE000001"]')), "note box only on the unticked item");

// The combined message lists what's confirmed, then what isn't (with the note).
await page.fill('[data-ci-note="recTYPETAKEN00001"]', "Try size 12 instead");
let msg = await page.inputValue("#confirm-message");
ok(/we have Navy gown – size 8 available/.test(msg) && !/we have[^\n]*Gold/.test(msg), "confirmed list has only the ticked item: " + msg.replace(/\n/g, " / "));
ok(/Unfortunately we're not able to provide Gold gown – size 10 \(Try size 12 instead\)\./.test(msg), "message says what isn't available, with the note");
ok(/Manage or cancel: https:\/\/whgemachs\.org\/r\/recREQPC000000001/.test(msg), "manage link still in the message");
ok(msg.indexOf("Unfortunately") < msg.indexOf("Manage or cancel"), "not-available paragraph comes before the closing link line");

// Send: only the unticked item is sent as a decision.
await page.evaluate(() => { document.querySelector('[data-send="none"]')?.click(); });
await page.click("#confirm-submit-btn");
await page.waitForTimeout(500);
const post = calls.find(c => /\/confirm$/.test(c.path));
ok(post && JSON.stringify(post.body.items) === JSON.stringify([{ itemTypeId: "recTYPETAKEN00001", confirm: false, note: "Try size 12 instead" }]), "only the unticked item sent: " + JSON.stringify(post?.body?.items));
ok(/Try size 12 instead/.test(post?.body?.message || ""), "the combined message is what gets sent");

await page.close();

// Untick everything: Confirm turns into Decline.
{
  const t = await setup();
  await t.page.evaluate(() => switchTab("requests"));
  await t.page.waitForSelector("#requests-list .card");
  await t.page.click("#requests-list .card button.btn-primary");
  await t.page.waitForSelector("#confirm-qty-list .ci-row");
  await t.page.click('[data-ci-box="recTYPEFREE000001"]');
  ok(!(await t.page.isVisible("#confirm-submit-btn")) && await t.page.isVisible("#confirm-decline-btn"), "all unticked: Confirm hides, Decline instead shows");
  await t.page.click('[data-ci-box="recTYPETAKEN00001"]');
  ok(await t.page.isVisible("#confirm-submit-btn") && !(await t.page.isVisible("#confirm-decline-btn")), "tick one again: back to Confirm");
  await t.page.click('[data-ci-box="recTYPETAKEN00001"]'); // both unticked again
  await t.page.click("#confirm-decline-btn");
  await t.page.waitForTimeout(300);
  ok(await t.page.evaluate(() => document.getElementById("decline-sheet").classList.contains("open")), "Decline instead opens the decline sheet");
  ok(!t.errors.length, "no page errors: " + t.errors.join(" | "));
  await t.page.close();
}
await browser.close();
ok(!errors.length, "no page errors (first page): " + errors.join(" | "));
