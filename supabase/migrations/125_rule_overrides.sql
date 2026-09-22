-- ============================================================
-- 125_rule_overrides.sql
-- Every rule can be passed. None of them is passed quietly.
--
-- Siraj: "if rules want to be passed for example mark a vendor complete
-- without a contract(based on the vendor) resaults in a password type screen
-- to overpass and these overhaul will be counted per person and tracked in
-- the log" - and, asked whether that was only the contract rule: "it should
-- also go for all rules ... every rule can be bypassed but will be
-- documented".
--
-- -- THE BARGAIN ----------------------------------------------------
--
-- A rule nobody can pass is a rule people work around, and the way around is
-- always worse than the thing the rule forbade: the booking gets completed
-- from a different screen, or the fee gets typed into a note, or somebody is
-- asked to "just do it from your login". What a rule actually buys is not
-- prevention. It is a RECORD - the person, the reason, the thing, the minute.
--
-- So: the code opens every rule, and every use of it is written down.
--
-- -- THE FOUR PIECES ------------------------------------------------
--
--   1. vendor_categories.requires_contract - the exemption that means the
--      contract rule never fires for categories that genuinely have none.
--      Exempting a whole category is BETTER than overriding it one booking
--      at a time: an override log full of "van rental, no contract, again"
--      is a log nobody reads, and a log nobody reads is not a control.
--   2. override_code - one code per workspace, stored as a bcrypt hash.
--   3. rule_override - the log. Refused attempts included.
--   4. use_override() - the only way to write to the log, and the only place
--      the code is ever compared.
--
-- -- WHY THE FAILURES ARE LOGGED TOO --------------------------------
--
-- A log with only the successes in it cannot tell you that somebody spent ten
-- minutes guessing, which is the one thing a log of a shared secret exists to
-- be able to tell you. That is also why use_override RETURNS FALSE on a wrong
-- code rather than raising: raising would roll back the transaction, and the
-- transaction contains the record of the attempt.
--
-- -- WHAT IS DELIBERATELY NOT HERE ----------------------------------
--
-- No policy on override_code. Not a restrictive one, none at all - with RLS
-- on and no policy, the table is invisible to every ordinary caller, and only
-- the SECURITY DEFINER functions below can see it. A hash is not a secret you
-- want a signed-in browser able to fetch and grind offline.
--
-- No update and no delete policy on rule_override either. The log is written
-- by one function and is read-only to everybody, including the people in it.
-- ============================================================

-- bcrypt. Supabase ships pgcrypto; this makes the dependency explicit rather
-- than assumed, and puts it where Supabase puts extensions.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 1. the exemption -------------------------------------------------
--
-- DEFAULT TRUE, so the rule applies to everything the moment it exists and
-- somebody has to decide which categories are excused. Defaulting to false
-- would ship a rule that fires for nobody and looks like it works.
alter table public.vendor_categories
  add column if not exists requires_contract boolean not null default true;

comment on column public.vendor_categories.requires_contract is
  'Whether a booking with a vendor in this category must have a contract before it can be completed. Default true; untick for categories that genuinely never have one (rentals, locations). Excusing a category is preferable to overriding it a booking at a time.';

-- 2. the code ------------------------------------------------------
create table if not exists public.override_code (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  code_hash    text not null,
  set_by       uuid,
  set_at       timestamptz not null default now()
);

comment on table public.override_code is
  'One shared override code per workspace, bcrypt-hashed. RLS is on and there are NO policies: nothing but the SECURITY DEFINER functions in 125 can read this table.';

alter table public.override_code enable row level security;
revoke all on public.override_code from anon, authenticated;

-- 3. the log -------------------------------------------------------
create table if not exists public.rule_override (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_key     text not null,
  entity_kind  text,
  entity_id    text,
  -- What the thing was CALLED at the time. Names change; a log that resolves
  -- them live shows today's name for yesterday's decision, and the campaign
  -- somebody passed a rule on in April has usually been renamed by August.
  entity_name  text,
  actor        uuid,
  reason       text not null,
  passed       boolean not null,
  created_at   timestamptz not null default now(),
  constraint rule_override_rule_chk   check (btrim(rule_key) <> ''),
  constraint rule_override_reason_chk check (btrim(reason) <> '')
);

comment on table public.rule_override is
  'Every attempt to pass a rule with the override code - successful and refused. Written only by public.use_override(); no update or delete policy exists, for anybody.';

-- The log is read two ways and both are covered: newest-first for the screen,
-- and per person for the count Siraj asked for by name.
create index if not exists idx_rule_override_ws      on public.rule_override (workspace_id, created_at desc);
create index if not exists idx_rule_override_actor   on public.rule_override (workspace_id, actor, created_at desc);
-- The rate limit's own read: this workspace, this actor, recent failures.
create index if not exists idx_rule_override_recent  on public.rule_override (workspace_id, actor, created_at desc)
  where passed = false;

alter table public.rule_override enable row level security;

-- Owner and admin read the lot; everybody reads their own. Somebody should be
-- able to see what is recorded against their own name without asking.
drop policy if exists "rule_override read" on public.rule_override;
create policy "rule_override read" on public.rule_override
  for select to authenticated
  using (
    public.has_role(workspace_id, array['owner','admin'])
    or actor = auth.uid()
  );

-- No insert, update or delete policy. use_override() is SECURITY DEFINER and
-- sees past this; nothing else writes here at all.
revoke insert, update, delete on public.rule_override from anon, authenticated;
grant select on public.rule_override to authenticated;

-- 4. setting the code ----------------------------------------------
--
-- Owner and admin only, and the new code never leaves this function in a form
-- anybody can read back. There is no "show the current code" and there never
-- will be: a shared secret that can be fetched is a shared secret that leaks
-- through a screenshot.
create or replace function public.set_override_code(p_workspace_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_code text := coalesce(p_code, '');
begin
  if not public.has_role(p_workspace_id, array['owner','admin']) then
    raise exception 'Only an owner or an admin can set the override code'
      using errcode = '42501';
  end if;
  -- Six is short enough to say down a phone and long enough for the rate
  -- limit below to be worth having.
  if length(btrim(v_code)) < 6 then
    raise exception 'The override code must be at least 6 characters'
      using errcode = '22023';
  end if;
  if length(v_code) > 64 then
    raise exception 'The override code must be 64 characters or fewer'
      using errcode = '22023';
  end if;

  insert into public.override_code (workspace_id, code_hash, set_by, set_at)
  values (p_workspace_id, extensions.crypt(v_code, extensions.gen_salt('bf', 10)), auth.uid(), now())
  on conflict (workspace_id) do update
    set code_hash = excluded.code_hash,
        set_by    = excluded.set_by,
        set_at    = excluded.set_at;
end;
$$;

-- Whether a code has been set at all, which is a different question from what
-- it is. The screen needs this to say "no override code has been set - an
-- owner has to set one in Settings" instead of "wrong code".
create or replace function public.has_override_code(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.override_code where workspace_id = p_workspace_id)
     and public.is_member_of(p_workspace_id);
$$;

-- 5. using it ------------------------------------------------------
--
-- RETURNS BOOLEAN, and a wrong code returns FALSE rather than raising.
--
-- This is the crux of the file. `raise` aborts the transaction, and the
-- transaction is where the record of the attempt lives - so raising on a bad
-- code would roll back the very row that makes a wrong code visible. The
-- exceptions below are for conditions where there is nothing worth recording:
-- a caller who is not a member, a reason nobody typed, no code set at all.
create or replace function public.use_override(
  p_workspace_id uuid,
  p_code         text,
  p_rule_key     text,
  p_entity_kind  text,
  p_entity_id    text,
  p_entity_name  text,
  p_reason       text
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_reason   text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  v_rule     text := btrim(coalesce(p_rule_key, ''));
  v_hash     text;
  v_recent   integer;
  v_ok       boolean;
begin
  if not public.is_member_of(p_workspace_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_rule = '' then
    raise exception 'An override has to name the rule it is passing' using errcode = '22023';
  end if;
  -- Twelve, matching lib/overrides.ts. "urgent" and "Siraj said" are what
  -- people type when there is no floor, and neither tells the next reader
  -- anything at all.
  if length(v_reason) < 12 then
    raise exception 'Say why you are passing this rule - at least 12 characters'
      using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'That reason is too long - keep it under 500 characters'
      using errcode = '22023';
  end if;

  select code_hash into v_hash from public.override_code where workspace_id = p_workspace_id;
  if v_hash is null then
    raise exception 'No override code has been set for this workspace'
      using errcode = '22023';
  end if;

  -- Five wrong codes in fifteen minutes and this actor stops for a while.
  --
  -- The lockout attempt itself is NOT logged. The first five are the record;
  -- everything after is the same fact repeated, and logging it would also
  -- keep pushing the window forward forever.
  select count(*) into v_recent
    from public.rule_override
   where workspace_id = p_workspace_id
     and actor is not distinct from auth.uid()
     and passed = false
     and created_at > now() - interval '15 minutes';
  if v_recent >= 5 then
    raise exception 'Too many wrong codes. Wait fifteen minutes, or ask an owner to reset it'
      using errcode = '42501';
  end if;

  v_ok := (v_hash = extensions.crypt(coalesce(p_code, ''), v_hash));

  insert into public.rule_override
    (workspace_id, rule_key, entity_kind, entity_id, entity_name, actor, reason, passed)
  values
    (p_workspace_id, v_rule, nullif(btrim(coalesce(p_entity_kind, '')), ''),
     nullif(btrim(coalesce(p_entity_id, '')), ''),
     nullif(btrim(coalesce(p_entity_name, '')), ''),
     auth.uid(), v_reason, v_ok);

  return v_ok;
end;
$$;

revoke all on function public.set_override_code(uuid, text) from public, anon;
revoke all on function public.use_override(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.set_override_code(uuid, text)                      to authenticated, service_role;
grant execute on function public.has_override_code(uuid)                            to authenticated, service_role;
grant execute on function public.use_override(uuid, text, text, text, text, text, text) to authenticated, service_role;

-- 6. prove it, rather than trust it --------------------------------
--
-- There is no JWT in the SQL editor, so auth.uid() is null and has_role() is
-- false: the guards above will refuse everything here. That means a probe
-- that only calls the functions tests ONLY THE HALF THAT SAYS NO, which is
-- the mistake migration 122 made and 123 made again.
--
-- So the half that has to say YES is tested directly: the bcrypt round trip
-- IS the security of this file, and the `hash = crypt(candidate, hash)` idiom
-- is easy to write backwards in a way that passes for everything.
do $$
declare
  h     text;
  fired boolean;
begin
  h := extensions.crypt('probe-code-1234', extensions.gen_salt('bf', 8));

  if h is null or h = 'probe-code-1234' then
    raise exception 'override: the code was not hashed';
  end if;
  if h <> extensions.crypt('probe-code-1234', h) then
    raise exception 'override: the right code did not match its own hash';
  end if;
  if h = extensions.crypt('probe-code-1235', h) then
    raise exception 'override: a WRONG code matched the hash';
  end if;
  if h = extensions.crypt('', h) then
    raise exception 'override: an empty code matched the hash';
  end if;
  -- Two hashes of the same code must differ, or the salt is not doing its
  -- job and the same code has the same hash in every workspace.
  if h = extensions.crypt('probe-code-1234', extensions.gen_salt('bf', 8)) then
    raise exception 'override: the salt is not random';
  end if;

  -- And the guards do refuse an anonymous caller. Worth one line, no more:
  -- this is the half that is easy to get right.
  fired := false;
  begin
    perform public.set_override_code('00000000-0000-0000-0000-000000000000'::uuid, 'abcdef');
  exception when others then fired := true;
  end;
  if not fired then raise exception 'override: an anonymous caller was allowed to set the code'; end if;

  raise notice 'override: the hash round trip holds and the guards refuse an anonymous caller';
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='vendor_categories'
--       and column_name='requires_contract')                          as exemption_column,
--   (select count(*) from pg_class where relname='override_code')      as code_table,
--   (select count(*) from pg_policies
--     where schemaname='public' and tablename='override_code')         as code_policies,
--   (select count(*) from pg_class where relname='rule_override')      as log_table,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.proname in
--       ('set_override_code','has_override_code','use_override'))      as functions
-- expected: 1 | 1 | 0 | 1 | 3
--   code_policies MUST be 0 - that is what makes the hash unreadable.
