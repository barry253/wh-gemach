// Part of the Gemach Network worker (see index.js for routes and env vars).
// Site events: small daily counts the public site reports, for Network → Analytics.
//   POST /public/event (text/plain JSON, always 204):
//     { kind: "item-photos" | "item-pick", gemach: <slug>, item: <item type id> }   someone opened an item's photos / ticked it
//     { kind: "js-error", msg, src, line, page }                                       a script error in a visitor's browser
//     { kind: "load-fail", what: "directory" | "gemach" | "manage", page }             "couldn't load" shown to a visitor
// One row per (day, kind, key) with a Count. Nothing about the person is stored: no IP, no names, no query strings;
// error text has emails, long numbers and links stripped. Network-wide table (no gemach scope), like the Search Log.
import { Q } from "./query.js";
import { REC_RE, SLUG_RE, T } from "./config.js";
import { nyToday } from "./dates.js";

const NEW_ROWS_PER_KIND_PER_DAY = 300; // new (kind, key) rows a day; counts on existing rows keep going up
const EVENT_KINDS = new Set(["item-photos", "item-pick", "js-error", "load-fail"]);
const LOAD_WHAT = new Set(["directory", "gemach", "manage"]);
const eventSeen = new Map(); // per-isolate: "ip|kind|key" -> ms, so one person's repeats aren't counted twice
let eventHour = { start: 0, count: 0 };

/** A page address safe to keep: path only, private links shortened, at most 100 characters. */
function cleanPage(raw) {
  let p = String(raw ?? "");
  try { p = new URL(p, "https://whgemachs.org").pathname; } catch { return ""; }
  if (/^\/r\//.test(p)) return "/r/…";                    // borrower manage links are private
  p = p.replace(/[^\w\-./~%]/g, "").slice(0, 100);
  return p || "/";
}
/** Error text without anything personal: emails, links, long numbers and record ids removed. */
function cleanMessage(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim()
    .replace(/\S+@\S+/g, "[email]")
    .replace(/https?:\/\/\S+/g, m => { try { const u = new URL(m); return u.host + (u.host.endsWith("whgemachs.org") ? cleanPage(u.pathname) : ""); } catch { return "[link]"; } })
    .replace(/\brec[A-Za-z0-9]{14}\b/g, "[id]")
    .replace(/\d{5,}/g, "#")
    .slice(0, 200);
}
/** Script file only ("/assets/gemach.js"), or "" for anything else (inline, extensions…). */
function cleanSource(raw) {
  try { const u = new URL(String(raw ?? "")); return /(^|\.)whgemachs\.(org|pages\.dev)$/.test(u.hostname) ? u.pathname.slice(0, 80) : (u.protocol === "https:" ? "other site" : ""); }
  catch { return ""; }
}
/** Rough browser name from the User-Agent ("iPhone Safari", "Android Chrome", "Windows Edge"…). Never stored whole. */
function browserOf(ua) {
  ua = String(ua || "");
  const os = /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /FBAN|FBAV|Instagram/.test(ua) ? "in-app" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "other";
  return `${os} ${br}`;
}

async function handleSiteEvent(request, db, ctx) {
  const done = new Response(null, { status: 204 });
  const raw = (await request.text().catch(() => "")).slice(0, 3000);
  let b; try { b = JSON.parse(raw); } catch { return done; }
  if (!b || typeof b !== "object" || !EVENT_KINDS.has(b.kind)) return done;

  let ev;
  if (b.kind === "item-photos" || b.kind === "item-pick") {
    if (!SLUG_RE.test(String(b.gemach || "")) || !REC_RE.test(String(b.item || ""))) return done;
    ev = { kind: b.kind, key: b.item, slug: b.gemach, label: null, detail: null };
  } else if (b.kind === "js-error") {
    const msg = cleanMessage(b.msg);
    if (!msg) return done;
    const src = cleanSource(b.src), line = Number.isInteger(b.line) && b.line > 0 && b.line < 1e6 ? b.line : null;
    const page = cleanPage(b.page);
    ev = { kind: b.kind, key: `${msg}|${src}|${line ?? ""}`.slice(0, 300), slug: null, label: msg,
      detail: JSON.stringify({ src, line, page, browser: browserOf(request.headers.get("User-Agent")) }) };
  } else {
    if (!LOAD_WHAT.has(b.what)) return done;
    const page = cleanPage(b.page);
    ev = { kind: b.kind, key: `${b.what}|${page}`, slug: b.what === "gemach" ? (page.match(/^\/g\/([a-z0-9-]+)/) || [])[1] || null : null,
      label: b.what, detail: JSON.stringify({ page, browser: browserOf(request.headers.get("User-Agent")) }) };
  }

  const now = Date.now();
  const seenKey = `${request.headers.get("CF-Connecting-IP") || ""}|${ev.kind}|${ev.key}`;
  if (eventSeen.has(seenKey) && now - eventSeen.get(seenKey) < 30 * 60 * 1000) return done;
  if (now - eventHour.start > 3600e3) eventHour = { start: now, count: 0 };
  if (eventHour.count >= 2000) return done;
  eventHour.count++;
  if (eventSeen.size > 2000) eventSeen.clear();
  eventSeen.set(seenKey, now);

  ctx.waitUntil(recordSiteEvent(db, ev).catch(e => console.error("site event failed:", e.message)));
  return done;
}

async function recordSiteEvent(db, ev, now = Date.now()) {
  const date = nyToday(now), at = new Date(now).toISOString();
  const { records } = await db.listPage(T.SITE_EVENTS, {
    where: [Q.eq("Date", date), Q.eq("Kind", ev.kind), Q.eq("Key", ev.key)], maxRecords: 1, fields: ["Count"],
  });
  if (records[0]) {
    return db.update(T.SITE_EVENTS, records[0].id, { "Count": (records[0].fields.Count || 0) + 1, "Last At": at, ...(ev.detail ? { "Detail": ev.detail } : {}) });
  }
  // Keys come from anonymous visitors, so cap how many NEW rows a day each kind can add (D1 writes are limited).
  const today = await db.listAll(T.SITE_EVENTS, { where: [Q.eq("Date", date), Q.eq("Kind", ev.kind)], fields: ["Kind"], maxRecords: NEW_ROWS_PER_KIND_PER_DAY });
  if (today.length >= NEW_ROWS_PER_KIND_PER_DAY) return null;
  return db.create(T.SITE_EVENTS, {
    "Date": date, "Kind": ev.kind, "Key": ev.key, "Count": 1, "Slug": ev.slug, "Label": ev.label, "Detail": ev.detail, "Last At": at,
  });
}

export { NEW_ROWS_PER_KIND_PER_DAY, EVENT_KINDS, eventSeen, cleanPage, cleanMessage, cleanSource, browserOf, handleSiteEvent, recordSiteEvent };
