-- Emergency PM-app admin/owner bootstrap.
--
-- Use this if you can sign in to the task-management website but your role is
-- not owner/admin, or you are stuck with "no role".
--
-- 1. Replace the email below.
-- 2. Run in Supabase SQL Editor.
-- 3. Refresh /dashboard/workflow.
--
-- This affects the PM app only. The contract maker has its own public.users
-- login table and is not changed by this file.

do $$
declare
  admin_email text := 'replace-with-your-email@example.com';
  admin_user_id uuid;
  ws_id uuid;
begin
  select id
  into admin_user_id
  from auth.users
  where lower(email) = lower(admin_email)
  order by created_at asc
  limit 1;

  if admin_user_id is null then
    raise exception 'No Supabase Auth user found for email: %', admin_email;
  end if;

  insert into public.profiles (id, full_name)
  values (admin_user_id, admin_email)
  on conflict (id) do update
    set full_name = coalesce(public.profiles.full_name, excluded.full_name);

  select id
  into ws_id
  from public.workspaces
  order by created_at asc
  limit 1;

  if ws_id is null then
    insert into public.workspaces (name, slug, owner_id)
    values ('AQ Creativity', 'aq-creativity', admin_user_id)
    returning id into ws_id;
  else
    update public.workspaces
    set owner_id = admin_user_id
    where id = ws_id;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, admin_user_id, 'owner')
  on conflict (workspace_id, user_id) do update
    set role = 'owner';
end $$;

-- Verify:
-- select u.email, wm.role, w.name as workspace
-- from public.workspace_members wm
-- join auth.users u on u.id = wm.user_id
-- join public.workspaces w on w.id = wm.workspace_id;
