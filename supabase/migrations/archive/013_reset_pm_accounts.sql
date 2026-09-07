-- Reset the project-management frontend so you can start with a fresh signup.
--
-- This clears Supabase Auth users and PM-app workspace data.
-- It intentionally does NOT delete the contract app's public.users table.
--
-- Run this in Supabase SQL Editor, then clear browser site data for localhost.

begin;

-- Recreate the auth/profile bootstrap trigger in case a previous reset or
-- partial migration left the PM app without an automatic profile creator.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set full_name = excluded.full_name,
        avatar_url = excluded.avatar_url;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Recreate the workspace-owner bootstrap too. The first workspace created by
-- a fresh user should always make that user owner/admin for the PM app.
create or replace function public.add_workspace_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.add_workspace_owner_as_member();

-- Clear workflow/app data first. CASCADE handles dependent rows safely.
truncate table
  public.contract_requests,
  public.task_attachments,
  public.comments,
  public.task_labels,
  public.task_assignments,
  public.task_members,
  public.task_service_types,
  public.pm_tasks,
  public.sections,
  public.projects,
  public.notifications,
  public.activity_log,
  public.manager_clients,
  public.client_brands,
  public.clients,
  public.managed_vendors,
  public.labels,
  public.workspace_members,
  public.workspaces,
  public.profiles
restart identity cascade;

-- Keep the seeded global service templates, but remove workspace-specific ones.
delete from public.service_type_steps
where service_type_id in (
  select id from public.service_types where workspace_id is not null
);

delete from public.service_types
where workspace_id is not null;

-- Remove PM frontend accounts from Supabase Auth.
-- If Supabase blocks this in SQL Editor for your project, delete users from
-- Authentication -> Users in the dashboard instead.
delete from auth.users;

commit;

-- Quick verification after running:
-- select count(*) as auth_users from auth.users;
-- select count(*) as profiles from public.profiles;
-- select count(*) as workspaces from public.workspaces;
--
-- After signing up and creating the first workspace, verify admin/owner:
-- select p.full_name, wm.role
-- from public.workspace_members wm
-- join public.profiles p on p.id = wm.user_id;
