// Tests for the off-site backup planning (scripts/offsite.mjs): which copies are kept, which photos
// go into a release, how they're split into parts. No network.
import assert from "node:assert/strict";
import { dbDeletions, stampOf, safeKey, photosPlan, splitParts, photoDeletions, photoTagTime, PART_MAX_BYTES } from "../scripts/offsite.mjs";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); process.exitCode = 1; }
}
const DAY = 86400e3;
const name = ms => `wh-gemach-${new Date(ms).toISOString().slice(0, 16).replace(":", "")}Z.sql.gz.age`;

t("offsite: stamp parsed from the backup file name", () => {
  assert.equal(stampOf("wh-gemach-2026-10-23T0717Z.sql.gz.age"), Date.parse("2026-10-23T07:17:00Z"));
  assert.equal(stampOf("notes.txt"), null);
});

t("offsite db: keeps 90 days of nightlies, then the first of each month forever", () => {
  const now = Date.parse("2027-06-15T12:00:00Z");
  const assets = [];
  for (let ms = Date.parse("2026-10-07T07:17:00Z"); ms <= now; ms += DAY) assets.push({ id: assets.length + 1, name: name(ms), created_at: new Date(ms + 60e3).toISOString() });
  const del = new Set(dbDeletions(assets, now));
  const kept = assets.filter(a => !del.has(a.id));
  for (const a of assets) {
    const ms = stampOf(a.name);
    if (now - ms <= 90 * DAY) assert.ok(!del.has(a.id), "recent kept: " + a.name);
  }
  const old = kept.filter(a => now - stampOf(a.name) > 90 * DAY).map(a => a.name.slice(10, 20));
  assert.deepEqual(old, ["2026-10-07", "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01"]);
  assert.ok(del.size > 100);
  // running again deletes nothing more
  assert.deepEqual(dbDeletions(kept, now), []);
});

t("offsite db: a month whose first night was missed keeps its earliest copy; created_at used when the name has no stamp", () => {
  const now = Date.parse("2027-06-01T00:00:00Z");
  const assets = [
    { id: 1, name: "wh-gemach-2026-11-03T0717Z.sql.gz.age", created_at: "2026-11-03T07:18:00Z" },
    { id: 2, name: "wh-gemach-2026-11-04T0717Z.sql.gz.age", created_at: "2026-11-04T07:18:00Z" },
    { id: 3, name: "odd.age", created_at: "2026-11-05T07:18:00Z" },
  ];
  assert.deepEqual(dbDeletions(assets, now).sort(), [2, 3]);
});

t("offsite photos: safe keys only", () => {
  assert.ok(safeKey("simcha-dress/photos/1791221989715-sd-021.jpg"));
  for (const k of ["", "/abs.jpg", "a/../b.jpg", "a//b.jpg", "./a.jpg", "a\nb.jpg"]) assert.ok(!safeKey(k), JSON.stringify(k));
});

const L = (...items) => items.map(([Key, Size, ETag]) => ({ Key, Size, ETag: `"${ETag}"` }));

t("offsite photos: first run is a full set of the whole bucket", () => {
  const now = Date.parse("2026-10-25T08:23:00Z");
  const p = photosPlan({}, L(["a/1.jpg", 100, "e1"], ["b/2.jpg", 200, "e2"], ["../x", 5, "e3"]), { now });
  assert.equal(p.kind, "full");
  assert.deepEqual(p.files.map(f => f.key), ["a/1.jpg", "b/2.jpg"]);
  assert.deepEqual(p.skipped, ["../x"]);
  assert.equal(p.manifest.lastFull, "2026-10-25");
  assert.equal(p.manifest.count, 2); assert.equal(p.manifest.bytes, 300);
  assert.deepEqual(p.manifest.objects["a/1.jpg"], { size: 100, etag: "e1" });
});

t("offsite photos: later runs carry only new or changed files, note removed ones, and skip when nothing changed", () => {
  const prev = photosPlan({}, L(["a/1.jpg", 100, "e1"], ["b/2.jpg", 200, "e2"], ["c/3.jpg", 50, "e3"]), { now: Date.parse("2026-10-25T08:23:00Z") }).manifest;
  const now = Date.parse("2026-11-01T08:23:00Z");
  const p = photosPlan(prev, L(["a/1.jpg", 100, "e1"], ["b/2.jpg", 210, "e2b"], ["d/4.jpg", 70, "e4"]), { now });
  assert.equal(p.kind, "inc");
  assert.deepEqual(p.files.map(f => f.key), ["b/2.jpg", "d/4.jpg"]);
  assert.deepEqual(p.deleted, ["c/3.jpg"]);
  assert.equal(p.manifest.lastFull, "2026-10-25", "full date carried forward");
  const same = photosPlan(p.manifest, L(["a/1.jpg", 100, "e1"], ["b/2.jpg", 210, "e2b"], ["d/4.jpg", 70, "e4"]), { now: now + 7 * DAY });
  assert.equal(same.kind, "none"); assert.equal(same.files.length, 0);
});

t("offsite photos: a new full set every 91 days, or when asked", () => {
  const prev = { lastFull: "2026-10-25", objects: { "a/1.jpg": { size: 1, etag: "e" } } };
  const listing = L(["a/1.jpg", 1, "e"]);
  assert.equal(photosPlan(prev, listing, { now: Date.parse("2027-01-23T08:00:00Z") }).kind, "none");
  assert.equal(photosPlan(prev, listing, { now: Date.parse("2027-01-24T08:00:00Z") }).kind, "full");
  assert.equal(photosPlan(prev, listing, { now: Date.parse("2026-11-01T08:00:00Z"), full: true }).kind, "full");
});

t("offsite photos: parts stay under the size limit", () => {
  const files = Array.from({ length: 10 }, (_, i) => ({ key: `f${i}`, size: 500 * 1048576 }));
  const parts = splitParts(files);
  assert.deepEqual(parts.map(p => p.length), [3, 3, 3, 1]);
  for (const p of parts) assert.ok(p.length * (500 * 1048576 + 1024) <= PART_MAX_BYTES);
  assert.deepEqual(splitParts([{ key: "huge", size: 3e9 }, { key: "s", size: 1 }]), [["huge"], ["s"]]);
  assert.deepEqual(splitParts([]), []);
});

t("offsite photos: keeps the newest two full sets and what came after the older one", () => {
  const R = tags => tags.map((tag_name, i) => ({ id: i + 1, tag_name }));
  const rel = R(["photos-full-2026-10-25-0823", "photos-inc-2026-11-01-0823", "photos-full-2027-01-24-0823", "photos-inc-2027-01-31-0823",
    "photos-full-2027-04-25-0823", "photos-inc-2027-05-02-0823", "db-2026-10", "photos-misc"]);
  assert.deepEqual(photoDeletions(rel).map(r => r.tag), ["photos-full-2026-10-25-0823", "photos-inc-2026-11-01-0823"]);
  assert.deepEqual(photoDeletions(rel.slice(0, 4)), [], "only one older full set: nothing removed");
  assert.equal(photoTagTime("photos-inc-2027-05-02-0823"), "2027-05-02-0823");
  assert.equal(photoTagTime("db-2026-10"), "");
});

console.log(`offsite tests: ${pass} passed, ${fail} failed`);
