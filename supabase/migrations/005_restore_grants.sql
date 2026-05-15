-- ============================================================
-- Fix: "permission denied for table workspaces"
-- ============================================================
-- Cause: when we did `drop schema public cascade; create schema public;`
-- in migration 002, Supabase's default privileges on the public schema
-- got wiped. The anon and authenticated roles have NO grants on the
-- new tables, so Postgres rejects at the ACL layer before RLS even
-- gets to evaluate.
--
-- Fix: re-grant the standard table/sequence/function permissions to
-- anon, authenticated, and service_role, and set ALTER DEFAULT PRIVILEGES
-- so future tables in the schema inherit the same.
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- Schema usage
grant usage on schema public to postgres, anon, authenticated, service_role;

-- Existing tables / sequences / functions
grant all on all tables    in schema public to postgres, service_role;
grant all on all sequences in schema public to postgres, service_role;
grant all on all functions in schema public to postgres, service_role;

grant select, insert, update, delete on all tables    in schema public to anon, authenticated;
grant usage,  select                  on all sequences in schema public to anon, authenticated;
grant execute                          on all functions in schema public to anon, authenticated;

-- Default privileges for FUTURE tables / sequences / functions (so any
-- migration that adds new objects later doesn't have to re-grant).
alter default privileges in schema public
  grant all on tables to postgres, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, service_role;
alter default privileges in schema public
  grant all on functions to postgres, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

-- ============================================================
-- DONE. Try Create Workspace again.
-- ============================================================
