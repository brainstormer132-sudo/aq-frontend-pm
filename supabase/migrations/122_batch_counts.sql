-- ============================================================
-- 122_batch_counts.sql
-- The Tasks screen stops reading every contract in the workspace.
--
-- -- WHAT IT COSTS TODAY ------------------------------------------------
--
-- useContractBatches shows "12 of 20 filled" per task. To get those three
-- numbers it read EVERY CONTRACT IN THE WORKSPACE - id, status, vendor_id -
-- paged in 1000s and chunked 60 batch-ids at a time, and then counted them in
-- JavaScript. With four thousand contracts that is four thousand rows and
-- around seventy requests, on every visit to the screen, to render sixty
-- characters of badge.
--
-- Nothing about that was careless: the paging and the chunking are there
-- because the unpaged version silently reported "0 of 0 filled" for every
-- batch past the thousandth contract, and the unchunked one sent an 11KB URL
-- that came back 414. This migration removes the reason those were needed.
--
-- Siraj's standing rule, which this is: "Real data breaks screens that were
-- fine with ten rows."
--
-- -- WHY AN RPC AND NOT A VIEW ------------------------------------------
--
-- PostgREST cannot GROUP BY, so the counting has to happen in the database
-- either way. A view would need `security_invoker` and would then be subject
-- to legal.contract's RLS per row, which is correct but means the planner
-- still walks every row the caller can see - the same work, moved. A
-- SECURITY DEFINER function does the aggregate once, in one round trip, and
-- carries the same role check every other legal RPC carries.
--
-- The check is not optional decoration: SECURITY DEFINER means the function
-- runs as its owner and RLS does NOT apply inside it, so without the guard
-- any authenticated user could count another workspace's contracts.
-- ============================================================

set search_path = legal, public;

create or replace function legal.batch_counts(p_workspace_id uuid)
  returns table (
    batch_id   uuid,
    total      bigint,
    unassigned bigint,
    issued     bigint
  )
  language plpgsql stable security definer
  set search_path = legal, public, pg_temp
  as $fn$
begin
  -- Same guard as create_contract_batch. auth.uid() first: has_role is happy
  -- to answer for a null uid in some shapes, and a count is still a read of
  -- somebody's data.
  if auth.uid() is null
     or not public.has_role(p_workspace_id, array['owner','admin','legal']) then
    raise exception 'Only legal can read the contract tasks.' using errcode = '42501';
  end if;

  return query
    select c.batch_id,
           count(*)                                          as total,
           count(*) filter (where c.vendor_id is null)        as unassigned,
           -- "Issued" on this screen has always meant "not a draft", which
           -- covers issued, signed and superseded. Kept exactly as the
           -- JavaScript had it so the badge cannot change meaning.
           count(*) filter (where c.status <> 'draft')        as issued
      from legal.contract c
     where c.workspace_id = p_workspace_id
       and c.batch_id is not null
     group by c.batch_id;
end;
$fn$;

revoke all on function legal.batch_counts(uuid) from public;
grant execute on function legal.batch_counts(uuid) to authenticated;

comment on function legal.batch_counts(uuid) is
  'Per-task contract counts for the Tasks screen: total, unassigned, not-draft. '
  'Replaces reading every contract in the workspace to count them client-side.';

-- An index for the group-by. legal.contract already has one on batch_id from
-- 112; this adds workspace_id in front of it so the filter and the grouping
-- are served by one index rather than a filter and then a sort.
create index if not exists idx_legal_contract_ws_batch
  on legal.contract (workspace_id, batch_id)
  where batch_id is not null;

-- Prove the QUERY runs, before proving the guard refuses ------------------
--
-- This one is not ceremony. plpgsql does not parse a function body until it
-- is called, so `create or replace function` accepts a body naming a column
-- that does not exist - and the guard below refuses before the query is ever
-- reached, so a refusal test proves nothing about it. I found exactly that on
-- a scratch database: the function installed happily against a schema with no
-- contract.vendor_id, and would have failed on Siraj's screen instead.
--
-- So: run the same aggregate here, as the migration's owner, where a wrong
-- column name is a failed migration rather than a broken Tasks screen.
do $$
declare n bigint;
begin
  select count(*) into n from (
    select c.batch_id,
           count(*)                                    as total,
           count(*) filter (where c.vendor_id is null)  as unassigned,
           count(*) filter (where c.status <> 'draft')  as issued
      from legal.contract c
     where c.batch_id is not null
     group by c.batch_id
  ) q;
  raise notice 'legal: the count query runs - % task(s) have contracts', n;
end $$;

-- Prove it answers, and that it refuses a caller with no session ----------
do $$
declare
  n integer;
begin
  -- With no JWT, auth.uid() is null, so this must refuse. If it does NOT
  -- raise, the guard is not wired and the function is readable by anyone.
  begin
    perform * from legal.batch_counts('00000000-0000-0000-0000-000000000000');
    raise exception 'legal: batch_counts answered a caller with no session';
  exception
    when sqlstate '42501' then
      null;  -- refused, which is the point
  end;

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'legal' and p.proname = 'batch_counts';
  if n <> 1 then
    raise exception 'legal: expected one batch_counts, found %', n;
  end if;
  raise notice 'legal: batch_counts is in place and refuses an anonymous caller';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration, as yourself in the SQL
-- editor - it will refuse under a session with no role):
--   select * from legal.batch_counts('<your workspace id>') order by total desc;
