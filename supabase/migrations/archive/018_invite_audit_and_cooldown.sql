-- Invite audit log + resend tracking + cooldown enforcement.
--
-- Adds:
--   1. resend_count and last_resent_at columns on workspace_invites
--   2. invite_events table — append-only log of every invite action
--   3. record_invite_resend() RPC — enforces 60s cooldown per invite
--   4. event triggers that auto-log create / accept / delete / role-change
--
-- Run after 017_invite_duration_and_operations_permissions.sql.

-- 1. Track resend usage on the invite itself (cheap to read for UI).
alter table public.workspace_invites
  add column if not exists resend_count integer not null default 0;

alter table public.workspace_invites
  add column if not exists last_resent_at timestamptz;

-- 2. Append-only audit log.
create table if not exists public.invite_events (
  id uuid primary key default uuid_generate_v4(),
  invite_id uuid references public.workspace_invites(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- snapshot fields (so the row stays useful even after the invite is deleted)
  invite_email text not null,
  invite_role text not null,
  action text not null check (action in (
    'created','resent','accepted','revoked','expired','role_changed','resend_failed'
  )),
  actor_id uuid references public.profiles(id) on delete set null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_invite_events_workspace
  on public.invite_events (workspace_id, created_at desc);
create index if not exists idx_invite_events_invite
  on public.invite_events (invite_id);

alter table public.invite_events enable row level security;
grant select, insert on public.invite_events to authenticated;

drop policy if exists "invite_events read by admin" on public.invite_events;
create policy "invite_events read by admin" on public.invite_events for select
  using (public.has_role(workspace_id, array['owner','admin']));

-- Inserts go through SECURITY DEFINER helpers, so block direct inserts.
drop policy if exists "invite_events no direct insert" on public.invite_events;
create policy "invite_events no direct insert" on public.invite_events for insert
  with check (false);

-- 3. Internal logger — bypasses RLS via SECURITY DEFINER.
create or replace function public._log_invite_event(
  p_invite_id uuid,
  p_workspace_id uuid,
  p_email text,
  p_role text,
  p_action text,
  p_actor uuid,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.invite_events
    (invite_id, workspace_id, invite_email, invite_role, action, actor_id, detail)
  values
    (p_invite_id, p_workspace_id, p_email, p_role, p_action, p_actor, p_detail);
end;
$$;

revoke all on function public._log_invite_event(uuid, uuid, text, text, text, uuid, jsonb) from public;

-- 4. Wrap create_workspace_invite to also log an event.
create or replace function public.create_workspace_invite(
  ws_id uuid,
  invite_email text,
  invite_role text default 'member',
  expires_hours integer default 24
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
  hours integer;
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

  hours := coalesce(expires_hours, 24);
  if hours not in (1, 12, 24) then
    raise exception 'Invalid expires_hours: %', hours;
  end if;

  insert into public.workspace_invites (workspace_id, email, role, invited_by, expires_at)
  values (
    ws_id,
    lower(trim(invite_email)),
    invite_role,
    auth.uid(),
    now() + make_interval(hours => hours)
  )
  returning * into created;

  perform public._log_invite_event(
    created.id, created.workspace_id, created.email, created.role,
    'created', auth.uid(),
    jsonb_build_object('expires_hours', hours)
  );

  return query select created.id, created.token, created.email, created.role, created.expires_at;
end;
$$;

grant execute on function public.create_workspace_invite(uuid, text, text, integer) to authenticated;

-- 5. Resend RPC — enforces a 60-second cooldown server-side, returns the
-- updated counters, and writes an invite_events row. Frontend uses this
-- *before* hitting Resend, so a misclick can't burn 10 emails.
create or replace function public.record_invite_resend(invite_id uuid)
returns table (
  resend_count integer,
  last_resent_at timestamptz,
  cooldown_remaining_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.workspace_invites%rowtype;
  remaining integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv
  from public.workspace_invites
  where id = invite_id
  for update;

  if inv.id is null then
    raise exception 'Invite not found';
  end if;

  if not public.has_role(inv.workspace_id, array['owner','admin']) then
    raise exception 'Only owners and admins can resend invites';
  end if;

  if inv.accepted_at is not null then
    raise exception 'Invite already accepted, cannot resend';
  end if;

  if inv.expires_at <= now() then
    raise exception 'Invite expired, cannot resend';
  end if;

  if inv.last_resent_at is not null then
    remaining := 60 - extract(epoch from (now() - inv.last_resent_at))::integer;
    if remaining > 0 then
      raise exception 'Please wait % seconds before resending', remaining;
    end if;
  end if;

  update public.workspace_invites
  set resend_count = coalesce(resend_count, 0) + 1,
      last_resent_at = now()
  where id = invite_id
  returning * into inv;

  perform public._log_invite_event(
    inv.id, inv.workspace_id, inv.email, inv.role,
    'resent', auth.uid(),
    jsonb_build_object('resend_count', inv.resend_count)
  );

  return query select inv.resend_count, inv.last_resent_at, 0;
end;
$$;

grant execute on function public.record_invite_resend(uuid) to authenticated;

-- 6. Log a failed resend (e.g., Resend API rejected). Frontend calls this
-- after an unsuccessful send so admins can see why in the audit trail.
create or replace function public.record_invite_resend_failure(
  invite_id uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.workspace_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv
  from public.workspace_invites
  where id = invite_id;

  if inv.id is null then
    raise exception 'Invite not found';
  end if;

  if not public.has_role(inv.workspace_id, array['owner','admin']) then
    raise exception 'Only owners and admins can log resend failures';
  end if;

  perform public._log_invite_event(
    inv.id, inv.workspace_id, inv.email, inv.role,
    'resend_failed', auth.uid(),
    jsonb_build_object('reason', coalesce(reason, ''))
  );
end;
$$;

grant execute on function public.record_invite_resend_failure(uuid, text) to authenticated;

-- 7. Trigger: when an invite is accepted (accepted_at moves from null to a
-- timestamp), log it.
create or replace function public._invite_accepted_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.accepted_at is null and new.accepted_at is not null then
    perform public._log_invite_event(
      new.id, new.workspace_id, new.email, new.role,
      'accepted', new.accepted_by,
      jsonb_build_object()
    );
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_invites_accept_log on public.workspace_invites;
create trigger workspace_invites_accept_log
  after update on public.workspace_invites
  for each row
  execute function public._invite_accepted_trigger();

-- 8. Trigger: when an invite is deleted (revoked or cleared), log it.
create or replace function public._invite_revoked_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_expired boolean;
begin
  is_expired := old.accepted_at is null and old.expires_at <= now();
  perform public._log_invite_event(
    null, old.workspace_id, old.email, old.role,
    case when is_expired then 'expired' else 'revoked' end,
    auth.uid(),
    jsonb_build_object(
      'original_invite_id', old.id,
      'was_accepted', old.accepted_at is not null
    )
  );
  return old;
end;
$$;

drop trigger if exists workspace_invites_revoke_log on public.workspace_invites;
create trigger workspace_invites_revoke_log
  before delete on public.workspace_invites
  for each row
  execute function public._invite_revoked_trigger();

-- Verification queries:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='workspace_invites'
--   order by ordinal_position;
-- select * from public.invite_events order by created_at desc limit 10;
