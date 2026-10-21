// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Local payment tier: "is this borrower's town one of the gemach's local places?" ───
// Gemachs.Local Places is a comma-separated list the gemach types in Settings, spelling variants included:
// "West Hempstead, W Hempstead, W. Hempstead, WH, 11552, Franklin Square". The borrower types their town on
// the request form. The same rules run in the browser (site/assets/gemach.js localMatch) so the form can show
// the right payment as they type; keep the two in step (tests use the same cases).

const MAX_PLACES_TEXT = 1000;
/** State dropdown on the request form (2-letter codes; the form preselects NY). */
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","PR"];
const MAX_TOWN = 100;

/** Lower case, punctuation as spaces, single spaces: "W. Hempstead," → "w hempstead". */
function normPlace(s) {
  return String(s || "").toLowerCase().replace(/[.,;:'’"()/#-]/g, " ").replace(/\s+/g, " ").trim();
}

/** "a, b,, A" → ["a", "b"] (trimmed, blanks and repeats dropped, first spelling kept). */
function parseLocalPlaces(v) {
  const out = [], seen = new Set();
  for (const raw of String(v || "").split(/[,\n]/)) {
    const p = raw.replace(/\s+/g, " ").trim();
    const k = normPlace(p);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(p);
  }
  return out;
}

// Trailing state the borrower may add: "West Hempstead NY", "Franklin Square, New York".
const STATE_TAIL = /\s(ny|n y|new york|nj|new jersey|ct|pa|md|fl|ca)$/;

/**
 * Does the typed town match one of the places? Matches the whole entry (punctuation and case ignored),
 * also after dropping a zip code and a trailing state, and any 5-digit zip in the text against a zip entry.
 * Returns true / false; null when there are no places (no local tier).
 */
function isLocalTown(places, town) {
  const list = (Array.isArray(places) ? places : parseLocalPlaces(places)).map(normPlace).filter(Boolean);
  if (!list.length) return null;
  const n = normPlace(town);
  if (!n) return false;
  const set = new Set(list);
  const zips = n.match(/\b\d{5}\b/g) || [];
  if (zips.some(z => set.has(z))) return true;
  const noZip = n.replace(/\b\d{5}(\s\d{4})?\b/g, " ").replace(/\s+/g, " ").trim();
  const noState = noZip.replace(STATE_TAIL, "").trim();
  return [n, noZip, noState].some(x => x && set.has(x));
}

/** The gemach charges borrowers something and has a separate local amount. */
function hasLocalTier(g) {
  return !!(g?.depositRequired && g.localDepositInfo && g.localPlaces?.length);
}

/** Town is required when the gemach charges a payment (fee) or has a local tier (not for add-ons-only orders). */
function townRequiredForCharge(g) {
  return !!(g?.depositRequired && (g.chargeType === "Payment" || hasLocalTier(g)));
}
/** Settings → "Make the borrower's town required", or a charge that depends on it. */
function townRequired(g) {
  return !!g?.requireTown || townRequiredForCharge(g);
}

/** The payment / deposit text for this borrower: local text when they're local, else the usual. */
function chargeTextFor(g, local) {
  if (!g?.depositRequired) return "";
  return (local === true && hasLocalTier(g) ? g.localDepositInfo : g.depositInfo) || "";
}

export { US_STATES, MAX_PLACES_TEXT, MAX_TOWN, normPlace, parseLocalPlaces, isLocalTown, hasLocalTier, townRequired, townRequiredForCharge, chargeTextFor };
