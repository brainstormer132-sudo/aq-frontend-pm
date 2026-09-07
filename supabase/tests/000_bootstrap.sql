-- Not a test — the Supabase-shaped scaffolding a plain Postgres lacks.
--
-- Supabase provides these before your first migration runs: the auth
-- schema and auth.uid(), the extensions schema, and about a dozen roles.
-- A local Postgres has none of them, so a replay fails on line one for
-- reasons that have nothing to do with the SQL being tested.
--
-- Loaded by scripts/test-migrations.mjs before the migrations, so the
-- replay is testing your schema rather than the absence of Supabase.

-- ── Start from empty ──────────────────────────────────────────────
--
-- The baseline is a pg_dump of production and begins with CREATE SCHEMA
-- public, so the replay has to start with nothing. In CI that matters on
-- the second run against the same service container; locally it matters
-- every time. It is done here rather than in the runner so the file that
-- claims "this rebuilds from empty" is the file that makes it true.
drop schema if exists public     cascade;
drop schema if exists auth       cascade;
drop schema if exists storage    cascade;
drop schema if exists extensions cascade;
create schema public;

-- Supabase installs its extensions into a schema literally called
-- `extensions`, and the dump refers to them fully qualified —
-- `extensions.uuid_generate_v4()` on almost every primary key. A plain
-- Postgres puts them in public, which is why the first replay attempt
-- died on the first table that had a default.
create schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto    with schema extensions;

-- Supabase's SQL editor does not validate function bodies at creation
-- time, and neither does a pg_dump restore (pg_dump emits exactly this
-- setting). Our SQL relies on it: functions are defined before the tables
-- they read. On a strict Postgres that is an error, which is part of why
-- a clean replay had never been attempted.
do $bs$
begin
  execute format('alter database %I set check_function_bodies = off', current_database());
end $bs$;

-- ── Roles ─────────────────────────────────────────────────────────
--
-- The baseline is dumped WITH privileges (see the note in
-- scripts/test-migrations.mjs — a dump made with --no-privileges makes
-- every grant assertion pass vacuously, because there are no grants to
-- fail). Every role named in a GRANT has to exist first, and the grantee
-- list in a Supabase dump is longer than the four roles you write code
-- against.
do $$
declare
  r text;
begin
  foreach r in array array[
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'dashboard_user',
    'supabase_admin',
    'supabase_auth_admin',
    'supabase_storage_admin',
    'supabase_read_only_user',
    'supabase_replication_admin',
    'supabase_realtime_admin',
    'supabase_etl_admin',
    'pgbouncer',
    'pgsodium_keyholder',
    'pgsodium_keyiduser',
    'pgtle_admin'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;

  -- service_role bypasses RLS in production; several assertions depend on
  -- the distinction between "the backend can see it" and "the portal can".
  execute 'alter role service_role bypassrls';
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- In Supabase this reads the request's JWT claims. Here it reads a session
-- setting, so a test can say who it is:
--   set local request.jwt.claim.sub = '<uuid>';
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true),
                      '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select coalesce(current_setting('request.jwt.claim.role', true),
                        'anon') $$;

create table if not exists auth.users (
  id uuid primary key default extensions.uuid_generate_v4(),
  email text,
  encrypted_password text,
  created_at timestamptz default now()
);

grant usage on schema auth       to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;
