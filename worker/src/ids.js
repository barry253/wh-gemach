// Part of the Gemach Network worker (see index.js for routes and env vars).
import { firstLink, linkedId } from "./airtable.js";
import { T } from "./config.js";

// ─── IDs ──────────────────────────────────────────────────────────────────────

async function nextSequentialId(db, table, field, prefix) {
  // Global numbering across all gemachs; pages through every record so IDs never collide.
  const recs = await db.listAll(table, { fields: [field] });
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const r of recs) {
    const m = String(r.fields[field] || "").trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
const getNextLoanId = db => nextSequentialId(db, T.LOANS, "Loan ID", "L");
const getNextRequestId = db => nextSequentialId(db, T.REQUESTS, "Request ID", "R");

async function generateNextItemId(db, g, typeRec) {
  const typeName = typeRec.fields?.["Name"] || "";
  const items = await db.listAll(T.ITEMS, { scope: g, fields: ["Item ID", "Item Type"] });
  const typeItems = items.filter(r => linkedId(firstLink(r.fields["Item Type"])) === typeRec.id && r.fields["Item ID"]);

  let prefix;
  if (typeItems.length) {
    prefix = String(typeItems[0].fields["Item ID"]).split("-")[0];
  } else {
    const words = typeName.split(/[\s\-—]+/).filter(Boolean);
    prefix = words.length >= 2
      ? words[0][0].toUpperCase() + words[1][0].toUpperCase()
      : (typeName.substring(0, 2).toUpperCase() || "IT");
  }
  // Max across ALL of this gemach's items sharing the prefix, so two types with the same prefix never collide.
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  for (const r of items) {
    const m = String(r.fields["Item ID"] || "").trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export { nextSequentialId, getNextLoanId, getNextRequestId, generateNextItemId };
