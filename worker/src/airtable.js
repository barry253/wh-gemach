// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AIRTABLE_API, AIRTABLE_CONCURRENCY, AIRTABLE_HEDGE_MAX, AIRTABLE_HEDGE_MS, ID_CHUNK, REC_RE } from "./config.js";
import { Q, toFormula, fStr, fAnd, scopeF, idsF } from "./query.js";

// ─── Airtable data layer (per-request: concurrency limit + 429 retry + paging) ─

class AirtableError extends Error {
  constructor(status, detail) {
    super(detail?.error?.message || detail?.error?.type || `Airtable HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeDb(env) {
  const limit = makeLimiter(AIRTABLE_CONCURRENCY);
  const tpath = t => encodeURIComponent(t);
  // Per-request tally, reported in the Server-Timing header and in the slow-request log line.
  const stats = { calls: 0, retries: 0, ms: 0, waitMs: 0, slowest: 0, slowestPath: "", hedges: 0, hedgeWins: 0 };
  const hedgeMs = Number(env.AIRTABLE_HEDGE_MS) > 0 ? Number(env.AIRTABLE_HEDGE_MS) : AIRTABLE_HEDGE_MS;

  // One HTTP call. For reads, a call still unanswered after hedgeMs gets a duplicate; the first
  // response wins and the other is aborted. Network errors only count if both copies fail.
  async function send(url, init, isRead) {
    const one = () => { const ac = new AbortController(); return { ac, p: fetch(url, { ...init, signal: ac.signal }) }; };
    const a = one();
    if (!isRead || stats.hedges >= AIRTABLE_HEDGE_MAX) return a.p;
    let timer;
    const late = new Promise(r => { timer = setTimeout(() => r("late"), hedgeMs); });
    const first = await Promise.race([a.p.then(() => "a", () => "a"), late]);
    clearTimeout(timer);
    if (first === "a") return a.p;
    stats.hedges++; stats.calls++;
    const b = one();
    const tag = (x, name) => x.p.then(res => ({ res, name }));
    try {
      const { res, name } = await Promise.any([tag(a, "a"), tag(b, "b")]);
      (name === "a" ? b : a).ac.abort();
      if (name === "b") stats.hedgeWins++;
      return res;
    } catch (e) { throw e.errors?.[0] || e; }
  }

  function request(path, { method = "GET", body } = {}) {
    const queued = Date.now();
    return limit(async () => {
      stats.waitMs += Date.now() - queued;
      for (let attempt = 0; ; attempt++) {
        const t0 = Date.now();
        stats.calls++;
        const isRead = method === "GET" || (method === "POST" && path.split("?")[0].endsWith("/listRecords"));
        const res = await send(`${AIRTABLE_API}/${env.AIRTABLE_BASE_ID}/${path}`, {
          method,
          headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        }, isRead);
        const took = Date.now() - t0;
        stats.ms += took;
        if (took > stats.slowest) { stats.slowest = took; stats.slowestPath = `${method} ${path.split("?")[0]}`; }
        if ((res.status === 429 || res.status === 503) && attempt < 3) {
          stats.retries++;
          console.warn(`Airtable ${res.status} (rate limited) on ${method} ${path.split("?")[0]} — retry ${attempt + 1}`);
          await res.text().catch(() => {});
          const ra = Number(res.headers.get("Retry-After"));
          await sleep(ra > 0 ? Math.min(ra, 30) * 1000 : 1000 * 2 ** attempt + Math.random() * 250);
          continue;
        }
        return res;
      }
    });
  }

  async function call(path, opts) {
    const res = await request(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AirtableError(res.status, data);
    return data;
  }

  // Queries are structured ({ scope: g, where: [Q...] }, see query.js) so they can also run on D1.
  async function listPage(table, { scope, where, filter, sort, fields, pageSize, offset, maxRecords } = {}) {
    if (filter !== undefined) throw new Error("raw Airtable formulas are no longer accepted; use scope/where (query.js)");
    const body = {};
    const formula = toFormula({ scope, where });
    if (formula) body.filterByFormula = formula;
    if (sort) body.sort = sort;
    if (fields) body.fields = fields;
    if (pageSize) body.pageSize = pageSize;
    if (maxRecords) body.maxRecords = maxRecords;
    if (offset) body.offset = offset;
    const data = await call(`${tpath(table)}/listRecords`, { method: "POST", body });
    return { records: data.records || [], offset: data.offset || null };
  }

  async function listAll(table, opts = {}) {
    const out = [];
    let offset = null;
    do {
      const page = await listPage(table, { ...opts, offset });
      out.push(...page.records);
      offset = page.offset;
    } while (offset);
    return out;
  }

  async function get(table, id) {
    if (!REC_RE.test(id || "")) return null;
    const res = await request(`${tpath(table)}/${id}`);
    if (res.status === 404) { await res.text().catch(() => {}); return null; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AirtableError(res.status, data);
    return data;
  }

  return {
    engine: "airtable", stats, request, call, listPage, listAll, get,
    create: (table, fields) => call(tpath(table), { method: "POST", body: { fields } }),
    // Same shape as D1's createMany (one POST per record; the Airtable layer is only a fallback now).
    createMany: async (table, list) => { const out = []; for (const fields of list || []) out.push(await call(tpath(table), { method: "POST", body: { fields } })); return out; },
    update: (table, id, fields) => call(`${tpath(table)}/${id}`, { method: "PATCH", body: { fields } }),
    del: (table, id) => call(`${tpath(table)}/${id}`, { method: "DELETE" }),
  };
}


// ─── Record helpers ───────────────────────────────────────────────────────────

const linkedId = v => (!v ? null : typeof v === "string" ? v : v.id || null);
const linkedName = v => (v && typeof v === "object" ? v.name || null : null);
const firstLink = v => (Array.isArray(v) ? v[0] : v);
const today = () => new Date().toISOString().split("T")[0];

function belongs(rec, g) {
  const links = (rec?.fields?.Gemach || []).map(linkedId);
  return links.length === 1 && links[0] === g.id;
}

/** Fetch a record by id and verify it belongs to gemach g; null if missing or foreign. */
async function getOwned(db, table, id, g) {
  if (typeof id !== "string" || !REC_RE.test(id)) return null;
  const rec = await db.get(table, id);
  return belongs(rec, g) ? rec : null;
}

/** Batched fetch by record id (chunked OR(RECORD_ID()=...)), optionally scoped to a gemach. */
async function fetchByIds(db, table, ids, { g = null, fields } = {}) {
  const uniq = [...new Set((ids || []).map(linkedId).filter(id => REC_RE.test(id || "")))];
  if (!uniq.length) return [];
  const chunks = [];
  for (let i = 0; i < uniq.length; i += ID_CHUNK) chunks.push(uniq.slice(i, i + ID_CHUNK));
  const results = await Promise.all(chunks.map(chunk =>
    db.listAll(table, { scope: g, where: [Q.idIn(chunk)], fields })
  ));
  return results.flat();
}

/** True iff every id is a valid record id that belongs to gemach g. Returns the records map when ok. */
async function verifyOwnedIds(db, table, ids, g) {
  const list = (ids || []).map(linkedId);
  if (list.some(id => typeof id !== "string" || !REC_RE.test(id))) return null;
  const recs = await fetchByIds(db, table, list, { g });
  const map = Object.fromEntries(recs.filter(r => belongs(r, g)).map(r => [r.id, r]));
  return list.every(id => map[id]) ? map : null;
}

export { AirtableError, makeLimiter, sleep, makeDb, Q, fStr, fAnd, scopeF, idsF, linkedId, linkedName, firstLink, today, belongs, getOwned, fetchByIds, verifyOwnedIds };
