// Return reminders: Loans → "Return reminder" fills the gemach's template with the loan's details; Settings edits the template.
import { chromium } from "playwright";
import fs from "node:fs";
const html = fs.readFileSync(new URL("../../admin.html", import.meta.url), "utf8");
process.chdir(new URL("../test-output/", import.meta.url).pathname);
const exe = process.env.CHROMIUM_PATH || "";
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ok = (c, m) => { console.log(c ? "PASS" : "FAIL", m); if (!c) process.exitCode = 1; };

const iso = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const LOANS = [
  { id: "recLOANOVERDUE001", loanId: "L-10", borrowerName: "Moshe Wasserman", borrowerPhone: "5165553333", borrowerContact: "WhatsApp", itemTypeName: "Wheelchair",
    dateBorrowed: iso(-30), expectedReturn: iso(-3), daysOut: 30, overdue: true, manageUrl: "https://whgemachs.org/r/recREQ00000000001.abcdefghijklmnopqrstuv" },
  { id: "recLOANCHAIRS0001", loanId: "L-11", borrowerName: "Leah Stern", borrowerEmail: "leah@example.com", borrowerContact: "Email", itemTypeName: "Folding Chair", isQuantity: true, quantity: 40,
    dateBorrowed: iso(-2), expectedReturn: iso(4), daysOut: 2, overdue: false, manageUrl: null,
    reminderSentAt: new Date(Date.now() - 2 * 86400e3).toISOString(), reminderSentVia: "Email (automatic)" },
];
const G = { id: "recA", slug: "wh-medical", name: "West Hempstead Medical Gemach", pickupAddress: "507 Walton Court", canEdit: true, rawTemplates: {},
  phone: "(718) 986-7345", primaryContact: "Text", themeColor: "#1B3A4B",
  templates: {}, placeholders: ["first_name", "items", "borrowed_date", "due_back", "days_out", "manage_link"] };

const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], calls = [];
page.on("pageerror", e => errors.push(String(e)));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
await page.route("https://accounts.google.com/**", r => r.fulfill({ contentType: "text/javascript", body: "" }));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: "" }));
await page.route("http://admin.test/**", r => r.fulfill({ contentType: "text/html", body: html }));
await page.route("https://wh-gemach.barry253-0f5.workers.dev/**", async r => {
  const rq = r.request(); const p = new URL(rq.url()).pathname;
  let body = null; try { body = JSON.parse(rq.postData() || "null"); } catch {}
  calls.push({ method: rq.method(), path: p, body });
  const J = d => r.fulfill({ contentType: "application/json", body: JSON.stringify(d) });
  if (p === "/admin/me") return J({ email: "b@x", name: "Barry", role: "Owner", gemachs: [{ id: "recA", slug: "wh-medical", name: G.name }] });
  if (p === "/admin/gemach" && rq.method() === "PATCH") { Object.assign(G, body); return J(G); }
  if (p === "/admin/gemach") return J(G);
  if (p === "/admin/dashboard") return J({ newRequests: 0, activeLoans: 2, overdueLoans: 1, upcomingReservations: 0 });
  if (p === "/admin/loans") return J(LOANS);
  if (/\/reminder$/.test(p)) return J({ success: true, reminderSentAt: new Date().toISOString() });
  return J([]);
});
await page.addInitScript(() => {
  localStorage.setItem("gemach_token", "fake.token.x");
  localStorage.setItem("gemach_slug", "wh-medical");
  window.__opened = [];
  window.open = (u) => { window.__opened.push(String(u)); return null; };
  document.addEventListener("click", e => {
    const a = e.target.closest && e.target.closest("a");
    if (a && /^(sms|mailto|tel):/.test(a.getAttribute("href") || "")) { e.preventDefault(); window.__opened.push(a.href); }
  }, true);
});
await page.goto("http://admin.test/admin.html");
await page.waitForTimeout(500);

await page.click(".nav-tab:has-text('Loans')");
await page.waitForSelector("#loans-list .loan-row");
await page.click("#loans-list .loan-row:has-text('Moshe')");
await page.click("button:has-text('Return reminder')");
await page.waitForSelector("#reminder-sheet.open, #reminder-sheet[style*='flex']", { timeout: 3000 }).catch(() => {});
const msg = await page.inputValue("#reminder-message");
ok(/^Hi Moshe, a friendly reminder from the West Hempstead Medical Gemach: the Wheelchair you borrowed on \w{3}, \w{3} \d+ was due back on \w{3}, \w{3} \d+\./.test(msg), "overdue loan: message has the loan's dates: " + msg.split("\n")[0]);
ok(msg.includes("Manage your loan: https://whgemachs.org/r/recREQ00000000001.abcdefghijklmnopqrstuv"), "manage link included");
ok(/due/.test(await page.textContent("#reminder-subtitle")) && /Moshe Wasserman/.test(await page.textContent("#reminder-subtitle")), "subtitle shows who, what, due date");
ok((await page.textContent("#reminder-send-btn")).trim() === "Open WhatsApp", "prefers WhatsApp");
await page.screenshot({ path: "shot-return-reminder.png" });
await page.fill("#reminder-message", msg + "\nP.S. edited");
await page.click("#reminder-send-btn");
await page.waitForTimeout(300);
const opened = await page.evaluate(() => window.__opened);
ok(opened.some(u => u.startsWith("https://wa.me/") && decodeURIComponent(u).includes("P.S. edited")), "WhatsApp opens with the edited message");
const rc = calls.find(c => c.method === "POST" && c.path === "/admin/loans/recLOANOVERDUE001/reminder");
ok(rc && rc.body.via === "whatsapp", "reminder noted on the server: " + JSON.stringify(rc && rc.body));
await page.waitForFunction(() => /Return reminder sent/.test(document.getElementById("loans-list").textContent));
ok(true, "loan shows 'Return reminder sent'");

ok(/Reminded 2d ago/.test(await page.textContent("#loans-list .loan-row:has-text('Leah')")), "row shows when a reminder went out");
// Not yet due, counted item, email only
await page.click("#loans-list .loan-row:has-text('Leah')");
await page.click("#loans-list button:has-text('Return reminder') >> nth=1").catch(async () => { await page.click("button:has-text('Return reminder') >> visible=true"); });
const m2 = await page.inputValue("#reminder-message");
ok(/the Folding Chair × 40 you borrowed on .* is due back on /.test(m2) && !/Manage your loan/.test(m2), "due soon: 'is due back on', no link when there's none: " + m2.split("\n")[0]);
ok((await page.textContent("#reminder-send-btn")).trim() === "Open email", "email-only borrower: email");
ok(/Last reminder emailed automatically 2d ago/.test(await page.textContent("#reminder-last")), "sheet says the last one was automatic");
await page.click("#reminder-sheet .btn-ghost");

await page.click("#loans-list .loan-row:has-text('Leah')");
ok(/Return reminder emailed automatically 2d ago/.test(await page.textContent("#loans-list")), "panel says how it was sent");
await page.screenshot({ path: "shot-loans-reminded.png" });
// Settings: the template is editable
await page.click(".nav-tab:has-text('Settings')");
await page.click("#set-tab-messages");
await page.click("#tpl-returnReminder summary");
await page.waitForSelector("#set-returnReminderMessage");
ok(/\{due_back\}/.test(await page.getAttribute("#set-returnReminderMessage", "placeholder")), "Settings shows the Return reminder template (default as placeholder)");
ok(!(await page.isChecked("#set-autoReminders")) && await page.inputValue("#set-reminderDaysBefore") === "2" && await page.inputValue("#set-reminderRepeatDays") === "7", "auto reminders: off, 2 days before, every 7 days by default");
await page.check("#set-autoReminders");
await page.fill("#set-reminderDaysBefore", "3");
await page.fill("#set-reminderRepeatDays", "5");
await page.evaluate(() => document.getElementById("settings-sec-return-reminders").scrollIntoView());
await page.screenshot({ path: "shot-settings-reminders.png" });
await page.fill("#set-returnReminderMessage", "Hi {first_name}, please return the {items} — it {due_back}.");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
const sp = calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);
ok(sp && sp.body.returnReminderMessage === "Hi {first_name}, please return the {items} — it {due_back}.", "template saved");
ok(sp && sp.body.autoReminders === true && sp.body.reminderDaysBefore === 3 && sp.body.reminderRepeatDays === 5, "auto reminder settings saved: " + JSON.stringify(sp && sp.body));

// Settings areas: four tabs, one save bar for all, dots on areas with changes, discard, leave warning
ok((await page.$$eval(".set-tab", b => b.map(x => x.innerText.trim()))).join("|") === "Profile|Your page|Requests|Messages", "four areas (short names on a phone)");
ok(await page.$eval(".set-tabs", el => el.scrollWidth <= el.clientWidth + 1), "all four tabs fit on a phone " + await page.$eval(".set-tabs", el => el.scrollWidth + "/" + el.clientWidth + " " + [...el.children].map(c => Math.round(c.getBoundingClientRect().width)).join(",")));
ok(await page.isHidden("#settings-savebar"), "no save bar after saving");
await page.click("#set-tab-profile");
ok(await page.isVisible("#set-name") && await page.isHidden("#set-returnReminderMessage") && await page.isHidden("#set-pickupAddress"), "only the chosen area shows");
await page.fill("#set-tagline", "Changed tagline");
await page.waitForTimeout(50);
ok(await page.isVisible("#settings-savebar") && (await page.textContent("#settings-dirty-msg")).trim() === "Profile", "save bar appears, names the area");
ok(await page.isVisible("#set-tab-profile .set-dot") && await page.isHidden("#set-tab-messages .set-dot"), "dot on the changed area only");
await page.click("#set-tab-requests");
await page.fill("#set-pickupAddress", "12 New Street");
await page.waitForTimeout(50);
ok((await page.textContent("#settings-dirty-msg")).trim() === "Profile, Requests & pickup", "changes in two areas listed");
await page.screenshot({ path: "shot-settings-areas.png" });
let dialogs = 0;
page.once("dialog", d => { dialogs++; d.dismiss(); });
await page.click(".nav-tab:has-text('Loans')");
ok(dialogs === 1 && await page.isVisible("#settings-savebar"), "leaving with unsaved changes asks first; Cancel stays");
await page.click("#settings-savebar button:has-text('Discard')");
ok(await page.isHidden("#settings-savebar") && await page.inputValue("#set-pickupAddress") === "507 Walton Court", "Discard restores saved values");
ok(await page.isVisible("#set-pickupAddress"), "Discard keeps you in the same area");
await page.fill("#set-pickupAddress", "9 Elm Street");
await page.click("#settings-save-btn");
await page.waitForFunction(() => document.body.textContent.includes("Settings saved"));
const ap = calls.filter(c => c.method === "PATCH" && c.path === "/admin/gemach").at(-1);
ok(ap && JSON.stringify(ap.body) === JSON.stringify({ pickupAddress: "9 Elm Street" }), "Save from the bar sends only the change: " + JSON.stringify(ap && ap.body));
await page.reload(); await page.waitForTimeout(500);
await page.click(".nav-tab:has-text('Settings')");
await page.waitForSelector(".set-tab");
ok(await page.isVisible("#set-pickupAddress"), "comes back to the last area");

ok(!errors.length, "no page errors " + errors.join(" | "));
await browser.close();
