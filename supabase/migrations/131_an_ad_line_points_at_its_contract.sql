-- ============================================================
-- 131_an_ad_line_points_at_its_contract.sql
-- The first of three, closing the split between a contract REQUEST and a
-- contract.
--
-- Siraj chose: retire the request completely. One press on a booking raises
-- the legal draft, and legal pick it up in the Register. This migration is
-- the foundation - it changes nothing about what the app does yet, so it is
-- safe to run ahead of the code.
--
-- -- WHY THE AD LINE IS THE PIECE THAT WAS MISSING --------------------
--
-- The campaign's vendor card has two buttons, Ask and Draft, and the code
-- says why in its own comment: "Separate from Ask on purpose while both
-- worlds exist: Ask sends a request to the contract app, Draft puts a real
-- contract in the Register." The contract app has since been deleted, so Ask
-- writes into a system with no reader.
--
-- Draft cannot simply replace it, because three things on that card are
-- computed from the REQUEST and have no equivalent on legal.contract:
--
--   coverage  which of a booking's ads are already under contract, read from
--             vendor_ad_lines.contract_request_id. This is what makes "Ask
--             for the rest" work when March's ads are contracted and June's
--             are not.
--   the plan  how many contracts a booking becomes - one combined, or one
--             per line - computed from the lines with no request on them.
--   stuck     asked for and never came back.
--
-- legal.contract has pm_task_id and subtask_id but nothing at the AD level,
-- and a booking is not the unit: one vendor booked for a Home Ad in March and
-- a Store Visit in June is two contracts against one booking. So the ad line
-- gets a pointer at its contract, exactly as it already has one at its
-- request, and the three computations above can move over without losing the
-- granularity Siraj asked for when he said "all combined to one contract or
-- multiple contract based on the vendor lines".
--
-- -- ON DELETE SET NULL, DELIBERATELY ---------------------------------
--
-- A draft that is deleted must free its ads. The alternative is an ad
-- permanently marked "under contract" by a contract that no longer exists,
-- which would quietly make it impossible to raise a new one for that ad - the
-- worst kind of bug, because the screen would simply show nothing to do.
-- ============================================================

set search_path = public;

-- 1. the pointer ---------------------------------------------------
alter table public.vendor_ad_lines
  add column if not exists contract_id uuid
    references legal.contract(id) on delete set null;

comment on column public.vendor_ad_lines.contract_id is
  'The legal.contract covering this ad (131). All the lines on a booking pointing at one contract is a combined contract; different contracts is a split. Null = this ad is not under contract yet. Replaces contract_request_id, which pointed at the deleted contract app.';

create index if not exists vendor_ad_lines_contract_idx
  on public.vendor_ad_lines (contract_id) where contract_id is not null;

-- 2. raising a contract stamps the ads it covers -------------------
--
-- DROPPED FIRST, not just replaced. Adding a parameter with a default makes
-- `create or replace` an OVERLOAD rather than a replacement: both the nine
-- and the ten argument versions would exist, PostgREST would advertise both,
-- and which one a call landed on would depend on how the client spelled its
-- arguments. One of them would stamp the ads and one would not.
drop function if exists legal.create_contract_from_booking(
  uuid, uuid, uuid, bigint, bigint, text, jsonb, jsonb, uuid);

create or replace function legal.create_contract_from_booking(
  p_workspace_id    uuid,
  p_pm_task_id      uuid,
  p_subtask_id      uuid,
  p_vendor_id       bigint,
  p_bank_account_id bigint,
  p_title           text,
  p_values          jsonb,
  p_table_row       jsonb default null,
  p_version_id      uuid  default null,
  /** The ads this contract covers. Null means the whole booking and stamps
   *  nothing - which is what every caller did before 131. */
  p_line_ids        uuid[] default null
) returns uuid
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_ver   uuid;
  v_tpl   uuid;
  v_block uuid;
  v_id    uuid;
  v_n     integer;
  k       text;
  v       text;
begin
  if auth.uid() is null or not public.is_member_of(p_workspace_id) then
    raise exception 'You do not have permission to raise a contract here.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'A contract needs a title.' using errcode = '22023';
  end if;

  if p_pm_task_id is not null and not exists (
       select 1 from public.pm_tasks t
        where t.id = p_pm_task_id and t.workspace_id = p_workspace_id) then
    raise exception 'That campaign is not in this workspace.' using errcode = '42501';
  end if;
  if p_subtask_id is not null and not exists (
       select 1 from public.pm_tasks t
        where t.id = p_subtask_id and t.workspace_id = p_workspace_id) then
    raise exception 'That booking is not in this workspace.' using errcode = '42501';
  end if;

  if p_version_id is null then
    select count(*) into v_n
      from legal.doc_template_version v
      join legal.doc_template t on t.id = v.template_id
     where v.workspace_id = p_workspace_id
       and v.status = 'published'
       and t.doc_kind = 'vendor_contract';
    if v_n = 0 then
      raise exception 'No published vendor contract template in this workspace.' using errcode = '42704';
    elsif v_n > 1 then
      raise exception 'More than one published vendor contract template (%); archive the ones you do not want, or pass a version id.', v_n
        using errcode = '21000';
    end if;
    select v.id, v.template_id into v_ver, v_tpl
      from legal.doc_template_version v
      join legal.doc_template t on t.id = v.template_id
     where v.workspace_id = p_workspace_id
       and v.status = 'published'
       and t.doc_kind = 'vendor_contract';
  else
    select v.id, v.template_id into v_ver, v_tpl
      from legal.doc_template_version v
     where v.id = p_version_id
       and v.workspace_id = p_workspace_id
       and v.status = 'published';
    if v_ver is null then
      raise exception 'That template version is not published in this workspace.' using errcode = '42704';
    end if;
  end if;

  insert into legal.contract
    (workspace_id, template_id, version_id, title, status, created_by,
     pm_task_id, subtask_id, vendor_id, bank_account_id)
  values
    (p_workspace_id, v_tpl, v_ver, btrim(p_title), 'draft', auth.uid(),
     p_pm_task_id, p_subtask_id, p_vendor_id, p_bank_account_id)
  returning id into v_id;

  -- The ads this contract covers (131).
  --
  -- Three guards, and each one is a way the old request system could be made
  -- to lie:
  --
  --   subtask_id = p_subtask_id   an id from another booking cannot be
  --                               stamped, so a caller cannot mark somebody
  --                               else's ads as covered by this contract.
  --   contract_id is null         an ad already under contract is never
  --                               MOVED. Two contracts covering one ad is the
  --                               state nobody can unpick afterwards.
  --   row_count = 0 -> raise      if nothing could be stamped, every ad asked
  --                               for is already covered, and what would
  --                               otherwise be created is a contract covering
  --                               nothing. The raise rolls the insert above
  --                               back with it.
  if p_line_ids is not null and array_length(p_line_ids, 1) > 0 then
    update public.vendor_ad_lines
       set contract_id = v_id
     where id = any(p_line_ids)
       and subtask_id = p_subtask_id
       and contract_id is null;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'Every ad in that request is already under contract.'
        using errcode = '22023';
    end if;
  end if;

  if p_values is not null and jsonb_typeof(p_values) = 'object' then
    for k, v in select key, value from jsonb_each_text(p_values) loop
      if coalesce(v, '') <> '' then
        insert into legal.contract_field (contract_id, workspace_id, key, value)
        values (v_id, p_workspace_id, k, v);
      end if;
    end loop;
  end if;

  if p_table_row is not null and jsonb_typeof(p_table_row) = 'object'
     and p_table_row <> '{}'::jsonb then
    select b.id into v_block
      from legal.doc_template_block b
     where b.version_id = v_ver and b.block_type = 'table'
     order by b.position
     limit 1;
    if v_block is not null then
      insert into legal.contract_field (contract_id, workspace_id, key, value)
      values (v_id, p_workspace_id, '__aq_table_' || v_block::text,
              jsonb_build_array(p_table_row)::text);
    end if;
  end if;

  return v_id;
end;
$fn$;

revoke all on function legal.create_contract_from_booking(
  uuid, uuid, uuid, bigint, bigint, text, jsonb, jsonb, uuid, uuid[]) from public, anon;
grant execute on function legal.create_contract_from_booking(
  uuid, uuid, uuid, bigint, bigint, text, jsonb, jsonb, uuid, uuid[]) to authenticated;

-- 3. prove it ------------------------------------------------------
--
-- The function itself cannot be called here: its first statement raises when
-- auth.uid() is null, which it is in the SQL editor. Asserting that refusal
-- would test who ran the migration, not the code (the lesson 127 wrote down).
--
-- So the STAMPING STATEMENT is exercised directly, against real ad lines, and
-- rolled back. That is the part with the guards in it, and the part that
-- would silently cover the wrong ads.
do $$
declare
  ws    uuid;
  tpl   uuid;
  ver   uuid;
  l_a   uuid;
  l_b   uuid;
  sub_a uuid;
  sub_b uuid;
  c1    uuid;
  c2    uuid;
  n     integer;
begin
  select l.id, l.subtask_id into l_a, sub_a
    from public.vendor_ad_lines l
   where l.contract_id is null
   order by l.created_at limit 1;
  if l_a is null then
    raise notice 'legal: no ad lines to probe against - skipping the stamp checks';
    return;
  end if;
  select l.id, l.subtask_id into l_b, sub_b
    from public.vendor_ad_lines l
   where l.contract_id is null and l.subtask_id <> sub_a
   order by l.created_at limit 1;

  -- REAL contracts, because contract_id is a foreign key. Two invented uuids
  -- would fail on the constraint rather than on the logic, and the probe
  -- would be testing nothing while appearing to pass.
  select id into ws from public.workspaces limit 1;
  select v.id, v.template_id into ver, tpl
    from legal.doc_template_version v
    join legal.doc_template t on t.id = v.template_id
   where t.workspace_id = ws limit 1;
  if ws is null or ver is null then
    raise notice 'legal: no template version to probe against - skipping the stamp checks';
    return;
  end if;

  begin
    insert into legal.contract (workspace_id, template_id, version_id, title, status)
    values (ws, tpl, ver, '__probe_stamp_1__', 'draft') returning id into c1;
    insert into legal.contract (workspace_id, template_id, version_id, title, status)
    values (ws, tpl, ver, '__probe_stamp_2__', 'draft') returning id into c2;

    -- (a) an ad on THIS booking is stamped
    update public.vendor_ad_lines set contract_id = c1
     where id = any(array[l_a]) and subtask_id = sub_a and contract_id is null;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'legal: the ad on this booking was not stamped'; end if;

    -- (b) it is never MOVED to a second contract
    update public.vendor_ad_lines set contract_id = c2
     where id = any(array[l_a]) and subtask_id = sub_a and contract_id is null;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'legal: an ad already under contract was moved'; end if;
    if (select contract_id from public.vendor_ad_lines where id = l_a) <> c1 then
      raise exception 'legal: the ad ended up on the wrong contract';
    end if;

    -- (c) an ad on ANOTHER booking cannot be stamped by this one
    if l_b is not null then
      update public.vendor_ad_lines set contract_id = c1
       where id = any(array[l_b]) and subtask_id = sub_a and contract_id is null;
      get diagnostics n = row_count;
      if n <> 0 then
        raise exception 'legal: an ad from another booking was stamped';
      end if;
    end if;

    -- (d) deleting the contract FREES its ads rather than stranding them
    delete from legal.contract where id = c1;
    if (select contract_id from public.vendor_ad_lines where id = l_a) is not null then
      raise exception 'legal: deleting the contract left its ad marked as covered';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: an ad is stamped once, never moved, never across bookings, and freed when its contract goes';
  end;
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='public' and table_name='vendor_ad_lines'
--       and column_name='contract_id')                                    as line_column,
--   (select count(*) from pg_indexes where schemaname='public'
--      and indexname='vendor_ad_lines_contract_idx')                      as line_index,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname='create_contract_from_booking') as fn_versions,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname='create_contract_from_booking'
--       and pg_get_functiondef(p.oid) like '%vendor_ad_lines%')            as fn_stamps,
--   (select count(*) from public.vendor_ad_lines where contract_id is not null) as stamped_now
-- expected: 1 | 1 | 1 | 1 | 0
-- fn_versions MUST be 1. Two means the old nine-argument version survived the
-- drop and half the calls will not stamp anything.
