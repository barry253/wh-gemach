// Part of the Gemach Network worker (see index.js for routes and env vars).
// Hourly "are we close to a free-plan daily limit?" check, run by the second cron in wrangler.toml.
//
// Cloudflare's Workers Free plan allows 100,000 requests a day and D1 Free allows 5M row reads and 100K row
// writes a day (all reset at midnight UTC). Past a limit the site stops answering until the reset, so this asks
// Cloudflare's GraphQL Analytics API (same read-only token as the Analytics tab, CF_ANALYTICS_TOKEN) how much of
// today's allowance is used and sends a site alert (email + Network Admin push) the first time each metric
// reaches 50%, 80% and 100%. One alert per metric per level per UTC day; the levels reached are remembered in
// site_meta (D1), or in memory when there is no D1.
//
// Optional vars: USAGE_WATCH=off (turn it off, e.g. after moving to Workers Paid), CF_ACCOUNT_ID, D1_DATABASE_ID.
import { gql, TRAFFIC_DEFAULTS } from "./traffic.js";
import { formatNy } from "./dates.js";
import { sendAlert } from "./alerts.js";
import { useD1 } from "./db.js";

const USAGE_CRON = "7 * * * *"; // hourly, at :07 (the reminders cron owns 14:00)
const STATE_ROW_ID = "recUSAGEALERTV1";
const D1_DATABASE_ID = "974be829-ed62-4e9a-9965-77784d5d74a5";
const LEVELS = [50, 80, 100];
const LIMITS = { requests: 100000, rowsRead: 5000000, rowsWritten: 100000 };
const LABELS = {
  requests: "Worker requests",
  rowsRead: "D1 rows read",
  rowsWritten: "D1 rows written",
};
const CONSEQUENCE = {
  requests: "At 100% Cloudflare stops running the worker (Error 1027): the directory, gemach pages and request form stop loading data until the reset.",
  rowsRead: "At 100% every database query fails (public pages that aren't cached, admin, requests) until the reset.",
  rowsWritten: "At 100% every database write fails (new requests, loans, admin changes) until the reset.",
};

const WORKER_USAGE_QUERY = `query WorkerUsage($account: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(filter: { datetime_geq: $from, datetime_leq: $to }, limit: 1000) {
      sum { requests } dimensions { scriptName }
    }
  } }
}`;
const D1_USAGE_QUERY = `query D1Usage($account: string!, $day: Date!, $db: string!) {
  viewer { accounts(filter: { accountTag: $account }) {
    d1AnalyticsAdaptiveGroups(filter: { date_geq: $day, date_leq: $day, databaseId: $db }, limit: 10) {
      sum { rowsRead rowsWritten }
    }
  } }
}`;

let memState = null; // used when there is no D1

async function loadState(env) {
  if (!useD1(env) || !env.DB) return memState;
  try {
    const r = await env.DB.prepare("SELECT value FROM site_meta WHERE id = ?").bind(STATE_ROW_ID).all();
    const v = r.results?.[0]?.value;
    return v ? JSON.parse(v) : null;
  } catch (e) {
    console.error("usage state read failed:", e.message);
    return memState;
  }
}

async function saveState(env, state) {
  memState = state;
  if (!useD1(env) || !env.DB) return;
  try {
    await env.DB.prepare("INSERT INTO site_meta (id, created_at, key, value) VALUES (?, ?, 'usage_alert', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
      .bind(STATE_ROW_ID, new Date().toISOString(), JSON.stringify(state)).run();
  } catch (e) {
    console.error("usage state write failed:", e.message);
  }
}

/** The highest of 50 / 80 / 100 that `used / limit` has reached (0 = below 50%). */
function levelFor(used, limit) {
  const pct = (used / limit) * 100;
  let level = 0;
  for (const l of LEVELS) if (pct >= l) level = l;
  return level;
}

/**
 * Pure: which alerts are due? `usage` = { requests, rowsRead, rowsWritten } (numbers or null when unreadable),
 * `state` = what was already alerted today. Returns { alerts: [{ metric, level, used, limit }], state }.
 */
function dueAlerts(usage, state, day) {
  const next = state && state.day === day ? { ...state, levels: { ...state.levels } } : { day, levels: {}, errorDay: state?.errorDay };
  const alerts = [];
  for (const metric of Object.keys(LIMITS)) {
    const used = usage[metric];
    if (typeof used !== "number") continue;
    const level = levelFor(used, LIMITS[metric]);
    if (level > (next.levels[metric] || 0)) {
      alerts.push({ metric, level, used, limit: LIMITS[metric] });
      next.levels[metric] = level;
    }
  }
  return { alerts, state: next };
}

const fmt = n => Math.round(n).toLocaleString("en-US");

function alertText(a, day, perScript) {
  const resetMs = Date.parse(`${day}T00:00:00Z`) + 86400e3;
  const lines = [
    `${LABELS[a.metric]} today (UTC day ${day}) are at ${fmt(a.used)} of ${fmt(a.limit)} (${Math.round((a.used / a.limit) * 100)}%).`,
    CONSEQUENCE[a.metric],
    `The count resets at midnight UTC (${formatNy(resetMs)} New York time).`,
  ];
  if (a.metric === "requests" && perScript?.length) {
    lines.push("", "By script so far today: " + perScript.map(s => `${s.name} ${fmt(s.requests)}`).join(", "));
  }
  lines.push("",
    "What to do: if this is a launch-day rush, it is fine as long as it stays under 100%. To remove the limits, upgrade to Workers Paid ($5/month) in the Cloudflare dashboard; " +
    "you can downgrade again later. Then set USAGE_WATCH=off on the worker (this check isn't needed on Paid).",
    "Numbers: Network → Analytics in admin, or Cloudflare → Workers & Pages → wh-gemach → Metrics.");
  return lines.join("\n");
}

/** Reads today's usage from Cloudflare. Each part can fail on its own: { requests, rowsRead, rowsWritten, perScript, errors[] }. */
async function readUsage(env, now) {
  const account = env.CF_ACCOUNT_ID || TRAFFIC_DEFAULTS.account;
  const day = new Date(now).toISOString().slice(0, 10);
  const out = { requests: null, rowsRead: null, rowsWritten: null, perScript: [], errors: [] };
  const [w, d] = await Promise.allSettled([
    gql(env, WORKER_USAGE_QUERY, { account, from: `${day}T00:00:00Z`, to: new Date(now).toISOString() }),
    gql(env, D1_USAGE_QUERY, { account, day, db: env.D1_DATABASE_ID || D1_DATABASE_ID }),
  ]);
  if (w.status === "fulfilled" && w.value.data?.viewer?.accounts?.[0]) {
    const rows = w.value.data.viewer.accounts[0].workersInvocationsAdaptive || [];
    const by = new Map();
    for (const r of rows) by.set(r.dimensions?.scriptName || "(unknown)", (by.get(r.dimensions?.scriptName || "(unknown)") || 0) + (r.sum?.requests || 0));
    out.perScript = [...by].map(([name, requests]) => ({ name, requests })).sort((a, b) => b.requests - a.requests).slice(0, 6);
    out.requests = [...by.values()].reduce((s, n) => s + n, 0);
  } else {
    out.errors.push("Worker requests: " + (w.status === "rejected" ? w.reason?.message : w.value.errors?.[0] || "no data"));
  }
  if (d.status === "fulfilled" && d.value.data?.viewer?.accounts?.[0]) {
    const rows = d.value.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups || [];
    out.rowsRead = rows.reduce((s, r) => s + (r.sum?.rowsRead || 0), 0);
    out.rowsWritten = rows.reduce((s, r) => s + (r.sum?.rowsWritten || 0), 0);
  } else {
    out.errors.push("D1 rows: " + (d.status === "rejected" ? d.reason?.message : d.value.errors?.[0] || "no data"));
  }
  return out;
}

/** The hourly job. Returns what it did (used by the tests and the logs). */
async function runUsageWatch(env, { now = Date.now() } = {}) {
  if (String(env.USAGE_WATCH || "").toLowerCase() === "off") return { skipped: "off" };
  if (!env.CF_ANALYTICS_TOKEN) { console.warn("usage watch: CF_ANALYTICS_TOKEN not set, skipping"); return { skipped: "no token" }; }
  const day = new Date(now).toISOString().slice(0, 10);
  const usage = await readUsage(env, now);
  const state = await loadState(env);
  const { alerts, state: next } = dueAlerts(usage, state, day);

  // Couldn't read a number: say so once a day, so a silent watcher doesn't look like "all clear".
  if (usage.errors.length && next.errorDay !== day) {
    next.errorDay = day;
    await sendAlert(env, {
      always: true,
      subject: "Usage check couldn't read Cloudflare's numbers",
      text: `The hourly check that warns before the free daily limits run out couldn't read some of today's numbers:\n\n${usage.errors.join("\n")}\n\n` +
        "Usually this is the analytics token (CF_ANALYTICS_TOKEN needs Account Analytics: Read) or a field name Cloudflare changed. Until fixed, the alerts for those numbers won't fire. (Sent once a day.)",
    }).catch(e => console.error("alert failed:", e.message));
  }
  for (const a of alerts) {
    await sendAlert(env, {
      always: true,
      subject: `${LABELS[a.metric]} at ${a.level}% of today's free limit (${fmt(a.used)} of ${fmt(a.limit)})`,
      text: alertText(a, day, usage.perScript),
    }).catch(e => console.error("alert failed:", e.message));
  }
  if (alerts.length || usage.errors.length || !state || state.day !== day) await saveState(env, next);
  console.log("usage watch:", JSON.stringify({ day, requests: usage.requests, rowsRead: usage.rowsRead, rowsWritten: usage.rowsWritten, alerts: alerts.length, errors: usage.errors.length }));
  return { day, usage, alerts };
}

export { USAGE_CRON, LIMITS, LEVELS, levelFor, dueAlerts, runUsageWatch };
