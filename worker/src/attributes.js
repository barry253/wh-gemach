// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// Item attributes (filters) — e.g. Size, Color, Length for gown gemachs.
//   Gemachs."Item Attributes"  JSON [{ "name": "Size", "values": ["2","4","6"] }, …]  (the gemach's filters + allowed values;
//                              value order is the sort order, e.g. sizes small → large)
//   Item Types."Attributes"    JSON { "Size": ["8"], "Color": ["Navy","Gold"] }       (this item's values)
// Item values are always checked against the gemach's list, so the public filters stay clean.

const MAX_ATTRS = 6, MAX_ATTR_NAME = 30, MAX_VALUES = 100, MAX_VALUE_LEN = 40, MAX_ITEM_VALUES = 10;

const clean = s => String(s ?? "").replace(/\s+/g, " ").trim();
const key = s => clean(s).toLowerCase();

function parseJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

/** The gemach's attribute definitions from the stored field; bad data → []. */
function parseAttrDefs(raw) {
  const v = parseJson(raw);
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const a of v) {
    const name = clean(a?.name).slice(0, MAX_ATTR_NAME);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const vals = [], vs = new Set();
    for (const x of Array.isArray(a.values) ? a.values : []) {
      const s = clean(x).slice(0, MAX_VALUE_LEN);
      if (s && !vs.has(s.toLowerCase())) { vs.add(s.toLowerCase()); vals.push(s); }
    }
    out.push({ name, values: vals.slice(0, MAX_VALUES) });
    if (out.length >= MAX_ATTRS) break;
  }
  return out;
}

/**
 * Validate definitions from Settings. Values may be an array or a comma/newline-separated string.
 * Returns { value: JSON string | null } or { error }.
 */
function validateAttrDefs(input) {
  if (input === null || input === "" || (Array.isArray(input) && !input.length)) return { value: null };
  if (!Array.isArray(input)) return { error: "Item filters must be a list." };
  if (input.length > MAX_ATTRS) return { error: `You can have up to ${MAX_ATTRS} item filters.` };
  const out = [], seen = new Set();
  for (const a of input) {
    const name = clean(a?.name);
    if (!name) return { error: "Each item filter needs a name (e.g. Size)." };
    if (name.length > MAX_ATTR_NAME) return { error: `Filter name “${name.slice(0, 40)}” is too long (max ${MAX_ATTR_NAME} characters).` };
    if (seen.has(name.toLowerCase())) return { error: `There are two filters called “${name}”.` };
    seen.add(name.toLowerCase());
    const raw = Array.isArray(a.values) ? a.values : typeof a.values === "string" ? a.values.split(/[,\n]/) : null;
    if (!raw) return { error: `List the choices for “${name}”.` };
    const vals = [], vs = new Set();
    for (const x of raw) {
      if (typeof x !== "string" && typeof x !== "number") return { error: `Choices for “${name}” must be text.` };
      const s = clean(x);
      if (!s) continue;
      if (s.length > MAX_VALUE_LEN) return { error: `“${s.slice(0, 50)}” is too long (max ${MAX_VALUE_LEN} characters).` };
      if (!vs.has(s.toLowerCase())) { vs.add(s.toLowerCase()); vals.push(s); }
    }
    if (!vals.length) return { error: `List at least one choice for “${name}”.` };
    if (vals.length > MAX_VALUES) return { error: `“${name}” has too many choices (max ${MAX_VALUES}).` };
    out.push({ name, values: vals });
  }
  return { value: JSON.stringify(out) };
}

/** Raw item attribute values from the stored field: { name: [values] } (not checked against the gemach). */
function parseItemAttrs(raw) {
  const v = parseJson(raw);
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const [k, vals] of Object.entries(v)) {
    const list = (Array.isArray(vals) ? vals : [vals]).map(clean).filter(Boolean);
    if (clean(k) && list.length) out[clean(k)] = list;
  }
  return out;
}

/**
 * Item values kept only where they match the gemach's filters, using the gemach's spelling and value
 * order (so "size" sorts small → large). Unknown filters/values are dropped.
 */
function itemAttrsFor(raw, defs) {
  const vals = parseItemAttrs(raw);
  const byKey = Object.fromEntries(Object.entries(vals).map(([k, v]) => [key(k), new Set(v.map(key))]));
  const out = {};
  for (const d of defs || []) {
    const have = byKey[key(d.name)];
    if (!have) continue;
    const list = d.values.filter(x => have.has(key(x)));
    if (list.length) out[d.name] = list;
  }
  return out;
}

/**
 * Validate an item's values from admin against the gemach's filters.
 * input: { "Size": ["8"] | "8", … }; null / {} clears. Returns { value: JSON string | null } or { error }.
 */
function validateItemAttrs(input, defs) {
  if (input === null || input === "") return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Item filters must be an object." };
  const byKey = Object.fromEntries((defs || []).map(d => [key(d.name), d]));
  const out = {};
  for (const [k, raw] of Object.entries(input)) {
    const d = byKey[key(k)];
    if (!d) return { error: `“${clean(k).slice(0, 40)}” isn't one of this gemach's item filters (see Settings → Item filters).` };
    const list = (Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw]);
    if (list.length > MAX_ITEM_VALUES) return { error: `Pick at most ${MAX_ITEM_VALUES} choices for ${d.name}.` };
    const allowed = Object.fromEntries(d.values.map(v => [key(v), v]));
    const picked = new Set();
    for (const x of list) {
      if (typeof x !== "string" && typeof x !== "number") return { error: `${d.name} choices must be text.` };
      const canon = allowed[key(x)];
      if (!canon) return { error: `“${clean(x).slice(0, 40)}” isn't a ${d.name} choice. Add it in Settings → Item filters first.` };
      picked.add(canon);
    }
    if (picked.size) out[d.name] = d.values.filter(v => picked.has(v));
  }
  return { value: Object.keys(out).length ? JSON.stringify(out) : null };
}

export { MAX_ATTRS, MAX_ATTR_NAME, MAX_VALUES, MAX_VALUE_LEN, MAX_ITEM_VALUES, parseAttrDefs, validateAttrDefs, parseItemAttrs, itemAttrsFor, validateItemAttrs };
