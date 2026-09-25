-- ============================================================
-- 136_a_client_contract_is_raised_from_the_campaign.sql
-- The client contract becomes a real contract.
--
-- Until now the Paperwork card's client contract button called
-- sendClientContractRequest, which wrote a row into public.contract_requests
-- and reported "The client contract has gone to Legal." It had not. That
-- queue was read by the contract app, which was deleted, so the request went
-- nowhere and the card showed it as sent because it read its own row back.
--
-- This is the client equivalent of create_contract_from_booking (107): the
-- campaign raises a draft, and legal open it in the Register, check it and
-- issue it.
--
-- -- WHY A SECOND FUNCTION AND NOT A FLAG ON THE FIRST ---------------
--
-- They resolve different templates, fill different fields, and link to
-- different things - a vendor contract hangs off a BOOKING and carries a
-- vendor and a bank account; a client contract hangs off the CAMPAIGN and
-- carries neither. A single function with a kind parameter would be two
-- functions sharing a name and a body full of branches, and the branch that
-- got it wrong would put a vendor's bank details on a client's contract.
--
-- -- IT REFUSES CLEARLY UNTIL THE TEMPLATE IS PUBLISHED --------------
--
-- The client template exists as a DRAFT. Until somebody reads it and presses
-- Publish, this raises "No published client contract template in this
-- workspace" and names where to go. That is deliberate: the alternative is a
-- button that silently does nothing, which is what it has been doing for
-- months.
--
-- The same one-published-version rule 133 enforces applies here, so the
-- count can only be 0 or 1 once a template exists - but the >1 branch stays,
-- because a second TEMPLATE (not version) is still possible and picking one
-- of two wordings at random for a document somebody signs is worse than
-- failing.
--
-- -- WHAT IT DOES NOT RETURN ----------------------------------------
--
-- 107's rule, unchanged: operations learn that a contract exists and its id.
-- They cannot read the field values back through this, because those hold
-- what the client is being billed.
-- ============================================================

set search_path = legal, public;

create or replace function legal.create_client_contract_from_campaign(
  p_workspace_id uuid,
  p_pm_task_id   uuid,
  p_title        text,
  p_values       jsonb,
  /** The outputs table: one object per booked vendor. An ARRAY here, unlike
   *  the vendor function's single row - a client contract lists everybody on
   *  the campaign. */
  p_table_rows   jsonb default null,
  p_version_id   uuid  default null
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
  if p_pm_task_id is null then
    raise exception 'A client contract is raised from a campaign.' using errcode = '22023';
  end if;
  -- The campaign must belong to the workspace being claimed, or a member of
  -- workspace A could stamp a contract onto workspace B's campaign.
  if not exists (select 1 from public.pm_tasks t
                  where t.id = p_pm_task_id and t.workspace_id = p_workspace_id) then
    raise exception 'That campaign is not in this workspace.' using errcode = '42501';
  end if;

  if p_version_id is null then
    -- Counted first: a plain SELECT INTO takes the first row and reports
    -- ROW_COUNT 1 even when several matched, so it would quietly pick one of
    -- two wordings rather than saying the workspace is ambiguous.
    select count(*) into v_n
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'client_contract';
    if v_n = 0 then
      raise exception 'No published client contract template in this workspace. Publish it in Legal, under Documents.'
        using errcode = '42704';
    elsif v_n > 1 then
      raise exception 'More than one published client contract template (%); archive the ones you do not want, or pass a version id.', v_n
        using errcode = '21000';
    end if;
    select ver.id, ver.template_id into v_ver, v_tpl
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'client_contract';
  else
    select ver.id, ver.template_id into v_ver, v_tpl
      from legal.doc_template_version ver
     where ver.id = p_version_id
       and ver.workspace_id = p_workspace_id
       and ver.status = 'published';
    if v_ver is null then
      raise exception 'That template version is not published in this workspace.' using errcode = '42704';
    end if;
  end if;

  -- No subtask, no vendor, no bank account. A client contract is with the
  -- client; the vendors appear in its outputs table, not on the row.
  insert into legal.contract
    (workspace_id, template_id, version_id, title, status, created_by, pm_task_id)
  values
    (p_workspace_id, v_tpl, v_ver, btrim(p_title), 'draft', auth.uid(), p_pm_task_id)
  returning id into v_id;

  -- The prefilled values. Empty strings are skipped: an absent row and a row
  -- holding '' mean the same thing to the fill screen, and skipping keeps a
  -- half-known client from looking filled in.
  if p_values is not null and jsonb_typeof(p_values) = 'object' then
    for k, v in select key, value from jsonb_each_text(p_values) loop
      if coalesce(v, '') <> '' then
        insert into legal.contract_field (contract_id, workspace_id, key, value)
        values (v_id, p_workspace_id, k, v);
      end if;
    end loop;
  end if;

  -- The outputs table. The block id is part of the field key (lib/legal
  -- tableKey), and operations cannot read the blocks, so it is resolved here.
  -- A version with no table block simply gets no rows rather than failing:
  -- the contract is still the agreement, and the table is one clause of it.
  if p_table_rows is not null and jsonb_typeof(p_table_rows) = 'array'
     and jsonb_array_length(p_table_rows) > 0 then
    select b.id into v_block
      from legal.doc_template_block b
     where b.version_id = v_ver and b.block_type = 'table'
     order by b.position
     limit 1;
    if v_block is not null then
      insert into legal.contract_field (contract_id, workspace_id, key, value)
      values (v_id, p_workspace_id, '__aq_table_' || v_block::text, p_table_rows::text);
    end if;
  end if;

  return v_id;
end;
$fn$;

revoke all on function legal.create_client_contract_from_campaign(
  uuid, uuid, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function legal.create_client_contract_from_campaign(
  uuid, uuid, text, jsonb, jsonb, uuid) to authenticated;

-- Prove it ---------------------------------------------------------
--
-- Not by calling it: its first statement raises when auth.uid() is null,
-- which it is here, so the result would report who ran the migration rather
-- than whether the code is right (the lesson 127 wrote down). What is
-- asserted is the shape, and the two properties that would matter most if
-- they were wrong.
do $$
declare body text; n integer;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'legal' and p.proname = 'create_client_contract_from_campaign';
  if n <> 1 then
    raise exception 'legal: expected exactly 1 create_client_contract_from_campaign, found %', n;
  end if;

  select pg_get_functiondef(p.oid) into body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'legal' and p.proname = 'create_client_contract_from_campaign';

  -- The membership check, and the shape that makes it safe: "no uid OR not a
  -- member", never "uid is not null AND not a member", which is the form that
  -- let an unauthenticated caller through in the functions audit item A1.
  if body not like '%auth.uid() is null or not public.is_member_of%' then
    raise exception 'legal: the membership check is missing or the wrong way round';
  end if;
  -- It must resolve a CLIENT template. Raising a vendor contract here would
  -- put a vendor's bank details on a client's paper.
  if body not like '%client_contract%' then
    raise exception 'legal: it does not resolve a client contract template';
  end if;
  if body like '%bank_account_id%' then
    raise exception 'legal: a client contract must not carry a bank account';
  end if;

  raise notice 'legal: a campaign can raise a client contract, and only a member can';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal'
--       and p.proname='create_client_contract_from_campaign')              as fn,
--   (select count(*) from legal.doc_template_version v
--      join legal.doc_template t on t.id=v.template_id
--     where t.doc_kind='client_contract' and v.status='published')         as client_published
-- expected: 1 | 0 until you publish the template, then 1 | 1
