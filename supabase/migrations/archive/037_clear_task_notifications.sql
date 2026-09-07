-- ============================================================
-- Clear inbox notifications when a task is deleted
-- ------------------------------------------------------------
-- Notifications reference a task only through their `link` column
-- ("/dashboard/workflow?task=<uuid>") — there is no FK, so deleting a
-- pm_task used to leave orphaned inbox items pointing at a task that no
-- longer exists. This trigger removes them.
--
-- Because it runs FOR EACH ROW on delete, cascade-deleted subtasks
-- (parent_task_id ON DELETE CASCADE) fire it too, so a parent deletion
-- clears the whole tree's notifications. SECURITY DEFINER lets it clear
-- every user's notifications, not just the deleter's.
-- ============================================================

create or replace function public.clear_task_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
  where link like '%task=' || old.id::text || '%';
  return old;
end;
$$;

drop trigger if exists trg_clear_task_notifications on public.pm_tasks;
create trigger trg_clear_task_notifications
  after delete on public.pm_tasks
  for each row execute function public.clear_task_notifications();

-- One-time cleanup of notifications already orphaned by past deletions.
delete from public.notifications n
where n.link like '%task=%'
  and not exists (
    select 1 from public.pm_tasks t
    where n.link like '%task=' || t.id::text || '%'
  );
