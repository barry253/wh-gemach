// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── D1 data layer ──────────────────────────────────────────────────────────────
// Same interface and record shape as the Airtable layer (airtable.js makeDb): listAll, listPage,
// get, create, update, del, returning { id, createdTime, fields } with Airtable field names. The
// worker picks one with the DB_BACKEND variable (db.js). Field ↔ column mapping: dbschema.js.
//
// Behaves like Airtable where the worker relies on it:
//   - empty values are left out of `fields` (no "", null, false or [] keys)
//   - links come back as arrays of record ids; lookups as arrays of values
//   - asking for a field that doesn't exist, or writing a computed one, is an error (422)
//   - a fields list returns only those fields
//   - unsorted lists come back in creation order
// Errors are thrown as AirtableError (same status codes) so existing catch blocks keep working.
import { AirtableError } from "./airtable.js";
import { REC_RE } from "./config.js";
import { tableSpec, viewName, linksCol } from "./dbschema.js";

const PAGE_SIZE = 100;
const QUERY_WARN = 45; // D1 Free allows 50 queries per request

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function newRecordId() {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let s = "rec";
  for (const x of bytes) s += ID_CHARS[x % ID_CHARS.length];
  return s;
}

const err = (status, type, message) => new AirtableError(status, { error: { type, message } });

function fieldSpec(spec, name) {
  const f = spec.fields[name];
  if (!f) throw err(422, "UNKNOWN_FIELD_NAME", `Unknown field name: "${name}" (${spec.name})`);
  return f;
}

/** The view column a field is read from. */
const readCol = f => (f.kind === "links" ? linksCol(f) : f.col);

// ─── Reading rows into Airtable-shaped records ─────────────────────────────────

function cellValue(f, v) {
  if (v === null || v === undefined) return undefined;
  switch (f.kind) {
    case "bool": return v ? true : undefined;
    case "num": return typeof v === "number" ? v : Number(v);
    case "link": return v ? [v] : undefined;
    case "links": {
      const ids = JSON.parse(v || "[]");
      return ids.length ? ids : undefined;
    }
    case "calc":
      if (f.json) {
        const a = JSON.parse(v || "[]").filter(x => x !== null && x !== "");
        return a.length ? a : undefined;
      }
      if (f.array) return v === "" ? undefined : [v];
      return v === "" ? undefined : v;
    default: return v === "" ? undefined : v;
  }
}

function toRecord(spec, row, names) {
  const fields = {};
  for (const name of names) {
    const v = cellValue(spec.fields[name], row[readCol(spec.fields[name])]);
    if (v !== undefined) fields[name] = v;
  }
  return { id: row.id, createdTime: row.created_at, fields };
}

// ─── Conditions → SQL ──────────────────────────────────────────────────────────

function condSql(spec, c, params) {
  const col = name => {
    const f = fieldSpec(spec, name);
    if (f.kind === "links") throw new Error(`can't filter on a several-links field (${spec.name}.${name})`);
    return { f, sql: readCol(f) };
  };
  switch (c.op) {
    case "eq": { const { sql } = col(c.field); params.push(c.value); return `${sql} = ?`; }
    case "ne": { const { sql } = col(c.field); params.push(c.value); return `(${sql} IS NULL OR ${sql} != ?)`; }
    case "in": {
      const { sql } = col(c.field);
      if (!c.values.length) return "0";
      params.push(...c.values);
      return `${sql} IN (${c.values.map(() => "?").join(",")})`;
    }
    case "true": { const { sql } = col(c.field); return `${sql} = 1`; }
    case "nonEmpty":
    case "notBlank": { const { sql } = col(c.field); return `(${sql} IS NOT NULL AND ${sql} != '')`; }
    case "ieq": {
      const { sql } = col(c.field);
      params.push(c.value);
      return c.trim ? `lower(trim(${sql})) = ?` : `lower(${sql}) = ?`;
    }
    case "after": { const { sql } = col(c.field); params.push(c.value); return `${sql} > ?`; }
    case "before": { const { sql } = col(c.field); params.push(c.value); return `${sql} < ?`; }
    case "notBefore": { const { sql } = col(c.field); params.push(c.value); return `${sql} >= ?`; }
    case "idIn":
      if (!c.ids.length) return "0";
      params.push(...c.ids);
      return `id IN (${c.ids.map(() => "?").join(",")})`;
    case "linksTo": {
      const { f, sql } = col(c.field);
      if (f.kind !== "link") throw new Error(`linksTo needs a link field (${spec.name}.${c.field})`);
      params.push(c.id);
      return `${sql} = ?`;
    }
    case "phone": {
      const { f, sql } = col(c.field);
      if (f.kind !== "phone") throw new Error(`phoneDigits needs a phone field (${spec.name}.${c.field})`);
      params.push(c.value);
      return c.last10 ? `substr(${sql}_digits, -10) = ?` : `${sql}_digits = ?`;
    }
    case "or": {
      const parts = c.conds.map(x => condSql(spec, x, params));
      return parts.length ? `(${parts.join(" OR ")})` : "0";
    }
    default: throw new Error(`unknown query condition: ${c?.op}`);
  }
}

function whereSql(spec, { scope, where }, params) {
  const parts = [];
  if (scope) {
    if (!spec.scoped) throw new Error(`${spec.name} isn't scoped to a gemach`);
    if (!scope.id) throw new Error("scope needs the gemach's record id");
    parts.push("gemach_id = ?");
    params.push(scope.id);
  }
  for (const c of where || []) if (c) parts.push(condSql(spec, c, params));
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

function orderSql(spec, sort) {
  const keys = (sort || []).map(s => {
    const f = fieldSpec(spec, s.field);
    const dir = s.direction === "desc" ? "DESC" : "ASC";
    const textish = ["text", "phone", "calc"].includes(f.kind);
    // Airtable sorts empty values first ascending, last descending; SQLite NULLs behave the same.
    return `${readCol(f)}${textish ? " COLLATE NOCASE" : ""} ${dir}`;
  });
  keys.push("_seq ASC"); // creation order, like Airtable
  return ` ORDER BY ${keys.join(", ")}`;
}

// ─── Writing ───────────────────────────────────────────────────────────────────

function toColumnValue(spec, name, f, v) {
  if (v === undefined || v === null) return null;
  switch (f.kind) {
    case "text": case "phone": return v === "" ? null : String(v);
    case "num": {
      if (v === "") return null;
      const x = Number(v);
      if (!Number.isFinite(x)) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${name}" needs a number`);
      return x;
    }
    case "bool": return v ? 1 : 0;
    case "date": {
      if (v === "") return null;
      const s = String(v);
      if (!/^\d{4}-\d{2}-\d{2}/.test(s)) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${name}" needs a date`);
      return s.slice(0, 10);
    }
    case "datetime": {
      if (v === "") return null;
      const ms = Date.parse(v);
      if (!Number.isFinite(ms)) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${name}" needs a date and time`);
      return new Date(ms).toISOString();
    }
    case "link": {
      const ids = (Array.isArray(v) ? v : [v]).map(x => (typeof x === "string" ? x : x?.id)).filter(Boolean);
      if (ids.length > 1) throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${name}" links to one record only`);
      if (ids[0] && !REC_RE.test(ids[0])) throw err(422, "ROW_DOES_NOT_EXIST", `Record ID ${ids[0]} does not exist`);
      return ids[0] || null;
    }
    default: throw new Error("unexpected field kind " + f.kind);
  }
}

/** Split Airtable-style fields into column assignments and several-links replacements. */
function writePlan(spec, fields) {
  const cols = [];
  const vals = [];
  const joins = [];
  for (const [name, v] of Object.entries(fields || {})) {
    const f = fieldSpec(spec, name);
    if (f.kind === "calc") throw err(422, "INVALID_VALUE_FOR_COLUMN", `Field "${name}" cannot accept a value because the field is computed`);
    if (f.kind === "links") {
      const ids = (Array.isArray(v) ? v : v ? [v] : []).map(x => (typeof x === "string" ? x : x?.id)).filter(Boolean);
      if (ids.some(id => !REC_RE.test(id))) throw err(422, "ROW_DOES_NOT_EXIST", `Invalid record id in "${name}"`);
      joins.push({ f, ids: [...new Set(ids)] });
      continue;
    }
    const value = toColumnValue(spec, name, f, v);
    cols.push(f.col); vals.push(value);
    if (f.kind === "phone") { cols.push(`${f.col}_digits`); vals.push(value ? value.replace(/\D/g, "") || null : null); }
  }
  return { cols, vals, joins };
}

function joinStatements(prep, f, ownerId, ids) {
  const out = [prep(`DELETE FROM ${f.join} WHERE owner_id = ?`, [ownerId])];
  ids.forEach((id, pos) => out.push(prep(`INSERT INTO ${f.join} (owner_id, target_id, pos) VALUES (?, ?, ?)`, [ownerId, id, pos])));
  return out;
}

const isConstraint = e => /constraint|FOREIGN KEY/i.test(String(e?.message || e));

// ─── The data layer ────────────────────────────────────────────────────────────

function makeD1Db(env) {
  const d1 = env.DB;
  if (!d1) throw new Error("DB_BACKEND=d1 but the worker has no DB binding");
  const stats = { calls: 0, retries: 0, ms: 0, waitMs: 0, slowest: 0, slowestPath: "", hedges: 0, hedgeWins: 0 };
  let warned = false;

  const prep = (sql, params = []) => d1.prepare(sql).bind(...params);
  // Test hook only: the test suite records each call (and can make one fail). A dashboard
  // variable is always a string, so this can never be set in production.
  const trace = typeof env.DB_TRACE === "function" ? env.DB_TRACE : null;

  async function timed(label, n, fn) {
    stats.calls += n;
    if (stats.calls > QUERY_WARN && !warned) {
      warned = true;
      console.warn(`D1: ${stats.calls} queries in one request (Free plan limit is 50) — last: ${label}`);
    }
    const t0 = Date.now();
    try { return await fn(); } finally {
      const took = Date.now() - t0;
      stats.ms += took;
      if (took > stats.slowest) { stats.slowest = took; stats.slowestPath = label; }
    }
  }

  const all = async (label, sql, params) => (await timed(label, 1, () => prep(sql, params).all())).results || [];
  const batch = (label, stmts) => timed(label, stmts.length, () => d1.batch(stmts));

  function selectList(spec, fields) {
    const names = fields ? [...new Set(fields)] : Object.keys(spec.fields);
    for (const n of names) fieldSpec(spec, n); // unknown names → 422, like Airtable
    const cols = new Set(["id", "created_at", "_seq"]);
    for (const n of names) {
      const f = spec.fields[n];
      cols.add(readCol(f));
    }
    return { names, sql: [...cols].join(", ") };
  }

  async function listPage(table, { scope, where, filter, sort, fields, pageSize, offset, maxRecords } = {}) {
    if (filter !== undefined) throw new Error("raw Airtable formulas are no longer accepted; use scope/where (query.js)");
    const spec = tableSpec(table);
    trace?.({ kind: "list", table, scope, where, sort, fields, pageSize, offset, maxRecords });
    const sel = selectList(spec, fields);
    const params = [];
    const w = whereSql(spec, { scope, where }, params);
    const start = offset ? Number(offset) : 0;
    if (!Number.isInteger(start) || start < 0) throw err(422, "LIST_RECORDS_ITERATOR_NOT_AVAILABLE", "Invalid offset");
    const size = Math.max(1, Math.min(PAGE_SIZE, pageSize || PAGE_SIZE));
    const cap = maxRecords ? Math.max(0, maxRecords - start) : Infinity;
    const take = Math.min(size, cap);
    if (take <= 0) return { records: [], offset: null };
    const rows = await all(`list ${spec.sql}`, `SELECT ${sel.sql} FROM ${viewName(spec)}${w}${orderSql(spec, sort)} LIMIT ? OFFSET ?`, [...params, take + 1, start]);
    const more = rows.length > take && start + take < (maxRecords || Infinity);
    return { records: rows.slice(0, take).map(r => toRecord(spec, r, sel.names)), offset: more ? String(start + take) : null };
  }

  // One query for the whole list (no paging round trips, unlike Airtable).
  async function listAll(table, { scope, where, filter, sort, fields, maxRecords } = {}) {
    if (filter !== undefined) throw new Error("raw Airtable formulas are no longer accepted; use scope/where (query.js)");
    const spec = tableSpec(table);
    trace?.({ kind: "list", table, scope, where, sort, fields, maxRecords });
    const sel = selectList(spec, fields);
    const params = [];
    const w = whereSql(spec, { scope, where }, params);
    const limit = maxRecords ? " LIMIT ?" : "";
    if (maxRecords) params.push(maxRecords);
    const rows = await all(`list ${spec.sql}`, `SELECT ${sel.sql} FROM ${viewName(spec)}${w}${orderSql(spec, sort)}${limit}`, params);
    return rows.map(r => toRecord(spec, r, sel.names));
  }

  async function get(table, id) {
    if (!REC_RE.test(id || "")) return null;
    const spec = tableSpec(table);
    trace?.({ kind: "get", table, id });
    const sel = selectList(spec, null);
    const rows = await all(`get ${spec.sql}`, `SELECT ${sel.sql} FROM ${viewName(spec)} WHERE id = ?`, [id]);
    return rows[0] ? toRecord(spec, rows[0], sel.names) : null;
  }

  const readBack = (spec, id) => {
    const sel = selectList(spec, null);
    return { sel, stmt: prep(`SELECT ${sel.sql} FROM ${viewName(spec)} WHERE id = ?`, [id]) };
  };

  async function create(table, fields) {
    const spec = tableSpec(table);
    trace?.({ kind: "create", table, fields });
    const plan = writePlan(spec, fields);
    const id = newRecordId();
    const cols = ["id", "created_at", ...plan.cols];
    const vals = [id, new Date().toISOString(), ...plan.vals];
    const stmts = [prep(`INSERT INTO ${spec.sql} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals)];
    for (const j of plan.joins) stmts.push(...joinStatements(prep, j.f, id, j.ids).slice(1));
    const rb = readBack(spec, id);
    stmts.push(rb.stmt);
    let res;
    try { res = await batch(`create ${spec.sql}`, stmts); } catch (e) {
      if (isConstraint(e)) throw err(422, "ROW_DOES_NOT_EXIST", `Linked record not found (${spec.name}): ${e.message}`);
      throw e;
    }
    return toRecord(spec, res[res.length - 1].results[0], rb.sel.names);
  }

  async function update(table, id, fields) {
    const spec = tableSpec(table);
    if (!REC_RE.test(id || "")) throw err(404, "NOT_FOUND", "Could not find record");
    trace?.({ kind: "update", table, id, fields });
    const plan = writePlan(spec, fields);
    const stmts = [];
    if (plan.cols.length) stmts.push(prep(`UPDATE ${spec.sql} SET ${plan.cols.map(c => `${c} = ?`).join(", ")} WHERE id = ?`, [...plan.vals, id]));
    for (const j of plan.joins) stmts.push(...joinStatements(prep, j.f, id, j.ids));
    const rb = readBack(spec, id);
    stmts.push(rb.stmt);
    let res;
    try { res = await batch(`update ${spec.sql}`, stmts); } catch (e) {
      if (isConstraint(e)) throw err(422, "ROW_DOES_NOT_EXIST", `Linked record not found (${spec.name}): ${e.message}`);
      throw e;
    }
    const row = res[res.length - 1].results[0];
    if (!row) throw err(404, "NOT_FOUND", "Could not find record");
    return toRecord(spec, row, rb.sel.names);
  }

  async function del(table, id) {
    const spec = tableSpec(table);
    if (!REC_RE.test(id || "")) throw err(404, "NOT_FOUND", "Could not find record");
    trace?.({ kind: "del", table, id });
    const res = await timed(`delete ${spec.sql}`, 1, () => prep(`DELETE FROM ${spec.sql} WHERE id = ?`, [id]).run());
    if (!res?.meta?.changes) throw err(404, "NOT_FOUND", "Could not find record");
    return { id, deleted: true };
  }

  /** Lightweight check for /health. */
  async function ping() {
    await all("ping", "SELECT 1 AS ok", []);
    return true;
  }

  return { engine: "d1", stats, listPage, listAll, get, create, update, del, ping };
}

export { makeD1Db, newRecordId, toRecord, writePlan };
