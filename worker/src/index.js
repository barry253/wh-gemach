/**
 * Gemach Network API — Cloudflare Worker (module syntax), multi-tenant.
 *
 * Serves every gemach stored in one Airtable base. All routes work both at the
 * workers.dev root and behind a "/api" prefix (e.g. https://whgemachs.org/api/...).
 *
 * ── Env vars / secrets / bindings read ──────────────────────────────────────
 *   AIRTABLE_TOKEN     secret   Airtable PAT (data.records:read/write on the base)
 *   AIRTABLE_BASE_ID   var      Airtable base id
 *   GEMACH_JWT         secret   HMAC-SHA256 key for admin session tokens
 *   RESEND_API_KEY     secret   Resend API key for outgoing email
 *   NOTIFY_EMAIL       var      Fallback notification / reply-to address when a gemach has no Email
 *   ASSETS_BUCKET      R2 binding  Photo storage
 *   ASSETS_URL         var      Public base URL of the R2 bucket
 *   GOOGLE_CLIENT_ID   var  NEW (optional) Google OAuth client id; defaults to the current hardcoded one
 *   FROM_EMAIL         var  NEW (optional) Sender address; defaults to onboarding@resend.dev
 *   ADMIN_URL          var  NEW (optional) Admin page link used in emails; defaults to https://whgemachs.org/admin
 *   CACHE_ORIGIN       var  NEW (optional) Origin used for synthetic Cache API keys; defaults to https://whgemachs.org
 *   ALERT_EMAIL        var  NEW (optional) Where failure alerts go (failed requests, failed emails, server errors);
 *                           defaults to NOTIFY_EMAIL. Alerts are plain-text emails sent through Resend.
 *
 * ── CORS ────────────────────────────────────────────────────────────────────
 *   Allowlisted (credentialed/admin): barry253.github.io, whgemachs.org, www.whgemachs.org,
 *   whgemachs.pages.dev and https://<preview>.whgemachs.pages.dev, localhost.
 *   Public GETs and POST /submit-request answer any origin ("*").
 *
 * ── Routes ──────────────────────────────────────────────────────────────────
 *   Search:  POST /public/search-log {q, outcome:"none"|"all-on-loan", category?} — home-page searches that came up
 *            empty; always 204. GET /admin/network/searches?days=N (Network Admin) lists them.
 *   Stats:   GET /admin/stats?days=30|90|365 — per-gemach request/loan/inventory stats for the Dashboard.
 *   Health:  GET /health — checks Airtable is reachable; 200 {ok:true} or 503 (for uptime monitors).
 *   Public:  GET /inventory (legacy, wh-medical only), GET /public/directory,
 *            GET /public/gemach/:slug, POST /submit-request (rejected for Directory, Info-only and Coming-soon gemachs)
 *   Manage:  GET /public/manage/:token, POST /public/manage/:token/cancel, POST /public/manage/:token/ready —
 *            the borrower's signed link (see manage.js); POST /submit-request returns it as manageUrl.
 *   SITE_URL          var  NEW (optional) public site base for manage links; defaults to https://whgemachs.org
 *   Auth:    POST /admin/login
 *   Admin:   GET /admin/me and every other /admin/* route, scoped by ?g=<slug> or X-Gemach header.
 *            GET/PATCH /admin/gemach — gemach profile, branding, request style + message templates
 *            (PATCH: Owner/Manager/Network Admin); POST /admin/gemach/logo (multipart "logo", ≤2 MB, png/jpeg/webp).
 *            GET /admin/appointments — upcoming confirmed appointments.
 *            GET /admin/catalog/categories — active Product Categories (for the item-type "Browse category" select).
 *   Network: /admin/network/{gemachs,admins,categories} — role "Network Admin" only, re-checked live in Airtable.
 *   Contract: see API.md (v2) + API-v3.md (request styles, appointments, branding, HTML emails + .ics).
 *
 * ── Add-ons (Item Types.Tracking = "Add-on", optional Item Types.Price) ───────
 *   Made to order for purchase (e.g. personalized sweatshirts): no Items records, never "on loan", never
 *   returned, never in availability. Public item: tracking:"addon", price, availableCount null. Requests take
 *   quantities (1–500); an add-on-only order needs no deposit. Confirming creates a Reserved loan with
 *   Item to Reserve + Quantity (log "Add-on Ordered"); "pickup" on it = handed over → Status Returned with
 *   Date Borrowed = Date Returned (log "Add-on Handed Over"). Stats skip them as loans.
 *
 * ── Quantity-tracked item types (Item Types.Tracking = "Quantity") ──────────
 *   Counted, not numbered (e.g. 60 folding chairs): Quantity Owned / Out of Service, no Item records.
 *   Public item: tracking:"quantity", totalUnits = lendable, availableCount = free today, bookings[{from,to,qty}]
 *   (gemach page only). POST /submit-request takes quantities:{typeId:n} (≤ lendable) → Requests."Item Quantities".
 *   Admin: requests list items[{id,name,quantity,available,owned}]; confirm takes quantities:{typeId:n};
 *   loans/reservations carry isQuantity + quantity; pickup takes quantity; return takes quantityReturned
 *   (+ reduceOwned:true to take missing ones out of Quantity Owned) and answers {missing};
 *   PATCH /admin/reservations/:id takes quantity; item types take tracking/quantityOwned/outOfService and
 *   report outNow / reservedAhead / availableToday.
 */

import { handleGetHistory } from "./activity.js";
import { makeDb } from "./airtable.js";
import { alertServerError, handleHealth } from "./alerts.js";
import { handleLogin, handleMe, lookupAdminSession, signJWT, verifyJWT } from "./auth.js";
import { purgePublicCache } from "./cache.js";
import { handleCreateItem, handleCreateItemType, handleDeleteItem, handleGetCatalogItems, handleGetItemTypes, handleUpdateItem, handleUpdateItemType, handleUploadPhoto } from "./catalog.js";
import { JWT_REFRESH_MS, safeDecode } from "./config.js";
import { buildIcs, eventDates, formatNy, nyLocalToUtc, nyToday } from "./dates.js";
import { buildEmailHtml, contrastRatio, textColorFor } from "./email.js";
import { gemachMemo, liveNetMemo, resolveAdminGemach } from "./gemachs.js";
import { json, withCors } from "./http.js";
import { handleAdminInventory } from "./inventory.js";
import { handleAssignItem, handleCancelReservation, handleGetLoans, handleLoanReminder, handleGetReservations, handleMarkPickedUp, handleReturnLoan, handleUpdateReservation } from "./loans.js";
import { networkDispatch } from "./network.js";
import { handleDirectory, handleLegacyInventory, handlePublicGemach, loadCategories } from "./public.js";
import { handleGetAppointments, handleGetRequests, handleRequestDecision } from "./requests.js";
import { handleGetManage, handleManageCancel, handleManageReady } from "./manage.js";
import { handleSearchLog } from "./search.js";
import { handleGetAdminGemach, handleUpdateAdminGemach, handleUploadLogo } from "./settings.js";
import { handleDashboard, handleStats } from "./stats.js";
import { handleSubmitRequest } from "./submit.js";

// ─── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path === "/api" || path.startsWith("/api/")) path = path.slice(4) || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const method = request.method;
    const isPublicGet = method === "GET" && (path === "/inventory" || path.startsWith("/public/"));
    // Anonymous endpoints answer any origin (public site, Pages previews, embeds).
    const isSubmit = method === "POST" && path === "/submit-request";
    const isPublicRoute = isPublicGet || isSubmit || (method === "GET" && path === "/health") || (method === "POST" && path === "/public/search-log")
      || (method === "POST" && path.startsWith("/public/manage/"));

    if (method === "OPTIONS") return withCors(new Response(null, { status: 204 }), request, path === "/inventory" || path.startsWith("/public/") || path === "/submit-request");

    // Keep a copy of a public request's body so a failed save can be alerted with the person's details.
    const submitCopy = isSubmit ? request.clone() : null;
    let res, thrown = null;
    const started = Date.now();
    const db = makeDb(env);
    try {
      res = await route(request, env, ctx, url, path, method, db);
    } catch (e) {
      thrown = e;
      console.error("Unhandled error:", e && (e.stack || e.message), e && e.detail ? JSON.stringify(e.detail) : "");
      res = json({ error: "Server error" }, 500);
    }
    res = withTiming(res, db.stats, Date.now() - started, method, path);
    if (res.status >= 500 && path !== "/health") {
      ctx.waitUntil(alertServerError(env, { method, path, res: res.clone(), thrown, submitCopy }).catch(e => console.error("alert failed:", e.message)));
    }
    return withCors(res, request, isPublicRoute);
  },
};

// Pure helpers exposed for unit tests only. Tests set globalThis.__WHG_TEST__ = {} before importing;
// in Cloudflare this global never exists, so nothing is exposed and the default export stays a plain handler.
if (globalThis.__WHG_TEST__) {
  Object.assign(globalThis.__WHG_TEST__, {
    eventDates: (...a) => eventDates(...a), buildIcs: (...a) => buildIcs(...a), nyLocalToUtc: (...a) => nyLocalToUtc(...a),
    nyToday: (...a) => nyToday(...a), formatNy: (...a) => formatNy(...a), textColorFor: (...a) => textColorFor(...a),
    contrastRatio: (...a) => contrastRatio(...a), buildEmailHtml: (...a) => buildEmailHtml(...a),
    makeDbForTest: e => makeDb(e),
    clearMemo: () => { gemachMemo.clear(); liveNetMemo.clear(); },
  });
}

/**
 * Server-Timing on every response (visible in the browser's Network tab), and a log line for slow
 * requests (Workers Logs) saying how much of the time was Airtable and whether Airtable rate-limited us.
 */
function withTiming(res, st, totalMs, method, path) {
  const desc = `${st.calls} call${st.calls === 1 ? "" : "s"}${st.retries ? `, ${st.retries} rate-limited` : ""}${st.hedges ? `, ${st.hedges} resent (${st.hedgeWins} faster)` : ""}`;
  const timing = `total;dur=${totalMs}, airtable;dur=${st.ms};desc="${desc}", queue;dur=${st.waitMs}`;
  if (totalMs > 2000 && path !== "/health") {
    console.warn(`slow request ${method} ${path}: ${totalMs}ms — Airtable ${st.calls} calls, ${st.ms}ms total, slowest ${st.slowest}ms (${st.slowestPath}), ` +
      `${st.retries} rate-limited retries, ${st.hedges || 0} slow reads resent (${st.hedgeWins || 0} faster), ${st.waitMs}ms queued`);
  }
  try {
    const out = new Response(res.body, res);
    out.headers.set("Server-Timing", timing);
    return out;
  } catch { return res; }
}

async function route(request, env, ctx, url, path, method, db = makeDb(env)) {

  // Public endpoints
  if (method === "GET"  && path === "/health")           return handleHealth(db, env, request, url);
  if (method === "GET"  && path === "/inventory")        return handleLegacyInventory(db);
  if (method === "GET"  && path === "/public/directory") return handleDirectory(db, env, ctx);
  if (method === "GET"  && path.startsWith("/public/gemach/")) return handlePublicGemach(db, env, ctx, safeDecode(path.slice("/public/gemach/".length)));
  if (method === "POST" && path === "/submit-request")   return handleSubmitRequest(request, db, env, ctx);
  if (method === "POST" && path === "/public/search-log") return handleSearchLog(request, db, ctx);
  if (path.startsWith("/public/manage/")) { // borrower manage link (signed; no login)
    const rest = path.slice("/public/manage/".length).split("/");
    const token = safeDecode(rest[0] || "");
    if (method === "GET" && rest.length === 1) return handleGetManage(db, env, token);
    if (method === "POST" && rest[1] === "cancel" && rest.length === 2) return handleManageCancel(db, env, ctx, token);
    if (method === "POST" && rest[1] === "ready" && rest.length === 2) return handleManageReady(db, env, ctx, token);
    return json({ error: "Not found" }, 404);
  }

  // Auth endpoint
  if (method === "POST" && path === "/admin/login")      return handleLogin(request, db, env);

  if (!path.startsWith("/admin/")) return new Response("Not found", { status: 404 });

  // Protected admin endpoints
  let user = await verifyJWT(request, env);
  if (!user) return json({ error: "Unauthorized" }, 401);

  // Sliding session: periodically re-check the admin in Airtable and hand back a fresh 14-day token.
  // Removed/deactivated admins lose access at the next check (within 12h) instead of at token expiry.
  let freshToken = null;
  if (!(typeof user.iat === "number" && Date.now() - user.iat < JWT_REFRESH_MS)) {
    let session;
    try { session = await lookupAdminSession(db, user.email); }
    catch (e) { console.error("Session refresh failed:", e.message); session = { transient: true }; }
    if (session.transient) {
      // Airtable hiccup: keep the current (still valid) token rather than logging the admin out.
    } else if (!session.ok) {
      return json({ error: "Unauthorized" }, 401);
    } else {
      user = session.payload;
      freshToken = await signJWT(user, env);
    }
  }

  const res = await adminDispatch(request, env, ctx, url, path, method, db, user);
  if (!freshToken) return res;
  const headers = new Headers(res.headers);
  headers.set("X-Session-Token", freshToken);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function adminDispatch(request, env, ctx, url, path, method, db, user) {
  if (method === "GET" && path === "/admin/me") return handleMe(db, user, env);
  if (path.startsWith("/admin/network/")) return networkDispatch({ request, env, ctx, db, url, user, adminName: user.name || user.email }, path, method);

  const resolved = await resolveAdminGemach(request, url, db, user);
  if (resolved.error) return json({ error: resolved.error, gemachs: resolved.gemachs }, resolved.status);
  const c = { request, env, ctx, db, url, user, g: resolved.g, adminName: user.name || user.email };

  const res = await adminRoute(c, path, method);
  if (method !== "GET" && res.status < 400) purgePublicCache(env, ctx, c.g.slug);
  return res;
}

async function adminRoute(c, path, method) {
  let m;
  if (method === "GET"  && path === "/admin/dashboard")    return handleDashboard(c);
  if (method === "GET"  && path === "/admin/stats")        return handleStats(c);
  if (method === "GET"   && path === "/admin/gemach")      return handleGetAdminGemach(c);
  if (method === "PATCH" && path === "/admin/gemach")      return handleUpdateAdminGemach(c);
  if (method === "POST"  && path === "/admin/gemach/logo") return handleUploadLogo(c);
  if (method === "GET"   && path === "/admin/appointments") return handleGetAppointments(c);
  if (method === "GET"  && path === "/admin/requests")     return handleGetRequests(c);
  if (method === "POST" && (m = path.match(/^\/admin\/requests\/([^/]+)\/confirm$/))) return handleRequestDecision(c, m[1], "confirm");
  if (method === "POST" && (m = path.match(/^\/admin\/requests\/([^/]+)\/decline$/))) return handleRequestDecision(c, m[1], "decline");
  if (method === "GET"  && path === "/admin/loans")        return handleGetLoans(c);
  if (method === "POST" && (m = path.match(/^\/admin\/loans\/([^/]+)\/return$/)))     return handleReturnLoan(c, m[1]);
  if (method === "POST" && (m = path.match(/^\/admin\/loans\/([^/]+)\/reminder$/)))   return handleLoanReminder(c, m[1]);
  if (method === "POST" && (m = path.match(/^\/admin\/loans\/([^/]+)\/pickup$/)))     return handleMarkPickedUp(c, m[1]);
  if (method === "GET"  && path === "/admin/reservations") return handleGetReservations(c);
  if (method === "PATCH" && (m = path.match(/^\/admin\/reservations\/([^/]+)$/)))       return handleUpdateReservation(c, m[1]);
  if (method === "POST" && (m = path.match(/^\/admin\/reservations\/([^/]+)\/cancel$/))) return handleCancelReservation(c, m[1]);
  if (method === "GET"  && path === "/admin/inventory")    return handleAdminInventory(c);
  if (method === "POST" && (m = path.match(/^\/admin\/inventory\/([^/]+)\/assign$/)))  return handleAssignItem(c, m[1]);

  // Catalog management
  if (method === "GET"   && path === "/admin/catalog/item-types") return handleGetItemTypes(c);
  if (method === "GET"   && path === "/admin/catalog/categories") return json(await loadCategories(c.db));
  if (method === "POST"  && path === "/admin/catalog/item-types") return handleCreateItemType(c);
  if (method === "PATCH" && (m = path.match(/^\/admin\/catalog\/item-types\/([^/]+)$/))) return handleUpdateItemType(c, m[1]);
  if (method === "GET"   && path === "/admin/catalog/items")      return handleGetCatalogItems(c);
  if (method === "POST"  && path === "/admin/catalog/items")      return handleCreateItem(c);
  if (method === "PATCH"  && (m = path.match(/^\/admin\/catalog\/items\/([^/]+)$/)))    return handleUpdateItem(c, m[1]);
  if (method === "DELETE" && (m = path.match(/^\/admin\/catalog\/items\/([^/]+)$/)))    return handleDeleteItem(c, m[1]);
  if (method === "POST"  && path === "/admin/catalog/upload-photo") return handleUploadPhoto(c);

  if (method === "GET"  && path === "/admin/history")      return handleGetHistory(c);

  return json({ error: "Not found" }, 404);
}

export { route, adminDispatch, adminRoute };
