-- Not a test — the Supabase-shaped scaffolding a plain Postgres lacks.
--
-- Supabase provides these before your first migration runs: the auth
-- schema and auth.uid(), the anon / authenticated / service_role roles,
-- and a couple of extensions. A local Postgres has none of them, so a
-- migration replay fails on line one for reasons that have nothing to do
-- with the migration.
--
-- Loaded by scripts/test-migrations.mjs before the migrations, so the
-- replay is testing your SQL rather than the absence of Supabase.
-- Supabase's SQL editor does not validate function bodies at creation
-- time, and neither does a pg_dump restore (it emits exactly this). Our
-- migrations rely on that: 002 defines is_member_of() referencing
-- workspace_members several hundred lines before the table exists. On a
-- strict Postgres that is an error, which is why a clean replay had never
-- been attempted.
do $bs$
begin
  execute format('alter database %I set check_function_bodies = off', current_database());
end $bs$;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

-- In Supabase this reads the request's JWT claims. Here it reads a session
-- setting, so a test can say who it is: set local test.uid = '<uuid>'.
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true),
                      '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select coalesce(current_setting('request.jwt.claim.role', true),
                        'anon') $$;

create table if not exists auth.users (
  id uuid primary key default uuid_generate_v4(),
  email text,
  encrypted_password text,
  created_at timestamptz default now()
);
