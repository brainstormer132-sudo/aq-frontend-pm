-- 067_lines_terms_and_realtime.sql
--
-- Three unrelated things that arrived in one sitting of feedback.
--
--  1. Money on the AD, not just on the booking. A vendor booked for ten ads
--     is not paid in one lump — each ad can carry its own quotation number,
--     its own net, and its own payment date and state. Until now all of that
--     lived on the booking, so a half-paid booking could not be described.
--
--  2. Vendor payment terms. Siraj: *"contracts for vendors are usually 50/50
--     pre or after after we input a date for example 30-90 days."* The terms
--     were only ever prose inside the generated .docx, so the app could not
--     tell you what had been agreed, let alone when the second half falls due.
--
--  3. Realtime. Only pm_tasks was published, so a quotation raised by one
--     person, or an ad line added by another, stayed invisible until someone
--     pressed refresh.
--
-- Safe to re-run.

-- ───────────────────────────────────────────────────────────────────
-- 1. Per-ad money
-- ───────────────────────────────────────────────────────────────────

alter table public.vendor_ad_lines
  add column if not exists quotation_no        text,
  add column if not exists net_amount          numeric(12,2),
  add column if not exists net_payment_date    date,
  add column if not exists net_payment_status  text;

do $$
begin
  -- The same vocabulary the campaign uses for the client's side, so one
  -- word does not mean two things depending on which row you are reading.
  if not exists (
    select 1 from pg_constraint where conname = 'vendor_ad_lines_net_payment_status_chk'
  ) then
    alter table public.vendor_ad_lines
      add constraint vendor_ad_lines_net_payment_status_chk
      check (net_payment_status is null or net_payment_status in (
        'unpaid', 'paid', 'partial', 'no_payment', 'refund', 'credit', 'adjustment'
      ));
  end if;

  -- A negative net is not a discount, it is a typo. Refunds are a status,
  -- not a sign.
  if not exists (
    select 1 from pg_constraint where conname = 'vendor_ad_lines_net_amount_chk'
  ) then
    alter table public.vendor_ad_lines
      add constraint vendor_ad_lines_net_amount_chk
      check (net_amount is null or net_amount >= 0);
  end if;
end $$;

comment on column public.vendor_ad_lines.quotation_no is
  'Quotation this single ad was quoted under. Ads on one booking can be quoted separately.';
comment on column public.vendor_ad_lines.net_amount is
  'What AQ nets on this ad. Null = not worked out yet, which is not the same as zero.';

-- ───────────────────────────────────────────────────────────────────
-- 2. Vendor payment terms
--
--    On pm_tasks so a vendor booking (a subtask) carries its own terms, and
--    the campaign row can carry a default for the whole campaign.
-- ───────────────────────────────────────────────────────────────────

alter table public.pm_tasks
  add column if not exists payment_terms     text,
  add column if not exists payment_split_pct integer,
  add column if not exists payment_net_days  integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_payment_terms_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_payment_terms_chk
      check (payment_terms is null or payment_terms in (
        'split',        -- part before, the rest after: payment_split_pct is the first part
        'on_delivery',  -- all of it once the work is done
        'in_advance',   -- all of it before anything is posted
        'net_days'      -- all of it, payment_net_days after delivery
      ));
  end if;

  -- 50/50 is the usual one, but 30/70 happens. Anything outside 1–99 is not
  -- a split — it is one of the other three terms.
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_payment_split_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_payment_split_chk
      check (payment_split_pct is null
             or (payment_split_pct >= 1 and payment_split_pct <= 99));
  end if;

  -- 30, 60 and 90 are the ones anybody actually agrees to; the range is
  -- wide enough for the exceptions and tight enough to catch a typed year.
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_payment_net_days_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_payment_net_days_chk
      check (payment_net_days is null
             or (payment_net_days >= 1 and payment_net_days <= 365));
  end if;
end $$;

comment on column public.pm_tasks.payment_terms is
  'split | on_delivery | in_advance | net_days. On a vendor subtask these are that vendor''s terms; on a campaign they are the default.';
comment on column public.pm_tasks.payment_split_pct is
  'For payment_terms = split: the percentage paid up front. 50 means 50/50.';
comment on column public.pm_tasks.payment_net_days is
  'For payment_terms = net_days: how many days after delivery payment falls due. 30, 60 and 90 are the usual ones.';

-- ───────────────────────────────────────────────────────────────────
-- 3. Realtime for everything the campaign page shows
--
--    055 published pm_tasks and stopped there, so a quotation raised by
--    somebody else, a contract coming back from Legal, an ad line added by
--    a colleague and a tracking row all needed a manual refresh to appear.
--
--    RLS still applies to realtime: a subscriber is only sent rows their
--    policies already let them read.
-- ───────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice '067: created publication supabase_realtime';
  end if;

  foreach t in array array[
    'vendor_ad_lines', 'document_requests', 'contract_requests',
    'tracking_rows', 'comments', 'task_attachments'
  ]
  loop
    -- Skip anything this database does not have rather than failing the
    -- whole migration on one absent table.
    if to_regclass('public.' || t) is null then
      raise notice '067: %  does not exist here — skipped', t;
      continue;
    end if;
    if exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice '067: % was already published', t;
    else
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice '067: % added to supabase_realtime', t;
    end if;
  end loop;
end $$;

-- ─── Verification ──────────────────────────────────────────────────
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime' and schemaname = 'public'
 order by tablename;
