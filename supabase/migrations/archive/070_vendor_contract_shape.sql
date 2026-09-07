-- 070_vendor_contract_shape.sql
--
-- Two changes, both from the same conversation.
--
-- 1. WHAT A VENDOR CONTRACT NEEDS.
--
--    Siraj: *"vendor contracts dont need a signatory name just the name in
--    the license id brand name the first and last name and the platform the
--    name in the platform the ad type and the bank info payment and payment
--    terms which can all be found in the task"*.
--
--    Signatory name was the one thing on the vendor readiness check that
--    nobody could supply from a booking — it is a company concept, and an
--    influencer does not have one. It was the reason bookings sat blocked.
--    In its place the request now carries what the contract actually needs
--    and what the task already knows: the person behind the vendor, their
--    handle on the platform, and the payment terms agreed on the booking.
--
--    Nothing here is a new thing to type. Every column below is filled from
--    a record that already exists — vendors.contact_name, vendors.platforms,
--    pm_tasks.payment_terms (067).
--
-- 2. A CONTRACT COVERS ADS, NOT A BOOKING.
--
--    Siraj: *"vendor contract should be requested all combined to one
--    contract or multiple contract based on the vendor lines"*.
--
--    Until now the link was pm_tasks.contract_request_id — one contract per
--    booking, no more. A vendor doing a Home Ad on TikTok in March and a
--    Store Visit on Instagram in June is one booking and may well be two
--    agreements. vendor_ad_lines.contract_request_id inverts the link so a
--    request covers a SET of ads: all of them for a combined contract, some
--    of them for a split one.
--
--    pm_tasks.contract_request_id is kept and still set to the request that
--    covers everything (or the first one). Nothing that reads it breaks;
--    what reads the new column can tell a fully covered booking from a
--    half-covered one, which the old shape could not express at all.
--
-- Safe to run twice.

-- ───────────────────────────────────────────────────────────────────
-- 1. What the contract carries
-- ───────────────────────────────────────────────────────────────────

alter table public.contract_requests
  add column if not exists contact_name      text,
  add column if not exists platform_handle   text,
  add column if not exists payment_terms     text,
  add column if not exists payment_split_pct integer,
  add column if not exists payment_net_days  integer;

do $$
begin
  -- The same four terms pm_tasks uses (067). Kept identical on purpose: the
  -- request is a snapshot of the booking, and two vocabularies for one idea
  -- is how a contract ends up saying something the booking never said.
  if not exists (
    select 1 from pg_constraint where conname = 'contract_requests_payment_terms_chk'
  ) then
    alter table public.contract_requests
      add constraint contract_requests_payment_terms_chk
      check (payment_terms is null or payment_terms in (
        'split',        -- part before, the rest after: payment_split_pct is the first part
        'on_delivery',  -- all of it once the work is done
        'in_advance',   -- all of it before anything is posted
        'net_days'      -- all of it, payment_net_days after delivery
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contract_requests_payment_split_chk'
  ) then
    alter table public.contract_requests
      add constraint contract_requests_payment_split_chk
      check (payment_split_pct is null
             or (payment_split_pct >= 1 and payment_split_pct <= 99));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'contract_requests_payment_net_days_chk'
  ) then
    alter table public.contract_requests
      add constraint contract_requests_payment_net_days_chk
      check (payment_net_days is null
             or (payment_net_days >= 1 and payment_net_days <= 365));
  end if;
end $$;

comment on column public.contract_requests.contact_name is
  'The person behind the vendor — first and last name, as it should read on the contract. From vendors.contact_name.';
comment on column public.contract_requests.platform_handle is
  'Their name ON the platform: the handle or profile the ads will be posted from. From vendors.platforms.';
comment on column public.contract_requests.payment_terms is
  'split | on_delivery | in_advance | net_days. A snapshot of the booking''s terms at request time.';
comment on column public.contract_requests.payment_split_pct is
  'For payment_terms = split: the percentage paid up front. 50 means 50/50.';
comment on column public.contract_requests.payment_net_days is
  'For payment_terms = net_days: how many days after delivery payment falls due.';
comment on column public.contract_requests.signatory_name is
  'CLIENT contracts only. A vendor request leaves this null — an influencer has no signatory, and requiring one blocked every vendor contract.';

-- ───────────────────────────────────────────────────────────────────
-- 2. Which ads a request covers
-- ───────────────────────────────────────────────────────────────────

alter table public.vendor_ad_lines
  add column if not exists contract_request_id uuid
    references public.contract_requests(id) on delete set null;

create index if not exists vendor_ad_lines_contract_request_idx
  on public.vendor_ad_lines (contract_request_id)
  where contract_request_id is not null;

comment on column public.vendor_ad_lines.contract_request_id is
  'The contract covering this ad. All the lines on a booking pointing at one request is a combined contract; different requests is a split. Null = this ad is not under contract yet.';

-- Backfill: every ad on a booking that already has a contract is covered by
-- it. Before this column the booking-level link was the only statement that
-- could be made, and it meant exactly this.
update public.vendor_ad_lines l
   set contract_request_id = t.contract_request_id
  from public.pm_tasks t
 where l.subtask_id = t.id
   and t.contract_request_id is not null
   and l.contract_request_id is null;

-- ───────────────────────────────────────────────────────────────────
-- Proof
-- ───────────────────────────────────────────────────────────────────

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'contract_requests'
   and column_name in (
     'contact_name', 'platform_handle',
     'payment_terms', 'payment_split_pct', 'payment_net_days')
 order by column_name;

select count(*) as ads_now_linked_to_a_contract
  from public.vendor_ad_lines
 where contract_request_id is not null;
