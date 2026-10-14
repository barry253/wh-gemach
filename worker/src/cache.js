// Part of the Gemach Network worker (see index.js for routes and env vars).
import { makeDb, useD1 } from "./db.js";
import { CACHE_MAX_STALE_MS, CACHE_TTL_MS, DEFAULT_CACHE_ORIGIN } from "./config.js";
import { json } from "./http.js";
import { directoryBuilder, gemachBuilder } from "./public.js";

// ─── Public cache (Cache API, stale-while-revalidate) ─────────────────────────

// ─── Data version: is a stale copy still current? ─────────────────────────────
// Each Cloudflare location keeps its own cached copies, and an admin change only refreshes the copies in the
// location that handled it. Instead of rebuilding every page from the database once a minute everywhere (each
// directory rebuild reads thousands of rows; D1 Free allows 5M a day), every admin change writes a new
// "data_version" (one row, site_meta). When a copy is over a minute old, its location reads that one row: same
// version → keep the copy another minute; different → rebuild. Copies are rebuilt at least every RECHECK_MAX_MS
// anyway (quantity "free today" counts roll over at midnight; edits made straight in D1 don't bump the version).
const VERSION_ROW_ID = "recSITEMETADATAV1";
const RECHECK_MAX_MS = 30 * 60 * 1000;
let versionMemo = { v: null, at: 0 };

async function dataVersion(env) {
  if (!useD1(env) || !env.DB) return null;
  if (Date.now() - versionMemo.at < 5000) return versionMemo.v;
  try {
    const r = await env.DB.prepare("SELECT value FROM site_meta WHERE id = ?").bind(VERSION_ROW_ID).all();
    versionMemo = { v: String(r.results?.[0]?.value ?? "0"), at: Date.now() };
    return versionMemo.v;
  } catch (e) {
    console.error("data version read failed:", e.message);
    return null; // unknown: behave as before (rebuild when stale)
  }
}

async function bumpDataVersion(env) {
  if (!useD1(env) || !env.DB) return;
  const v = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await env.DB.prepare("INSERT INTO site_meta (id, created_at, key, value) VALUES (?, ?, 'data_version', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
      .bind(VERSION_ROW_ID, new Date().toISOString(), v).run();
    versionMemo = { v, at: Date.now() };
  } catch (e) {
    console.error("data version bump failed:", e.message);
    versionMemo = { v: null, at: 0 };
  }
}

// In-memory copy per worker instance, used when the Cache API has nothing (the workers.dev address has no
// cache at all), so a burst of visits there doesn't rebuild from the database on every request.
const memCache = new Map(); // key -> { body, cachedAt, builtAt, version }

function cacheKey(env, name) {
  return `${(env.CACHE_ORIGIN || DEFAULT_CACHE_ORIGIN).replace(/\/$/, "")}/__cache/v1/${name}`;
}

// One rebuild per key at a time in this isolate; concurrent visitors share it.
const cacheInflight = new Map();
// Forced rebuilds (after admin changes) that arrive while one is running are merged into ONE follow-up
// rebuild that starts when the current one ends, so it still sees every change. Without this, a bulk
// edit (hundreds of saves in a row) started hundreds of full page rebuilds at once in one worker
// instance, which ran it out of resources and made unrelated admin requests fail for minutes.
const cacheQueued = new Map();

function refreshCache(key, build, { force = false, env = null } = {}) {
  if (!force && cacheInflight.has(key)) return cacheInflight.get(key);
  if (force && cacheInflight.has(key)) {
    if (!cacheQueued.has(key)) {
      const next = cacheInflight.get(key).catch(() => {}).then(() => {
        cacheQueued.delete(key);
        return refreshCache(key, build, { force: true, env });
      });
      cacheQueued.set(key, next);
    }
    return cacheQueued.get(key);
  }
  const cache = globalThis.caches?.default;
  const t0 = Date.now();
  const p = (async () => {
    const version = env ? await dataVersion(env) : null; // read BEFORE building: a change during the build shows as a new version
    const { status, data } = await build();
    const body = JSON.stringify(data);
    const now = Date.now();
    if (status === 200) {
      if (cache) memCache.set(key, { body, cachedAt: now, builtAt: now, version });
      if (cache) await cache.put(new Request(key), cachedResponse(body, now, now, version)).catch(e => console.error("cache put failed:", e.message));
    } else {
      // Gone (e.g. the gemach was hidden): drop the old copy so this location stops serving it.
      memCache.delete(key);
      if (cache) await cache.delete(new Request(key)).catch(() => {});
    }
    const ms = Date.now() - t0;
    if (ms > 5000) console.warn(`slow cache rebuild ${key.split("/__cache/")[1]}: ${ms} ms`);
    return { status, body };
  })().finally(() => { if (cacheInflight.get(key) === p) cacheInflight.delete(key); });
  cacheInflight.set(key, p);
  return p;
}

function cachedResponse(body, cachedAt, builtAt, version) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800", "X-Cached-At": String(cachedAt), "X-Built-At": String(builtAt) };
  if (version != null) headers["X-Data-Version"] = version;
  return new Response(body, { headers });
}

async function cachedJson(env, ctx, key, build) {
  const cache = globalThis.caches?.default;
  const headers = { "Cache-Control": "public, max-age=30" };
  let entry = null; // { body, cachedAt, builtAt, version }
  if (cache) {
    let hit = null;
    try { hit = await cache.match(new Request(key)); } catch { /* ignore */ }
    if (hit) {
      const cachedAt = Number(hit.headers.get("X-Cached-At")) || 0;
      entry = { body: await hit.text(), cachedAt, builtAt: Math.min(cachedAt, Number(hit.headers.get("X-Built-At")) || cachedAt), version: hit.headers.get("X-Data-Version") };
    }
  }
  if (!entry && cache && memCache.has(key)) { // (no Cache API at all = tests / local: always build fresh)
    const m = memCache.get(key);
    if (Date.now() - m.cachedAt < CACHE_TTL_MS) return json(m.body, 200, { ...headers, "X-Cache": "MEM" });
    entry = m;
  }
  if (entry) {
    const now = Date.now(), age = now - entry.cachedAt;
    if (age < CACHE_TTL_MS) return json(entry.body, 200, { ...headers, "X-Cache": "HIT" });
    // Stale, but nothing changed since it was built: keep it another minute (one tiny read instead of a rebuild).
    if (entry.version && now - entry.builtAt < RECHECK_MAX_MS) {
      const v = await dataVersion(env);
      if (v !== null && v === entry.version) {
        memCache.set(key, { ...entry, cachedAt: now });
        if (cache) {
          const put = cache.put(new Request(key), cachedResponse(entry.body, now, entry.builtAt, v)).catch(() => {});
          if (ctx?.waitUntil) ctx.waitUntil(put);
        }
        return json(entry.body, 200, { ...headers, "X-Cache": "CURRENT" });
      }
    }
    if (age < CACHE_MAX_STALE_MS && ctx?.waitUntil) {
      ctx.waitUntil(refreshCache(key, build, { env }).catch(e => console.error("background refresh failed:", e.message)));
      return json(entry.body, 200, { ...headers, "X-Cache": "STALE" });
    }
  }
  const hit = entry;
  // Cold (or very old) cache: rebuild now. waitUntil keeps the rebuild running even if this visitor's
  // browser gives up, so the next visitor gets a warm cache instead of starting over.
  const p = refreshCache(key, build, { env });
  if (ctx?.waitUntil) ctx.waitUntil(p.catch(() => {}));
  try {
    const { status, body } = await p;
    return json(body, status, status === 200 ? { ...headers, "X-Cache": "MISS" } : {});
  } catch (e) {
    if (hit) { // Airtable trouble: an old copy beats an error page
      console.error("rebuild failed, serving old copy:", e.message);
      return json(hit.body, 200, { ...headers, "X-Cache": "STALE-ERROR" });
    }
    throw e;
  }
}

/** After an admin change: drop the cached copies, then rebuild them right away so visitors don't hit a cold cache. */
function purgePublicCache(env, ctx, slug) {
  const cache = globalThis.caches?.default;
  const dirKey = cacheKey(env, "directory"), gKey = cacheKey(env, `gemach/${slug}`), cKey = cacheKey(env, `contact/${slug}`);
  memCache.delete(dirKey); memCache.delete(gKey); memCache.delete(cKey);
  // New data version first: every other location sees its copies are out of date at its next check.
  const p = bumpDataVersion(env)
    .then(() => cache ? Promise.all([cache.delete(new Request(dirKey)), cache.delete(new Request(gKey)), cache.delete(new Request(cKey))]) : null)
    .catch(e => console.error("cache purge failed:", e.message))
    .then(() => {
      if (!cache) return null;
      const db = makeDb(env);
      return Promise.all([
        refreshCache(dirKey, directoryBuilder(db), { force: true, env }), // never reuse a build that started before the change
        refreshCache(gKey, gemachBuilder(db, slug), { force: true, env }),
      ]);
    })
    .catch(e => console.error("cache rewarm failed:", e.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

export { cacheKey, cacheInflight, cacheQueued, memCache, refreshCache, cachedJson, purgePublicCache, dataVersion, bumpDataVersion, RECHECK_MAX_MS };
