-- ============================================================
-- 127_only_legal_accepts_a_signed_copy.sql
-- Accepting a signed contract is a legal decision, not a staff one.
--
-- Siraj: "only legal and owners can accept and admin".
--
-- accept_signed_contract and reject_signed_contract have been guarded by
-- public.is_staff() since migration 084, and is_staff() is:
--
--   select exists (select 1 from public.workspace_members where user_id = auth.uid())
--
-- ANY member of ANY workspace. Marketing, operations, sales, finance - all of
-- them could accept a signed contract, which is the moment a document becomes
-- the agreement this company is held to. That was defensible when the only
-- caller was the contract app's own review screen, behind its own door. It is
-- not defensible now that the decision sits in the Register.
--
-- -- WHY NOT has_role() ---------------------------------------------
--
-- has_role(ws_id, roles) needs a workspace, and contract_signatures.workspace_id
-- IS NULLABLE BY DESIGN (084 says so at length): `vendors` carries no
-- workspace and neither does generated_contracts, so a vendor's upload usually
-- has none to record. Measured on the live data: every row that exists is in
-- that position.
--
-- So a workspace-scoped check would refuse every real row - it would look like
-- a tightening and behave like an outage. The honest predicate for a decision
-- on a workspace-less row is the same shape 126 used for the global
-- vendor_categories table: the role, held ANYWHERE.
--
-- -- WHAT IS DELIBERATELY UNCHANGED ---------------------------------
--
-- READING. The select policy stays `is_staff() or uploaded_by = auth.uid()`.
-- Somebody in operations should still be able to see that a vendor's signed
-- copy came back and is waiting; what they cannot do is be the one who says
-- it is good. Narrowing the read as well would only mean people asking legal
-- questions they could have answered by looking.
--
-- The uploader's own access is untouched: a vendor still sees their own rows
-- and still uploads, which is the half of 084 that has to keep working.
-- ============================================================

-- The predicate, named once, so two functions cannot drift apart.
create or replace function public.is_legal_reviewer() returns boolean
  language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
     where user_id = auth.uid()
       and role in ('owner', 'admin', 'legal')
  );
$$;

comment on function public.is_legal_reviewer() is
  'True when the caller is an owner, admin or legal in ANY workspace. For decisions on rows that carry no workspace_id - see contract_signatures, whose workspace_id is nullable by design.';

revoke all on function public.is_legal_reviewer() from public, anon;
grant execute on function public.is_legal_reviewer() to authenticated, service_role;

-- Accept. Body unchanged from 084 apart from the guard and its message.
create or replace function public.accept_signed_contract(p_id uuid)
  returns public.contract_signatures
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  row public.contract_signatures;
begin
  if not public.is_legal_reviewer() then
    raise exception 'Only legal, an admin or an owner can accept a signed contract'
      using errcode = '42501';
  end if;

  select * into row from public.contract_signatures where id = p_id;
  if row.id is null then
    raise exception 'Signed contract % not found', p_id;
  end if;

  if row.status = 'accepted' then
    return row;                                  -- already done
  end if;
  if row.status = 'rejected' then
    raise exception 'Signed contract % was rejected; the uploader must send a corrected copy', p_id;
  end if;

  update public.contract_signatures
     set status           = 'accepted',
         rejection_reason = null,
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = p_id
   returning * into row;

  return row;
end $$;

-- Reject, same change.
create or replace function public.reject_signed_contract(p_id uuid, p_reason text)
  returns public.contract_signatures
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  row public.contract_signatures;
begin
  if not public.is_legal_reviewer() then
    raise exception 'Only legal, an admin or an owner can reject a signed contract'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A rejection needs a reason';
  end if;

  select * into row from public.contract_signatures where id = p_id;
  if row.id is null then
    raise exception 'Signed contract % not found', p_id;
  end if;

  if row.status = 'accepted' then
    raise exception 'Signed contract % was already accepted', p_id;
  end if;

  update public.contract_signatures
     set status           = 'rejected',
         rejection_reason = btrim(p_reason),
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = p_id
   returning * into row;

  return row;
end $$;

-- Grants are unchanged from 084 - the functions gate themselves - but stated
-- again so a fresh database built from these files ends up the same.
grant execute on function public.accept_signed_contract(uuid)       to authenticated, service_role;
grant execute on function public.reject_signed_contract(uuid, text) to authenticated, service_role;

-- Prove it, rather than trust it.
--
-- WHAT THIS CANNOT TEST, AND WHY IT DOES NOT TRY.
--
-- The obvious probe is "call it and check it refuses". That probe is WRONG
-- here, and writing it first is how this was caught: it passes only when the
-- person running the migration does NOT hold owner, admin or legal - which is
-- true of the SQL editor (no JWT, so auth.uid() is null) and false of a
-- developer running it through psql as themselves. A self-test whose result
-- depends on who is running it is a self-test that will one day fail for a
-- reason that has nothing to do with the code.
--
-- So what is asserted here is the STRUCTURAL fact, which is true for
-- everybody: both functions now consult is_legal_reviewer and neither still
-- consults is_staff. The behaviour - legal, admin and owner through,
-- marketing refused, and the guard firing BEFORE the row lookup so an
-- outsider cannot learn which ids exist - is tested on a scratch database
-- with the membership stubbed, which is the only place a role can be held on
-- demand.
do $$
declare
  n integer;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'is_legal_reviewer';
  if n <> 1 then raise exception 'signatures: is_legal_reviewer was not created'; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('accept_signed_contract', 'reject_signed_contract')
     and pg_get_functiondef(p.oid) like '%is_legal_reviewer%';
  if n <> 2 then
    raise exception 'signatures: % of the two decisions consult is_legal_reviewer, not 2', n;
  end if;

  -- The one that would be missed by checking only the new guard is there:
  -- a `create or replace` that added the new check and left the old one.
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('accept_signed_contract', 'reject_signed_contract')
     and pg_get_functiondef(p.oid) like '%is_staff%';
  if n <> 0 then
    raise exception 'signatures: % of the two decisions still consult is_staff', n;
  end if;

  raise notice 'signatures: accepting and rejecting are now legal, admin or owner only';
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.proname='is_legal_reviewer')          as predicate,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.proname in
--       ('accept_signed_contract','reject_signed_contract')
--       and pg_get_functiondef(p.oid) like '%is_legal_reviewer%')          as guarded,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname='public' and p.proname in
--       ('accept_signed_contract','reject_signed_contract')
--       and pg_get_functiondef(p.oid) like '%is_staff%')                   as still_on_is_staff
-- expected: 1 | 2 | 0
