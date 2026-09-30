// Part of the Gemach Network worker (see index.js for routes and env vars).
import { DEFAULT_FROM_EMAIL, T } from "./config.js";
import { formatNy } from "./dates.js";
import { json } from "./http.js";
import { route } from "./index.js";
import { clip } from "./submit.js";

// ─── Health + alerts ──────────────────────────────────────────────────────────

/** Uptime check: one tiny Airtable read, 8 s budget. Never cached. */
async function handleHealth(db) {
  const t0 = Date.now();
  const noStore = { "Cache-Control": "no-store" };
  try {
    await Promise.race([
      db.listPage(T.GEMACHS, { maxRecords: 1, fields: ["Slug"] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000)),
    ]);
    // rateLimited > 0 means Airtable answered "too many requests" and we waited before retrying.
    return json({ ok: true, airtable: "ok", ms: Date.now() - t0, airtableMs: db.stats?.slowest ?? null, rateLimited: db.stats?.retries ?? 0 }, 200, noStore);
  } catch (e) {
    console.error("Health check failed:", e.message, e.detail ? JSON.stringify(e.detail) : "");
    return json({ ok: false, airtable: "error" }, 503, noStore);
  }
}

// Per-isolate throttle: a repeating problem sends one email per key per 10 minutes, and no isolate
// sends more than 30 alerts an hour (a storm still gets through as the first few).
const ALERT_WINDOW_MS = 10 * 60 * 1000;
const ALERT_HOURLY_CAP = 30;
const alertLast = new Map();
let alertHour = { start: 0, count: 0 };

async function sendAlert(env, { key = "", subject, text, always = false }) {
  const to = env.ALERT_EMAIL || env.NOTIFY_EMAIL;
  if (!to || !env.RESEND_API_KEY) { console.error("ALERT (no address):", subject); return false; }
  const now = Date.now();
  if (now - alertHour.start > 3600e3) alertHour = { start: now, count: 0 };
  if (alertHour.count >= ALERT_HOURLY_CAP) { console.error("ALERT (capped):", subject); return false; }
  if (!always) {
    const last = alertLast.get(key);
    if (last && now - last < ALERT_WINDOW_MS) return false;
    if (alertLast.size > 200) alertLast.clear();
    alertLast.set(key, now);
  }
  alertHour.count++;
  const body = `${text}\n\n— whgemachs.org · ${formatNy(now)}\nFull logs: Cloudflare dashboard → Workers & Pages → wh-gemach → Logs`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `"whgemachs.org alerts" <${env.FROM_EMAIL || DEFAULT_FROM_EMAIL}>`,
        to: [to],
        subject: `[whgemachs] ${String(subject).replace(/[\r\n]+/g, " ").slice(0, 200)}`,
        text: body,
      }),
    });
    if (!res.ok) console.error("Alert send failed:", res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error("Alert send failed:", e.message);
    return false;
  }
}

function alertBorrowerEmailFailed(env, g, what, requestId) {
  return sendAlert(env, {
    always: true,
    subject: `${g.name || g.slug}: ${what} email for ${requestId} didn't send`,
    text: `The ${what} email to the borrower for request ${requestId} (${g.name || g.slug}) failed to send. ` +
      `The request itself was updated in admin. Please reach the borrower another way.`,
  }).catch(e => console.error("alert failed:", e.message));
}

/** Any 5xx. A failed public request includes what the person sent, so someone can call them back. */
async function alertServerError(env, { method, path, res, thrown, submitCopy }) {
  const route = path.replace(/rec[A-Za-z0-9]{14}/g, ":id").replace(/^\/public\/gemach\/.+$/, "/public/gemach/:slug");
  let detail = thrown ? String(thrown.stack || thrown.message || thrown) : "";
  if (thrown?.detail) detail += "\n" + JSON.stringify(thrown.detail);
  if (!detail) detail = (await res.text().catch(() => "")).slice(0, 1500);
  if (submitCopy) {
    const b = await submitCopy.json().catch(() => null);
    const who = b && typeof b === "object" ? [
      `Gemach: ${clip(String(b.gemach || "wh-medical"), 100)}`,
      `Name: ${clip(String(b.name ?? ""), 200)}`,
      `Phone: ${clip(String(b.phone ?? ""), 50)}`,
      `Email: ${clip(String(b.email ?? ""), 200)}`,
      `Best way to reach: ${clip(String(b.preferredContact ?? ""), 50)}`,
      `Dates: ${clip(String(b.eventDate || b.neededFrom || ""), 20)}${b.neededUntil ? " to " + clip(String(b.neededUntil), 20) : ""}`,
      `Notes: ${clip(String(b.notes ?? ""), 1000)}`,
    ].join("\n") : "(request body could not be read)";
    return sendAlert(env, {
      always: true,
      subject: "A request FAILED to save — someone needs a call back",
      text: `Someone tried to send a request and got an error, so it is NOT in Airtable.\n\n${who}\n\n` +
        `They were told to contact the gemach directly, but please reach out to them.\n\nError (${res.status}):\n${detail}`,
    });
  }
  return sendAlert(env, {
    key: `${method} ${route}`,
    subject: `Server error: ${method} ${route}`,
    text: `${method} ${route} returned ${res.status}. (Repeats of this error are muted for 10 minutes.)\n\n${detail}`,
  });
}

export { handleHealth, ALERT_WINDOW_MS, ALERT_HOURLY_CAP, alertLast, alertHour, sendAlert, alertBorrowerEmailFailed, alertServerError };
