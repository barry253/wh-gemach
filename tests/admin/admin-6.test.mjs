import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../.out/", import.meta.url).pathname); // screenshots land in tests/.out
const exe = process.env.CHROMIUM_PATH || ""; // blank = Playwright's own Chromium
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const REQS = [
  { id: "recREQWA000000001", requestId: "R-101", name: "Rivka Klein", phone: "(516) 555-1234", email: "rivka@example.com", preferredContact: "WhatsApp",
    itemNames: ["Knee Scooter"], neededFrom: "2026-09-29", neededUntil: "2026-10-05", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
  { id: "recREQEM000000002", requestId: "R-102", name: "Moshe Adler", phone: "5165559876", email: "moshe@example.com", preferredContact: "Email",
    itemNames: ["Walker"], neededFrom: "2026-09-30", neededUntil: null, openEnded: true, receivedAt: "not a date", requestType: "Loan" },
  { id: "recREQNP000000003", requestId: "R-103", name: "No Pref", phone: "5165550000", email: "np@example.com", preferredContact: null,
    itemNames: ["Crutches"], neededFrom: null, neededUntil: null, openEnded: false, receivedAt: null, requestType: "Loan" },
  { id: "recREQSM000000004", requestId: "R-104", name: "Sara Text", phone: "5165551111", email: null, preferredContact: "SMS",
    itemNames: ["Cane"], neededFrom: "2026-10-01", neededUntil: "", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
  { id: "recREQPH000000005", requestId: "R-105", name: "Phil Phone", phone: "5165552222", email: null, preferredContact: "Phone",
    itemNames: ["Cane"], neededFrom: "garbage", neededUntil: "2026-13-45", openEnded: false, receivedAt: new Date().toISOString(), requestType: "Loan" },
];
const LOANS = [{ id: "recLOAN0000000001", loanId: "L-1", borrowerName: "Loan Nodate", borrowerPhone: "5165553333", borrowerContact: "Text", itemTypeName: "Walker", dateBorrowed: null, daysOut: null }];
const RES = [
  { id: "recRES00000000001", loanId: "L-2", borrowerName: "Res Nodate", borrowerPhone: "5165554444", borrowerEmail: "res@example.com", borrowerContact: "WhatsApp", itemTypeName: "Crib", reservationStart: null, reservationEnd: null },
  { id: "recRES00000000002", loanId: "L-3", borrowerName: "Res Bad", borrowerPhone: "", borrowerEmail: "rb@example.com", borrowerContact: "Phone", itemTypeName: "Crib", reservationStart: "2026-10-02", reservationEnd: "bad" },
];
const APPTS = [{ id: "recREQAP000000009", requestId: "R-109", name: "Appt Person", phone: "5165556666", email: "ap@example.com", preferredContact: "Email", appointmentAt: "2026-10-04T23:00:00.000Z", itemNames: [] }];
const HIST = { records: [{ id: "recH1", timestamp: "nope", eventType: "Loan Created", borrower: "X" }, { id: "recH2", timestamp: null, eventType: "Item Returned" }], offset: null };
const G = {
  id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", email: "gemach@example.com", phone: "(718) 986-7345",
  pickupAddress: "507 Walton Court", pickupInstructions: "In the driveway.",
  templates: { confirm: "Hi {first_name}, {items} is ready from the {gemach}.", decline: "Sorry {first_name}.", pickup: "Hi {first_name}, pick up at {pickup_address}.", appointment: "Hi {first_name}, see you {appointment_time}." },
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
    const req = r.request(); const u = new URL(req.url()); const p = u.pathname;
    let body = null; try { body = JSON.parse(req.postData() || "null"); } catch {}
    calls.push({ method: req.method(), path: p, body, gemach: req.headers()["x-gemach"] });
    const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
    if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
    if (p === "/admin/gemach") return J(G);
    if (p === "/admin/dashboard") return J({ newRequests: REQS.length, activeLoans: 1, overdueLoans: 0, upcomingReservations: 2 });
    if (p === "/admin/requests") return J(REQS);
    if (p === "/admin/loans") return J(LOANS);
    if (p === "/admin/reservations") return J(RES);
    if (p === "/admin/appointments") return J(APPTS);
    if (p === "/admin/history") return J(HIST);
    if (/\/confirm$|\/decline$/.test(p)) return J({ success: true });
    return J([]);
  });
  await page.addInitScript(() => {
    localStorage.setItem("gemach_token", "fake.token.x");
    localStorage.setItem("gemach_slug", "wh-medical");
    window.__opened = [];
    window.open = (u, t, f) => { window.__opened.push({ how: "window.open", url: String(u) }); return null; };
    document.addEventListener("click", e => {
      const a = e.target.closest && e.target.closest("a");
      if (a && /^(sms|mailto|tel):/.test(a.getAttribute("href") || "")) { e.preventDefault(); window.__opened.push({ how: "anchor", url: a.href }); }
    }, true);
  });
  await page.goto("http://admin.test/admin.html");
  await page.waitForTimeout(600);
  return { page, errors, calls };
}
const bodyText = page => page.evaluate(() => document.body.innerText);

const { page, errors, calls } = await setup();
await page.evaluate(() => switchTab("requests"));
await page.waitForSelector("#req-recREQWA000000001");

// Cards: only the preferred method
const cardInfo = await page.$$eval("#requests-list .card", cs => cs.map(c => ({
  id: c.id,
  btns: [...c.querySelectorAll("[data-contact]")].map(a => [a.dataset.contact, a.textContent.trim(), a.getAttribute("href")]),
  caption: c.querySelector(".contact-caption")?.textContent,
  meta: c.querySelector(".card-meta").innerText,
})));
const byId = Object.fromEntries(cardInfo.map(c => [c.id.replace("req-", ""), c]));
const wa = byId.recREQWA000000001, em = byId.recREQEM000000002, np = byId.recREQNP000000003, sm = byId.recREQSM000000004, ph = byId.recREQPH000000005;
ok(wa.btns.length === 1 && wa.btns[0][1] === "Message on WhatsApp" && wa.btns[0][2] === "https://wa.me/15165551234" && wa.caption === "Prefers WhatsApp", "WhatsApp card: one button + caption " + JSON.stringify(wa.btns));
ok(em.btns.length === 1 && em.btns[0][1] === "Email" && em.btns[0][2] === "mailto:moshe@example.com" && em.caption === "Prefers email", "Email card " + JSON.stringify(em.btns));
ok(sm.btns.length === 1 && sm.btns[0][1] === "Send a text" && sm.btns[0][2] === "sms:5165551111" && sm.caption === "Prefers text messages", "SMS card " + JSON.stringify(sm.btns));
ok(ph.btns.length === 1 && ph.btns[0][1] === "Call" && ph.btns[0][2] === "tel:5165552222", "Phone card " + JSON.stringify(ph.btns));
ok(JSON.stringify(np.btns.map(b => b[1])) === JSON.stringify(["Message on WhatsApp", "Send a text", "Call", "Email"]) && np.caption === "No contact preference given", "no-pref card shows available methods " + JSON.stringify(np.btns));
ok(!cardInfo.some(c => c.btns.some(b => /★|^SMS$/.test(b[1]))), "no ★ / bare SMS labels");
ok(wa.meta.includes("Needed Sep 29 · return ~Oct 5"), "dates line with return: " + wa.meta);
ok(em.meta.includes("Needed Sep 30 · open-ended"), "open-ended line");
ok(sm.meta.includes("Needed Oct 1 · return date not given"), "no return line");
ok(np.meta.includes("Needed date not given · return date not given"), "no dates at all");
ok(ph.meta.includes("Needed date not given · return date not given"), "garbage dates handled: " + ph.meta);
await page.locator("#req-recREQWA000000001").screenshot({ path: "shot-r5-request-card.png" });

// Confirm sheet — WhatsApp case
await page.evaluate(() => openConfirm(rec("req", "recREQWA000000001")));
await page.waitForTimeout(200);
const opts = await page.$$eval("#confirm-send-by [data-send]", bs => bs.map(b => [b.dataset.send, b.textContent, b.classList.contains("active")]));
ok(JSON.stringify(opts.map(o => o[1])) === JSON.stringify(["WhatsApp", "Text message", "Email", "Don't send"]) && opts[0][2], "confirm choices, WhatsApp default " + JSON.stringify(opts));
ok(await page.textContent("#confirm-submit-btn") === "Confirm & open WhatsApp", "WA button label");
ok((await page.textContent("#confirm-send-by .send-by-help")).includes("Opens WhatsApp on this device"), "WA helper");
await page.screenshot({ path: "shot-r5-confirm-whatsapp.png" });
for (const [v, lbl] of [["sms", "Confirm & open text message"], ["email", "Confirm & email"], ["none", "Confirm without message"]]) {
  await page.click(`#confirm-send-by [data-send="${v}"]`);
  ok(await page.textContent("#confirm-submit-btn") === lbl, `label for ${v}: ${lbl}`);
}
await page.click(`#confirm-send-by [data-send="whatsapp"]`);
await page.fill("#confirm-message", "Hi Rivka & co — ready?");
let n = calls.length;
await page.click("#confirm-submit-btn");
await page.waitForTimeout(300);
let opened = await page.evaluate(() => window.__opened.splice(0));
ok(opened.length === 1 && opened[0].how === "window.open" && opened[0].url === "https://wa.me/15165551234?text=" + encodeURIComponent("Hi Rivka & co — ready?"), "wa.me opened with message " + JSON.stringify(opened));
let post = calls.slice(n).find(c => c.path.endsWith("/confirm"));
ok(post && post.body.sendMessage === false && post.gemach === "wh-medical", "WA confirm posts sendMessage:false " + JSON.stringify(post?.body));

// Confirm — Email default for email-preferring borrower
await page.evaluate(() => openConfirm(rec("req", "recREQEM000000002")));
await page.waitForTimeout(200);
await page.waitForTimeout(2700);
ok(await page.textContent("#confirm-submit-btn") === "Confirm & email", "Email default label");
const help = await page.textContent("#confirm-send-by .send-by-help");
ok(help === "Sent from noreply@whgemachs.org to moshe@example.com; replies go to gemach@example.com.", "email helper: " + help);
await page.screenshot({ path: "shot-r5-confirm-email.png" });
n = calls.length;
await page.click("#confirm-submit-btn");
await page.waitForTimeout(300);
opened = await page.evaluate(() => window.__opened.splice(0));
post = calls.slice(n).find(c => c.path.endsWith("/confirm"));
ok(!opened.length && post.body.sendMessage === true && post.body.message.includes("Moshe"), "email confirm: no link opened, sendMessage:true");

// Decline — SMS borrower (no email → no Email choice)
await page.evaluate(() => openDecline(rec("req", "recREQSM000000004")));
await page.waitForTimeout(200);
const dopts = await page.$$eval("#decline-send-by [data-send]", bs => bs.map(b => b.dataset.send));
ok(JSON.stringify(dopts) === JSON.stringify(["whatsapp", "sms", "none"]), "decline offers only possible methods " + dopts);
ok(await page.textContent("#decline-submit-btn") === "Decline & open text message", "decline SMS default label");
n = calls.length;
await page.click("#decline-submit-btn");
await page.waitForTimeout(300);
opened = await page.evaluate(() => window.__opened.splice(0));
post = calls.slice(n).find(c => c.path.endsWith("/decline"));
ok(opened.length === 1 && opened[0].how === "anchor" && opened[0].url.startsWith("sms:5165551111?&body=Sorry%20Sara."), "sms: link carries message " + JSON.stringify(opened));
ok(post.body.sendMessage === false, "decline SMS sendMessage:false");

// Decline — Don't send
await page.evaluate(() => openDecline(rec("req", "recREQNP000000003")));
await page.click(`#decline-send-by [data-send="none"]`);
ok(await page.textContent("#decline-submit-btn") === "Decline without message", "decline none label");
n = calls.length;
await page.click("#decline-submit-btn");
await page.waitForTimeout(300);
opened = await page.evaluate(() => window.__opened.splice(0));
post = calls.slice(n).find(c => c.path.endsWith("/decline"));
ok(!opened.length && post.body.sendMessage === false, "don't send: nothing opened, sendMessage:false");

// Appointment sheet labels
await page.evaluate(() => openAppointmentConfirm({ ...rec("req", "recREQEM000000002"), requestType: "Appointment" }));
await page.waitForTimeout(200);
ok(await page.textContent("#appointment-submit-btn") === "Schedule & email", "appointment email label");
ok((await page.textContent("#appointment-send-by .send-by-help")).includes("calendar invite"), "appointment helper mentions invite");
await page.click(`#appointment-send-by [data-send="whatsapp"]`);
ok(await page.textContent("#appointment-submit-btn") === "Schedule & open WhatsApp", "appointment WA label");
await page.evaluate(() => closeSheet("appointment-sheet"));

// Loans / reservations / appointments / history — no Invalid Date, preferred-only buttons
await page.evaluate(() => switchTab("loans"));
await page.waitForTimeout(400);
const loanBtns = await page.$$eval("#loans-list [data-contact]", as => as.map(a => a.textContent.trim()));
ok(JSON.stringify(loanBtns) === JSON.stringify(["Send a text"]), "loan (Text pref) shows only Send a text " + loanBtns);
await page.evaluate(() => switchTab("reservations"));
await page.waitForTimeout(400);
const resBtns = await page.$$eval("#reservations-list .loan-actions-panel", ps => ps.map(p => [...p.querySelectorAll("[data-contact]")].map(a => a.textContent.trim())));
ok(JSON.stringify(resBtns) === JSON.stringify([["Message on WhatsApp"], ["Email"]]), "reservation buttons (WA pref; Phone pref without phone → available) " + JSON.stringify(resBtns));
const apptBtns = await page.$$eval("#appointments-list [data-contact]", as => as.map(a => a.textContent.trim()));
ok(JSON.stringify(apptBtns) === JSON.stringify(["Email"]), "appointment card preferred only " + apptBtns);
const resDates = await page.$$eval("#reservations-list .loan-row-date", s => s.map(x => x.textContent));
ok(JSON.stringify(resDates) === JSON.stringify(["Dates TBD", "Oct 2 → Open return date"]), "reservation dates guarded " + resDates);
// Pickup instructions sheet
await page.evaluate(() => openPickupInstructions(rec("res", "recRES00000000002")));
await page.waitForTimeout(200);
const popts = await page.$$eval("#pickup-instructions-send-by [data-send]", bs => bs.map(b => b.dataset.send));
ok(JSON.stringify(popts) === JSON.stringify(["email"]) && await page.textContent("#pickup-instructions-send-btn") === "Open email", "pickup: email only → Open email " + popts);
await page.click("#pickup-instructions-send-btn");
opened = await page.evaluate(() => window.__opened.splice(0));
ok(opened.length === 1 && opened[0].url.startsWith("mailto:rb@example.com?body=Hi%20Res%2C%20pick%20up%20at%20507%20Walton%20Court"), "pickup mailto with message " + JSON.stringify(opened));
await page.evaluate(() => openPickupInstructions(rec("res", "recRES00000000001")));
ok(await page.textContent("#pickup-instructions-send-btn") === "Open WhatsApp", "pickup WA label");
await page.click(`#pickup-instructions-send-by [data-send="sms"]`);
ok(await page.textContent("#pickup-instructions-send-btn") === "Open text message", "pickup SMS label");
n = calls.length;
await page.click("#pickup-instructions-send-btn");
opened = await page.evaluate(() => window.__opened.splice(0));
ok(opened[0]?.url.startsWith("sms:5165554444?&body=") && calls.length === n, "pickup sms opened, no API call");
await page.evaluate(() => switchTab("history"));
await page.waitForTimeout(400);
let allText = "";
for (const t of ["requests", "loans", "reservations", "history"]) { await page.evaluate(x => switchTab(x), t); await page.waitForTimeout(350); allText += await bodyText(page); }
ok(!/Invalid Date|NaN/.test(allText + html.match(/fmt\(r\.neededUntil \|\| "\?"\)/)), "no Invalid Date / NaN anywhere");
ok(!errors.length, "no console/page errors " + errors.join(" | "));
await browser.close();
