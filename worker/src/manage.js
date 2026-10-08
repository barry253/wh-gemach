// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// Borrower "manage" links — no login. Each request gets a private link:
//   https://whgemachs.org/r/<request record id>.<signature>
// The signature is an HMAC (key: GEMACH_JWT secret) of the record id, so links can't be guessed or altered,
// nothing secret is stored in Airtable, and admin can show the link for any request (old ones too).
// Rotating GEMACH_JWT invalidates every manage link (and every admin session).
//
// What the link allows:
//   GET  /public/manage/:token          request status, items, dates, and its reservations/loans (no address, no borrower phone)
//   POST /public/manage/:token/cancel   request still waiting → Cancelled; confirmed → its open reservations Cancelled
//                                       (items released), appointment → Cancelled. Gemach emailed, History logged.
//   POST /public/manage/:token/ready    "Ready to return": stamps its active loans, emails the gemach, logs History.
// Links stop working 30 days after everything from the request is finished (returned / cancelled / declined).

import { logEvent } from "./activity.js";
import { AirtableError, Q, firstLink, linkedId } from "./airtable.js";
import { purgePublicCache } from "./cache.js";
import { REC_RE, T } from "./config.js";
import { formatNy } from "./dates.js";
import { longDate, sendEmail, buildEmailHtml, escHtml } from "./email.js";
import { loadGemachBySlug, selName } from "./gemachs.js";
import { json } from "./http.js";
import { itemTypeInfoMap, loanQty, parseQtyMap, qtyLabel } from "./quantity.js";
import { publicGemach } from "./public.js";
import { adminLink, dayText, notifyAdmins } from "./push.js";
import { isTestRequest } from "./testmode.js";

const DEFAULT_SITE_URL = "https://whgemachs.org";
const SIG_LEN = 22; // base64url chars ≈ 132 bits
const LINK_GRACE_MS = 30 * 24 * 3600e3;
const enc = new TextEncoder();

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function manageSig(env, recId) {
  if (!env.GEMACH_JWT) return null;
  const key = await crypto.subtle.importKey("raw", enc.encode(String(env.GEMACH_JWT)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(`manage-link:v1:${recId}`))).slice(0, SIG_LEN);
}

/** "<recId>.<sig>" for a request record, or null when the worker has no secret. */
async function manageToken(env, recId) {
  if (!REC_RE.test(recId || "")) return null;
  const sig = await manageSig(env, recId);
  return sig ? `${recId}.${sig}` : null;
}

async function manageUrl(env, recId) {
  const t = await manageToken(env, recId);
  return t ? `${String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "")}/r/${t}` : null;
}

/** The request record id a token is for, or null (constant-time compare). */
async function verifyManageToken(env, token) {
  const m = String(token || "").match(/^(rec[A-Za-z0-9]{14})\.([A-Za-z0-9_-]{22})$/);
  if (!m) return null;
  const want = await manageSig(env, m[1]);
  if (!want) return null;
  let diff = 0;
  for (let i = 0; i < SIG_LEN; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? m[1] : null;
}

/** Load everything the manage page needs, or { status, error }. */
async function loadManaged(db, env, token) {
  const recId = await verifyManageToken(env, token);
  if (!recId) return { status: 404, error: "This link isn't valid. Please contact the gemach." };
  const rec = await db.get(T.REQUESTS, recId);
  if (!rec) return { status: 404, error: "We couldn't find this request. Please contact the gemach." };
  const slug = (rec.fields["Gemach Slug"] || [])[0];
  const g = slug ? await loadGemachBySlug(db, String(slug)) : null;
  // A test request (sent from a Hidden gemach's test link) keeps working while the gemach is hidden.
  if (!g || (!g.active && !isTestRequest(rec))) return { status: 404, error: "We couldn't find this request. Please contact the gemach." };
  const requestId = rec.fields["Request ID"] || "";
  const loans = requestId
    ? (await db.listAll(T.LOANS, { scope: g, where: [Q.linksTo("Source Request", rec.id, requestId)],
      fields: ["Loan ID", "Source Request", "Status", "Item to Reserve", "Quantity", "Date Borrowed", "Expected Return", "Date Returned",
        "Reservation Start", "Reservation End", "Ready To Return At"] }))
      .filter(l => (l.fields["Source Request"] || []).map(linkedId).includes(rec.id))
    : [];
  return { rec, g, loans };
}

const reqStatus = rec => selName(rec.fields["Status"]) || "New";
const isAppt = rec => selName(rec.fields["Request Type"]) === "Appointment";
const openLoans = loans => loans.filter(l => ["Reserved", "Active"].includes(selName(l.fields.Status)));
/** Appointment visit recorded in admin: "Checked out" / "Nothing borrowed" / "No-show", or null. */
const visitOf = rec => String(rec.fields["Visit Outcome"] || "").trim() || null;

/** Whether the request is finished long enough ago that its link should stop working. */
function expired(rec, loans) {
  const st = reqStatus(rec);
  if (st === "New") return false;
  if (openLoans(loans).length) return false;
  if (isAppt(rec) && st === "Converted" && !loans.length) {
    const at = Date.parse(rec.fields["Visited At"] || rec.fields["Appointment At"] || "");
    return Number.isFinite(at) && Date.now() - at > LINK_GRACE_MS;
  }
  const ends = loans.map(l => Date.parse(l.fields["Date Returned"] || l.fields["Reservation End"] || l.fields["Reservation Start"] || ""))
    .concat([Date.parse(rec.fields["Needed Until"] || rec.fields["Needed From"] || rec.fields["Received At"] || rec.createdTime || "")])
    .filter(Number.isFinite);
  return ends.length ? Date.now() - Math.max(...ends) > LINK_GRACE_MS : false;
}

async function managePayload(db, rec, g, loans) {
  const f = rec.fields;
  const typeIds = [...(f["Items Requested"] || []).map(linkedId), ...loans.map(l => linkedId(firstLink(l.fields["Item to Reserve"])))].filter(Boolean);
  const info = await itemTypeInfoMap(db, typeIds, g);
  const qmap = parseQtyMap(f["Item Quantities"]);
  const st = reqStatus(rec);
  const open = openLoans(loans);
  const active = loans.filter(l => selName(l.fields.Status) === "Active");
  const reserved = loans.filter(l => selName(l.fields.Status) === "Reserved");
  const status = st === "Cancelled" ? "cancelled" : st === "Declined" ? "declined" : st === "New" ? "waiting"
    : isAppt(rec) && !visitOf(rec) ? "appointment"
    : isAppt(rec) && visitOf(rec) !== "Checked out" ? (visitOf(rec) === "Nothing borrowed" ? "visited" : "closed")
    : active.length ? "out" : reserved.length ? "confirmed"
    : loans.some(l => selName(l.fields.Status) === "Returned") ? "returned" : "closed";
  const gp = publicGemach(g, null);
  return {
    gemach: { name: gp.name, slug: gp.slug, phone: gp.phone, email: gp.email, whatsapp: gp.whatsapp, primaryContact: gp.primaryContact,
      secondaryContact: gp.secondaryContact, logoUrl: gp.logoUrl, logoDarkUrl: gp.logoDarkUrl, themeColor: gp.themeColor, accentColor: gp.accentColor,
      requestStyle: gp.requestStyle, eventLabel: gp.eventLabel },
    request: {
      requestId: f["Request ID"] || null,
      firstName: String(f["Name"] || "").trim().split(/\s+/)[0] || null,
      type: isAppt(rec) ? "Appointment" : "Loan",
      status,
      receivedAt: f["Received At"] || rec.createdTime || null,
      neededFrom: f["Needed From"] || null,
      neededUntil: f["Open-ended duration"] ? null : f["Needed Until"] || null,
      openEnded: !!f["Open-ended duration"],
      eventDate: f["Event Date"] || null,
      appointmentAt: st === "Converted" ? f["Appointment At"] || null : null,
      visitOutcome: isAppt(rec) ? visitOf(rec) : null,
      items: (f["Items Requested"] || []).map(linkedId).filter(id => info[id]).map(id => ({
        name: info[id].name, quantity: info[id].qty || info[id].addon ? qmap[id] || 1 : null, addon: !!info[id].addon })),
    },
    loans: loans.filter(l => selName(l.fields.Status) !== "Cancelled" || st === "Cancelled").map(l => {
      const lf = l.fields, t = info[linkedId(firstLink(lf["Item to Reserve"]))];
      return {
        loanId: lf["Loan ID"] || null,
        itemName: t?.name || null,
        quantity: t?.qty || t?.addon ? loanQty(lf) : null,
        addon: !!t?.addon,
        status: selName(lf.Status) || null,
        reservationStart: lf["Reservation Start"] || null,
        reservationEnd: lf["Reservation End"] || null,
        dateBorrowed: lf["Date Borrowed"] || null,
        expectedReturn: lf["Expected Return"] || null,
        readyToReturnAt: lf["Ready To Return At"] || null,
      };
    }),
    can: {
      cancel: st === "New" || (st === "Converted" && (isAppt(rec) ? !visitOf(rec) && !!f["Appointment At"] && Date.parse(f["Appointment At"]) > Date.now() : reserved.length > 0)),
      readyToReturn: active.some(l => !l.fields["Ready To Return At"]),
    },
    partlyOut: !!(active.length && reserved.length),
    ...(isTestRequest(rec) ? { test: true } : {}),
    openCount: open.length,
  };
}

async function handleGetManage(db, env, token) {
  const r = await loadManaged(db, env, token);
  if (r.error) return json({ error: r.error }, r.status);
  if (expired(r.rec, r.loans)) return json({ error: "This link has expired. Please contact the gemach.", expired: true }, 410);
  return json(await managePayload(db, r.rec, r.g, r.loans));
}

/** Plain-text + HTML email to the gemach (falls back to NOTIFY_EMAIL like new-request emails). */
async function notifyGemach(env, g, { subject, lines }) {
  const text = lines.join("\n");
  const body = lines.map(l => (l ? `<p style="margin:0 0 10px;">${escHtml(l)}</p>` : "")).join("");
  return sendEmail(env, g, { to: g.email || env.NOTIFY_EMAIL, subject, text, html: buildEmailHtml(g, text, { signature: false, bodyHtml: body }) });
}

function whoLine(rec) {
  const f = rec.fields;
  return `${f["Name"] || "The borrower"}${f["Phone"] ? ` · ${f["Phone"]}` : ""}${f["Email"] ? ` · ${f["Email"]}` : ""}`;
}

async function handleManageCancel(db, env, ctx, token) {
  const r = await loadManaged(db, env, token);
  if (r.error) return json({ error: r.error }, r.status);
  const { rec, g, loans } = r;
  if (expired(rec, loans)) return json({ error: "This link has expired. Please contact the gemach.", expired: true }, 410);
  const payload = await managePayload(db, rec, g, loans);
  if (!payload.can.cancel) {
    const st = reqStatus(rec);
    return json({ error: st === "Cancelled" ? "This request was already cancelled." : payload.partlyOut || payload.request.status === "out"
      ? "The items have already been picked up — use “Ready to return” or contact the gemach." : "This request can't be cancelled online. Please contact the gemach." }, 409);
  }
  const f = rec.fields, rid = f["Request ID"] || rec.id;
  const by = "Borrower (online)";
  const wasWaiting = reqStatus(rec) === "New" && !isAppt(rec); // nothing confirmed yet: it was in Requests
  const cancelled = [];
  try {
    if (reqStatus(rec) === "New" || isAppt(rec)) {
      await db.update(T.REQUESTS, rec.id, { "Status": "Cancelled" });
    }
    for (const l of loans.filter(x => selName(x.fields.Status) === "Reserved")) {
      await db.update(T.LOANS, l.id, { "Status": "Cancelled" });
      cancelled.push(l);
    }
    if (reqStatus(rec) === "Converted" && !isAppt(rec) && !loans.some(x => selName(x.fields.Status) === "Active")) {
      await db.update(T.REQUESTS, rec.id, { "Status": "Cancelled" });
    }
  } catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("manage cancel failed:", JSON.stringify(e.detail));
    return json({ error: "Couldn't cancel right now. Please try again or contact the gemach." }, 502);
  }

  const itemsText = payload.request.items.map(i => qtyLabel(i.name, i.quantity)).join(", ");
  logEvent(ctx, db, g, { eventType: "Request Cancelled", borrower: f["Name"] || null, itemType: itemsText || (isAppt(rec) ? "Appointment" : null), loanId: rid, admin: by,
    notes: cancelled.length ? `Cancelled by the borrower online; released ${cancelled.map(l => l.fields["Loan ID"]).filter(Boolean).join(", ")}` : "Cancelled by the borrower online" });
  const infoByLoan = Object.fromEntries(payload.loans.map(l => [l.loanId, l]));
  for (const l of cancelled) {
    const li = infoByLoan[l.fields["Loan ID"]] || {};
    logEvent(ctx, db, g, { eventType: "Reservation Cancelled", borrower: f["Name"] || null, itemType: li.itemName || null, loanId: l.fields["Loan ID"] || null, admin: by });
  }
  if (cancelled.length) purgePublicCache(env, ctx, g.slug); // quantities free up on the public page

  const when = isAppt(rec) && f["Appointment At"] ? `Appointment was ${formatNy(Date.parse(f["Appointment At"]))}.`
    : f["Needed From"] ? `Dates were ${longDate(f["Needed From"])}${f["Needed Until"] ? ` → ${longDate(f["Needed Until"])}` : ""}.` : "";
  ctx.waitUntil(notifyGemach(env, g, {
    subject: `${isTestRequest(rec) ? "[TEST] " : ""}Cancelled: ${g.name || "Gemach"} request ${rid} — ${f["Name"] || "borrower"}`,
    lines: [
      `${f["Name"] || "The borrower"} cancelled request ${rid} using their manage link.`,
      itemsText ? `Items: ${itemsText}` : "",
      when,
      cancelled.length ? `Released reservation${cancelled.length === 1 ? "" : "s"} ${cancelled.map(l => l.fields["Loan ID"]).filter(Boolean).join(", ")} — the items are available again.` : "",
      `Contact: ${whoLine(rec)}`,
      "",
      "Nothing else to do — it's recorded in History.",
    ].filter(l => l !== ""),
  }).catch(e => console.error("cancel notify failed:", e.message)));

  const pushWhen = isAppt(rec) && f["Appointment At"] ? `appointment ${formatNy(Date.parse(f["Appointment At"]))}`
    : f["Needed From"] ? `${dayText(f["Needed From"])}${f["Needed Until"] ? ` → ${dayText(f["Needed Until"])}` : ""}` : "";
  ctx.waitUntil(notifyAdmins(env, {
    event: "cancel", g, title: `Request cancelled · ${g.name || g.slug}`,
    body: [itemsText || (isAppt(rec) ? "Appointment" : "Request"), pushWhen].filter(Boolean).join(" · "),
    url: adminLink(g, { tab: wasWaiting ? "requests" : "reservations" }), tag: `cancel-${rec.id}`,
  }, { db }));

  const fresh = await loadManaged(db, env, token);
  return json({ success: true, ...(fresh.error ? {} : await managePayload(db, fresh.rec, fresh.g, fresh.loans)) });
}

async function handleManageReady(db, env, ctx, token) {
  const r = await loadManaged(db, env, token);
  if (r.error) return json({ error: r.error }, r.status);
  const { rec, g, loans } = r;
  if (expired(rec, loans)) return json({ error: "This link has expired. Please contact the gemach.", expired: true }, 410);
  const todo = loans.filter(l => selName(l.fields.Status) === "Active" && !l.fields["Ready To Return At"]);
  if (!todo.length) {
    const already = loans.some(l => selName(l.fields.Status) === "Active");
    return json({ error: already ? "We've already let the gemach know." : "Nothing is out on loan for this request." }, 409);
  }
  const now = new Date().toISOString();
  try {
    for (const l of todo) await db.update(T.LOANS, l.id, { "Ready To Return At": now });
  } catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("manage ready failed:", JSON.stringify(e.detail));
    return json({ error: "Couldn't send that right now. Please try again or contact the gemach." }, 502);
  }
  const f = rec.fields, rid = f["Request ID"] || rec.id;
  const payload = await managePayload(db, rec, g, loans);
  const byId = Object.fromEntries(payload.loans.map(l => [l.loanId, l]));
  const names = todo.map(l => { const x = byId[l.fields["Loan ID"]] || {}; return qtyLabel(x.itemName || "Item", x.quantity); });
  for (const l of todo) {
    const x = byId[l.fields["Loan ID"]] || {};
    logEvent(ctx, db, g, { eventType: "Ready to Return", borrower: f["Name"] || null, itemType: x.itemName || null, loanId: l.fields["Loan ID"] || null, admin: "Borrower (online)" });
  }
  ctx.waitUntil(notifyGemach(env, g, {
    subject: `${isTestRequest(rec) ? "[TEST] " : ""}Ready to return: ${names.join(", ")} — ${f["Name"] || "borrower"}`,
    lines: [
      `${f["Name"] || "The borrower"} says they're ready to return: ${names.join(", ")} (request ${rid}).`,
      `Please get in touch to arrange the return: ${whoLine(rec)}`,
      "",
      "The loan is flagged “Ready to return” in admin under Loans.",
    ],
  }).catch(e => console.error("ready notify failed:", e.message)));
  ctx.waitUntil(notifyAdmins(env, {
    event: "ready", g, title: `Ready to return · ${g.name || g.slug}`, body: names.join(", "),
    url: adminLink(g, { tab: "loans", loan: todo[0].id }), tag: `ready-${rec.id}`,
  }, { db }));
  const fresh = await loadManaged(db, env, token);
  return json({ success: true, ...(fresh.error ? {} : await managePayload(db, fresh.rec, fresh.g, fresh.loans)) });
}

export { DEFAULT_SITE_URL, manageToken, manageUrl, verifyManageToken, handleGetManage, handleManageCancel, handleManageReady };
