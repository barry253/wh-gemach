-- Gemach Network D1 schema. GENERATED from worker/src/dbschema.js by `npm run schema` — don't edit by hand.
-- Apply with: npx wrangler d1 execute <database> --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,  -- Name
  city TEXT,  -- City
  state TEXT,  -- State
  latitude REAL,  -- Latitude
  longitude REAL,  -- Longitude
  active INTEGER NOT NULL DEFAULT 0  -- Active
);

CREATE TABLE IF NOT EXISTS product_categories (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,  -- Name
  icon TEXT,  -- Icon
  keywords TEXT,  -- Keywords
  display_order REAL,  -- Display Order
  active INTEGER NOT NULL DEFAULT 0  -- Active
);

CREATE TABLE IF NOT EXISTS gemachs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,  -- Name
  community_id TEXT REFERENCES communities(id) ON DELETE SET NULL,  -- Community
  slug TEXT,  -- Slug
  description TEXT,  -- Description
  tagline TEXT,  -- Tagline
  phone TEXT,  -- Phone
  email TEXT,  -- Email
  whatsapp TEXT,  -- WhatsApp
  website TEXT,  -- Website
  donation_url TEXT,  -- Donation URL
  donation_info TEXT,  -- Donation Info
  category TEXT,  -- Category
  active INTEGER NOT NULL DEFAULT 0,  -- Active
  coming_soon INTEGER NOT NULL DEFAULT 0,  -- Coming Soon
  mode TEXT,  -- Mode
  display_order REAL,  -- Display Order
  pickup_address TEXT,  -- Pickup Address
  pickup_instructions TEXT,  -- Pickup Instructions
  hours TEXT,  -- Hours
  primary_contact TEXT,  -- Primary Contact
  secondary_contact TEXT,  -- Secondary Contact
  logo_url TEXT,  -- Logo URL
  logo_on_dark_url TEXT,  -- Logo On Dark URL
  theme_color TEXT,  -- Theme Color
  accent_color TEXT,  -- Accent Color
  deposit_required INTEGER NOT NULL DEFAULT 0,  -- Deposit Required
  charge_type TEXT,  -- Charge Type
  deposit_info TEXT,  -- Deposit Info
  gemach_info TEXT,  -- Gemach Info
  request_style TEXT,  -- Request Style
  event_label TEXT,  -- Event Label
  pickup_days_before REAL,  -- Pickup Days Before
  return_days_after REAL,  -- Return Days After
  shabbos_adjust INTEGER NOT NULL DEFAULT 0,  -- Shabbos Adjust
  default_loan_days REAL,  -- Default Loan Days
  confirm_message TEXT,  -- Confirm Message
  decline_message TEXT,  -- Decline Message
  pickup_message TEXT,  -- Pickup Message
  appointment_message TEXT,  -- Appointment Message
  return_reminder_message TEXT,  -- Return Reminder Message
  auto_reminders INTEGER NOT NULL DEFAULT 0,  -- Auto Reminders
  reminder_days_before REAL,  -- Reminder Days Before
  reminder_repeat_days REAL,  -- Reminder Repeat Days
  item_attributes TEXT,  -- Item Attributes
  item_view TEXT,  -- Item View
  onboarding TEXT  -- Onboarding
);

CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,  -- Name
  email TEXT,  -- Email
  phone TEXT,  -- Phone
  role TEXT,  -- Role
  active INTEGER NOT NULL DEFAULT 0,  -- Active
  last_active TEXT  -- Last Active
);

CREATE TABLE IF NOT EXISTS item_types (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,  -- Name
  description TEXT,  -- Description
  display_order REAL,  -- Display Order
  active INTEGER NOT NULL DEFAULT 0,  -- Active
  r2_photo_url TEXT,  -- R2 Photo URL
  more_photos TEXT,  -- More Photos
  gemach_id TEXT REFERENCES gemachs(id) ON DELETE SET NULL,  -- Gemach
  product_category_id TEXT REFERENCES product_categories(id) ON DELETE SET NULL,  -- Product Category
  tracking TEXT,  -- Tracking
  quantity_owned REAL,  -- Quantity Owned
  out_of_service REAL,  -- Out of Service
  price REAL,  -- Price
  attributes TEXT,  -- Attributes
  package_size REAL,  -- Package Size
  package_unit TEXT  -- Package Unit
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  item_id TEXT,  -- Item ID
  item_type_id TEXT REFERENCES item_types(id) ON DELETE SET NULL,  -- Item Type
  condition TEXT,  -- Condition
  notes TEXT,  -- Notes
  active INTEGER NOT NULL DEFAULT 0,  -- Active
  gemach_id TEXT REFERENCES gemachs(id) ON DELETE SET NULL  -- Gemach
);

CREATE TABLE IF NOT EXISTS borrowers (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT,  -- Name
  phone TEXT,  -- Phone
  phone_digits TEXT,  -- digits of Phone, kept by the worker
  email TEXT,  -- Email
  preferred_contact TEXT,  -- Preferred Contact
  notes TEXT,  -- Notes
  gemach_id TEXT REFERENCES gemachs(id) ON DELETE SET NULL  -- Gemach
);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  request_id TEXT,  -- Request ID
  name TEXT,  -- Name
  phone TEXT,  -- Phone
  email TEXT,  -- Email
  preferred_contact TEXT,  -- Preferred Contact
  needed_from TEXT,  -- Needed From
  needed_until TEXT,  -- Needed Until
  open_ended INTEGER NOT NULL DEFAULT 0,  -- Open-ended duration
  notes TEXT,  -- Notes
  status TEXT,  -- Status
  gemach_id TEXT REFERENCES gemachs(id) ON DELETE SET NULL,  -- Gemach
  request_type TEXT,  -- Request Type
  event_date TEXT,  -- Event Date
  preferred_times TEXT,  -- Preferred Times
  party_size REAL,  -- Party Size
  appointment_at TEXT,  -- Appointment At
  deposit_acknowledged INTEGER NOT NULL DEFAULT 0,  -- Deposit Acknowledged
  item_quantities TEXT,  -- Item Quantities
  visit_outcome TEXT,  -- Visit Outcome
  visited_at TEXT,  -- Visited At
  source TEXT,  -- Source
  test INTEGER NOT NULL DEFAULT 0  -- Test
);

CREATE TABLE IF NOT EXISTS loans (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  loan_id TEXT,  -- Loan ID
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,  -- Item
  item_to_reserve_id TEXT REFERENCES item_types(id) ON DELETE SET NULL,  -- Item to Reserve
  borrower_id TEXT REFERENCES borrowers(id) ON DELETE SET NULL,  -- Borrower
  status TEXT,  -- Status
  date_borrowed TEXT,  -- Date Borrowed
  expected_return TEXT,  -- Expected Return
  date_returned TEXT,  -- Date Returned
  reservation_start TEXT,  -- Reservation Start
  reservation_end TEXT,  -- Reservation End
  notes TEXT,  -- Notes
  items_text TEXT,  -- Items
  gemach_id TEXT REFERENCES gemachs(id) ON DELETE SET NULL,  -- Gemach
  source_request_id TEXT REFERENCES requests(id) ON DELETE SET NULL,  -- Source Request
  quantity REAL,  -- Quantity
  quantity_returned REAL,  -- Quantity Returned
  ready_to_return_at TEXT,  -- Ready To Return At
  reminder_sent_at TEXT,  -- Reminder Sent At
  reminder_sent_via TEXT  -- Reminder Sent Via
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  timestamp TEXT,  -- Timestamp
  event_type TEXT,  -- Event Type
  item_code TEXT,  -- Item Code
  item_type TEXT,  -- Item Type
  borrower TEXT,  -- Borrower
  loan_id TEXT,  -- Loan ID
  admin TEXT,  -- Admin
  notes TEXT,  -- Notes
  gemach_id TEXT REFERENCES gemachs(id) ON DELETE SET NULL  -- Gemach
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  admin_id TEXT REFERENCES admins(id) ON DELETE SET NULL,  -- Admin
  endpoint TEXT,  -- Endpoint
  keys TEXT,  -- Keys
  device TEXT,  -- Device
  events TEXT,  -- Events
  gemach_filter TEXT,  -- Gemach Filter
  last_sent_at TEXT,  -- Last Sent At
  failures REAL,  -- Failures
  last_error TEXT  -- Last Error
);

CREATE TABLE IF NOT EXISTS search_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  query TEXT,  -- Query
  count REAL,  -- Count
  last_outcome TEXT,  -- Last Outcome
  nothing_found_count REAL,  -- Nothing Found Count
  all_on_loan_count REAL,  -- All On Loan Count
  category TEXT,  -- Category
  first_searched TEXT,  -- First Searched
  last_searched TEXT  -- Last Searched
);

-- Gemachs.Browse Categories (several links, in order)
CREATE TABLE IF NOT EXISTS gemach_browse_categories (
  owner_id TEXT NOT NULL REFERENCES gemachs(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  PRIMARY KEY (owner_id, target_id)
);
CREATE INDEX IF NOT EXISTS gemach_browse_categories_target ON gemach_browse_categories(target_id);

-- Admins.Gemachs (several links, in order)
CREATE TABLE IF NOT EXISTS admin_gemachs (
  owner_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES gemachs(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  PRIMARY KEY (owner_id, target_id)
);
CREATE INDEX IF NOT EXISTS admin_gemachs_target ON admin_gemachs(target_id);

-- Requests.Items Requested (several links, in order)
CREATE TABLE IF NOT EXISTS request_item_types (
  owner_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES item_types(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL,
  PRIMARY KEY (owner_id, target_id)
);
CREATE INDEX IF NOT EXISTS request_item_types_target ON request_item_types(target_id);

DROP VIEW IF EXISTS communities_v;
CREATE VIEW communities_v AS SELECT r.*,
  r.rowid AS _seq
FROM communities r;

DROP VIEW IF EXISTS product_categories_v;
CREATE VIEW product_categories_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT json_group_array(x.id) FROM (SELECT id FROM item_types WHERE product_category_id = r.id ORDER BY rowid) x) AS item_type_ids
FROM product_categories r;

DROP VIEW IF EXISTS gemachs_v;
CREATE VIEW gemachs_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT json_group_array(j.target_id) FROM (SELECT target_id FROM gemach_browse_categories WHERE owner_id = r.id ORDER BY pos) j) AS gemach_browse_categories_ids,
  (SELECT json_group_array(i.id) FROM (SELECT id FROM items WHERE gemach_id = r.id ORDER BY rowid) i) AS item_ids
FROM gemachs r;

DROP VIEW IF EXISTS admins_v;
CREATE VIEW admins_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT json_group_array(j.target_id) FROM (SELECT target_id FROM admin_gemachs WHERE owner_id = r.id ORDER BY pos) j) AS admin_gemachs_ids
FROM admins r;

DROP VIEW IF EXISTS item_types_v;
CREATE VIEW item_types_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id) AS gemach_slug,
  (SELECT json_group_array(i.id) FROM (SELECT id FROM items WHERE item_type_id = r.id ORDER BY rowid) i) AS item_ids
FROM item_types r;

DROP VIEW IF EXISTS items_v;
CREATE VIEW items_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id) AS gemach_slug,
  (CASE WHEN EXISTS (SELECT 1 FROM loans l WHERE l.item_id = r.id AND l.status = 'Active') THEN 'On Loan' WHEN EXISTS (SELECT 1 FROM loans l WHERE l.item_id = r.id AND l.status = 'Reserved') THEN 'Reserved' ELSE 'Available' END) AS status,
  (SELECT json_group_array(s.status) FROM (SELECT status FROM loans WHERE item_id = r.id AND status IS NOT NULL ORDER BY rowid) s) AS loan_statuses
FROM items r;

DROP VIEW IF EXISTS borrowers_v;
CREATE VIEW borrowers_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id) AS gemach_slug
FROM borrowers r;

DROP VIEW IF EXISTS requests_v;
CREATE VIEW requests_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT json_group_array(j.target_id) FROM (SELECT target_id FROM request_item_types WHERE owner_id = r.id ORDER BY pos) j) AS request_item_types_ids,
  r.created_at AS received_at,
  (SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id) AS gemach_slug
FROM requests r;

DROP VIEW IF EXISTS loans_v;
CREATE VIEW loans_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT i.item_type_id FROM items i WHERE i.id = r.item_id) AS item_type_from_item,
  (SELECT q.notes FROM requests q WHERE q.id = r.source_request_id) AS request_note,
  (SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id) AS gemach_slug
FROM loans r;

DROP VIEW IF EXISTS activity_log_v;
CREATE VIEW activity_log_v AS SELECT r.*,
  r.rowid AS _seq,
  (SELECT g.slug FROM gemachs g WHERE g.id = r.gemach_id) AS gemach_slug
FROM activity_log r;

DROP VIEW IF EXISTS push_subscriptions_v;
CREATE VIEW push_subscriptions_v AS SELECT r.*,
  r.rowid AS _seq
FROM push_subscriptions r;

DROP VIEW IF EXISTS search_log_v;
CREATE VIEW search_log_v AS SELECT r.*,
  r.rowid AS _seq
FROM search_log r;

CREATE UNIQUE INDEX IF NOT EXISTS gemachs_slug ON gemachs(slug) WHERE slug IS NOT NULL AND slug != '';
CREATE INDEX IF NOT EXISTS gemachs_community ON gemachs(community_id);
CREATE INDEX IF NOT EXISTS admins_email ON admins(lower(email));
CREATE INDEX IF NOT EXISTS item_types_gemach ON item_types(gemach_id, display_order);
CREATE INDEX IF NOT EXISTS item_types_category ON item_types(product_category_id);
CREATE INDEX IF NOT EXISTS items_gemach ON items(gemach_id);
CREATE INDEX IF NOT EXISTS items_type ON items(item_type_id);
CREATE INDEX IF NOT EXISTS borrowers_gemach ON borrowers(gemach_id);
CREATE INDEX IF NOT EXISTS borrowers_phone ON borrowers(gemach_id, phone_digits);
CREATE INDEX IF NOT EXISTS requests_gemach_status ON requests(gemach_id, status);
CREATE INDEX IF NOT EXISTS requests_gemach_created ON requests(gemach_id, created_at);
CREATE INDEX IF NOT EXISTS loans_gemach_status ON loans(gemach_id, status);
CREATE INDEX IF NOT EXISTS loans_item ON loans(item_id, status);
CREATE INDEX IF NOT EXISTS loans_reserve ON loans(item_to_reserve_id);
CREATE INDEX IF NOT EXISTS loans_source ON loans(source_request_id);
CREATE INDEX IF NOT EXISTS loans_borrower ON loans(borrower_id);
CREATE INDEX IF NOT EXISTS activity_gemach_time ON activity_log(gemach_id, timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS search_log_query ON search_log(query);
CREATE INDEX IF NOT EXISTS search_log_last ON search_log(last_searched);
CREATE UNIQUE INDEX IF NOT EXISTS push_endpoint ON push_subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS push_admin ON push_subscriptions(admin_id);
