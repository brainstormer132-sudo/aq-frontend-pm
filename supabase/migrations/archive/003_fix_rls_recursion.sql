-- ============================================================
-- Fix: infinite recursion in workspace_members RLS
-- ============================================================
-- The previous policies referenced workspace_members from inside
-- their own subquery. When the subquery ran, RLS on workspace_members
-- fired again, triggering the same subquery, recursing forever.
--
-- Postgres detects this and aborts with:
--   "infinite recursion detected in policy for relation workspace_members"
--
-- Fix: do the membership lookup inside a SECURITY DEFINER function.
-- The function runs with the function-owner's privileges, which
-- bypasses RLS on the lookup. Policies use the function instead of
-- a recursive subquery.
--
-- Run this whole file in Supabase SQL Editor.
-- ============================================================

-- ----- Helper functions (security definer = bypass RLS) -----

create or replace function public.is_member_of(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_admin_of(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner','admin')
  );
$$;

create or replace function public.is_manager_or_higher(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner','admin','manager')
  );
$$;

-- ----- workspace_members: drop the recursive policies, recreate -----

drop policy if exists "wm select if same ws"      on public.workspace_members;
drop policy if exists "wm insert by self or admin" on public.workspace_members;
drop policy if exists "wm update by admin"        on public.workspace_members;
drop policy if exists "wm delete by admin"        on public.workspace_members;

create policy "wm select if same ws" on public.workspace_members for select
  using (public.is_member_of(workspace_id));

create policy "wm insert by self or admin" on public.workspace_members for insert
  with check (user_id = auth.uid() or public.is_admin_of(workspace_id));

create policy "wm update by admin" on public.workspace_members for update
  using (public.is_admin_of(workspace_id));

create policy "wm delete by admin" on public.workspace_members for delete
  using (public.is_admin_of(workspace_id));

-- ----- workspaces: rewrite to use the helper too -----

drop policy if exists "workspaces select if member" on public.workspaces;
create policy "workspaces select if member" on public.workspaces for select
  using (public.is_member_of(id));

-- ----- projects -----

drop policy if exists "projects select if ws member" on public.projects;
drop policy if exists "projects insert by member"    on public.projects;
drop policy if exists "projects update by member"    on public.projects;
drop policy if exists "projects delete by admin"     on public.projects;

create policy "projects select if ws member" on public.projects for select
  using (public.is_member_of(workspace_id));
create policy "projects insert by member" on public.projects for insert
  with check (public.is_member_of(workspace_id));
create policy "projects update by member" on public.projects for update
  using (public.is_member_of(workspace_id));
create policy "projects delete by admin" on public.projects for delete
  using (public.is_admin_of(workspace_id));

-- ----- pm_tasks (the join-on-workspace_members in update/delete) -----

drop policy if exists "pm_tasks update by participant" on public.pm_tasks;
drop policy if exists "pm_tasks delete by admin"       on public.pm_tasks;

create policy "pm_tasks update by participant" on public.pm_tasks for update
  using (
    assignee_id = auth.uid()
    or creator_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = pm_tasks.project_id
        and public.is_manager_or_higher(p.workspace_id)
    )
  );
create policy "pm_tasks delete by admin" on public.pm_tasks for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = pm_tasks.project_id
        and public.is_admin_of(p.workspace_id)
    )
  );

-- ----- labels -----

drop policy if exists "labels all if ws member" on public.labels;
create policy "labels all if ws member" on public.labels for all
  using (public.is_member_of(workspace_id));

-- ----- activity_log -----

drop policy if exists "activity_log select if ws member" on public.activity_log;
drop policy if exists "activity_log insert by member"    on public.activity_log;

create policy "activity_log select if ws member" on public.activity_log for select
  using (public.is_member_of(workspace_id));
create policy "activity_log insert by member" on public.activity_log for insert
  with check (public.is_member_of(workspace_id));

-- ----- clients -----

drop policy if exists "clients select if ws member" on public.clients;
drop policy if exists "clients insert by member"    on public.clients;
drop policy if exists "clients update by member"    on public.clients;
drop policy if exists "clients delete by admin"     on public.clients;

create policy "clients select if ws member" on public.clients for select
  using (public.is_member_of(workspace_id));
create policy "clients insert by member" on public.clients for insert
  with check (public.is_member_of(workspace_id));
create policy "clients update by member" on public.clients for update
  using (public.is_member_of(workspace_id));
create policy "clients delete by admin" on public.clients for delete
  using (public.is_admin_of(workspace_id));

-- ----- manager_clients -----

drop policy if exists "manager_clients select if ws member" on public.manager_clients;
drop policy if exists "manager_clients write by admin"      on public.manager_clients;

create policy "manager_clients select if ws member" on public.manager_clients for select
  using (public.is_member_of(workspace_id));
create policy "manager_clients write by admin" on public.manager_clients for all
  using (public.is_admin_of(workspace_id));

-- ----- managed_vendors -----

drop policy if exists "managed_vendors all if ws member" on public.managed_vendors;
create policy "managed_vendors all if ws member" on public.managed_vendors for all
  using (public.is_member_of(workspace_id));

-- ============================================================
-- DONE. Try creating a workspace again — should work now.
-- ============================================================
