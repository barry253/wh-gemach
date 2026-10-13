// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// Catalog extras, made for the Sefer Shelf (a children's book library) but usable by any gemach:
//   Item Types."Byline"        optional line under the name (a book's author / publisher)
//   Item Types."Search Words"  extra words home-page and gemach-page search match (never shown)
//   Item Types."Featured"      shown in a "Featured" strip at the top of the gemach page
//   Item Types."New Until"     date (YYYY-MM-DD): shown in a "New" strip, with a New tag, through that day
//   Gemachs."Group By"         one of the gemach's item filters: the page is split into sections by its values
//   Gemachs."Spotlight Filter" one of the gemach's item filters whose values are holiday names (Chanukah, Pesach…):
//                              the page puts the next holiday's items in a strip shortly before it
//   Gemachs."Borrow Note"      Listing only: how to borrow (e.g. "Visit during open hours"), shown instead of
//                              "contact them directly" and the "Contact to check" tags

const MAX_BYLINE = 120, MAX_SEARCH_WORDS = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const oneLine = v => String(v ?? "").replace(/\s+/g, " ").trim();
const validDate = s => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** The stored extras of an item type, for admin (newUntil even when past). */
function typeExtras(rec) {
  const f = rec?.fields || {};
  const until = oneLine(f["New Until"]).slice(0, 10);
  return {
    byline: oneLine(f["Byline"]) || null,
    searchWords: oneLine(f["Search Words"]) || null,
    featured: !!f["Featured"],
    newUntil: validDate(until) ? until : null,
  };
}

/** The public extras: only what's set; New Until only while it hasn't passed (today = NY date). */
function publicTypeExtras(rec, today) {
  const x = typeExtras(rec), out = {};
  if (x.byline) out.byline = x.byline;
  if (x.searchWords) out.searchWords = x.searchWords;
  if (x.featured) out.featured = true;
  if (x.newUntil && x.newUntil >= today) out.newUntil = x.newUntil;
  return out;
}

/** body.byline / searchWords / featured / newUntil → { fields } | { error } (only keys that were sent). */
function typeExtraFields(body) {
  const fields = {};
  if (body.byline !== undefined) {
    if (body.byline !== null && typeof body.byline !== "string") return { error: "The line under the name must be text." };
    const v = oneLine(body.byline);
    if (v.length > MAX_BYLINE) return { error: `The line under the name is too long (max ${MAX_BYLINE} characters).` };
    fields["Byline"] = v || null;
  }
  if (body.searchWords !== undefined) {
    if (body.searchWords !== null && typeof body.searchWords !== "string") return { error: "Search words must be text." };
    const v = oneLine(body.searchWords);
    if (v.length > MAX_SEARCH_WORDS) return { error: `Search words are too long (max ${MAX_SEARCH_WORDS} characters).` };
    fields["Search Words"] = v || null;
  }
  if (body.featured !== undefined) {
    if (typeof body.featured !== "boolean") return { error: "Featured must be true or false." };
    fields["Featured"] = body.featured;
  }
  if (body.newUntil !== undefined) {
    const v = body.newUntil === null ? "" : String(body.newUntil).trim();
    if (v && !validDate(v)) return { error: "“New until” must be a date." };
    fields["New Until"] = v || null;
  }
  return { fields };
}

/** A gemach setting naming one of its item filters (case-insensitive) → the filter's own spelling, or null. */
function filterNameIn(defs, name) {
  const k = oneLine(name).toLowerCase();
  if (!k) return null;
  const d = (defs || []).find(x => x.name.toLowerCase() === k);
  return d ? d.name : null;
}

export { MAX_BYLINE, MAX_SEARCH_WORDS, typeExtras, publicTypeExtras, typeExtraFields, filterNameIn };
