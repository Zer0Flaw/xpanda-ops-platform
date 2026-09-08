INSERT INTO roles (id, name, description, permissions, is_system, created_at, updated_at)
VALUES (
  'role-administrator', 'Administrator', 'Scratch dev admin (dummy data)',
  '{"jobs":{"view":true,"edit":true},"logistics.dashboard":{"view":true,"edit":true},"logistics.bol":{"view":true,"edit":true},"logistics.loading":{"view":true,"edit":true},"logistics.loading.manage":{"view":true,"edit":true},"logistics.loading.tv":{"view":true,"edit":true}}',
  0, '2026-01-01 00:00:00', '2026-01-01 00:00:00'
);

INSERT INTO users (id, username, display_name, password, role, role_id, shift, is_active, first_login, created_at, updated_at)
VALUES (
  'user-devtest', 'devtest', 'Dev Test', 'devtest', 'admin', 'role-administrator', NULL, 1, 0,
  '2026-01-01 00:00:00', '2026-01-01 00:00:00'
);

INSERT INTO user_roles (user_id, role_id) VALUES ('user-devtest', 'role-administrator');

INSERT INTO sessions (id, user_id, expires_at) VALUES ('DEV-SCRATCH-SESSION', 'user-devtest', '2099-01-01 00:00:00');

INSERT INTO loading_bays (id, bay_number, label, is_active, trailer_number, updated_at) VALUES
  ('bay-scratch-1', 1, 'Bay 1', 1, '', '2026-01-01 00:00:00'),
  ('bay-scratch-2', 2, 'Bay 2', 1, '', '2026-01-01 00:00:00'),
  ('bay-scratch-3', 3, 'Bay 3', 1, '', '2026-01-01 00:00:00');

INSERT INTO jobs (
  id, status, customer, po_number, invoice_number, ship_date, ship_day,
  location, delivery_time, method, carrier, load_count, total_bdft,
  scrap_pickup, sales_lead, bol_info, payment_info, notes,
  cutting_instructions, packing_instructions, contact_name, contact_phone, combo_id,
  priority, confirmed_to_ship, processes, created_at, updated_at,
  packing_slip_key, packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
  ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
  ship_to_city, ship_to_state, ship_to_zip,
  ship_to_verified, ship_to_standardized, ship_to_verified_at, trailer_group_id
) VALUES (
  'job-scratch-1', 'loading', 'Scratch Customer A', 'PO-SCRATCH-1', 'INV-SCRATCH-1', '2026-01-10', NULL,
  NULL, '', 'truck', 'Scratch Carrier', 1, 0,
  '', '', '', '', 'Scratch dev seed job',
  '', '', '', '', NULL,
  0, 0, '{}', '2026-01-01 00:00:00', '2026-01-01 00:00:00',
  NULL, NULL, NULL, NULL, 'scratch-seed',
  'Scratch Customer A', '', '123 Scratch St', '',
  'Scratchville', 'OH', '44000',
  0, 0, NULL, NULL
);

INSERT INTO jobs (
  id, status, customer, po_number, invoice_number, ship_date, ship_day,
  location, delivery_time, method, carrier, load_count, total_bdft,
  scrap_pickup, sales_lead, bol_info, payment_info, notes,
  cutting_instructions, packing_instructions, contact_name, contact_phone, combo_id,
  priority, confirmed_to_ship, processes, created_at, updated_at,
  packing_slip_key, packing_slip_pdf, packing_slip_filename, packing_slip_invoice, source,
  ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
  ship_to_city, ship_to_state, ship_to_zip,
  ship_to_verified, ship_to_standardized, ship_to_verified_at, trailer_group_id
) VALUES (
  'job-scratch-2', 'done', 'Scratch Customer B', 'PO-SCRATCH-2', 'INV-SCRATCH-2', '2026-01-11', NULL,
  NULL, '', 'truck', 'Scratch Carrier', 1, 0,
  '', '', '', '', '',
  '', '', '', '', NULL,
  0, 0, '{}', '2026-01-01 00:00:00', '2026-01-01 00:00:00',
  NULL, NULL, NULL, NULL, 'scratch-seed',
  'Scratch Customer B', '', '456 Scratch Ave', '',
  'Scratchburg', 'OH', '44001',
  0, 0, NULL, NULL
);

INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
VALUES ('la-scratch-1', 'job-scratch-1', 'bay-scratch-1', 'TRL-SCRATCH-1', 'loading', 'user-devtest', '', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
VALUES ('la-scratch-2', 'job-scratch-2', NULL, '', 'awaiting', 'user-devtest', '', 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00');

INSERT INTO bols (
  id, bol_number, date, customer_id,
  ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
  ship_to_city, ship_to_state, ship_to_zip, location_no,
  carrier_id, carrier_name, trailer_no, seal_number, scac, pro_no,
  freight_terms, is_scrap_pickup, third_party_bill_to, special_instructions, contact_info, is_master_bol, siplast,
  commodity_description, handling_unit_qty, handling_unit_type,
  package_qty, package_type, weight, delivery_time, job_id, notes, po_number, render_overrides, access_token, shipper_name,
  bol_group_id, load_number, load_count, created_at
) VALUES (
  'bol-scratch-1', 'BOL-SCRATCH-1', '2026-01-10', NULL,
  'Scratch Customer A', '', '123 Scratch St', '',
  'Scratchville', 'OH', '44000', NULL,
  NULL, 'Scratch Carrier', 'TRL-SCRATCH-1', '', '', '',
  'prepaid', 0, '', '', '', 0, 0,
  '', '', '',
  '', '', '', '', 'job-scratch-1', '', 'PO-SCRATCH-1', NULL, 'scratch-access-token-1', 'Dev Test',
  NULL, 1, 1, '2026-01-01 00:00:00'
);

INSERT INTO loading_board_notes (id, notes, updated_at, updated_by)
VALUES ('singleton', 'Scratch dev board — dummy data.', '2026-01-01 00:00:00', 'user-devtest');
