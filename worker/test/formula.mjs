// Test-only: prints structured queries (src/query.js) as the Airtable formulas they used to be
// sent as. The worker no longer talks to Airtable (removed Nov 2026); the D1 test harness logs every
// data-layer call in this old URL + formula form so the suite's call-based assertions stay readable
// and unchanged.

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

export { toFormula };
