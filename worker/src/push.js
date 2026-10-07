// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Web Push notifications for admins ───────────────────────────────────────────
// Admins turn notifications on per device from the bell in admin (the page subscribes with the
// browser's Push API and sends us the subscription). When something happens, notifyAdmins() sends
// an encrypted push straight to each device's push service (Apple, Google, Mozilla, Microsoft) —
// no outside service, no cost.
//
//   Events: "request" (new request; says so when the gemach's email didn't go out), "cancel" (borrower
//   cancelled online), "ready" (borrower is ready to return), "alert" (Network Admins: site alerts —
//   the same things that send an alert email).
//   Payloads never carry a borrower's name, phone or email: they're shown on lock screens.
//
//   Standards: RFC 8291 (message encryption, aes128gcm) and RFC 8292 (VAPID), done with WebCrypto.
//
//   VAPID_PRIVATE_KEY  secret  The server's P-256 key as a JWK JSON string ({"kty":"EC","crv":"P-256","x","y","d"}).
//                              The public key handed to browsers is derived from it. Unset = notifications off.
//   VAPID_SUBJECT      var     (optional) Contact for push services; default mailto:whmedicalgemach@gmail.com
//
// Routes (signed-in admin; a device belongs to the admin who turned it on):
//   GET    /admin/push                → { configured, publicKey, events, devices[] }
//   POST   /admin/push/subscribe      { subscription:{endpoint, keys:{p256dh, auth}}, device } → { device }
//   PATCH  /admin/push/:id            { events?, gemachs? (ids, or null = all), device? } → { device }
//   DELETE /admin/push/:id
//   POST   /admin/push/unsubscribe    { endpoint } — this device signed out / turned off
//   POST   /admin/push/test           { endpoint } → { sent }
import { Q, fetchByIds, linkedId } from "./airtable.js";
import { b64urlDecode, b64urlEncode } from "./auth.js";
import { NETWORK_ADMIN_ROLE, REC_RE, T } from "./config.js";
import { makeDb } from "./db.js";
import { fetchLiveAdmin, selName } from "./gemachs.js";
import { json, readJson } from "./http.js";

const EVENTS = ["request", "cancel", "ready", "alert"];
const NET_ONLY = new Set(["alert"]);
const MAX_DEVICES = 10;           // per admin
const MAX_SENDS = 8;              // devices per event: ~1 ms CPU each, kept well inside the Workers Free 10 ms budget
const DROP_AFTER_FAILURES = 20;   // failed sends in a row (not "gone") before a device is removed
const PUSH_TTL_S = 24 * 3600;     // push services keep an undelivered message up to a day
const DEFAULT_SUBJECT = "mailto:whmedicalgemach@gmail.com";
const DEFAULT_ICON = "/assets/brand/wh-gemachs-icon-192.png";
const SUB_FIELDS = ["Admin", "Endpoint", "Keys", "Device", "Events", "Gemach Filter", "Last Sent At", "Failures"];

// Push services a subscription may point at (we POST to it, so never to an arbitrary host).
const PUSH_HOST_RE = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/i;

const enc = new TextEncoder();
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const parseList = s => { try { const v = JSON.parse(s || "null"); return Array.isArray(v) ? v : null; } catch { return null; } };
const tryDecode = s => { try { return b64urlDecode(String(s || "")); } catch { return null; } };

// ─── VAPID ──────────────────────────────────────────────────────────────────────

let vapidMemo = { raw: null, keys: null };
/** { priv, pub (65-byte raw), pubB64 } from VAPID_PRIVATE_KEY, or null when not set up (or malformed). */
async function vapidKeys(env) {
  const raw = String(env?.VAPID_PRIVATE_KEY || "").trim();
  if (!raw) return null;
  if (vapidMemo.raw === raw) return vapidMemo.keys;
  let keys = null;
  try {
    const jwk = JSON.parse(raw);
    const x = tryDecode(jwk.x), y = tryDecode(jwk.y);
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || x?.length !== 32 || y?.length !== 32) throw new Error("not a P-256 private JWK");
    const priv = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const pub = concat(new Uint8Array([4]), x, y);
    keys = { priv, pub, pubB64: b64urlEncode(pub) };
  } catch (e) {
    console.error("VAPID_PRIVATE_KEY unusable:", e.message);
  }
  vapidMemo = { raw, keys };
  return keys;
}

const jwtMemo = new Map(); // audience -> { jwt, exp }
/** Authorization header value for a push service (one signed token per service, reused ~11 hours). */
async function vapidAuth(env, keys, endpoint, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const hit = jwtMemo.get(aud);
  if (hit && hit.pub === keys.pubB64 && hit.exp - now / 1000 > 3600) return `vapid t=${hit.jwt}, k=${keys.pubB64}`;
  const exp = Math.floor(now / 1000) + 12 * 3600;
  const head = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64urlEncode(enc.encode(JSON.stringify({ aud, exp, sub: env.VAPID_SUBJECT || DEFAULT_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.priv, enc.encode(`${head}.${body}`));
  const jwt = `${head}.${body}.${b64urlEncode(new Uint8Array(sig))}`;
  jwtMemo.set(aud, { jwt, exp, pub: keys.pubB64 });
  return `vapid t=${jwt}, k=${keys.pubB64}`;
}

// ─── Message encryption (RFC 8291, aes128gcm) ───────────────────────────────────

/**
 * Encrypt `plaintext` (bytes) for a browser's p256dh public key + auth secret. Returns the request body:
 * salt(16) | record size(4) | key id length(1) | server public key(65) | ciphertext.
 * `fixed` ({ asPrivateJwk, salt }) is only for the RFC's test vector.
 */
async function encryptPayload(plaintext, p256dh, authSecret, fixed = null) {
  const uaPublic = p256dh instanceof Uint8Array ? p256dh : tryDecode(p256dh);
  const auth = authSecret instanceof Uint8Array ? authSecret : tryDecode(authSecret);
  if (uaPublic?.length !== 65 || uaPublic[0] !== 4 || auth?.length !== 16) throw new Error("bad subscription keys");

  let asPair;
  if (fixed?.asPrivateJwk) {
    const j = fixed.asPrivateJwk;
    asPair = {
      privateKey: await crypto.subtle.importKey("jwk", { ...j, ext: true }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
      publicKey: await crypto.subtle.importKey("jwk", { kty: j.kty, crv: j.crv, x: j.x, y: j.y, ext: true }, { name: "ECDH", namedCurve: "P-256" }, true, []),
    };
  } else {
    asPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  }
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asPair.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPair.privateKey, 256));

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0"|ua|as, 32)
  const prkKey = await hmac(auth, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32);
  const salt = fixed?.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([65]), asPublic, sealed);
}

// ─── Sending ────────────────────────────────────────────────────────────────────

/** POST one message. → { ok, status, gone } (gone: the device unsubscribed; delete it). */
async function sendPush(env, keys, sub, message) {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "TTL": String(PUSH_TTL_S),
      "Urgency": "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Authorization": await vapidAuth(env, keys, sub.endpoint),
    },
    body,
  });
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, detail };
}

function subFromRecord(r) {
  const f = r.fields || {};
  let k = {};
  try { k = JSON.parse(f.Keys || "{}") || {}; } catch { /* bad row */ }
  return {
    id: r.id, adminId: linkedId((f.Admin || [])[0]), endpoint: f.Endpoint || "", p256dh: k.p256dh || "", auth: k.auth || "",
    device: f.Device || "", events: parseList(f.Events) || [], gemachs: parseList(f["Gemach Filter"]),
    lastSentAt: f["Last Sent At"] || null, failures: Number(f.Failures) || 0, createdAt: r.createdTime || null,
  };
}

const clipText = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/**
 * Send one event to every admin device that wants it. Never throws (logs instead); safe in waitUntil.
 * msg: { event, g (gemach or null for site alerts), title, body, url, tag }
 */
async function notifyAdmins(env, msg, { db = null } = {}) {
  try {
    const keys = await vapidKeys(env);
    if (!keys || !EVENTS.includes(msg.event)) return { sent: 0 };
    db = db || makeDb(env);
    const subs = (await db.listAll(T.PUSH, { fields: SUB_FIELDS })).map(subFromRecord)
      .filter(s => s.adminId && s.endpoint && s.events.includes(msg.event));
    if (!subs.length) return { sent: 0 };
    const admins = await fetchByIds(db, T.ADMINS, subs.map(s => s.adminId), { fields: ["Role", "Active", "Gemachs"] });
    const byId = new Map(admins.map(a => [a.id, a.fields || {}]));
    const g = msg.g || null;
    const targets = subs.filter(s => {
      const a = byId.get(s.adminId);
      if (!a || !a.Active) return false;
      const isNet = selName(a.Role) === NETWORK_ADMIN_ROLE;
      if (NET_ONLY.has(msg.event)) return isNet;
      if (!g) return false;
      if (!isNet && !(a.Gemachs || []).map(linkedId).includes(g.id)) return false;
      return !s.gemachs || !s.gemachs.length || s.gemachs.includes(g.id);
    }).slice(0, MAX_SENDS);
    if (!targets.length) return { sent: 0 };

    const icon = /^https:\/\//i.test(g?.logoUrl || "") ? g.logoUrl : DEFAULT_ICON;
    const message = {
      title: clipText(msg.title, 80), body: clipText(msg.body, 180), url: msg.url || "/admin",
      tag: clipText(msg.tag || msg.event, 60), event: msg.event, icon,
    };
    const results = await Promise.all(targets.map(s => sendPush(env, keys, s, message)
      .catch(e => ({ ok: false, status: 0, gone: false, detail: String(e.message || e).slice(0, 200) }))));
    await recordResults(db, targets, results);
    const sent = results.filter(r => r.ok).length;
    if (sent < results.length) console.warn(`push ${msg.event}: ${sent}/${results.length} sent`, JSON.stringify(results.filter(r => !r.ok).map(r => r.status)));
    return { sent, failed: results.length - sent };
  } catch (e) {
    console.error("push notify failed:", e && (e.stack || e.message));
    return { sent: 0, error: true };
  }
}

/** Stamp successes (one write), drop devices that are gone, count other failures. */
async function recordResults(db, targets, results) {
  const now = new Date().toISOString();
  const okIds = targets.filter((s, i) => results[i].ok).map(s => s.id);
  const jobs = [];
  if (okIds.length) jobs.push(db.updateMany(T.PUSH, okIds, { "Last Sent At": now, "Failures": 0 }));
  targets.forEach((s, i) => {
    const r = results[i];
    if (r.ok) return;
    if (r.gone || s.failures + 1 >= DROP_AFTER_FAILURES) jobs.push(db.del(T.PUSH, s.id));
    else jobs.push(db.update(T.PUSH, s.id, { "Failures": s.failures + 1, "Last Error": `${r.status} ${r.detail || ""}`.trim().slice(0, 300) }));
  });
  await Promise.allSettled(jobs).then(rs => rs.forEach(r => r.status === "rejected" && console.error("push bookkeeping failed:", r.reason?.message)));
}

// ─── Admin routes ───────────────────────────────────────────────────────────────

const eventsFor = role => EVENTS.filter(e => !NET_ONLY.has(e) || role === NETWORK_ADMIN_ROLE);
const deviceOut = s => ({ id: s.id, device: s.device, endpoint: s.endpoint, events: s.events, gemachs: s.gemachs, lastSentAt: s.lastSentAt, createdAt: s.createdAt });

async function ownSubs(db, me) {
  const rows = await db.listAll(T.PUSH, { where: [Q.linksTo("Admin", me.id, me.name)], fields: SUB_FIELDS });
  return rows.map(subFromRecord).filter(s => s.adminId === me.id); // the Airtable formula matches by name; keep only real links
}
async function subByEndpoint(db, endpoint) {
  const rows = await db.listAll(T.PUSH, { where: [Q.eq("Endpoint", endpoint)], fields: SUB_FIELDS });
  return rows.map(subFromRecord).find(s => s.endpoint === endpoint) || null;
}

function validEndpoint(s) {
  if (typeof s !== "string" || s.length > 1000) return false;
  try { const u = new URL(s); return u.protocol === "https:" && PUSH_HOST_RE.test(u.hostname) && !u.username && !u.password; }
  catch { return false; }
}
const cleanDevice = s => clipText(typeof s === "string" ? s : "", 60) || "This device";

function cleanEvents(v, role) {
  if (!Array.isArray(v)) return null;
  const allowed = eventsFor(role);
  return [...new Set(v.filter(e => allowed.includes(e)))];
}

async function pushDispatch(c, path, method) {
  const { db, env, user } = c;
  const me = await fetchLiveAdmin(db, user.email);
  if (!me || !me.active) return json({ error: "Unauthorized" }, 401);
  const role = me.role;
  let m;

  if (method === "GET" && path === "/admin/push") {
    const keys = await vapidKeys(env);
    const devices = (await ownSubs(db, me)).map(deviceOut);
    return json({ configured: !!keys, publicKey: keys?.pubB64 || null, events: eventsFor(role), devices });
  }

  if (method === "POST" && path === "/admin/push/subscribe") {
    if (!(await vapidKeys(env))) return json({ error: "Notifications aren't set up on the server yet." }, 503);
    const body = await readJson(c.request);
    const sub = body.subscription && typeof body.subscription === "object" ? body.subscription : {};
    const endpoint = sub.endpoint, p256dh = sub.keys?.p256dh, auth = sub.keys?.auth;
    if (!validEndpoint(endpoint)) return json({ error: "This browser's push service isn't supported." }, 400);
    const pk = tryDecode(p256dh), ak = tryDecode(auth);
    if (pk?.length !== 65 || pk[0] !== 4 || ak?.length !== 16) return json({ error: "Invalid subscription." }, 400);
    const fields = { "Admin": [me.id], "Keys": JSON.stringify({ p256dh, auth }), "Device": cleanDevice(body.device), "Failures": 0 };
    const existing = await subByEndpoint(db, endpoint);
    let id;
    if (existing) {
      // Same device again (re-sync, or someone else signed in on it): keep its choices only if it's still the same admin.
      if (existing.adminId !== me.id) { fields["Events"] = JSON.stringify(eventsFor(role)); fields["Gemach Filter"] = ""; }
      await db.update(T.PUSH, existing.id, fields);
      id = existing.id;
    } else {
      const mine = await ownSubs(db, me);
      if (mine.length >= MAX_DEVICES) return json({ error: `You have notifications on ${MAX_DEVICES} devices already — remove one first.` }, 409);
      const created = await db.create(T.PUSH, { ...fields, "Endpoint": endpoint, "Events": JSON.stringify(eventsFor(role)) });
      id = created.id;
    }
    const now = (await ownSubs(db, me)).find(s => s.id === id);
    return json({ success: true, device: now ? deviceOut(now) : null });
  }

  if (method === "POST" && path === "/admin/push/unsubscribe") {
    const { endpoint } = await readJson(c.request);
    if (typeof endpoint !== "string" || !endpoint) return json({ error: "Missing endpoint" }, 400);
    const s = await subByEndpoint(db, endpoint);
    if (s && s.adminId === me.id) await db.del(T.PUSH, s.id);
    return json({ success: true });
  }

  if (method === "POST" && path === "/admin/push/test") {
    const keys = await vapidKeys(env);
    if (!keys) return json({ error: "Notifications aren't set up on the server yet." }, 503);
    const { endpoint } = await readJson(c.request);
    const s = typeof endpoint === "string" ? await subByEndpoint(db, endpoint) : null;
    if (!s || s.adminId !== me.id) return json({ error: "This device isn't registered — turn notifications on first." }, 404);
    const r = await sendPush(env, keys, s, {
      title: "Test notification", body: "Notifications are working on this device.", url: "/admin", tag: "test", event: "test", icon: DEFAULT_ICON,
    }).catch(e => ({ ok: false, status: 0, gone: false, detail: String(e.message || e) }));
    await recordResults(db, [s], [r]);
    if (r.gone) return json({ error: "This device's notification sign-up has expired. Turn notifications off and on again." }, 410);
    if (!r.ok) return json({ error: `The push service didn't accept it (${r.status || "no answer"}). Try again in a minute.` }, 502);
    return json({ success: true, sent: 1 });
  }

  if ((m = path.match(/^\/admin\/push\/([^/]+)$/)) && (method === "PATCH" || method === "DELETE")) {
    const id = m[1];
    if (!REC_RE.test(id)) return json({ error: "Not found" }, 404);
    const s = (await ownSubs(db, me)).find(x => x.id === id);
    if (!s) return json({ error: "Not found" }, 404);
    if (method === "DELETE") { await db.del(T.PUSH, id); return json({ success: true }); }
    const body = await readJson(c.request);
    const fields = {};
    if (body.events !== undefined) {
      const ev = cleanEvents(body.events, role);
      if (!ev) return json({ error: "events must be a list" }, 400);
      fields["Events"] = JSON.stringify(ev);
    }
    if (body.gemachs !== undefined) {
      if (body.gemachs === null) fields["Gemach Filter"] = "";
      else if (!Array.isArray(body.gemachs) || body.gemachs.some(x => !REC_RE.test(String(x)))) return json({ error: "gemachs must be a list of gemach ids or null" }, 400);
      else {
        const ids = [...new Set(body.gemachs)];
        if (role !== NETWORK_ADMIN_ROLE && ids.some(x => !me.gemachIds.includes(x))) return json({ error: "Forbidden for this gemach" }, 403);
        fields["Gemach Filter"] = JSON.stringify(ids);
      }
    }
    if (body.device !== undefined) fields["Device"] = cleanDevice(body.device);
    if (Object.keys(fields).length) await db.update(T.PUSH, id, fields);
    const now = (await ownSubs(db, me)).find(x => x.id === id);
    return json({ success: true, device: now ? deviceOut(now) : null });
  }

  return json({ error: "Not found" }, 404);
}

// ─── Event messages (what each notification says; never borrower details) ──────

const dayText = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${s}T12:00:00Z`));
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const adminLink = (g, params) => `/admin?${new URLSearchParams({ ...(g?.slug ? { g: g.slug } : {}), ...params })}`;

function requestMessage(g, { requestId, recId, itemCount, isAppt, style, eventDate, from, emailed }) {
  const parts = [];
  if (isAppt) parts.push(itemCount ? `Appointment · ${plural(itemCount, "item")}` : "Appointment request");
  else parts.push(plural(itemCount, "item"));
  if (eventDate && (style === "Event" || isAppt)) parts.push(`${g.eventLabel || "Event date"} ${dayText(eventDate)}`);
  else if (from) parts.push(`needed ${dayText(from)}`);
  if (!emailed) parts.push("not emailed to the gemach");
  return {
    event: "request", g, title: `New request · ${g.name || g.slug}`, body: parts.join(" · "),
    url: adminLink(g, { tab: "requests", ...(recId ? { req: recId } : {}) }), tag: `request-${requestId || recId || Date.now()}`,
  };
}

export { EVENTS, vapidKeys, vapidAuth, encryptPayload, sendPush, notifyAdmins, pushDispatch, requestMessage, dayText, plural, adminLink, validEndpoint };
