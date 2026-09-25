-- ============================================================
-- seed_rawad_example_draft.sql
-- Creates ONE draft contract off the published v1.0 template, pre-filled with
-- the values that are actually concrete in the uploaded docx (Party-1 + the
-- one payee bank account/IBAN). All other docx fields are unfilled merge
-- placeholders and are left blank for the operator. Idempotent: skipped if a
-- contract with this title already exists. Stays a DRAFT (you Issue it).
-- ============================================================
set search_path = legal, public;
do $rawad$
declare
  v_ws  uuid;
  v_n   integer;
  v_tpl uuid;
  v_ver uuid;
  v_c   uuid;
begin
  v_ws := '874c6670-29d9-48f1-97a4-ccbc0e54208b';  -- AQ Creativity (live workspace)
  if not exists (select 1 from public.workspaces where id = v_ws) then
    raise exception 'rawad: target workspace % not found', v_ws;
  end if;
  select id into v_tpl from legal.doc_template where workspace_id = v_ws and name = 'عقد تسويق إلكتروني' limit 1;
  if v_tpl is null then raise exception 'rawad: template not found - run the template seed first'; end if;
  select id into v_ver from legal.doc_template_version where template_id = v_tpl and version = 1;
  if v_ver is null then raise exception 'rawad: template version 1 not found'; end if;

  if exists (select 1 from legal.contract where workspace_id = v_ws and title = 'عقد تسويق إلكتروني - رواد التأثير (مسودة تجريبية)') then
    raise notice 'rawad: example draft already exists, skipping';
    return;
  end if;

  insert into legal.contract (workspace_id, template_id, version_id, title, status)
    values (v_ws, v_tpl, v_ver, 'عقد تسويق إلكتروني - رواد التأثير (مسودة تجريبية)', 'draft') returning id into v_c;
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_NAME', 'شركة رواد التأثير');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_CR', '4030381472');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_UNI', '7017229233');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_VAT', '314899928700003');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_ADDR', 'المملكة العربية السعودية، جدة، حي الفيصلية، طريق المدينة المنورة الفرعي');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_ZIP', '23442');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_REP', 'أحمد قرنفلة — المدير العام');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'P1_TITLE', 'المدير العام');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'PY_ACCNO', '68202707824000');
  insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (v_c, v_ws, 'PY_IBAN', 'SA8505000068202707824000');
  raise notice 'rawad: created draft example contract %, 10 fields', v_c;
end
$rawad$;
