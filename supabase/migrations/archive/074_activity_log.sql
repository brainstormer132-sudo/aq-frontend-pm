-- 074_activity_log.sql
--
-- A log of what happened to a task, and who did it.
--
-- ── WHAT WAS ACTUALLY THERE ───────────────────────────────────────
--
-- `activity_log` has existed since 002. It has RLS, two indexes, and the
-- dashboard reads it into a "Recent activity" panel.
--
-- Nothing has ever written to it. `grep` across every migration and the
-- whole app finds one reader — `useRecentActivity` — and no writer at all.
-- So that panel has said "Nothing yet." since the day it shipped, and it
-- was telling the truth.
--
-- This makes it a real log, and starts by fixing three things that would
-- have made it useless for the thing it is most needed for.
--
-- ── THE THREE FIXES ───────────────────────────────────────────────
--
-- 1. **task_id was `on delete cascade`.**
--
--    An audit log whose rows are deleted along with the thing they record
--    is not an audit log. Purging a task at 30 days (073) would have taken
--    the record of its deletion with it — the one row you would want six
--    months later, destroyed by the event it exists to describe.
--
--    Now `on delete set null`: the link degrades, the entry survives. And
--    because the row it pointed at may be gone, every entry carries the
--    task's NAME at the time, so the log still reads as English once the
--    task no longer exists.
--
-- 2. **`action` was an enum with ten values,** none of them "restored" or
--    "purged". Widened to text with a check constraint. Adding a value to
--    an enum cannot be done in the same transaction that uses it, which
--    makes an enum a poor fit for a list that will keep growing; a check
--    constraint is one `alter` away from the next verb.
--
-- 3. **`user_id` was NOT NULL.** The purge runs on a schedule with no
--    `auth.uid()`, so the system's own actions could not be recorded — the
--    entries most worth having, since nobody was there to see them.
--
-- ── WHAT IT IS NOT ────────────────────────────────────────────────
--
-- Append-only by omission, deliberately: there is no update policy and no
-- delete policy on this table, so a member can add an entry and nobody can
-- quietly edit one afterwards.
--
-- It is not a change-data-capture of every field. It records the events a
-- person would ask about — created, deleted, restored, purged, completed —
-- with enough detail to answer "what was that, and who did it".
--
-- Safe to run twice.


-- ───────────────────────────────────────────────────────────────────
-- 1. Make it survive what it records
-- ───────────────────────────────────────────────────────────────────

do $$
declare
  v_con text;
begin
  select conname into v_con
    from pg_constraint
   where conrelid = 'public.activity_log'::regclass
     and contype = 'f'
     and pg_get_constraintdef(oid) like '%pm_tasks%';
  if v_con is not null then
    execute format('alter table public.activity_log drop constraint %I', v_con);
  end if;
end $$;

alter table public.activity_log
  add constraint activity_log_task_id_fkey
  foreign key (task_id) references public.pm_tasks(id) on delete set null;

-- The name at the time. Without it, an entry whose task has been purged
-- reads "Someone deleted" and nothing else.
alter table public.activity_log
  add column if not exists entity_name text,
  add column if not exists entity_kind text;

comment on column public.activity_log.entity_name is
  'What the task was called when this happened. Kept because task_id goes null once the task is purged.';
comment on column public.activity_log.entity_kind is
  'campaign | booking — which of the two a pm_tasks row was.';

-- The scheduler has no auth.uid(). Its entries are the ones nobody was
-- awake for, so they are exactly the ones that must not be dropped.
alter table public.activity_log alter column user_id drop not null;

comment on column public.activity_log.user_id is
  'Who did it. NULL means the system did — the nightly purge, or any other scheduled job.';


-- ───────────────────────────────────────────────────────────────────
-- 2. A list of verbs that can grow
-- ───────────────────────────────────────────────────────────────────

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'activity_log'
       and column_name = 'action' and udt_name = 'activity_action'
  ) then
    alter table public.activity_log
      alter column action type text using action::text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'activity_log_action_chk'
  ) then
    alter table public.activity_log
      add constraint activity_log_action_chk check (action in (
        -- 002's ten, kept verbatim so nothing already written is rejected
        'created','updated','deleted','completed',
        'assigned','unassigned','commented','moved',
        'status_changed','priority_changed',
        -- 073's recycle bin
        'restored','purged',
        -- the paperwork, which is what people actually ask about later
        'contract_requested','contract_generated','sheet_published'
      ));
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 3. One way to write an entry
--
--    SECURITY DEFINER so the functions in 073 can log an event about a task
--    they have just made invisible. A logger that cannot see what it is
--    logging records nothing, which is the failure mode worth designing
--    away.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.log_task_event(
  p_task_id   uuid,
  p_action    text,
  p_details   jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws   uuid;
  v_name text;
  v_kind text;
begin
  select t.workspace_id,
         coalesce(t.task_name, t.title),
         case when t.parent_task_id is null then 'campaign' else 'booking' end
    into v_ws, v_name, v_kind
    from public.pm_tasks t
   where t.id = p_task_id;

  -- No workspace means no task — nothing to log, and nothing to shout
  -- about. A logger must never be the reason an action fails.
  if v_ws is null then return; end if;

  insert into public.activity_log
    (workspace_id, task_id, user_id, action, details, entity_name, entity_kind)
  values
    (v_ws, p_task_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb), v_name, v_kind);
exception when others then
  -- Same rule, stated in code: logging is never allowed to break the thing
  -- it is describing.
  return;
end;
$$;

revoke all on function public.log_task_event(uuid, text, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.log_task_event(uuid, text, jsonb) to authenticated';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 4. The recycle bin writes to it
--
--    073's three functions, restated with logging. Everything else about
--    them is unchanged.
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
  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;
  if v_workspace is null then
    raise exception 'No such task: %', p_task_id using errcode = '42704';
  end if;

  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin']) then
    raise exception 'Only an owner or an admin can delete a task.' using errcode = '42501';
  end if;

  -- Logged BEFORE the stamp, while the task is still readable. Afterwards
  -- the SELECT policy hides it, and log_task_event is security definer for
  -- exactly this reason — but doing it in the readable order costs nothing
  -- and does not depend on that.
  perform public.log_task_event(p_task_id, 'deleted', jsonb_build_object(
    'bookings', (select count(*) from public.pm_tasks c
                  where c.parent_task_id = p_task_id and c.deleted_at is null),
    'recovery_days', public.task_recovery_days()
  ));

  update public.pm_tasks
     set deleted_at = now(), deleted_by = auth.uid()
   where (id = p_task_id or parent_task_id = p_task_id)
     and deleted_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
  if v_deleted is null then return 0; end if;
  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin']) then
    raise exception 'Only an owner or an admin can restore a task.' using errcode = '42501';
  end if;

  update public.pm_tasks
     set deleted_at = null, deleted_by = null
   where (
     id = p_task_id
     or (parent_task_id = p_task_id and deleted_at between v_deleted - interval '1 second'
                                                       and v_deleted + interval '1 second')
   );

  get diagnostics v_count = row_count;

  perform public.log_task_event(p_task_id, 'restored', jsonb_build_object(
    'rows', v_count,
    'deleted_at', v_deleted
  ));
  return v_count;
end;
$$;

create or replace function public.purge_deleted_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_count integer := 0;
begin
  -- Row by row, on purpose. A single DELETE would be one statement and no
  -- record of WHAT it removed — and a purge is the one event whose subject
  -- is guaranteed not to exist afterwards, so the log has to be written
  -- while the row is still there to describe.
  for r in
    select id from public.pm_tasks
     where deleted_at is not null
       and deleted_at < now() - make_interval(days => public.task_recovery_days())
       and parent_task_id is null        -- children go with the cascade
  loop
    perform public.log_task_event(r.id, 'purged', jsonb_build_object(
      'after_days', public.task_recovery_days()
    ));
    delete from public.pm_tasks where id = r.id;
    v_count := v_count + 1;
  end loop;

  -- Bookings deleted on their own, whose parent is still live.
  for r in
    select id from public.pm_tasks
     where deleted_at is not null
       and deleted_at < now() - make_interval(days => public.task_recovery_days())
  loop
    perform public.log_task_event(r.id, 'purged', jsonb_build_object(
      'after_days', public.task_recovery_days()
    ));
    delete from public.pm_tasks where id = r.id;
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    raise notice 'purge_deleted_tasks: removed % task(s) past the recovery window', v_count;
  end if;
  return v_count;
end;
$$;


-- ───────────────────────────────────────────────────────────────────
-- 5. Reading it
--
--    003's select policy already limits it to workspace members. This adds
--    the reader the log needs: names resolved, newest first, and entries
--    whose task is gone still readable.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.activity_feed(
  p_workspace_id uuid,
  p_limit        integer default 50
)
returns table (
  id          uuid,
  task_id     uuid,
  action      text,
  entity_name text,
  entity_kind text,
  details     jsonb,
  user_id     uuid,
  user_name   text,
  created_at  timestamptz,
  /** False once the task has been purged — the entry outlives its subject. */
  task_exists boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.task_id, a.action, a.entity_name, a.entity_kind, a.details,
         a.user_id, p.full_name, a.created_at, a.task_id is not null
    from public.activity_log a
    left join public.profiles p on p.id = a.user_id
   where a.workspace_id = p_workspace_id
     and public.is_member_of(a.workspace_id)
   order by a.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

revoke all on function public.activity_feed(uuid, integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.activity_feed(uuid, integer) to authenticated';
  end if;
end $$;

create index if not exists activity_log_ws_created_idx
  on public.activity_log (workspace_id, created_at desc);


-- ───────────────────────────────────────────────────────────────────
-- Proof
-- ───────────────────────────────────────────────────────────────────

-- Must be SET NULL. If this says CASCADE, purging a task still destroys
-- the record of the purge.
select confdeltype = 'n' as task_id_is_set_null
  from pg_constraint
 where conrelid = 'public.activity_log'::regclass
   and conname = 'activity_log_task_id_fkey';

select is_nullable as user_id_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'activity_log'
   and column_name = 'user_id';

select count(*) as entries_so_far from public.activity_log;
