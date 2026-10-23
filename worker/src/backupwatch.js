// Part of the Gemach Network worker (see index.js for routes and env vars).
// Daily "are the backups still happening?" check, run with the reminders by the daily cron in wrangler.toml.
//
// The backups themselves run on GitHub Actions (.github/workflows/d1-backup.yml nightly, assets-backup.yml
// weekly). A failed run emails Barry, but a run that never starts doesn't — GitHub turns off scheduled
// workflows after 60 days without repo activity, or a token can expire. So the worker, which runs on
// Cloudflare's own schedule, looks at the private backups bucket (binding BACKUPS_BUCKET = wh-gemach-backups):
//   d1/YYYY/MM/…sql.gz            the nightly database export            alert if the newest is over 30 h old
//   status/offsite-db.json         last encrypted copy to GitHub          over 30 h old
//   status/offsite-photos.json     last weekly photo check                over 9 days old
// A status file that has never been written means that copy isn't set up yet: no alert for it.
// One email per daily run when anything is late. Optional var BACKUP_WATCH=off turns the check off.
import { sendAlert } from "./alerts.js";
import { formatNy } from "./dates.js";

const HOUR = 3600e3;
const CHECKS = {
  database: { maxAgeMs: 30 * HOUR, label: "Nightly database backup (Cloudflare R2)" },
  offsiteDb: { maxAgeMs: 30 * HOUR, label: "Encrypted off-site database copy (GitHub)", status: "status/offsite-db.json" },
  offsitePhotos: { maxAgeMs: 9 * 24 * HOUR, label: "Weekly photo backup (GitHub)", status: "status/offsite-photos.json" },
};

/** The newest nightly export's upload time (ms), looking at this month and the previous one; null if none. */
async function newestExport(bucket, now) {
  const d = new Date(now);
  const months = [d, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))]
    .map(x => `d1/${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/`);
  let newest = null;
  for (const prefix of months) {
    let cursor;
    do {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects || []) {
        const t = o.uploaded ? new Date(o.uploaded).getTime() : NaN;
        if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return newest;
}

/** A status file's "at" time (ms); null when the file doesn't exist; NaN when it can't be read. */
async function statusTime(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try { return Date.parse((await obj.json()).at); } catch { return NaN; }
}

/** Pure: which checks are late. times = { database, offsiteDb, offsitePhotos } (ms | null | NaN). */
function lateChecks(times, now) {
  const late = [];
  for (const [id, c] of Object.entries(CHECKS)) {
    const t = times[id];
    if (t === null && c.status) continue; // off-site copy not set up yet
    if (t === null) { late.push({ id, label: c.label, at: null }); continue; }
    if (!Number.isFinite(t) || now - t > c.maxAgeMs) late.push({ id, label: c.label, at: Number.isFinite(t) ? t : null });
  }
  return late;
}

function ago(ms) {
  const h = Math.round(ms / HOUR);
  return h < 48 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
}

async function runBackupWatch(env, { now = Date.now() } = {}) {
  if (String(env.BACKUP_WATCH || "").toLowerCase() === "off") return { skipped: "off" };
  const bucket = env.BACKUPS_BUCKET;
  if (!bucket) { console.warn("backup watch: no BACKUPS_BUCKET binding, skipping"); return { skipped: "no bucket" }; }
  const times = {};
  const errors = [];
  await Promise.all([
    newestExport(bucket, now).then(t => { times.database = t; }, e => { times.database = NaN; errors.push(`database: ${e.message}`); }),
    ...["offsiteDb", "offsitePhotos"].map(id => statusTime(bucket, CHECKS[id].status)
      .then(t => { times[id] = t; }, e => { times[id] = NaN; errors.push(`${id}: ${e.message}`); })),
  ]);
  const late = lateChecks(times, now);
  if (late.length) {
    const lines = late.map(l => `• ${l.label}: ${l.at ? `last one ${ago(now - l.at)} (${formatNy(l.at)})` : "none found"}`);
    await sendAlert(env, {
      key: "backup-late",
      subject: late.length === 1 ? `Backup is late: ${late[0].label}` : `${late.length} backups are late`,
      text: [
        "The daily backup check found backups that should have run by now:", "", ...lines, "",
        errors.length ? `Errors reading the backups bucket: ${errors.join("; ")}\n` : null,
        "Where to look: GitHub → barry253/wh-gemach → Actions → \"D1 nightly backup\" / \"Photos off-site backup\". " +
        "If the workflow shows no recent runs, GitHub may have turned the schedule off (it does that after 60 days with no repo activity): open the workflow and choose Enable workflow, then Run workflow. " +
        "If runs are failing, the error is at the top of the run (an expired token is the usual cause).",
        "The site itself is fine; this is only about the safety copies. (Checked once a day.)",
      ].filter(x => x !== null).join("\n"),
    }).catch(e => console.error("alert failed:", e.message));
  }
  console.log("backup watch:", JSON.stringify({ late: late.map(l => l.id), errors: errors.length }));
  return { times, late, errors };
}

export { CHECKS, lateChecks, runBackupWatch };
