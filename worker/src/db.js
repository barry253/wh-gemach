// Part of the Gemach Network worker (see index.js for routes and env vars).
// The data layer: Cloudflare D1 (binding DB, see d1.js and dbschema.js). Records come back
// Airtable-shaped ({ id, createdTime, fields }) — the format the site used before Oct 2026 —
// so every route module works with plain field names.
import { makeD1Db } from "./d1.js";

function makeDb(env) {
  return makeD1Db(env);
}

export { makeDb };
