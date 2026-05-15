-- ============================================================
-- Fix: infinite recursion in pm_tasks ↔ task_members policies
-- ============================================================
-- pm_tasks SELECT policy queried task_members.
-- task_members policy queried pm_tasks (`task_id in (select id from pm_tasks)`).
-- Each call re-fired the other's policy → recursion.
--
-- Same trick we used on workspace_members: a SECURITY DEFINER
-- helper that does the cross-table lookup without firing RLS.
-- Plus, drop the recursive policies and rewrite using the helper.
--
-- This also fixes the same pattern on task_assignments, task_labels,
-- and comments which all reference `pm_tasks` from inside their RLS.
-- ============================================================

-- ----- Helper: workspace id of a given task (RLS-free) -----
create or replace function public.task_workspace_id(t_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id from public.pm_tasks where id = t_id;
$$;

-- ----- pm_tasks SELECT — drop and recreate without recursion -----
drop policy if exists "pm_tasks select"                    on public.pm_tasks;
drop policy if exists "pm_tasks select if project visible" on public.pm_tasks;

create policy "pm_tasks select" on public.pm_tasks for select
  using (
    public.has_role(
      workspace_id,
      array['owner','admin','operations','marketing','sales','key_account']
    )
    or assignee_id    = auth.uid()
    or creator_id     = auth.uid()
    or key_account_id = auth.uid()
    -- task_members visibility: subquery here is OK because task_members'
    -- own SELECT policy below doesn't query pm_tasks anymore.
    or id in (
      select task_id from public.task_members where user_id = auth.uid()
    )
  );

-- ----- task_members — fully detach from pm_tasks recursion -----
drop policy if exists "task_members all if task visible" on public.task_members;
drop policy if exists "task_members select"               on public.task_members;
drop policy if exists "task_members write"                on public.task_members;

create policy "task_members select" on public.task_members for select
  using (
    user_id = auth.uid()
    or public.has_role(
      public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','key_account']
    )
  );

create policy "task_members write" on public.task_members for all
  using (
    public.has_role(
      public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','key_account']
    )
  );

-- ----- task_assignments — same fix -----
drop policy if exists "task_assignments all if task visible" on public.task_assignments;
drop policy if exists "task_assignments select"              on public.task_assignments;
drop policy if exists "task_assignments write"               on public.task_assignments;

create policy "task_assignments select" on public.task_assignments for select
  using (
    user_id = auth.uid()
    or public.has_role(
      public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','key_account']
    )
  );

create policy "task_assignments write" on public.task_assignments for all
  using (
    public.has_role(
      public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','key_account']
    )
  );

-- ----- task_labels — same fix (anyone with workspace access can label) -----
drop policy if exists "task_labels all if task visible" on public.task_labels;
drop policy if exists "task_labels all"                  on public.task_labels;

create policy "task_labels all" on public.task_labels for all
  using (
    public.has_role(
      public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member']
    )
  );

-- ----- comments — same recursion vector, same fix -----
drop policy if exists "comments select if task visible" on public.comments;
drop policy if exists "comments select"                 on public.comments;

create policy "comments select" on public.comments for select
  using (
    public.has_role(
      public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member']
    )
  );

-- (comments INSERT / UPDATE / DELETE policies from 002 still apply — they
-- check `auth.uid() = author_id` only, which doesn't recurse.)

-- ============================================================
-- DONE. Reload /dashboard/workflow — pm_tasks queries should now succeed.
-- ============================================================
