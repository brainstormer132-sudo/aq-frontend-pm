-- 081_client_payment_terms.sql
--
-- Client payment terms.
--
-- 067 gave every vendor booking its own terms (split / on_delivery /
-- in_advance / net_days) and added the same three columns to the campaign row
-- as an unused default. This adds the CLIENT's standing terms to the client
-- record, so a client who is always "net 30" carries that once and every one
-- of their campaigns inherits it. A single campaign can still differ, using
-- the columns 067 already put on pm_tasks as a per-campaign override:
--
--     effective client terms  =  campaign.payment_terms  ??  client.payment_terms
--
-- The collection ledger reads the effective terms to date what a client owes.
-- Net-days runs from the campaign's completion; the ledger is
-- completed-campaigns only, so that date is real, not projected. "In advance"
-- runs from package_start_date.
--
-- Same vocabulary and the same bounds as 067, so one word never means two
-- things depending on which row you are reading.
--
-- Safe to re-run.

alter table public.clients
  add column if not exists payment_terms     text,
  add column if not exists payment_split_pct integer,
  add column if not exists payment_net_days  integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_payment_terms_chk'
  ) then
    alter table public.clients
      add constraint clients_payment_terms_chk
      check (payment_terms is null or payment_terms in (
        'split',        -- part up front, the rest on delivery: payment_split_pct is the first part
        'on_delivery',  -- all of it once the campaign is delivered
        'in_advance',   -- all of it before the campaign starts
        'net_days'      -- all of it, payment_net_days after delivery
      ));
  end if;

  -- 50/50 is the usual one, 30/70 happens. Anything outside 1-99 is not a
  -- split, it is one of the other three terms.
  if not exists (
    select 1 from pg_constraint where conname = 'clients_payment_split_chk'
  ) then
    alter table public.clients
      add constraint clients_payment_split_chk
      check (payment_split_pct is null
             or (payment_split_pct >= 1 and payment_split_pct <= 99));
  end if;

  -- 30, 60 and 90 are the ones anybody agrees to; the range is wide enough
  -- for the exceptions and tight enough to catch a typed year.
  if not exists (
    select 1 from pg_constraint where conname = 'clients_payment_net_days_chk'
  ) then
    alter table public.clients
      add constraint clients_payment_net_days_chk
      check (payment_net_days is null
             or (payment_net_days >= 1 and payment_net_days <= 365));
  end if;
end $$;

comment on column public.clients.payment_terms is
  'split | on_delivery | in_advance | net_days. The client''s standing terms, inherited by every campaign unless the campaign''s own payment_terms overrides them.';
comment on column public.clients.payment_split_pct is
  'For payment_terms = split: the percentage the client pays up front. 50 means 50/50.';
comment on column public.clients.payment_net_days is
  'For payment_terms = net_days: how many days after delivery the client''s payment falls due. 30, 60 and 90 are the usual ones.';

-- clients carries table-level GRANT ALL to anon/authenticated/service_role,
-- so these three columns are readable and writable without a column grant.
-- RLS remains the real boundary (071): anon still reads no client rows.
