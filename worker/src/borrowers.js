// Part of the Gemach Network worker (see index.js for routes and env vars).
import { fAnd, fStr, scopeF } from "./airtable.js";
import { T } from "./config.js";

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
    conds.push(`RIGHT(REGEX_REPLACE({Phone}&"","[^0-9]",""),10)=${fStr(digits.slice(-10))}`);
  } else if (digits.length) {
    conds.push(`REGEX_REPLACE({Phone}&"","[^0-9]","")=${fStr(digits)}`);
  }
  if (emailNorm) conds.push(`LOWER(TRIM({Email}&""))=${fStr(emailNorm)}`);
  if (conds.length) {
    // Reuse an existing borrower only when the contact detail AND the name match: families often
    // share a phone or email, and a request from one person must not be filed under another's name.
    const found = await db.listPage(T.BORROWERS, {
      filter: fAnd(scopeF(g), conds.length > 1 ? `OR(${conds.join(",")})` : conds[0]),
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

export { CONTACT_MAP, normPersonName, findOrCreateBorrower };
