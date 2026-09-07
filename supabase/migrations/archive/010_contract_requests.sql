-- ============================================================
-- Contract requests — bridge between the PM app and the contract app
-- ============================================================
-- A row here is a request from someone in the PM workspace to have a
-- contract drawn up for a task. The contract app picks these up and
-- generates the actual DOCX/PDF (it can write the path back here).
-- ============================================================

create table if not exists public.contract_requests (
  id uuid primary key default uuid_generate_v4(),
  pm_task_id uuid references public.pm_tasks(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),

  request_kind text not null check (request_kind in ('client','vendor')),
  template_key text,                          -- legal chooses this later

  -- Common
  brand_name      text,
  amount          numeric(14,2),
  notes           text,

  -- Client-only
  client_name     text,
  client_id_legacy text,
  pending_client_id bigint,
  cr_number       text,
  vat_number      text,
  signatory_name  text,
  street          text,
  city            text,
  postcode        text,
  country         text,
  email           text,
  phone           text,

  -- Vendor-only registration snapshot
  pending_vendor_id bigint,
  vendor_id       bigint references public.vendors(id),
  vendor_name     text,
  vendor_category text,
  vendor_email    text,
  vendor_phone    text,
  bank_account_id bigint references public.bank_accounts(id),
  bank_name       text,
  account_name    text,
  iban            text,
  account_number  text,
  swift_code      text,
  license_number  text,
  is_influencer   boolean default false,
  platforms       text,
  ad_type         text,
  qty             text default '1',
  channel         text,
  details         text,

  -- Lifecycle
  status text not null default 'pending'
    check (status in ('pending','approved','generated','rejected','cancelled')),
  generated_contract_id text,
  generated_at timestamptz,
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles(id),

  created_at timestamptz default now()
);
create index if not exists idx_contract_requests_workspace on public.contract_requests(workspace_id);
create index if not exists idx_contract_requests_task      on public.contract_requests(pm_task_id);
create index if not exists idx_contract_requests_status    on public.contract_requests(status);

grant select, insert, update, delete on public.contract_requests to authenticated;
grant select, insert, update, delete on public.contract_requests to anon;

alter table public.contract_requests enable row level security;

drop policy if exists "contract_requests select" on public.contract_requests;
drop policy if exists "contract_requests insert" on public.contract_requests;
drop policy if exists "contract_requests update" on public.contract_requests;
drop policy if exists "contract_requests delete" on public.contract_requests;

-- Anyone in the workspace can see requests.
create policy "contract_requests select" on public.contract_requests for select
  using (public.is_member_of(workspace_id));

-- Anyone with workflow-creator-ish access can request.
create policy "contract_requests insert" on public.contract_requests for insert
  with check (
    auth.uid() = requested_by
    and public.has_role(workspace_id,
        array['owner','admin','operations','marketing','sales','key_account'])
  );

-- Marketing / admin / operations / key_account can update status.
create policy "contract_requests update" on public.contract_requests for update
  using (
    public.has_role(workspace_id,
      array['owner','admin','operations','marketing','key_account'])
  );

-- Only requester or admin/ops/owner can delete.
create policy "contract_requests delete" on public.contract_requests for delete
  using (
    requested_by = auth.uid()
    or public.has_role(workspace_id, array['owner','admin','operations'])
  );

-- ============================================================
-- DONE. Run this in Supabase SQL Editor.
-- ============================================================
