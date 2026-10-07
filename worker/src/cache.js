// Part of the Gemach Network worker (see index.js for routes and env vars).
import { makeDb } from "./db.js";
import { CACHE_MAX_STALE_MS, CACHE_TTL_MS, DEFAULT_CACHE_ORIGIN } from "./config.js";
import { json } from "./http.js";
import { directoryBuilder, gemachBuilder } from "./public.js";

// ─── Public cache (Cache API, stale-while-revalidate) ─────────────────────────

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

function refreshCache(key, build, { force = false } = {}) {
  if (!force && cacheInflight.has(key)) return cacheInflight.get(key);
  if (force && cacheInflight.has(key)) {
    if (!cacheQueued.has(key)) {
      const next = cacheInflight.get(key).catch(() => {}).then(() => {
        cacheQueued.delete(key);
        return refreshCache(key, build, { force: true });
      });
      cacheQueued.set(key, next);
    }
    return cacheQueued.get(key);
  }
  const cache = globalThis.caches?.default;
  const t0 = Date.now();
  const p = (async () => {
    const { status, data } = await build();
    const body = JSON.stringify(data);
    if (status === 200 && cache) {
      await cache.put(new Request(key), new Response(body, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800", "X-Cached-At": String(Date.now()) },
      })).catch(e => console.error("cache put failed:", e.message));
    }
    const ms = Date.now() - t0;
    if (ms > 5000) console.warn(`slow cache rebuild ${key.split("/__cache/")[1]}: ${ms} ms`);
    return { status, body };
  })().finally(() => { if (cacheInflight.get(key) === p) cacheInflight.delete(key); });
  cacheInflight.set(key, p);
  return p;
}

async function cachedJson(env, ctx, key, build) {
  const cache = globalThis.caches?.default;
  const headers = { "Cache-Control": "public, max-age=30" };
  let hit = null;
  if (cache) {
    try { hit = await cache.match(new Request(key)); } catch { /* ignore */ }
    if (hit) {
      const age = Date.now() - (Number(hit.headers.get("X-Cached-At")) || 0);
      if (age < CACHE_TTL_MS) return json(await hit.text(), 200, { ...headers, "X-Cache": "HIT" });
      if (age < CACHE_MAX_STALE_MS && ctx?.waitUntil) {
        ctx.waitUntil(refreshCache(key, build).catch(e => console.error("background refresh failed:", e.message)));
        return json(await hit.text(), 200, { ...headers, "X-Cache": "STALE" });
      }
    }
  }
  // Cold (or very old) cache: rebuild now. waitUntil keeps the rebuild running even if this visitor's
  // browser gives up, so the next visitor gets a warm cache instead of starting over.
  const p = refreshCache(key, build);
  if (ctx?.waitUntil) ctx.waitUntil(p.catch(() => {}));
  try {
    const { status, body } = await p;
    return json(body, status, status === 200 ? { ...headers, "X-Cache": "MISS" } : {});
  } catch (e) {
    if (hit) { // Airtable trouble: an old copy beats an error page
      console.error("rebuild failed, serving old copy:", e.message);
      return json(await hit.text(), 200, { ...headers, "X-Cache": "STALE-ERROR" });
    }
    throw e;
  }
}

/** After an admin change: drop the cached copies, then rebuild them right away so visitors don't hit a cold cache. */
function purgePublicCache(env, ctx, slug) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  const dirKey = cacheKey(env, "directory"), gKey = cacheKey(env, `gemach/${slug}`);
  const p = Promise.all([cache.delete(new Request(dirKey)), cache.delete(new Request(gKey))])
    .catch(e => console.error("cache purge failed:", e.message))
    .then(() => {
      const db = makeDb(env);
      return Promise.all([
        refreshCache(dirKey, directoryBuilder(db), { force: true }), // never reuse a build that started before the change
        refreshCache(gKey, gemachBuilder(db, slug), { force: true }),
      ]);
    })
    .catch(e => console.error("cache rewarm failed:", e.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

export { cacheKey, cacheInflight, cacheQueued, refreshCache, cachedJson, purgePublicCache };
