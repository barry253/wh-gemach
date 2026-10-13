// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Abuse protection for the anonymous endpoints ─────────────────────────────────
// - Cloudflare Turnstile on the public request form. On when BOTH the plain variable TURNSTILE_SITE_KEY and the
//   secret TURNSTILE_SECRET are set on the worker (dashboard); until then requests go through as before. The site
//   learns the site key from GET /public/config (no database read).
// - Per-visitor rate limits with Workers Rate Limiting bindings (wrangler.toml [[ratelimits]]): SUBMIT_LIMITER for
//   /submit-request, PUBLIC_LOG_LIMITER for /public/event and /public/search-log. A missing binding (tests, local)
//   or a limiter error never blocks anyone.
import { json } from "./http.js";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "request";
// Pages the widget may be solved on: the live site and its Pages previews.
const TURNSTILE_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:whgemachs\.org|whgemachs\.pages\.dev)$/;

const clientIp = request => request.headers.get("CF-Connecting-IP") || "";

function turnstileSiteKey(env) {
  const site = String(env.TURNSTILE_SITE_KEY || "").trim();
  return site && String(env.TURNSTILE_SECRET || "").trim() ? site : null;
}

/** GET /public/config: what the public site needs before showing the request form. No database read. */
function handlePublicConfig(env) {
  return json({ turnstileSiteKey: turnstileSiteKey(env) }, 200, { "Cache-Control": "public, max-age=300" });
}

/**
 * Check a Turnstile token. { ok: true } when Turnstile is off, the token is good, or Cloudflare's check itself
 * couldn't be reached (fail open: the rate limit still applies, and a borrower is never stuck because of an outage).
 * { ok: false, error } when the token is missing, bad, expired or reused.
 */
async function verifyTurnstile(env, token, ip, fetchImpl = fetch) {
  if (!turnstileSiteKey(env)) return { ok: true, skipped: true };
  if (typeof token !== "string" || !token || token.length > 2048) {
    return { ok: false, error: "Please wait a moment for the security check under the form to finish, then send again." };
  }
  let result;
  try {
    const res = await fetchImpl(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: String(env.TURNSTILE_SECRET).trim(), response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    result = await res.json();
  } catch (e) {
    console.error("Turnstile check unavailable, letting the request through:", e.message);
    return { ok: true, unverified: true };
  }
  const hostOk = !result.hostname || TURNSTILE_HOST_RE.test(String(result.hostname).toLowerCase());
  const actionOk = !result.action || result.action === TURNSTILE_ACTION;
  if (result.success && hostOk && actionOk) return { ok: true };
  console.warn("Turnstile rejected:", JSON.stringify({ codes: result["error-codes"] || [], hostname: result.hostname || null, action: result.action || null }));
  return { ok: false, error: "The security check didn't go through. Please try sending again — if it keeps happening, reload the page." };
}

/** True when this key is over the binding's limit. Never throws; no binding = never limited. */
async function overLimit(binding, key) {
  if (!binding || typeof binding.limit !== "function" || !key) return false;
  try {
    const { success } = await binding.limit({ key });
    return success === false;
  } catch (e) {
    console.error("rate limiter failed:", e.message);
    return false;
  }
}

export { TURNSTILE_ACTION, TURNSTILE_HOST_RE, clientIp, turnstileSiteKey, handlePublicConfig, verifyTurnstile, overLimit };
