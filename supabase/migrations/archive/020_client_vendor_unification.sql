-- =============================================================================
-- 020 — Client / Vendor unification + brands + invite tracking
-- =============================================================================
--
-- Problem this fixes:
--   1. Approving a pending_client today does nothing — the row dies in the
--      pending table. We add a bridge: approval inserts into public.clients.
--   2. Vendors and clients have no concept of "external portal access yet?"
--      We add invite_status so admins can later trigger invites.
--   3. Contracts only loosely reference brand by free-text. We add
--      brand_id (FK to client_brands) without breaking legacy rows.
--   4. The contract maker writes vendors rows on approval but cannot pick a
--      workspace. We make workspace_id nullable on clients so the contract
--      maker can create them headless; the PM team can later assign them.
--
-- Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1. clients — make workspace_id nullable and add new fields
-- ---------------------------------------------------------------------------
alter table public.clients
  alter column workspace_id drop not null;

alter table public.clients
  add column if not exists cr_number       text default '',
  add column if not exists vat_number      text default '',
  add column if not exists signatory_name  text default '',
  add column if not exists company_email   text default '',
  add column if not exists street          text default '',
  add column if not exists city            text default '',
  add column if not exists postcode        text default '',
  add column if not exists country         text default '',
  add column if not exists national_address text default '',
  add column if not exists pending_client_id bigint references public.pending_clients(id) on delete set null,
  add column if not exists invite_status text default 'none'
      check (invite_status in ('none','pending_invite','invite_sent','accepted','revoked'));

create index if not exists idx_clients_pending_client_id
  on public.clients (pending_client_id);
create index if not exists idx_clients_invite_status
  on public.clients (invite_status);

-- ---------------------------------------------------------------------------
-- 2. vendors — add invite tracking + linkback to pending row
-- ---------------------------------------------------------------------------
alter table public.vendors
  add column if not exists pending_vendor_id bigint references public.pending_vendors(id) on delete set null,
  add column if not exists email             text default '',
  add column if not exists phone             text default '',
  add column if not exists vendor_category   text default '',
  add column if not exists platforms         text default '',
  add column if not exists invite_status     text default 'none'
      check (invite_status in ('none','pending_invite','invite_sent','accepted','revoked'));

create index if not exists idx_vendors_pending_vendor_id
  on public.vendors (pending_vendor_id);
create index if not exists idx_vendors_invite_status
  on public.vendors (invite_status);

-- ---------------------------------------------------------------------------
-- 3. client_brands already exists from migration 002 — just make sure RLS
--    is permissive enough for the contract maker (which uses anon key).
-- ---------------------------------------------------------------------------
alter table public.client_brands enable row level security;

drop policy if exists "client_brands all access" on public.client_brands;
-- Open read for now; tighten when external portal lands.
create policy "client_brands read" on public.client_brands for select
  using (true);
create policy "client_brands write" on public.client_brands for insert
  with check (true);
create policy "client_brands update" on public.client_brands for update
  using (true);
create policy "client_brands delete" on public.client_brands for delete
  using (true);

grant select, insert, update, delete on public.client_brands to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. generated_contracts — link to client + brand by id, keep legacy text
-- ---------------------------------------------------------------------------
alter table public.generated_contracts
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists brand_id  uuid references public.client_brands(id) on delete set null,
  add column if not exists vendor_id bigint references public.vendors(id) on delete set null;

create index if not exists idx_generated_contracts_client_id
  on public.generated_contracts (client_id);
create index if not exists idx_generated_contracts_brand_id
  on public.generated_contracts (brand_id);
create index if not exists idx_generated_contracts_vendor_id
  on public.generated_contracts (vendor_id);

-- ---------------------------------------------------------------------------
-- 5. clients RLS — make sure anon can read approved clients (contract maker
--    uses the anon key today). Tighten when portal lands.
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;

drop policy if exists "clients read all" on public.clients;
drop policy if exists "clients write all" on public.clients;
drop policy if exists "clients update all" on public.clients;
drop policy if exists "clients delete all" on public.clients;

create policy "clients read all" on public.clients for select using (true);
create policy "clients write all" on public.clients for insert with check (true);
create policy "clients update all" on public.clients for update using (true);
create policy "clients delete all" on public.clients for delete using (true);

grant select, insert, update, delete on public.clients to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bridge function: approve_pending_client(pending_id) — atomic
--    Marks the pending_clients row approved AND creates a public.clients
--    row carrying every Netlify field. Idempotent: re-running on an already
--    approved pending row returns the existing client without duplicating.
-- ---------------------------------------------------------------------------
create or replace function public.approve_pending_client(p_id bigint)
returns table (client_id uuid, was_already_approved boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  pc record;
  existing_client_id uuid;
  new_client_id uuid;
begin
  select * into pc from public.pending_clients where id = p_id;
  if pc.id is null then
    raise exception 'Pending client % not found', p_id;
  end if;

  -- Idempotency: if a clients row already references this pending row,
  -- return it instead of creating a duplicate.
  select id into existing_client_id
    from public.clients
    where pending_client_id = p_id
    limit 1;

  if existing_client_id is not null then
    update public.pending_clients
       set status = 'approved',
           reviewed_at = now()
     where id = p_id and status <> 'approved';
    return query select existing_client_id, true;
    return;
  end if;

  insert into public.clients (
    company_name, contact_name, contact_email, contact_phone,
    cr_number, vat_number, signatory_name, company_email,
    street, city, postcode, country, national_address,
    pending_client_id, invite_status, status
  ) values (
    pc.company_name,
    pc.signatory_name,
    coalesce(nullif(pc.company_email, ''), pc.email),
    pc.phone,
    pc.cr_number, pc.vat_number, pc.signatory_name, pc.company_email,
    pc.street, pc.city, pc.postcode, pc.country, pc.national_address,
    pc.id, 'pending_invite', 'active'
  )
  returning id into new_client_id;

  update public.pending_clients
     set status = 'approved',
         reviewed_at = now()
   where id = p_id;

  return query select new_client_id, false;
end;
$$;

grant execute on function public.approve_pending_client(bigint)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Bridge function: approve_pending_vendor(pending_id) — atomic
--    Mirrors approve_pending_client. Creates the vendors + bank_accounts
--    rows in one transaction. The current contract maker does this in
--    application code — duplicating the logic into SQL means the PM app
--    can call it directly without going through FastAPI.
-- ---------------------------------------------------------------------------
create or replace function public.approve_pending_vendor(p_id bigint)
returns table (vendor_id bigint, was_already_approved boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  pv record;
  existing_vendor_id bigint;
  new_vendor_id bigint;
  normalized_iban text;
begin
  select * into pv from public.pending_vendors where id = p_id;
  if pv.id is null then
    raise exception 'Pending vendor % not found', p_id;
  end if;

  select id into existing_vendor_id
    from public.vendors
    where pending_vendor_id = p_id
    limit 1;

  if existing_vendor_id is not null then
    update public.pending_vendors
       set status = 'approved', reviewed_at = now()
     where id = p_id and status <> 'approved';
    return query select existing_vendor_id, true;
    return;
  end if;

  insert into public.vendors (
    name, license_number, created_at,
    pending_vendor_id, email, phone, vendor_category, platforms,
    invite_status
  ) values (
    pv.full_name, pv.license_number, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
    pv.id, pv.email, pv.phone, pv.vendor_category, pv.platforms,
    'pending_invite'
  )
  returning id into new_vendor_id;

  -- Attach bank account if the pending row had one. Same IBAN under
  -- multiple vendors is allowed (matches the recent vendors.py change).
  normalized_iban := upper(replace(coalesce(pv.iban, ''), ' ', ''));
  if normalized_iban <> '' then
    insert into public.bank_accounts (
      vendor_id, bank_name, account_name, iban, account_number, swift_code
    ) values (
      new_vendor_id,
      coalesce(nullif(pv.bank_name, ''), 'Unknown bank'),
      coalesce(nullif(pv.account_name, ''), pv.full_name),
      normalized_iban,
      coalesce(pv.account_number, ''),
      coalesce(pv.swift_code, '')
    );
  end if;

  update public.pending_vendors
     set status = 'approved', reviewed_at = now()
   where id = p_id;

  return query select new_vendor_id, false;
end;
$$;

grant execute on function public.approve_pending_vendor(bigint)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Reject helpers (mark pending row rejected without bridging)
-- ---------------------------------------------------------------------------
create or replace function public.reject_pending_client(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pending_clients
     set status = 'rejected', reviewed_at = now()
   where id = p_id;
$$;

create or replace function public.reject_pending_vendor(p_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.pending_vendors
     set status = 'rejected', reviewed_at = now()
   where id = p_id;
$$;

grant execute on function public.reject_pending_client(bigint)  to anon, authenticated;
grant execute on function public.reject_pending_vendor(bigint)  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Verification snippets (run manually after migration):
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='clients'
--    order by ordinal_position;
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='vendors'
--    order by ordinal_position;
--
--   select * from public.approve_pending_client(<some-id>);
--   select * from public.approve_pending_vendor(<some-id>);
-- ---------------------------------------------------------------------------
