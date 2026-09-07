-- ============================================================
-- 055_realtime_pm_tasks.sql
-- Make pm_tasks broadcast its changes, so a task created on one
-- machine appears on everyone else's without a refresh.
--
-- The app has had a `useRealtime` hook since early on, wired to nothing,
-- and the table was never added to Supabase's realtime publication — so
-- even a correct subscription would have received nothing. Both halves
-- are needed; this is the database half.
--
-- Row-level security still applies to realtime: a subscriber is only sent
-- rows they could have SELECTed anyway, so this does not widen what anyone
-- can see. It only removes the wait.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor.
-- ============================================================

begin;

do $$
begin
  -- The publication exists on every Supabase project, but check rather than
  -- assume: on a self-hosted instance it may not.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice '055: created publication supabase_realtime';
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'pm_tasks'
  ) then
    alter publication supabase_realtime add table public.pm_tasks;
    raise notice '055: pm_tasks added to supabase_realtime';
  else
    raise notice '055: pm_tasks was already published — nothing to do';
  end if;
end $$;

commit;

-- ─── Verification ───────────────────────────────────────────────
select schemaname, tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
 order by tablename;
-- Expect public / pm_tasks in the list.
