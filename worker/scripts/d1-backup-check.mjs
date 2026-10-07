// Checks a D1 export before it's stored: loads it into a scratch SQLite database (the same engine
// D1 runs) and counts the rows in every table, so a broken or empty export fails the backup run.
//   node scripts/d1-backup-check.mjs <export.sql>
// Prints counts only, never values (the repo's workflow logs are public).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TABLES } from "../src/dbschema.js";
import { d1Query } from "./lib.mjs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/d1-backup-check.mjs <export.sql>"); process.exit(2); }
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(file, "utf8"));

let problems = 0;
for (const spec of Object.values(TABLES)) {
  const n = db.prepare(`SELECT count(*) AS n FROM ${spec.sql}`).get().n;
  let live = null;
  try { live = (await d1Query(`SELECT count(*) AS n FROM ${spec.sql}`)).results[0].n; } catch { /* counts only; not fatal */ }
  const note = live === null ? "" : live === n ? "" : `  (live now: ${live} — changed since the export?)`;
  console.log(`${spec.name.padEnd(20)} ${String(n).padStart(6)}${note}`);
}
for (const must of ["gemachs", "item_types", "admins"]) {
  if (!db.prepare(`SELECT count(*) AS n FROM ${must}`).get().n) { console.error(`backup has no rows in ${must}`); problems++; }
}
// The computed views must work on the restored copy too.
const views = db.prepare("SELECT name FROM sqlite_master WHERE type = 'view'").all().map(v => v.name);
for (const v of views) db.prepare(`SELECT count(*) AS n FROM ${v}`).get();
console.log(`views: ${views.length} working`);
process.exit(problems ? 1 : 0);
