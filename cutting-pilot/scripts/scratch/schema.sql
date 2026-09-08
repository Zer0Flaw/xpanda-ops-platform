PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE completions (   id INTEGER PRIMARY KEY AUTOINCREMENT,   employee_name TEXT NOT NULL,   block_id TEXT NOT NULL,   block_title TEXT NOT NULL,   attested INTEGER NOT NULL DEFAULT 0,   submitted_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),    ip_hash TEXT,   user_agent TEXT,    submitted_date TEXT     GENERATED ALWAYS AS (date(submitted_at)) STORED );
CREATE TABLE scrap_log (   id TEXT PRIMARY KEY,   event_date TEXT NOT NULL,   week_number INTEGER NOT NULL,   month_name TEXT NOT NULL,   shift TEXT NOT NULL,   operator_name TEXT NOT NULL,   line_machine TEXT NOT NULL,   inv_number TEXT NOT NULL,   part_product TEXT NOT NULL,   material_density TEXT NOT NULL,   scrap_reason TEXT NOT NULL,   notes TEXT,   scrap_cubic_in REAL NOT NULL,   scrap_board_ft REAL NOT NULL,   created_at TEXT NOT NULL );
CREATE TABLE saved_combos (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', block_l REAL NOT NULL, block_w REAL NOT NULL, block_h REAL NOT NULL, kerf REAL NOT NULL DEFAULT 0.079, orientation_mode TEXT NOT NULL DEFAULT 'auto', machines_active TEXT NOT NULL DEFAULT '["cross_cutter","main_line","blue_line"]', primary_part_id TEXT, primary_part_snapshot TEXT NOT NULL, secondary_parts_snapshot TEXT NOT NULL DEFAULT '[]', result_snapshot TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'not_started',
  customer TEXT NOT NULL,
  po_number TEXT NOT NULL DEFAULT '',
  invoice_number TEXT NOT NULL DEFAULT '',
  ship_date TEXT NOT NULL DEFAULT '',
  ship_day TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  delivery_time TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT '',
  load_count INTEGER NOT NULL DEFAULT 1,
  total_bdft REAL NOT NULL DEFAULT 0,
  scrap_pickup TEXT NOT NULL DEFAULT '',
  sales_lead TEXT NOT NULL DEFAULT '',
  bol_info TEXT NOT NULL DEFAULT '',
  payment_info TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  packing_instructions TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  combo_id TEXT DEFAULT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  confirmed_to_ship INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, processes TEXT NOT NULL DEFAULT '[]', packing_slip_pdf TEXT DEFAULT NULL, packing_slip_filename TEXT NOT NULL DEFAULT '', packing_slip_invoice TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'manual', ship_to_company TEXT NOT NULL DEFAULT '', ship_to_attention TEXT NOT NULL DEFAULT '', ship_to_street TEXT NOT NULL DEFAULT '', ship_to_street2 TEXT NOT NULL DEFAULT '', ship_to_city TEXT NOT NULL DEFAULT '', ship_to_state TEXT NOT NULL DEFAULT '', ship_to_zip TEXT NOT NULL DEFAULT '', packing_slip_key TEXT, priority_level INTEGER NOT NULL DEFAULT 0, ship_to_verified     TEXT NOT NULL DEFAULT 'unverified', ship_to_standardized TEXT, ship_to_verified_at  TEXT, archived_at TEXT, trailer_group_id TEXT, cutting_instructions TEXT, hb_chunks_required INTEGER, hb_chunk_breakdown TEXT);
CREATE TABLE job_line_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  part_id TEXT DEFAULT NULL,
  part_number TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 0,
  dimensions TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0, density TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
);
CREATE TABLE bead_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  grade TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE silos (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bead_type_id TEXT DEFAULT NULL,
  capacity_lbs REAL NOT NULL DEFAULT 0,
  current_lbs REAL NOT NULL DEFAULT 0,
  reorder_point_lbs REAL NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bead_type_id) REFERENCES bead_types(id) ON DELETE SET NULL
);
CREATE TABLE bead_transactions (
  id TEXT PRIMARY KEY,
  silo_id TEXT NOT NULL,
  bead_type_id TEXT DEFAULT NULL,
  type TEXT NOT NULL,
  quantity_lbs REAL NOT NULL,
  job_id TEXT DEFAULT NULL,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (silo_id) REFERENCES silos(id) ON DELETE CASCADE,
  FOREIGN KEY (bead_type_id) REFERENCES bead_types(id) ON DELETE SET NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE TABLE shipments (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  job_id TEXT DEFAULT NULL,
  customer TEXT NOT NULL DEFAULT '',
  carrier TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  bol_number TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  ship_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  total_bdft REAL NOT NULL DEFAULT 0,
  load_count INTEGER NOT NULL DEFAULT 1,
  weight_lbs REAL NOT NULL DEFAULT 0,
  bead_type TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), trailer_number TEXT NOT NULL DEFAULT '', delivery_accepted TEXT, delivery_damages INTEGER DEFAULT 0, delivery_damage_notes TEXT, delivery_recorded_at TEXT, delivery_source TEXT, in_transit_at TEXT, delivered_at TEXT, delivery_incident INTEGER DEFAULT 0, delivery_incident_notes TEXT, delivery_time TEXT DEFAULT '', scrap_pickup  TEXT DEFAULT '',
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);
CREATE TABLE bol_customers (     id TEXT PRIMARY KEY,     company TEXT NOT NULL,     attention TEXT NOT NULL DEFAULT '',     street TEXT NOT NULL DEFAULT '',     street2 TEXT NOT NULL DEFAULT '',     city TEXT NOT NULL DEFAULT '',     state TEXT NOT NULL DEFAULT '',     zip TEXT NOT NULL DEFAULT '',     phone TEXT NOT NULL DEFAULT '',     email TEXT NOT NULL DEFAULT '',     contact_name TEXT NOT NULL DEFAULT '',     notes TEXT NOT NULL DEFAULT '',     is_active INTEGER NOT NULL DEFAULT 1,     created_at TEXT NOT NULL DEFAULT (datetime('now')),     updated_at TEXT NOT NULL DEFAULT (datetime('now'))   );
CREATE TABLE bol_carriers (     id TEXT PRIMARY KEY,     name TEXT NOT NULL,     scac TEXT NOT NULL DEFAULT '',     phone TEXT NOT NULL DEFAULT '',     is_active INTEGER NOT NULL DEFAULT 1,     created_at TEXT NOT NULL DEFAULT (datetime('now'))   );
CREATE TABLE parts (     id TEXT PRIMARY KEY,     part_number TEXT NOT NULL,     name TEXT NOT NULL DEFAULT '',     customer TEXT NOT NULL DEFAULT '',     density_material TEXT NOT NULL DEFAULT '',     length_in REAL NOT NULL,     width_in REAL NOT NULL,     height_in REAL NOT NULL,     weight REAL NOT NULL DEFAULT 1,     notes TEXT NOT NULL DEFAULT '',     color TEXT NOT NULL DEFAULT '#D97706',     allow_rotation INTEGER NOT NULL DEFAULT 0,     sort_order INTEGER NOT NULL DEFAULT 0,     category TEXT NOT NULL DEFAULT '',     parent_group TEXT NOT NULL DEFAULT '',     created_at TEXT NOT NULL DEFAULT (datetime('now')),     updated_at TEXT NOT NULL DEFAULT (datetime('now'))   , bundle_qty INTEGER NOT NULL DEFAULT 0);
CREATE TABLE activity_log (   id TEXT PRIMARY KEY,   timestamp TEXT NOT NULL DEFAULT (datetime('now')),   action TEXT NOT NULL,   entity_type TEXT NOT NULL,   entity_id TEXT NOT NULL DEFAULT '',   summary TEXT NOT NULL DEFAULT '',   detail TEXT NOT NULL DEFAULT '',   created_at TEXT NOT NULL DEFAULT (datetime('now')) , user_id TEXT DEFAULT NULL);
CREATE TABLE users (   id TEXT PRIMARY KEY,   username TEXT NOT NULL UNIQUE COLLATE NOCASE,   display_name TEXT NOT NULL DEFAULT '',   password TEXT NOT NULL DEFAULT '',   role TEXT NOT NULL DEFAULT 'staff',   is_active INTEGER NOT NULL DEFAULT 1,   first_login INTEGER NOT NULL DEFAULT 1,   created_at TEXT NOT NULL DEFAULT (datetime('now')),   updated_at TEXT NOT NULL DEFAULT (datetime('now')) , role_id TEXT DEFAULT NULL, shift TEXT);
CREATE TABLE sessions (   id TEXT PRIMARY KEY,   user_id TEXT NOT NULL,   expires_at TEXT NOT NULL,   created_at TEXT NOT NULL DEFAULT (datetime('now')), simulating_role_id TEXT DEFAULT NULL,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, notification_types TEXT NOT NULL DEFAULT '[]');
CREATE TABLE saved_loads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  job_id TEXT DEFAULT NULL,
  customer TEXT NOT NULL DEFAULT '',
  trailer_type TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days'))
);
CREATE TABLE IF NOT EXISTS "bols" (   id TEXT PRIMARY KEY,   bol_number TEXT DEFAULT NULL,   date TEXT NOT NULL,   customer_id TEXT DEFAULT NULL,   ship_to_company TEXT NOT NULL DEFAULT '',   ship_to_attention TEXT NOT NULL DEFAULT '',   ship_to_street TEXT NOT NULL DEFAULT '',   ship_to_street2 TEXT NOT NULL DEFAULT '',   ship_to_city TEXT NOT NULL DEFAULT '',   ship_to_state TEXT NOT NULL DEFAULT '',   ship_to_zip TEXT NOT NULL DEFAULT '',   location_no TEXT NOT NULL DEFAULT '',   carrier_id TEXT DEFAULT NULL,   carrier_name TEXT NOT NULL DEFAULT '',   trailer_no TEXT NOT NULL DEFAULT '',   seal_number TEXT NOT NULL DEFAULT '',   scac TEXT NOT NULL DEFAULT '',   pro_no TEXT NOT NULL DEFAULT '',   freight_terms TEXT NOT NULL DEFAULT 'prepaid',   is_scrap_pickup INTEGER NOT NULL DEFAULT 0,   third_party_bill_to TEXT NOT NULL DEFAULT '',   special_instructions TEXT NOT NULL DEFAULT '',   contact_info TEXT NOT NULL DEFAULT '',   is_master_bol INTEGER NOT NULL DEFAULT 0,   commodity_description TEXT NOT NULL DEFAULT '',   handling_unit_qty TEXT NOT NULL DEFAULT '',   handling_unit_type TEXT NOT NULL DEFAULT '',   package_qty TEXT NOT NULL DEFAULT '',   package_type TEXT NOT NULL DEFAULT '',   weight TEXT NOT NULL DEFAULT '',   delivery_time TEXT NOT NULL DEFAULT '',   job_id TEXT DEFAULT NULL,   notes TEXT NOT NULL DEFAULT '',   created_at TEXT NOT NULL DEFAULT (datetime('now')) , render_overrides TEXT, access_token TEXT, signed_bol_photo_key TEXT, signed_bol_uploaded_at TEXT, po_number TEXT, shipper_name TEXT NOT NULL DEFAULT '', bol_group_id TEXT, load_number INTEGER, load_count INTEGER, siplast INTEGER DEFAULT 0, signed_bol_additional_info TEXT);
CREATE TABLE user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (role_id) REFERENCES roles(id)
);
CREATE TABLE loading_bays (
  id TEXT PRIMARY KEY,
  bay_number INTEGER NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  trailer_number TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE loading_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  bay_id TEXT DEFAULT NULL,
  trailer_number TEXT NOT NULL DEFAULT '',
  loading_status TEXT NOT NULL DEFAULT 'awaiting',
  assigned_by TEXT DEFAULT NULL,
  started_at TEXT DEFAULT NULL,
  loaded_at TEXT DEFAULT NULL,
  in_transit_at TEXT DEFAULT NULL,
  delivered_at TEXT DEFAULT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), ready_checklist TEXT DEFAULT NULL, load_number INTEGER NOT NULL DEFAULT 1, location TEXT DEFAULT 'bay', ship_date TEXT,
  FOREIGN KEY (job_id) REFERENCES jobs(id),
  FOREIGN KEY (bay_id) REFERENCES loading_bays(id)
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL DEFAULT '',
  auth_key TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE loading_photos (   id TEXT PRIMARY KEY,   assignment_id TEXT NOT NULL,   job_id TEXT NOT NULL,   photo_data TEXT NOT NULL,   filename TEXT NOT NULL DEFAULT '',   uploaded_by TEXT DEFAULT NULL,   created_at TEXT NOT NULL DEFAULT (datetime('now')), photo_key TEXT,   FOREIGN KEY (assignment_id) REFERENCES loading_assignments(id),   FOREIGN KEY (job_id) REFERENCES jobs(id) );
CREATE TABLE bol_documents (     id         TEXT PRIMARY KEY,     bol_id     TEXT NOT NULL,     doc_type   TEXT NOT NULL,     r2_key     TEXT NOT NULL,     created_at TEXT NOT NULL   );
CREATE TABLE cutting_lines (   id           TEXT PRIMARY KEY,   job_id       TEXT NOT NULL,   line         TEXT NOT NULL,                                 line_status  TEXT NOT NULL DEFAULT 'not_started',           qty_target   INTEGER DEFAULT NULL,                           qty_done     INTEGER DEFAULT NULL,                           sort_order   INTEGER NOT NULL DEFAULT 0,   created_at   TEXT NOT NULL DEFAULT (datetime('now')),   updated_at   TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE TABLE cutting_sessions (   id             TEXT PRIMARY KEY,   job_id         TEXT NOT NULL,   line           TEXT NOT NULL,   operator_id    TEXT NOT NULL,   operator_name  TEXT NOT NULL DEFAULT '',   status         TEXT NOT NULL DEFAULT 'open',                started_at     TEXT NOT NULL DEFAULT (datetime('now')),   ended_at       TEXT DEFAULT NULL,   handoff_note   TEXT NOT NULL DEFAULT '',                    qty_done_delta INTEGER DEFAULT NULL,   created_at     TEXT NOT NULL DEFAULT (datetime('now')) , photo_key TEXT DEFAULT NULL);
CREATE TABLE cutting_line_progress (   id            TEXT PRIMARY KEY,   job_id        TEXT NOT NULL,   line          TEXT NOT NULL,   line_item_id  TEXT NOT NULL,   completed     INTEGER NOT NULL DEFAULT 0,   completed_qty INTEGER,   updated_by    TEXT,   updated_at    TEXT,   UNIQUE (job_id, line, line_item_id) );
CREATE TABLE cut_plans (   id          TEXT PRIMARY KEY,   job_id      TEXT NOT NULL,   source      TEXT NOT NULL DEFAULT 'auto',      combo_id    TEXT DEFAULT NULL,                 block_l     REAL DEFAULT NULL,                 block_w     REAL DEFAULT NULL,                 block_h     REAL DEFAULT NULL,                 kerf        REAL DEFAULT NULL,                 snapshot    TEXT DEFAULT NULL,                 created_by  TEXT DEFAULT NULL,   created_at  TEXT NOT NULL DEFAULT (datetime('now')),   updated_at  TEXT NOT NULL DEFAULT (datetime('now')) , taper_yield INTEGER, blocks_needed INTEGER);
CREATE TABLE cut_plan_lines (   id          TEXT PRIMARY KEY,   cut_plan_id TEXT NOT NULL,   job_id      TEXT NOT NULL,   line        TEXT NOT NULL,                     unit        TEXT NOT NULL DEFAULT 'part',      qty_target  INTEGER DEFAULT NULL,             taper_pair  INTEGER NOT NULL DEFAULT 0,        detail      TEXT DEFAULT NULL,                 created_at  TEXT NOT NULL DEFAULT (datetime('now')),   updated_at  TEXT NOT NULL DEFAULT (datetime('now')) , source TEXT);
CREATE TABLE cut_plan_setups (   id            TEXT PRIMARY KEY,   job_id        TEXT NOT NULL,   label         TEXT DEFAULT NULL,   block_l       REAL NOT NULL,   block_w       REAL NOT NULL,   block_h       REAL NOT NULL,   kerf          REAL NOT NULL DEFAULT 0.079,   mode          TEXT NOT NULL DEFAULT 'auto',   part_l        REAL NOT NULL,   part_w        REAL NOT NULL,   part_h        REAL NOT NULL,   qty           INTEGER DEFAULT NULL,   per_block     INTEGER DEFAULT NULL,   blocks_needed INTEGER DEFAULT NULL,   util_pct      REAL DEFAULT NULL,   sort_order    INTEGER NOT NULL DEFAULT 0,   created_at    TEXT NOT NULL DEFAULT (datetime('now')),   updated_at    TEXT NOT NULL DEFAULT (datetime('now')) );
CREATE TABLE schedule_rows (   id               INTEGER PRIMARY KEY AUTOINCREMENT,   invoice_number   TEXT    NOT NULL,              ship_week        TEXT    NOT NULL,              ship_date        TEXT,                          day_of_week      TEXT,                           sort_order       INTEGER NOT NULL DEFAULT 0,     customer         TEXT,   load_count       REAL,                           method           TEXT,                           location         TEXT,                           delivery_time    TEXT,                          carrier          TEXT,                           total_bdft       REAL,                           scrap_pickup     TEXT,                           sheet_status     TEXT,                                                                            match_job_id     TEXT,                           last_seen_at     TEXT    NOT NULL,               created_at       TEXT    NOT NULL DEFAULT (datetime('now')) );
CREATE TABLE cc_assignments (   id            TEXT PRIMARY KEY,   label         TEXT NOT NULL,   target_chunks INTEGER NOT NULL DEFAULT 0,   qty_done      INTEGER NOT NULL DEFAULT 0,   status        TEXT NOT NULL DEFAULT 'open',      sort_order    INTEGER NOT NULL DEFAULT 0,   created_by    TEXT,   created_at    TEXT NOT NULL,   completed_at  TEXT );
CREATE TABLE hc_slots (   slot_key    TEXT PRIMARY KEY,                  label       TEXT NOT NULL,   on_hand     INTEGER NOT NULL DEFAULT 0,        total_holed INTEGER NOT NULL DEFAULT 0,        updated_at  TEXT );
CREATE TABLE chunk_sessions (   id            TEXT PRIMARY KEY,   board         TEXT NOT NULL,                   ref_id        TEXT NOT NULL,                   operator_id   TEXT NOT NULL,   operator_name TEXT,   started_at    TEXT NOT NULL,   ended_at      TEXT,   status        TEXT NOT NULL DEFAULT 'open'   );
CREATE TABLE loading_board_notes (   id         TEXT PRIMARY KEY,   notes      TEXT NOT NULL DEFAULT '',   updated_at TEXT NOT NULL DEFAULT (datetime('now')),   updated_by TEXT );
CREATE TABLE job_assignments (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  assigned_by TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(job_id, user_id)
);
CREATE TABLE job_shifts (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL,
  shift       TEXT NOT NULL,          -- '1st' | '2nd' | '3rd'
  assigned_by TEXT,
  created_at  TEXT,
  UNIQUE(job_id, shift)
);
CREATE TABLE bol_email_recipients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  is_selected INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE plant_holidays (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  holiday_date TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now'))
);
CREATE TABLE shift_notes (
  id            TEXT PRIMARY KEY,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  viewed_at     TEXT,
  viewed_by_id  TEXT,
  viewed_by_name TEXT
);
CREATE TABLE employee_birthdays (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  birth_month  INTEGER NOT NULL CHECK (birth_month BETWEEN 1 AND 12),
  birth_day    INTEGER NOT NULL CHECK (birth_day BETWEEN 1 AND 31),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE production_molding_sessions (
  id           TEXT PRIMARY KEY,
  silo         INTEGER,
  log_date     TEXT NOT NULL,
  control_no   TEXT,
  operator_1   TEXT,
  operator_2   TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT
);
CREATE TABLE production_molding_blocks (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  block_no         TEXT,
  block_type       TEXT,
  block_size       TEXT,
  rc_pct_open      REAL,
  rc_speed         REAL,
  virgin_pct_open  REAL,
  virgin_speed     REAL,
  mold_time        TEXT,
  block_weight_lbs REAL,
  init_oper        TEXT,
  created_at       TEXT NOT NULL
);
CREATE TABLE production_expansion_sessions (
  id               TEXT PRIMARY KEY,
  silo             INTEGER,
  log_date         TEXT NOT NULL,
  control_no       TEXT,
  start_time       TEXT,
  finish_time      TEXT,
  density          REAL,
  target_weight_g  REAL,
  bead_type        TEXT,
  lot              TEXT,
  operator_1       TEXT,
  operator_2       TEXT,
  status           TEXT NOT NULL DEFAULT 'open',
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT
);
CREATE TABLE production_expansion_batches (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  batch_no         TEXT,
  weight_kg        REAL,
  heating_time_s   REAL,
  bucket_weight_g  REAL,
  created_at       TEXT NOT NULL
);
DELETE FROM sqlite_sequence;
CREATE UNIQUE INDEX ux_completions_employee_block_day ON completions (employee_name, block_id, submitted_date);
CREATE INDEX ix_completions_block_day ON completions (block_id, submitted_date);
CREATE INDEX ix_completions_employee ON completions (employee_name);
CREATE INDEX ix_completions_submitted_at ON completions (submitted_at);
CREATE INDEX idx_scrap_log_event_date ON scrap_log (event_date);
CREATE INDEX idx_scrap_log_week_number ON scrap_log (week_number);
CREATE INDEX idx_scrap_log_month_name ON scrap_log (month_name);
CREATE INDEX idx_scrap_log_shift ON scrap_log (shift);
CREATE INDEX idx_scrap_log_line_machine ON scrap_log (line_machine);
CREATE INDEX idx_scrap_log_scrap_reason ON scrap_log (scrap_reason);
CREATE INDEX idx_scrap_log_created_at ON scrap_log (created_at);
CREATE INDEX idx_jobs_status 
  ON jobs(status);
CREATE INDEX idx_jobs_ship_date 
  ON jobs(ship_date);
CREATE INDEX idx_jobs_customer  
  ON jobs(customer);
CREATE INDEX idx_job_items_job 
  ON job_line_items(job_id);
CREATE INDEX idx_jobs_combo_id 
ON jobs(combo_id);
CREATE UNIQUE INDEX idx_bead_types_name ON bead_types(name);
CREATE INDEX idx_bead_tx_silo ON bead_transactions(silo_id);
CREATE INDEX idx_bead_tx_type ON bead_transactions(type);
CREATE INDEX idx_bead_tx_created ON bead_transactions(created_at);
CREATE INDEX idx_bead_tx_job ON bead_transactions(job_id);
CREATE INDEX idx_shipments_direction ON shipments(direction);
CREATE INDEX idx_shipments_date ON shipments(ship_date);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_job ON shipments(job_id);
CREATE INDEX idx_bol_customers_company ON   bol_customers(company);
CREATE INDEX idx_bol_customers_active ON   bol_customers(is_active);
CREATE INDEX idx_parts_category ON parts(category);
CREATE INDEX idx_activity_log_timestamp ON activity_log(timestamp DESC);
CREATE INDEX idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX idx_activity_log_action ON activity_log(action);
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE UNIQUE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_saved_loads_expires ON saved_loads(expires_at);
CREATE INDEX idx_saved_loads_customer ON saved_loads(customer);
CREATE INDEX idx_bols_number ON bols(bol_number);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_loading_assignments_job ON loading_assignments(job_id);
CREATE INDEX idx_loading_assignments_bay ON loading_assignments(bay_id);
CREATE INDEX idx_loading_assignments_status ON loading_assignments(loading_status);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_push_subs_user ON push_subscriptions(user_id);
CREATE INDEX idx_loading_photos_assignment ON loading_photos(assignment_id);
CREATE INDEX idx_loading_photos_job ON loading_photos(job_id);
CREATE UNIQUE INDEX idx_bols_access_token ON bols(access_token) WHERE access_token IS NOT NULL;
CREATE INDEX idx_bol_documents_bol_id ON bol_documents(bol_id);
CREATE INDEX idx_bols_group ON bols (bol_group_id);
CREATE INDEX idx_cutting_lines_job ON cutting_lines(job_id);
CREATE UNIQUE INDEX idx_cutting_lines_job_line ON cutting_lines(job_id, line);
CREATE INDEX idx_cutting_sessions_job ON cutting_sessions(job_id);
CREATE INDEX idx_cutting_sessions_open ON cutting_sessions(job_id, line, status);
CREATE INDEX idx_clp_job ON cutting_line_progress (job_id);
CREATE UNIQUE INDEX idx_cut_plans_job ON cut_plans(job_id);
CREATE UNIQUE INDEX idx_cut_plan_lines_job_line ON cut_plan_lines(job_id, line);
CREATE INDEX idx_cut_plan_lines_plan ON cut_plan_lines(cut_plan_id);
CREATE INDEX idx_cut_plan_setups_job ON cut_plan_setups(job_id);
CREATE INDEX idx_schedule_rows_inv        ON schedule_rows (invoice_number);
CREATE INDEX idx_schedule_rows_ship_week  ON schedule_rows (ship_week);
CREATE INDEX idx_schedule_rows_match      ON schedule_rows (match_job_id);
CREATE INDEX idx_jobs_archived_at ON jobs (archived_at);
CREATE INDEX idx_jobs_trailer_group_id ON jobs (trailer_group_id);
CREATE INDEX idx_cutting_sessions_operator_status   ON cutting_sessions (operator_id, status);
CREATE INDEX idx_cc_assignments_active   ON cc_assignments (status, sort_order);
CREATE INDEX idx_chunk_sessions_open   ON chunk_sessions (board, ref_id, status);
CREATE INDEX idx_job_assignments_job  ON job_assignments(job_id);
CREATE INDEX idx_job_assignments_user ON job_assignments(user_id);
CREATE INDEX idx_job_shifts_job ON job_shifts(job_id);
CREATE INDEX idx_shift_notes_created  ON shift_notes (created_at DESC);
CREATE INDEX idx_shift_notes_unviewed ON shift_notes (viewed_at);
CREATE INDEX idx_pms_logdate ON production_molding_sessions(log_date);
CREATE INDEX idx_pms_status  ON production_molding_sessions(status);
CREATE INDEX idx_pmb_session ON production_molding_blocks(session_id);
CREATE INDEX idx_pes_logdate ON production_expansion_sessions(log_date);
CREATE INDEX idx_pes_status  ON production_expansion_sessions(status);
CREATE INDEX idx_peb_session ON production_expansion_batches(session_id);
