-- Reset accounts for BOTH AQ websites.
--
-- 1. Project-management website:
--    - Supabase Auth users
--    - profiles / workspaces / workspace memberships
--    - workflow rows tied to those users/workspaces
--
-- 2. Contract-maker website:
--    - public.users only
--    - The next contract-maker signup becomes admin because auth.py promotes
--      the first user when public.users is empty.
--
-- This keeps approved vendors, bank accounts, pending registrations, contract
-- templates, and generated contract history unless they are directly tied to
-- deleted PM workspace rows.

begin;

-- Keep the PM signup bootstrap healthy after the reset.
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

-- PM app reset. CASCADE clears rows dependent on profiles/workspaces safely.
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

-- Remove workspace-specific service templates while keeping the seeded global
-- service type templates.
delete from public.service_type_steps
where service_type_id in (
  select id from public.service_types where workspace_id is not null
);

delete from public.service_types
where workspace_id is not null;

-- PM website accounts.
delete from auth.users;

-- Contract-maker accounts. Do not touch public.tasks, public.vendors,
-- public.bank_accounts, public.generated_contracts, etc.
delete from public.users;
alter sequence if exists public.users_id_seq restart with 1;

commit;

-- Verify both account systems are empty:
-- select count(*) as pm_auth_users from auth.users;
-- select count(*) as pm_profiles from public.profiles;
-- select count(*) as contract_users from public.users;
--
-- After fresh setup:
--   PM website: sign up -> create workspace -> user should be owner.
--   Contract maker: first signup -> user should be admin.
