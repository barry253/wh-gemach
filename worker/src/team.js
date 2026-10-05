// Part of the Gemach Network worker (see index.js for routes and env vars).
import { AirtableError, fStr, linkedId } from "./airtable.js";
import { NETWORK_ADMIN_ROLE, REC_RE, T } from "./config.js";
import { fetchLiveAdmin, forgetLiveAdmin, liveNetMemo, selName } from "./gemachs.js";
import { json, readJson } from "./http.js";
import { NET_ADMIN_FIELDS, gemachIndex, isLiveNetworkAdmin, netStr, sendAdminInvite } from "./network.js";
import { EMAIL_RE, canManageTeam } from "./settings.js";

// ─── Team: a gemach's Owners, Managers and Volunteers, managed by its Owners ──
// An admin is one Admins row: one Role (applies in every gemach they belong to) and links to their gemachs.
// Owners (and Network Admins) of a gemach can add people to it, change their name or role, resend the
// invite email and take them off the team. Network Admins aren't listed here (they reach every gemach).
// Rules that come from the role being shared across gemachs:
//   • someone already on another gemach's team keeps their role; it can only be changed by a network admin;
//   • taking someone off the team only unlinks this gemach; with no gemachs left they're turned off.
// Changes re-check the acting admin live in Airtable (the session token can be hours old).

const TEAM_ROLES = ["Owner", "Manager", "Volunteer"];
const lc = s => String(s || "").trim().toLowerCase();

function memberRow(r, g, idx, me) {
  const f = r.fields;
  const others = (f.Gemachs || []).map(linkedId).filter(id => id !== g.id).map(id => idx?.[id]?.name).filter(Boolean);
  return {
    id: r.id, name: f.Name || "", email: f.Email || "", role: selName(f.Role) || null,
    you: lc(f.Email) === lc(me), otherGemachs: others,
  };
}
const byRoleThenName = (a, b) => TEAM_ROLES.indexOf(a.role) - TEAM_ROLES.indexOf(b.role) || a.name.localeCompare(b.name) || a.email.localeCompare(b.email);

/** Live check for changes: the acting admin is an active Network Admin, or an active Owner of this gemach. */
async function actorCanManage(c) {
  if (c.user.role === NETWORK_ADMIN_ROLE) return isLiveNetworkAdmin(c.db, c.user.email);
  const me = await fetchLiveAdmin(c.db, lc(c.user.email));
  return !!me && me.active && me.role === "Owner" && me.gemachIds.includes(c.g.id);
}

async function teamDispatch(c, path, method) {
  if (!canManageTeam(c.user)) return json({ error: "Only the gemach's owners can manage the team." }, 403);
  let m;
  if (method === "GET" && path === "/admin/team") return listTeam(c);
  if (!(await actorCanManage(c))) return json({ error: "Only the gemach's owners can manage the team." }, 403);
  if (method === "POST" && path === "/admin/team") return addMember(c);
  if (method === "PATCH"  && (m = path.match(/^\/admin\/team\/([^/]+)$/)))        return updateMember(c, m[1]);
  if (method === "DELETE" && (m = path.match(/^\/admin\/team\/([^/]+)$/)))        return removeMember(c, m[1]);
  if (method === "POST"   && (m = path.match(/^\/admin\/team\/([^/]+)\/invite$/))) return resendInvite(c, m[1]);
  return json({ error: "Not found" }, 404);
}

const onTeam = (r, g) => !!r?.fields?.Active && (r.fields.Gemachs || []).map(linkedId).includes(g.id) && selName(r.fields.Role) !== NETWORK_ADMIN_ROLE;

/** GET /admin/team → { members: [...] } (Owners first, then Managers, Volunteers). */
async function listTeam({ db, g, user }) {
  const [admins, idx] = await Promise.all([db.listAll(T.ADMINS, { fields: NET_ADMIN_FIELDS }), gemachIndex(db)]);
  const members = admins.filter(r => onTeam(r, g)).map(r => memberRow(r, g, idx, user.email)).sort(byRoleThenName);
  return json({ members, roles: TEAM_ROLES });
}

async function loadMember(c, id) {
  if (!REC_RE.test(id)) return null;
  const rec = await c.db.get(T.ADMINS, id);
  return onTeam(rec, c.g) ? rec : null;
}

function readName(body) {
  const name = netStr(body.name);
  if (typeof name !== "string" || !name) return { error: "Name is required." };
  if (name.length > 100) return { error: "Name is too long (max 100 characters)." };
  return { name };
}
const roleError = `Role must be one of: ${TEAM_ROLES.join(", ")}.`;

async function saveAdmin(db, id, fields) {
  try { return id ? await db.update(T.ADMINS, id, fields) : await db.create(T.ADMINS, fields); }
  catch (e) {
    if (!(e instanceof AirtableError)) throw e;
    console.error("Team change failed:", JSON.stringify(e.detail));
    return null;
  }
}
const changed = email => { forgetLiveAdmin(email); liveNetMemo.delete(lc(email)); };

/** POST /admin/team {name, email, role, sendInvite} — adds a new person, or links someone who already has an admin account. */
async function addMember(c) {
  const { db, env, g } = c;
  const body = await readJson(c.request);
  const email = lc(typeof body.email === "string" ? body.email : "");
  if (!email || !EMAIL_RE.test(email) || email.length > 200) return json({ error: "A valid email address is required." }, 400);
  const { name, error } = readName(body);
  if (error) return json({ error }, 400);
  if (!TEAM_ROLES.includes(body.role)) return json({ error: roleError }, 400);
  const role = body.role;

  const [existing] = await db.listAll(T.ADMINS, { filter: `LOWER({Email})=${fStr(email)}`, fields: NET_ADMIN_FIELDS, maxRecords: 1 });
  let rec;
  if (existing) {
    const f = existing.fields;
    const curRole = selName(f.Role);
    const links = (f.Gemachs || []).map(linkedId);
    const others = links.filter(id => id !== g.id);
    if (curRole === NETWORK_ADMIN_ROLE) return json({ error: "This person is a network admin and can already manage every gemach." }, 409);
    if (f.Active && links.includes(g.id)) return json({ error: "This person is already on your team." }, 409);
    // Turned off but still linked somewhere = turned off by a network admin (taking someone off their last team clears the links).
    if (!f.Active && links.length) return json({ error: "This person's admin account is turned off. Ask the network admin to turn it back on." }, 409);
    if (f.Active && others.length && curRole !== role) {
      const idx = await gemachIndex(db);
      const where = others.map(id => idx[id]?.name).filter(Boolean).join(", ") || "another gemach";
      return json({
        error: `This person is already a ${curRole || "member"} at ${where}, and a person has one role in all their gemachs. Add them as ${curRole || "that role"}, or ask the network admin to change their role.`,
        role: curRole,
      }, 409);
    }
    const fields = { Gemachs: [...new Set([...links, g.id])], Active: true };
    if (!others.length || !f.Active) fields.Role = role;
    if (!f.Name || !f.Active) fields.Name = name;
    rec = await saveAdmin(db, existing.id, fields);
  } else {
    rec = await saveAdmin(db, null, { Name: name, Email: email, Role: role, Gemachs: [g.id], Active: true });
  }
  if (!rec) return json({ error: "Could not add this person. Please try again." }, 502);
  changed(email);
  const invited = body.sendInvite
    ? await sendAdminInvite(env, { name: rec.fields.Name || name, email, role: selName(rec.fields.Role), gemachs: [{ id: g.id, name: g.name }], by: c.user.name || null })
    : false;
  const idx = await gemachIndex(db);
  return json({ ...memberRow(rec, g, idx, c.user.email), invited, linked: !!existing }, 201);
}

/** PATCH /admin/team/:id {name?, role?} */
async function updateMember(c, id) {
  const { db, g, user } = c;
  const rec = await loadMember(c, id);
  if (!rec) return json({ error: "Not found" }, 404);
  const body = await readJson(c.request);
  const fields = {};
  if (body.name !== undefined) {
    const { name, error } = readName(body);
    if (error) return json({ error }, 400);
    fields.Name = name;
  }
  const curRole = selName(rec.fields.Role);
  if (body.role !== undefined && body.role !== curRole) {
    if (!TEAM_ROLES.includes(body.role)) return json({ error: roleError }, 400);
    if (lc(rec.fields.Email) === lc(user.email)) return json({ error: "You can't change your own role. Ask another owner." }, 400);
    if ((rec.fields.Gemachs || []).map(linkedId).some(x => x !== g.id)) {
      return json({ error: "This person is also on another gemach's team, and their role applies there too. Ask the network admin to change it." }, 409);
    }
    fields.Role = body.role;
  }
  if (!Object.keys(fields).length) {
    const idx = await gemachIndex(db);
    return json(memberRow(rec, g, idx, user.email));
  }
  const updated = await saveAdmin(db, id, fields);
  if (!updated) return json({ error: "Could not save. Please try again." }, 502);
  changed(rec.fields.Email);
  const idx = await gemachIndex(db);
  return json(memberRow(updated, g, idx, user.email));
}

/** DELETE /admin/team/:id — takes the person off this gemach's team (turns the account off if it was their only gemach). */
async function removeMember(c, id) {
  const { db, g, user } = c;
  const rec = await loadMember(c, id);
  if (!rec) return json({ error: "Not found" }, 404);
  if (lc(rec.fields.Email) === lc(user.email)) return json({ error: "You can't remove yourself. Ask another owner." }, 400);
  const left = (rec.fields.Gemachs || []).map(linkedId).filter(x => x !== g.id);
  const updated = await saveAdmin(db, id, left.length ? { Gemachs: left } : { Gemachs: [], Active: false });
  if (!updated) return json({ error: "Could not remove. Please try again." }, 502);
  changed(rec.fields.Email);
  return json({ ok: true, id, deactivated: !left.length });
}

/** POST /admin/team/:id/invite — sends the "you've been added" email again. */
async function resendInvite(c, id) {
  const rec = await loadMember(c, id);
  if (!rec) return json({ error: "Not found" }, 404);
  const f = rec.fields;
  const ok = await sendAdminInvite(c.env, { name: f.Name || f.Email, email: lc(f.Email), role: selName(f.Role), gemachs: [{ id: c.g.id, name: c.g.name }], by: c.user.name || null });
  return ok ? json({ ok: true }) : json({ error: "The email couldn't be sent. Please try again later." }, 422);
}

export { TEAM_ROLES, teamDispatch, listTeam, addMember, updateMember, removeMember, resendInvite };
