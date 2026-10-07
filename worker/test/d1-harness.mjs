// Runs the worker test suite against the D1 data layer (DB_BACKEND=d1 node test/worker.test.mjs).
//
// The tests describe their data as Airtable-shaped records in a plain DB object and look at it
// directly. Here that DB object stays the tests' view of the data, and a real SQLite database
// (Node's built-in node:sqlite, the same engine D1 runs) sits behind a fake D1 binding:
//   - before a query, if a test changed DB, SQLite is rebuilt from it (computed fields ignored);
//   - after a write, SQLite is copied back into DB in place (so held references stay valid), and
//     computed fields (item status, lookups, reverse links) are refreshed from SQL.
// Each data-layer call is also logged into the tests' `calls` list in Airtable's URL form, with
// the Airtable formula the same query would have used, so call-based assertions work unchanged.
import { DatabaseSync } from "node:sqlite";
import { TABLES, schemaSql } from "../src/dbschema.js";
import { toFormula } from "../src/query.js";
import { AirtableError } from "../src/airtable.js";
import { toRecord, writePlan } from "../src/d1.js";

export function setupD1({ DB, calls, getFail, onQuery }) {
  const specs = Object.values(TABLES);
  const dbKey = spec => (spec.airtableIds || []).find(id => DB[id]) || spec.name;
  const storedNames = spec => Object.entries(spec.fields).filter(([, f]) => f.kind !== "calc").map(([n]) => n);
  const known = spec => new Set(Object.keys(spec.fields));

  let sql = null;
  let lastSnap = null;
  let lastWrite = null; // { table, id?, fields } of the data-layer write in progress
  const isEmpty = v => v === null || v === undefined || v === false || v === "" || (Array.isArray(v) && !v.length);
  const skipped = new Set(); // fixture fields that have no D1 column (reported once)

  function snapshot() {
    return JSON.stringify(specs.map(spec => (DB[dbKey(spec)] || []).map(r => [r.id, r.createdTime || null,
      storedNames(spec).map(n => (r.fields[n] === undefined ? null : r.fields[n]))])));
  }

  function load() {
    sql = new DatabaseSync(":memory:");
    sql.exec("PRAGMA foreign_keys = OFF"); // fixtures may point at records they never define
    sql.exec(schemaSql());
    for (const spec of specs) {
      const names = known(spec);
      for (const r of DB[dbKey(spec)] || []) {
        const fields = {};
        for (const [k, v] of Object.entries(r.fields)) {
          if (!names.has(k)) { skipped.add(`${spec.name}.${k}`); continue; }
          if (spec.fields[k].kind === "calc") continue;
          fields[k] = v;
        }
        const plan = writePlan(spec, fields);
        const cols = ["id", "created_at", ...plan.cols];
        sql.prepare(`INSERT INTO ${spec.sql} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
          .run(r.id, (spec.name === "Requests" && r.fields["Received At"]) || r.createdTime || "2026-01-01T00:00:00.000Z", ...plan.vals);
        for (const j of plan.joins) j.ids.forEach((id, pos) =>
          sql.prepare(`INSERT INTO ${j.f.join} (owner_id, target_id, pos) VALUES (?, ?, ?)`).run(r.id, id, pos));
      }
    }
    sql.exec("PRAGMA foreign_keys = ON"); // like D1 from here on
  }

  function mirror() {
    for (const spec of specs) {
      const key = dbKey(spec);
      const names = Object.keys(spec.fields);
      const rows = sql.prepare(`SELECT * FROM ${spec.sql}_v ORDER BY _seq`).all();
      const recs = rows.map(row => toRecord(spec, row, names));
      const list = DB[key] || (DB[key] = []);
      const byId = new Map(list.map(r => [r.id, r]));
      const keep = new Set(recs.map(r => r.id));
      for (let i = list.length - 1; i >= 0; i--) if (!keep.has(list[i].id)) list.splice(i, 1);
      const fresh = [];
      for (const nr of recs) {
        const cur = byId.get(nr.id);
        if (!cur) { list.push(nr); fresh.push(nr); continue; }
        // Airtable leaves empty values out; the old fake kept whatever was written. Keep an empty
        // value the test fixture or the worker put there, drop only real values that went away.
        for (const k of Object.keys(cur.fields)) if (spec.fields[k] && !(k in nr.fields) && !isEmpty(cur.fields[k])) delete cur.fields[k];
        Object.assign(cur.fields, nr.fields);
        cur.createdTime = nr.createdTime;
      }
      if (lastWrite && (lastWrite.table === spec.name || (spec.airtableIds || []).includes(lastWrite.table))) {
        const target = lastWrite.id ? list.find(r => r.id === lastWrite.id) : fresh[fresh.length - 1];
        if (target) for (const [k, v] of Object.entries(lastWrite.fields || {})) if (isEmpty(v) && spec.fields[k]?.kind !== "calc") target.fields[k] = v;
      }
    }
    lastWrite = null;
    lastSnap = snapshot();
  }

  function sync() {
    const s = snapshot();
    if (s !== lastSnap) { load(); mirror(); }
  }

  const isRead = q => /^\s*SELECT/i.test(q);
  function exec(q, params) {
    onQuery?.(q);
    const st = sql.prepare(q);
    if (isRead(q)) return { results: st.all(...params), success: true, meta: {} };
    const r = st.run(...params);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  const stmt = (q, params) => ({
    bind: (...p) => stmt(q, p),
    _q: q, _params: params,
    async all() { sync(); const out = exec(q, params); if (!isRead(q)) mirror(); return out; },
    async run() { sync(); const out = exec(q, params); if (!isRead(q)) mirror(); return out; },
    async first() { sync(); return exec(q, params).results[0] ?? null; },
  });
  const binding = {
    prepare: q => stmt(q, []),
    async batch(stmts) {
      sync();
      sql.exec("BEGIN");
      let out;
      try { out = stmts.map(s => exec(s._q, s._params)); sql.exec("COMMIT"); }
      catch (e) { sql.exec("ROLLBACK"); throw e; }
      if (stmts.some(s => !isRead(s._q))) mirror();
      return out;
    },
  };

  const METHOD = { list: "POST", get: "GET", create: "POST", update: "PATCH", del: "DELETE" };
  function trace(op) {
    const tail = op.kind === "list" ? "/listRecords" : op.id ? `/${op.id}` : "";
    const url = `https://api.airtable.com/v0/appTEST/${encodeURIComponent(op.table)}${tail}`;
    const method = METHOD[op.kind];
    let body;
    if (op.kind === "list") {
      const b = {};
      const f = toFormula(op);
      if (f) b.filterByFormula = f;
      for (const k of ["sort", "fields", "pageSize", "maxRecords", "offset"]) if (op[k] !== undefined && op[k] !== null) b[k] = op[k];
      body = JSON.stringify(b);
    } else if (op.kind === "create" || op.kind === "update") body = JSON.stringify({ fields: op.fields });
    calls.push({ url, method, body });
    lastWrite = op.kind === "create" || op.kind === "update" ? { table: op.table, id: op.id, fields: op.fields } : null;
    const fail = getFail();
    if (fail && fail(method, op.table, op.kind === "list" ? "listRecords" : op.id)) {
      throw new AirtableError(422, { error: { type: "TEST_FAIL" } });
    }
  }

  load(); mirror();
  return { env: { DB_BACKEND: "d1", DB: binding, DB_TRACE: trace }, skipped, sqlite: () => sql };
}
