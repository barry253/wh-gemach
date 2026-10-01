// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// Item photos: Item Types."R2 Photo URL" is the cover (unchanged, so everything that shows one photo keeps working);
// Item Types."More Photos" holds up to 9 more, as a JSON list of links in display order.
// Only our own photo links are accepted: the R2 bucket (ASSETS_URL) or files on the site (/assets/…).

const MAX_MORE_PHOTOS = 9;
const SITE_ASSETS = ["https://whgemachs.org/assets/"];

/** Stored extra photos → clean list of https links (bad data → []). */
function parseMorePhotos(raw) {
  let v = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(u => typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u)))].slice(0, MAX_MORE_PHOTOS);
}

function allowedPhotoUrl(env, u) {
  if (typeof u !== "string" || !/^https:\/\/[^\s"<>]+$/.test(u) || u.length > 500) return false;
  const bases = [...SITE_ASSETS];
  if (env.ASSETS_URL) bases.push(String(env.ASSETS_URL).replace(/\/$/, "") + "/");
  return bases.some(b => u.startsWith(b)) && !u.includes("..");
}

/**
 * body.morePhotos from admin → { skip } | { value: JSON string | null } | { error }.
 * The cover is never repeated in the list.
 */
function validateMorePhotos(env, input, cover) {
  if (input === undefined) return { skip: true };
  if (input === null || input === "") return { value: null };
  if (!Array.isArray(input)) return { error: "Photos must be a list." };
  const list = [...new Set(input.map(u => String(u || "").trim()).filter(Boolean))].filter(u => u !== cover);
  if (list.length > MAX_MORE_PHOTOS) return { error: `Up to ${MAX_MORE_PHOTOS + 1} photos per item.` };
  const bad = list.find(u => !allowedPhotoUrl(env, u));
  if (bad) return { error: "Photos must be uploaded with “Add photos”." };
  return { value: list.length ? JSON.stringify(list) : null };
}

export { MAX_MORE_PHOTOS, parseMorePhotos, allowedPhotoUrl, validateMorePhotos };
