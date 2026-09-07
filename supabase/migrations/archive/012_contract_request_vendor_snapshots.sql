-- ============================================================
-- Contract request registration snapshots
-- ============================================================
-- Safe to run on live DBs that missed migration 010:
-- 1) creates contract_requests if it does not exist
-- 2) adds the v2/v3 snapshot columns
-- 3) restores grants and RLS policies
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists public.contract_requests (
  id uuid primary key default uuid_generate_v4(),
  pm_task_id uuid references public.pm_tasks(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),

  request_kind text not null check (request_kind in ('client','vendor')),
  template_key text,

  brand_name text,
  amount numeric(14,2),
  notes text,

  client_name text,
  client_id_legacy text,
  pending_client_id bigint,
  cr_number text,
  vat_number text,
  signatory_name text,
  street text,
  city text,
  postcode text,
  country text,
  email text,
  phone text,

  pending_vendor_id bigint,
  vendor_id bigint references public.vendors(id),
  vendor_name text,
  vendor_category text,
  vendor_email text,
  vendor_phone text,
  bank_account_id bigint references public.bank_accounts(id),
  bank_name text,
  account_name text,
  iban text,
  account_number text,
  swift_code text,
  license_number text,
  is_influencer boolean default false,
  platforms text,
  ad_type text,
  qty text default '1',
  channel text,
  details text,

  status text not null default 'pending'
    check (status in ('pending','approved','generated','rejected','cancelled')),
  generated_contract_id text,
  generated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),

  created_at timestamptz default now()
);

alter table public.contract_requests alter column template_key drop not null;

alter table public.contract_requests add column if not exists pending_client_id bigint;
alter table public.contract_requests add column if not exists cr_number text;
alter table public.contract_requests add column if not exists vat_number text;
alter table public.contract_requests add column if not exists signatory_name text;
alter table public.contract_requests add column if not exists street text;
alter table public.contract_requests add column if not exists city text;
alter table public.contract_requests add column if not exists postcode text;
alter table public.contract_requests add column if not exists country text;
alter table public.contract_requests add column if not exists email text;
alter table public.contract_requests add column if not exists phone text;

alter table public.contract_requests add column if not exists pending_vendor_id bigint;
alter table public.contract_requests add column if not exists vendor_category text;
alter table public.contract_requests add column if not exists vendor_email text;
alter table public.contract_requests add column if not exists vendor_phone text;
alter table public.contract_requests add column if not exists bank_name text;
alter table public.contract_requests add column if not exists account_name text;
alter table public.contract_requests add column if not exists account_number text;
alter table public.contract_requests add column if not exists swift_code text;
alter table public.contract_requests add column if not exists is_influencer boolean default false;

create index if not exists idx_contract_requests_workspace on public.contract_requests(workspace_id);
create index if not exists idx_contract_requests_task on public.contract_requests(pm_task_id);
create index if not exists idx_contract_requests_status on public.contract_requests(status);

grant select, insert, update, delete on public.contract_requests to authenticated;
grant select, insert, update, delete on public.contract_requests to anon;

alter table public.contract_requests enable row level security;

drop policy if exists "contract_requests select" on public.contract_requests;
drop policy if exists "contract_requests insert" on public.contract_requests;
drop policy if exists "contract_requests update" on public.contract_requests;
drop policy if exists "contract_requests delete" on public.contract_requests;

create policy "contract_requests select" on public.contract_requests for select
  using (public.is_member_of(workspace_id));

create policy "contract_requests insert" on public.contract_requests for insert
  with check (
    auth.uid() = requested_by
    and public.has_role(workspace_id,
      array['owner','admin','operations','marketing','sales','key_account'])
  );

create policy "contract_requests update" on public.contract_requests for update
  using (
    public.has_role(workspace_id,
      array['owner','admin','operations','marketing','key_account'])
  );

create policy "contract_requests delete" on public.contract_requests for delete
  using (
    requested_by = auth.uid()
    or public.has_role(workspace_id, array['owner','admin','operations'])
  );

-- ============================================================
-- DONE.
-- ============================================================
