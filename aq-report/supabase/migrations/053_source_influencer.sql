-- ============================================================
-- 053_source_influencer.sql
-- "Influencer" as a Source option on every campaign.
--
-- Source is a lookup table (task_sources, migration 028) rather than a
-- hard-coded list, and it is editable in Settings → Operations lookups.
-- This migration exists so nobody has to add the same row by hand in every
-- workspace, and so a workspace created before 042 — or one where the row
-- was deleted — ends up with it too.
--
-- Two steps, both idempotent, safe to run twice:
--
--   1. Any existing shorthand ("Inf." / "Inf") becomes "Influencer".
--      Same meaning, spelled out; the abbreviation came from the old
--      spreadsheet and reads like a typo in a dropdown. Renaming rather
--      than inserting a second row also means campaigns already tagged with
--      the shorthand keep their tag — source_id doesn't change.
--   2. Where no influencer row exists at all, insert one at the end of the
--      list. `unique (workspace_id, name)` makes a double-run a no-op, but
--      the NOT EXISTS keeps it from erroring rather than relying on that.
--
-- Run in the Supabase SQL editor.
-- ============================================================

begin;

-- 1 · spell out the shorthand, where a workspace doesn't already have both
update public.task_sources t
   set name = 'Influencer'
 where lower(trim(t.name)) in ('inf.', 'inf')
   and not exists (
     select 1 from public.task_sources o
      where o.workspace_id = t.workspace_id
        and lower(trim(o.name)) = 'influencer'
   );

-- 2 · add it wherever it is still missing
insert into public.task_sources (workspace_id, name, position)
select w.id,
       'Influencer',
       coalesce((select max(t.position) from public.task_sources t
                  where t.workspace_id = w.id), 0) + 1
  from public.workspaces w
 where not exists (
   select 1 from public.task_sources t
    where t.workspace_id = w.id
      and lower(trim(t.name)) = 'influencer'
 );

commit;

-- Verification — expect one 'Influencer' row per workspace, no duplicates.
select workspace_id, name, position
  from public.task_sources
 where lower(trim(name)) = 'influencer'
 order by workspace_id;

select count(*) as workspaces_without_influencer
  from public.workspaces w
 where not exists (
   select 1 from public.task_sources t
    where t.workspace_id = w.id and lower(trim(t.name)) = 'influencer'
 );
-- Expect 0.
