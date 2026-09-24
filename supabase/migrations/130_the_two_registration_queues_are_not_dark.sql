-- ============================================================
-- 130_the_two_registration_queues_are_not_dark.sql
-- public.pending_vendors and public.pending_clients have row-level
-- security switched ON and NOT ONE POLICY on either of them.
--
-- Siraj, adding a vendor: "new row violates row-level security policy for
-- table pending_vendors".
--
-- -- WHAT THAT ACTUALLY MEANS ----------------------------------------
--
-- RLS with no policies is not "locked down pending review". It is DENY ALL,
-- for everybody except service_role and the table owner. And because
-- Postgres refuses the three verbs differently, the damage was mostly
-- SILENT:
--
--   INSERT  errors out loud. This is the only part anybody noticed, and
--           only because createApprovedVendorRegistration writes its audit
--           row BEFORE the vendor, so adding a vendor fails outright.
--   SELECT  returns ZERO ROWS. No error. The Vendors screen's "Pending"
--           tab has been showing "No pending requests" whether or not any
--           exist, and the tab's count has been 0.
--   UPDATE  matches zero rows. No error. approvePendingVendor and
--           rejectPendingVendor check `error` and there is none, so both
--           buttons have been reporting success and doing nothing.
--
-- So: a registration queue that cannot be read, approved or rejected, and
-- which nobody could tell was broken, because every symptom except one is
-- an empty list.
--
-- -- HOW IT GOT THIS WAY ---------------------------------------------
--
-- Archived migration 071 wrote it down in its own comment. It locked the
-- other backend tables behind a staff read policy and deliberately left
-- these two open, because "the vendor and client sign-up forms POST into
-- them from outside this repo" and PostgREST's default
-- `Prefer: return=representation` makes an insert need a read. It called
-- the open door "a real leak, and the next thing to fix".
--
-- Somebody then fixed the leak the fast way - switched RLS on - and did not
-- add the staff policies back. That closes the hole and takes the feature
-- with it.
--
-- -- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ---------------
--
-- It gives STAFF the access the two screens were written against, in the
-- shape every other table in this schema already uses: a `<table> staff
-- read` and a `<table> staff write`, both on public.is_staff(), exactly as
-- public.vendors and public.bank_accounts have.
--
-- It does NOT touch anon. If the external sign-up form still posts to these
-- tables as anon, it is refused today and it will still be refused after
-- this - and re-opening it means re-opening the read hole 071 described,
-- on rows that carry an IBAN and a CR number. That is a decision about a
-- form that lives outside this repo, so it is Siraj's, not this
-- migration's. The verify query at the foot reports whether anything has
-- landed in either queue, which is the evidence that decision needs.
-- ============================================================

set search_path = public;

-- Named and dropped first, so this migration is idempotent and so it can
-- never end up with two policies of the same intent disagreeing.
drop policy if exists "pending_vendors staff read"  on public.pending_vendors;
drop policy if exists "pending_vendors staff write" on public.pending_vendors;
drop policy if exists "pending_clients staff read"  on public.pending_clients;
drop policy if exists "pending_clients staff write" on public.pending_clients;

create policy "pending_vendors staff read"
  on public.pending_vendors for select
  using (public.is_staff());

create policy "pending_vendors staff write"
  on public.pending_vendors
  using (public.is_staff())
  with check (public.is_staff());

create policy "pending_clients staff read"
  on public.pending_clients for select
  using (public.is_staff());

create policy "pending_clients staff write"
  on public.pending_clients
  using (public.is_staff())
  with check (public.is_staff());

-- Prove it, structurally.
--
-- NOT by calling an insert and checking it goes through: there is no JWT in
-- the SQL editor and the editor's role owns these tables, so an insert here
-- would succeed whatever the policies say. A test whose result depends on
-- who runs it is not a test - the lesson migration 127 wrote down after
-- exactly that mistake.
do $$
declare
  n_read  integer;
  n_write integer;
  n_open  integer;
begin
  select count(*) into n_read
    from pg_policies
   where schemaname = 'public'
     and tablename in ('pending_vendors', 'pending_clients')
     and policyname like '%staff read'
     and cmd = 'SELECT'
     and qual like '%is_staff%';
  if n_read <> 2 then
    raise exception 'legal: expected 2 staff read policies, found %', n_read;
  end if;

  select count(*) into n_write
    from pg_policies
   where schemaname = 'public'
     and tablename in ('pending_vendors', 'pending_clients')
     and policyname like '%staff write'
     and cmd = 'ALL'
     and qual like '%is_staff%'
     and with_check like '%is_staff%';
  if n_write <> 2 then
    raise exception 'legal: expected 2 staff write policies, found %', n_write;
  end if;

  -- And nothing on these two tables lets the world in. A policy with a
  -- `true` predicate would make every assertion above pass while the queue
  -- stayed readable by anyone with a session - which is the hole 071 was
  -- trying to close.
  select count(*) into n_open
    from pg_policies
   where schemaname = 'public'
     and tablename in ('pending_vendors', 'pending_clients')
     and (qual = 'true' or with_check = 'true');
  if n_open <> 0 then
    raise exception 'legal: % policy(ies) on the registration queues are open to everybody', n_open;
  end if;

  raise notice 'legal: both registration queues are readable and writable by staff, and by nobody else';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from pg_policies where schemaname='public'
--      and tablename='pending_vendors')                                    as vendor_policies,
--   (select count(*) from pg_policies where schemaname='public'
--      and tablename='pending_clients')                                    as client_policies,
--   (select count(*) from pg_policies where schemaname='public'
--      and tablename in ('pending_vendors','pending_clients')
--      and (qual='true' or with_check='true'))                             as open_to_everybody,
--   (select count(*) from public.pending_vendors where status='pending')   as vendors_waiting,
--   (select count(*) from public.pending_clients where status='pending')   as clients_waiting,
--   (select count(*) from public.pending_vendors)                          as vendor_rows,
--   (select count(*) from public.pending_clients)                          as client_rows
-- expected: 2 | 2 | 0 | ? | ? | ? | ?
-- The four counts are the answer to "has anything been sitting in a queue
-- nobody could see" - send them back rather than checking them off.
