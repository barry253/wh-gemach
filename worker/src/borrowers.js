// Part of the Gemach Network worker (see index.js for routes and env vars).
import { Q, getOwned, linkedId } from "./airtable.js";
import { T } from "./config.js";
import { json } from "./http.js";

// ─── Borrowers ────────────────────────────────────────────────────────────────

const CONTACT_MAP = { "SMS": "Text", "Text": "Text", "WhatsApp": "WhatsApp", "Phone": "Phone", "Call": "Phone", "Facebook": "Facebook", "Email": "Email" };

/** "  Mindy  Scheer." → "mindy scheer" (case, punctuation and extra spaces ignored). */
function normPersonName(n) {
  return String(n || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function findOrCreateBorrower(db, g, { name, phone, email, preferredContact }) {
  const digits = String(phone || "").replace(/\D/g, "");
  const emailNorm = String(email || "").trim().toLowerCase();
  const conds = [];
  if (digits.length >= 10) {
    conds.push(Q.phoneDigits("Phone", digits.slice(-10), { last10: true }));
  } else if (digits.length) {
    conds.push(Q.phoneDigits("Phone", digits));
  }
  if (emailNorm) conds.push(Q.ieq("Email", emailNorm, { trim: true }));
  if (conds.length) {
    // Reuse an existing borrower only when the contact detail AND the name match: families often
    // share a phone or email, and a request from one person must not be filed under another's name.
    const found = await db.listPage(T.BORROWERS, {
      scope: g, where: [conds.length > 1 ? Q.or(...conds) : conds[0]],
      maxRecords: 20,
      fields: ["Name"],
    });
    const want = normPersonName(name);
    const same = want && found.records.find(r => normPersonName(r.fields["Name"]) === want);
    if (same) return same.id;
  }
  const fields = { "Name": name, "Gemach": [g.id] };
  if (phone) fields["Phone"] = phone;
  if (email) fields["Email"] = email;
  const mapped = preferredContact ? CONTACT_MAP[preferredContact] : null;
  if (mapped) fields["Preferred Contact"] = mapped;
  try {
    const data = await db.create(T.BORROWERS, fields);
    return data.id;
  } catch (e) {
    console.error("Borrower create failed:", JSON.stringify(e.detail || e.message));
    throw new Error(`Failed to create borrower: ${e.message}`);
  }
}

/**
 * The borrower an admin picked from the lookup (id), with any contact details they changed saved to
 * that record — or, without a usable id, the usual find-or-create match. Blank fields never clear a
 * stored value (the sheet only needs a phone or an email).
 */
async function useOrFindBorrower(db, g, { id = null, name, phone, email, preferredContact }) {
  const rec = typeof id === "string" && id ? await getOwned(db, T.BORROWERS, id, g) : null;
  if (!rec) return findOrCreateBorrower(db, g, { name, phone, email, preferredContact });
  const f = rec.fields, patch = {};
  const put = (field, v) => { if (v && String(v) !== String(f[field] || "")) patch[field] = v; };
  put("Name", name); put("Phone", phone); put("Email", email);
  put("Preferred Contact", preferredContact ? CONTACT_MAP[preferredContact] : null);
  if (Object.keys(patch).length) await db.update(T.BORROWERS, rec.id, patch);
  return rec.id;
}

// ─── Lookup for the admin sheets (New reservation / appointment / loan) ─────────
// GET /admin/borrowers → { borrowers: [{ id, name, phone, email, preferredContact, loans, lastAt, out, dueBack }] }
// This gemach's borrowers only, most recently active first. Two reads (borrowers + their loans); the
// sheet searches the list on the device as the admin types.
const COUNTED = new Set(["Reserved", "Active", "Returned"]);

async function handleListBorrowers({ db, g }) {
  const [people, loans] = await Promise.all([
    db.listAll(T.BORROWERS, { scope: g, fields: ["Name", "Phone", "Email", "Preferred Contact"] }),
    db.listAll(T.LOANS, { scope: g, where: [Q.notBlank("Borrower")],
      fields: ["Borrower", "Status", "Date Borrowed", "Reservation Start", "Expected Return"] }),
  ]);
  const stats = new Map();
  for (const l of loans) {
    const f = l.fields, st = typeof f.Status === "string" ? f.Status : f.Status?.name;
    if (!COUNTED.has(st)) continue;
    const id = linkedId((f.Borrower || [])[0]);
    if (!id) continue;
    const s = stats.get(id) || stats.set(id, { loans: 0, lastAt: null, out: 0, dueBack: null }).get(id);
    s.loans++;
    const at = f["Date Borrowed"] || f["Reservation Start"] || null;
    if (at && (!s.lastAt || at > s.lastAt)) s.lastAt = at;
    if (st === "Active") {
      s.out++;
      const due = f["Expected Return"] || null;
      if (due && (!s.dueBack || due < s.dueBack)) s.dueBack = due;
    }
  }
  const list = people.filter(r => String(r.fields.Name || "").trim()).map(r => {
    const f = r.fields, s = stats.get(r.id) || { loans: 0, lastAt: null, out: 0, dueBack: null };
    const pref = typeof f["Preferred Contact"] === "string" ? f["Preferred Contact"] : f["Preferred Contact"]?.name;
    return { id: r.id, name: String(f.Name).trim(), phone: f.Phone || null, email: f.Email || null, preferredContact: pref || null, ...s };
  }).sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")) || a.name.localeCompare(b.name));
  return json({ borrowers: list });
}

export { CONTACT_MAP, normPersonName, findOrCreateBorrower, useOrFindBorrower, handleListBorrowers };
