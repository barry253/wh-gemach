// Part of the Gemach Network worker. Pure vacation date rules (see vacations.js for the admin API).
import { addYearsDate, isValidDate, nyToday } from "./dates.js";

const MAX_VACATIONS = 20;

/** Stored JSON → sorted [{start, end}] (bad entries skipped). With `today`, ones already over are dropped. */
function parseVacations(raw, today = null) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list
    .filter(v => v && isValidDate(v.start) && isValidDate(v.end) && v.end >= v.start && (!today || v.end >= today))
    .map(v => ({ start: v.start, end: v.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The vacation that includes `date` ("YYYY-MM-DD"), or null. */
function vacationOn(list, date) {
  if (!date) return null;
  return (list || []).find(v => v.start <= date && date <= v.end) || null;
}

const dayFmt = s => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
  .format(new Date(`${s}T12:00:00Z`));
/** "Fri, Dec 18 – Sun, Dec 27" (one day: "Fri, Dec 18"). */
const vacationRange = v => (v.start === v.end ? dayFmt(v.start) : `${dayFmt(v.start)} – ${dayFmt(v.end)}`);
/** The borrower-facing message (site/assets/gemach.js words it the same way). */
function vacationMessage(v, what = null) {
  const lead = v.start === v.end ? `The gemach is on vacation on ${vacationRange(v)}` : `The gemach is on vacation ${vacationRange(v)}`;
  return `${lead}${what ? `, so ${what} can't be scheduled then` : ""}. Please choose a different date.`;
}

/** First problem with a borrower's pickup / return dates, or null. dates: [{ date, what: "pickup" | "return" }]. */
function vacationProblem(g, dates) {
  const list = parseVacations(g.vacations, nyToday());
  if (!list.length) return null;
  for (const { date, what } of dates) {
    const v = vacationOn(list, date);
    if (v) return vacationMessage(v, what === "return" ? `a return on ${dayFmt(date)}` : `a pickup on ${dayFmt(date)}`);
  }
  return null;
}

/** Admin input → { value: sorted list } or { error }. Ones that already ended are dropped quietly. */
function validateVacations(input, today = nyToday()) {
  if (!Array.isArray(input)) return { error: "Vacations must be a list." };
  const out = [];
  for (const v of input) {
    if (!v || typeof v !== "object") return { error: "Each vacation needs a start and end date." };
    const start = String(v.start || ""), end = String(v.end || "");
    if (!isValidDate(start)) return { error: "Please choose a valid start date." };
    if (!isValidDate(end)) return { error: "Please choose a valid end date." };
    if (end < start) return { error: `The end date can't be before the start date (${dayFmt(start)}).` };
    if (end < today) continue; // already over
    if (start > addYearsDate(today, 2)) return { error: "Vacations can be set up to 2 years ahead." };
    out.push({ start, end });
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < out.length; i++) {
    if (out[i].start <= out[i - 1].end) return { error: `Two vacations overlap (${vacationRange(out[i - 1])} and ${vacationRange(out[i])}). Change one of them or make them one vacation.` };
  }
  if (out.length > MAX_VACATIONS) return { error: `Up to ${MAX_VACATIONS} upcoming vacations.` };
  return { value: out };
}

export { MAX_VACATIONS, parseVacations, vacationOn, vacationRange, vacationMessage, vacationProblem, validateVacations };
