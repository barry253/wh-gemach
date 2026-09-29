// Part of the Gemach Network worker (see index.js for routes and env vars).
import { DEFAULT_ADMIN_URL, DEFAULT_FROM_EMAIL } from "./config.js";
import { dateToUtcMs, isValidDate } from "./dates.js";
import { DEFAULT_EVENT_LABEL, DEFAULT_THEME, HEX_RE } from "./gemachs.js";
import { money, qtyLabel } from "./quantity.js";

// ─── Email ────────────────────────────────────────────────────────────────────

/** Returns true when Resend accepted the email, false when it failed, null when there was no address. */
async function sendEmail(env, g, { to, subject, text, html, attachments }) {
  if (!to) return null;
  try {
    const displayName = String(g?.name || "Gemach").replace(/["<>\r\n]/g, "");
    const replyTo = g?.email || env.NOTIFY_EMAIL;
    const payload = {
      from: `"${displayName}" <${env.FROM_EMAIL || DEFAULT_FROM_EMAIL}>`,
      to: [to],
      subject: String(subject).replace(/[\r\n]+/g, " "),
      text,
    };
    if (html) payload.html = html;
    if (attachments?.length) payload.attachments = attachments;
    if (replyTo) payload.reply_to = replyTo;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.text();
    if (!res.ok) { console.error("Resend failed:", res.status, out); return false; }
    console.log("Resend:", res.status, out);
    return true;
  } catch (e) {
    console.error("Resend error:", e.message);
    return false;
  }
}

/** "Wed, Sep 29, 2027" from "2027-09-29" (calendar date, no timezone shift). */
function longDate(s) {
  if (!isValidDate(s)) return s || "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(dateToUtcMs(s)));
}
const shortDate = s => (isValidDate(s) ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(dateToUtcMs(s))) : s || "");

/** "Add-on · $40 × 4 = $160" (price known) or "Add-on (for purchase)". */
function addonText(it) {
  const n = it.quantity || 1;
  if (it.price == null) return "Add-on (for purchase)";
  return n > 1 ? `Add-on · ${money(it.price)} × ${n} = ${money(it.price * n)}` : `Add-on · ${money(it.price)}`;
}
/** Sum of priced add-ons, or null when there are none with a price. */
function addonTotal(items) {
  const priced = items.filter(it => it.addon && it.price != null);
  return priced.length ? priced.reduce((s, it) => s + it.price * (it.quantity || 1), 0) : null;
}

/** One line of availability wording for an item, or "" when there's nothing to say. */
function availabilityText(a, isQty) {
  if (!a) return "";
  const back = a.backBy ? ` (next due back ${shortDate(a.backBy)})` : "";
  if (a.status === "ok") return isQty ? `${a.free} of ${a.capacity} free` : a.free === 1 ? "1 free" : `${a.free} free`;
  if (a.status === "none-owned") return "None listed in your inventory";
  if (a.status === "none") return (isQty ? `None free (you have ${a.capacity})` : `None free — all ${a.capacity} out or reserved`) + back;
  return `Only ${a.free} of ${a.needed} free` + back;
}

async function sendNotificationEmail(env, g, data) {
  const { requestId, name, phone, email, preferredContact, itemNames, neededFrom, neededUntil, openEnded, notes,
    requestType, eventDate, preferredTimes, partySize, depositAck, availability = null } = data;
  const isAppt = requestType === "Appointment";
  const items = data.items || (Array.isArray(itemNames) ? itemNames : itemNames ? [itemNames] : []).map(n => ({ name: n, quantity: null }));
  const label = it => qtyLabel(it.name, it.quantity);
  const conflicts = availability ? items.filter(it => availability[it.id] && availability[it.id].status !== "ok") : [];
  const dateRange = !neededFrom ? "No dates given"
    : openEnded ? `${longDate(neededFrom)} — open-ended`
    : `${longDate(neededFrom)} → ${neededUntil ? longDate(neededUntil) : "no return date given"}`;
  const adminUrl = env.ADMIN_URL || DEFAULT_ADMIN_URL;
  const link = `${adminUrl}${adminUrl.includes("?") ? "&" : "?"}g=${encodeURIComponent(g.slug)}`;
  const heading = isAppt ? `New appointment request — ${requestId}` : `New request — ${requestId}`;
  // No gemach Email → it goes to the network fallback address; say so, so whoever gets it knows why.
  const fallback = !g.email && !!env.NOTIFY_EMAIL;
  const gContact = [g.phone, g.whatsapp && g.whatsapp !== g.phone ? `WhatsApp ${g.whatsapp}` : ""].filter(Boolean).join(" · ");
  const fallbackNote = fallback
    ? `${g.name || "This gemach"} has no email address in its Settings, so this request came to you instead. ` +
      `${gContact ? `Gemach contact: ${gContact}. ` : ""}To send requests straight to the gemach, add an email in admin → Settings → Email.`
    : "";

  // ── Plain text ──
  const lines = [heading, ""];
  if (fallback) lines.push(`ℹ ${fallbackNote}`, "");
  if (conflicts.length) lines.push(`⚠ ${conflicts.length} of ${items.length} item${items.length === 1 ? "" : "s"} may not be available for these dates — see below.`, "");
  lines.push(`Name: ${name}`, `Phone: ${phone}`, `Email: ${email || "not provided"}`, `Preferred contact: ${preferredContact || "not specified"}`, "");
  if (isAppt) {
    lines.push(`Preferred times: ${preferredTimes || "not specified"}`);
    if (partySize != null) lines.push(`Party size: ${partySize}`);
    if (eventDate) lines.push(`${g.eventLabel || DEFAULT_EVENT_LABEL}: ${longDate(eventDate)}`);
  } else {
    if (eventDate) lines.push(`${g.eventLabel || DEFAULT_EVENT_LABEL}: ${longDate(eventDate)}`);
    lines.push(`Dates: ${dateRange}`);
  }
  if (items.length) {
    lines.push("", `${isAppt ? "Items of interest" : "Items requested"} (${items.length}):`);
    for (const it of items) {
      const a = it.addon ? addonText(it) : availabilityText(availability?.[it.id], it.quantity != null);
      lines.push(`  • ${label(it)}${a ? ` — ${a}` : ""}`);
    }
    const tot = addonTotal(items);
    if (tot != null) lines.push(`  Add-ons total: ${money(tot)} (separate payment)`);
    if (!isAppt && neededFrom && availability === null) lines.push("  (Couldn't check availability — please check in admin.)");
  }
  if (g.depositRequired) lines.push("", `Deposit acknowledged: ${depositAck ? "yes" : "no"}`);
  lines.push("", `Notes: ${notes || "none"}`, "", `Log in to review: ${link}`);
  const text = lines.join("\n").trim();

  // ── HTML ──
  const e = escHtml;
  const row = (k, v) => `<tr><td style="padding:3px 12px 3px 0;color:#5e6b72;white-space:nowrap;vertical-align:top;">${e(k)}</td><td style="padding:3px 0;vertical-align:top;">${v}</td></tr>`;
  const tel = String(phone || "").replace(/[^\d+]/g, "");
  const details = [
    row("Name", `<strong>${e(name)}</strong>`),
    row("Phone", tel ? `<a href="tel:${e(tel)}" style="color:#1B3A4B;">${e(phone)}</a>` : e(phone)),
    row("Email", email ? `<a href="mailto:${e(email)}" style="color:#1B3A4B;">${e(email)}</a>` : `<span style="color:#5e6b72;">not provided</span>`),
    row("Prefers", e(preferredContact || "not specified")),
  ];
  if (isAppt) {
    details.push(row("Preferred times", e(preferredTimes || "not specified")));
    if (partySize != null) details.push(row("Party size", e(partySize)));
    if (eventDate) details.push(row(g.eventLabel || DEFAULT_EVENT_LABEL, e(longDate(eventDate))));
  } else {
    if (eventDate) details.push(row(g.eventLabel || DEFAULT_EVENT_LABEL, `<strong>${e(longDate(eventDate))}</strong>`));
    details.push(row("Dates", `<strong>${e(dateRange)}</strong>`));
  }
  if (g.depositRequired) details.push(row("Deposit", depositAck ? "Acknowledged" : `<span style="color:#b91c1c;">Not acknowledged</span>`));

  const STATUS_STYLE = {
    ok: "background:#dcfce7;color:#166534;", short: "background:#fef3c7;color:#92400e;",
    none: "background:#fee2e2;color:#991b1b;", "none-owned": "background:#fee2e2;color:#991b1b;",
    addon: "background:#e0e7ff;color:#3730a3;",
  };
  const itemRows = items.map((it, i) => {
    const a = it.addon ? { status: "addon" } : availability?.[it.id];
    const txt = it.addon ? addonText(it) : availabilityText(a, it.quantity != null);
    const pill = a && txt ? `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;line-height:1.5;${STATUS_STYLE[a.status]}">${e(txt)}</span>` : "";
    const bg = i % 2 ? "#ffffff" : "#f8f9fa";
    return `<tr style="background:${bg};"><td style="padding:8px 10px;border-top:1px solid #e5e7eb;vertical-align:top;"><strong>${e(it.name)}</strong></td>` +
      `<td style="padding:8px 10px;border-top:1px solid #e5e7eb;text-align:center;vertical-align:top;white-space:nowrap;">${it.quantity != null ? `<strong>× ${e(it.quantity)}</strong>` : "1"}</td>` +
      `<td style="padding:8px 10px;border-top:1px solid #e5e7eb;vertical-align:top;">${pill}</td></tr>`;
  }).join("");
  const itemsTable = items.length
    ? `<div style="margin:18px 0 6px;font-weight:bold;">${isAppt ? "Items of interest" : "Items requested"} (${items.length})</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:6px;border-collapse:separate;font-size:14px;">` +
      `<tr style="background:#eef1f3;"><th align="left" style="padding:6px 10px;font-size:12px;color:#5e6b72;">Item</th><th style="padding:6px 10px;font-size:12px;color:#5e6b72;">Qty</th><th align="left" style="padding:6px 10px;font-size:12px;color:#5e6b72;">${isAppt ? "" : "For these dates"}</th></tr>` +
      itemRows + `</table>` +
      (addonTotal(items) != null ? `<div style="font-size:13px;margin-top:6px;"><strong>Add-ons total: ${e(money(addonTotal(items)))}</strong> <span style="color:#5e6b72;">(separate payment)</span></div>` : "") +
      (!isAppt && neededFrom && availability === null ? `<div style="font-size:12px;color:#5e6b72;margin-top:6px;">Couldn't check availability — please check in admin.</div>` : "")
    : "";
  const warn = conflicts.length
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;color:#78350f;border-radius:6px;padding:10px 12px;margin:0 0 16px;">` +
      `<strong>⚠ ${conflicts.length} of ${items.length} item${items.length === 1 ? "" : "s"} may not be available for these dates:</strong> ` +
      e(conflicts.map(label).join(", ")) + `</div>`
    : "";
  const fallbackHtml = fallback
    ? `<div style="background:#e0f2fe;border:1px solid #7dd3fc;color:#0c4a6e;border-radius:6px;padding:10px 12px;margin:0 0 16px;font-size:14px;">` +
      `<strong>Why you got this:</strong> ${e(fallbackNote)}</div>`
    : "";
  const bodyHtml =
    fallbackHtml +
    `<div style="font-size:17px;font-weight:bold;margin:0 0 12px;">${e(heading)}</div>` + warn +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;">${details.join("")}</table>` +
    itemsTable +
    `<div style="margin:16px 0 0;"><span style="color:#5e6b72;">Notes:</span> ${notes ? e(notes).replace(/\r\n?|\n/g, "<br>") : `<span style="color:#5e6b72;">none</span>`}</div>` +
    `<div style="margin:22px 0 4px;"><a href="${e(link)}" style="display:inline-block;background:#1B3A4B;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:bold;">Review in admin</a></div>`;

  const names = items.map(label);
  const itemSummary = names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2} more`;
  const subject = isAppt
    ? `New appointment request (${g.name || "Gemach"}): ${name}`
    : `${conflicts.length ? "⚠ " : ""}New ${g.name || "Gemach"} Request: ${name}${itemSummary ? ` — ${itemSummary}` : ""}`;

  return sendEmail(env, g, {
    to: g.email || env.NOTIFY_EMAIL,
    subject,
    text,
    html: buildEmailHtml(g, text, { signature: false, bodyHtml }),
  });
}


// ─── HTML email (inline styles only; no external CSS, no tracking) ─────────────

const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function relLuminance(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrastRatio(a, b) {
  const [x, y] = [relLuminance(a), relLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** White or near-black text, whichever contrasts more with the background. */
function textColorFor(bg) {
  const hex = HEX_RE.test(bg || "") ? bg : DEFAULT_THEME;
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#111111") ? "#FFFFFF" : "#111111";
}

function buildEmailHtml(g, message, { signature = true, bodyHtml = null } = {}) {
  const bg = HEX_RE.test(g?.themeColor || "") ? g.themeColor : DEFAULT_THEME;
  const fg = textColorFor(bg);
  const name = escHtml(g?.name || "Gemach");
  let logo = "";
  if (g?.logoUrl && /^https:\/\//i.test(g.logoUrl)) {
    logo = `<img src="${escHtml(g.logoUrl)}" width="64" height="64" alt="" style="display:block;width:64px;height:64px;border-radius:12px;border:0;margin:0 0 10px 0;background:#ffffff;">`;
  }
  const body = bodyHtml ?? escHtml(message).replace(/\r\n?|\n/g, "<br>"); // bodyHtml: pre-escaped markup built by the caller
  const contact = [g?.phone, g?.email].map(v => String(v || "").trim()).filter(Boolean).map(escHtml).join(" · ");
  const footer = signature
    ? `<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#555555;font-size:13px;line-height:1.5;">${name}${contact ? `<br>${contact}` : ""}</td></tr>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f5f7;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;"><tr><td align="center" style="padding:16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">` +
    `<tr><td style="background:${bg};color:${fg};padding:20px 24px;">${logo}<div style="font-size:20px;font-weight:bold;color:${fg};">${name}</div></td></tr>` +
    `<tr><td style="padding:24px;color:#1a1a1a;font-size:15px;line-height:1.6;">${body}</td></tr>` +
    footer +
    `</table></td></tr></table></body></html>`;
}

export { sendEmail, longDate, shortDate, availabilityText, sendNotificationEmail, escHtml, relLuminance, contrastRatio, textColorFor, buildEmailHtml };
