-- 064_dedupe_clients.sql
--
-- Collapses duplicate client rows created by the Zoho import.
--
-- WHY THERE ARE DUPLICATES
-- ------------------------
-- The import job on aq-backend builds its "clients I already have" set with a
-- single unpaged select against public.clients. PostgREST caps that response at
-- db-max-rows (1000). Once this table passed a thousand rows, roughly 79 of
-- them became invisible to the dedupe, and every company living in that blind
-- spot was re-inserted on every run — the same twelve, forever, because their
-- own accumulating copies are what keeps them in the tail.
--
-- THIS MIGRATION DOES NOT FIX THAT. It cleans up the mess. The import job must
-- be paged as well or the duplicates come straight back. The unique index that
-- would prevent it structurally is written at the bottom, commented out,
-- because it turns a silent duplicate into a hard mid-run failure until the
-- backend upserts with `on conflict`.
--
-- WHAT IT DOES
-- ------------
--   1. Picks a survivor per (workspace_id, company_name) — the OLDEST row,
--      because that is the one existing campaigns are most likely to point at.
--   2. Fills blank fields on the survivor from its newer copies, so a detail
--      typed in later is not thrown away with the row that carried it.
--   3. Repoints every reference — discovered from the catalog, so foreign keys
--      added after this was written are handled too — plus the columns that
--      hold a client id WITHOUT a foreign key (pm_tasks.client_id is the one
--      that matters; nothing would have errored, the campaigns would simply
--      have started pointing at rows that no longer exist).
--   4. Deletes the losers.
--
-- The mapping is kept in public.client_dedupe_map. Do not drop it until you
-- are satisfied — it is the only record of which id became which.
--
-- Idempotent: running it twice is a no-op, because after the first run there
-- are no duplicates left to map.

-- ---------------------------------------------------------------------------
-- 1. The map: every duplicate row, and the row it is being merged into.
-- ---------------------------------------------------------------------------

create table if not exists public.client_dedupe_map (
  drop_id      uuid primary key,
  keep_id      uuid not null,
  workspace_id uuid,
  company_name text,
  drop_created timestamptz,
  keep_created timestamptz,
  merged_at    timestamptz not null default now()
);

insert into public.client_dedupe_map
  (drop_id, keep_id, workspace_id, company_name, drop_created, keep_created)
select
  c.id,
  s.keep_id,
  c.workspace_id,
  c.company_name,
  c.created_at,
  s.keep_created
from public.clients c
join (
  select
    workspace_id,
    company_name,
    (array_agg(id order by created_at, id))[1]         as keep_id,
    (array_agg(created_at order by created_at, id))[1] as keep_created
  from public.clients
  group by workspace_id, company_name
  having count(*) > 1
     -- A name carrying two different commercial registrations is two real
     -- companies wearing one name, not a duplicate. Merging them would delete
     -- a company. Those are left alone for a person to look at; see the
     -- skipped list raised at the end.
     and count(distinct nullif(btrim(cr_number), '')) <= 1
) s
  on  c.company_name is not distinct from s.company_name
  and c.workspace_id is not distinct from s.workspace_id
where c.id <> s.keep_id
on conflict (drop_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Fill blanks on the survivor from its own copies.
--
--    Only fields that are safe to inherit. `status` and `invite_status` are
--    deliberately NOT merged: they are decisions somebody made about a
--    specific row, not facts about the company.
-- ---------------------------------------------------------------------------

do $$
declare
  col text;
begin
  foreach col in array array[
    'contact_name', 'contact_email', 'contact_phone', 'industry', 'notes',
    'cr_number', 'vat_number', 'signatory_name', 'company_email',
    'street', 'city', 'postcode', 'country', 'national_address'
  ]
  loop
    -- Only if the column actually exists in this database.
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'clients' and column_name = col
    ) then
      execute format($f$
        update public.clients k
           set %I = sub.val
          from (
            select m.keep_id,
                   (array_remove(
                      array_agg(nullif(btrim(c.%I), '') order by c.created_at, c.id),
                      null))[1] as val
              from public.client_dedupe_map m
              join public.clients c on c.id = m.drop_id
             group by m.keep_id
          ) sub
         where k.id = sub.keep_id
           and sub.val is not null
           and coalesce(btrim(k.%I), '') = ''
      $f$, col, col, col);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Repoint every reference from the losers onto the survivors.
-- ---------------------------------------------------------------------------

-- 3a. Collisions first. manager_clients is unique on
--     (workspace_id, manager_id, client_id), so repointing a loser onto a
--     survivor the same manager already holds would violate that index.
--     The loser row is redundant in that case — drop it.
delete from public.manager_clients mc
using public.client_dedupe_map m
where mc.client_id = m.drop_id
  and exists (
    select 1 from public.manager_clients keep
    where keep.client_id    = m.keep_id
      and keep.manager_id   = mc.manager_id
      and keep.workspace_id = mc.workspace_id
  );

-- 3b. Every column with a declared foreign key to clients(id), found in the
--     catalog rather than hardcoded.
do $$
declare
  r record;
  moved bigint;
begin
  for r in
    select
      src_ns.nspname  as schema_name,
      src.relname     as table_name,
      att.attname     as column_name
    from pg_constraint con
    join pg_class      src     on src.oid = con.conrelid
    join pg_namespace  src_ns  on src_ns.oid = src.relnamespace
    join pg_class      tgt     on tgt.oid = con.confrelid
    join pg_namespace  tgt_ns  on tgt_ns.oid = tgt.relnamespace
    join unnest(con.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute  att     on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and tgt_ns.nspname = 'public'
      and tgt.relname    = 'clients'
      and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'update %I.%I t set %I = m.keep_id
         from public.client_dedupe_map m
        where t.%I = m.drop_id',
      r.schema_name, r.table_name, r.column_name, r.column_name
    );
    get diagnostics moved = row_count;
    if moved > 0 then
      raise notice 'repointed % row(s) in %.%(%)',
        moved, r.schema_name, r.table_name, r.column_name;
    end if;
  end loop;
end $$;

-- 3c. Columns that hold a client id but carry NO foreign key, so the catalog
--     loop above cannot see them. pm_tasks.client_id is the dangerous one:
--     with no constraint, deleting a duplicate would leave campaigns pointing
--     at an id that no longer exists and nothing would have complained.
do $$
declare
  r record;
  moved bigint;
begin
  for r in
    select * from (values
      ('public', 'pm_tasks',         'client_id'),
      ('public', 'crm_contacts',     'client_id'),
      ('public', 'crm_deals',        'client_id'),
      ('public', 'contract_requests','client_id')
    ) as v(schema_name, table_name, column_name)
  loop
    -- Skip anything that does not exist here, and anything already handled
    -- above by a real foreign key.
    if exists (
      select 1 from information_schema.columns c
      where c.table_schema = r.schema_name
        and c.table_name   = r.table_name
        and c.column_name  = r.column_name
        and c.data_type    = 'uuid'
    ) and not exists (
      select 1
      from pg_constraint con
      join pg_class     src    on src.oid = con.conrelid
      join pg_namespace srcns  on srcns.oid = src.relnamespace
      join pg_attribute att    on att.attrelid = con.conrelid
                              and att.attnum = con.conkey[1]
      where con.contype   = 'f'
        and srcns.nspname = r.schema_name
        and src.relname   = r.table_name
        and att.attname   = r.column_name
    ) then
      execute format(
        'update %I.%I t set %I = m.keep_id
           from public.client_dedupe_map m
          where t.%I = m.drop_id',
        r.schema_name, r.table_name, r.column_name, r.column_name
      );
      get diagnostics moved = row_count;
      raise notice 'repointed % unconstrained row(s) in %.%(%)',
        moved, r.schema_name, r.table_name, r.column_name;
    end if;
  end loop;
end $$;

-- 3d. Brands. Repointing moves every copy's brands onto the survivor, so the
--     same brand name can now appear several times under one client. Collapse
--     those, keeping the oldest, and move anything pointing at the dropped
--     brand first.
drop table if exists _brand_dupes;

create temporary table _brand_dupes as
select id as drop_id, keep_id
from (
  select
    id,
    first_value(id) over (
      partition by client_id, brand_name
      order by created_at, id
    ) as keep_id
  from public.client_brands
) t
where id <> keep_id;

do $$
declare
  r record;
begin
  for r in
    select
      src_ns.nspname as schema_name,
      src.relname    as table_name,
      att.attname    as column_name
    from pg_constraint con
    join pg_class      src    on src.oid = con.conrelid
    join pg_namespace  src_ns on src_ns.oid = src.relnamespace
    join pg_class      tgt    on tgt.oid = con.confrelid
    join pg_namespace  tgt_ns on tgt_ns.oid = tgt.relnamespace
    join pg_attribute  att    on att.attrelid = con.conrelid
                             and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and tgt_ns.nspname = 'public'
      and tgt.relname    = 'client_brands'
      and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'update %I.%I t set %I = d.keep_id
         from _brand_dupes d
        where t.%I = d.drop_id',
      r.schema_name, r.table_name, r.column_name, r.column_name
    );
  end loop;
end $$;

delete from public.client_brands b using _brand_dupes d where b.id = d.drop_id;

-- ---------------------------------------------------------------------------
-- 4. Delete the losers.
--
--    Everything that referenced them now points at the survivor, so the
--    cascades on client_brands and manager_clients have nothing left to take
--    and the `on delete set null` columns have nothing left to blank.
-- ---------------------------------------------------------------------------

delete from public.clients c
using public.client_dedupe_map m
where c.id = m.drop_id;

-- ---------------------------------------------------------------------------
-- 5. What happened.
-- ---------------------------------------------------------------------------

do $$
declare
  merged  bigint;
  names   bigint;
  left_ov bigint;
  r       record;
begin
  select count(*), count(distinct company_name)
    into merged, names
    from public.client_dedupe_map;

  select count(*) into left_ov from (
    select 1 from public.clients
    group by workspace_id, company_name
    having count(*) > 1
  ) x;

  raise notice '--------------------------------------------------';
  raise notice 'merged % duplicate row(s) across % company name(s)', merged, names;
  raise notice 'mapping kept in public.client_dedupe_map';
  raise notice 'duplicate names remaining: % — listed below', left_ov;
  raise notice '--------------------------------------------------';

  -- Anything still duplicated was deliberately not touched. Each of these is a
  -- decision for a person: same name, more than one commercial registration.
  for r in
    select
      company_name,
      count(*) as copies,
      string_agg(distinct nullif(btrim(cr_number), ''), ' | ') as crs
    from public.clients
    group by workspace_id, company_name
    having count(*) > 1
    order by count(*) desc
  loop
    raise notice 'LEFT ALONE: % — % copies, CRs: %', r.company_name, r.copies, r.crs;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. DO NOT ENABLE YET.
--
--     This is the constraint that makes the bug structurally impossible. It is
--     commented out on purpose: the import currently inserts without
--     `on conflict`, so switching this on turns a silent duplicate into a hard
--     failure partway through the run — every client after the collision never
--     lands. Enable it only once aq-backend upserts.
-- ---------------------------------------------------------------------------

-- create unique index if not exists clients_workspace_name_uniq
--   on public.clients (workspace_id, company_name);
