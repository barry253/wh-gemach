// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fStr, fetchByIds } from "./airtable.js";
import { DEFAULT_GOOGLE_CLIENT_ID, JWT_TTL_MS, NETWORK_ADMIN_ROLE, SLUG_RE, T } from "./config.js";
import { forgetLiveAdmin, gemachRef, listAllGemachs, liveNetMemo } from "./gemachs.js";
import { json, readJson } from "./http.js";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function handleLogin(request, db, env, ctx) {
  const { googleToken } = await readJson(request);
  if (!googleToken || typeof googleToken !== "string") return json({ error: "Missing Google token" }, 400);

  const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleToken)}`);
  if (!verifyRes.ok) {
    console.error("Google token verify failed:", await verifyRes.text().catch(() => ""));
    return json({ error: "Invalid Google token" }, 401);
  }
  const gUser = await verifyRes.json();
  const email = gUser.email?.toLowerCase();
  if (!email) return json({ error: "No email from Google" }, 401);
  if (!(gUser.email_verified === "true" || gUser.email_verified === true)) return json({ error: "Email not verified" }, 401);
  if (gUser.aud !== (env.GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID)) return json({ error: "Token not issued for this app" }, 401);

  let session;
  try {
    session = await lookupAdminSession(db, email);
  } catch (e) {
    console.error("Admin lookup failed:", e.message);
    return json({ error: "Auth check failed" }, 500);
  }
  if (!session.ok) return json({ error: session.error }, 403);

  const p = session.payload;
  noteActive(db, ctx, session);
  const token = await signJWT(p, env);
  return json({ token, name: p.name, email, role: p.role, gemachs: p.gemachs });
}

/** Current Admins-table view of an email: { ok, payload } or { ok:false, error }. Throws on Airtable errors. */
async function lookupAdminSession(db, email) {
  email = String(email || "").toLowerCase();
  if (!email) return { ok: false, error: "Not authorized" };
  const admins = await db.listAll(T.ADMINS, { filter: `AND(LOWER({Email})=${fStr(email)},{Active}=1)`, maxRecords: 1 });
  if (!admins.length) return { ok: false, error: "Not authorized" };

  const admin = admins[0].fields;
  const role = admin.Role || null;
  let gemachs;
  if (role === NETWORK_ADMIN_ROLE) {
    gemachs = (await listAllGemachs(db)).map(gemachRef);
  } else {
    const recs = await fetchByIds(db, T.GEMACHS, admin.Gemachs || [], { fields: ["Name", "Slug", "Active"] });
    gemachs = recs
      .map(r => ({ id: r.id, slug: r.fields.Slug || null, name: r.fields.Name || "", active: !!r.fields.Active }))
      .filter(g => SLUG_RE.test(g.slug || ""))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!gemachs.length) return { ok: false, error: "No gemach assigned to this admin" };
  }
  return { ok: true, payload: { email, name: admin.Name || email, role, gemachs }, recId: admins[0].id, lastActive: admin["Last Active"] || null };
}

// Admins."Last Active": stamped when the admin signs in or opens the admin page, at most once an hour
// (written after the response, so it never slows the page). Shown in Settings → Team and on the Network tab.
const ACTIVE_EVERY_MS = 60 * 60 * 1000;
function noteActive(db, ctx, session, now = Date.now()) {
  if (!session?.ok || !session.recId) return;
  const last = Date.parse(session.lastActive || "");
  if (Number.isFinite(last) && now - last < ACTIVE_EVERY_MS) return;
  const p = db.update(T.ADMINS, session.recId, { "Last Active": new Date(now).toISOString() })
    .catch(e => console.error("Last Active update failed:", e.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
}

// Live view of the admin (role + gemachs read from Airtable now), so a role change or slug rename shows
// up without re-login. When it differs from the JWT, a fresh token is handed back in X-Session-Token.
async function handleMe(db, user, env, ctx) {
  let session;
  try { session = await lookupAdminSession(db, user.email); }
  catch (e) { console.error("Admin lookup failed:", e.message); session = { transient: true }; }
  if (session.transient) {
    let gemachs = Array.isArray(user.gemachs) ? user.gemachs : [];
    if (user.role === NETWORK_ADMIN_ROLE) gemachs = (await listAllGemachs(db)).map(gemachRef);
    return json({ email: user.email, name: user.name, role: user.role || null, gemachs });
  }
  if (!session.ok) return json({ error: "Unauthorized" }, 401);
  const p = session.payload;
  noteActive(db, ctx, session);
  const sig = u => JSON.stringify([u.role || null, u.name || null, (u.gemachs || []).map(x => [x.id, x.slug, x.name, !!x.active])]);
  const headers = sig(p) === sig(user) ? {} : { "X-Session-Token": await signJWT(p, env) };
  liveNetMemo.delete(p.email);
  forgetLiveAdmin(p.email);
  return json({ email: p.email, name: p.name, role: p.role || null, gemachs: p.gemachs }, 200, headers);
}

async function verifyJWT(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try { return await verifyJWTToken(token, env); }
  catch { return null; }
}


// ─── JWT (HMAC-SHA256, base64url) ─────────────────────────────────────────────

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("Bad base64url");
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}

async function hmacKey(env, usage) {
  const secret = env.GEMACH_JWT;
  if (!secret) throw new Error("GEMACH_JWT not configured");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

async function signJWT(payload, env) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const { iat: _i, exp: _e, ...claims } = payload;
  const now = Date.now();
  const body = b64urlEncode(enc.encode(JSON.stringify({ ...claims, iat: now, exp: now + JWT_TTL_MS })));
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env, "sign"), enc.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

async function verifyJWTToken(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [header, body, sig] = parts;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env, "verify"), b64urlDecode(sig), enc.encode(`${header}.${body}`));
  if (!ok) throw new Error("Invalid signature");
  const h = JSON.parse(dec.decode(b64urlDecode(header)));
  if (h.alg !== "HS256") throw new Error("Bad alg");
  const payload = JSON.parse(dec.decode(b64urlDecode(body)));
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) throw new Error("Token expired");
  return payload;
}

export { handleLogin, lookupAdminSession, handleMe, verifyJWT, enc, dec, b64urlEncode, b64urlDecode, hmacKey, signJWT, verifyJWTToken, noteActive };
