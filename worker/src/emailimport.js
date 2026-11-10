// Part of the Gemach Network worker (see index.js for routes and env vars).
import { T } from "./config.js";
import { json, readJson } from "./http.js";
import { Q, linkedId } from "./records.js";
import { saveSentEmails } from "./sentemails.js";

// ─── One-off: import borrower emails sent before Nov 9, 2026 from Resend ───────
// Copies have been kept since commit f8de9b9 (sentemails.js). Resend still holds about 30 days of what was
// sent before that; this pulls those in so History's "View email" works for them too.
// POST /admin/network/email-import { dryRun, cursor } — Network Admin, run from the Network tab, one page per call
// (Free plan: 50 subrequests and 50 D1 queries per call). Only borrower emails are taken: the sender name must be a
// gemach and the address a borrower / requester of that gemach. Each is linked to its History event only when the
// match is certain (same gemach, event type for that email, same borrower name, within a few minutes); unsure ones
// are skipped, not saved. Pickup details had no History event before, so one is added at the time it was sent.

const STARTED = "2026-11-10T03:15:00.000Z"; // copies kept natively from here on (deploy of f8de9b9)
const WINDOW_MS = 3 * 60000;
const IMPORT_PAGE = 15; // emails per call when importing (each needs one more call to Resend for its content)
const PREVIEW_PAGE = 100;

/** What kind of borrower email a subject is (the subjects the worker has used since Oct 2026), or null. */
function kindOfSubject(subject) {
  const s = String(subject || "").replace(/^\[TEST\]\s*/, "");
  let m;
  if ((m = s.match(/^We got your request — .*\((R-[\w-]+)\)$/))) return { kind: "receipt", requestId: m[1] };
  if (/^Your .+ Request — (Confirmed|Update)$/.test(s)) return { kind: "confirm" };
  if (/^Your .+ Request$/.test(s)) return { kind: "decline" };
  if (/^Pickup details — /.test(s)) return { kind: "pickup" };
  if (/^Reminder: /.test(s)) return { kind: "reminder" };
  if (/^Thank you for returning the /.test(s)) return { kind: "returned" };
  if (/^Your .+ — updated$/.test(s)) return { kind: "update" };
  if (/^Your .+ — cancelled$/.test(s)) return { kind: "cancel" };
  if (/^What you borrowed — /.test(s)) return { kind: "checkout" };
  return null;
}

// Which History events each kind belongs to; all: link every matching row (a cancel / walk-in writes several).
const EVENTS = {
  receipt:  { types: ["Request Received"] },
  confirm:  { types: ["Request Confirmed", "Reservation Made", "Appointment Booked"] },
  decline:  { types: ["Request Declined"] },
  reminder: { types: ["Return Reminder Sent"] },
  returned: { types: ["Item Returned"] },
  update:   { types: ["Booking Updated"] },
  cancel:   { types: ["Request Cancelled", "Reservation Cancelled"], all: true },
  checkout: { types: ["Checked Out"], fallback: { types: ["Loan Created"], all: true } },
};

const low = s => String(s || "").trim().toLowerCase();
const senderName = from => { const m = String(from || "").match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : ""; };

const pause = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());
// Resend allows about 2 API calls a second: calls are spaced out, and a "too many" answer waits and tries once more.
async function resend(env, path, retry = true) {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 429 && retry) { await pause(env.RESEND_PAUSE_MS != null ? Number(env.RESEND_PAUSE_MS) : 1100); return resend(env, path, false); }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body?.message || "no answer"}`);
  return body;
}

/** Gemachs by sender name and by email; each gemach's borrower / requester addresses → their names. */
async function loadPeople(db) {
  const [gemachs, borrowers, requests] = await Promise.all([
    db.listAll(T.GEMACHS, { fields: ["Name", "Email"] }),
    db.listAll(T.BORROWERS, { where: [Q.notBlank("Email")], fields: ["Name", "Email", "Gemach"] }),
    db.listAll(T.REQUESTS, { where: [Q.notBlank("Email")], fields: ["Name", "Email", "Gemach"] }),
  ]);
  const byName = new Map(), byEmail = new Map();
  for (const g of gemachs) {
    const name = String(g.fields.Name || "").replace(/["<>\r\n]/g, "");
    if (name && !byName.has(name)) byName.set(name, { id: g.id, name: g.fields.Name });
    if (g.fields.Email) byEmail.set(low(g.fields.Email), { id: g.id, name: g.fields.Name });
  }
  const people = new Map(); // "<gemach id>|<email>" → Set of names
  for (const r of [...borrowers, ...requests]) {
    const gid = linkedId((r.fields.Gemach || [])[0]);
    if (!gid || !r.fields.Email) continue;
    const k = `${gid}|${low(r.fields.Email)}`;
    if (!people.has(k)) people.set(k, { names: new Set(), display: null });
    const e = people.get(k);
    if (r.fields.Name) { e.names.add(low(r.fields.Name)); e.display = e.display || String(r.fields.Name).trim(); }
  }
  return { byName, byEmail, people };
}

/** Decide what to do with one Resend email (no writes). */
function classify(e, P) {
  const to = low(Array.isArray(e.to) ? e.to[0] : e.to);
  const at = e.created_at ? new Date(String(e.created_at).replace(" ", "T").replace(/\+00(:00)?$/, "Z")) : null;
  const base = { id: e.id, to, subject: e.subject || "", sentAt: at && !isNaN(at) ? at.toISOString() : null };
  if (!base.sentAt) return { ...base, outcome: "skip", reason: "no date" };
  if (base.sentAt >= STARTED) return { ...base, outcome: "skip", reason: "already kept (sent after Nov 9)" };
  const k = kindOfSubject(e.subject);
  if (!k) return { ...base, outcome: "skip", reason: "not a borrower email" };
  const g = P.byName.get(senderName(e.from)) || P.byEmail.get(low(Array.isArray(e.reply_to) ? e.reply_to[0] : e.reply_to));
  if (!g) return { ...base, outcome: "skip", reason: "gemach not found" };
  const who = P.people.get(`${g.id}|${to}`);
  if (!who) return { ...base, outcome: "skip", reason: "not a borrower email" };
  return { ...base, outcome: "check", kind: k.kind, requestId: k.requestId || null, gemach: g, names: who.names, display: who.display };
}

/** Pick the History rows an email belongs to (marks them used), or a reason it can't be sure. */
function matchEvents(c, events, used) {
  const t = Date.parse(c.sentAt);
  const near = (spec) => events.filter(ev => !used.has(ev.id) && !ev.fields["Email ID"]
    && linkedId((ev.fields.Gemach || [])[0]) === c.gemach.id && spec.types.includes(ev.fields["Event Type"])
    && Math.abs(Date.parse(ev.fields.Timestamp) - t) <= (c.kind === "receipt" ? 15 * 60000 : WINDOW_MS)
    && (c.kind === "receipt" ? ev.fields["Loan ID"] === c.requestId
      : c.names.has(low(ev.fields.Borrower)) || (c.kind === "reminder" && String(ev.fields.Notes || "").includes(`Emailed to ${c.to}`))));
  let spec = EVENTS[c.kind], found = near(spec);
  if (!found.length && spec.fallback) { spec = spec.fallback; found = near(spec); }
  if (!found.length) return { reason: "no matching History entry" };
  if (!spec.all && found.length > 1) return { reason: "more than one possible History entry" };
  found.forEach(ev => used.add(ev.id));
  return { events: found.map(ev => ev.id) };
}

async function handleEmailImport(c) {
  const { db, env } = c;
  const body = await readJson(c.request);
  const dryRun = body.dryRun !== false;
  const cursor = typeof body.cursor === "string" && /^[\w-]{8,80}$/.test(body.cursor) ? body.cursor : null;
  if (!env.RESEND_API_KEY) return json({ error: "The email service isn't set up." }, 400);
  let list;
  try { list = await resend(env, `/emails?limit=${dryRun ? PREVIEW_PAGE : IMPORT_PAGE}${cursor ? `&after=${cursor}` : ""}`); }
  catch (e) { console.error("email import list:", e.message); return json({ error: "Couldn't read the email service's list. " + e.message }, 502); }
  const items = Array.isArray(list?.data) ? list.data : [];
  const out = { cursor: items.length ? items[items.length - 1].id : null, done: !list?.has_more || !items.length,
    seen: items.length, linked: 0, pickup: 0, unsure: 0, skipped: 0, saved: 0, oldest: null, rows: [] };
  if (!items.length) return json(out);

  const P = await loadPeople(db);
  const plan = items.map(e => classify(e, P));
  const checks = plan.filter(p => p.outcome === "check");
  out.oldest = plan.map(p => p.sentAt).filter(Boolean).sort()[0] || null;
  if (checks.length) {
    const times = checks.map(p => Date.parse(p.sentAt));
    const from = new Date(Math.min(...times) - 20 * 60000).toISOString(), to = new Date(Math.max(...times) + 20 * 60000).toISOString();
    const [events, kept] = await Promise.all([
      db.listAll(T.LOG, { where: [Q.after("Timestamp", from), Q.before("Timestamp", to)], fields: ["Timestamp", "Event Type", "Borrower", "Loan ID", "Notes", "Email ID", "Gemach"] }),
      db.listAll(T.SENT_EMAILS, { where: [Q.after("Sent At", from), Q.before("Sent At", to)], fields: ["Sent At", "To", "Subject"] }),
    ]);
    const used = new Set();
    for (const p of checks) {
      if (kept.some(k => low(k.fields.To) === p.to && k.fields.Subject === p.subject && Math.abs(Date.parse(k.fields["Sent At"]) - Date.parse(p.sentAt)) < 5 * 60000)) {
        Object.assign(p, { outcome: "skip", reason: "already imported" }); continue;
      }
      if (p.kind === "pickup") { p.outcome = "pickup"; continue; }
      const m = matchEvents(p, events, used);
      if (m.events) Object.assign(p, { outcome: "link", events: m.events });
      else Object.assign(p, { outcome: "unsure", reason: m.reason });
    }
  }

  const toSave = plan.filter(p => p.outcome === "link" || p.outcome === "pickup");
  if (!dryRun && toSave.length) {
    // The list has no content: one call each for the text and HTML.
    for (const p of toSave) {
      await pause(env.RESEND_PAUSE_MS != null ? Number(env.RESEND_PAUSE_MS) : 550); // tests set 0
      try { p.full = await resend(env, `/emails/${encodeURIComponent(p.id)}`); }
      catch (e) { Object.assign(p, { outcome: "unsure", reason: "couldn't read it: " + e.message }); }
    }
    const ready = toSave.filter(p => p.full);
    const ids = await saveSentEmails(db, ready.map(p => ({
      "Sent At": p.sentAt, "Gemach": [p.gemach.id], "Kind": p.kind, "To": p.to,
      "Subject": String(p.subject).replace(/[\r\n]+/g, " "), "Text": String(p.full.text || "").slice(0, 100000),
      "HTML": p.full.html ? String(p.full.html).slice(0, 400000) : null, "Attachments": null, "Status": "Sent",
      "Error": null,
    })));
    const pickupRows = [];
    for (let i = 0; i < ready.length; i++) {
      const p = ready[i];
      if (!ids[i]) { Object.assign(p, { outcome: "unsure", reason: "couldn't save it" }); continue; }
      out.saved++;
      if (p.outcome === "link") await db.updateMany(T.LOG, p.events, { "Email ID": ids[i] });
      else pickupRows.push({ "Timestamp": p.sentAt, "Event Type": "Pickup Info Sent", "Gemach": [p.gemach.id],
        "Borrower": p.display || null, "Notes": "Sent by email", "Email ID": ids[i] });
    }
    if (pickupRows.length) await db.createMany(T.LOG, pickupRows);
  }

  for (const p of plan) {
    if (p.outcome === "link") out.linked++;
    else if (p.outcome === "pickup") out.pickup++;
    else if (p.outcome === "unsure") out.unsure++;
    else out.skipped++;
    if (p.outcome !== "skip" || p.reason === "already imported") {
      out.rows.push({ sentAt: p.sentAt, gemach: p.gemach?.name || null, kind: p.kind || null, outcome: p.outcome, reason: p.reason || null, events: p.events?.length || 0 });
    }
  }
  out.notBorrower = plan.filter(p => p.outcome === "skip" && p.reason === "not a borrower email").length;
  return json(out);
}

export { handleEmailImport, kindOfSubject, classify, STARTED };
