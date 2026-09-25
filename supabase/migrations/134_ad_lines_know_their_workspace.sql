-- ============================================================
-- 134_ad_lines_know_their_workspace.sql
-- public.vendor_ad_lines has no workspace column, so every read of it is a
-- read of the whole table.
--
-- hooks/use-calendar-items says so in its own comment:
--
--   "Selected without a workspace filter - the table has no workspace column
--    - then matched to subtasks we already loaded, which is what scopes them."
--
-- That is correct and it is expensive. Opening the calendar fetches EVERY ad
-- line in the database, a thousand rows per round trip, and throws away the
-- ones that belong to somebody else. At four thousand lines that is four
-- round trips before a single day is drawn, and it grows for ever.
--
-- -- WHAT THIS IS, AND WHAT IT IS NOT ---------------------------------
--
-- It is a filter. It is NOT a permission.
--
-- The policies on this table decide who may read a line by looking UP to the
-- booking it hangs off (vendor_ad_lines_select and friends, an EXISTS over
-- pm_tasks). Those stay exactly as they are, and they remain the only thing
-- standing between one workspace and another's. A denormalised column is a
-- copy, and a copy can be wrong; deciding access on it would mean one stale
-- row is a leak. Deciding it on the join means a stale row is at worst a
-- missing item on a calendar.
--
-- So: the column narrows the read, the policy still decides the answer.
--
-- -- KEPT RIGHT BY A TRIGGER, NOT BY CALLERS -------------------------
--
-- Three paths already insert ad lines and none of them would know to set it.
-- A column that callers must remember is a column that is null on the rows
-- somebody added in a hurry - which is exactly the row missing from the
-- calendar that nobody can explain. The trigger reads it from the booking,
-- on insert and whenever the booking changes, so there is nothing to
-- remember and nothing to get wrong.
-- ============================================================

set search_path = public;

-- 1. the column ----------------------------------------------------
alter table public.vendor_ad_lines
  add column if not exists workspace_id uuid
    references public.workspaces(id) on delete cascade;

comment on column public.vendor_ad_lines.workspace_id is
  'Copied from the booking this ad hangs off (134), so a read can be narrowed without joining. A FILTER, not a permission: the row-level policies still decide access by looking up to pm_tasks.';

-- 2. keep it right ------------------------------------------------
create or replace function public.ad_line_workspace() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  select t.workspace_id into new.workspace_id
    from public.pm_tasks t where t.id = new.subtask_id;
  return new;
end $fn$;

revoke all on function public.ad_line_workspace() from public, authenticated, anon;

drop trigger if exists trg_ad_line_workspace on public.vendor_ad_lines;
create trigger trg_ad_line_workspace
  before insert or update of subtask_id on public.vendor_ad_lines
  for each row execute function public.ad_line_workspace();

-- 3. the rows that are already there -------------------------------
do $$
declare n integer; orphans integer;
begin
  update public.vendor_ad_lines l
     set workspace_id = t.workspace_id
    from public.pm_tasks t
   where t.id = l.subtask_id
     and l.workspace_id is distinct from t.workspace_id;
  get diagnostics n = row_count;

  -- Lines whose booking no longer exists. They cannot be filled in, and they
  -- are invisible to every screen already (the calendar drops them when the
  -- parent is missing). Counted rather than deleted: deleting rows is not
  -- what this migration is for, and the number is worth knowing.
  select count(*) into orphans from public.vendor_ad_lines l
   where not exists (select 1 from public.pm_tasks t where t.id = l.subtask_id);

  raise notice 'legal: stamped % ad line(s); % have no booking and were left alone', n, orphans;
end $$;

-- 4. the index the filter is for -----------------------------------
create index if not exists vendor_ad_lines_workspace_idx
  on public.vendor_ad_lines (workspace_id) where workspace_id is not null;

-- 5. prove it ------------------------------------------------------
do $$
declare
  sub uuid;
  ws  uuid;
  l   uuid;
  n   integer;
begin
  select t.id, t.workspace_id into sub, ws
    from public.pm_tasks t
   where t.workspace_id is not null
   -- id, not created_at: every table here has an id, and the probe only needs
   -- A booking, not a particular one.
   order by t.id limit 1;
  if sub is null then
    raise notice 'legal: no booking to probe against - skipping';
    return;
  end if;

  begin
    -- (a) an insert that does not mention workspace_id still gets one
    insert into public.vendor_ad_lines (subtask_id, ad_type)
    values (sub, '__probe__') returning id into l;
    if (select workspace_id from public.vendor_ad_lines where id = l) is distinct from ws then
      raise exception 'legal: a new ad line did not pick up its workspace';
    end if;

    -- NOT PROBED, and worth saying why: a direct write to workspace_id
    -- sticks, because the trigger only fires on subtask_id. Setting it to an
    -- invented uuid would fail on the foreign key rather than prove anything,
    -- and the property it would be testing is not one this column has. The
    -- column is a filter; the row-level policies are what decide access. If
    -- it ever needs to be tamper-proof it becomes a generated column.

    -- (c) and every existing row now has one
    select count(*) into n from public.vendor_ad_lines l2
     where l2.workspace_id is null
       and exists (select 1 from public.pm_tasks t where t.id = l2.subtask_id);
    if n > 0 then
      raise exception 'legal: % ad line(s) with a live booking still have no workspace', n;
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: every ad line with a booking knows its workspace, and new ones are stamped on the way in';
  end;
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from public.vendor_ad_lines)                          as ad_lines,
--   (select count(*) from public.vendor_ad_lines where workspace_id is null) as unstamped,
--   (select count(*) from public.vendor_ad_lines l
--      where l.workspace_id is null
--        and exists (select 1 from public.pm_tasks t where t.id = l.subtask_id)) as unstamped_with_booking,
--   (select count(*) from pg_indexes where schemaname='public'
--      and indexname='vendor_ad_lines_workspace_idx')                      as idx
-- expected: ? | ? | 0 | 1
-- unstamped may be non-zero: those are lines whose booking was deleted.
