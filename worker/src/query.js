// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── Structured queries ────────────────────────────────────────────────────────
// Every list query describes WHAT it wants with these conditions; the D1 data layer (d1.js)
// compiles them to SQL with bound parameters.
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
  /** checkbox is checked. */
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
   * Link field points at record `id` (matched exactly). `name` (the linked record's primary field)
   * is only used by the tests' call log, which still prints queries as the old Airtable formulas.
   */
  linksTo: (field, id, name) => ({ op: "linksTo", field, id, name: String(name ?? "") }),
  /** Digits of a phone field equal `digits`; last10: compare only the last 10 digits. */
  phoneDigits: (field, digits, { last10 = false } = {}) => ({ op: "phone", field, value: String(digits), last10 }),
  /** Any one of the conditions holds. */
  or: (...conds) => ({ op: "or", conds: conds.filter(Boolean) }),
};

export { Q };
