// Part of the Gemach Network worker (see index.js for routes and env vars).
import { logEvent } from "./activity.js";
import { AirtableError, linkedId, verifyOwnedIds } from "./airtable.js";
import { sendAlert } from "./alerts.js";
import { LEGACY_SLUG, T } from "./config.js";
import { addYearsDate, eventDates, isValidDate, nyToday } from "./dates.js";
import { buildEmailHtml, escHtml, sendEmail, sendNotificationEmail } from "./email.js";
import { DEFAULT_EVENT_LABEL, loadGemachBySlug } from "./gemachs.js";
import { json } from "./http.js";
import { getNextRequestId } from "./ids.js";
import { addonPrice, isAddonType, isQtyType, lendableQty, packageSize, packageUnit, qtyLabel, requestAvailability } from "./quantity.js";
import { EMAIL_RE, emailSignature } from "./settings.js";
import { manageUrl } from "./manage.js";
import { notifyAdmins, requestMessage } from "./push.js";
import { inTestMode, isLive } from "./testmode.js";

// ─── Public form submission ───────────────────────────────────────────────────

const clip = (s, n) => (s == null ? s : String(s).slice(0, n));

/** Preferred Contact values the public form offers (all exist as Requests."Preferred Contact" choices). */
const REQUEST_CONTACTS = ["WhatsApp", "Phone", "SMS", "Email"];

/** US numbers -> "(516) 555-1234"; other formats kept as entered (trimmed); null if < 7 digits. */
function formatPhone(raw) {
  const s = String(raw || "").trim();
  const d = s.replace(/\D/g, "");
  if (d.length < 7) return null;
  const us = d.length === 10 ? d : d.length === 11 && d[0] === "1" ? d.slice(1) : null;
  if (us && !/^\s*\+(?!1)/.test(s)) return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
  return s.slice(0, 50);
}

async function handleSubmitRequest(request, db, env, ctx) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }
  body = body && typeof body === "object" ? body : {};

  const str = v => (typeof v === "string" ? v.trim() : v == null ? "" : typeof v === "number" ? String(v) : null);
  const name = str(body.name), rawPhone = str(body.phone), email = str(body.email), notes = str(body.notes);
  const preferredContact = typeof body.preferredContact === "string" ? body.preferredContact.trim() : "";
  const neededFrom = str(body.neededFrom), neededUntil = str(body.neededUntil), openEnded = body.openEnded === true;
  if ([name, rawPhone, email, notes, neededFrom, neededUntil].some(v => v === null)) return json({ error: "Invalid request." }, 400);
  const itemsRequested = body.itemsRequested == null ? [] : body.itemsRequested;
  if (!Array.isArray(itemsRequested)) return json({ error: "Invalid items." }, 400);
  if (!name || !rawPhone) return json({ error: "Name and phone are required." }, 400);
  if (itemsRequested.length > 50) return json({ error: "Too many items." }, 400);

  const slug = String(body.gemach || LEGACY_SLUG).trim().toLowerCase();
  const g = await loadGemachBySlug(db, slug);
  // Test link (testmode.js): a Hidden or Coming-soon gemach takes requests, saved as Test.
  const testToken = typeof body.testToken === "string" && body.testToken ? body.testToken : null;
  const test = testToken ? await inTestMode(env, g, testToken) : false;
  if (testToken && !test) {
    return json({ error: g && isLive(g)
      ? `${g.name || "This gemach"} is now open for real requests, so the test link no longer works. Please reload the page if you meant to send a real request.`
      : "This test link isn't valid. Please ask the gemach for a new one." }, 409);
  }
  if (!g || (!g.active && !test)) return json({ error: "Unknown gemach." }, 400);
  if (g.mode === "Directory" || g.mode === "Info" || (g.comingSoon && !test)) {
    return json({ error: `${g.name || "This gemach"} doesn't take online requests. Please contact them directly${g.phone ? ` at ${g.phone}` : ""}.` }, 400);
  }
  const phone = formatPhone(rawPhone);
  if (!phone) return json({ error: "Please enter a valid phone number." }, 400);
  if (email && (!EMAIL_RE.test(email) || email.length > 200)) return json({ error: "Please enter a valid email address." }, 400);
  if (!REQUEST_CONTACTS.includes(preferredContact)) return json({ error: "Please choose the best way to reach you." }, 400);
  if (preferredContact === "Email" && !email) return json({ error: "Please enter your email address so we can reach you by email." }, 400);
  const style = g.requestStyle || "Dates";
  const isAppt = style === "Appointment";
  if (!isAppt && !itemsRequested.length) return json({ error: "Name, phone, and at least one item are required." }, 400);

  // Event date (required for Event style, optional for appointments): not in the past (NY), ≤ 2 years ahead.
  let eventDate = null;
  if (body.eventDate != null && body.eventDate !== "") {
    eventDate = String(body.eventDate);
    const todayNy = nyToday();
    const [ty, tm, td] = todayNy.split("-");
    const maxDate = `${Number(ty) + 2}-${tm}-${td === "29" && tm === "02" ? "28" : td}`;
    if (!isValidDate(eventDate)) return json({ error: `Please enter a valid ${(g.eventLabel || DEFAULT_EVENT_LABEL).toLowerCase()}.` }, 400);
    if (eventDate < todayNy) return json({ error: `The ${(g.eventLabel || DEFAULT_EVENT_LABEL).toLowerCase()} can't be in the past.` }, 400);
    if (eventDate > maxDate) return json({ error: `The ${(g.eventLabel || DEFAULT_EVENT_LABEL).toLowerCase()} must be within 2 years.` }, 400);
  } else if (style === "Event") {
    return json({ error: `${g.eventLabel || DEFAULT_EVENT_LABEL} is required.` }, 400);
  }

  let preferredTimes = null, partySize = null;
  if (isAppt) {
    preferredTimes = typeof body.preferredTimes === "string" ? body.preferredTimes.trim() : "";
    if (!preferredTimes) return json({ error: "Please tell us which days and times work for you." }, 400);
    if (preferredTimes.length > 1000) return json({ error: "Preferred times is too long (max 1000 characters)." }, 400);
    if (body.partySize != null && body.partySize !== "") {
      const n = Number(body.partySize);
      if (!Number.isInteger(n) || n < 1 || n > 20) return json({ error: "Party size must be between 1 and 20." }, 400);
      partySize = n;
    }
  }

  let itemIds = [], itemNames = [], typeMap = {};
  const qtyMap = {};
  if (itemsRequested.length) {
    typeMap = await verifyOwnedIds(db, T.ITEM_TYPES, itemsRequested, g);
    if (!typeMap || Object.values(typeMap).some(r => !r.fields.Active)) return json({ error: "One or more requested items are not available from this gemach." }, 400);
    itemIds = [...new Set(itemsRequested.map(linkedId))];
    // Quantity types (e.g. chairs): how many. Capped at what the gemach owns; more than is free
    // for the dates is allowed (the gemach decides) and flagged in the notification email.
    const rawQty = body.quantities && typeof body.quantities === "object" && !Array.isArray(body.quantities) ? body.quantities : {};
    for (const id of itemIds) {
      const t = typeMap[id];
      if (isAddonType(t)) { // made to order: any reasonable count, nothing to check against
        const n = rawQty[id] == null || rawQty[id] === "" ? 1 : Number(rawQty[id]);
        if (!Number.isInteger(n) || n < 1 || n > 500) return json({ error: `Please enter how many ${t.fields.Name || "add-ons"} you'd like (1–500).` }, 400);
        qtyMap[id] = n;
        continue;
      }
      if (!isQtyType(t)) continue;
      const name = t.fields.Name || "items";
      const max = lendableQty(t);
      if (max < 1) return json({ error: `${name} aren't available from this gemach right now. Please contact them directly.` }, 400);
      const ps = packageSize(t); // borrowers ask for whole packages (admin can still change the count)
      const n = rawQty[id] == null || rawQty[id] === "" ? ps : Number(rawQty[id]);
      if (!Number.isInteger(n) || n < 1) return json({ error: `Please enter how many ${name} you need.` }, 400);
      if (ps > 1 && n % ps) return json({ error: `${name} ${packageUnit(t) ? `come in ${packageUnit(t)}s of ${ps}` : `are lent in sets of ${ps}`} — please ask for ${ps}, ${ps * 2}, and so on.` }, 400);
      if (ps > 1 && n > max - (max % ps)) return json({ error: max >= ps ? `The gemach has ${max - (max % ps)} ${name} to lend in total — please ask for ${max - (max % ps)} or fewer.` : `${name} aren't available from this gemach right now. Please contact them directly.` }, 400);
      if (n > max) return json({ error: `The gemach has ${max} ${name} in total — please ask for ${max} or fewer.` }, 400);
      qtyMap[id] = n;
    }
    itemNames = itemIds.map(id => qtyLabel(typeMap[id].fields.Name || id, qtyMap[id]));
  }
  // The deposit is for borrowed items: an order of add-ons only doesn't need it.
  const addonsOnly = itemIds.length > 0 && itemIds.every(id => isAddonType(typeMap[id]));
  if (g.depositRequired && !addonsOnly && body.depositAck !== true) {
    return json({ error: `Please confirm that you understand the ${g.chargeType === "Payment" ? "payment" : "deposit"} requirement.` }, 400);
  }

  const requestId = await getNextRequestId(db);
  const fields = {
    "Request ID": requestId,
    "Name": clip(name, 200),
    "Phone": clip(phone, 50),
    "Status": "New",
    "Gemach": [g.id],
    "Request Type": isAppt ? "Appointment" : "Loan",
  };
  if (test) fields["Test"] = true;
  if (itemIds.length) fields["Items Requested"] = itemIds;
  if (Object.keys(qtyMap).length) fields["Item Quantities"] = JSON.stringify(qtyMap);
  if (email) fields["Email"] = clip(email, 200);
  fields["Preferred Contact"] = preferredContact; // validated against REQUEST_CONTACTS above
  if (g.depositRequired || body.depositAck === true) fields["Deposit Acknowledged"] = body.depositAck === true;
  if (eventDate) fields["Event Date"] = eventDate;

  let from = null, until = null, isOpen = false;
  if (style === "Event") {
    // Server is authoritative: client-computed dates are ignored.
    const d = eventDates(eventDate, g);
    from = d.pickup; until = d.return;
    fields["Needed From"] = from;
    fields["Needed Until"] = until;
    fields["Open-ended duration"] = false;
  } else if (isAppt) {
    fields["Preferred Times"] = preferredTimes;
    if (partySize != null) fields["Party Size"] = partySize;
  } else {
    if (!neededFrom) return json({ error: "Please choose the date you need it from." }, 400);
    if (!isValidDate(neededFrom)) return json({ error: "Please choose a valid date you need it from." }, 400);
    const todayNy = nyToday();
    if (neededFrom < todayNy) return json({ error: "The date you need it from can't be in the past." }, 400);
    if (neededFrom > addYearsDate(todayNy, 2)) return json({ error: "The date you need it from must be within 2 years." }, 400);
    isOpen = openEnded;
    if (!isOpen && neededUntil) {
      if (!isValidDate(neededUntil)) return json({ error: "Please choose a valid approximate return date." }, 400);
      if (neededUntil <= neededFrom) return json({ error: "The approximate return date must be after the date you need it from." }, 400);
      if (neededUntil > addYearsDate(todayNy, 3)) return json({ error: "The approximate return date is too far in the future." }, 400);
      fields["Needed Until"] = until = neededUntil;
    }
    fields["Open-ended duration"] = isOpen;
    fields["Needed From"] = from = neededFrom;
  }
  if (notes) fields["Notes"] = clip(notes, 5000);

  // What's free for the requested dates, per item — for the gemach's notification email (never blocks the request).
  let availability = null;
  if (itemIds.length && from && !isAppt) {
    try { availability = await requestAvailability(db, g, itemIds.map(id => typeMap[id]), qtyMap, { from, to: isOpen ? null : until || from }); }
    catch (e) { console.error("availability check failed:", e.message, e.detail ? JSON.stringify(e.detail) : ""); }
  }

  let created;
  try {
    created = await db.create(T.REQUESTS, fields);
  } catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Airtable error:", JSON.stringify(e.detail));
    return json({ error: "Failed to save request. Please contact the gemach directly." }, 500);
  }

  const notified = await sendNotificationEmail(env, g, {
    requestId, name, phone, email, preferredContact, itemNames, neededFrom: from, neededUntil: until, openEnded: isOpen, notes,
    requestType: isAppt ? "Appointment" : "Loan", eventDate, preferredTimes, partySize,
    depositAck: fields["Deposit Acknowledged"],
    items: itemIds.map(id => ({ id, name: typeMap[id].fields.Name || "Item", quantity: qtyMap[id] || null,
      addon: isAddonType(typeMap[id]), price: isAddonType(typeMap[id]) ? addonPrice(typeMap[id]) : null })),
    availability, test,
  });
  if (notified !== true) {
    ctx.waitUntil(sendAlert(env, {
      always: true,
      subject: `${test ? "[TEST] " : ""}New request ${requestId} for ${g.name || g.slug} — gemach was NOT notified`,
      text: `Request ${requestId} for ${g.name || g.slug} was saved, but the email telling the gemach about it ` +
        (notified === null ? "had no address to go to (the gemach has no Email set)." : "failed to send.") +
        `\n\nIt's waiting in admin under Requests. Please make sure someone at the gemach sees it.`,
    }).catch(e => console.error("alert failed:", e.message)));
  }

  // Lock-screen notification for the gemach's admins (no borrower details in it).
  ctx.waitUntil(notifyAdmins(env, requestMessage(g, {
    requestId, recId: created?.id, itemCount: itemIds.length, isAppt, style, eventDate, from, emailed: notified === true, test,
  }), { db }));

  logEvent(ctx, db, g, {
    eventType: "Request Received",
    borrower: fields["Name"] || null,
    itemType: itemNames.join(", ") || (isAppt ? "Appointment" : null),
    loanId: requestId,
    notes: [test ? "Test request (sent from the test link)." : null, fields["Notes"] || null].filter(Boolean).join("\n") || null,
  });

  const link = created?.id ? await manageUrl(env, created.id) : null;
  if (link && email) ctx.waitUntil(sendBorrowerReceipt(env, g, { email, name, requestId, itemNames, isAppt, link, test })
    .catch(e => console.error("receipt email failed:", e.message)));
  return json({ success: true, requestId, ...(test ? { test: true } : {}), ...(link ? { manageUrl: link } : {}) });
}

/** "We got your request" to the borrower (only when they gave an email), with their manage link. */
async function sendBorrowerReceipt(env, g, { email, name, requestId, itemNames, isAppt, link, test }) {
  const first = String(name || "").trim().split(/\s+/)[0] || "there";
  const what = isAppt ? "your appointment request" : `your request${itemNames.length ? ` for ${itemNames.join(", ")}` : ""}`;
  const text = `Hi ${first},\n\nThanks — ${g.name || "the gemach"} received ${what} (${requestId}). They'll be in touch soon.\n\n` +
    `To check on it or cancel, use your private link:\n${link}\n\nPlease don't share this link.`;
  const e = escHtml;
  const bodyHtml = `<p style="margin:0 0 12px;">Hi ${e(first)},</p>` +
    `<p style="margin:0 0 12px;">Thanks — ${e(g.name || "the gemach")} received ${e(what)} (${e(requestId)}). They'll be in touch soon.</p>` +
    `<p style="margin:18px 0;"><a href="${e(link)}" style="display:inline-block;background:#1B3A4B;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;">View or cancel your request</a></p>` +
    `<p style="margin:0;color:#5e6b72;font-size:13px;">This link is private to you — please don't share it.</p>`;
  return sendEmail(env, g, { to: email, subject: `${test ? "[TEST] " : ""}We got your request — ${g.name || "Gemach"} (${requestId})`, text: text + emailSignature(g), html: buildEmailHtml(g, text, { signature: true, bodyHtml }) });
}

export { clip, REQUEST_CONTACTS, formatPhone, handleSubmitRequest };
