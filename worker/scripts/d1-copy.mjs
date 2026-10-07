// Copies the whole Airtable base into a SQL file for D1:
//   node scripts/d1-copy.mjs <out.sql>
// then: npx wrangler d1 execute wh-gemach --remote --file=<out.sql>
//
// The file first empties every D1 table, then inserts every Airtable record with its original
// record id and created time, oldest first. Values are converted exactly as the worker's D1 layer
// converts them on a save (writePlan in src/d1.js). Computed fields (item status, lookups,
// reverse links) aren't copied; D1 works them out (d1-compare.mjs checks they agree).
//
// It refuses to write the file if Airtable has a field it doesn't know, a one-record link holding
// several records, or a link to a record that isn't there. Prints counts only — never values (the
// workflow log of a public repo is public, and these tables hold borrowers' details).
import { writeFileSync } from "node:fs";
import { TABLES } from "../src/dbschema.js";
import { writePlan } from "../src/d1.js";
import { airtableAll } from "./lib.mjs";

// Airtable fields with no D1 column on purpose: attachment copies of photos/logos (every photo is
// in R2), reverse links D1 doesn't need, and a leftover column.
const IGNORED = {
  "Gemachs": ["Logo", "Admins", "Requests", "Loans", "Item Types", "Borrowers", "Activity Log"],
  "Communities": ["Gemachs"],
  "Product Categories": ["Item Types", "Gemachs"],
  "Item Types": ["Photo", "Loans", "Requests", "UNUSED - delete (was Pack Contents)"],
  "Items": ["Current Loan"],
  "Borrowers": ["Current Loan"],
  "Requests": ["Loans"],
};

const out = process.argv[2];
if (!out) { console.error("usage: node scripts/d1-copy.mjs <out.sql>"); process.exit(2); }

const lit = v => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const specs = Object.values(TABLES); // already in dependency order
const problems = [];
const data = {};
for (const spec of specs) {
  const source = (spec.airtableIds || [])[0] || spec.name;
  data[spec.name] = await airtableAll(source);
}
const ids = new Set(Object.values(data).flatMap(rs => rs.map(r => r.id)));

const lines = ["PRAGMA defer_foreign_keys = true;"];
const joinNames = specs.flatMap(s => Object.values(s.fields).filter(f => f.kind === "links").map(f => f.join));
for (const j of joinNames) lines.push(`DELETE FROM ${j};`);
for (const spec of [...specs].reverse()) lines.push(`DELETE FROM ${spec.sql};`);

const joinRows = [];
for (const spec of specs) {
  const ignored = new Set(IGNORED[spec.name] || []);
  for (const r of data[spec.name]) {
    const fields = {};
    for (const [k, v] of Object.entries(r.fields)) {
      const f = spec.fields[k];
      if (!f) { if (!ignored.has(k)) problems.push(`${spec.name}: unknown field "${k}"`); continue; }
      if (f.kind === "calc") continue;
      if ((f.kind === "link" || f.kind === "links") && Array.isArray(v)) {
        const missing = v.filter(id => !ids.has(id));
        if (missing.length) problems.push(`${spec.name} ${r.id}: "${k}" links to ${missing.length} missing record(s)`);
      }
      fields[k] = v;
    }
    let plan;
    try { plan = writePlan(spec, fields); } catch (e) { problems.push(`${spec.name} ${r.id}: ${e.message}`); continue; }
    const cols = ["id", "created_at", ...plan.cols];
    const vals = [r.id, r.createdTime, ...plan.vals];
    lines.push(`INSERT INTO ${spec.sql} (${cols.join(", ")}) VALUES (${vals.map(lit).join(", ")});`);
    for (const j of plan.joins) j.ids.forEach((id, pos) => joinRows.push(`INSERT INTO ${j.f.join} (owner_id, target_id, pos) VALUES (${lit(r.id)}, ${lit(id)}, ${pos});`));
  }
}
lines.push(...joinRows);

const uniqueProblems = [...new Set(problems)];
for (const spec of specs) console.log(`${spec.name.padEnd(20)} ${String(data[spec.name].length).padStart(5)} records`);
console.log(`join rows: ${joinRows.length}; total records: ${Object.values(data).reduce((a, r) => a + r.length, 0)}`);
if (uniqueProblems.length) {
  console.error(`\n${uniqueProblems.length} problem(s) — nothing written:`);
  for (const p of uniqueProblems.slice(0, 50)) console.error("  " + p);
  process.exit(1);
}
writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} statements to ${out}`);
