/**
 * Builds supabase/migrations/110_legal_contract_lists.sql.
 *
 *   node scripts/build-legal-lists.mjs
 *
 * The platform and the ad type stop being free text and become managed lists,
 * so the fill screen renders them as dropdowns through machinery that already
 * exists (migration 099: a placeholder with field_type='list' and a list_id
 * draws its options from legal.managed_list_value).
 *
 * WHY THIS IS GENERATED RATHER THAN HAND-WRITTEN: the values are Arabic, and
 * the repository is edited through an ASCII-only console. Every Arabic string
 * below is a \u escape, and this script is what turns them into the SQL. Same
 * arrangement as scripts/build-legal-seed.mjs. Do not hand-edit the output.
 *
 * WHY THE VALUES ARE ARABIC: Siraj, "all arabic except price (number) and the
 * channel name". The managed list's VALUE is what prints into the contract and
 * its LABEL is what the dropdown shows; both are Arabic here. The price stays
 * a formatted number with the template's own currency word, and the channel
 * name stays free text, because a handle is a handle in any language.
 *
 * WHERE THE WORDS COME FROM. Six of them are the contract's own. Clauses 25
 * and 26 of contract-template-ar.js already say
 *   "... \u062a\u064a\u0643 \u062a\u0648\u0643" , " \u0627\u0646\u0633\u062a\u0642\u0631\u0627\u0645 \u0628\u0648\u0633\u062a \u0648 \u0631\u064a\u064a\u0644" ...
 *   "... \u0627\u0646\u0633\u062a\u0642\u0631\u0627\u0645 \u0648 \u0633\u0646\u0627\u0628 \u062a\u0634\u0627\u062a \u0633\u062a\u0648\u0631\u064a" ...
 * so Instagram, TikTok, Snapchat, Post, Reel and Story are fixed by the
 * document itself - any other wording would make the outputs table disagree
 * with clause 25 of the same contract. Those are marked `template` below. The
 * rest are marked `proposed`: they are ordinary Arabic for the term, and legal
 * can change any of them on the Manage lists screen without a migration.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'supabase', 'migrations', '110_legal_contract_lists.sql');
// 110 is what prod ran and must not drift; the label correction is its own file.
const OUT_LABELS = join(ROOT, 'supabase', 'migrations', '111_legal_list_labels.sql');

/** [ english source term, arabic value, where the arabic came from ] */
const PLATFORMS = [
  ['Instagram', '\u0627\u0646\u0633\u062a\u0642\u0631\u0627\u0645', 'template'],
  ['TikTok', '\u062a\u064a\u0643 \u062a\u0648\u0643', 'template'],
  ['Snapchat', '\u0633\u0646\u0627\u0628 \u062a\u0634\u0627\u062a', 'template'],
  ['X', '\u0625\u0643\u0633', 'proposed'],
  ['YouTube', '\u064a\u0648\u062a\u064a\u0648\u0628', 'proposed'],
  ['Facebook', '\u0641\u064a\u0633\u0628\u0648\u0643', 'proposed'],
  ['LinkedIn', '\u0644\u064a\u0646\u0643\u062f \u0625\u0646', 'proposed'],
  ['Outdoor', '\u0625\u0639\u0644\u0627\u0646 \u062e\u0627\u0631\u062c\u064a', 'proposed'],
];

/** Mirrors AD_TYPE_OPTIONS in hooks/use-workflow.ts, in that order, plus the
 *  legacy 'Multi Service' the campaign picker still offers. */
const AD_TYPES = [
  ['Store Visit', '\u0632\u064a\u0627\u0631\u0629 \u0645\u062a\u062c\u0631', 'proposed'],
  ['Store Visit -Silent-', '\u0632\u064a\u0627\u0631\u0629 \u0645\u062a\u062c\u0631 - \u0635\u0627\u0645\u062a\u0629', 'proposed'],
  ['Home Ad', '\u0625\u0639\u0644\u0627\u0646 \u0645\u0646\u0632\u0644\u064a', 'proposed'],
  ['Home Ad -Silent-', '\u0625\u0639\u0644\u0627\u0646 \u0645\u0646\u0632\u0644\u064a - \u0635\u0627\u0645\u062a', 'proposed'],
  ['Billboards', '\u0644\u0648\u062d\u0627\u062a \u0625\u0639\u0644\u0627\u0646\u064a\u0629', 'proposed'],
  ['Sponsorship', '\u0631\u0639\u0627\u064a\u0629', 'proposed'],
  ['Usage Rights', '\u062d\u0642\u0648\u0642 \u0627\u0644\u0627\u0633\u062a\u062e\u062f\u0627\u0645', 'proposed'],
  ['Event Attending', '\u062d\u0636\u0648\u0631 \u0641\u0639\u0627\u0644\u064a\u0629', 'proposed'],
  ['Paid promotion', '\u062a\u0631\u0648\u064a\u062c \u0645\u062f\u0641\u0648\u0639', 'proposed'],
  ['Logistics', '\u062e\u062f\u0645\u0627\u062a \u0644\u0648\u062c\u0633\u062a\u064a\u0629', 'proposed'],
  ['PhotoShot', '\u062a\u0635\u0648\u064a\u0631 \u0641\u0648\u062a\u0648\u063a\u0631\u0627\u0641\u064a', 'proposed'],
  ['VideoShot', '\u062a\u0635\u0648\u064a\u0631 \u0641\u064a\u062f\u064a\u0648', 'proposed'],
  ['Post', '\u0628\u0648\u0633\u062a', 'template'],
  ['Carousel Post', '\u0628\u0648\u0633\u062a \u0645\u062a\u0639\u062f\u062f \u0627\u0644\u0635\u0648\u0631', 'proposed'],
  ['Reel', '\u0631\u064a\u064a\u0644', 'template'],
  ['Story', '\u0633\u062a\u0648\u0631\u064a', 'template'],
  ['Video', '\u0641\u064a\u062f\u064a\u0648', 'proposed'],
  ['Live', '\u0628\u062b \u0645\u0628\u0627\u0634\u0631', 'proposed'],
  ['Media Production', '\u0625\u0646\u062a\u0627\u062c \u0625\u0639\u0644\u0627\u0645\u064a', 'proposed'],
  ['Quote Tweet', '\u0625\u0639\u0627\u062f\u0629 \u0646\u0634\u0631 \u0645\u0639 \u062a\u0639\u0644\u064a\u0642', 'proposed'],
  ['Multi Service', '\u062e\u062f\u0645\u0627\u062a \u0645\u062a\u0639\u062f\u062f\u0629', 'proposed'],
];

/** Single-quote a string for SQL. */
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** A pair array as a Postgres text[] literal of arrays is awkward; two parallel
 *  arrays keep the SQL readable and the order aligned. */
function arr(values) {
  return `array[\n    ${values.map(q).join(',\n    ')}\n  ]`;
}

const platAr = PLATFORMS.map((p) => p[1]);
const platEn = PLATFORMS.map((p) => p[0]);
const adAr = AD_TYPES.map((a) => a[1]);

const provenance = []
  .concat(PLATFORMS.map((p) => ['platform', p[0], p[1], p[2]]))
  .concat(AD_TYPES.map((a) => ['ad type', a[0], a[1], a[2]]))
  .filter((r) => r[3] === 'template')
  .map((r) => `--   ${r[0]} ${r[1]}`)
  .join('\n');

const sql = `-- ============================================================
-- ${basename(OUT)}   GENERATED - do not hand-edit.
--   node scripts/build-legal-lists.mjs
--
-- The platform and the ad type become chosen, not typed - and Arabic.
--
-- Siraj: "platform should be a drop down chosabel list", "ad type should be
-- drop down", "all arabic except price (number) and the channel name". Both
-- fields are already enumerations everywhere else in this app; typing them
-- free-hand into a contract is how the same ad type ends up spelled three
-- ways in one register.
--
-- The managed list's VALUE prints into the contract and its LABEL is what the
-- dropdown shows. Both are Arabic here. The price keeps its formatted number
-- and the template's own currency word; the channel name stays free text,
-- because a handle is a handle in any language.
--
-- These six are the contract's own words, from clauses 25-26 of
-- contract-template-ar.js, not a translation choice:
${provenance}
-- The rest are ordinary Arabic for the term and can be changed on the Manage
-- lists screen without a migration.
--
-- Per workspace, and only where the legal field registry exists, so this is a
-- no-op on a workspace that has never opened Legal.
--
-- Idempotent: lists upsert on (workspace_id, key), values on (list_id, value),
-- and re-pointing a field at the list it already has changes nothing.
-- Run in staging, then prod. Then: notify pgrst.
--
-- NOTE ON EXISTING DRAFTS: a value already typed into one of these two fields
-- that is not in the list will now fail validation and block Issue until it is
-- re-chosen. That is the point of the change. No contract has been issued at
-- the time of writing, and an issued contract's fields are frozen and its
-- fingerprint is over the stored values - neither of which this touches.
-- ============================================================

set search_path = legal, public;

do $lists$
declare
  v_ws   uuid;
  v_list uuid;
  i      integer;
  n_ex   integer;
  -- The platform list, Arabic. Index-aligned with plat_en below.
  plat_ar text[] := ${arr(platAr)};
  -- The English term each one came from, used only to spot a workspace's own
  -- task_platforms entry that is NOT one of these, so a platform an admin
  -- added by hand is carried over rather than silently dropped.
  plat_en text[] := ${arr(platEn)};
  ad_ar text[] := ${arr(adAr)};
begin
  for v_ws in
    select distinct p.workspace_id from legal.placeholder p
     where p.key in ('platform_smart', 'ad_types')
  loop
    -- ---- platforms ------------------------------------------------
    insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'platforms', 'Platforms', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name
    returning id into v_list;

    for i in 1 .. array_length(plat_ar, 1) loop
      insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
      values (v_list, v_ws, plat_ar[i], plat_ar[i], i, true)
      on conflict (list_id, value) do nothing;
    end loop;

    -- Anything this workspace uses that is not one of the known eight, kept
    -- verbatim: guessing at the Arabic for a platform somebody typed in is
    -- worse than leaving it as they wrote it. Legal can rename it on the
    -- Manage lists screen.
    insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    select v_list, v_ws, btrim(tp.name), btrim(tp.name),
           100 + tp."position", true
      from public.task_platforms tp
     where tp.workspace_id = v_ws
       and coalesce(btrim(tp.name), '') <> ''
       and not (tp.name = any (plat_en))
    on conflict (list_id, value) do nothing;
    get diagnostics n_ex = row_count;
    if n_ex > 0 then
      raise notice 'workspace %: carried over % platform(s) not in the known list', v_ws, n_ex;
    end if;

    update legal.placeholder
       set field_type = 'list', list_id = v_list
     where workspace_id = v_ws and key = 'platform_smart';

    -- ---- ad types -------------------------------------------------
    insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'ad_types', 'Ad types', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name
    returning id into v_list;

    for i in 1 .. array_length(ad_ar, 1) loop
      insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
      values (v_list, v_ws, ad_ar[i], ad_ar[i], i, true)
      on conflict (list_id, value) do nothing;
    end loop;

    update legal.placeholder
       set field_type = 'list', list_id = v_list
     where workspace_id = v_ws and key = 'ad_types';

    raise notice 'workspace %: platform + ad type lists wired', v_ws;
  end loop;
end
$lists$;
`;

// ---- 111: the label is English, the value stays Arabic -----------------
//
// Siraj: "make platform in english but it gets translated into arabic". 110
// set both to Arabic, which was a misread - the LABEL is what the operator
// picks from and the VALUE is what prints, so the label should be the English
// term they think in and the value the Arabic the contract says. Same row,
// two columns, no change to anything already stored on a contract.
//
// Also adds legal.placeholder.allow_other: a list field that additionally
// takes a value of its own, for "add an other in case there is something
// specific". Off by default, so a list meant to be closed stays closed.

const labelPairs = []
  .concat(PLATFORMS.map((p) => [p[1], p[0]]))
  .concat(AD_TYPES.map((a) => [a[1], a[0]]));

const labelRows = labelPairs
  .map(([ar, en]) => `    (${q(ar)}, ${q(en)})`)
  .join(',\n');

const labelSql = `-- ============================================================
-- ${basename(OUT_LABELS)}   GENERATED - do not hand-edit.
--   node scripts/build-legal-lists.mjs
--
-- Two corrections to 110.
--
-- 1. THE LABEL IS ENGLISH. Siraj: "make platform in english but it gets
--    translated into arabic". 110 set label and value both to Arabic, which
--    was a misread of the same sentence that got the value right: the LABEL is
--    what the operator picks from, the VALUE is what prints into the contract.
--    So the dropdown reads Instagram / TikTok / Reel, and the document still
--    says \u0627\u0646\u0633\u062a\u0642\u0631\u0627\u0645 / \u062a\u064a\u0643 \u062a\u0648\u0643 / \u0631\u064a\u064a\u0644. Matched on the Arabic value, so a
--    value legal has since renamed by hand is left alone.
--
-- 2. legal.placeholder.allow_other. A list field that also accepts a value of
--    its own - "add an other in case there is something specific". Set on
--    platform_smart and ad_types. Default false, so every other list stays
--    closed and an off-list value there is still an error.
--
-- Carried-over platforms from a workspace's own task_platforms are NOT in the
-- pair list, so their label stays whatever it was - there is no English term
-- to restore, they were English to begin with.
--
-- Idempotent. Run in staging, then prod. Then: notify pgrst.
-- ============================================================

set search_path = legal, public;

alter table legal.placeholder
  add column if not exists allow_other boolean not null default false;

comment on column legal.placeholder.allow_other is
  'A list field that also takes an off-list value the operator types. Only meaningful when field_type = list.';

update legal.placeholder
   set allow_other = true
 where key in ('platform_smart', 'ad_types')
   and allow_other is distinct from true;

do $labels$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from (values
${labelRows}
    ) as t(ar, en)
  loop
    update legal.managed_list_value v
       set label = r.en
      from legal.managed_list l
     where l.id = v.list_id
       and l.key in ('platforms', 'ad_types')
       and v.value = r.ar
       and v.label is distinct from r.en;
    n := n + 1;
  end loop;
  raise notice 'checked % label pairs', n;
end
$labels$;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sql, 'utf8');
writeFileSync(OUT_LABELS, labelSql, 'utf8');
console.log(`wrote ${OUT}`);
console.log(`wrote ${OUT_LABELS}`);
console.log(`  platforms ${PLATFORMS.length}, ad types ${AD_TYPES.length}`);
