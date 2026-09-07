-- ============================================================
-- HARDENING (NOT a fix for a bug — see note below)
-- ============================================================
-- The expected service_type_steps count is 42, not 38 (I miscounted
-- when writing 006). If your DB shows 9 / 42 / 1 you're already fine.
--
-- This script is still useful to run because it:
--   1. Adds a UNIQUE (service_type_id, position) constraint so future
--      re-runs of the seed can't create duplicates.
--   2. Idempotently re-seeds the template steps as a safety net.
--
-- Running it on a clean DB is safe — it deletes and re-inserts the same
-- 42 rows.
-- ============================================================

-- 1. Wipe all rows belonging to template service types, then re-insert.
delete from public.service_type_steps
where service_type_id in (
  select id from public.service_types where is_template = true
);

-- 2. Add the missing unique constraint.
alter table public.service_type_steps
  drop constraint if exists service_type_steps_service_type_id_position_key;
alter table public.service_type_steps
  add constraint service_type_steps_service_type_id_position_key
  unique (service_type_id, position);

-- 3. Re-seed (same data as 006, this time the unique constraint will
--    keep ON CONFLICT DO NOTHING honest on future re-runs).
insert into public.service_type_steps (service_type_id, position, title) values
  -- Marketing Strategy
  ('00000000-0000-0000-aaaa-000000000001', 1, 'Ask for contract'),
  ('00000000-0000-0000-aaaa-000000000001', 2, 'Research, building, and strategy'),
  ('00000000-0000-0000-aaaa-000000000001', 3, 'Review and approval'),
  -- Influencers Campaign
  ('00000000-0000-0000-aaaa-000000000002', 1, 'Platform'),
  ('00000000-0000-0000-aaaa-000000000002', 2, 'Ad type'),
  ('00000000-0000-0000-aaaa-000000000002', 3, 'Choose vendors (with platform link)'),
  ('00000000-0000-0000-aaaa-000000000002', 4, 'Budget distribution'),
  ('00000000-0000-0000-aaaa-000000000002', 5, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000002', 6, 'Ask for contracts'),
  -- Billboards
  ('00000000-0000-0000-aaaa-000000000003', 1, 'Initiate the proposal'),
  ('00000000-0000-0000-aaaa-000000000003', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000003', 3, 'Vendoring and contracts'),
  -- Sponsorship
  ('00000000-0000-0000-aaaa-000000000004', 1, 'Type of sponsorship'),
  ('00000000-0000-0000-aaaa-000000000004', 2, 'Initiate the proposal'),
  ('00000000-0000-0000-aaaa-000000000004', 3, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000004', 4, 'Contract'),
  -- Creative Department
  ('00000000-0000-0000-aaaa-000000000005', 1, 'Type of service'),
  ('00000000-0000-0000-aaaa-000000000005', 2, 'Research'),
  ('00000000-0000-0000-aaaa-000000000005', 3, 'Create a proposal'),
  ('00000000-0000-0000-aaaa-000000000005', 4, 'Vendoring'),
  ('00000000-0000-0000-aaaa-000000000005', 5, 'Contracting'),
  -- Social Media
  ('00000000-0000-0000-aaaa-000000000006', 1, 'Content calendar'),
  ('00000000-0000-0000-aaaa-000000000006', 2, 'Send request to media production'),
  ('00000000-0000-0000-aaaa-000000000006', 3, 'Approved assets'),
  ('00000000-0000-0000-aaaa-000000000006', 4, 'Graphic design'),
  ('00000000-0000-0000-aaaa-000000000006', 5, 'Review and approval (c)'),
  ('00000000-0000-0000-aaaa-000000000006', 6, 'Posting'),
  ('00000000-0000-0000-aaaa-000000000006', 7, 'Proof of post'),
  ('00000000-0000-0000-aaaa-000000000006', 8, 'Vendor payment'),
  -- Branding
  ('00000000-0000-0000-aaaa-000000000007', 1, 'Create a proposal'),
  ('00000000-0000-0000-aaaa-000000000007', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000007', 3, 'Contracts'),
  ('00000000-0000-0000-aaaa-000000000007', 4, 'Graphic design'),
  ('00000000-0000-0000-aaaa-000000000007', 5, 'Review and approval (c)'),
  -- Media Production
  ('00000000-0000-0000-aaaa-000000000008', 1, 'Execution'),
  ('00000000-0000-0000-aaaa-000000000008', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000008', 3, 'Archiving'),
  -- Event
  ('00000000-0000-0000-aaaa-000000000009', 1, 'Initiate a proposal'),
  ('00000000-0000-0000-aaaa-000000000009', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000009', 3, 'Contracting'),
  ('00000000-0000-0000-aaaa-000000000009', 4, 'Execution'),
  ('00000000-0000-0000-aaaa-000000000009', 5, 'Submission of videos')
on conflict (service_type_id, position) do nothing;

-- ============================================================
-- DONE. Re-run the verify query — should now show 9 / 38 / 1.
--   select
--     (select count(*) from public.service_types where is_template) as service_types,
--     (select count(*) from public.service_type_steps)              as steps,
--     (select count(*) from information_schema.columns
--        where table_name='pm_tasks' and column_name='stage')        as has_stage_col;
-- ============================================================
