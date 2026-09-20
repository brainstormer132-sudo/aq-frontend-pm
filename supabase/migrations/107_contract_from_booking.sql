-- ============================================================
-- 107_contract_from_booking.sql
-- Operations raises the contract; legal checks it and issues it.
--
-- legal.* is RLS'd to owner/admin/legal for both read and write
-- (100_contracts.sql:90-94). The people actually on the campaign page -
-- operations, marketing, key account - cannot insert a legal.contract at all,
-- cannot read the template blocks to find the outputs table, and cannot read
-- back the contracts already raised for a booking. The old "Ask" button does
-- not hit this because it writes public.contract_requests, not legal.*.
--
-- So the two things operations needs are SECURITY DEFINER functions with the
-- check in the BODY, not just on the grant. That distinction is the whole of
-- audit items A1-A4: eight functions were granted to anon with no auth check
-- inside them, and the grant was the only thing standing in the way. Here:
--
--   * anon gets no EXECUTE at all
--   * both functions raise unless auth.uid() is a member of the workspace
--     they were asked about - written as "auth.uid() is null OR not member",
--     never "is not null AND not member", which is the shape that let an
--     unauthenticated caller skip the check in publish_tracking_sheet
--   * neither returns a contract's field VALUES, so raising a contract does
--     not become a way to read one. Operations sees that a contract exists
--     and its status; the document stays with legal.
--
-- create_contract_from_booking also finally sets contract.created_by, which
-- nothing in the app has ever written despite the fingerprint card presenting
-- itself as an audit stamp.
--
-- Idempotent (create or replace). Run in staging, then prod. Then: notify pgrst.
-- ============================================================

-- 1. raise a contract from a booking ------------------------------

create or replace function legal.create_contract_from_booking(
  p_workspace_id    uuid,
  p_pm_task_id      uuid,
  p_subtask_id      uuid,
  p_vendor_id       bigint,
  p_bank_account_id bigint,
  p_title           text,
  p_values          jsonb,
  p_table_row       jsonb default null,
  p_version_id      uuid  default null
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

  -- The campaign and the booking must belong to the workspace being claimed,
  -- or a member of workspace A could stamp a contract onto workspace B's
  -- campaign and hand its id back.
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

  -- Which template. Operations cannot read doc_template_version, so the
  -- default is resolved here: the one published vendor_contract. 105 archives
  -- every other one precisely so this is unambiguous; if it is not, say so
  -- rather than picking one at random.
  if p_version_id is null then
    -- Counted first on purpose: a plain SELECT INTO takes the first row and
    -- reports ROW_COUNT 1 even when several matched, so it would quietly pick
    -- one of two templates rather than saying the workspace is ambiguous.
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

  -- The prefilled values. Empty strings are skipped: an absent row and a row
  -- holding '' mean the same thing to the fill screen, and skipping keeps a
  -- half-known booking from looking filled.
  if p_values is not null and jsonb_typeof(p_values) = 'object' then
    for k, v in select key, value from jsonb_each_text(p_values) loop
      if coalesce(v, '') <> '' then
        insert into legal.contract_field (contract_id, workspace_id, key, value)
        values (v_id, p_workspace_id, k, v);
      end if;
    end loop;
  end if;

  -- The outputs table's one row. The block id is part of the field key
  -- (lib/legal.ts tableKey), and operations cannot read the blocks, so it is
  -- resolved here. A version with no table block simply gets no row.
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

-- 2. what operations is allowed to see back -----------------------
-- Status only. No titles of other people's contracts, no field values, and
-- nothing at all for a campaign in a workspace the caller is not in.

create or replace function legal.contracts_for_campaign(p_pm_task_id uuid)
  returns table(contract_id uuid, subtask_id uuid, title text, status text, created_at timestamptz)
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
    select c.id, c.subtask_id, c.title, c.status, c.created_at
      from legal.contract c
     where c.workspace_id = v_ws
       and (c.pm_task_id = p_pm_task_id
            or c.subtask_id in (select s.id from public.pm_tasks s
                                 where s.parent_task_id = p_pm_task_id))
     order by c.created_at desc;
end;
$fn$;

-- 3. grants -------------------------------------------------------
-- authenticated only. The bodies above are what actually decide.

revoke all on function legal.create_contract_from_booking(uuid, uuid, uuid, bigint, bigint, text, jsonb, jsonb, uuid) from public;
revoke all on function legal.contracts_for_campaign(uuid) from public;

grant execute on function legal.create_contract_from_booking(uuid, uuid, uuid, bigint, bigint, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function legal.contracts_for_campaign(uuid) to authenticated;
