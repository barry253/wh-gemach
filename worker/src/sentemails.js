// Part of the Gemach Network worker (see index.js for routes and env vars).
import { T } from "./config.js";
import { sendEmail } from "./email.js";
import { json } from "./http.js";
import { Q, getOwned } from "./records.js";

// ─── Sent emails (copies of borrower emails, opened from History) ─────────────
// Every email to a borrower goes through sendBorrowerEmail: it sends as before and keeps a copy in
// Sent Emails. The flow then stamps the copy's id on its History event (Activity Log "Email ID"), and
// History shows "View email". Emails to gemachs, admin invites and alerts don't come through here.
// Copies are deleted a year after sending (runSentEmailCleanup, hourly cron); the History event stays.

const KEEP_DAYS = 365;
const MAX_TEXT = 100000; // a copy is never refused for being big; it's cut (borrower messages are short)
const MAX_HTML = 400000;

/** What went with the email, by name only: [{ name }] for files (appointment.ics), [{ photo: true }] for pickup photos. */
function attachmentList(attachments) {
  return (attachments || []).map(a => (a.content_id ? { photo: true } : { name: String(a.filename || "attachment") }));
}

/** The Sent Emails row for a borrower email (not saved yet). */
function sentEmailFields(g, { to, subject, text, html, attachments, kind, status, error = null }) {
  const list = attachmentList(attachments);
  return {
    "Sent At": new Date().toISOString(),
    "Gemach": [g.id],
    "Kind": kind || null,
    "To": String(to),
    "Subject": String(subject || "").replace(/[\r\n]+/g, " "),
    "Text": String(text || "").slice(0, MAX_TEXT),
    "HTML": html ? String(html).slice(0, MAX_HTML) : null,
    "Attachments": list.length ? JSON.stringify(list) : null,
    "Status": status,
    "Error": error ? String(error).slice(0, 500) : null,
  };
}

/** Save several copies in as few writes as D1 allows (the daily reminder run). Returns their ids in order (null when not saved). */
async function saveSentEmails(db, rows) {
  if (!db || !rows.length) return [];
  try {
    const saved = await db.createMany(T.SENT_EMAILS, rows);
    return rows.map((_, i) => saved[i]?.id || null);
  } catch (e) {
    console.error("Saving sent emails failed:", e.message);
    return rows.map(() => null);
  }
}

/** Keep a copy of a borrower email (one write). Returns the copy's id, or null when it couldn't be saved (never throws). */
async function saveSentEmail(db, g, mail) {
  if (!db || !g?.id || !mail?.to) return null;
  return (await saveSentEmails(db, [sentEmailFields(g, mail)]))[0];
}

/**
 * Send an email to a borrower (sendEmail) and keep a copy. mail = sendEmail's { to, subject, text, html, attachments }.
 * Returns { ok, emailId }: ok is sendEmail's answer (true sent / false failed / null no address, nothing saved).
 */
async function sendBorrowerEmail(env, db, g, mail, { kind, save = true } = {}) {
  if (!mail?.to) return { ok: null, emailId: null };
  const ok = await sendEmail(env, g, mail);
  const copy = { ...mail, kind, status: ok ? "Sent" : "Failed", error: ok ? null : "The email service didn't accept it." };
  // save: false — the caller saves the copies together later (saveSentEmails(db, rows)) and gets the ids then.
  if (!save) return { ok, emailId: null, row: g?.id ? sentEmailFields(g, copy) : null };
  return { ok, emailId: await saveSentEmail(db, g, copy) };
}

const ATTACH_NOTE_RE = /<img\b[^>]*\bsrc="cid:[^"]*"[^>]*>/gi;

/** GET /admin/emails/:id — one saved email of this gemach, for the History viewer (every admin role). */
async function handleGetSentEmail({ db, g }, id) {
  const rec = await getOwned(db, T.SENT_EMAILS, id, g);
  if (!rec) return json({ error: "This email is no longer available. Copies are kept for a year." }, 404);
  const f = rec.fields;
  let attachments = [];
  try { attachments = JSON.parse(f["Attachments"] || "[]"); } catch { attachments = []; }
  const photos = attachments.filter(a => a.photo).length;
  // Pickup photos were embedded (cid:) and aren't kept with the copy: they'd show as broken images.
  const html = f["HTML"] ? String(f["HTML"]).replace(ATTACH_NOTE_RE, "") : null;
  return json({
    id: rec.id,
    sentAt: f["Sent At"] || null,
    kind: f["Kind"] || null,
    to: f["To"] || null,
    subject: f["Subject"] || null,
    status: f["Status"] || null,
    error: f["Error"] || null,
    text: f["Text"] || "",
    html,
    files: attachments.filter(a => a.name).map(a => a.name),
    photos,
  });
}

/** Status of each saved email on a History page: { [id]: "Sent" | "Failed" | "Skipped" } (missing = deleted). */
async function sentEmailStatuses(db, g, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  try {
    const recs = await db.listAll(T.SENT_EMAILS, { scope: g, where: [Q.idIn(list)], fields: ["Status"] });
    return Object.fromEntries(recs.map(r => [r.id, r.fields["Status"] || "Sent"]));
  } catch (e) {
    console.error("Sent email statuses skipped:", e.message);
    return null;
  }
}

/** Hourly: delete copies older than a year (up to 500 a run; History events keep their text). */
async function runSentEmailCleanup(db, { now = Date.now() } = {}) {
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString();
  const old = await db.listAll(T.SENT_EMAILS, { where: [Q.before("Sent At", cutoff)], fields: ["Sent At"], maxRecords: 500 });
  if (old.length) await db.delMany(T.SENT_EMAILS, old.map(r => r.id));
  return old.length;
}

export { sendBorrowerEmail, saveSentEmail, saveSentEmails, handleGetSentEmail, sentEmailStatuses, runSentEmailCleanup, KEEP_DAYS };
