-- ============================================================
-- 121_platform_and_ad_type_are_lists.sql
-- Platform and Ad type become pickers, and the app speaks English.
--
-- Siraj: "platform automated more than one platform can be chosen / ad type
-- automated inside the task / both are from outside but i also need them
-- inside" - with two screenshots of the fill screen showing both fields as
-- empty free-text boxes marked "Text".
--
-- -- THE WHOLE BUG IS ONE COLUMN, TWO ROWS -----------------------------
--
-- Nothing was missing. The lists are there and they are complete:
--
--   legal.managed_list 'ad_types'  - 21 values
--   legal.managed_list 'platforms' - 11 values
--
-- and both are already the right shape, `value` the Arabic that goes on the
-- contract and `label` the English somebody picks by. Both placeholders
-- already carry the right `list_id`. The multi-select machinery is already
-- written, and lib/legal-prefill's MULTI_KEYS already names these two fields
-- as the multi-value ones.
--
-- The only thing wrong: `legal.placeholder.field_type` said 'text'. The fill
-- screen renders a picker when the field type is 'list' and a text box
-- otherwise, so both fields fell through to a text box and the lists behind
-- them were never reached.
--
-- -- AND IT WOULD HAVE COME BACK -----------------------------------------
--
-- Somebody almost certainly set these to 'list' before. scripts/build-legal-seed
-- declares every field's type in its FIELDS table, both of these said 'text',
-- and _seed_field's ON CONFLICT updates field_type from it - so every run of
-- the template seed reset them. The generator is fixed in the same commit; the
-- update below is only the half that cannot wait for a seed run.
--
-- -- THE LABELS ---------------------------------------------------------
--
-- Siraj: "make it all in english so its easier to understand". Safe, and
-- checked rather than assumed: PrintDoc takes blocks, values, dir and meta -
-- it is handed no placeholders at all - so a field's label cannot reach the
-- printed contract. The Arabic on the document comes from the template blocks
-- and is untouched by anything here.
-- ============================================================

set search_path = legal, public;

-- 1. the two fields become pickers ----------------------------------

update legal.placeholder
   set field_type = 'list'
 where key in ('platform_smart', 'ad_types')
   and list_id is not null
   and field_type <> 'list';

-- A field pointed at no list must NOT be switched: the fill screen would draw
-- an empty dropdown with no way to type a value, which is worse than the text
-- box it replaced. Fail loudly instead.
do $$
declare n integer;
begin
  select count(*) into n from legal.placeholder
   where key in ('platform_smart', 'ad_types') and list_id is null;
  if n > 0 then
    raise exception 'legal: % of these fields have no list_id - link them to a managed list before making them pickers', n;
  end if;
end $$;

-- 2. the app speaks English -----------------------------------------
--
-- The label is what the fill screen, the editor's field pills and the task
-- form show. The contract is unaffected - see the header.

update legal.placeholder p set label = v.label
  from (values
    ('id',             'Contract number'),
    ('date',           'Date'),
    ('day',            'Day'),
    ('license_name',   'Second party name'),
    ('license_number', 'Media licence number'),
    ('brand_name',     'Products promoted'),
    ('name_2',         'Influencer'),
    ('platform_smart', 'Platform'),
    ('channel_name',   'Account on the platform'),
    ('ad_types',       'Ad type'),
    ('Amount_full',    'Amount'),
    ('duration',       'Duration (days)'),
    ('bank_name',      'Bank name'),
    ('account_name',   'Account name'),
    ('account_number', 'Account number'),
    ('iban',           'IBAN')
  ) as v(key, label)
 where p.key = v.key and p.label is distinct from v.label;

-- 3. Store Visit reads the way Siraj wants it to read ---------------
--
-- Siraj: "store visit = اعلان زياره".
--
-- UPDATED IN PLACE, not deactivated-and-replaced, and that is deliberate.
-- The fill screen validates a list field against its ACTIVE values only
-- (ContractFill listsByKey), so retiring the old wording would make every
-- draft still holding it fail validation - Issue greyed out, with nothing on
-- screen but "Fill every required field first" on a full form. That is the
-- same trap the unpaged managed-list read fell into.
--
-- Matched on the LABEL, which is ASCII, rather than on the Arabic it is
-- replacing: the value is the thing being changed and matching on it would
-- make this file silently do nothing if it had already been edited by hand.

do $$
declare
  v_list uuid;
  v_old  text;
  v_new  text := 'اعلان زياره';
  n      integer;
begin
  select id into v_list from legal.managed_list where key = 'ad_types' limit 1;
  if v_list is null then
    raise notice 'legal: no ad_types list here - nothing to rename';
    return;
  end if;

  select value into v_old from legal.managed_list_value
   where list_id = v_list and label = 'Store Visit' limit 1;
  if v_old is null then
    raise notice 'legal: no "Store Visit" value in the ad_types list - nothing to rename';
    return;
  end if;
  if v_old = v_new then
    raise notice 'legal: Store Visit already reads as it should';
    return;
  end if;

  update legal.managed_list_value
     set value = v_new
   where list_id = v_list and label = 'Store Visit';

  -- Carry the DRAFTS across, so nothing that was valid a moment ago becomes
  -- unfillable. Drafts only: an issued contract is sealed and fingerprinted
  -- over its own values, and rewriting one would break the seal it exists to
  -- provide. A contract already issued keeps the wording it was issued with,
  -- which is correct - that is what it says on the paper somebody signed.
  update legal.contract_field f
     set value = replace(f.value, v_old, v_new)
    from legal.contract c
   where c.id = f.contract_id
     and c.status = 'draft'
     and f.key = 'ad_types'
     and f.value like '%' || v_old || '%';
  get diagnostics n = row_count;
  raise notice 'legal: Store Visit renamed; % draft field(s) carried across', n;
end $$;

-- 4. prove it, then roll it back -------------------------------------

do $$
declare
  n_list integer;
  n_txt  integer;
  n_ar   integer;
begin
  -- Phrased as "neither may be anything else", not "both must be there".
  -- The earlier form counted rows that only exist once a workspace has been
  -- seeded, so it raised against an empty database and made this migration
  -- unreplayable - the 127 lesson: a self-test whose answer depends on who
  -- is in the database is not a test of the migration.
  select count(*) into n_list from legal.placeholder
   where key in ('platform_smart', 'ad_types') and field_type <> 'list';
  if n_list <> 0 then
    raise exception 'legal: % of these fields are not pickers', n_list;
  end if;

  -- Every value a picker offers must be non-empty, or the dropdown shows a
  -- blank row that stores an empty string and fails its own required check.
  select count(*) into n_txt from legal.managed_list_value v
    join legal.managed_list l on l.id = v.list_id
   where l.key in ('ad_types', 'platforms')
     and (v.value is null or btrim(v.value) = '');
  if n_txt > 0 then
    raise exception 'legal: % list value(s) are blank', n_txt;
  end if;

  -- The labels are the app's, and they are English now.
  select count(*) into n_ar from legal.placeholder
   where key in ('platform_smart', 'ad_types', 'iban', 'name_2')
     and label ~ '[؀-ۿ]';
  if n_ar > 0 then
    raise exception 'legal: % placeholder label(s) are still Arabic', n_ar;
  end if;

  raise notice 'legal: platform and ad type are pickers, labels are English';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select key, field_type, label,
--        (select count(*) from legal.managed_list_value v
--          where v.list_id = p.list_id and v.active) as options
--   from legal.placeholder p
--  where key in ('platform_smart','ad_types') order by key;
-- expected: ad_types | list | Ad type | 21
--           platform_smart | list | Platform | 11
