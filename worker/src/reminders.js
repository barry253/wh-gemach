// Part of the Gemach Network worker (see index.js for routes and env vars).
import { logEvent } from "./activity.js";
import { Q, firstLink, linkedId } from "./airtable.js";
import { makeDb } from "./db.js";
import { sendAlert } from "./alerts.js";
import { T } from "./config.js";
import { DAY_MS, addDays, dateToUtcMs, isValidDate, nyToday } from "./dates.js";
import { buildEmailHtml, sendEmail } from "./email.js";
import { GEMACH_FIELDS, gemachFromRecord } from "./gemachs.js";
import { json } from "./http.js";
import { LOAN_LIST_FIELDS, loadLoanRelations, loanQtyInfo } from "./loans.js";
import { manageUrl } from "./manage.js";
import { effectiveTemplates, emailSignature } from "./settings.js";

// ─── Automatic return reminders (daily cron) ──────────────────────────────────
// For each gemach with "Auto Reminders" on: email borrowers who gave an email address, using the gemach's
// Return reminder template filled with the loan's details —
//   • once, N days before the loan's Expected Return ("Reminder Days Before", default 2; 0 = on the day), and
//   • once overdue: the day after the due date, then every M days ("Reminder Repeat Days", default 7; 0 = never).
// Any reminder (automatic or sent by an admin) stamps Loans."Reminder Sent At", which is what keeps this
// from repeating: at most one per loan per day, and a manual reminder counts.
// Loans without an Expected Return (open-ended) are never reminded automatically.

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
  "appointment_time", "manage_link", "borrowed_date", "due_back", "days_out"]);
function fillTemplate(template, vars) {
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

/** {due_back}: "is due back on Fri, Oct 9" / "is due back today" / "was due back on Fri, Oct 2". */
function dueBackText(expected, today) {
  if (!isValidDate(expected)) return "";
  if (expected === today) return "is due back today";
  return `${expected > today ? "is" : "was"} due back on ${dayLabel(expected)}`;
}

/** The Return reminder text for one loan (the gemach's template, or the default). */
function reminderMessage(g, { firstName, items, borrowed, expected, today, link }) {
  let tpl = effectiveTemplates(g).returnReminder;
  if (link && !tpl.includes("{manage_link}")) tpl = tpl.trimEnd() + "\n\nManage your loan: {manage_link}";
  return fillTemplate(tpl, {
    first_name: firstName || "",
    items: items || "",
    gemach: g.name || "gemach",
    pickup_address: g.pickupAddress || "", pickup_instructions: g.pickupInstructions || "",
    hours: g.hours || "", phone: g.phone || "", email: g.email || "",
    deposit_info: g.depositRequired ? (g.depositInfo || "") : "",
    event_date: "", appointment_time: "",
    manage_link: link || "",
    borrowed_date: dayLabel(borrowed),
    due_back: dueBackText(expected, today),
    days_out: isValidDate(borrowed) ? String(Math.max(0, daysBetween(borrowed, today))) : "",
  });
}

const VALID_EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]+$/;

/**
 * Run the day's reminders. dryRun: work out who would get one, send nothing, change nothing.
 * Returns { today, sent: [...], failed: [...], noEmail } (dry run: "sent" = would send).
 */
async function runReminders(env, ctx, { now = Date.now(), dryRun = false, db = makeDb(env) } = {}) {
  const today = nyToday(now);
  const recs = await db.listAll(T.GEMACHS, { where: [Q.isTrue("Active"), Q.isTrue("Auto Reminders"), Q.nonEmpty("Slug")], fields: GEMACH_FIELDS });
  const out = { today, dryRun, sent: [], failed: [], noEmail: 0 };
  for (const g of recs.map(gemachFromRecord)) {
    const loans = await db.listAll(T.LOANS, { scope: g, where: [Q.eq("Status", "Active"), Q.notBlank("Expected Return")], fields: LOAN_LIST_FIELDS });
    if (!loans.length) continue;
    const { borrowerMap, itemMap, itemTypeMap, typeInfo } = await loadLoanRelations(db, g, loans, { includeItemToReserve: true });
    for (const l of loans) {
      const f = l.fields;
      const q = loanQtyInfo(f, typeInfo);
      if (q.isAddon) continue; // add-ons are bought, not returned
      const expected = f["Expected Return"];
      const lastSent = f["Reminder Sent At"] ? nyToday(Date.parse(f["Reminder Sent At"])) : null;
      const kind = reminderDue({ expected, today, lastSent, before: g.reminderDaysBefore, repeat: g.reminderRepeatDays });
      if (!kind) continue;
      const b = borrowerMap[linkedId(firstLink(f["Borrower"]))] || {};
      const email = String(b.email || "").trim();
      if (!VALID_EMAIL.test(email)) { out.noEmail++; continue; }
      const item = itemMap[linkedId(firstLink(f["Item"]))] || {};
      const typeName = item.itemTypeName || itemTypeMap[linkedId(firstLink(f["Item to Reserve"]))] || "item";
      const items = q.isQuantity && q.quantity ? `${typeName} × ${q.quantity}` : typeName;
      const src = linkedId(firstLink(f["Source Request"]));
      const link = src ? await manageUrl(env, src) : null;
      const message = reminderMessage(g, { firstName: String(b.name || "").trim().split(/\s+/)[0], items, borrowed: f["Date Borrowed"], expected, today, link });
      const entry = { gemach: g.slug, loanId: f["Loan ID"] || l.id, borrower: b.name || null, email, kind, due: expected };
      if (dryRun) { out.sent.push({ ...entry, message }); continue; }
      const subject = kind === "overdue" ? `Reminder: please return the ${items} — ${g.name}` : `Reminder: ${items} due back ${dayLabel(expected)} — ${g.name}`;
      const ok = await sendEmail(env, g, { to: email, subject, text: message + emailSignature(g), html: buildEmailHtml(g, message) });
      if (!ok) { out.failed.push(entry); continue; }
      await db.update(T.LOANS, l.id, { "Reminder Sent At": new Date(now).toISOString(), "Reminder Sent Via": "Email (automatic)" });
      logEvent(ctx, db, g, {
        eventType: "Return Reminder Sent", borrower: b.name || null, itemType: typeName, itemCode: item.itemId || null,
        loanId: f["Loan ID"] || null, admin: "Automatic", notes: `Emailed to ${email}${kind === "overdue" ? " (overdue)" : ""}`,
      });
      out.sent.push(entry);
    }
  }
  console.log(`reminders ${today}${dryRun ? " (dry run)" : ""}: ${out.sent.length} sent, ${out.failed.length} failed, ${out.noEmail} without email`);
  if (out.failed.length && !dryRun) {
    await sendAlert(env, {
      key: "reminders", subject: `${out.failed.length} return reminder email(s) failed`,
      text: `These automatic return reminders could not be emailed today (${today}):\n\n` +
        out.failed.map(x => `${x.gemach} · ${x.loanId} · ${x.borrower || "?"} <${x.email}> · due ${x.due}`).join("\n") +
        "\n\nThey'll be tried again tomorrow. You can also send them from admin → Loans → Return reminder.",
    }).catch(() => {});
  }
  return out;
}

/** GET /admin/network/reminders — Network Admin: who would get an automatic reminder today (sends nothing). */
async function handleRemindersPreview(c) {
  const r = await runReminders(c.env, c.ctx, { dryRun: true, db: c.db });
  return json(r);
}

export { reminderDue, fillTemplate, dueBackText, reminderMessage, runReminders, handleRemindersPreview, dayLabel };
