// Part of the Gemach Network worker (see index.js for routes and env vars).
// Error type and record helpers shared by the data layer (d1.js) and the route modules.
// Records are { id, createdTime, fields } with the table's field names (see dbschema.js).
import { ID_CHUNK, REC_RE } from "./config.js";
import { Q } from "./query.js";

/** A data-layer error: `status` (HTTP-like: 404, 409, 422, 500…) and `detail` ({ error: { type, message } }). */
class DbError extends Error {
  constructor(status, detail) {
    super(detail?.error?.message || detail?.error?.type || `database error ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

// ─── Record helpers ───────────────────────────────────────────────────────────

const linkedId = v => (!v ? null : typeof v === "string" ? v : v.id || null);
const linkedName = v => (v && typeof v === "object" ? v.name || null : null);
const firstLink = v => (Array.isArray(v) ? v[0] : v);
// Today's date in New York ("YYYY-MM-DD"): the gemachs' calendar day, not UTC (which flips at 8 pm EDT / 7 pm EST).
const NY_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const today = () => NY_DATE_FMT.format(new Date());

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

/** Batched fetch by record id (in chunks of ID_CHUNK), optionally scoped to a gemach. */
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

export { DbError, Q, linkedId, linkedName, firstLink, today, belongs, getOwned, fetchByIds, verifyOwnedIds };
