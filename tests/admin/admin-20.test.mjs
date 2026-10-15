// Pre-launch guards (Oct 13, 2026): action buttons can't be tapped twice, every failed save is said out loud
// (incl. a dropped connection), a 409 "already handled elsewhere" closes the sheet and reloads the list, and
// default dates are New York's today (not UTC, which is tomorrow after 8 pm).
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const REQ = (n, name, contact) => ({ id: `recREQGUARD00000${n}`, requestId: `R-${n}`, name, phone: "5165551234", email: "x@example.com", preferredContact: contact,
  itemNames: ["Walker"], items: [{ id: "recTYPE0000000001", name: "Walker" }], neededFrom: "2026-11-01", neededUntil: "2026-11-05", openEnded: false,
  receivedAt: new Date().toISOString(), requestType: "Loan" });
const REQS = [REQ(1, "Slow Confirm", "Email"), REQ(2, "Already Gone", "WhatsApp"), REQ(3, "Offline Decline", "Email")];
const LOANS = [{ id: "recLOANGUARD00001", loanId: "L-1", borrowerName: "Back Again", borrowerPhone: "5165553333", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: "2026-10-01" }];
const RES = [{ id: "recRESGUARD000001", loanId: "L-2", borrowerName: "Pick Up", borrowerPhone: "5165554444", borrowerContact: "Phone", itemTypeName: "Walker",
  itemRecId: "recITEM0000000001", itemId: "WK-001", reservationStart: "2026-10-20", reservationEnd: "2026-10-30" }];
const G = { id: "recA", slug: "wh-medical", name: "WH Medical", email: "g@example.com", phone: "5165550000",
  templates: { confirm: "Hi {first_name}", decline: "Sorry {first_name}", pickup: "Pick up", appointment: "See you" }, rawTemplates: {}, canEdit: true };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// 9:30 pm EDT on Oct 20, 2026 = 01:30 UTC on Oct 21
await page.clock.install({ time: new Date("2026-10-21T01:30:00Z") });
const errors = [], calls = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const req = r.request(); const p = new URL(req.url()).pathname;
  calls.push({ method: req.method(), path: p });
  const J = (d, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 3, activeLoans: 1, overdueLoans: 0, upcomingReservations: 1 });
  if (p === "/admin/requests") return J(REQS);
  if (p === "/admin/loans") return J(LOANS);
  if (p === "/admin/reservations") return J(RES);
  if (p === "/admin/appointments") return J([]);
  if (p.endsWith("/recREQGUARD000001/confirm")) { await new Promise(res => setTimeout(res, 400)); return J({ success: true, reservations: [{ id: "x" }] }); }
  if (p.endsWith("/recREQGUARD000002/confirm")) return J({ error: "This request was cancelled by the borrower. Refresh to see the latest.", current: "Cancelled" }, 409);
  if (p.endsWith("/recREQGUARD000003/decline")) return r.abort("internetdisconnected");
  if (p.endsWith("/return")) return r.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" });
  return J([]);
});
await page.addInitScript(() => {
  localStorage.setItem("gemach_token", "fake.token.x");
  localStorage.setItem("gemach_slug", "wh-medical");
  window.__opened = [];
  window.open = u => { window.__opened.push(String(u)); return null; };
});
await page.goto("http://admin.test/admin.html?device=mobile"); // WhatsApp / text flows are phone-only (Oct 2026)
await page.waitForTimeout(600);
await page.evaluate(() => switchTab("requests"));
await page.waitForSelector("#req-recREQGUARD000001");
const toasts = () => page.evaluate(() => [...document.querySelectorAll("body > div")].map(d => d.textContent).filter(t => t && t.length < 300));
const count = re => calls.filter(c => re.test(c.path) && c.method === "POST").length;

// 1. Double tap on Confirm → one request to the server
await page.evaluate(r => openConfirm(r), REQS[0]);
await page.waitForTimeout(150);
await page.evaluate(() => { const b = document.getElementById("confirm-submit-btn"); b.click(); b.click(); b.click(); });
ok(await page.evaluate(() => document.getElementById("confirm-submit-btn").disabled), "button disabled while saving");
await page.waitForTimeout(700);
ok(count(/recREQGUARD000001\/confirm$/) === 1, `one confirm call (got ${count(/recREQGUARD000001\/confirm$/)})`);
ok(!(await page.evaluate(() => document.getElementById("confirm-submit-btn").disabled)), "button usable again afterwards");

// 2. 409 (borrower cancelled meanwhile): message + "don't send" note for WhatsApp, sheet closes, list reloads
const before = calls.filter(c => c.path === "/admin/requests").length;
await page.evaluate(r => openConfirm(r), REQS[1]);
await page.waitForTimeout(150);
if (await page.$(`#confirm-send-by [data-send="whatsapp"]`)) await page.click(`#confirm-send-by [data-send="whatsapp"]`); // Email is the default now
await page.click("#confirm-submit-btn");
await page.waitForTimeout(400);
const t2 = (await toasts()).join(" | ");
ok(/cancelled by the borrower/.test(t2) && /don't send it/.test(t2), "409 explained, WhatsApp message flagged");
ok(!(await page.evaluate(() => document.getElementById("confirm-sheet").classList.contains("open"))), "sheet closed");
ok(calls.filter(c => c.path === "/admin/requests").length > before, "requests list reloaded");

// 3. Connection drops on Decline → "Not saved", sheet stays open to retry
await page.evaluate(r => openDecline(r), REQS[2]);
await page.waitForTimeout(150);
await page.click("#decline-submit-btn");
await page.waitForTimeout(400);
ok((await toasts()).some(t => /Not saved — check your connection/.test(t)), "offline decline says Not saved");
ok(await page.evaluate(() => document.getElementById("decline-sheet").classList.contains("open")), "decline sheet stays open");
await page.evaluate(() => closeSheet("decline-sheet"));

// 4. Default dates are New York's today at 9:30 pm EDT (UTC is already Oct 21)
await page.evaluate(l => openReturn(l), LOANS[0]);
await page.waitForTimeout(150);
ok(await page.inputValue("#return-date") === "2026-10-20", "return date defaults to NY today: " + await page.inputValue("#return-date"));
// an HTML error page from Cloudflare is "Not saved", not a silent failure
await page.click("#return-submit-btn");
await page.waitForTimeout(400);
ok((await toasts()).some(t => /Not saved/.test(t)), "502 HTML page on return → Not saved");
await page.evaluate(() => closeSheet("return-sheet"));
await page.evaluate(r => openPickup(r), RES[0]);
await page.waitForTimeout(300);
ok(await page.inputValue("#pickup-date") === "2026-10-20", "pickup date defaults to NY today: " + await page.inputValue("#pickup-date"));

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
