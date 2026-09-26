-- ============================================================
-- 144_a_stranger_can_submit_a_registration.sql
-- The public registration link can put a row in the queue, and do
-- nothing else at all.
--
-- -- WHAT THIS IS FOR -------------------------------------------------
--
-- Siraj: "we need to build the registration for vendor and client with
-- arabic and english versions ... the old one is lost and closed down so
-- we have to make a new one for both vendors and clients, one link they
-- can choose either client or vendor".
--
-- One public page, no login. So the person filling it in is `anon` - the
-- key that ships in the browser bundle - and the database has to let that
-- key do exactly one thing.
--
-- -- WHAT ANON MAY DO -------------------------------------------------
--
-- INSERT one row, with `status = 'pending'` and no review on it. That is
-- all, and both halves of it matter:
--
--   * 'pending' is what VendorsView's queue filters on, so a submission
--     appears where somebody will see it. It is also what stops a stranger
--     inserting `status = 'approved'` and arriving in the queue already
--     looking decided.
--   * reviewed_at must be null, so nobody can submit a row that claims to
--     have been reviewed already.
--
-- -- WHAT ANON MAY NOT DO ---------------------------------------------
--
-- Read. Anything. The registration queues hold other people's licence
-- numbers, IBANs and bank account names, and a public form does not need
-- to see one of them to add to the pile.
--
-- Supabase grants anon SELECT on these tables by default. There was no
-- policy admitting anon, so it returned nothing - the gate held, but it
-- was one careless policy away from not holding. The grant is revoked
-- here as well, so a future mistake has to get two things wrong instead
-- of one. This is the 040 lesson in reverse: there, a column REVOKE did
-- nothing because the table grant was still there; here the table grant
-- is the thing being taken away, and it bites.
--
-- CONSEQUENCE FOR THE FORM: an insert cannot ask for the row back.
-- `.insert(row)` is fine; `.insert(row).select()` needs SELECT and will
-- fail. The form does not need the row - it needs to know the write
-- happened, which is what the absence of an error tells it.
-- ============================================================

-- 1. vendors ---------------------------------------------------------
drop policy if exists "pending_vendors public submit" on public.pending_vendors;
create policy "pending_vendors public submit" on public.pending_vendors
  for insert to anon, authenticated
  with check (status = 'pending' and reviewed_at is null);

revoke select, update, delete on public.pending_vendors from anon;

-- 2. clients ---------------------------------------------------------
drop policy if exists "pending_clients public submit" on public.pending_clients;
create policy "pending_clients public submit" on public.pending_clients
  for insert to anon, authenticated
  with check (status = 'pending' and reviewed_at is null);

revoke select, update, delete on public.pending_clients from anon;

-- 3. prove it, rather than trust it ----------------------------------
do $$
declare
  n_ins  integer;
  n_read integer;
  n_sel  integer;
begin
  -- The submit policy is there, on both, and it is INSERT only.
  select count(*) into n_ins from pg_policies
   where schemaname = 'public'
     and tablename in ('pending_vendors', 'pending_clients')
     and policyname like '% public submit'
     and cmd = 'INSERT'
     and roles::text like '%anon%';
  if n_ins <> 2 then
    raise exception 'registration: expected 2 anon INSERT policies, found %', n_ins;
  end if;

  -- And nothing else lets anon near these tables.
  select count(*) into n_read from pg_policies
   where schemaname = 'public'
     and tablename in ('pending_vendors', 'pending_clients')
     and roles::text like '%anon%'
     and cmd <> 'INSERT';
  if n_read > 0 then
    raise exception 'registration: % non-INSERT policy(ies) name anon on the queues', n_read;
  end if;

  -- The SELECT grant is gone, so even a careless policy later cannot
  -- hand a stranger somebody else's IBAN.
  select count(*) into n_sel from information_schema.table_privileges
   where table_schema = 'public'
     and table_name in ('pending_vendors', 'pending_clients')
     and grantee = 'anon'
     and privilege_type in ('SELECT', 'UPDATE', 'DELETE');
  if n_sel > 0 then
    raise exception 'registration: anon still holds % read/write grant(s) on the queues', n_sel;
  end if;

  raise notice 'registration: a stranger can add to the queue and read nothing';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select tablename, policyname, cmd, roles::text, with_check
--   from pg_policies
--  where tablename in ('pending_vendors','pending_clients')
--  order by tablename, policyname;
