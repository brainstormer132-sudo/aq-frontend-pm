-- ============================================================
-- 138_the_client_outputs_table_becomes_pickers.sql
-- Platform and the ad column stop being free text.
--
-- Siraj, on the client contract's outputs table: "i need a drop down check
-- for the platform per row and ad type same thing with quantity", and then,
-- asked whether that meant a new column: "the ad amount is ad type with
-- quantity".
--
-- So the table keeps the four columns the Word file has. The one labelled
-- "number of ads" carries WHAT was booked and HOW MANY - "3 x Home Ad" -
-- which is the form the vendor contract has always written (see
-- parseQuantified, ported byte for byte from the contract app).
--
-- -- NOTHING PUBLISHED IS TOUCHED ------------------------------------
--
-- The column LABELS live in the template version's block and are frozen;
-- their TYPES live in legal.placeholder, which is workspace-level and
-- mutable. So a published contract's wording is untouched by this and the
-- fill screen changes anyway. That separation is why this is a migration and
-- not a new template version - the document did not change, the way it is
-- filled in did.
--
-- -- THE LISTS ALREADY EXIST -----------------------------------------
--
-- 121 made platform and ad type pickers for the vendor contract and wrote
-- down that nothing was missing then either: legal.managed_list 'platforms'
-- has 11 values and 'ad_types' has 21, both shaped `value` the Arabic that
-- goes on the contract and `label` the English somebody picks by. The client
-- table's columns were registered as plain text by 135, which is the whole
-- of the bug.
--
-- -- list_qty ---------------------------------------------------------
--
-- A new field type: choose from a list, with a count. The 099 CHECK has to
-- learn it or the update below fails on the constraint rather than on
-- anything meaningful. validateFieldValue checks the NAME against the list
-- exactly as a plain list field does - the count is not a way round a closed
-- list.
-- ============================================================

set search_path = legal, public;

-- 1. the field type ------------------------------------------------
alter table legal.placeholder drop constraint if exists placeholder_field_type_chk;
do $$
begin
  -- 099 named it by whatever Postgres chose, so find it rather than guess.
  execute (
    select 'alter table legal.placeholder drop constraint ' || quote_ident(conname)
      from pg_constraint
     where conrelid = 'legal.placeholder'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%field_type%'
     limit 1);
exception when others then
  raise notice 'legal: no existing field_type check to drop';
end $$;

alter table legal.placeholder
  add constraint placeholder_field_type_chk
  check (field_type in ('text','number','date','list','auto','list_qty'));

-- 2. the two columns ----------------------------------------------
do $$
declare
  v_ws        uuid;
  v_platforms uuid;
  v_adtypes   uuid;
  n           integer;
begin
  select t.workspace_id into v_ws
    from legal.doc_template t
   where t.doc_kind = 'client_contract'
   limit 1;
  if v_ws is null then
    raise notice 'legal: no client contract template - nothing to retype';
    return;
  end if;

  select id into v_platforms from legal.managed_list
   where workspace_id = v_ws and key = 'platforms';
  select id into v_adtypes from legal.managed_list
   where workspace_id = v_ws and key = 'ad_types';
  if v_platforms is null or v_adtypes is null then
    raise exception 'legal: the platforms or ad_types list is missing from this workspace';
  end if;

  update legal.placeholder
     set field_type = 'list', data_type = 'list', list_id = v_platforms
   where workspace_id = v_ws and key = 'CLT_PLAT';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'legal: CLT_PLAT not found (% rows)', n; end if;

  update legal.placeholder
     set field_type = 'list_qty', data_type = 'list', list_id = v_adtypes
   where workspace_id = v_ws and key = 'CLT_QTY';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'legal: CLT_QTY not found (% rows)', n; end if;

  raise notice 'legal: the client outputs table is pickers now';
end $$;

-- 3. prove it ------------------------------------------------------
do $$
declare n integer;
begin
  -- The constraint knows the new type, or every update above would have
  -- failed on it rather than on anything to do with the fields.
  select count(*) into n from pg_constraint
   where conrelid = 'legal.placeholder'::regclass
     and pg_get_constraintdef(oid) like '%list_qty%';
  if n <> 1 then
    raise exception 'legal: the field_type check does not know list_qty (% matching)', n;
  end if;

  -- Both columns point at a list. A list field with no list_id renders an
  -- empty dropdown, which is worse than the free-text box it replaced.
  select count(*) into n from legal.placeholder
   where key in ('CLT_PLAT', 'CLT_QTY')
     and field_type in ('list', 'list_qty')
     and list_id is not null;
  if n <> 2 then
    raise exception 'legal: % of 2 client table columns are pickers with a list behind them', n;
  end if;

  -- And the lists have something in them.
  select count(*) into n
    from legal.placeholder p
    join legal.managed_list_value v on v.list_id = p.list_id and v.active
   where p.key in ('CLT_PLAT', 'CLT_QTY');
  if n < 2 then
    raise exception 'legal: the lists behind the client table are empty';
  end if;

  raise notice 'legal: platform and the ad column are pickers, with values behind them';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select p.key, p.field_type, p.list_id is not null as has_list,
--        (select count(*) from legal.managed_list_value v
--          where v.list_id = p.list_id and v.active) as choices
--   from legal.placeholder p
--  where p.key like 'CLT_%' order by p.key;
-- expected: CLT_ACC text, CLT_INF text, CLT_PLAT list (11 choices),
--           CLT_QTY list_qty (21 choices)
