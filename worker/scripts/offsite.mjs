// Off-site backups: copies of the nightly database backup and the photo bucket kept as GitHub Release
// assets in a separate PRIVATE repo (default barry253/wh-gemach-backups), outside the Cloudflare account.
// Run by .github/workflows/d1-backup.yml (database, nightly) and assets-backup.yml (photos, weekly).
// Nothing here is bundled into the worker. The pure functions are tested in test/offsite.test.mjs.
//
// Environment: BACKUP_REPO ("owner/name"), GH_TOKEN (fine-grained token: Contents read/write on that repo only).
//
// Database: one release per month (tag db-YYYY-MM), one encrypted asset per night
//   (wh-gemach-<UTC stamp>.sql.gz.age). Kept: every nightly for 90 days, then the first one of each month forever.
// Photos: tags photos-full-YYYY-MM-DD-HHMM (the whole bucket) and photos-inc-YYYY-MM-DD-HHMM (only files new or
//   changed since the previous photo release). Each has manifest.json (every key + size + ETag at that time)
//   and part-NNN.tar files (each under 1.9 GB, the 2 GiB per-file limit). A new full set every 91 days;
//   kept: the newest two full sets and every incremental after the older of them.
//
//   node scripts/offsite.mjs db-prune
//   node scripts/offsite.mjs photos-prev <out.json>                 latest photo manifest (or {}), + last full date
//   node scripts/offsite.mjs photos-plan <prev.json> <listing.json> <outdir> [--full]
//   node scripts/offsite.mjs photos-prune
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const DB_KEEP_DAYS = 90;
export const FULL_EVERY_DAYS = 91;
export const PART_MAX_BYTES = 1900 * 1024 * 1024;
const DAY = 86400e3;

// ─── Pure parts ───────────────────────────────────────────────────────────────

/** "wh-gemach-2026-10-23T0717Z.sql.gz.age" → ms, else null. */
export function stampOf(name) {
  const m = /(\d{4}-\d\d-\d\d)T(\d\d)(\d\d)Z/.exec(String(name));
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) : null;
}

/**
 * Database assets to delete. `assets` = [{ id, name, created_at }] across all db-* releases.
 * Keeps everything newer than keepDays; of older ones, keeps the earliest in each calendar month (UTC).
 */
export function dbDeletions(assets, now, keepDays = DB_KEEP_DAYS) {
  const when = a => stampOf(a.name) ?? Date.parse(a.created_at);
  const old = assets.filter(a => now - when(a) > keepDays * DAY).sort((a, b) => when(a) - when(b));
  const firstOfMonth = new Set();
  const seen = new Set();
  for (const a of assets.slice().sort((a, b) => when(a) - when(b))) {
    const month = new Date(when(a)).toISOString().slice(0, 7);
    if (!seen.has(month)) { seen.add(month); firstOfMonth.add(a.id); }
  }
  return old.filter(a => !firstOfMonth.has(a.id)).map(a => a.id);
}

/** Keys must be plain relative paths (they become file names inside tar files). */
export function safeKey(key) {
  const k = String(key);
  return k.length > 0 && k.length <= 1024 && !k.startsWith("/") && !k.split("/").some(p => p === ".." || p === "." || p === "") && !/[\0\r\n]/.test(k);
}

/**
 * What goes into this week's photo release.
 * prev = previous manifest ({ objects: { key: { size, etag } }, lastFull: "YYYY-MM-DD" }) or {}.
 * listing = [{ Key, Size, ETag }] (aws s3api list-objects-v2 Contents).
 * Returns { kind: "full" | "inc" | "none", files: [{ key, size }], deleted: [keys], skipped: [keys], manifest }.
 */
export function photosPlan(prev, listing, { now, full = false, fullEveryDays = FULL_EVERY_DAYS } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const objects = {};
  const skipped = [];
  for (const o of listing || []) {
    if (!safeKey(o.Key)) { skipped.push(String(o.Key)); continue; }
    objects[o.Key] = { size: Number(o.Size) || 0, etag: String(o.ETag || "").replace(/"/g, "") };
  }
  const before = (prev && prev.objects) || {};
  const lastFull = prev && prev.lastFull;
  const needFull = full || !lastFull || now - Date.parse(`${lastFull}T00:00:00Z`) >= fullEveryDays * DAY;
  const keys = Object.keys(objects).sort();
  const changed = needFull ? keys : keys.filter(k => !before[k] || before[k].etag !== objects[k].etag || before[k].size !== objects[k].size);
  const deleted = Object.keys(before).filter(k => !objects[k]).sort();
  const kind = needFull ? "full" : changed.length ? "inc" : "none";
  const manifest = {
    created: new Date(now).toISOString(), kind, lastFull: needFull ? today : lastFull,
    count: keys.length, bytes: keys.reduce((s, k) => s + objects[k].size, 0),
    inThisRelease: changed.length, deletedSinceLast: deleted, objects,
  };
  return { kind, files: changed.map(k => ({ key: k, size: objects[k].size })), deleted, skipped, manifest };
}

/** Groups files into tar parts under maxBytes each (a single bigger file gets a part of its own). */
export function splitParts(files, maxBytes = PART_MAX_BYTES) {
  const parts = [];
  let cur = [], size = 0;
  for (const f of files) {
    const s = f.size + 1024; // tar header + padding, roughly
    if (cur.length && size + s > maxBytes) { parts.push(cur); cur = []; size = 0; }
    cur.push(f.key); size += s;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/**
 * Photo releases to delete. releases = [{ id, tag_name }]. Keeps the newest two full sets and every
 * incremental made after the older of them; deletes the rest. Never deletes anything while
 * fewer than two full sets exist.
 */
export const PHOTO_TAG = /^photos-(full|inc)-(\d{4}-\d\d-\d\d)-(\d{4})$/;
/** "photos-inc-2026-10-25-0823" → "2026-10-25-0823" (sorts by time), else "". */
export const photoTagTime = tag => { const m = PHOTO_TAG.exec(tag || ""); return m ? `${m[2]}-${m[3]}` : ""; };

export function photoDeletions(releases) {
  const dated = releases.map(r => {
    const m = PHOTO_TAG.exec(r.tag_name || "");
    return m ? { ...r, kind: m[1], day: `${m[2]}-${m[3]}` } : null;
  }).filter(Boolean);
  const fulls = dated.filter(r => r.kind === "full").map(r => r.day).sort().reverse();
  if (fulls.length < 2) return [];
  const keepFrom = fulls[1];
  return dated.filter(r => r.day < keepFrom).map(r => ({ id: r.id, tag: r.tag_name }));
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

const need = name => {
  const v = process.env[name];
  if (!v) { console.error(`Missing environment variable ${name}`); process.exit(2); }
  return v;
};

async function gh(path, init = {}) {
  const res = await fetch(path.startsWith("http") ? path : `https://api.github.com/repos/${need("BACKUP_REPO")}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${need("GH_TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GitHub ${init.method || "GET"} ${path}: ${res.status} ${data?.message || ""}`);
  return data;
}

async function allPages(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const batch = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) return out;
  }
}

async function deleteRelease(r) {
  await gh(`/releases/${r.id}`, { method: "DELETE" });
  await gh(`/git/refs/tags/${encodeURIComponent(r.tag)}`, { method: "DELETE" }).catch(e => console.warn(`tag ${r.tag}: ${e.message}`));
}

async function dbPrune() {
  const releases = (await allPages("/releases")).filter(r => /^db-\d{4}-\d\d$/.test(r.tag_name));
  const assets = [];
  for (const r of releases) for (const a of await allPages(`/releases/${r.id}/assets`)) assets.push({ id: a.id, name: a.name, created_at: a.created_at, release: r });
  const del = new Set(dbDeletions(assets, Date.now()));
  for (const a of assets.filter(a => del.has(a.id))) await gh(`/releases/assets/${a.id}`, { method: "DELETE" });
  // A month whose nightlies were all pruned except its first keeps its release; empty releases go.
  let emptied = 0;
  for (const r of releases) {
    if (!assets.some(a => a.release.id === r.id && !del.has(a.id))) { await deleteRelease({ id: r.id, tag: r.tag_name }); emptied++; }
  }
  console.log(`database copies: ${assets.length} stored, ${del.size} older ones removed${emptied ? `, ${emptied} empty month(s) removed` : ""}`);
}

async function photosPrev(out) {
  const releases = (await allPages("/releases")).filter(r => PHOTO_TAG.test(r.tag_name))
    .sort((a, b) => photoTagTime(b.tag_name).localeCompare(photoTagTime(a.tag_name)));
  for (const r of releases) {
    const asset = r.assets.find(a => a.name === "manifest.json");
    if (!asset) continue;
    const res = await fetch(asset.url, { headers: { Authorization: `Bearer ${need("GH_TOKEN")}`, Accept: "application/octet-stream" } });
    if (!res.ok) throw new Error(`manifest download: ${res.status}`);
    writeFileSync(out, await res.text());
    console.log(`previous photo release: ${r.tag_name}`);
    return;
  }
  writeFileSync(out, "{}");
  console.log("no previous photo release: this one is a full set");
}

function photosPlanCli(prevFile, listingFile, outdir, full) {
  const prev = JSON.parse(readFileSync(prevFile, "utf8") || "{}");
  const raw = readFileSync(listingFile, "utf8").trim();
  const listing = raw ? (JSON.parse(raw).Contents || []) : [];
  const plan = photosPlan(prev, listing, { now: Date.now(), full });
  mkdirSync(outdir, { recursive: true });
  writeFileSync(join(outdir, "manifest.json"), JSON.stringify(plan.manifest, null, 1));
  const parts = splitParts(plan.files);
  parts.forEach((keys, i) => writeFileSync(join(outdir, `part-${String(i + 1).padStart(3, "0")}.list`), keys.join("\n") + "\n"));
  const mb = n => (n / 1048576).toFixed(1);
  console.log(`bucket: ${plan.manifest.count} files, ${mb(plan.manifest.bytes)} MB · this release: ${plan.kind}, ${plan.files.length} files in ${parts.length} part(s), ${mb(plan.files.reduce((s, f) => s + f.size, 0))} MB · removed since last: ${plan.deleted.length}`);
  if (plan.skipped.length) console.log(`::warning title=Photo keys skipped::${plan.skipped.length} key(s) aren't plain paths and were not copied`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kind=${plan.kind}\nparts=${parts.length}\nfiles=${plan.files.length}\ncount=${plan.manifest.count}\nbytes=${plan.manifest.bytes}\n`);
}

async function photosPrune() {
  const releases = await allPages("/releases");
  const del = photoDeletions(releases);
  for (const r of del) await deleteRelease(r);
  console.log(`photo releases: ${releases.filter(r => r.tag_name.startsWith("photos-")).length} stored, ${del.length} older ones removed`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  const run = {
    "db-prune": () => dbPrune(),
    "photos-prev": () => photosPrev(args[0]),
    "photos-plan": () => photosPlanCli(args[0], args[1], args[2], args.includes("--full")),
    "photos-prune": () => photosPrune(),
  }[cmd];
  if (!run) { console.error("usage: node scripts/offsite.mjs db-prune | photos-prev <out> | photos-plan <prev> <listing> <outdir> [--full] | photos-prune"); process.exit(2); }
  Promise.resolve(run()).catch(e => { console.error(e.message); process.exit(1); });
}
