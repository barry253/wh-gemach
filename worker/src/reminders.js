// Part of the Gemach Network worker (see index.js for routes and env vars).
import { logEvents } from "./activity.js";
import { Q, fetchByIds, firstLink, linkedId } from "./records.js";
import { makeDb } from "./db.js";
import { sendAlert } from "./alerts.js";
import { T } from "./config.js";
import { DAY_MS, addDays, dateToUtcMs, isValidDate, nyToday } from "./dates.js";
import { buildEmailHtml } from "./email.js";
import { saveSentEmails, sendBorrowerEmail } from "./sentemails.js";
import { GEMACH_FIELDS, gemachFromRecord } from "./gemachs.js";
import { json } from "./http.js";
import { LOAN_LIST_FIELDS, loadLoanRelations, loanQtyInfo } from "./loans.js";
import { manageUrl } from "./manage.js";
import { effectiveTemplates, emailSignature } from "./settings.js";
import { expandItems, itemsInline, itemsOnOwnLine } from "./itemlist.js";

// ─── Automatic return reminders (daily cron) ──────────────────────────────────
// For each gemach with "Auto Reminders" on: email borrowers who gave an email address, using the gemach's
// Return reminder template filled with the loan's details —
//   • once, N days before the loan's Expected Return ("Reminder Days Before", default 2; 0 = on the day), and
//   • once overdue: the day after the due date, then every M days ("Reminder Repeat Days", default 7; 0 = never).
// Any reminder (automatic or sent by an admin) stamps Loans."Reminder Sent At", which is what keeps this
// from repeating: at most one per loan per day, and a manual reminder counts.
// Loans without an Expected Return (open-ended) are never reminded automatically.
// Several items borrowed together (same request, due date and kind) get one email listing them all.

/** "Fri, Oct 9" from "2026-10-09" (calendar date). */
const dayLabel = s => (isValidDate(s)
  ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(dateToUtcMs(s)))
  : "");
const daysBetween = (a, b) => Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / DAY_MS);

/**
 * Which reminder (if any) is due today for a loan: "before", "overdue" or null.
 * expected / today / lastSent are New York calendar dates ("YYYY-MM-DD"); lastSent may be null.
 */
function reminderDue({ expected, today, lastSent, before, repeat }) {
  if (!isValidDate(expected) || !isValidDate(today)) return null;
  if (lastSent === today) return null;                        // never twice in a day
  const untilDue = daysBetween(today, expected);
  if (untilDue > before) return null;                         // too early
  if (untilDue >= 0) {                                        // in the "before" window
    return !lastSent || lastSent < addDays(expected, -before) ? "before" : null;
  }
  if (!repeat) return null;                                   // overdue reminders turned off
  if (!lastSent || lastSent <= expected) return "overdue";    // first one: the day after the due date
  return daysBetween(lastSent, today) >= repeat ? "overdue" : null;
}

// Same rules as the admin page's fillTemplate (admin.html): a sentence whose only substance was a blank
// info placeholder is dropped, "… at {x}" loses " at {x}" when x is blank, spacing is tidied.
const INFO_PLACEHOLDERS = new Set(["pickup_address", "pickup_instructions", "hours", "phone", "email", "deposit_info", "event_date",
  "appointment_time", "manage_link", "borrowed_date", "due_back", "days_out", "policies"]);
// {items} may be a list: on a line by itself it becomes one bullet per item, inside a sentence "A, B and C".
function fillTemplate(template, vars) {
  if (Array.isArray(vars.items)) {
    const x = expandItems(template, vars.items);
    template = x.template;
    vars = { ...vars, items: x.inline };
  }
  const has = k => Object.prototype.hasOwnProperty.call(vars, k);
  const val = k => String(vars[k] ?? "").trim();
  const isBlank = k => has(k) && !val(k);
  const out = [];
  for (const line of String(template || "").replace(/\r\n?/g, "\n").split("\n")) {
    const hadPlaceholder = /\{\w+\}/.test(line);
    const segments = [];
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const m = sentence.match(/^(\{\w+\})\s+(.+)$/);
      if (m) segments.push(m[1], m[2]); else segments.push(sentence);
    }
    const kept = [];
    for (let seg of segments) {
      const keys = [...seg.matchAll(/\{(\w+)\}/g)].map(x => x[1]);
      const blankInfo = keys.filter(k => INFO_PLACEHOLDERS.has(k) && isBlank(k));
      const filledKeys = keys.filter(k => has(k) && val(k));
      const words = seg.replace(/\{\w+\}/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
      if (blankInfo.length && !filledKeys.length && words.length <= 5) continue;
      seg = seg.replace(/\s*\b(?:at|in|on|from|by|to|via)\s+\{(\w+)\}/gi, (m0, k) => (isBlank(k) ? "" : m0));
      seg = seg
        .replace(/\{(\w+)\}/g, (m0, k) => (has(k) ? val(k) : m0))
        .replace(/[ \t]{2,}/g, " ")
        .replace(/ +([.,!?;:])/g, (m0, p, i) => (i > 0 ? p : m0))
        .replace(/([.,!?;:])[.,;:]+/g, "$1")
        .trim();
      if (seg) kept.push(seg);
    }
    const filled = kept.join(" ");
    if (hadPlaceholder && !filled) continue;
    out.push(filled);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** {due_back}: "is due back on Fri, Oct 9" / "is due back today" / "was due back on Fri, Oct 2" ("are" / "were" for several items). */
function dueBackText(expected, today, plural = false) {
  if (!isValidDate(expected)) return "";
  const [now, past] = plural ? ["are", "were"] : ["is", "was"];
  if (expected === today) return `${now} due back today`;
  return `${expected > today ? now : past} due back on ${dayLabel(expected)}`;
}

/** The Return reminder text for one loan (the gemach's template, or the default). */
function reminderMessage(g, { firstName, items, borrowed, expected, today, link, plural = false }) {
  let tpl = effectiveTemplates(g).returnReminder;
  // "are due back" only reads right when {items} sits in the sentence; the list layout says "Your loan is due back".
  if (itemsOnOwnLine(tpl)) plural = false;
  if (link && !tpl.includes("{manage_link}")) tpl = tpl.trimEnd() + "\n\nManage your loan: {manage_link}";
  return fillTemplate(tpl, {
    first_name: firstName || "",
    items: Array.isArray(items) ? items : [items || "item"], // one bullet per item when {items} is on its own line
    gemach: g.name || "gemach",
    pickup_address: g.pickupAddress || "", pickup_instructions: g.pickupInstructions || "",
    hours: g.hours || "", phone: g.phone || "", email: g.email || "",
    deposit_info: g.depositRequired ? (g.depositInfo || "") : "",
    policies: g.policies || "",
    event_date: "", appointment_time: "",
    manage_link: link || "",
    borrowed_date: dayLabel(borrowed),
    due_back: dueBackText(expected, today, plural),
    days_out: isValidDate(borrowed) ? String(Math.max(0, daysBetween(borrowed, today))) : "",
  });
}

/**
 * The items of one reminder, one label each: ["Chairs × 58", "Tables × 6"], ["Wheelchair × 2", "Walker"].
 * The same item type on several loans (two numbered wheelchairs) is counted together.
 */
function itemsList(loans) {
  const byName = new Map();
  for (const x of loans) {
    const cur = byName.get(x.typeName) || { n: 0, isQuantity: false };
    cur.n += x.qty || 1;
    cur.isQuantity = cur.isQuantity || x.isQuantity;
    byName.set(x.typeName, cur);
  }
  const parts = [...byName].map(([name, v]) => (v.isQuantity || v.n > 1 ? `${name} × ${v.n}` : name));
  return parts.length ? parts : ["item"];
}
/** "Chairs × 58 and Tables × 6" (subject lines, and templates that use {items} inside a sentence). */
const itemsLabel = loans => itemsInline(itemsList(loans));

const VALID_EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]+$/;

// Workers Free allows 50 requests to outside services (Resend) per run: send at most this many reminders a
// day; the rest stay due and go out tomorrow (and the Network Admin is told).
const MAX_EMAILS_PER_RUN = 40;

/**
 * Run the day's reminders. dryRun: work out who would get one, send nothing, change nothing.
 * Returns { today, sent: [...], failed: [...], noEmail, skippedTest, deferred, errors } (dry run: "sent" = would send).
 * Reads everything in a few queries for the whole network (gemachs, due loans, their requests / borrowers /
 * items / types) and writes the "sent" stamps and History in one go, so the run stays far below the 50
 * database queries per invocation however many gemachs use reminders. One loan's problem doesn't stop the rest.
 */
async function runReminders(env, ctx, { now = Date.now(), dryRun = false, db = makeDb(env) } = {}) {
  const today = nyToday(now);
  const out = { today, dryRun, sent: [], failed: [], noEmail: 0, skippedTest: 0, deferred: 0, errors: [] };
  const gemachs = (await db.listAll(T.GEMACHS, { where: [Q.isTrue("Active"), Q.isTrue("Auto Reminders"), Q.nonEmpty("Slug")], fields: GEMACH_FIELDS }))
    .map(gemachFromRecord);
  const byId = new Map(gemachs.map(g => [g.id, g]));
  const due = [];
  if (gemachs.length) {
    const loans = await db.listAll(T.LOANS, { where: [Q.eq("Status", "Active"), Q.notBlank("Expected Return")], fields: [...LOAN_LIST_FIELDS, "Gemach"] });
    for (const l of loans) {
      const links = (l.fields["Gemach"] || []).map(linkedId);
      const g = links.length === 1 ? byId.get(links[0]) : null;
      if (!g) continue;
      const f = l.fields;
      const lastSent = f["Reminder Sent At"] ? nyToday(Date.parse(f["Reminder Sent At"])) : null;
      const kind = reminderDue({ expected: f["Expected Return"], today, lastSent, before: g.reminderDaysBefore, repeat: g.reminderRepeatDays });
      if (kind) due.push({ l, g, kind });
    }
  }
  const stamps = [], events = new Map(); // gemach id -> History rows
  const copies = []; // { row: Sent Emails row, evs: its History rows }
  if (due.length) {
    // Loans from requests sent through a gemach's test link never get real reminders.
    const srcIds = due.map(d => linkedId(firstLink(d.l.fields["Source Request"]))).filter(Boolean);
    const testIds = new Set((await fetchByIds(db, T.REQUESTS, srcIds, { fields: ["Test"] })).filter(r => r.fields.Test).map(r => r.id));
    const { borrowerMap, itemMap, itemTypeMap, typeInfo } = await loadLoanRelations(db, null, due.map(d => d.l), { includeItemToReserve: true });
    // 1. Work out each loan's part, then 2. group the loans of one borrowing (same gemach, borrower email, request,
    // due date and kind) so the borrower gets one email listing everything, not one per item.
    const groups = new Map();
    for (const { l, g, kind } of due) {
      const f = l.fields;
      try {
        const q = loanQtyInfo(f, typeInfo);
        if (q.isAddon) continue; // add-ons are bought, not returned
        const src = linkedId(firstLink(f["Source Request"]));
        if (src && testIds.has(src)) { out.skippedTest++; continue; }
        const expected = f["Expected Return"];
        const bId = linkedId(firstLink(f["Borrower"]));
        const b = borrowerMap[bId] || {};
        const email = String(b.email || "").trim();
        if (!VALID_EMAIL.test(email)) { out.noEmail++; continue; }
        const item = itemMap[linkedId(firstLink(f["Item"]))] || {};
        const typeName = item.itemTypeName || itemTypeMap[linkedId(firstLink(f["Item to Reserve"]))] || "item";
        // Loans made in admin without a request: the same borrower's loans picked up the same day count as one borrowing.
        const key = [g.id, email.toLowerCase(), src || `b:${bId}|${f["Date Borrowed"] || ""}`, expected, kind].join("|");
        if (!groups.has(key)) groups.set(key, { g, kind, expected, src, b, email, borrowed: f["Date Borrowed"], loans: [] });
        groups.get(key).loans.push({ l, typeName, item, qty: q.isQuantity && q.quantity ? q.quantity : 1, isQuantity: !!(q.isQuantity && q.quantity) });
      } catch (e) {
        out.errors.push(`${g.slug} · ${f["Loan ID"] || l.id}: ${e.message}`);
      }
    }
    let emails = 0;
    for (const grp of groups.values()) {
      const { g, kind, expected, src, b, email, loans } = grp;
      const loanIds = loans.map(x => x.l.fields["Loan ID"] || x.l.id);
      try {
        const list = itemsList(loans), inline = itemsInline(list);
        const short = inline.length > 60 ? `${list.length} items` : inline; // subject lines stay readable
        const link = src ? await manageUrl(env, src) : null;
        const message = reminderMessage(g, { firstName: String(b.name || "").trim().split(/\s+/)[0], items: list, borrowed: grp.borrowed, expected, today, link, plural: list.length > 1 });
        const entry = { gemach: g.slug, loanId: loanIds.join(", "), loanIds, borrower: b.name || null, email, kind, due: expected };
        if (dryRun) { out.sent.push({ ...entry, message }); continue; }
        if (emails >= MAX_EMAILS_PER_RUN) { out.deferred++; continue; }
        emails++;
        const subject = kind === "overdue" ? `Reminder: please return the ${short} — ${g.name}` : `Reminder: ${short} due back ${dayLabel(expected)} — ${g.name}`;
        // The copies (History → View email) are saved together after the loop: one write per ~9, not one each.
        const { ok, row } = await sendBorrowerEmail(env, db, g, { to: email, subject, text: message + emailSignature(g), html: buildEmailHtml(g, message) }, { kind: "reminder", save: false });
        if (!events.has(g.id)) events.set(g.id, []);
        // History keeps one row per loan (each item's history shows it), all pointing at the one email.
        const logRows = loans.map(({ l, typeName, item }) => {
          const ev = { borrower: b.name || null, itemType: typeName, itemCode: item.itemId || null, loanId: l.fields["Loan ID"] || null, admin: "Automatic" };
          return ok
            ? { ...ev, eventType: "Return Reminder Sent", notes: `Emailed to ${email}${kind === "overdue" ? " (overdue)" : ""}` }
            // Still due, so it's tried again tomorrow; History shows the attempt (View email).
            : { ...ev, eventType: "Return Reminder Failed", notes: `The email to ${email} didn't go through; it will be tried again tomorrow` };
        });
        events.get(g.id).push(...logRows);
        if (row) copies.push({ row, evs: logRows });
        if (!ok) { out.failed.push(entry); continue; }
        stamps.push(...loans.map(x => x.l.id));
        out.sent.push(entry);
      } catch (e) {
        out.errors.push(`${g.slug} · ${loanIds.join(", ")}: ${e.message}`);
      }
    }
  }
  if (!dryRun && stamps.length) {
    try {
      await db.updateMany(T.LOANS, stamps, { "Reminder Sent At": new Date(now).toISOString(), "Reminder Sent Via": "Email (automatic)" });
    } catch (e) {
      out.errors.push(`Couldn't mark ${stamps.length} reminder(s) as sent (they may go out again tomorrow): ${e.message}`);
    }
  }
  if (copies.length) {
    const ids = await saveSentEmails(db, copies.map(x => x.row));
    copies.forEach((x, i) => { if (ids[i]) x.evs.forEach(ev => { ev.emailId = ids[i]; }); });
  }
  if (!dryRun) for (const [gid, evs] of events) logEvents(ctx, db, byId.get(gid), evs);
  console.log(`reminders ${today}${dryRun ? " (dry run)" : ""}: ${out.sent.length} sent, ${out.failed.length} failed, ${out.noEmail} without email` +
    `${out.skippedTest ? `, ${out.skippedTest} test` : ""}${out.deferred ? `, ${out.deferred} left for tomorrow` : ""}${out.errors.length ? `, ${out.errors.length} errors` : ""}`);
  if (!dryRun && (out.failed.length || out.deferred || out.errors.length)) {
    const parts = [];
    if (out.failed.length) parts.push(`These automatic return reminders could not be emailed today (${today}):\n\n` +
      out.failed.map(x => `${x.gemach} · ${x.loanId} · ${x.borrower || "?"} <${x.email}> · due ${x.due}`).join("\n") +
      "\n\nThey'll be tried again tomorrow. You can also send them from admin → Loans → Return reminder.");
    if (out.deferred) parts.push(`${out.deferred} more reminder(s) were due than can be sent in one day's run (${MAX_EMAILS_PER_RUN}); they'll go out tomorrow.`);
    if (out.errors.length) parts.push(`Problems:\n${out.errors.join("\n")}`);
    await sendAlert(env, {
      key: "reminders",
      subject: out.failed.length ? `${out.failed.length} return reminder email(s) failed` : out.errors.length ? "Return reminders: some couldn't be processed" : "Return reminders: some left for tomorrow",
      text: parts.join("\n\n"),
    }).catch(() => {});
  }
  return out;
}

/** GET /admin/network/reminders — Network Admin: who would get an automatic reminder today (sends nothing). */
async function handleRemindersPreview(c) {
  const r = await runReminders(c.env, c.ctx, { dryRun: true, db: c.db });
  return json(r);
}

export { MAX_EMAILS_PER_RUN, itemsLabel, itemsList, reminderDue, fillTemplate, dueBackText, reminderMessage, runReminders, handleRemindersPreview, dayLabel };
