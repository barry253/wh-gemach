// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, fStr, linkedId } from "./airtable.js";
import { sendAlert } from "./alerts.js";
import { purgePublicCache } from "./cache.js";
import { DEFAULT_ADMIN_URL, LEGACY_SLUG, NETWORK_ADMIN_ROLE, REC_RE, SLUG_RE, T } from "./config.js";
import { buildEmailHtml, sendEmail } from "./email.js";
import { DEFAULT_THEME, GEMACH_MODES, byOrderThenName, gemachFromRecord, gemachMemo, gemachRef, isLiveNetworkAdminMemo, liveNetMemo, selName, forgetLiveAdmin } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { netListSearches } from "./search.js";
import { EMAIL_RE } from "./settings.js";
import { handleRemindersPreview } from "./reminders.js";

// ─── Network admin (role "Network Admin", re-checked live) ────────────────────

const GEMACH_CATEGORIES = ["Medical", "Clothing", "Baby", "Food", "Wedding & Events", "Other"]; // Gemachs.Category choices
const ADMIN_ROLES = ["Owner", "Manager", "Volunteer", NETWORK_ADMIN_ROLE];             // Admins.Role choices

/** Live role check: the JWT may be up to 12h old, so read the Admins row now. */
async function isLiveNetworkAdmin(db, email) {
  if (!email) return false;
  const rows = await db.listAll(T.ADMINS, {
    filter: `AND(LOWER({Email})=${fStr(String(email).toLowerCase())},{Active}=1)`, maxRecords: 1, fields: ["Role", "Active"],
  });
  return selName(rows[0]?.fields?.Role) === NETWORK_ADMIN_ROLE;
}

async function networkDispatch(c, path, method) {
  if (c.user.role !== NETWORK_ADMIN_ROLE) return json({ error: "Network admins only." }, 403);
  // The overview reads the Admins table anyway and checks the role from it (one Airtable call fewer).
  if (method === "GET" && path === "/admin/network/overview") return netOverview(c);
  // Reads use the same ~60s per-isolate memo as gemach-scoped admin calls; changes always re-check live.
  const live = method === "GET" ? await isLiveNetworkAdminMemo(c.db, c.user.email) : await isLiveNetworkAdmin(c.db, c.user.email);
  if (!live) return json({ error: "Network admins only." }, 403);
  let m;
  if (method === "GET"   && path === "/admin/network/gemachs")    return netListGemachs(c);
  if (method === "POST"  && path === "/admin/network/gemachs")    return netCreateGemach(c);
  if (method === "PATCH" && (m = path.match(/^\/admin\/network\/gemachs\/([^/]+)$/)))    return netUpdateGemach(c, m[1]);
  if (method === "GET"   && path === "/admin/network/admins")     return netListAdmins(c);
  if (method === "POST"  && path === "/admin/network/admins")     return netCreateAdmin(c);
  if (method === "PATCH" && (m = path.match(/^\/admin\/network\/admins\/([^/]+)$/)))     return netUpdateAdmin(c, m[1]);
  if (method === "GET"   && path === "/admin/network/categories") return netListCategories(c);
  if (method === "GET"   && path === "/admin/network/searches")   return netListSearches(c);
  if (method === "GET"   && path === "/admin/network/reminders")  return handleRemindersPreview(c); // dry run: sends nothing
  if (method === "POST"  && path === "/admin/network/categories") return netCreateCategory(c);
  if (method === "PATCH" && (m = path.match(/^\/admin\/network\/categories\/([^/]+)$/))) return netUpdateCategory(c, m[1]);
  return json({ error: "Not found" }, 404);
}

function purgeManyPublic(env, ctx, slugs) {
  const uniq = [...new Set(slugs.filter(s => SLUG_RE.test(s || "")))];
  if (!uniq.length) uniq.push(LEGACY_SLUG);
  for (const slug of uniq) purgePublicCache(env, ctx, slug);
  gemachMemo.clear();
}

const netStr = v => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v);

function slugify(name) {
  return String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/g, "") || "gemach";
}
function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) { const s = `${base.slice(0, 60)}-${i}`; if (!taken.has(s)) return s; }
}

const NET_GEMACH_FIELDS = ["Name", "Slug", "Active", "Coming Soon", "Mode", "Category", "Display Order", "Items", "Email", "Phone"];
const NET_ADMIN_FIELDS = ["Name", "Email", "Role", "Active", "Gemachs", "Last Active"];

async function netGemachRows(db, pre = null) {
  const [gemachs, admins] = pre ? [pre.gemachs, pre.admins] : await Promise.all([
    db.listAll(T.GEMACHS, { fields: NET_GEMACH_FIELDS }),
    db.listAll(T.ADMINS, { fields: ["Gemachs", "Active"] }),
  ]);
  const adminCount = {};
  for (const a of admins) if (a.fields.Active) for (const id of (a.fields.Gemachs || []).map(linkedId)) adminCount[id] = (adminCount[id] || 0) + 1;
  return gemachs.map(r => {
    const f = r.fields;
    const mode = selName(f.Mode);
    return {
      id: r.id, slug: f.Slug || null, name: f.Name || "", active: !!f.Active, comingSoon: !!f["Coming Soon"],
      mode: GEMACH_MODES.has(mode) ? mode : "Full", category: selName(f.Category) || null,
      displayOrder: typeof f["Display Order"] === "number" ? f["Display Order"] : null,
      itemCount: (f.Items || []).length, adminCount: adminCount[r.id] || 0, email: f.Email || null, phone: f.Phone || null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function netListGemachs({ db }) {
  return json(await netGemachRows(db));
}

/**
 * GET /admin/network/overview — everything the Network tab shows except the search log, in one request:
 * 3 Airtable reads in parallel (Gemachs, Admins, Categories) instead of ~9 across three requests.
 * The Admins read doubles as the live Network-Admin check.
 */
async function netOverview({ db, user }) {
  const [gemachs, admins, cats] = await Promise.all([
    db.listAll(T.GEMACHS, { fields: NET_GEMACH_FIELDS }),
    db.listAll(T.ADMINS, { fields: NET_ADMIN_FIELDS }),
    db.listAll(T.PRODUCT_CATEGORIES, {}),
  ]);
  const email = String(user.email || "").toLowerCase();
  const me = admins.find(r => r.fields.Active && String(r.fields.Email || "").toLowerCase() === email);
  const ok = selName(me?.fields?.Role) === NETWORK_ADMIN_ROLE;
  liveNetMemo.set(email, { ok, at: Date.now() });
  if (!ok) return json({ error: "Network admins only." }, 403);
  const idx = Object.fromEntries(gemachs.map(r => [r.id, { id: r.id, slug: r.fields.Slug || null, name: r.fields.Name || "", active: !!r.fields.Active }]));
  return json({
    gemachs: await netGemachRows(db, { gemachs, admins }),
    admins: admins.map(r => adminRow(r, idx)).sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email)),
    categories: cats.map(categoryRow).sort(byOrderThenName),
  });
}

/** True when another gemach (not selfId) already uses this name (case-insensitive, trimmed). */
async function gemachNameTaken(db, name, selfId = null) {
  const key = String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!key) return false;
  const rows = await db.listAll(T.GEMACHS, { fields: ["Name"] });
  return rows.some(r => r.id !== selfId && String(r.fields.Name || "").replace(/\s+/g, " ").trim().toLowerCase() === key);
}
const NAME_TAKEN = "Another gemach already uses that name.";

async function netCreateGemach(c) {
  const { db, env, ctx } = c;
  const body = await readJson(c.request);
  const name = netStr(body.name);
  if (typeof name !== "string" || !name) return json({ error: "Name is required." }, 400);
  if (name.length > 100) return json({ error: "Name is too long (max 100 characters)." }, 400);
  if (!GEMACH_CATEGORIES.includes(body.category)) return json({ error: `Category must be one of: ${GEMACH_CATEGORIES.join(", ")}.` }, 400);
  const mode = body.mode === undefined ? "Full" : body.mode;
  if (!GEMACH_MODES.has(mode)) return json({ error: "Mode must be Full, Directory or Info." }, 400);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (email && (!EMAIL_RE.test(email) || email.length > 200)) return json({ error: "Email doesn't look valid." }, 400);
  if (phone.length > 50) return json({ error: "Phone is too long." }, 400);

  const all = await db.listAll(T.GEMACHS, { fields: ["Name", "Slug", "Display Order", "Community"] });
  if (all.some(r => String(r.fields.Name || "").replace(/\s+/g, " ").trim().toLowerCase() === name.toLowerCase())) return json({ error: NAME_TAKEN }, 409);
  const taken = new Set(all.map(r => String(r.fields.Slug || "").toLowerCase()).filter(Boolean));
  let slug;
  if (body.slug !== undefined && body.slug !== null && String(body.slug).trim() !== "") {
    slug = String(body.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return json({ error: "Web address must use lowercase letters, numbers and hyphens." }, 400);
    if (taken.has(slug)) return json({ error: `The web address “${slug}” is already taken.` }, 409);
  } else {
    slug = uniqueSlug(slugify(name), taken);
  }
  const maxOrder = Math.max(0, ...all.map(r => Number(r.fields["Display Order"])).filter(Number.isFinite));
  const legacy = all.find(r => r.fields.Slug === LEGACY_SLUG);
  const community = (legacy?.fields?.Community || []).map(linkedId).filter(Boolean).slice(0, 1);

  const fields = {
    "Name": name, "Slug": slug, "Active": false, "Category": body.category, "Mode": mode,
    "Request Style": "Dates", "Theme Color": DEFAULT_THEME, "Display Order": maxOrder + 10,
  };
  if (community.length) fields["Community"] = community;
  if (email) fields["Email"] = email;
  if (phone) fields["Phone"] = phone;
  if (phone) fields["Primary Contact"] = "Call";
  else if (email) fields["Primary Contact"] = "Email";

  let rec;
  try { rec = await db.create(T.GEMACHS, fields); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Create gemach failed:", JSON.stringify(e.detail));
    return json({ error: "Could not create the gemach. Please try again." }, 502);
  }
  purgeManyPublic(env, ctx, [slug]);
  const g = gemachFromRecord(rec);
  return json({ ...gemachRef(g), mode: g.mode, category: selName(rec.fields.Category) || null, displayOrder: fields["Display Order"],
    itemCount: 0, adminCount: 0, email: g.email }, 201);
}

async function netUpdateGemach(c, id) {
  const { db, env, ctx } = c;
  if (!REC_RE.test(id)) return json({ error: "Not found" }, 404);
  const rec = await db.get(T.GEMACHS, id);
  if (!rec) return json({ error: "Not found" }, 404);
  const body = await readJson(c.request);
  const f = {};
  if (body.name !== undefined) {
    const name = netStr(body.name);
    if (typeof name !== "string" || !name) return json({ error: "Name is required." }, 400);
    if (name.length > 100) return json({ error: "Name is too long (max 100 characters)." }, 400);
    if (await gemachNameTaken(db, name, id)) return json({ error: NAME_TAKEN }, 409);
    f["Name"] = name;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return json({ error: "Active must be true or false." }, 400);
    f["Active"] = body.active;
  }
  if (body.comingSoon !== undefined) { // with Active on: listed as "Coming soon"
    if (typeof body.comingSoon !== "boolean") return json({ error: "Coming soon must be true or false." }, 400);
    f["Coming Soon"] = body.comingSoon;
  }
  if (body.mode !== undefined) {
    if (!GEMACH_MODES.has(body.mode)) return json({ error: "Mode must be Full, Directory or Info." }, 400);
    f["Mode"] = body.mode;
  }
  if (body.category !== undefined) {
    if (!GEMACH_CATEGORIES.includes(body.category)) return json({ error: `Category must be one of: ${GEMACH_CATEGORIES.join(", ")}.` }, 400);
    f["Category"] = body.category;
  }
  if (body.displayOrder !== undefined) {
    if (body.displayOrder === null || body.displayOrder === "") f["Display Order"] = null;
    else if (!Number.isFinite(Number(body.displayOrder)) || Math.abs(Number(body.displayOrder)) > 1e6) return json({ error: "Display order must be a number." }, 400);
    else f["Display Order"] = Number(body.displayOrder);
  }
  // Contact email/phone can be changed here; clearing them is left to the gemach's own Settings, which
  // checks they aren't the gemach's contact method.
  for (const [key, field, label] of [["email", "Email", "Email"], ["phone", "Phone", "Phone"]]) {
    if (body[key] === undefined) continue;
    const v = typeof body[key] === "string" ? body[key].trim() : null;
    if (v === null) return json({ error: `${label} must be text.` }, 400);
    if (v === (rec.fields[field] || "")) continue;
    if (!v) return json({ error: `To remove the ${label.toLowerCase()}, open the gemach and change it in Settings.` }, 400);
    if (key === "email" && (!EMAIL_RE.test(v) || v.length > 200)) return json({ error: "Enter a valid email address." }, 400);
    if (key === "phone" && v.length > 50) return json({ error: "Phone is too long." }, 400);
    f[field] = v;
  }
  const oldSlug = rec.fields.Slug || null;
  if (body.slug !== undefined && String(body.slug).trim().toLowerCase() !== oldSlug) {
    const slug = String(body.slug || "").trim().toLowerCase();
    if (rec.fields.Active) return json({ error: "The web address can only be changed while the gemach is hidden (inactive)." }, 400);
    if (!SLUG_RE.test(slug)) return json({ error: "Web address must use lowercase letters, numbers and hyphens." }, 400);
    const clash = await db.listAll(T.GEMACHS, { filter: `LOWER({Slug})=${fStr(slug)}`, fields: ["Slug"], maxRecords: 2 });
    if (clash.some(r => r.id !== id)) return json({ error: `The web address “${slug}” is already taken.` }, 409);
    f["Slug"] = slug;
  }
  if (!Object.keys(f).length) return json((await netGemachRows(db)).find(r => r.id === id) || { id }); // nothing changed
  try { await db.update(T.GEMACHS, id, f); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Update gemach failed:", JSON.stringify(e.detail));
    return json({ error: "Could not save. Please try again." }, 502);
  }
  purgeManyPublic(env, ctx, [oldSlug, f["Slug"]]);
  const row = (await netGemachRows(db)).find(r => r.id === id);
  return json(row || { id });
}

// Admins
function adminRow(r, gemachById) {
  const f = r.fields;
  return {
    id: r.id, name: f.Name || "", email: f.Email || "", role: selName(f.Role) || null, active: !!f.Active, lastActive: f["Last Active"] || null,
    gemachs: (f.Gemachs || []).map(linkedId).map(id => gemachById[id]).filter(Boolean).map(g => ({ id: g.id, slug: g.slug, name: g.name })),
  };
}

async function gemachIndex(db) {
  const recs = await db.listAll(T.GEMACHS, { fields: ["Name", "Slug", "Active"] });
  return Object.fromEntries(recs.map(r => [r.id, { id: r.id, slug: r.fields.Slug || null, name: r.fields.Name || "", active: !!r.fields.Active }]));
}

async function netListAdmins({ db }) {
  const [admins, idx] = await Promise.all([db.listAll(T.ADMINS, { fields: NET_ADMIN_FIELDS }), gemachIndex(db)]);
  return json(admins.map(r => adminRow(r, idx)).sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email)));
}

function validateAdminInput(body, idx, { partial }) {
  const f = {};
  if (!partial || body.name !== undefined) {
    const name = netStr(body.name);
    if (typeof name !== "string" || !name) return { error: "Name is required." };
    if (name.length > 100) return { error: "Name is too long (max 100 characters)." };
    f["Name"] = name;
  }
  if (!partial || body.role !== undefined) {
    if (!ADMIN_ROLES.includes(body.role)) return { error: `Role must be one of: ${ADMIN_ROLES.join(", ")}.` };
    f["Role"] = body.role;
  }
  if (!partial || body.gemachIds !== undefined) {
    const ids = body.gemachIds ?? [];
    if (!Array.isArray(ids) || ids.length > 100) return { error: "gemachIds must be a list." };
    const uniq = [...new Set(ids)];
    if (uniq.some(id => typeof id !== "string" || !idx[id])) return { error: "One or more gemachs don't exist." };
    f["Gemachs"] = uniq;
  }
  if (partial && body.active !== undefined) {
    if (typeof body.active !== "boolean") return { error: "Active must be true or false." };
    f["Active"] = body.active;
  }
  return { fields: f };
}

async function netCreateAdmin(c) {
  const { db, env } = c;
  const body = await readJson(c.request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email) || email.length > 200) return json({ error: "A valid email address is required." }, 400);
  const idx = await gemachIndex(db);
  const { fields, error } = validateAdminInput(body, idx, { partial: false });
  if (error) return json({ error }, 400);
  if (fields.Role !== NETWORK_ADMIN_ROLE && !fields.Gemachs.length) return json({ error: "Choose at least one gemach for this admin." }, 400);
  const dup = await db.listAll(T.ADMINS, { filter: `LOWER({Email})=${fStr(email)}`, fields: ["Email"], maxRecords: 1 });
  if (dup.length) return json({ error: "An admin with this email already exists." }, 409);

  let rec;
  try { rec = await db.create(T.ADMINS, { ...fields, "Email": email, "Active": true }); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Create admin failed:", JSON.stringify(e.detail));
    return json({ error: "Could not add the admin. Please try again." }, 502);
  }
  const invited = body.sendInvite
    ? await sendAdminInvite(env, { name: fields.Name, email, role: fields.Role, gemachs: fields.Gemachs.map(id => idx[id]).filter(Boolean) })
    : false;
  return json({ ...adminRow(rec, idx), invited }, 201);
}

/**
 * "You've been added as an admin" email. gemachs: [{id, name}] the person can now manage.
 * Returns true when sent; on failure alerts the network admins and returns false.
 */
async function sendAdminInvite(env, { name, email, role, gemachs, by }) {
  const names = gemachs.map(g => g.name).filter(Boolean);
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const what = list || "the gemach network";
  const signIn = env.ADMIN_URL || DEFAULT_ADMIN_URL;
  const roleLine = role === NETWORK_ADMIN_ROLE ? "\n\nYou have network admin access to all gemachs."
    : role ? `\n\nYour role: ${role}${ROLE_BLURB[role] ? ` (${ROLE_BLURB[role]})` : ""}.` : "";
  const text = `Hi ${name},\n\n${by ? `${by} added you` : "You've been added"} as an admin of ${what} on whgemachs.org. Sign in with this Google account at ${signIn}` +
    roleLine + `\n\nThank you!`;
  const from = gemachs.length === 1 ? gemachFromRecord({ id: gemachs[0].id, fields: { Name: gemachs[0].name } }) : { name: "whgemachs.org", themeColor: DEFAULT_THEME };
  const ok = (await sendEmail(env, from, {
    to: email,
    subject: `You've been added as an admin on whgemachs.org`,
    text,
    html: buildEmailHtml(from, text, { signature: false }),
  })) === true;
  if (!ok) await sendAlert(env, { key: "invite", subject: "Admin invite email failed", text: `The "you've been added as an admin" email to ${email} didn't send. The admin was still added; let them know to sign in at ${signIn}.` });
  return ok;
}
const ROLE_BLURB = {
  Owner: "you can change settings and manage the team",
  Manager: "you can handle requests, loans and items, and change settings",
  Volunteer: "you can handle requests, loans and items",
};

async function netUpdateAdmin(c, id) {
  const { db, user } = c;
  if (!REC_RE.test(id)) return json({ error: "Not found" }, 404);
  const rec = await db.get(T.ADMINS, id);
  if (!rec) return json({ error: "Not found" }, 404);
  const body = await readJson(c.request);
  const idx = await gemachIndex(db);
  const { fields, error } = validateAdminInput(body, idx, { partial: true });
  if (error) return json({ error }, 400);
  if (!Object.keys(fields).length) return json({ error: "Nothing to update." }, 400);
  const isSelf = String(rec.fields.Email || "").toLowerCase() === String(user.email || "").toLowerCase();
  if (isSelf && (fields.Active === false || (fields.Role && fields.Role !== NETWORK_ADMIN_ROLE))) {
    return json({ error: "You can't deactivate or demote yourself. Ask another network admin." }, 400);
  }
  const role = fields.Role || selName(rec.fields.Role);
  const gemachs = fields.Gemachs || (rec.fields.Gemachs || []).map(linkedId);
  if (role !== NETWORK_ADMIN_ROLE && !gemachs.length) return json({ error: "Choose at least one gemach for this admin." }, 400);
  let updated;
  try { updated = await db.update(T.ADMINS, id, fields); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Update admin failed:", JSON.stringify(e.detail));
    return json({ error: "Could not save. Please try again." }, 502);
  }
  liveNetMemo.clear(); // role/active may have changed
  forgetLiveAdmin(rec.fields.Email);
  return json(adminRow(updated, idx));
}

// Product categories
function categoryRow(r) {
  const f = r.fields;
  const order = Number(f["Display Order"]);
  return {
    id: r.id, name: f.Name || "", icon: f.Icon || "",
    keywords: String(f.Keywords || "").split(/[,\n]/).map(k => k.trim()).filter(Boolean),
    displayOrder: f["Display Order"] != null && Number.isFinite(order) ? order : null,
    active: !!f.Active, itemTypeCount: (f["Item Types"] || []).length,
  };
}

async function netListCategories({ db }) {
  const recs = await db.listAll(T.PRODUCT_CATEGORIES, {});
  return json(recs.map(categoryRow).sort(byOrderThenName));
}

async function validateCategoryInput(db, body, { partial, selfId = null }) {
  const f = {};
  if (!partial || body.name !== undefined) {
    const name = netStr(body.name);
    if (typeof name !== "string" || !name) return { error: "Name is required." };
    if (name.length > 60) return { error: "Name is too long (max 60 characters)." };
    const same = await db.listAll(T.PRODUCT_CATEGORIES, { filter: `LOWER({Name})=${fStr(name.toLowerCase())}`, fields: ["Name"], maxRecords: 2 });
    if (same.some(r => r.id !== selfId)) return { error: `A category named “${name}” already exists.`, status: 409 };
    f["Name"] = name;
  }
  if (body.icon !== undefined) {
    const icon = typeof body.icon === "string" ? body.icon.trim() : null;
    if (icon === null || [...icon].length > 8) return { error: "Icon must be a single emoji." };
    f["Icon"] = icon || null;
  }
  if (body.keywords !== undefined) {
    const list = Array.isArray(body.keywords) ? body.keywords : typeof body.keywords === "string" ? body.keywords.split(/[,\n]/) : null;
    if (!list || list.some(k => typeof k !== "string")) return { error: "Keywords must be text." };
    const kw = [...new Set(list.map(k => k.trim()).filter(Boolean))].join(", ");
    if (kw.length > 1000) return { error: "Keywords are too long (max 1000 characters)." };
    f["Keywords"] = kw || null;
  }
  if (body.displayOrder !== undefined) {
    if (body.displayOrder === null || body.displayOrder === "") f["Display Order"] = null;
    else if (!Number.isFinite(Number(body.displayOrder))) return { error: "Display order must be a number." };
    else f["Display Order"] = Number(body.displayOrder);
  }
  if (partial && body.active !== undefined) {
    if (typeof body.active !== "boolean") return { error: "Active must be true or false." };
    f["Active"] = body.active;
  }
  return { fields: f };
}

async function allSlugs(db) {
  const recs = await db.listAll(T.GEMACHS, { fields: ["Slug"] });
  return recs.map(r => r.fields.Slug).filter(Boolean);
}

async function netCreateCategory(c) {
  const { db, env, ctx } = c;
  const body = await readJson(c.request);
  const { fields, error, status } = await validateCategoryInput(db, body, { partial: false });
  if (error) return json({ error }, status || 400);
  let rec;
  try { rec = await db.create(T.PRODUCT_CATEGORIES, { ...fields, "Active": body.active === false ? false : true }); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    return json({ error: "Could not create the category." }, 502);
  }
  purgeManyPublic(env, ctx, await allSlugs(db));
  return json(categoryRow(rec), 201);
}

async function netUpdateCategory(c, id) {
  const { db, env, ctx } = c;
  if (!REC_RE.test(id)) return json({ error: "Not found" }, 404);
  if (!(await db.get(T.PRODUCT_CATEGORIES, id))) return json({ error: "Not found" }, 404);
  const body = await readJson(c.request);
  const { fields, error, status } = await validateCategoryInput(db, body, { partial: true, selfId: id });
  if (error) return json({ error }, status || 400);
  if (!Object.keys(fields).length) return json({ error: "Nothing to update." }, 400);
  let rec;
  try { rec = await db.update(T.PRODUCT_CATEGORIES, id, fields); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    return json({ error: "Could not save the category." }, 502);
  }
  purgeManyPublic(env, ctx, await allSlugs(db));
  return json(categoryRow(rec));
}

export { GEMACH_CATEGORIES, ADMIN_ROLES, isLiveNetworkAdmin, networkDispatch, netOverview, purgeManyPublic, netStr, slugify, uniqueSlug, netGemachRows, netListGemachs, gemachNameTaken, NAME_TAKEN, netCreateGemach, netUpdateGemach, adminRow, gemachIndex, netListAdmins, validateAdminInput, netCreateAdmin, netUpdateAdmin, sendAdminInvite, NET_ADMIN_FIELDS, categoryRow, netListCategories, validateCategoryInput, allSlugs, netCreateCategory, netUpdateCategory };
