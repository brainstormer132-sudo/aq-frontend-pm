-- ============================================================
-- 038_typed_subtasks_request.sql
-- Typed subtasks + request tracking, plus a trigger that notifies
-- Ops/admin when a quotation/invoice/contract subtask is requested.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- 1) Columns (already added in the Phase 0 paste; kept here for repo history)
alter table public.pm_tasks
  add column if not exists subtask_kind   text,
  add column if not exists request_status text not null default 'not_requested',
  add column if not exists requested_at    timestamptz,
  add column if not exists requested_by    uuid references public.profiles(id),
  add column if not exists request_note    text;

-- 2) Backfill subtask_kind for existing template-spawned subtasks
update public.pm_tasks set subtask_kind = 'quotation'
  where parent_task_id is not null and subtask_kind is null and title ilike '%Quotation%';
update public.pm_tasks set subtask_kind = 'invoice'
  where parent_task_id is not null and subtask_kind is null and title ilike '%Invoice%';
update public.pm_tasks set subtask_kind = 'contract'
  where parent_task_id is not null and subtask_kind is null and title ilike '%Contract%';
update public.pm_tasks set subtask_kind = 'payment'
  where parent_task_id is not null and subtask_kind is null and title ilike '%Payment Confirmation%';
update public.pm_tasks set subtask_kind = 'tracking'
  where parent_task_id is not null and subtask_kind is null and title ilike '%Tracking%';

-- 3) Notify Ops/admin/owner when a request subtask flips to "requested".
--    Reuses the 'task_assigned' notification type (no enum change needed).
create or replace function public.notify_on_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_status = 'requested'
     and (old.request_status is distinct from new.request_status) then
    insert into public.notifications (user_id, type, title, body, link)
    select wm.user_id,
           'task_assigned',
           coalesce(initcap(new.subtask_kind), 'Request') || ' requested',
           coalesce(new.task_name, new.title),
           '/dashboard/workflow?task=' || new.id::text
    from public.workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.role in ('owner', 'admin', 'operations');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_on_request on public.pm_tasks;
create trigger trg_notify_on_request
  after update of request_status on public.pm_tasks
  for each row
  execute function public.notify_on_request();
