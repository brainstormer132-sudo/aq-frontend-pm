-- =============================================================================
-- 023 — Fix "column reference 'id' is ambiguous" in external invite RPCs
-- =============================================================================
--
-- The functions in 021 declared `RETURNS TABLE (id uuid, ...)` which caused
-- ambiguity with the `inserted.id` field in the function body. This rewrite
-- prefixes every OUT column with `out_` so there's no collision.
--
-- Postgres doesn't allow CREATE OR REPLACE to change OUT parameter names —
-- we DROP the functions first.

drop function if exists public.issue_external_invite(text, text, bigint, uuid, uuid);
drop function if exists public.validate_external_invite(text);
drop function if exists public.consume_external_invite(text, uuid);
drop function if exists public.reissue_external_invite(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 1. issue_external_invite
-- ---------------------------------------------------------------------------
create function public.issue_external_invite(
  p_email     text,
  p_role      text,
  p_vendor_id bigint,
  p_client_id uuid,
  p_actor     uuid
)
returns table (
  out_id         uuid,
  out_token      text,
  out_email      text,
  out_role       text,
  out_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted public.external_user_invites%rowtype;
begin
  if p_role not in ('vendor','client') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if p_role = 'vendor' and p_vendor_id is null then
    raise exception 'vendor_id is required for vendor invites';
  end if;
  if p_role = 'client' and p_client_id is null then
    raise exception 'client_id is required for client invites';
  end if;

  insert into public.external_user_invites (email, role, vendor_id, client_id, invited_by)
  values (lower(trim(p_email)), p_role, p_vendor_id, p_client_id, p_actor)
  returning * into inserted;

  if p_role = 'vendor' then
    update public.vendors set invite_status = 'invite_sent' where id = p_vendor_id;
  else
    update public.clients set invite_status = 'invite_sent' where id = p_client_id;
  end if;

  out_id         := inserted.id;
  out_token      := inserted.token;
  out_email      := inserted.email;
  out_role       := inserted.role;
  out_expires_at := inserted.expires_at;
  return next;
end;
$$;

grant execute on function public.issue_external_invite(text, text, bigint, uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. validate_external_invite
-- ---------------------------------------------------------------------------
create function public.validate_external_invite(p_token text)
returns table (
  out_valid       boolean,
  out_reason      text,
  out_email       text,
  out_role        text,
  out_vendor_id   bigint,
  out_client_id   uuid,
  out_expires_at  timestamptz
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  inv public.external_user_invites%rowtype;
begin
  select * into inv from public.external_user_invites where token = p_token limit 1;
  if inv.id is null then
    out_valid := false; out_reason := 'Invite not found';
    return next;
    return;
  end if;
  if inv.accepted_at is not null then
    out_valid := false; out_reason := 'Invite already used';
    out_email := inv.email; out_role := inv.role;
    out_vendor_id := inv.vendor_id; out_client_id := inv.client_id;
    out_expires_at := inv.expires_at;
    return next;
    return;
  end if;
  if inv.expires_at <= now() then
    out_valid := false; out_reason := 'Invite expired';
    out_email := inv.email; out_role := inv.role;
    out_vendor_id := inv.vendor_id; out_client_id := inv.client_id;
    out_expires_at := inv.expires_at;
    return next;
    return;
  end if;
  out_valid := true; out_reason := 'OK';
  out_email := inv.email; out_role := inv.role;
  out_vendor_id := inv.vendor_id; out_client_id := inv.client_id;
  out_expires_at := inv.expires_at;
  return next;
end;
$$;

grant execute on function public.validate_external_invite(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. consume_external_invite
-- ---------------------------------------------------------------------------
create function public.consume_external_invite(
  p_token        text,
  p_auth_user_id uuid
)
returns table (
  out_external_user_id uuid,
  out_role             text,
  out_vendor_id        bigint,
  out_client_id        uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.external_user_invites%rowtype;
  eu_id uuid;
begin
  select * into inv
    from public.external_user_invites
   where token = p_token
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

  insert into public.external_users (auth_user_id, email, role, vendor_id, client_id)
  values (p_auth_user_id, lower(inv.email), inv.role, inv.vendor_id, inv.client_id)
  on conflict (auth_user_id) do update
    set role = excluded.role,
        vendor_id = excluded.vendor_id,
        client_id = excluded.client_id,
        email = excluded.email
  returning external_users.id into eu_id;

  update public.external_user_invites
     set accepted_at = now(),
         accepted_by = p_auth_user_id
   where id = inv.id;

  if inv.role = 'vendor' then
    update public.vendors set invite_status = 'accepted' where id = inv.vendor_id;
  else
    update public.clients set invite_status = 'accepted' where id = inv.client_id;
  end if;

  out_external_user_id := eu_id;
  out_role             := inv.role;
  out_vendor_id        := inv.vendor_id;
  out_client_id        := inv.client_id;
  return next;
end;
$$;

grant execute on function public.consume_external_invite(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. reissue_external_invite
-- ---------------------------------------------------------------------------
create function public.reissue_external_invite(
  p_external_user_id uuid,
  p_actor            uuid
)
returns table (
  out_id         uuid,
  out_token      text,
  out_email      text,
  out_role       text,
  out_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  eu       public.external_users%rowtype;
  inserted public.external_user_invites%rowtype;
begin
  select * into eu from public.external_users where id = p_external_user_id;
  if eu.id is null then
    raise exception 'External user % not found', p_external_user_id;
  end if;

  update public.external_user_invites
     set expires_at = now()
   where lower(email) = lower(eu.email)
     and accepted_at is null
     and expires_at > now();

  insert into public.external_user_invites
    (email, role, vendor_id, client_id, invited_by, reset_count)
  values
    (eu.email, eu.role, eu.vendor_id, eu.client_id, p_actor, 1)
  returning * into inserted;

  if eu.role = 'vendor' then
    update public.vendors set invite_status = 'invite_sent' where id = eu.vendor_id;
  else
    update public.clients set invite_status = 'invite_sent' where id = eu.client_id;
  end if;

  out_id         := inserted.id;
  out_token      := inserted.token;
  out_email      := inserted.email;
  out_role       := inserted.role;
  out_expires_at := inserted.expires_at;
  return next;
end;
$$;

grant execute on function public.reissue_external_invite(uuid, uuid) to authenticated;
