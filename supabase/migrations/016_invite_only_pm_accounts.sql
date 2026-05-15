-- Invite-only PM accounts after the first workspace exists.
--
-- Flow:
--   1. First PM user can sign up and create the first workspace.
--   2. After that, new users need a workspace_invites token tied to their email.
--   3. Invites expire after 24 hours.
--   4. Users cannot self-add to workspace_members anymore.

create extension if not exists "uuid-ossp";

create table if not exists public.workspace_invites (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member'
    check (role in ('owner','admin','operations','sales','marketing','key_account','member')),
  token text not null unique default (
    replace(uuid_generate_v4()::text, '-', '') || replace(uuid_generate_v4()::text, '-', '')
  ),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null
);

alter table public.workspace_invites enable row level security;

grant select, insert, update, delete on public.workspace_invites to anon, authenticated;

create index if not exists idx_workspace_invites_token on public.workspace_invites(token);
create index if not exists idx_workspace_invites_workspace on public.workspace_invites(workspace_id);
create index if not exists idx_workspace_invites_email on public.workspace_invites(lower(email));

create or replace function public.has_any_workspace()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.workspaces);
$$;

grant execute on function public.has_any_workspace() to anon, authenticated;

create or replace function public.validate_workspace_invite(invite_token text)
returns table (
  valid boolean,
  reason text,
  email text,
  role text,
  workspace_name text,
  expires_at timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  inv record;
begin
  select wi.*, w.name as ws_name
  into inv
  from public.workspace_invites wi
  join public.workspaces w on w.id = wi.workspace_id
  where wi.token = invite_token
  limit 1;

  if inv.id is null then
    return query select false, 'Invite not found', null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  if inv.accepted_at is not null then
    return query select false, 'Invite already used', inv.email, inv.role, inv.ws_name, inv.expires_at;
    return;
  end if;

  if inv.expires_at <= now() then
    return query select false, 'Invite expired', inv.email, inv.role, inv.ws_name, inv.expires_at;
    return;
  end if;

  return query select true, 'OK', inv.email, inv.role, inv.ws_name, inv.expires_at;
end;
$$;

grant execute on function public.validate_workspace_invite(text) to anon, authenticated;

create or replace function public.create_workspace_invite(
  ws_id uuid,
  invite_email text,
  invite_role text default 'member'
)
returns table (
  id uuid,
  token text,
  email text,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.workspace_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if invite_role not in ('owner','admin','operations','sales','marketing','key_account','member') then
    raise exception 'Invalid role: %', invite_role;
  end if;

  if invite_role = 'owner' and not public.has_role(ws_id, array['owner']) then
    raise exception 'Only owners can invite another owner';
  end if;

  if not public.has_role(ws_id, array['owner','admin']) then
    raise exception 'Only owners and admins can invite teammates';
  end if;

  insert into public.workspace_invites (workspace_id, email, role, invited_by)
  values (ws_id, lower(trim(invite_email)), invite_role, auth.uid())
  returning * into created;

  return query select created.id, created.token, created.email, created.role, created.expires_at;
end;
$$;

grant execute on function public.create_workspace_invite(uuid, text, text) to authenticated;

create or replace function public.claim_workspace_invite(invite_token text)
returns table (
  workspace_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  caller_email text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  caller_email := lower(coalesce(auth.jwt()->>'email', ''));

  select *
  into inv
  from public.workspace_invites
  where token = invite_token
  for update;

  if inv.id is null then
    raise exception 'Invite not found';
  end if;

  if inv.accepted_at is not null then
    raise exception 'Invite already used';
  end if;

  if inv.expires_at <= now() then
    raise exception 'Invite expired';
  end if;

  if lower(inv.email) <> caller_email then
    raise exception 'This invite is for %, but you are signed in as %', inv.email, caller_email;
  end if;

  insert into public.profiles (id, full_name)
  values (auth.uid(), caller_email)
  on conflict (id) do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, auth.uid(), inv.role)
  on conflict (workspace_id, user_id) do update
    set role = excluded.role;

  update public.workspace_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return query select inv.workspace_id, inv.role;
end;
$$;

grant execute on function public.claim_workspace_invite(text) to authenticated;

drop policy if exists "workspace_invites select by admin" on public.workspace_invites;
drop policy if exists "workspace_invites write by admin" on public.workspace_invites;

create policy "workspace_invites select by admin" on public.workspace_invites for select
  using (public.has_role(workspace_id, array['owner','admin']));

create policy "workspace_invites write by admin" on public.workspace_invites for all
  using (public.has_role(workspace_id, array['owner','admin']))
  with check (public.has_role(workspace_id, array['owner','admin']));

-- First workspace only. Once any workspace exists, new people must be invited
-- into an existing workspace instead of creating their own.
drop policy if exists "workspaces insert by owner" on public.workspaces;
create policy "workspaces insert first owner only" on public.workspaces for insert
  with check (auth.uid() = owner_id and not public.has_any_workspace());

-- Users may no longer self-add to any workspace. Admins can add rows, and the
-- SECURITY DEFINER invite/workspace triggers can still insert owner/member rows.
drop policy if exists "wm insert by self or admin" on public.workspace_members;
drop policy if exists "wm insert by admin" on public.workspace_members;
create policy "wm insert by admin" on public.workspace_members for insert
  with check (public.is_admin_of(workspace_id));

-- Verification:
-- select public.has_any_workspace();
-- select * from public.workspace_invites order by created_at desc;
