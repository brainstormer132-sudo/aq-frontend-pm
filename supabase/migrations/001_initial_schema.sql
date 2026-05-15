-- ============================================================
-- OBSOLETE — DO NOT RUN
-- ============================================================
-- This file's original schema has been superseded by:
--
--   002_reset_and_full_schema.sql
--
-- The original 001 created a `tasks` table that collides with
-- the contract app's existing `tasks` table, and was missing
-- six tables the hooks now reference (pm_tasks, task_members,
-- clients, client_brands, manager_clients, managed_vendors).
--
-- Run 002_reset_and_full_schema.sql instead. See SETUP.md.
-- ============================================================

-- Intentional no-op so accidental runs don't break anything.
do $$ begin
  raise notice
    '001_initial_schema.sql is obsolete. Run 002_reset_and_full_schema.sql instead.';
end $$;
