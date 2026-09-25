-- ============================================================
-- 124_staff_read_contract_files.sql
-- The people reviewing a signed contract can open it.
--
-- Migration 084 built the accept/reject flow for signed copies vendors and
-- clients upload. `fafd3f5` gave it a screen in this app, because the only
-- screen it had was the contract app's and that app is retired. What it could
-- not do was SHOW anybody the document:
--
--   policyname                 | cmd | roles
--   contracts_service_role_all | ALL | {service_role}
--
-- One policy on the whole bucket, and `authenticated` is not in it. 1,245
-- objects that only the backend can read. So the review screen could record a
-- decision about a file nobody on it could look at, which is not reviewing -
-- it is guessing with an audit trail.
--
-- -- WHY THIS ADDS NO EXPOSURE ---------------------------------------
--
-- The predicate is public.is_staff(): any workspace member. That is EXACTLY
-- the predicate public.generated_contracts already uses for select, so every
-- person this lets read a file can already read that file's contract number,
-- parties and amount, and can already download the file itself through the
-- backend's secure-download route (ContractsView does this today, and its
-- comment says so).
--
-- What changes is the number of hops, not the number of people. The round
-- trip that used to go through the contract app's backend now does not,
-- which is the point of retiring the contract app.
--
-- -- WHY select ONLY -------------------------------------------------
--
-- Read, and nothing else. service_role keeps insert, update and delete to
-- itself: the backend writes these objects and this app has no business
-- changing or removing one. A signed contract is evidence, and an app that
-- can delete the evidence is a worse thing to own than one that cannot show
-- it.
--
-- The bucket stays PRIVATE. Reads still go through a signed URL the app asks
-- for per download, valid for sixty seconds - the same way legal-signed (117)
-- and the template bucket (115) already work.
--
-- Idempotent: the policy is dropped and recreated, so a second run is a
-- no-op. Nothing else in the bucket's setup is touched.
-- ============================================================

-- The backend policy, counted BEFORE anything is touched. The check at the
-- bottom compares the two counts rather than demanding a fixed number: the
-- failure worth catching is this migration REMOVING the policy the backend
-- depends on, and "it is still exactly as I found it" says that on a live
-- database and on an empty one alike. Demanding `= 1` said it only on the
-- live one, which is what stopped the replay here.
-- A plain statement, not a do-block: a do-block commits at its end, and a
-- temp table made `on commit drop` inside one is gone before the check runs.
-- This one lives for the psql session and is dropped by name at the bottom.
drop table if exists _124_before;
create temporary table _124_before as
select count(*) as n from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname = 'contracts_service_role_all';

-- The name says who it is for and what it grants, because the next person to
-- run the query at the top of this file will read the name before the body.
drop policy if exists "contracts staff read" on storage.objects;

create policy "contracts staff read" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'contracts' and public.is_staff());

-- Prove it, rather than trust it.
--
-- There is no session here, so is_staff() is false and the policy cannot be
-- exercised by selecting. What CAN be checked is that the policy exists, is a
-- SELECT policy, is scoped to `authenticated`, and that the service-role
-- policy it sits beside is still intact - the failure worth catching is a
-- `create policy` that quietly replaced the one the backend depends on.
do $$
declare
  n_read    integer;
  n_service integer;
  n_before  integer;
begin
  select count(*) into n_read from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'contracts staff read'
     and cmd = 'SELECT'
     and roles::text like '%authenticated%';
  if n_read <> 1 then
    raise exception 'storage: the staff read policy is not there as written (found %)', n_read;
  end if;

  select count(*) into n_service from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'contracts_service_role_all';
  select n into n_before from _124_before;
  if n_service <> n_before then
    raise exception
      'storage: the backend policy contracts_service_role_all went from % to % - this migration must not have touched it',
      n_before, n_service;
  end if;

  raise notice 'storage: staff can read the contracts bucket; the backend policy is untouched';
end $$;

drop table if exists _124_before;

-- Verify (paste this after running the migration):
-- select policyname, cmd, roles::text
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and (policyname = 'contracts staff read' or policyname = 'contracts_service_role_all')
--  order by policyname
-- expected: two rows - "contracts staff read" SELECT {authenticated},
--           and "contracts_service_role_all" ALL {service_role}
