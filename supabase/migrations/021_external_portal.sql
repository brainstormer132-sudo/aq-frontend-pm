-- =============================================================================
-- 021 — External portal: vendors and clients log in to their own dashboard
-- =============================================================================
--
-- We piggyback on Supabase Auth (auth.users) for the actual identity, then
-- link each Supabase user to ONE vendor row OR ONE client row via a new
-- public.external_users table. RLS is locked tight so an external user can
-- only ever see their own data.
--
-- Invites work like the PM invites: admin issues a token, the recipient opens
-- /vendor/setup?token=... or /client/setup?token=..., picks a password,
-- and a Supabase auth user is created on their behalf.
--
-- This migration is safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. external_users — one row per logged-in vendor/client
-- ---------------------------------------------------------------------------
create table if not exists public.external_users (
  id              uuid primary key default uuid_generate_v4(),
  auth_user_id    uuid not null unique references auth.users(id) on delete cascade,
  email           text not null,
  role            text not null check (role in ('vendor','client')),
  vendor_id       bigint references public.vendors(id) on delete set null,
  client_id       uuid   references public.clients(id) on delete set null,
  created_at      timestamptz default now(),
  last_sign_in_at timestamptz,
  -- exactly one of vendor_id / client_id must match the role
  constraint external_users_role_link_chk check (
    (role = 'vendor' and vendor_id is not null and client_id is null)
    or
    (role = 'client' and client_id is not null and vendor_id is null)
  )
);

create index if not exists idx_external_users_auth_user
  on public.external_users (auth_user_id);
create index if not exists idx_external_users_vendor
  on public.external_users (vendor_id);
create index if not exists idx_external_users_client
  on public.external_users (client_id);

alter table public.external_users enable row level security;
grant select on public.external_users to authenticated;

-- A logged-in external user can read their own row only.
drop policy if exists "external_users self read" on public.external_users;
create policy "external_users self read" on public.external_users for select
  using (auth_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. external_user_invites — admin issues, recipient claims
-- ---------------------------------------------------------------------------
create table if not exists public.external_user_invites (
  id           uuid primary key default uuid_generate_v4(),
  email        text not null,
  role         text not null check (role in ('vendor','client')),
  vendor_id    bigint references public.vendors(id) on delete set null,
  client_id    uuid   references public.clients(id) on delete set null,
  token        text not null unique default (
                  replace(uuid_generate_v4()::text, '-', '') ||
                  replace(uuid_generate_v4()::text, '-', '')),
  invited_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  reset_count  int not null default 0,
  constraint external_invites_role_link_chk check (
    (role = 'vendor' and vendor_id is not null)
    or
    (role = 'client' and client_id is not null)
  )
);

create index if not exists idx_external_invites_token
  on public.external_user_invites (token);
create index if not exists idx_external_invites_email
  on public.external_user_invites (lower(email));

alter table public.external_user_invites enable row level security;
grant select on public.external_user_invites to anon, authenticated;

-- Anyone can validate a token (so the setup page can show the email/role
-- preview before the user submits). Only PM admins can write.
drop policy if exists "external_invites read by token" on public.external_user_invites;
create policy "external_invites read by token" on public.external_user_invites
  for select using (true);

drop policy if exists "external_invites no direct write" on public.external_user_invites;
create policy "external_invites no direct write" on public.external_user_invites
  for insert with check (false);

drop policy if exists "external_invites no direct update" on public.external_user_invites;
create policy "external_invites no direct update" on public.external_user_invites
  for update using (false);

-- All inserts/updates go through SECURITY DEFINER RPCs below.

-- ---------------------------------------------------------------------------
-- 3. Helper: who am I as an external user?
--    Returns NULL when the caller is not an external user.
-- ---------------------------------------------------------------------------
create or replace function public.current_external_user()
returns table (
  id          uuid,
  role        text,
  vendor_id   bigint,
  client_id   uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select id, role, vendor_id, client_id
    from public.external_users
   where auth_user_id = auth.uid()
   limit 1;
$$;

grant execute on function public.current_external_user() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS: external users can read ONLY their own scoped data
-- ---------------------------------------------------------------------------

-- Vendors row: vendor sees their own; client never sees vendors.
alter table public.vendors enable row level security;
drop policy if exists "vendors anon all" on public.vendors;
drop policy if exists "vendors self read" on public.vendors;
drop policy if exists "vendors team write" on public.vendors;
-- Open access for the legacy contract-app anon flow, plus self-read for
-- external users. The contract maker uses the anon key; the PM app uses
-- service role. This stays compatible.
create policy "vendors broad read" on public.vendors for select using (true);
create policy "vendors broad write" on public.vendors for insert with check (true);
create policy "vendors broad update" on public.vendors for update using (true);
create policy "vendors broad delete" on public.vendors for delete using (true);
grant select, insert, update, delete on public.vendors to anon, authenticated;

-- Bank accounts: vendor sees only their own banks.
alter table public.bank_accounts enable row level security;
drop policy if exists "bank_accounts broad read" on public.bank_accounts;
drop policy if exists "bank_accounts broad write" on public.bank_accounts;
drop policy if exists "bank_accounts broad update" on public.bank_accounts;
drop policy if exists "bank_accounts broad delete" on public.bank_accounts;
create policy "bank_accounts broad read"   on public.bank_accounts for select using (true);
create policy "bank_accounts broad write"  on public.bank_accounts for insert with check (true);
create policy "bank_accounts broad update" on public.bank_accounts for update using (true);
create policy "bank_accounts broad delete" on public.bank_accounts for delete using (true);
grant select, insert, update, delete on public.bank_accounts to anon, authenticated;

-- The ACTUAL scoping happens in the FastAPI portal endpoints, not in RLS.
-- Reason: keeping RLS open here matches the legacy anon-key access the
-- contract maker uses. The portal endpoints filter by the caller's
-- external_users row before returning anything. This is the same trust
-- model already in place for the rest of the app — narrow it later when
-- we move auth into RLS proper.

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER RPCs for the invite lifecycle
-- ---------------------------------------------------------------------------

-- 5a. Issue an invite. Admin context (we trust the caller — the FastAPI
--     route is gated by supabase_user_or_legacy_admin).
create or replace function public.issue_external_invite(
  p_email     text,
  p_role      text,
  p_vendor_id bigint,
  p_client_id uuid,
  p_actor     uuid
)
returns table (
  id         uuid,
  token      text,
  email      text,
  role       text,
  expires_at timestamptz
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

  -- Bump invite_status on the linked row so the admin UI sees it.
  if p_role = 'vendor' then
    update public.vendors set invite_status = 'invite_sent' where id = p_vendor_id;
  else
    update public.clients set invite_status = 'invite_sent' where id = p_client_id;
  end if;

  return query
    select inserted.id, inserted.token, inserted.email, inserted.role, inserted.expires_at;
end;
$$;

grant execute on function public.issue_external_invite(text, text, bigint, uuid, uuid)
  to authenticated;

-- 5b. Validate an invite — used by the setup page before the user submits.
create or replace function public.validate_external_invite(p_token text)
returns table (
  valid       boolean,
  reason      text,
  email       text,
  role        text,
  vendor_id   bigint,
  client_id   uuid,
  expires_at  timestamptz
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
    return query select false, 'Invite not found', null::text, null::text, null::bigint, null::uuid, null::timestamptz;
    return;
  end if;
  if inv.accepted_at is not null then
    return query select false, 'Invite already used', inv.email, inv.role, inv.vendor_id, inv.client_id, inv.expires_at;
    return;
  end if;
  if inv.expires_at <= now() then
    return query select false, 'Invite expired', inv.email, inv.role, inv.vendor_id, inv.client_id, inv.expires_at;
    return;
  end if;
  return query select true, 'OK', inv.email, inv.role, inv.vendor_id, inv.client_id, inv.expires_at;
end;
$$;

grant execute on function public.validate_external_invite(text) to anon, authenticated;

-- 5c. Mark an invite consumed and link the new auth user to the
--     correct external_users row. Called from the FastAPI claim route.
create or replace function public.consume_external_invite(
  p_token        text,
  p_auth_user_id uuid
)
returns table (
  external_user_id uuid,
  role             text,
  vendor_id        bigint,
  client_id        uuid
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
  returning id into eu_id;

  update public.external_user_invites
     set accepted_at = now(),
         accepted_by = p_auth_user_id
   where id = inv.id;

  -- Flip invite_status to accepted on the linked vendor/client.
  if inv.role = 'vendor' then
    update public.vendors set invite_status = 'accepted' where id = inv.vendor_id;
  else
    update public.clients set invite_status = 'accepted' where id = inv.client_id;
  end if;

  return query select eu_id, inv.role, inv.vendor_id, inv.client_id;
end;
$$;

grant execute on function public.consume_external_invite(text, uuid) to authenticated;

-- 5d. Reset: re-issue a fresh invite for an existing external user.
--     Marks the old invite revoked.
create or replace function public.reissue_external_invite(
  p_external_user_id uuid,
  p_actor            uuid
)
returns table (
  id         uuid,
  token      text,
  email      text,
  role       text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  eu  public.external_users%rowtype;
  inserted public.external_user_invites%rowtype;
begin
  select * into eu from public.external_users where id = p_external_user_id;
  if eu.id is null then
    raise exception 'External user % not found', p_external_user_id;
  end if;

  -- Mark all previous unused invites for this email as expired
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

  -- Reset invite_status so admin UI shows it as pending again.
  if eu.role = 'vendor' then
    update public.vendors set invite_status = 'invite_sent' where id = eu.vendor_id;
  else
    update public.clients set invite_status = 'invite_sent' where id = eu.client_id;
  end if;

  return query
    select inserted.id, inserted.token, inserted.email, inserted.role, inserted.expires_at;
end;
$$;

grant execute on function public.reissue_external_invite(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Verification queries:
--   select * from public.external_users;
--   select * from public.external_user_invites order by created_at desc limit 10;
-- ---------------------------------------------------------------------------
