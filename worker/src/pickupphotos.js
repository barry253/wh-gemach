// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Pickup photos (Nov 2026) ─────────────────────────────────────────────────
// On "Send pickup instructions" an admin can add up to 3 photos (where the items are, which ones are theirs).
// They go to the PRIVATE R2 bucket PICKUP_BUCKET (wh-gemach-pickup; not the public photo bucket, so they are
// never in the public bucket's URL space or its weekly off-site backup). One sheet = one "set":
//   key  <setId>/<n>-<rand>.jpg   setId = 22 random base64url characters (128 bits), so links can't be guessed
//   customMetadata { gemachId, slug, loans: "recA,recB" (every loan of the booking at upload time), at: ISO }
// The borrower gets one link, https://whgemachs.org/p/<setId> (Pages Function functions/p/[id].js), which reads
//   GET /public/pickup-photos/:set         → { gemach, photos: [name…] } (404 once deleted)
//   GET /public/pickup-photo/:set/:name    → the image
// Email (pickup-email with photos: setId) embeds the photos in the message as inline attachments.
// Admin: POST /admin/loans/:id/pickup-photo (multipart "photo", optional "set"), DELETE /admin/pickup-photos/:set[/:name].
// Clean-up (hourly cron, runPickupPhotoCleanup): a set is deleted 30 days after the last of its loans came back
// (Returned → Date Returned; cancelled / missing loans count from the upload), and always after 365 days.

import { T } from "./config.js";
import { selName } from "./gemachs.js";
import { json } from "./http.js";
import { Q, fetchByIds, getOwned, linkedId, firstLink } from "./records.js";
import { sniffImageType } from "./settings.js";

const MAX_PICKUP_PHOTOS = 3;
const MAX_BYTES = 10 * 1024 * 1024;
const KEEP_DAYS_AFTER_RETURN = 30;
const MAX_KEEP_DAYS = 365;
const DAY_MS = 86400000;
const SET_RE = /^[A-Za-z0-9_-]{22}$/;
const NAME_RE = /^[1-9]-[A-Za-z0-9_-]{8}\.(jpg|png|webp)$/;
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const TYPE_OF = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const DEFAULT_SITE = "https://whgemachs.org";

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomId = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
const siteUrl = env => String(env.SITE_URL || DEFAULT_SITE).replace(/\/$/, "");
const pickupLink = (env, set) => `${siteUrl(env)}/p/${set}`;
const isSet = s => SET_RE.test(String(s || ""));

/** The photos of a set, oldest first: [{ key, name, meta }]. */
async function listSet(bucket, set) {
  const out = await bucket.list({ prefix: set + "/", include: ["customMetadata"], limit: 20 });
  return (out.objects || [])
    .map(o => ({ key: o.key, name: o.key.slice(set.length + 1), meta: o.customMetadata || {}, uploaded: o.uploaded }))
    .filter(o => NAME_RE.test(o.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every loan of the booking this loan belongs to (its request's open loans), always including the loan itself. */
async function bookingLoanIds(db, g, loan) {
  const src = linkedId(firstLink(loan.fields["Source Request"]));
  if (!src) return [loan.id];
  const loans = await db.listAll(T.LOANS, { scope: g, where: [Q.linksTo("Source Request", src)], fields: ["Status"] });
  return [...new Set([loan.id, ...loans.map(l => l.id)])].slice(0, 30);
}

/** POST /admin/loans/:id/pickup-photo — multipart "photo" (+ "set" to add to an existing set). */
async function handlePickupPhotoUpload(c, id) {
  const { request, env, db, g } = c;
  const bucket = env.PICKUP_BUCKET;
  if (!bucket) return json({ error: "Photo storage isn't set up yet." }, 503);
  if (!(request.headers.get("Content-Type") || "").includes("multipart/form-data")) return json({ error: "Upload the photo as a file." }, 400);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BYTES + 64 * 1024) return json({ error: "Image too large (max 10MB)" }, 413);
  const loan = await getOwned(db, T.LOANS, id, g);
  if (!loan) return json({ error: "Not found" }, 404);
  if (!["Reserved", "Active"].includes(selName(loan.fields.Status))) return json({ error: "This reservation isn't open any more." }, 409);
  let form;
  try { form = await request.formData(); } catch { return json({ error: "Could not read the upload." }, 400); }
  const file = form.get("photo");
  if (!file || typeof file === "string") return json({ error: "No file provided" }, 400);
  if (file.size > MAX_BYTES) return json({ error: "Image too large (max 10MB)" }, 413);
  const buf = await file.arrayBuffer();
  const type = sniffImageType(buf);
  if (!type) return json({ error: "Please add a JPG, PNG or WebP photo." }, 400);

  let set = String(form.get("set") || "");
  let existing = [];
  if (set) {
    if (!isSet(set)) return json({ error: "Not found" }, 404);
    existing = await listSet(bucket, set);
    if (existing.length && existing[0].meta.gemachId !== g.id) return json({ error: "Not found" }, 404);
    if (existing.length >= MAX_PICKUP_PHOTOS) return json({ error: `Up to ${MAX_PICKUP_PHOTOS} photos.` }, 400);
  } else set = randomId(16);

  const used = new Set(existing.map(o => Number(o.name[0])));
  let n = 1; while (used.has(n)) n++;
  const name = `${n}-${randomId(6)}.${EXT[type]}`;
  const loans = await bookingLoanIds(db, g, loan);
  await bucket.put(`${set}/${name}`, buf, {
    httpMetadata: { contentType: type },
    customMetadata: { gemachId: g.id, slug: g.slug, loans: loans.join(","), at: new Date().toISOString() },
  });
  const photos = [...existing.map(o => o.name), name].sort();
  return json({ success: true, set, url: pickupLink(env, set), photos, name });
}

/** DELETE /admin/pickup-photos/:set[/:name] — remove one photo or the whole set (this gemach's only). */
async function handlePickupPhotoDelete(c, set, name) {
  const bucket = c.env.PICKUP_BUCKET;
  if (!bucket) return json({ error: "Photo storage isn't set up yet." }, 503);
  if (!isSet(set) || (name && !NAME_RE.test(name))) return json({ error: "Not found" }, 404);
  const objs = await listSet(bucket, set);
  if (!objs.length) return json({ success: true, photos: [] });
  if (objs[0].meta.gemachId !== c.g.id) return json({ error: "Not found" }, 404);
  const gone = name ? objs.filter(o => o.name === name) : objs;
  if (gone.length) await bucket.delete(gone.map(o => o.key));
  return json({ success: true, photos: objs.filter(o => !gone.includes(o)).map(o => o.name) });
}

/** Inline email attachments for a set (only this gemach's): { attachments, cids } or null. */
async function pickupPhotoAttachments(env, g, set) {
  const bucket = env.PICKUP_BUCKET;
  if (!bucket || !isSet(set)) return null;
  const objs = await listSet(bucket, set);
  if (!objs.length || objs[0].meta.gemachId !== g.id) return null;
  const attachments = [];
  for (const o of objs.slice(0, MAX_PICKUP_PHOTOS)) {
    const obj = await bucket.get(o.key);
    if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const ext = o.name.split(".").pop();
    const cid = `pickup-${o.name.split(".")[0]}`;
    attachments.push({ filename: `pickup-photo-${attachments.length + 1}.${ext}`, content: btoa(bin), content_type: TYPE_OF[ext], content_id: cid });
  }
  return attachments.length ? { attachments, cids: attachments.map(a => a.content_id) } : null;
}

/** HTML for the photos under the message (cid: references to the inline attachments). */
function pickupPhotosHtml(cids) {
  return cids.map((cid, i) =>
    `<div style="margin:16px 0 0 0;"><img src="cid:${cid}" alt="Pickup photo ${i + 1}" style="display:block;max-width:100%;height:auto;border-radius:8px;border:0;"></div>`).join("");
}

const NO_INDEX = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };

/** GET /public/pickup-photos/:set → { gemach, photos } (names; the page builds the image links). */
async function handlePublicPickupSet(db, env, set) {
  const bucket = env.PICKUP_BUCKET;
  if (!bucket || !isSet(set)) return json({ error: "Not found" }, 404, NO_INDEX);
  const objs = await listSet(bucket, set);
  if (!objs.length) return json({ error: "Not found" }, 404, { ...NO_INDEX, "Cache-Control": "no-store" });
  const gid = objs[0].meta.gemachId;
  const [g] = gid ? await fetchByIds(db, T.GEMACHS, [gid], { fields: ["Name"] }) : [];
  return json({ gemach: g?.fields?.Name || "", photos: objs.map(o => o.name) }, 200, { ...NO_INDEX, "Cache-Control": "no-store" });
}

/** GET /public/pickup-photo/:set/:name → the image bytes. */
async function handlePublicPickupPhoto(env, set, name) {
  const bucket = env.PICKUP_BUCKET;
  if (!bucket || !isSet(set) || !NAME_RE.test(name)) return new Response("Not found", { status: 404, headers: NO_INDEX });
  const obj = await bucket.get(`${set}/${name}`);
  if (!obj) return new Response("Not found", { status: 404, headers: { ...NO_INDEX, "Cache-Control": "no-store" } });
  return new Response(obj.body, {
    headers: {
      ...NO_INDEX,
      "Content-Type": TYPE_OF[name.split(".").pop()],
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/**
 * Should this set be deleted now? loans: the set's loan records found (missing ones are simply absent).
 * Returns true 30 days after the last loan came back; cancelled / missing loans count from the upload.
 */
function pickupSetExpired({ uploadedMs, loans, loanCount, nowMs }) {
  if (nowMs - uploadedMs >= MAX_KEEP_DAYS * DAY_MS) return true;
  if (loans.some(l => ["Reserved", "Active"].includes(selName(l.fields.Status)))) return false;
  let endMs = loans.length < loanCount || !loans.length ? uploadedMs : 0;
  for (const l of loans) {
    const ret = selName(l.fields.Status) === "Returned" && /^\d{4}-\d{2}-\d{2}$/.test(l.fields["Date Returned"] || "")
      ? Date.parse(l.fields["Date Returned"] + "T12:00:00Z") : uploadedMs;
    endMs = Math.max(endMs, ret);
  }
  return nowMs - endMs >= KEEP_DAYS_AFTER_RETURN * DAY_MS;
}

/** Hourly: delete photo sets whose time is up. One D1 query for all their loans. */
async function runPickupPhotoCleanup(env, db, nowMs = Date.now()) {
  const bucket = env.PICKUP_BUCKET;
  if (!bucket) return { sets: 0, deleted: 0 };
  const sets = new Map(); // setId → { keys, uploadedMs, loans }
  let cursor;
  for (let page = 0; page < 20; page++) {
    const out = await bucket.list({ include: ["customMetadata"], limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const o of out.objects || []) {
      const set = o.key.split("/")[0];
      const meta = o.customMetadata || {};
      const at = Date.parse(meta.at || "") || (o.uploaded ? new Date(o.uploaded).getTime() : nowMs);
      const s = sets.get(set) || { keys: [], uploadedMs: at, loans: new Set() };
      s.keys.push(o.key);
      s.uploadedMs = Math.max(s.uploadedMs, at);
      String(meta.loans || "").split(",").filter(x => /^rec[A-Za-z0-9]{14}$/.test(x)).forEach(x => s.loans.add(x));
      sets.set(set, s);
    }
    if (!out.truncated) break;
    cursor = out.cursor;
  }
  if (!sets.size) return { sets: 0, deleted: 0 };
  const allIds = [...new Set([...sets.values()].flatMap(s => [...s.loans]))];
  const found = allIds.length ? await fetchByIds(db, T.LOANS, allIds, { fields: ["Status", "Date Returned"] }) : [];
  const byId = new Map(found.map(l => [l.id, l]));
  const doomed = [];
  for (const s of sets.values()) {
    const loans = [...s.loans].map(id => byId.get(id)).filter(Boolean);
    if (pickupSetExpired({ uploadedMs: s.uploadedMs, loans, loanCount: s.loans.size, nowMs })) doomed.push(...s.keys);
  }
  for (let i = 0; i < doomed.length; i += 1000) await bucket.delete(doomed.slice(i, i + 1000));
  if (doomed.length) console.log(`pickup photos: deleted ${doomed.length} photo(s)`);
  return { sets: sets.size, deleted: doomed.length };
}

export {
  MAX_PICKUP_PHOTOS, handlePickupPhotoUpload, handlePickupPhotoDelete, pickupPhotoAttachments, pickupPhotosHtml,
  handlePublicPickupSet, handlePublicPickupPhoto, pickupSetExpired, runPickupPhotoCleanup, isSet,
};
