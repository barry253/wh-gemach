// Part of the Gemach Network worker (see index.js for routes and env vars).

// ─── Constants ────────────────────────────────────────────────────────────────
const AIRTABLE_API = "https://api.airtable.com/v0";
const DEFAULT_GOOGLE_CLIENT_ID = "802083328700-pa13f067g5lsf1uijm4nqp40ptivjbti.apps.googleusercontent.com";
const DEFAULT_FROM_EMAIL = "onboarding@resend.dev";
const DEFAULT_ADMIN_URL = "https://whgemachs.org/admin";
const DEFAULT_CACHE_ORIGIN = "https://whgemachs.org";
const LEGACY_SLUG = "wh-medical";
const NETWORK_ADMIN_ROLE = "Network Admin";
const JWT_TTL_MS = 14 * 86400000;      // sliding session: expires 14 days after last use
const JWT_REFRESH_MS = 12 * 3600000;     // re-check Admins table + reissue token at most every 12h

const T = {
  ITEM_TYPES: "Item Types",
  ITEMS: "Items",
  BORROWERS: "Borrowers",
  LOANS: "Loans",
  REQUESTS: "Requests",
  ADMINS: "Admins",
  GEMACHS: "Gemachs",
  COMMUNITIES: "Communities",
  PRODUCT_CATEGORIES: "Product Categories",
  LOG: "tblC3PY7f5sXQDMJK", // Activity Log
  SEARCH_LOG: "tblpy91cyNSkKx1NL", // Search Log (network-wide, no gemach scope)
};

const ALLOWED_ORIGINS = new Set([
  "https://barry253.github.io",
  "https://whgemachs.org",
  "https://www.whgemachs.org",
  "https://whgemachs.pages.dev",
]);
const LOCALHOST_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const PAGES_PREVIEW_RE = /^https:\/\/[a-z0-9-]+\.whgemachs\.pages\.dev$/;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REC_RE = /^rec[A-Za-z0-9]{14}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return ""; } };

const EVENT_TYPES = new Set([
  "Loan Created", "Item Returned", "Item Reserved", "Reservation Cancelled", "Marked for Repair",
  "Restored", "Request Received", "Request Confirmed", "Request Declined", "Borrower Created",
]);

const CACHE_TTL_MS = 60 * 1000;          // serve fresh for 60s
const CACHE_MAX_STALE_MS = 24 * 60 * 60 * 1000; // serve stale (+ background refresh) up to 24h; older copies only if Airtable fails

const AIRTABLE_CONCURRENCY = 4; // Airtable allows 5 req/s per base
// Airtable sometimes stalls a single call for 2–3 s while the same call a moment later takes ~0.1 s.
// A read that hasn't answered after HEDGE_MS is sent a second time and the first answer wins.
// Reads only (never writes), and at most HEDGE_MAX per incoming request so a slow Airtable isn't doubled.
const AIRTABLE_HEDGE_MS = 1000;
const AIRTABLE_HEDGE_MAX = 4;
const ID_CHUNK = 40;            // record ids per OR(RECORD_ID()=...) query

export { AIRTABLE_API, DEFAULT_GOOGLE_CLIENT_ID, DEFAULT_FROM_EMAIL, DEFAULT_ADMIN_URL, DEFAULT_CACHE_ORIGIN, LEGACY_SLUG, NETWORK_ADMIN_ROLE, JWT_TTL_MS, JWT_REFRESH_MS, T, ALLOWED_ORIGINS, LOCALHOST_RE, PAGES_PREVIEW_RE, SLUG_RE, REC_RE, DATE_RE, safeDecode, EVENT_TYPES, CACHE_TTL_MS, CACHE_MAX_STALE_MS, AIRTABLE_CONCURRENCY, AIRTABLE_HEDGE_MS, AIRTABLE_HEDGE_MAX, ID_CHUNK };
