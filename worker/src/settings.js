// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, fetchByIds } from "./airtable.js";
import { validateAttrDefs } from "./attributes.js";
import { NETWORK_ADMIN_ROLE, REC_RE, T } from "./config.js";
import { CONTACT_METHODS, HEX_RE, ITEM_VIEWS, REQUEST_STYLES, gemachFromRecord, gemachMemo, getGemachRecord } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { NAME_TAKEN, gemachNameTaken } from "./network.js";
import { publicGemach } from "./public.js";

// ─── Gemach profile & message templates (admin) ───────────────────────────────

const TEMPLATE_PLACEHOLDERS = ["first_name", "items", "gemach", "pickup_address", "pickup_instructions", "hours", "phone", "email", "appointment_time", "deposit_info", "event_date", "manage_link", "borrowed_date", "due_back", "days_out"];
const DEFAULT_TEMPLATES = {
  confirm: "Hi {first_name}, great news — we have {items} available for you from the {gemach}. We'll be in touch shortly with pickup details.\n\nPickup is at {pickup_address}. {pickup_instructions}\n\nManage or cancel: {manage_link}\n\nThank you!",
  confirmNoAddress: "Hi {first_name}, great news — we have {items} available for you from the {gemach}. We'll be in touch shortly with pickup details.\n\nManage or cancel: {manage_link}\n\nThank you!",
  decline: "Hi {first_name}, thank you for reaching out to the {gemach}. Unfortunately we're unable to accommodate your request at this time. Please don't hesitate to reach out again in the future.",
  pickup: "Hi {first_name}, your {items} is ready for pickup at {pickup_address}. {pickup_instructions} Please let us know when you plan to come by so we can make sure it's accessible. Thank you!\n\nManage your loan: {manage_link}",
  pickupNoAddress: "Hi {first_name}, your {items} is ready for pickup. {pickup_instructions} Please let us know when you plan to come by so we can make sure it's accessible. Thank you!\n\nManage your loan: {manage_link}",
  appointment: "Hi {first_name}, your appointment at the {gemach} is set for {appointment_time}. The address is {pickup_address}. {pickup_instructions} Please let us know if you need to reschedule. Thank you!\n\nManage or cancel: {manage_link}",
  // Return reminder (admin Loans). {due_back} = "is due back on Fri, Oct 9" / "is due back today" / "was due back on Fri, Oct 2" (blank if no date).
  returnReminder: "Hi {first_name}, a friendly reminder from the {gemach}: the {items} you borrowed on {borrowed_date} {due_back}. Please let us know when you can return it, or if you need it a little longer.\n\nManage your loan: {manage_link}\n\nThank you!",
  appointmentNoAddress: "Hi {first_name}, your appointment at the {gemach} is set for {appointment_time}. {pickup_instructions} Please let us know if you need to reschedule. Thank you!\n\nManage or cancel: {manage_link}",
};

/** Effective template text: stored value, else built-in default. */
function effectiveTemplates(g) {
  const raw = g.rawTemplates || {};
  return {
    confirm: raw.confirm || (g.pickupAddress ? DEFAULT_TEMPLATES.confirm : DEFAULT_TEMPLATES.confirmNoAddress),
    decline: raw.decline || DEFAULT_TEMPLATES.decline,
    pickup: raw.pickup || (g.pickupAddress ? DEFAULT_TEMPLATES.pickup : DEFAULT_TEMPLATES.pickupNoAddress),
    appointment: raw.appointment || (g.pickupAddress ? DEFAULT_TEMPLATES.appointment : DEFAULT_TEMPLATES.appointmentNoAddress),
    returnReminder: raw.returnReminder || DEFAULT_TEMPLATES.returnReminder,
  };
}

/** Footer appended to borrower emails: "\n\n—\n{name}\n{phone} · {email}" (missing parts omitted). */
function emailSignature(g) {
  const name = String(g?.name || "").trim();
  const contact = [g?.phone, g?.email].map(v => String(v || "").trim()).filter(Boolean).join(" · ");
  const lines = [name, contact].filter(Boolean);
  return lines.length ? `\n\n—\n${lines.join("\n")}` : "";
}

const ADMIN_EDIT_ROLES = new Set(["Owner", "Manager", NETWORK_ADMIN_ROLE]);
const canEditGemach = user => ADMIN_EDIT_ROLES.has(user?.role);
/** Owners (and Network Admins) add, change and remove the gemach's team. */
const canManageTeam = user => user?.role === "Owner" || user?.role === NETWORK_ADMIN_ROLE;

async function adminGemachPayload(db, g, user) {
  const communities = await fetchByIds(db, T.COMMUNITIES, g.communityIds.slice(0, 1), { fields: ["Name"] });
  return {
    ...publicGemach(g, communities[0]?.fields?.Name),
    pickupAddress: g.pickupAddress,
    pickupInstructions: g.pickupInstructions,
    defaultLoanDays: g.defaultLoanDays,
    templates: effectiveTemplates(g),
    rawTemplates: { ...g.rawTemplates },
    placeholders: TEMPLATE_PLACEHOLDERS,
    canEdit: canEditGemach(user),
    canManageTeam: canManageTeam(user),
    autoReminders: !!g.autoReminders, reminderDaysBefore: g.reminderDaysBefore, reminderRepeatDays: g.reminderRepeatDays,
  };
}

async function handleGetAdminGemach({ db, g, user }) {
  // Read the record fresh (the slug memo may be up to 60s old).
  const rec = await getGemachRecord(db, g.id);
  const fresh = rec ? gemachFromRecord(rec) : g;
  return json(await adminGemachPayload(db, fresh, user));
}

// body key -> [Airtable field, kind]; kind: line (≤200, single line), long (≤2000), email, url
const GEMACH_EDITABLE = {
  name:               ["Name", "name"],
  tagline:            ["Tagline", "line"],
  description:        ["Description", "long"],
  phone:              ["Phone", "line"],
  email:              ["Email", "email"],
  whatsapp:           ["WhatsApp", "line"],
  website:            ["Website", "url"],
  donationUrl:        ["Donation URL", "url"],
  donationInfo:       ["Donation Info", "long"],
  hours:              ["Hours", "long"],
  pickupAddress:      ["Pickup Address", "line"],
  pickupInstructions: ["Pickup Instructions", "long"],
  confirmMessage:     ["Confirm Message", "long"],
  declineMessage:     ["Decline Message", "long"],
  pickupMessage:      ["Pickup Message", "long"],
  // v3
  primaryContact:     ["Primary Contact", "contact"],
  secondaryContact:   ["Secondary Contact", "contact"],
  themeColor:         ["Theme Color", "color"],
  accentColor:        ["Accent Color", "color"],
  depositRequired:    ["Deposit Required", "bool"],
  chargeType:         ["Charge Type", "charge"],
  itemView:           ["Item View", "view"],
  depositInfo:        ["Deposit Info", "long"],
  gemachInfo:         ["Gemach Info", "long"],
  requestStyle:       ["Request Style", "style"],
  eventLabel:         ["Event Label", "label"],
  pickupDaysBefore:   ["Pickup Days Before", "days"],
  returnDaysAfter:    ["Return Days After", "days"],
  defaultLoanDays:    ["Default Loan Days", "loandays"],
  shabbosAdjust:      ["Shabbos Adjust", "bool"],
  appointmentMessage: ["Appointment Message", "long"],
  returnReminderMessage: ["Return Reminder Message", "long"],
  autoReminders:      ["Auto Reminders", "bool"],
  reminderDaysBefore: ["Reminder Days Before", "days"],
  reminderRepeatDays: ["Reminder Repeat Days", "repeat"],
  logoUrl:            ["Logo URL", "logo"],
  itemAttributes:     ["Item Attributes", "attrs"],
  browseCategoryIds:  ["Browse Categories", "cats"],
};
const GEMACH_LABELS = {
  tagline: "Tagline", description: "Description", phone: "Phone", email: "Email", whatsapp: "WhatsApp",
  website: "Website", donationUrl: "Donation link", donationInfo: "Donation info", hours: "Hours", pickupAddress: "Pickup address",
  pickupInstructions: "Pickup instructions", confirmMessage: "Confirm message", declineMessage: "Decline message",
  pickupMessage: "Pickup message", name: "Gemach name",
  primaryContact: "Primary contact", secondaryContact: "Secondary contact", themeColor: "Theme color", accentColor: "Accent color",
  depositRequired: "Deposit required", chargeType: "Deposit or payment", itemView: "Item view", depositInfo: "Deposit info", gemachInfo: "General info", requestStyle: "Request style",
  eventLabel: "Event label", pickupDaysBefore: "Pickup days before", returnDaysAfter: "Return days after", defaultLoanDays: "Usual loan length",
  shabbosAdjust: "Shabbos adjust", appointmentMessage: "Appointment message", returnReminderMessage: "Return reminder message", autoReminders: "Automatic reminders", reminderDaysBefore: "Reminder days before", reminderRepeatDays: "Overdue reminder every", logoUrl: "Logo", itemAttributes: "Item filters", browseCategoryIds: "Browse categories",
};
const CONTACT_NEEDS = { Call: "phone", Text: "phone", WhatsApp: "whatsapp", Email: "email" };
const MAX_LINE = 200, MAX_LONG = 2000;
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/**
 * Validate a PATCH body -> { fields } or { error }. Empty string / null clears a field.
 * ctx: { current (gemachFromRecord of the fresh record), logoPrefix } — used for cross-field rules.
 */
function validateGemachPatch(body, { current = null, logoPrefix = null } = {}) {
  const fields = {};
  for (const [key, [field, kind]] of Object.entries(GEMACH_EDITABLE)) {
    if (!(key in body) || body[key] === undefined) continue;
    let v = body[key];
    const label = GEMACH_LABELS[key];

    if (kind === "bool") {
      if (typeof v !== "boolean") return { error: `${label} must be true or false.` };
      fields[field] = v;
      continue;
    }
    if (kind === "cats") { // checked against active categories in handleUpdateAdminGemach
      if (v === null || v === "") v = [];
      if (!Array.isArray(v) || v.length > 12 || !v.every(x => typeof x === "string" && REC_RE.test(x))) return { error: "Browse categories must be a list of categories (up to 12)." };
      fields[field] = [...new Set(v)];
      continue;
    }
    if (kind === "attrs") {
      const r = validateAttrDefs(v);
      if (r.error) return { error: r.error };
      fields[field] = r.value;
      continue;
    }
    if (kind === "repeat") {
      if (typeof v === "string" && v.trim() !== "") v = Number(v);
      if (!Number.isInteger(v) || v < 0 || v > 30) return { error: `${label} must be a whole number of days from 0 to 30.` };
      fields[field] = v;
      continue;
    }
    if (kind === "loandays") { // optional: blank clears
      if (v === null || (typeof v === "string" && v.trim() === "")) { fields[field] = null; continue; }
      if (typeof v === "string") v = Number(v);
      if (!Number.isInteger(v) || v < 1 || v > 365) return { error: `${label} must be a whole number of days from 1 to 365, or blank.` };
      fields[field] = v;
      continue;
    }
    if (kind === "days") {
      if (typeof v === "string" && v.trim() !== "") v = Number(v);
      if (!Number.isInteger(v) || v < 0 || v > 14) return { error: `${label} must be a whole number from 0 to 14.` };
      fields[field] = v;
      continue;
    }

    if (v === null) v = "";
    if (typeof v !== "string") return { error: `${label} must be text.` };
    v = v.replace(/\r\n?/g, "\n").trim();

    if (kind === "contact") {
      if (!v) {
        if (key === "primaryContact") return { error: "Primary contact is required." };
        fields[field] = null;
        continue;
      }
      if (!CONTACT_METHODS.includes(v)) return { error: `${label} must be one of ${CONTACT_METHODS.join(", ")}.` };
      fields[field] = v;
      continue;
    }
    if (kind === "view") {
      if (!ITEM_VIEWS.includes(v)) return { error: `Item view must be one of ${ITEM_VIEWS.join(", ")}.` };
      fields[field] = v;
      continue;
    }
    if (kind === "charge") {
      if (!["Deposit", "Payment"].includes(v)) return { error: "Choose deposit or payment." };
      fields[field] = v;
      continue;
    }
    if (kind === "style") {
      if (!REQUEST_STYLES.includes(v)) return { error: `${label} must be one of ${REQUEST_STYLES.join(", ")}.` };
      fields[field] = v;
      continue;
    }
    if (kind === "color") {
      if (v && !HEX_RE.test(v)) return { error: `${label} must be a hex color like #1B3A4B.` };
      fields[field] = v ? v.toUpperCase() : null;
      continue;
    }
    if (kind === "logo") {
      if (!v) { fields[field] = null; continue; }
      let u = null;
      try { u = new URL(v); } catch { /* invalid */ }
      if (!u || !logoPrefix || !u.href.startsWith(logoPrefix) || u.search || u.hash || u.href.includes("..")) {
        return { error: "Logo must be uploaded with “Upload logo”." };
      }
      fields[field] = u.href;
      continue;
    }

    if (kind !== "long") v = v.replace(/\s*\n\s*/g, " ");
    if (kind === "name") {
      v = v.replace(/\s+/g, " ");
      if (!v) return { error: "Gemach name can't be empty." };
      if (v.length > 100) return { error: "Gemach name is too long (max 100 characters)." };
      fields[field] = v;
      continue;
    }
    const max = kind === "long" ? MAX_LONG : kind === "label" ? 60 : MAX_LINE;
    if (v.length > max) return { error: `${label} is too long (max ${max} characters).` };
    if (v && kind === "email" && !EMAIL_RE.test(v)) return { error: `${label} doesn't look like a valid email address.` };
    if (v && kind === "url") {
      let u = null;
      try { u = new URL(v); } catch { /* invalid */ }
      if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return { error: `${label} must be a full web address starting with http:// or https://.` };
      if (u.username || u.password) return { error: `${label} must not contain a username or password.` };
      v = u.href; // store the normalized form
      if (v.length > MAX_LINE) return { error: `${label} is too long (max ${MAX_LINE} characters).` };
    }
    fields[field] = v === "" ? null : v;
  }
  if (!Object.keys(fields).length) return { error: "Nothing to update." };

  // Cross-field: contact methods must have the details they need (after applying the patch).
  const after = (key, field, cur) => (field in fields ? fields[field] : cur);
  const c = current || {};
  const primary = after("primaryContact", "Primary Contact", c.primaryContact);
  const secondary = after("secondaryContact", "Secondary Contact", c.secondaryContact);
  const vals = {
    phone: after("phone", "Phone", c.phone),
    whatsapp: after("whatsapp", "WhatsApp", c.whatsapp),
    email: after("email", "Email", c.email),
  };
  if (primary && secondary && primary === secondary) return { error: "Secondary contact must be different from the primary contact." };
  for (const [which, method] of [["Primary", primary], ["Secondary", secondary]]) {
    if (!method) continue;
    const need = CONTACT_NEEDS[method];
    const ok = need === "whatsapp" ? !!(vals.whatsapp || vals.phone) : !!vals[need];
    if (!ok) {
      const what = need === "whatsapp" ? "a WhatsApp number or phone number" : need === "phone" ? "a phone number" : "an email address";
      return { error: `${which} contact is “${method}”, which needs ${what}. Add it under Contact or pick a different method.` };
    }
  }
  return { fields };
}

const logoPrefixFor = (env, g) => env.ASSETS_URL ? `${String(env.ASSETS_URL).replace(/\/$/, "")}/${g.slug}/logo/` : null;

async function handleUpdateAdminGemach({ db, g, env, user, request }) {
  if (!canEditGemach(user)) return json({ error: "Only an Owner or Manager can edit gemach settings." }, 403);
  const body = await readJson(request);
  const currentRec = await getGemachRecord(db, g.id);
  const current = currentRec ? gemachFromRecord(currentRec) : g;
  const { fields, error } = validateGemachPatch(body, { current, logoPrefix: logoPrefixFor(env, g) });
  if (error) return json({ error }, 400);
  if (fields["Name"] !== undefined && await gemachNameTaken(db, fields["Name"], g.id)) return json({ error: NAME_TAKEN }, 409);
  if (fields["Browse Categories"]?.length) {
    const cats = await fetchByIds(db, T.PRODUCT_CATEGORIES, fields["Browse Categories"], { fields: ["Active"] });
    const ok = new Set(cats.filter(r => r.fields?.Active).map(r => r.id));
    if (fields["Browse Categories"].some(id => !ok.has(id))) return json({ error: "Unknown browse category." }, 400);
  }
  let rec;
  try {
    rec = await db.update(T.GEMACHS, g.id, fields);
  } catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Gemach update failed:", JSON.stringify(e.detail));
    return json({ error: "Could not save settings. Please try again." }, 502);
  }
  gemachMemo.delete(g.slug);
  const updated = gemachFromRecord(rec);
  return json(await adminGemachPayload(db, updated, user)); // public caches purged by adminDispatch
}

// Logo upload: client crops/resizes to 512×512; server re-checks type (declared + magic bytes) and size.
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function sniffImageType(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

async function handleUploadLogo(c) {
  const { request, env, db, g, user } = c;
  if (!canEditGemach(user)) return json({ error: "Only an Owner or Manager can change the logo." }, 403);
  if (!(request.headers.get("Content-Type") || "").includes("multipart/form-data")) return json({ error: "Upload the logo as a file." }, 400);
  let file;
  try { file = (await request.formData()).get("logo"); } catch { return json({ error: "Could not read the upload." }, 400); }
  if (!file || typeof file === "string") return json({ error: "No logo file provided." }, 400);
  const declared = String(file.type || "").toLowerCase();
  if (!LOGO_TYPES[declared]) return json({ error: "Logo must be a PNG, JPG or WebP image." }, 400);
  if (file.size > MAX_LOGO_BYTES) return json({ error: "Logo is too large (max 2 MB after resizing)." }, 413);
  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_LOGO_BYTES) return json({ error: "Logo is too large (max 2 MB after resizing)." }, 413);
  if (sniffImageType(buf) !== declared) return json({ error: "That file doesn't look like a valid PNG, JPG or WebP image." }, 400);
  if (!env.ASSETS_BUCKET || !env.ASSETS_URL) return json({ error: "Logo storage is not configured." }, 500);

  const key = `${g.slug}/logo/${Date.now()}.${LOGO_TYPES[declared]}`;
  await env.ASSETS_BUCKET.put(key, buf, { httpMetadata: { contentType: declared, cacheControl: "public, max-age=31536000, immutable" } });
  const url = `${String(env.ASSETS_URL).replace(/\/$/, "")}/${key}`;
  let rec;
  try {
    rec = await db.update(T.GEMACHS, g.id, { "Logo URL": url });
  } catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Logo URL update failed:", JSON.stringify(e.detail));
    return json({ error: "Logo uploaded but could not be saved. Please try again." }, 502);
  }
  gemachMemo.delete(g.slug);
  return json(await adminGemachPayload(db, gemachFromRecord(rec), user));
}

export { TEMPLATE_PLACEHOLDERS, DEFAULT_TEMPLATES, effectiveTemplates, emailSignature, ADMIN_EDIT_ROLES, canEditGemach, canManageTeam, adminGemachPayload, handleGetAdminGemach, GEMACH_EDITABLE, GEMACH_LABELS, CONTACT_NEEDS, MAX_LINE, MAX_LONG, EMAIL_RE, validateGemachPatch, logoPrefixFor, handleUpdateAdminGemach, MAX_LOGO_BYTES, LOGO_TYPES, sniffImageType, handleUploadLogo };
