// Part of the Gemach Network worker (see index.js for routes and env vars).
//
// ─── D1 schema: how each Airtable table and field maps to SQL ───────────────────
// The rest of the worker still works with Airtable-shaped records ({ id, createdTime, fields }),
// so this table is the single place that says where each field lives in D1. schema.sql is
// generated from it (`npm run schema`; a test fails if the two drift apart).
//
// Field kinds:
//   text / num / bool / date ("YYYY-MM-DD") / datetime (ISO "…Z")  → a column of that name
//   phone   → text column plus "<col>_digits" (digits only) kept in step on every write, for borrower matching
//   link    → one linked record: an id column (Airtable still sees a one-element array)
//   links   → several linked records, in order: a join table (owner_id, target_id, pos)
//   calc    → read-only, computed by the table's view (lookups, formulas, reverse links)
//
// Record ids keep Airtable's format (rec + 14 letters/digits); rows copied from Airtable keep
// their original ids, so manage links, admin links and photo backups keep working.

const t = (col, extra) => ({ kind: "text", col, ...extra });
const n = col => ({ kind: "num", col });
const b = col => ({ kind: "bool", col });
const d = col => ({ kind: "date", col });
const dt = col => ({ kind: "datetime", col });
const phone = col => ({ kind: "phone", col });
const link = (col, to) => ({ kind: "link", col, to });
const links = (join, to) => ({ kind: "links", join, to });
// calc: sql is an expression over the base row aliased "r"; json: the expression yields a JSON array.
const calc = (col, sql, { json = false, array = false } = {}) => ({ kind: "calc", col, sql, json, array });

const gemachSlug = () => calc("gemach_slug", "(SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id)", { array: true });

const TABLES = {
  "Communities": {
    sql: "communities",
    fields: {
      "Name": t("name"), "City": t("city"), "State": t("state"),
      "Latitude": n("latitude"), "Longitude": n("longitude"), "Active": b("active"),
    },
  },
  "Product Categories": {
    sql: "product_categories",
    fields: {
      "Name": t("name"), "Icon": t("icon"), "Keywords": t("keywords"),
      "Display Order": n("display_order"), "Active": b("active"),
      // reverse link: the item types in this category (the Network tab shows how many)
      "Item Types": calc("item_type_ids", "(SELECT json_group_array(x.id) FROM (SELECT id FROM item_types WHERE product_category_id = r.id ORDER BY rowid) x)", { json: true }),
    },
  },
  "Gemachs": {
    sql: "gemachs",
    fields: {
      "Name": t("name"),
      "Community": link("community_id", "Communities"),
      "Slug": t("slug"),
      "Description": t("description"),
      "Tagline": t("tagline"),
      "Phone": t("phone"), "Email": t("email"), "WhatsApp": t("whatsapp"),
      "Website": t("website"), "Donation URL": t("donation_url"), "Donation Info": t("donation_info"),
      "Category": t("category"),
      "Active": b("active"), "Coming Soon": b("coming_soon"),
      "Mode": t("mode"),
      "Display Order": n("display_order"),
      "Pickup Address": t("pickup_address"), "Pickup Instructions": t("pickup_instructions"), "Hours": t("hours"),
      "Primary Contact": t("primary_contact"), "Secondary Contact": t("secondary_contact"),
      "Logo URL": t("logo_url"), "Logo On Dark URL": t("logo_on_dark_url"),
      "Theme Color": t("theme_color"), "Accent Color": t("accent_color"),
      "Deposit Required": b("deposit_required"), "Charge Type": t("charge_type"), "Deposit Info": t("deposit_info"),
      "Gemach Info": t("gemach_info"),
      "Request Style": t("request_style"), "Event Label": t("event_label"),
      "Pickup Days Before": n("pickup_days_before"), "Return Days After": n("return_days_after"), "Shabbos Adjust": b("shabbos_adjust"),
      "Confirm Message": t("confirm_message"), "Decline Message": t("decline_message"), "Pickup Message": t("pickup_message"),
      "Appointment Message": t("appointment_message"), "Return Reminder Message": t("return_reminder_message"),
      "Auto Reminders": b("auto_reminders"), "Reminder Days Before": n("reminder_days_before"), "Reminder Repeat Days": n("reminder_repeat_days"),
      "Item Attributes": t("item_attributes"),
      "Item View": t("item_view"),
      "Browse Categories": links("gemach_browse_categories", "Product Categories"),
      "Onboarding": t("onboarding"),
      "Items": calc("item_ids", "(SELECT json_group_array(i.id) FROM (SELECT id FROM items WHERE gemach_id = r.id ORDER BY rowid) i)", { json: true }),
    },
  },
  "Admins": {
    sql: "admins",
    fields: {
      "Name": t("name"), "Email": t("email"), "Phone": t("phone"),
      "Gemachs": links("admin_gemachs", "Gemachs"),
      "Role": t("role"), "Active": b("active"), "Last Active": dt("last_active"),
    },
  },
  "Item Types": {
    sql: "item_types",
    scoped: true,
    fields: {
      "Name": t("name"), "Description": t("description"),
      "Display Order": n("display_order"), "Active": b("active"),
      "R2 Photo URL": t("r2_photo_url"), "More Photos": t("more_photos"),
      "Gemach": link("gemach_id", "Gemachs"),
      "Product Category": link("product_category_id", "Product Categories"),
      "Tracking": t("tracking"), "Quantity Owned": n("quantity_owned"), "Out of Service": n("out_of_service"),
      "Price": n("price"), "Attributes": t("attributes"),
      "Package Size": n("package_size"), "Package Unit": t("package_unit"),
      "Gemach Slug": gemachSlug(),
      "Items": calc("item_ids", "(SELECT json_group_array(i.id) FROM (SELECT id FROM items WHERE item_type_id = r.id ORDER BY rowid) i)", { json: true }),
    },
  },
  "Items": {
    sql: "items",
    scoped: true,
    fields: {
      "Item ID": t("item_id"),
      "Item Type": link("item_type_id", "Item Types"),
      "Condition": t("condition"), "Notes": t("notes"), "Active": b("active"),
      "Gemach": link("gemach_id", "Gemachs"),
      "Gemach Slug": gemachSlug(),
      // Same rule as the Airtable formula: On Loan if any linked loan is Active; Reserved if any is Reserved.
      "Status": calc("status", "(CASE WHEN EXISTS (SELECT 1 FROM loans l WHERE l.item_id = r.id AND l.status = 'Active') THEN 'On Loan'"
        + " WHEN EXISTS (SELECT 1 FROM loans l WHERE l.item_id = r.id AND l.status = 'Reserved') THEN 'Reserved' ELSE 'Available' END)"),
      "Loan Statuses": calc("loan_statuses", "(SELECT json_group_array(s.status) FROM (SELECT status FROM loans WHERE item_id = r.id AND status IS NOT NULL ORDER BY rowid) s)", { json: true }),
    },
  },
  "Borrowers": {
    sql: "borrowers",
    scoped: true,
    fields: {
      "Name": t("name"), "Phone": phone("phone"), "Email": t("email"),
      "Preferred Contact": t("preferred_contact"), "Notes": t("notes"),
      "Gemach": link("gemach_id", "Gemachs"),
      "Gemach Slug": gemachSlug(),
    },
  },
  "Requests": {
    sql: "requests",
    scoped: true,
    fields: {
      "Request ID": t("request_id"), "Name": t("name"), "Phone": t("phone"), "Email": t("email"),
      "Preferred Contact": t("preferred_contact"),
      "Items Requested": links("request_item_types", "Item Types"),
      "Needed From": d("needed_from"), "Needed Until": d("needed_until"), "Open-ended duration": b("open_ended"),
      "Notes": t("notes"), "Status": t("status"),
      "Gemach": link("gemach_id", "Gemachs"),
      "Request Type": t("request_type"), "Event Date": d("event_date"),
      "Preferred Times": t("preferred_times"), "Party Size": n("party_size"),
      "Appointment At": dt("appointment_at"), "Deposit Acknowledged": b("deposit_acknowledged"),
      "Item Quantities": t("item_quantities"),
      "Received At": calc("received_at", "r.created_at"),
      "Gemach Slug": gemachSlug(),
    },
  },
  "Loans": {
    sql: "loans",
    scoped: true,
    fields: {
      "Loan ID": t("loan_id"),
      "Item": link("item_id", "Items"),
      "Item to Reserve": link("item_to_reserve_id", "Item Types"),
      "Borrower": link("borrower_id", "Borrowers"),
      "Status": t("status"),
      "Date Borrowed": d("date_borrowed"), "Expected Return": d("expected_return"), "Date Returned": d("date_returned"),
      "Reservation Start": d("reservation_start"), "Reservation End": d("reservation_end"),
      "Notes": t("notes"), "Items": t("items_text"),
      "Gemach": link("gemach_id", "Gemachs"),
      "Source Request": link("source_request_id", "Requests"),
      "Quantity": n("quantity"), "Quantity Returned": n("quantity_returned"),
      "Ready To Return At": dt("ready_to_return_at"),
      "Reminder Sent At": dt("reminder_sent_at"), "Reminder Sent Via": t("reminder_sent_via"),
      "Item Type (from Item)": calc("item_type_from_item", "(SELECT i.item_type_id FROM items i WHERE i.id = r.item_id)", { array: true }),
      "Request Note": calc("request_note", "(SELECT q.notes FROM requests q WHERE q.id = r.source_request_id)", { array: true }),
      "Gemach Slug": gemachSlug(),
    },
  },
  "Activity Log": {
    sql: "activity_log",
    airtableIds: ["tblC3PY7f5sXQDMJK"],
    scoped: true,
    fields: {
      "Timestamp": dt("timestamp"), "Event Type": t("event_type"),
      "Item Code": t("item_code"), "Item Type": t("item_type"), "Borrower": t("borrower"),
      "Loan ID": t("loan_id"), "Admin": t("admin"), "Notes": t("notes"),
      "Gemach": link("gemach_id", "Gemachs"),
      "Gemach Slug": gemachSlug(),
    },
  },
  "Search Log": {
    sql: "search_log",
    airtableIds: ["tblpy91cyNSkKx1NL"],
    fields: {
      "Query": t("query"), "Count": n("count"), "Last Outcome": t("last_outcome"),
      "Nothing Found Count": n("nothing_found_count"), "All On Loan Count": n("all_on_loan_count"),
      "Category": t("category"), "First Searched": dt("first_searched"), "Last Searched": dt("last_searched"),
    },
  },
};

// Indexes: everything the public cache rebuilds and admin lists filter or join on.
const INDEXES = [
  "CREATE UNIQUE INDEX IF NOT EXISTS gemachs_slug ON gemachs(slug) WHERE slug IS NOT NULL AND slug != ''",
  "CREATE INDEX IF NOT EXISTS gemachs_community ON gemachs(community_id)",
  "CREATE INDEX IF NOT EXISTS admins_email ON admins(lower(email))",
  "CREATE INDEX IF NOT EXISTS item_types_gemach ON item_types(gemach_id, display_order)",
  "CREATE INDEX IF NOT EXISTS item_types_category ON item_types(product_category_id)",
  "CREATE INDEX IF NOT EXISTS items_gemach ON items(gemach_id)",
  "CREATE INDEX IF NOT EXISTS items_type ON items(item_type_id)",
  "CREATE INDEX IF NOT EXISTS borrowers_gemach ON borrowers(gemach_id)",
  "CREATE INDEX IF NOT EXISTS borrowers_phone ON borrowers(gemach_id, phone_digits)",
  "CREATE INDEX IF NOT EXISTS requests_gemach_status ON requests(gemach_id, status)",
  "CREATE INDEX IF NOT EXISTS requests_gemach_created ON requests(gemach_id, created_at)",
  "CREATE INDEX IF NOT EXISTS loans_gemach_status ON loans(gemach_id, status)",
  "CREATE INDEX IF NOT EXISTS loans_item ON loans(item_id, status)",
  "CREATE INDEX IF NOT EXISTS loans_reserve ON loans(item_to_reserve_id)",
  "CREATE INDEX IF NOT EXISTS loans_source ON loans(source_request_id)",
  "CREATE INDEX IF NOT EXISTS loans_borrower ON loans(borrower_id)",
  "CREATE INDEX IF NOT EXISTS activity_gemach_time ON activity_log(gemach_id, timestamp)",
  "CREATE UNIQUE INDEX IF NOT EXISTS search_log_query ON search_log(query)",
  "CREATE INDEX IF NOT EXISTS search_log_last ON search_log(last_searched)",
];

// Table lookup by the name the worker uses (Airtable table name or table id).
const BY_NAME = {};
for (const [name, spec] of Object.entries(TABLES)) {
  spec.name = name;
  BY_NAME[name] = spec;
  for (const id of spec.airtableIds || []) BY_NAME[id] = spec;
}
const tableSpec = name => {
  const spec = BY_NAME[name];
  if (!spec) throw new Error(`unknown table: ${name}`);
  return spec;
};
const viewName = spec => `${spec.sql}_v`;
/** The view column holding a links field's ids (JSON array, in order). */
const linksCol = f => `${f.join}_ids`;

const SQL_TYPE = { text: "TEXT", num: "REAL", bool: "INTEGER", date: "TEXT", datetime: "TEXT", phone: "TEXT", link: "TEXT" };

/** The full schema.sql text (tables, join tables, views, indexes). Deterministic. */
function schemaSql() {
  const out = [
    "-- Gemach Network D1 schema. GENERATED from worker/src/dbschema.js by `npm run schema` — don't edit by hand.",
    "-- Apply with: npx wrangler d1 execute <database> --remote --file=schema.sql",
    "",
  ];
  const joins = [];
  for (const spec of Object.values(TABLES)) {
    const cols = ["  id TEXT PRIMARY KEY", "  created_at TEXT NOT NULL"];
    for (const [fname, f] of Object.entries(spec.fields)) {
      if (f.kind === "calc") continue;
      if (f.kind === "links") { joins.push({ owner: spec, f, fname }); continue; }
      const ref = f.kind === "link" ? ` REFERENCES ${tableSpec(f.to).sql}(id) ON DELETE SET NULL` : "";
      cols.push(`  ${f.col} ${SQL_TYPE[f.kind]}${ref}${f.kind === "bool" ? " NOT NULL DEFAULT 0" : ""}  -- ${fname}`);
      if (f.kind === "phone") cols.push(`  ${f.col}_digits TEXT  -- digits of ${fname}, kept by the worker`);
    }
    // Comments go after the comma so the generated SQL stays valid.
    const body = cols.map((c, i) => {
      const last = i === cols.length - 1;
      const m = c.match(/^(.*?)(  -- .*)?$/);
      return `${m[1]}${last ? "" : ","}${m[2] || ""}`;
    });
    out.push(`CREATE TABLE IF NOT EXISTS ${spec.sql} (`, ...body, ");", "");
  }
  for (const { owner, f, fname } of joins) {
    const target = tableSpec(f.to);
    out.push(`-- ${owner.name}.${fname} (several links, in order)`);
    out.push(`CREATE TABLE IF NOT EXISTS ${f.join} (`,
      `  owner_id TEXT NOT NULL REFERENCES ${owner.sql}(id) ON DELETE CASCADE,`,
      `  target_id TEXT NOT NULL REFERENCES ${target.sql}(id) ON DELETE CASCADE,`,
      "  pos INTEGER NOT NULL,",
      "  PRIMARY KEY (owner_id, target_id)",
      ");",
      `CREATE INDEX IF NOT EXISTS ${f.join}_target ON ${f.join}(target_id);`, "");
  }
  for (const spec of Object.values(TABLES)) {
    const extra = ["r.rowid AS _seq"];
    for (const f of Object.values(spec.fields)) {
      if (f.kind === "calc") extra.push(`${f.sql} AS ${f.col}`);
      if (f.kind === "links") extra.push(`(SELECT json_group_array(j.target_id) FROM (SELECT target_id FROM ${f.join} WHERE owner_id = r.id ORDER BY pos) j) AS ${linksCol(f)}`);
    }
    out.push(`DROP VIEW IF EXISTS ${viewName(spec)};`);
    out.push(`CREATE VIEW ${viewName(spec)} AS SELECT r.*${extra.map(e => `,\n  ${e}`).join("")}\nFROM ${spec.sql} r;`, "");
  }
  for (const ix of INDEXES) out.push(ix + ";");
  return out.join("\n") + "\n";
}

export { TABLES, INDEXES, tableSpec, viewName, linksCol, schemaSql };
