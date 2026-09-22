-- ============================================================
-- 120_batch_recycle_bin.sql
-- A deleted legal task comes back for thirty days.
--
-- Siraj: "any deleted tasks stays for 7 days". The number he remembers is
-- the point at which the countdown in Settings turns red; the window itself
-- is THIRTY days, and it is what public.task_recovery_days() returns. This
-- reuses that function rather than declaring a second one, so legal and PM
-- cannot drift apart and changing the window stays a one-line change.
--
-- -- WHY THIS IS NOT THE PM MECHANISM ---------------------------------
--
-- soft_delete_task / restore_task / deleted_tasks / purge_deleted_tasks are
-- all hard-coded to public.pm_tasks. legal.contract_batch is a different
-- table, in a different schema, behind different RLS - staff-only, via
-- has_role(... ['owner','admin','legal']). So the SHAPE is copied and the
-- mechanism is not.
--
-- -- WHAT A SOFT DELETE CHANGES ABOUT THE CONTRACTS --------------------
--
-- legal.contract.batch_id is ON DELETE SET NULL (112): a hard delete of the
-- batch left the contracts alive but ungrouped, immediately and permanently.
-- With a soft delete the batch ROW survives, so batch_id survives with it and
-- the grouping is still there when somebody restores. The contracts ungroup
-- only at purge, thirty days later - which is the old behaviour, just later.
--
-- Nothing here touches a contract. Deleting a task has never deleted the
-- contracts raised from it and still does not; they stay in the Register.
--
-- -- WHY A COLUMN AND NOT A STATUS ------------------------------------
--
-- Same reasoning as 119 for templates: a column is reversible, needs no
-- state machine, and cannot be confused with a batch's own lifecycle. The
-- pair is kept honest by a CHECK - a row cannot be half-deleted.
-- ============================================================

set search_path = legal, public;

-- 1. the columns ---------------------------------------------------

alter table legal.contract_batch
  add column if not exists deleted_at timestamptz;

alter table legal.contract_batch
  add column if not exists deleted_by uuid;

comment on column legal.contract_batch.deleted_at is
  'When the task was sent to the bin. Null while it is live. Purged after public.task_recovery_days().';
comment on column legal.contract_batch.deleted_by is
  'Who sent it there. Set and cleared with deleted_at - see contract_batch_deleted_chk.';

-- No actor without a deletion.
--
-- The obvious constraint here is "both or neither", and it is WRONG. It was
-- written that way first, and the probe below - calling soft_delete_batch the
-- way PostgREST calls it, rather than setting the columns by hand - failed
-- immediately:
--
--   new row for relation "contract_batch" violates check constraint
--   "contract_batch_deleted_chk"
--
-- because `auth.uid()` is NULL whenever there is no JWT on the request, and
-- the function writes what auth.uid() returns. Under "both or neither" the
-- delete does not record a nameless actor - it THROWS, and the task does not
-- get deleted at all.
--
-- "Deleted by somebody we cannot name" is a real and honest state: a backend
-- job, a service-role call, a session whose claim did not survive. The bin
-- screen already left-joins profiles and simply shows no name. What is NOT a
-- real state is an actor with no deletion, so that is what the check forbids.
alter table legal.contract_batch drop constraint if exists contract_batch_deleted_chk;
alter table legal.contract_batch
  add constraint contract_batch_deleted_chk
  check (deleted_by is null or deleted_at is not null);

-- Partial, because the live list is the common read and it is the one that
-- must stay fast. The bin is opened rarely and is small by construction.
create index if not exists idx_legal_batch_deleted on legal.contract_batch(deleted_at)
  where deleted_at is not null;

-- 2. the policy hides them -----------------------------------------
--
-- IN THE POLICY, NOT IN TYPESCRIPT. This is the lesson 073 wrote down for
-- pm_tasks and it applies here for the same reason: every screen that lists
-- batches would otherwise have to remember `.is('deleted_at', null)`, and one
-- that forgets shows a deleted task as live. A row in the bin is invisible to
-- ordinary reads and cannot be edited - the bin's own RPCs are SECURITY
-- DEFINER and see past this.

drop policy if exists contract_batch_rw on legal.contract_batch;
create policy contract_batch_rw on legal.contract_batch
  using (deleted_at is null and public.has_role(workspace_id, array['owner','admin','legal']))
  with check (public.has_role(workspace_id, array['owner','admin','legal']));

-- 3. delete, restore, list, purge ----------------------------------
--
-- All SECURITY DEFINER, because every one of them has to touch rows the
-- policy above hides. Each re-checks has_role itself - a definer function
-- that does not is a hole in the RLS it steps around.

create or replace function legal.soft_delete_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = legal, public
as $$
declare
  v_ws uuid;
  v_n  integer;
begin
  select workspace_id into v_ws from legal.contract_batch where id = p_batch_id;
  if v_ws is null then
    return 0;                       -- already gone, or never existed
  end if;
  if not public.has_role(v_ws, array['owner','admin','legal']) then
    raise exception 'legal: not allowed to delete this task';
  end if;
  update legal.contract_batch
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_batch_id and deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function legal.restore_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = legal, public
as $$
declare
  v_ws uuid;
  v_n  integer;
begin
  select workspace_id into v_ws from legal.contract_batch where id = p_batch_id;
  if v_ws is null then
    return 0;
  end if;
  if not public.has_role(v_ws, array['owner','admin','legal']) then
    raise exception 'legal: not allowed to restore this task';
  end if;
  update legal.contract_batch
     set deleted_at = null, deleted_by = null
   where id = p_batch_id and deleted_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- What the bin screen needs to decide, and nothing more. `contracts` is the
-- number that would come back with it, which is the fact that makes restoring
-- worth doing; `days_left` is computed the same way deleted_tasks computes it.
create or replace function legal.deleted_batches(p_workspace_id uuid)
returns table (
  id              uuid,
  title           text,
  deleted_at      timestamptz,
  deleted_by      uuid,
  deleted_by_name text,
  contracts       bigint,
  days_left       integer
)
language sql
stable
security definer
set search_path = legal, public
as $$
  select b.id,
         b.title,
         b.deleted_at,
         b.deleted_by,
         p.full_name,
         (select count(*) from legal.contract c where c.batch_id = b.id),
         greatest(0, public.task_recovery_days()
                     - extract(day from now() - b.deleted_at)::int)
    from legal.contract_batch b
    left join public.profiles p on p.id = b.deleted_by
   where b.workspace_id = p_workspace_id
     and b.deleted_at is not null
     and public.has_role(b.workspace_id, array['owner','admin','legal'])
   order by b.deleted_at desc;
$$;

-- The hard delete, thirty days later. Exactly what `remove` used to do the
-- moment somebody clicked the cross - the contracts ungroup here, because
-- batch_id is ON DELETE SET NULL, and they keep existing.
create or replace function legal.purge_deleted_batches()
returns integer
language plpgsql
security definer
set search_path = legal, public
as $$
declare
  v_count integer;
begin
  delete from legal.contract_batch
   where deleted_at is not null
     and deleted_at < now() - make_interval(days => public.task_recovery_days());
  get diagnostics v_count = row_count;
  if v_count > 0 then
    raise notice 'purge_deleted_batches: removed % task(s) past the recovery window', v_count;
  end if;
  return v_count;
end;
$$;

-- 4. who may call what ---------------------------------------------

revoke all on function legal.soft_delete_batch(uuid) from public;
revoke all on function legal.restore_batch(uuid) from public;
revoke all on function legal.deleted_batches(uuid) from public;
revoke all on function legal.purge_deleted_batches() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function legal.soft_delete_batch(uuid) to authenticated';
    execute 'grant execute on function legal.restore_batch(uuid) to authenticated';
    execute 'grant execute on function legal.deleted_batches(uuid) to authenticated';
  end if;
  -- Nobody's browser purges anything. Only the scheduler and the backend.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function legal.purge_deleted_batches() to service_role';
  end if;
end $$;

-- 5. the schedule ---------------------------------------------------
--
-- 03:20 UTC, five minutes after purge-deleted-tasks, so the two are legible
-- apart in the log rather than interleaved.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('purge-deleted-batches')
      where exists (select 1 from cron.job where jobname = 'purge-deleted-batches');
    perform cron.schedule(
      'purge-deleted-batches', '20 3 * * *',
      $cron$ select legal.purge_deleted_batches(); $cron$
    );
    raise notice 'Scheduled purge-deleted-batches daily at 03:20 UTC.';
  else
    raise notice
      'pg_cron is NOT enabled - deleted tasks will stay hidden but will never be purged. '
      'Enable it under Database -> Extensions and re-run this file, or call '
      'select legal.purge_deleted_batches(); on a schedule from the backend.';
  end if;
end $$;

-- 6. prove the rules, then roll it back ------------------------------
--
-- Same shape as 119. Every claim this migration makes is exercised against
-- the real database and then undone, so a rule that does not hold fails HERE
-- rather than on the screen a week later.

do $$
declare
  ws uuid;
  b  uuid;
  n  integer;
begin
  select id into ws from public.workspaces order by created_at limit 1;
  if ws is null then
    raise notice 'legal: no workspace to probe against - skipping the checks';
    return;
  end if;

  begin
    insert into legal.contract_batch (workspace_id, title, shared)
    values (ws, 'probe: 120', '{}'::jsonb) returning id into b;

    -- The CHECK forbids an actor with no deletion.
    begin
      update legal.contract_batch set deleted_by = gen_random_uuid() where id = b;
      raise exception 'legal: deleted_by was accepted without deleted_at';
    exception
      when check_violation then null;
    end;

    -- THE ONE THAT MATTERS. Call it the way PostgREST does, with no JWT, so
    -- auth.uid() is null. Under a "both or neither" check this threw and the
    -- task was never deleted; the probe is here so it can never come back.
    if legal.soft_delete_batch(b) <> 1 then
      raise exception 'legal: soft_delete_batch did not delete the task';
    end if;
    if (select deleted_at from legal.contract_batch where id = b) is null then
      raise exception 'legal: soft_delete_batch left deleted_at null';
    end if;
    -- Deleting it again is a no-op, not a second delete.
    if legal.soft_delete_batch(b) <> 0 then
      raise exception 'legal: soft_delete_batch deleted an already-deleted task';
    end if;
    -- And it comes back.
    if legal.restore_batch(b) <> 1 then
      raise exception 'legal: restore_batch did not bring the task back';
    end if;
    if (select deleted_by from legal.contract_batch where id = b) is not null then
      raise exception 'legal: restore_batch left deleted_by behind';
    end if;
    if legal.restore_batch(b) <> 0 then
      raise exception 'legal: restore_batch restored a live task';
    end if;

    -- The window is the PM one, not a second copy of it.
    if public.task_recovery_days() is null or public.task_recovery_days() < 1 then
      raise exception 'legal: task_recovery_days() is not a usable window';
    end if;

    -- A purge must never take a row that is still inside the window.
    perform legal.soft_delete_batch(b);
    select legal.purge_deleted_batches() into n;
    if not exists (select 1 from legal.contract_batch where id = b) then
      raise exception 'legal: purge removed a task that was still inside its window';
    end if;

    -- And it must take one that is past it.
    update legal.contract_batch
       set deleted_at = now() - make_interval(days => public.task_recovery_days() + 1)
     where id = b;
    perform legal.purge_deleted_batches();
    if exists (select 1 from legal.contract_batch where id = b) then
      raise exception 'legal: purge left a task that was past its window';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: the batch recycle-bin rules all hold';
  end;
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='legal' and table_name='contract_batch'
--       and column_name in ('deleted_at','deleted_by'))                  as cols,
--   (select count(*) from pg_constraint
--     where conname='contract_batch_deleted_chk')                        as chk,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname in
--       ('soft_delete_batch','restore_batch','deleted_batches','purge_deleted_batches')) as fns,
--   public.task_recovery_days()                                          as window_days,
--   (select count(*) from legal.contract_batch where deleted_at is not null) as in_bin;
-- expected: 2 | 1 | 4 | 30 | 0
