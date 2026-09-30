// Part of the Gemach Network worker (see index.js for routes and env vars).
import { ALLOWED_ORIGINS, LOCALHOST_RE, PAGES_PREVIEW_RE } from "./config.js";

// ─── Responses & CORS ─────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function isAllowedOrigin(origin) {
  return !!origin && (ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin) || PAGES_PREVIEW_RE.test(origin));
}

function withCors(res, request, publicRoute) {
  const origin = request.headers.get("Origin");
  const headers = new Headers(res.headers);
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
    headers.set("Timing-Allow-Origin", origin); // lets the admin page read Server-Timing
  } else if (publicRoute) {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Gemach");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Access-Control-Expose-Headers", "X-Session-Token");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function readJson(request) {
  try { const b = await request.json(); return b && typeof b === "object" ? b : {}; }
  catch { return {}; }
}

export { json, isAllowedOrigin, withCors, readJson };
