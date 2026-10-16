// Part of the Gemach Network worker (see index.js for routes and env vars).
// GET /admin/network/traffic?days=30|90|365[&fresh=1] — visitor numbers and site errors from Cloudflare,
// for Network → Analytics (Network Admins only; routed through networkDispatch).
//
// Reads Cloudflare's GraphQL Analytics API with the secret CF_ANALYTICS_TOKEN (read-only:
// Account → Account Analytics: Read, Zone → Analytics: Read, Zone → Zone: Read). Without it the answer is
// { configured: false }. Optional vars: CF_ACCOUNT_ID, CF_WEB_ANALYTICS_SITE_TAG, CF_ZONE_ID (otherwise
// looked up once by name), CF_WORKER_NAME.
//   - Visitors (Web Analytics / RUM, bots excluded): visits, page views, by day, where from, device, country, page.
//     Asked for in 30-day windows (one request each, parallel); a window Cloudflare no longer has is skipped.
//   - Errors (last 30 days at most): worker invocations by status, and not-found / failed pages on whgemachs.org.
// Waiting on Cloudflare uses no worker CPU time; the answer is reused for 10 minutes per period.
import { DAY_MS, addDays, nyToday } from "./dates.js";
import { json } from "./http.js";
import { cleanPage } from "./events.js";

const GRAPHQL = "https://api.cloudflare.com/client/v4/graphql";
const DEFAULTS = {
  account: "30f51b1774b3c34eac1847d23240b759",
  siteTag: "c6af4edf382f4592a15d454f6c9ddbe0",
  zoneName: "whgemachs.org",
  worker: "wh-gemach",
};
const TRAFFIC_TTL_MS = 10 * 60 * 1000;
const trafficMemo = new Map(); // days -> { data, at }
let zoneIdMemo = null;

async function handleNetworkTraffic({ env, url }) {
  const days = [30, 90, 365].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 90;
  if (!env.CF_ANALYTICS_TOKEN) return json({ configured: false, days });
  const hit = trafficMemo.get(days);
  if (hit && Date.now() - hit.at < TRAFFIC_TTL_MS && url.searchParams.get("fresh") !== "1") {
    return json({ ...hit.data, cachedAt: new Date(hit.at).toISOString() });
  }
  const data = await buildTraffic(env, days);
  // Don't keep an answer where everything failed: the next look should try again.
  if (!data.problems.length || data.visitors) trafficMemo.set(days, { data, at: Date.now() });
  return json(data);
}

async function gql(env, query, variables) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok && !body?.data) throw new Error(`Cloudflare answered ${res.status}${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ""}`);
  if (body?.errors?.length && !body.data) throw new Error(body.errors.map(e => e.message).join("; ").slice(0, 300));
  return { data: body?.data || null, errors: (body?.errors || []).map(e => String(e.message || e)).slice(0, 5) };
}

async function zoneId(env) {
  if (env.CF_ZONE_ID) return env.CF_ZONE_ID;
  if (zoneIdMemo) return zoneIdMemo;
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(DEFAULTS.zoneName)}`, {
    headers: { "Authorization": `Bearer ${env.CF_ANALYTICS_TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  const id = body?.result?.[0]?.id;
  if (!id) throw new Error(`couldn't find the ${DEFAULTS.zoneName} zone (the token needs Zone: Read)`);
  zoneIdMemo = id;
  return id;
}

// One request per 30-day window: totals by day plus the top lists, as aliases of the same dataset.
const rumQuery = withBots => {
  const f = `filter: { siteTag: $siteTag, date_geq: $from, date_leq: $to${withBots ? "" : ", bot: 0"} }`;
  return `query Rum($account: string!, $siteTag: string!, $from: Date!, $to: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    byDate: rumPageloadEventsAdaptiveGroups(${f}, limit: 40) { count sum { visits } dimensions { date } }
    bySource: rumPageloadEventsAdaptiveGroups(${f}, limit: 60, orderBy: [sum_visits_DESC]) { count sum { visits } dimensions { refererHost } }
    byPath: rumPageloadEventsAdaptiveGroups(${f}, limit: 300, orderBy: [count_DESC]) { count sum { visits } dimensions { requestPath } }
    byDevice: rumPageloadEventsAdaptiveGroups(${f}, limit: 10, orderBy: [sum_visits_DESC]) { count sum { visits } dimensions { deviceType } }
    byCountry: rumPageloadEventsAdaptiveGroups(${f}, limit: 15, orderBy: [sum_visits_DESC]) { count sum { visits } dimensions { countryName } }
  } }
}`;
};
const WORKER_QUERY = `query Worker($account: string!, $script: string!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }, limit: 2000) {
      sum { requests errors } dimensions { date status }
    }
  } }
}`;
const HTTP_QUERY = `query Http($zone: string!, $from: Time!, $to: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    byStatus: httpRequestsAdaptiveGroups(filter: { datetime_geq: $from, datetime_leq: $to, requestSource: "eyeball", edgeResponseStatus_geq: 400 }, limit: 100, orderBy: [count_DESC]) {
      count dimensions { clientRequestHTTPHost edgeResponseStatus }
    }
    byPath: httpRequestsAdaptiveGroups(filter: { datetime_geq: $from, datetime_leq: $to, requestSource: "eyeball", edgeResponseStatus_geq: 400, clientRequestHTTPHost: "${DEFAULTS.zoneName}" }, limit: 30, orderBy: [count_DESC]) {
      count dimensions { clientRequestPath edgeResponseStatus }
    }
  } }
}`;

/** Where a visit came from, in plain words (Cloudflare gives the referring site's host). */
function sourceName(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  if (!h) return "Direct (typed, bookmark or app)";
  if (/(^|\.)whgemachs\.org$/.test(h) || /\.pages\.dev$/.test(h)) return null; // moving around inside the site
  if (/whatsapp|^wa\.me$|^l\.wl\.co$/.test(h)) return "WhatsApp";
  if (/(^|\.)google\./.test(h) || h === "googleapis.com" || /android-app.*google/.test(h)) return "Google";
  if (/facebook\.com$|^fb\.me$|^l\.facebook/.test(h)) return "Facebook";
  if (/instagram\.com$/.test(h)) return "Instagram";
  if (/bing\.com$|duckduckgo\.com$|yahoo\.com$/.test(h)) return "Other search engines";
  if (/(^|\.)anshei\.org$/.test(h)) return "anshei.org";
  if (/mail\.|outlook\.|gmail/.test(h)) return "Email";
  return h;
}

const merge = (map, key, c, v) => { if (key == null) return; const x = map.get(key) || map.set(key, { pageViews: 0, visits: 0 }).get(key); x.pageViews += c; x.visits += v; };
const sorted = (map, by = "visits", n = 20) => [...map].map(([k, x]) => ({ name: k, ...x })).sort((a, b) => b[by] - a[by] || a.name.localeCompare(b.name)).slice(0, n);

async function buildTraffic(env, days, nowMs = Date.now()) {
  const account = env.CF_ACCOUNT_ID || DEFAULTS.account;
  const siteTag = env.CF_WEB_ANALYTICS_SITE_TAG || DEFAULTS.siteTag;
  const today = nyToday(nowMs);
  const since = addDays(today, -days + 1);
  const problems = [];

  // Visitors, in 30-day windows (newest first).
  const windows = [];
  for (let end = today; end >= since; end = addDays(end, -30)) {
    const start = addDays(end, -29) < since ? since : addDays(end, -29);
    windows.push({ start, end });
  }
  let botFilter = true;
  const rumWindow = async w => {
    const vars = { account, siteTag, from: w.start, to: w.end };
    try { return await gql(env, rumQuery(!botFilter), vars); }
    catch (e) {
      // If Cloudflare doesn't accept the bot filter here, ask again without it (and say so).
      if (botFilter && /\bbot\b/i.test(e.message)) { botFilter = false; return gql(env, rumQuery(true), vars); }
      throw e;
    }
  };
  const first = await rumWindow(windows[0]).then(r => ({ ok: true, r }), e => ({ ok: false, e }));
  const rest = await Promise.all(windows.slice(1).map(w => rumWindow(w).then(r => ({ ok: true, r }), e => ({ ok: false, e }))));
  const rum = [first, ...rest];

  let visitors = null, oldestDay = null;
  const byDate = new Map(), sources = new Map(), paths = new Map(), devices = new Map(), countries = new Map();
  rum.forEach((x, i) => {
    if (!x.ok) {
      // Older windows Cloudflare no longer keeps are expected; anything else is worth showing.
      if (i === 0 || !/old|retention|limit|range|before/i.test(x.e.message)) problems.push(`Visitors: ${x.e.message}`);
      return;
    }
    const acc = x.r.data?.viewer?.accounts?.[0];
    if (!acc) { problems.push("Visitors: Cloudflare returned no data for this account (check the token's account access)"); return; }
    x.r.errors.forEach(m => problems.push(`Visitors: ${m}`));
    oldestDay = windows[i].start;
    for (const g of acc.byDate || []) merge(byDate, g.dimensions?.date, g.count || 0, g.sum?.visits || 0);
    for (const g of acc.bySource || []) merge(sources, sourceName(g.dimensions?.refererHost), 0, g.sum?.visits || 0);
    for (const g of acc.byPath || []) merge(paths, cleanPage(g.dimensions?.requestPath || "/"), g.count || 0, g.sum?.visits || 0);
    for (const g of acc.byDevice || []) merge(devices, g.dimensions?.deviceType || "other", g.count || 0, g.sum?.visits || 0);
    for (const g of acc.byCountry || []) merge(countries, g.dimensions?.countryName || "Unknown", g.count || 0, g.sum?.visits || 0);
  });
  if (rum.some(x => x.ok && x.r.data?.viewer?.accounts?.[0])) {
    const days_ = [...byDate].map(([date, x]) => ({ date, ...x })).sort((a, b) => a.date.localeCompare(b.date));
    // Pages: the home page, each gemach page (/g/<slug>), and everything else.
    const gemachViews = {};
    for (const [p, x] of paths) {
      const m = p.match(/^\/g\/([a-z0-9-]+)$/);
      if (m) { const g = gemachViews[m[1]] || (gemachViews[m[1]] = { pageViews: 0, visits: 0 }); g.pageViews += x.pageViews; g.visits += x.visits; }
    }
    visitors = {
      visits: days_.reduce((n, d) => n + d.visits, 0),
      pageViews: days_.reduce((n, d) => n + d.pageViews, 0),
      byDate: days_,
      sources: sorted(sources, "visits", 12).filter(s => s.visits > 0).map(s => ({ name: s.name, visits: s.visits })),
      devices: sorted(devices, "visits", 5),
      countries: sorted(countries, "visits", 8),
      pages: sorted(paths, "pageViews", 15),
      gemachViews,
      botsExcluded: botFilter,
      from: oldestDay && oldestDay > since ? oldestDay : since,
    };
  }

  // Errors: at most the last 30 days (that's what Cloudflare keeps for these on the free plan).
  const errDays = Math.min(days, 30);
  const fromIso = new Date(nowMs - errDays * DAY_MS).toISOString(), toIso = new Date(nowMs).toISOString();
  let worker = null, http = null;
  const [w, h] = await Promise.all([
    gql(env, WORKER_QUERY, { account, script: env.CF_WORKER_NAME || DEFAULTS.worker, from: fromIso, to: toIso }).then(r => ({ ok: true, r }), e => ({ ok: false, e })),
    zoneId(env).then(zone => gql(env, HTTP_QUERY, { zone, from: fromIso, to: toIso })).then(r => ({ ok: true, r }), e => ({ ok: false, e })),
  ]);
  if (w.ok && w.r.data?.viewer?.accounts?.[0]) {
    w.r.errors.forEach(m => problems.push(`API errors: ${m}`));
    const rows = w.r.data.viewer.accounts[0].workersInvocationsAdaptive || [];
    const byStatus = {}, byDay = new Map();
    let requests = 0, errors = 0;
    for (const g of rows) {
      const st = g.dimensions?.status || "unknown", rq = g.sum?.requests || 0, er = g.sum?.errors || 0;
      requests += rq; errors += er;
      if (st !== "success") byStatus[st] = (byStatus[st] || 0) + rq;
      const d = g.dimensions?.date; if (d) { const x = byDay.get(d) || byDay.set(d, { date: d, requests: 0, errors: 0 }).get(d); x.requests += rq; x.errors += er; }
    }
    worker = { days: errDays, requests, errors, byStatus, byDate: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  } else problems.push(`API errors: ${w.ok ? "no data returned" : w.e.message}`);
  if (h.ok && h.r.data?.viewer?.zones?.[0]) {
    h.r.errors.forEach(m => problems.push(`Page errors: ${m}`));
    const z = h.r.data.viewer.zones[0];
    const totals = { site4xx: 0, site5xx: 0, api4xx: 0, api5xx: 0 };
    for (const g of z.byStatus || []) {
      const host = String(g.dimensions?.clientRequestHTTPHost || ""), st = Number(g.dimensions?.edgeResponseStatus) || 0, c = g.count || 0;
      const side = /^api\./.test(host) ? "api" : "site";
      if (st >= 500) totals[`${side}5xx`] += c; else if (st >= 400) totals[`${side}4xx`] += c;
    }
    const top = new Map();
    for (const g of z.byPath || []) {
      const p = cleanPage(g.dimensions?.clientRequestPath || "/"), st = Number(g.dimensions?.edgeResponseStatus) || 0;
      const k = `${p}|${st}`; const x = top.get(k) || top.set(k, { path: p, status: st, count: 0 }).get(k); x.count += g.count || 0;
    }
    http = { days: errDays, ...totals, top: [...top.values()].sort((a, b) => b.count - a.count).slice(0, 15) };
  } else problems.push(`Page errors: ${h.ok ? "no data returned" : h.e.message}`);

  return { configured: true, days, since, today, visitors, worker, http, problems: [...new Set(problems)].slice(0, 6) };
}

export { handleNetworkTraffic, buildTraffic, sourceName, trafficMemo, gql, DEFAULTS as TRAFFIC_DEFAULTS };
