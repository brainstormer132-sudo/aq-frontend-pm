-- 073_deleted_tasks_recycle_bin.sql
--
-- Deleting a task removes it from every screen at once, and keeps it
-- recoverable for 30 days.
--
-- Siraj: *"make sure deleted tasks in pm app gets removed completlly from
-- view of course give a 30 day recovery period in the background"*.
--
-- ── THE DESIGN DECISION ───────────────────────────────────────────
--
-- A soft delete has one classic failure: the row is still there, so every
-- query has to remember `where deleted_at is null`, and the one that forgets
-- is the one that shows a client a campaign you deleted last week. This app
-- reads pm_tasks from around sixty places.
--
-- So the filter goes in the RLS POLICY, not in the queries. A deleted task
-- is invisible to SELECT at the database, which means "removed completely
-- from view" is true of the REST API, the rollup view, the dashboard, All
-- Tasks, the portal, and anything anybody writes next year without reading
-- this file. There is no filter to forget.
--
-- Two consequences, both wanted:
--
--   * The recycle bin cannot be read by an ordinary query — it needs
--     `deleted_tasks()` below, which is SECURITY DEFINER and admin-only.
--     Seeing the bin should be a deliberate act.
--   * A deleted task cannot be edited either, because the UPDATE policy
--     gets the same clause. Restoring goes through `restore_task()`.
--
-- ── WHAT REPLACES THE HARD DELETE ─────────────────────────────────
--
-- `soft_delete_task()` stamps the campaign AND its bookings in one
-- statement. The old client-side delete relied on the FK cascade to remove
-- children; a stamp has no cascade, so the function does it explicitly —
-- otherwise deleting a campaign would leave twelve orphaned bookings
-- visible with no parent.
--
-- The DELETE policy is kept exactly as it was. `purge_deleted_tasks()` runs
-- as the definer and really does delete, so the cascade still does the rest.
--
-- Safe to run twice.


-- ───────────────────────────────────────────────────────────────────
-- 1. The columns
-- ───────────────────────────────────────────────────────────────────

alter table public.pm_tasks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id);

-- Partial: the vast majority of rows are not deleted, and this index only
-- ever serves the bin and the purge.
create index if not exists pm_tasks_deleted_at_idx
  on public.pm_tasks (deleted_at)
  where deleted_at is not null;

comment on column public.pm_tasks.deleted_at is
  'When this task was deleted. Non-null rows are invisible to every SELECT (see the RLS policy) and are purged 30 days later.';
comment on column public.pm_tasks.deleted_by is
  'Who deleted it. Kept so the bin can say whose mistake to undo.';

/** How long a deleted task can be brought back. */
create or replace function public.task_recovery_days()
returns integer language sql immutable as $$ select 30 $$;

grant execute on function public.task_recovery_days() to authenticated;


-- ───────────────────────────────────────────────────────────────────
-- 2. Out of sight
--
--    017's policies, restated verbatim with one clause added to each. The
--    role logic is NOT changed — this file is about visibility, and a
--    permissions change smuggled into it is how somebody loses access to
--    their own campaigns and nobody knows why.
-- ───────────────────────────────────────────────────────────────────

drop policy if exists "pm_tasks select role aware" on public.pm_tasks;
create policy "pm_tasks select role aware" on public.pm_tasks for select
  using (
    deleted_at is null
    and (
      public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account'])
      or assignee_id    = auth.uid()
      or creator_id     = auth.uid()
      or key_account_id = auth.uid()
      or id in (select task_id from public.task_members where user_id = auth.uid())
    )
  );

drop policy if exists "pm_tasks update by role" on public.pm_tasks;
create policy "pm_tasks update by role" on public.pm_tasks for update
  using (
    deleted_at is null
    and (
      public.has_role(workspace_id, array['owner','admin'])
      or public.has_role(workspace_id, array['marketing'])
      or (public.has_role(workspace_id, array['sales']) and stage = 'draft' and creator_id = auth.uid())
      or key_account_id = auth.uid()
      or assignee_id = auth.uid()
    )
  );


-- ───────────────────────────────────────────────────────────────────
-- 3. Deleting
-- ───────────────────────────────────────────────────────────────────

create or replace function public.soft_delete_task(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_count     integer;
begin
  -- Read past the policy on purpose: this function is allowed to see a row
  -- it is about to hide, and re-deleting an already-deleted task should be
  -- a no-op rather than "no such task".
  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;
  if v_workspace is null then
    raise exception 'No such task: %', p_task_id using errcode = '42704';
  end if;

  -- The same roles the DELETE policy allowed. Deleting is still an
  -- owner/admin act; making it recoverable does not make it casual.
  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin']) then
    raise exception 'Only an owner or an admin can delete a task.' using errcode = '42501';
  end if;

  -- The campaign and its bookings together. A stamp does not cascade, and a
  -- booking whose parent is hidden would otherwise sit on every list with
  -- no campaign behind it.
  update public.pm_tasks
     set deleted_at = now(), deleted_by = auth.uid()
   where (id = p_task_id or parent_task_id = p_task_id)
     and deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.soft_delete_task(uuid) is
  'Hide a task and its bookings. Returns how many rows were stamped. Recoverable for task_recovery_days().';


-- ───────────────────────────────────────────────────────────────────
-- 4. Undeleting
-- ───────────────────────────────────────────────────────────────────

create or replace function public.restore_task(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_deleted   timestamptz;
  v_count     integer;
begin
  select workspace_id, deleted_at into v_workspace, v_deleted
    from public.pm_tasks where id = p_task_id;
  if v_workspace is null then
    raise exception 'No such task: %', p_task_id using errcode = '42704';
  end if;
  if v_deleted is null then
    return 0;   -- already live; nothing to undo
  end if;
  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin']) then
    raise exception 'Only an owner or an admin can restore a task.' using errcode = '42501';
  end if;

  -- Only the children that went WITH it. A booking deleted on its own three
  -- weeks earlier stays deleted — restoring a campaign should not quietly
  -- resurrect something somebody removed on purpose. One second of slack
  -- either side of the parent's stamp covers a single statement's clock.
  update public.pm_tasks
     set deleted_at = null, deleted_by = null
   where (
     id = p_task_id
     or (parent_task_id = p_task_id and deleted_at between v_deleted - interval '1 second'
                                                       and v_deleted + interval '1 second')
   );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 5. The bin
--
--    SECURITY DEFINER because the SELECT policy hides exactly these rows.
--    Returns only what a recovery screen needs to decide — not the money.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.deleted_tasks(p_workspace_id uuid)
returns table (
  id            uuid,
  task_name     text,
  brand_name    text,
  parent_task_id uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  deleted_by_name text,
  bookings      bigint,
  days_left     integer
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         coalesce(t.task_name, t.title),
         t.brand_name,
         t.parent_task_id,
         t.deleted_at,
         t.deleted_by,
         p.full_name,
         (select count(*) from public.pm_tasks c
           where c.parent_task_id = t.id and c.deleted_at is not null),
         greatest(0, public.task_recovery_days()
                     - extract(day from now() - t.deleted_at)::int)
    from public.pm_tasks t
    left join public.profiles p on p.id = t.deleted_by
   where t.workspace_id = p_workspace_id
     and t.deleted_at is not null
     and t.parent_task_id is null          -- campaigns; their bookings go with them
     and public.has_role(t.workspace_id, array['owner','admin'])
   order by t.deleted_at desc;
$$;

revoke all on function public.deleted_tasks(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.deleted_tasks(uuid) to authenticated';
    execute 'grant execute on function public.soft_delete_task(uuid) to authenticated';
    execute 'grant execute on function public.restore_task(uuid) to authenticated';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 6. The purge
--
--    Runs as the definer, so the real DELETE happens and the existing FK
--    cascades take the children, ad lines and tracking rows with it —
--    exactly what the hard delete used to do, thirty days later.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.purge_deleted_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.pm_tasks
   where deleted_at is not null
     and deleted_at < now() - make_interval(days => public.task_recovery_days());
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise notice 'purge_deleted_tasks: removed % task(s) past the recovery window', v_count;
  end if;
  return v_count;
end;
$$;

-- Nobody's browser purges anything. Only the scheduler and the backend.
revoke all on function public.purge_deleted_tasks() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.purge_deleted_tasks() to service_role';
  end if;
end $$;

-- Daily at 03:15 UTC, if pg_cron is available.
--
-- On Supabase: Dashboard → Database → Extensions → enable `pg_cron`, then
-- re-run this file. Without it nothing breaks — deleted tasks simply stay
-- hidden instead of being removed, and `select purge_deleted_tasks();` can
-- be run by hand or from the backend on a schedule.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-deleted-tasks')
      where exists (select 1 from cron.job where jobname = 'purge-deleted-tasks');
    perform cron.schedule(
      'purge-deleted-tasks', '15 3 * * *',
      $cron$ select public.purge_deleted_tasks(); $cron$
    );
    raise notice 'Scheduled purge-deleted-tasks daily at 03:15 UTC.';
  else
    raise notice
      'pg_cron is NOT enabled — deleted tasks will stay hidden but will never be purged. '
      'Enable it under Database -> Extensions and re-run this file, or call '
      'select public.purge_deleted_tasks(); on a schedule from the backend.';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- Proof
-- ───────────────────────────────────────────────────────────────────

select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pm_tasks'
   and column_name in ('deleted_at', 'deleted_by')
 order by column_name;

-- Both policies must mention deleted_at, or a deleted task is still visible.
select polname,
       position('deleted_at' in pg_get_expr(polqual, polrelid)) > 0 as hides_deleted
  from pg_policy p join pg_class c on c.oid = p.polrelid
 where c.relname = 'pm_tasks'
   and polname in ('pm_tasks select role aware', 'pm_tasks update by role')
 order by polname;

select count(*) as already_in_the_bin
  from public.pm_tasks where deleted_at is not null;
