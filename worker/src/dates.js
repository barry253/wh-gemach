// Part of the Gemach Network worker (see index.js for routes and env vars).
import { enc } from "./auth.js";
import { DATE_RE } from "./config.js";
import { clampInt } from "./gemachs.js";

// ─── Dates, times & calendar (America/New_York) ───────────────────────────────

const NY_TZ = "America/New_York";
const DAY_MS = 86400000;

/** Calendar-date check: "YYYY-MM-DD" that actually exists. */
function isValidDate(s) {
  if (!DATE_RE.test(String(s || ""))) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const dateToUtcMs = s => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const utcMsToDate = ms => new Date(ms).toISOString().slice(0, 10);
const addDays = (s, n) => utcMsToDate(dateToUtcMs(s) + n * DAY_MS);

/**
 * Event date rule (contract v3): pure calendar math, no timezone involved.
 * pickup = event − pickupDaysBefore, return = event + returnDaysAfter;
 * with shabbosAdjust, a Saturday pickup moves to Friday and a Saturday return to Sunday.
 */
function eventDates(eventDate, { pickupDaysBefore = 1, returnDaysAfter = 1, shabbosAdjust = false } = {}) {
  if (!isValidDate(eventDate)) return null;
  const base = dateToUtcMs(eventDate);
  let p = base - clampInt(pickupDaysBefore, 0, 14, 1) * DAY_MS;
  let r = base + clampInt(returnDaysAfter, 0, 14, 1) * DAY_MS;
  if (shabbosAdjust) {
    if (new Date(p).getUTCDay() === 6) p -= DAY_MS;
    if (new Date(r).getUTCDay() === 6) r += DAY_MS;
  }
  return { pickup: utcMsToDate(p), return: utcMsToDate(r) };
}

/** Wall-clock parts of an instant in New York. */
function nyParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o;
}
/** "YYYY-MM-DD" + n years (Feb 29 -> Feb 28). */
function addYearsDate(s, n) {
  const [y, m, d] = s.split("-");
  return `${Number(y) + n}-${m}-${m === "02" && d === "29" ? "28" : d}`;
}
/** Today's date in New York, "YYYY-MM-DD". */
function nyToday(now = Date.now()) {
  const o = nyParts(now);
  return `${o.year}-${String(o.month).padStart(2, "0")}-${String(o.day).padStart(2, "0")}`;
}
/** New York local "YYYY-MM-DD" + "HH:MM" -> UTC epoch ms (DST-aware). */
function nyLocalToUtc(date, time = "00:00") {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = ms => { const o = nyParts(ms); return Date.UTC(o.year, o.month - 1, o.day, o.hour % 24, o.minute, o.second) - ms; };
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc); // second pass settles DST transitions
  return utc;
}
/** "Sun, Oct 12 at 8:00 PM" in New York time. */
function formatNy(ms) {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, weekday: "short", month: "short", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: NY_TZ, hour: "numeric", minute: "2-digit" }).format(d);
  return `${day} at ${time}`;
}

/** RFC 5545 text escaping. */
const icsText = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n?|\n/g, "\\n");
const icsUtc = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Fold content lines at 75 octets (UTF-8 aware), continuation lines start with a space. */
function icsFold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
/** One-event VCALENDAR (times in UTC), CRLF line endings. */
function buildIcs({ uid, startMs, durationMin = 60, title, description, location, now = Date.now() }) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//whgemachs.org//Gemach Network//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(startMs)}`,
    `DTEND:${icsUtc(startMs + durationMin * 60000)}`,
    `SUMMARY:${icsText(title)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
  if (location) lines.push(`LOCATION:${icsText(location)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
function base64Utf8(str) {
  const bytes = enc.encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export { NY_TZ, DAY_MS, isValidDate, dateToUtcMs, utcMsToDate, addDays, eventDates, nyParts, addYearsDate, nyToday, nyLocalToUtc, formatNy, icsText, icsUtc, icsFold, buildIcs, base64Utf8 };
