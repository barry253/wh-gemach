// Part of the Gemach Network worker (see index.js for routes and env vars).
// Picks the data layer: DB_BACKEND = "d1" uses Cloudflare D1 (binding DB, see d1.js and dbschema.js);
// anything else (or unset) uses Airtable (airtable.js). Both take the same calls and return the
// same Airtable-shaped records, so switching back and forth is one dashboard variable.
import { makeDb as makeAirtableDb } from "./airtable.js";
import { makeD1Db } from "./d1.js";

const useD1 = env => String(env?.DB_BACKEND || "").trim().toLowerCase() === "d1";

function makeDb(env) {
  return useD1(env) ? makeD1Db(env) : makeAirtableDb(env);
}

export { makeDb, useD1 };
