-- ============================================================
-- 132_operations_can_see_a_contract_come_back.sql
-- The campaign card needs three more facts about a contract.
--
-- Second of three. 131 gave an ad line a pointer at its contract; this gives
-- the campaign screen enough about that contract to say where it has got to,
-- so the "asked for and never came back" tracking can stop reading
-- public.contract_requests.
--
-- -- WHAT WAS MISSING --------------------------------------------------
--
-- contracts_for_campaign (107) returns status and created_at. The card it
-- feeds has always said more than that, because the request rows it used to
-- read carried more: the DOCUMENT NUMBER on the badge, and the DATE something
-- came back. Dropping to "Signed" with no number and no date would be a
-- worse screen than the one being replaced, and the reason would be
-- invisible - it would just look like the dates stopped working.
--
-- So: contract_no, signed_on, and issued_at.
--
-- issued_at is the interesting one. It is NOT a column - the moment a
-- contract was issued is written as a contract_field under the reserved key
-- __aq_issued_at, because it goes inside the fingerprint (the seal covers
-- when it was issued). Operations cannot read legal.contract_field at all,
-- and should not be able to - that table holds the fee and the bank details.
-- So the one reserved key is resolved HERE, by name, and nothing else from
-- that table crosses the line. 107's rule still holds: operations learn that
-- a contract exists and where it has got to; the document stays with legal.
--
-- -- WHY DROP AND RECREATE ---------------------------------------------
--
-- A function's RETURN TYPE cannot be changed by `create or replace` -
-- Postgres refuses with "cannot change return type of existing function".
-- Unlike 131's overload trap this one fails loudly, but it still has to be
-- dropped first, and the grant re-issued after.
-- ============================================================

set search_path = legal, public;

drop function if exists legal.contracts_for_campaign(uuid);

create or replace function legal.contracts_for_campaign(p_pm_task_id uuid)
  returns table(
    contract_id uuid,
    subtask_id  uuid,
    title       text,
    status      text,
    contract_no text,
    issued_at   text,
    signed_on   date,
    created_at  timestamptz)
  language plpgsql stable security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare v_ws uuid;
begin
  select t.workspace_id into v_ws from public.pm_tasks t where t.id = p_pm_task_id;
  if v_ws is null then
    return;
  end if;
  if auth.uid() is null or not public.is_member_of(v_ws) then
    raise exception 'You do not have permission to read this campaign.' using errcode = '42501';
  end if;

  return query
    select c.id, c.subtask_id, c.title, c.status, c.contract_no,
           -- The ONE reserved key, by name. A join that selected f.value for
           -- whatever key happened to be there would hand operations the fee.
           (select f.value from legal.contract_field f
             where f.contract_id = c.id and f.key = '__aq_issued_at'
             limit 1),
           c.signed_on,
           c.created_at
      from legal.contract c
     where c.workspace_id = v_ws
       and (c.pm_task_id = p_pm_task_id
            or c.subtask_id in (select s.id from public.pm_tasks s
                                 where s.parent_task_id = p_pm_task_id))
     order by c.created_at desc;
end;
$fn$;

revoke all on function legal.contracts_for_campaign(uuid) from public, anon;
grant execute on function legal.contracts_for_campaign(uuid) to authenticated;

-- Prove it -------------------------------------------------------
--
-- Structurally, and by one thing that is worth more than the structure: that
-- the function cannot be made to return a field value other than the issued
-- stamp. Calling it is not possible here (auth.uid() is null, so it raises -
-- the lesson 127 wrote down), so what is checked is the shape of the body.
do $$
declare
  n_cols integer;
  body   text;
begin
  select count(*) into n_cols
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    cross join lateral unnest(p.proallargtypes) as t(oid)
   where ns.nspname = 'legal' and p.proname = 'contracts_for_campaign';
  if n_cols <> 9 then
    raise exception 'legal: contracts_for_campaign has % arguments and columns, expected 9', n_cols;
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'legal' and p.proname = 'contracts_for_campaign';

  if body not like '%__aq_issued_at%' then
    raise exception 'legal: the issued stamp is not being returned';
  end if;
  -- The guard that matters: contract_field is read ONCE, and only for that
  -- key. A second reference would mean somebody widened the hole.
  if (length(body) - length(replace(body, 'legal.contract_field', ''))) / length('legal.contract_field') <> 1 then
    raise exception 'legal: contract_field is read more than once - operations may be seeing field values';
  end if;
  if body not like '%is_member_of%' then
    raise exception 'legal: the membership check is gone';
  end if;

  raise notice 'legal: the campaign card can see status, number, issue and signature - and nothing else';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname='contracts_for_campaign')       as fn_versions,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname='contracts_for_campaign'
--       and pg_get_functiondef(p.oid) like '%__aq_issued_at%')             as returns_issued,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname='create_contract_from_booking') as booking_fn_versions
-- expected: 1 | 1 | 1
