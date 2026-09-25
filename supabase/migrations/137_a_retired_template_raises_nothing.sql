-- ============================================================
-- 137_a_retired_template_raises_nothing.sql
-- "Retire" hides a template from the Documents screen and nothing else.
--
-- Found looking for a client contract template that was in the database and
-- not on the screen. It was retired - migration 119's doc_template.archived_at
-- - and splitTemplates hides retired templates from the list, which is
-- correct. What is not correct is that NOTHING ELSE KNOWS.
--
-- create_contract_from_booking (107) and create_client_contract_from_campaign
-- (136) both resolve a template by doc kind and published version. Neither
-- looks at archived_at. So a retired template whose last version is published
-- still gets picked for every new contract raised from a campaign - the
-- button on the Retire row says "this one is out of use" and the app goes on
-- using it, invisibly, because the screen that would have shown it is the one
-- place it is hidden.
--
-- 119 put the rule in lib/legal (`withoutArchived`, "drop the versions whose
-- template has been retired") and the NEW-CONTRACT PICKER honours it. The two
-- security-definer functions that raise a contract without going through that
-- picker do not, and they are the paths operations actually use.
--
-- -- AND THE ERROR NOW SAYS WHICH PROBLEM IT IS ----------------------
--
-- "No published client contract template in this workspace" is true but
-- unhelpful when one exists and is retired: it sends somebody to publish a
-- template they cannot see. The refusal now distinguishes the two, because
-- the fix is different - publish a draft, or restore a retired template.
-- ============================================================

set search_path = legal, public;

-- 1. the vendor path ------------------------------------------------
--
-- Only the template resolution changes. The whole body is repeated because
-- a function is replaced whole, and a reader comparing 131 with this should
-- see the difference rather than reconstruct it.
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
  p_line_ids        uuid[] default null
) returns uuid
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_ver     uuid;
  v_tpl     uuid;
  v_block   uuid;
  v_id      uuid;
  v_n       integer;
  v_retired integer;
  k         text;
  v         text;
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
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'vendor_contract'
       and t.archived_at is null;
    if v_n = 0 then
      -- Say WHICH problem it is. Publishing a draft and restoring a retired
      -- template are different actions, and one of them is impossible from a
      -- screen that hides what it is talking about.
      select count(*) into v_retired
        from legal.doc_template_version ver
        join legal.doc_template t on t.id = ver.template_id
       where ver.workspace_id = p_workspace_id
         and ver.status = 'published'
         and t.doc_kind = 'vendor_contract'
         and t.archived_at is not null;
      if v_retired > 0 then
        raise exception 'The vendor contract template is retired. Restore it in Legal, under Documents, to raise contracts from it again.'
          using errcode = '42704';
      end if;
      raise exception 'No published vendor contract template in this workspace.' using errcode = '42704';
    elsif v_n > 1 then
      raise exception 'More than one published vendor contract template (%); archive the ones you do not want, or pass a version id.', v_n
        using errcode = '21000';
    end if;
    select ver.id, ver.template_id into v_ver, v_tpl
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'vendor_contract'
       and t.archived_at is null;
  else
    -- An explicit version id is a deliberate choice by a person, so it is
    -- allowed to reach a retired template: reprinting or correcting an old
    -- contract is exactly when you need one.
    select ver.id, ver.template_id into v_ver, v_tpl
      from legal.doc_template_version ver
     where ver.id = p_version_id
       and ver.workspace_id = p_workspace_id
       and ver.status = 'published';
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

-- 2. the client path ------------------------------------------------
create or replace function legal.create_client_contract_from_campaign(
  p_workspace_id uuid,
  p_pm_task_id   uuid,
  p_title        text,
  p_values       jsonb,
  p_table_rows   jsonb default null,
  p_version_id   uuid  default null
) returns uuid
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_ver     uuid;
  v_tpl     uuid;
  v_block   uuid;
  v_id      uuid;
  v_n       integer;
  v_retired integer;
  k         text;
  v         text;
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
  if not exists (select 1 from public.pm_tasks t
                  where t.id = p_pm_task_id and t.workspace_id = p_workspace_id) then
    raise exception 'That campaign is not in this workspace.' using errcode = '42501';
  end if;

  if p_version_id is null then
    select count(*) into v_n
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'client_contract'
       and t.archived_at is null;
    if v_n = 0 then
      select count(*) into v_retired
        from legal.doc_template_version ver
        join legal.doc_template t on t.id = ver.template_id
       where ver.workspace_id = p_workspace_id
         and ver.status = 'published'
         and t.doc_kind = 'client_contract'
         and t.archived_at is not null;
      if v_retired > 0 then
        raise exception 'The client contract template is retired. Restore it in Legal, under Documents, to raise contracts from it again.'
          using errcode = '42704';
      end if;
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
       and t.doc_kind = 'client_contract'
       and t.archived_at is null;
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

  insert into legal.contract
    (workspace_id, template_id, version_id, title, status, created_by, pm_task_id)
  values
    (p_workspace_id, v_tpl, v_ver, btrim(p_title), 'draft', auth.uid(), p_pm_task_id)
  returning id into v_id;

  if p_values is not null and jsonb_typeof(p_values) = 'object' then
    for k, v in select key, value from jsonb_each_text(p_values) loop
      if coalesce(v, '') <> '' then
        insert into legal.contract_field (contract_id, workspace_id, key, value)
        values (v_id, p_workspace_id, k, v);
      end if;
    end loop;
  end if;

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

-- 3. prove it -------------------------------------------------------
--
-- Structurally, for the reason 127 wrote down - there is no JWT here, so
-- calling either function would test who ran the migration.
do $$
declare body text; n integer;
begin
  for body in
    select pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'legal'
       and p.proname in ('create_contract_from_booking', 'create_client_contract_from_campaign')
  loop
    -- Retired templates are excluded when resolving, and the exclusion has to
    -- appear TWICE in each: once in the count and once in the select that
    -- follows it. A count that excludes them and a select that does not is
    -- how you get "exactly one" and then pick the wrong one.
    n := (length(body) - length(replace(body, 'archived_at is null', ''))) / length('archived_at is null');
    if n < 2 then
      raise exception 'legal: a raise function excludes retired templates % time(s), expected at least 2', n;
    end if;
    if body not like '%is retired. Restore it%' then
      raise exception 'legal: a raise function does not say when the template is retired';
    end if;
  end loop;

  raise notice 'legal: a retired template raises nothing, and says so';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select p.proname,
--        (length(pg_get_functiondef(p.oid))
--         - length(replace(pg_get_functiondef(p.oid), 'archived_at is null', '')))
--        / length('archived_at is null') as excludes_retired
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'legal'
--    and p.proname in ('create_contract_from_booking','create_client_contract_from_campaign')
--  order by 1;
-- expected: 2 for each
