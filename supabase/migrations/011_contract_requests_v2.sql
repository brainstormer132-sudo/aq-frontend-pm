-- ============================================================
-- Slim the contract_requests model: most data is pulled from the
-- vendor / client registration tables at request time, so the
-- request itself only needs a small denormalized snapshot.
-- ============================================================

-- Template choice belongs to legal — drop the requirement.
alter table public.contract_requests
  alter column template_key drop not null;

-- Vendor flag: only influencers need extra platform/handle/ad-type info.
alter table public.contract_requests
  add column if not exists is_influencer boolean default false;

-- Client snapshot fields (denormalized so the contract team sees the full
-- picture even if the registration is later edited).
alter table public.contract_requests add column if not exists pending_client_id  bigint;
alter table public.contract_requests add column if not exists cr_number          text;
alter table public.contract_requests add column if not exists vat_number         text;
alter table public.contract_requests add column if not exists signatory_name     text;
alter table public.contract_requests add column if not exists street             text;
alter table public.contract_requests add column if not exists city               text;
alter table public.contract_requests add column if not exists postcode           text;
alter table public.contract_requests add column if not exists country            text;
alter table public.contract_requests add column if not exists email              text;
alter table public.contract_requests add column if not exists phone              text;

-- Vendor registration snapshot fields.
alter table public.contract_requests add column if not exists pending_vendor_id  bigint;
alter table public.contract_requests add column if not exists vendor_category    text;
alter table public.contract_requests add column if not exists vendor_email       text;
alter table public.contract_requests add column if not exists vendor_phone       text;
alter table public.contract_requests add column if not exists bank_name          text;
alter table public.contract_requests add column if not exists account_name       text;
alter table public.contract_requests add column if not exists account_number     text;
alter table public.contract_requests add column if not exists swift_code         text;

grant select, insert, update, delete on public.contract_requests to authenticated;
grant select, insert, update, delete on public.contract_requests to anon;

-- ============================================================
-- DONE.
-- ============================================================
