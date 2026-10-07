// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Structured queries ────────────────────────────────────────────────────────
// Every list query describes WHAT it wants with these conditions instead of a hand-written
// Airtable formula, so the same query can run against Airtable (compiled to a formula below)
// or against D1 (compiled to SQL in the D1 data layer).
//
//   db.listAll(T.LOANS, { scope: g, where: [Q.in("Status", ["Active", "Reserved"])], sort, fields })
//
// `scope: g` limits the query to gemach g (omit for network-wide tables). `where` is a list of
// conditions that must all hold. Values are plain JS values; nothing here is ever pasted into a
// query unescaped.

const Q = {
  /** field equals value (text, select or number). */
  eq: (field, value) => ({ op: "eq", field, value }),
  /** field does not equal value. */
  ne: (field, value) => ({ op: "ne", field, value }),
  /** field equals one of the values. */
  in: (field, values) => ({ op: "in", field, values: [...values] }),
  /** checkbox is ticked. */
  isTrue: field => ({ op: "true", field }),
  /** text field is not empty. */
  nonEmpty: field => ({ op: "nonEmpty", field }),
  /** date / date-time field has a value. */
  notBlank: field => ({ op: "notBlank", field }),
  /** case-insensitive equality (value is lowercased here); trim: also ignore surrounding spaces. */
  ieq: (field, value, { trim = false } = {}) => ({ op: "ieq", field, value: String(value ?? "").toLowerCase(), trim }),
  /** date-time field strictly after the ISO timestamp. */
  after: (field, iso) => ({ op: "after", field, value: String(iso) }),
  /** date-time field strictly before the ISO timestamp. */
  before: (field, iso) => ({ op: "before", field, value: String(iso) }),
  /** date-time field at or after the ISO timestamp. */
  notBefore: (field, iso) => ({ op: "notBefore", field, value: String(iso) }),
  /** record id is one of ids. */
  idIn: ids => ({ op: "idIn", ids: [...ids] }),
  /**
   * Link field points at record `id`. Airtable formulas can only see the linked record's name, so
   * `name` (its primary field) is passed too and Airtable gets a name match — callers keep a
   * post-filter on the real id. D1 matches the id exactly.
   */
  linksTo: (field, id, name) => ({ op: "linksTo", field, id, name: String(name ?? "") }),
  /** Digits of a phone field equal `digits`; last10: compare only the last 10 digits. */
  phoneDigits: (field, digits, { last10 = false } = {}) => ({ op: "phone", field, value: String(digits), last10 }),
  /** Any one of the conditions holds. */
  or: (...conds) => ({ op: "or", conds: conds.filter(Boolean) }),
};

// ─── Airtable compilation ──────────────────────────────────────────────────────

const fStr = s => `"${String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ")}"`;
const fVal = v => (typeof v === "number" && Number.isFinite(v) ? String(v) : fStr(v));
const fAnd = (...parts) => {
  const p = parts.filter(Boolean);
  return p.length === 0 ? undefined : p.length === 1 ? p[0] : `AND(${p.join(",")})`;
};
const fld = name => {
  if (typeof name !== "string" || !name || /[{}]/.test(name)) throw new Error(`bad field name: ${name}`);
  return `{${name}}`;
};
const scopeF = g => `ARRAYJOIN({Gemach Slug})=${fStr(g.slug)}`;
const idsF = ids => `OR(${ids.map(id => `RECORD_ID()=${fStr(id)}`).join(",")})`;

function condToFormula(c) {
  switch (c.op) {
    case "eq": return `${fld(c.field)}=${fVal(c.value)}`;
    case "ne": return `${fld(c.field)}!=${fVal(c.value)}`;
    case "in":
      if (!c.values.length) return "FALSE()";
      return c.values.length === 1 ? `${fld(c.field)}=${fVal(c.values[0])}` : `OR(${c.values.map(v => `${fld(c.field)}=${fVal(v)}`).join(",")})`;
    case "true": return `${fld(c.field)}=1`;
    case "nonEmpty": return `${fld(c.field)}!=""`;
    case "notBlank": return `NOT(${fld(c.field)}=BLANK())`;
    case "ieq": return c.trim ? `LOWER(TRIM(${fld(c.field)}&""))=${fStr(c.value)}` : `LOWER(${fld(c.field)})=${fStr(c.value)}`;
    case "after": return `IS_AFTER(${fld(c.field)},${fStr(c.value)})`;
    case "before": return `IS_BEFORE(${fld(c.field)},${fStr(c.value)})`;
    case "notBefore": return `NOT(IS_BEFORE(${fld(c.field)},${fStr(c.value)}))`;
    case "idIn": return c.ids.length ? idsF(c.ids) : "FALSE()";
    case "linksTo": return `FIND(${fStr(c.name)},ARRAYJOIN(${fld(c.field)}))`;
    case "phone": return c.last10
      ? `RIGHT(REGEX_REPLACE(${fld(c.field)}&"","[^0-9]",""),10)=${fStr(c.value)}`
      : `REGEX_REPLACE(${fld(c.field)}&"","[^0-9]","")=${fStr(c.value)}`;
    case "or": {
      const parts = c.conds.map(condToFormula);
      return parts.length === 0 ? "FALSE()" : parts.length === 1 ? parts[0] : `OR(${parts.join(",")})`;
    }
    default: throw new Error(`unknown query condition: ${c?.op}`);
  }
}

/** Airtable filterByFormula for { scope, where } (undefined = no filter). */
function toFormula({ scope = null, where = [] } = {}) {
  return fAnd(scope && scopeF(scope), ...(where || []).filter(Boolean).map(condToFormula));
}

export { Q, toFormula, condToFormula, fStr, fAnd, scopeF, idsF };
