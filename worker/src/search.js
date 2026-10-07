// Part of the Gemach Network worker (see index.js for routes and env vars).
import { Q } from "./airtable.js";
import { T } from "./config.js";
import { DAY_MS } from "./dates.js";
import { clampInt } from "./gemachs.js";
import { json } from "./http.js";
import { clip } from "./submit.js";

// ─── Search log (home-page searches that found nothing) ───────────────────────

const SEARCH_OUTCOMES = { "none": "Nothing found", "all-on-loan": "All on loan" };
const searchSeen = new Map(); // per-isolate: "q|outcome" -> ms, so one person's retyping isn't counted twice
let searchHour = { start: 0, count: 0 };

/** Lowercase, collapse spaces, trim punctuation. Returns "" for anything that could be personal info. */
function normalizeSearch(raw) {
  let q = String(raw ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  q = q.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (q.length < 3 || q.length > 60) return "";
  if (/@/.test(q)) return "";                         // email-ish
  if ((q.match(/\d/g) || []).length >= 5) return "";  // phone / address / id numbers
  if (/https?:|www\./.test(q)) return "";
  return q;
}

async function handleSearchLog(request, db, ctx) {
  const done = new Response(null, { status: 204 });
  const raw = (await request.text().catch(() => "")).slice(0, 2000);
  let b; try { b = JSON.parse(raw); } catch { return done; }
  if (!b || typeof b !== "object") return done;
  const q = typeof b.q === "string" ? normalizeSearch(b.q) : "";
  const outcome = SEARCH_OUTCOMES[b.outcome];
  if (!q || !outcome) return done;
  const category = typeof b.category === "string" ? clip(b.category.replace(/[\r\n]+/g, " ").trim(), 100) : "";

  const now = Date.now();
  const key = `${q}|${outcome}`;
  if (searchSeen.has(key) && now - searchSeen.get(key) < 10 * 60 * 1000) return done;
  if (now - searchHour.start > 3600e3) searchHour = { start: now, count: 0 };
  if (searchHour.count >= 300) return done;
  searchHour.count++;
  if (searchSeen.size > 500) searchSeen.clear();
  searchSeen.set(key, now);

  ctx.waitUntil(recordSearch(db, q, outcome, category).catch(e => console.error("search log failed:", e.message, e.detail ? JSON.stringify(e.detail) : "")));
  return done;
}

async function recordSearch(db, q, outcome, category) {
  const nowIso = new Date().toISOString();
  const { records } = await db.listPage(T.SEARCH_LOG, { where: [Q.eq("Query", q)], maxRecords: 1 });
  const isNone = outcome === SEARCH_OUTCOMES.none;
  if (records[0]) {
    const f = records[0].fields;
    return db.update(T.SEARCH_LOG, records[0].id, {
      "Count": (f.Count || 0) + 1,
      "Last Outcome": outcome,
      [isNone ? "Nothing Found Count" : "All On Loan Count"]: ((isNone ? f["Nothing Found Count"] : f["All On Loan Count"]) || 0) + 1,
      "Category": category || null,
      "Last Searched": nowIso,
    });
  }
  return db.create(T.SEARCH_LOG, {
    "Query": q, "Count": 1, "Last Outcome": outcome,
    "Nothing Found Count": isNone ? 1 : 0, "All On Loan Count": isNone ? 0 : 1,
    ...(category ? { "Category": category } : {}),
    "First Searched": nowIso, "Last Searched": nowIso,
  });
}

async function netListSearches({ db, url }) {
  const days = clampInt(url.searchParams.get("days"), 1, 3650, 90);
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const rows = await db.listAll(T.SEARCH_LOG, {
    where: [Q.after("Last Searched", since)],
    sort: [{ field: "Count", direction: "desc" }, { field: "Last Searched", direction: "desc" }],
  });
  return json({
    days,
    searches: rows.slice(0, 200).map(r => ({
      id: r.id,
      query: r.fields.Query || "",
      count: r.fields.Count || 0,
      nothingFound: r.fields["Nothing Found Count"] || 0,
      allOnLoan: r.fields["All On Loan Count"] || 0,
      lastOutcome: r.fields["Last Outcome"] || null,
      category: r.fields.Category || null,
      firstSearched: r.fields["First Searched"] || null,
      lastSearched: r.fields["Last Searched"] || null,
    })),
    total: rows.length,
  });
}

export { SEARCH_OUTCOMES, searchSeen, searchHour, normalizeSearch, handleSearchLog, recordSearch, netListSearches };
