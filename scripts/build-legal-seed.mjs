/**
 * Generate the legal-system seed for the live UGC contract.
 *
 *   node scripts/build-legal-seed.mjs
 *   -> supabase/seeds/105_ugc_template.sql        (VERSION 1)
 *   -> supabase/seeds/109_ugc_template_v<N>.sql   (VERSION 2 and up)
 *
 * The contract text lives in public/contracts/contract-template-ar.js, which
 * is itself generated from the DOCX in aq-backend template storage. This
 * script reads THAT file and converts it into legal.* rows, so the Arabic is
 * never hand-typed and never crosses a console paste. Re-run it whenever the
 * template is regenerated; the SQL it writes is idempotent.
 *
 * What it produces:
 *   - 16 legal.placeholder rows (upsert by key, so a re-run refreshes them)
 *   - 1 legal.doc_template ("Rawad altathir UGC", vendor_contract)
 *   - version 1 with the 42 blocks, published (seeded once; the 098 freeze
 *     trigger means blocks can only be written while the version is a draft,
 *     so the insert order is draft -> blocks -> publish)
 *   - every OTHER published vendor_contract version in the workspace archived,
 *     so the New-contract picker has exactly one entry. 098 allows
 *     published -> archived; it forbids everything else.
 *
 * Block type mapping (legal's CHECK allows title/h/p/li/kv/table/sig/clause):
 *   id     -> p     the "{{ id }}" line; legal has no such type
 *   center -> p     centring is cosmetic and legal has no centred type
 *   kv     -> kv    split on the first ":"; the live file stores one string
 *   table  -> table the live single data row becomes typed COLUMNS; rows are
 *                   added per contract, which is the point of the new system
 *   sig    -> sig   already {right,left}; needs the sig support added 2026-09-20
 *   everything else maps 1:1.
 */

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
/**
 * The version this seed publishes.
 *
 * v1 (2026-09-20) shipped the outputs table as an add-rows grid. That was
 * wrong: contract-template-ar.js block 11 is a header row and exactly one row
 * of {{ placeholders }}, because a UGC contract covers one vendor. A published
 * version is frozen by the 098 trigger and must stay that way, so the fix is a
 * new version, not an edit - and step 3 archives v1 on the way past.
 *
 * v3 (2026-09-21) marks the removable sections optional and groups them.
 * Siraj: "by default all legal requirement is recommended but they can choose
 * the ones they want to remove or edit from the app." Until now not one block
 * in the template was optional, so the Optional clauses card on the fill
 * screen has always rendered empty - the whole feature was unreachable. Same
 * reasoning as v2: a published version is frozen, so the flags go on a new
 * version and every contract stamped to v2 keeps reading exactly as it does.
 */
const VERSION = 3;

// One file per version. 105 is what prod ran for v1 and stays in the repo as
// the record of it; a bumped VERSION writes its own file beside it.
const OUT = join(ROOT, 'supabase', 'seeds',
  VERSION === 1 ? '105_ugc_template.sql' : `109_ugc_template_v${VERSION}.sql`);

// AQ Creativity. Prod carries a second, empty workspace (bd1faf73-...) that
// must stay untouched - see claude/aq-legal-template-seed-v1.md.
const WORKSPACE = '874c6670-29d9-48f1-97a4-ccbc0e54208b';
const TEMPLATE_NAME = 'Rawad altathir UGC';

const require = createRequire(import.meta.url);
const mod = require(join(ROOT, 'public', 'contracts', 'contract-template-ar.js'));
const tpl = mod.template;

// The source file pins its own SHA-256. Refuse to build a seed from a file
// that does not hash to it rather than shipping half a contract.
const actual = createHash('sha256').update(mod.json).digest('hex');
if (actual !== mod.sha256) {
  throw new Error(`contract-template-ar.js is corrupt: sha256 ${actual} != ${mod.sha256}`);
}

/**
 * The field registry. `type` follows the live app exactly: everything it
 * derives as a string stays text, so the port cannot introduce an Issue
 * blocker the old flow did not have. `req` mirrors contract-preview.js's
 * `required: true` set. Arabic labels are \u escapes so this file stays
 * ASCII and survives a console paste.
 */
const FIELDS = [
  { key: 'id',             type: 'text', req: false, ar: '\u0631\u0642\u0645 \u0627\u0644\u0639\u0642\u062f' },
  { key: 'date',           type: 'date', req: false, ar: '\u0627\u0644\u062a\u0627\u0631\u064a\u062e' },
  { key: 'day',            type: 'text', req: false, ar: '\u0627\u0644\u064a\u0648\u0645' },
  { key: 'license_name',   type: 'text', req: true,  ar: '\u0627\u0633\u0645 \u0627\u0644\u0637\u0631\u0641 \u0627\u0644\u062b\u0627\u0646\u064a' },
  { key: 'license_number', type: 'text', req: true,  ar: '\u0631\u0642\u0645 \u0627\u0644\u062a\u0631\u062e\u064a\u0635 \u0627\u0644\u0625\u0639\u0644\u0627\u0645\u064a' },
  { key: 'brand_name',     type: 'text', req: true,  ar: '\u0627\u0644\u0645\u0646\u062a\u062c\u0627\u062a \u0627\u0644\u062a\u064a \u064a\u062a\u0645 \u062a\u0631\u0648\u064a\u062c\u0647\u0627' },
  { key: 'name_2',         type: 'text', req: true,  ar: '\u0627\u0644\u0645\u0624\u062b\u0631' },
  { key: 'platform_smart', type: 'text', req: true,  ar: '\u0627\u0644\u0645\u0646\u0635\u0629' },
  { key: 'channel_name',   type: 'text', req: true,  ar: '\u062d\u0633\u0627\u0628\u0647 \u0641\u064a \u0627\u0644\u0645\u0646\u0635\u0629' },
  { key: 'ad_types',       type: 'text', req: true,  ar: '\u0646\u0648\u0639 \u0627\u0644\u0625\u0639\u0644\u0627\u0646' },
  { key: 'Amount_full',    type: 'text', req: true,  ar: '\u0627\u0644\u0645\u0628\u0644\u063a' },
  { key: 'duration',       type: 'text', req: true,  ar: '\u0627\u0644\u0645\u062f\u0629 \u0628\u0627\u0644\u0623\u064a\u0627\u0645' },
  { key: 'bank_name',      type: 'text', req: true,  ar: '\u0627\u0633\u0645 \u0627\u0644\u0628\u0646\u0643' },
  { key: 'account_name',   type: 'text', req: true,  ar: '\u0627\u0633\u0645 \u0627\u0644\u062d\u0633\u0627\u0628' },
  { key: 'account_number', type: 'text', req: true,  ar: '\u0631\u0642\u0645 \u0627\u0644\u062d\u0633\u0627\u0628' },
  { key: 'iban',           type: 'text', req: true,  ar: '\u0631\u0642\u0645 \u0627\u0644\u0627\u064a\u0628\u0627\u0646' },
];

// ---- which sections may be removed ----------------------------------------
//
// One switch per NUMBERED SECTION of the contract, because that is the unit a
// person decides about. Section five alone is nine blocks (a heading, four
// paragraphs and four bank rows); nine checkboxes for one decision is not a
// choice, it is a puzzle. The heading always travels with its own content, so
// nothing is ever left orphaned under a heading that was removed.
//
// Positions are 1-based and match the live template's order. What is NOT here
// is as deliberate as what is: the parties, the subject, the outputs table,
// the payment clause, the bank details and the signatures cannot be removed,
// because what is left would not be a contract.
//
// The label is READ FROM THE HEADING BLOCK, never typed here - the Arabic
// lives in contract-template-ar.js and crosses no console.
const OPTIONAL_SECTIONS = [
  { group: 'terms',       from: 21, to: 26 },  // rabi'an: terms and conditions
  { group: 'termination', from: 27, to: 35 },  // khamisan: ending / changing it
  { group: 'notices',     from: 36, to: 37 },  // sadisan: notices
  { group: 'disputes',    from: 38, to: 39 },  // sabi'an: disputes, Saudi courts
];

// Standalone removable blocks: their own switch, no group. The fill screen
// labels an ungrouped one with its own first ninety characters, which is
// right for a single paragraph and wrong for a section.
const OPTIONAL_SINGLES = [
  15,  // "the second party confirms the bank details sent are correct"
];

// ---- convert the 42 blocks -------------------------------------------------

/** Split a live kv string ("label: value") on its first colon. */
function splitKV(s) {
  const i = s.indexOf(':');
  if (i < 0) return { label: s.trim(), value: '' };
  return { label: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
}

/** The live table's header row + its one placeholder row become typed columns. */
function tableColumns(rows) {
  const header = rows[0] || [];
  const cells = rows[1] || [];
  const cols = [];
  for (let i = 0; i < header.length; i++) {
    const m = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/.exec(cells[i] || '');
    if (!m) throw new Error(`table column ${i} has no placeholder: ${cells[i]}`);
    cols.push({ key: m[1], label: String(header[i] ?? m[1]) });
  }
  return cols;
}

const blocks = tpl.blocks.map((b, i) => {
  switch (b.t) {
    case 'id':
    case 'center':
    case 'p':
      return { type: 'p', content: { text: b.v } };
    case 'title':
    case 'h':
    case 'li':
      return { type: b.t, content: { text: b.v } };
    case 'kv':
      return { type: 'kv', content: splitKV(b.v) };
    case 'table':
      // row_source 'fields': the live template's table is a header and ONE row
      // of merge fields, because a vendor contract is one contract per vendor.
      // Porting it as an add-rows table (what v1 shipped) put a "+ Add row"
      // grid on a document that never had one.
      return { type: 'table', content: { columns: tableColumns(b.rows), row_source: 'fields' } };
    case 'sig':
      return { type: 'sig', content: { right: b.right ?? '', left: b.left ?? '' } };
    default:
      throw new Error(`block ${i}: unmapped type "${b.t}"`);
  }
});

// ---- attach the optional flags, and prove the map is sane ------------------
//
// Asserted rather than trusted: a range that does not start on a heading has
// no label to show, two ranges that overlap would fight over a block, and a
// range running off the end silently marks nothing. Any of those would ship a
// template whose checkboxes are wrong, which no test downstream would catch.
const seen = new Map();
for (const sec of OPTIONAL_SECTIONS) {
  if (!(sec.from >= 1 && sec.to <= blocks.length && sec.from <= sec.to)) {
    throw new Error(`section ${sec.group}: range ${sec.from}-${sec.to} is not inside 1-${blocks.length}`);
  }
  const head = blocks[sec.from - 1];
  if (head.type !== 'h') {
    throw new Error(`section ${sec.group}: block ${sec.from} is a "${head.type}", not a heading - nothing to label the checkbox with`);
  }
  const label = String(head.content.text ?? '').trim();
  if (!label) throw new Error(`section ${sec.group}: its heading is empty`);
  for (let pos = sec.from; pos <= sec.to; pos++) {
    if (seen.has(pos)) {
      throw new Error(`block ${pos} is in both "${seen.get(pos)}" and "${sec.group}"`);
    }
    seen.set(pos, sec.group);
    const b = blocks[pos - 1];
    b.optional = true;
    b.optionalGroup = sec.group;
    // Only the heading carries the label; the rest inherit it by sharing the
    // group. Repeating it on nine rows is nine chances to disagree.
    b.optionalLabel = pos === sec.from ? label : null;
  }
}
for (const pos of OPTIONAL_SINGLES) {
  if (seen.has(pos)) throw new Error(`block ${pos} is both a single and in "${seen.get(pos)}"`);
  if (!(pos >= 1 && pos <= blocks.length)) throw new Error(`single ${pos} is outside 1-${blocks.length}`);
  seen.set(pos, null);
  blocks[pos - 1].optional = true;
}
// The structural blocks must stay exactly that. Named rather than derived, so
// widening a range into one of them is a build failure and not a surprise.
const STRUCTURAL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 40, 41, 42];
for (const pos of STRUCTURAL) {
  if (blocks[pos - 1].optional) {
    throw new Error(`block ${pos} is structural and must never be optional`);
  }
}
const optionalCount = blocks.filter((b) => b.optional).length;
if (optionalCount === 0) throw new Error('no block ended up optional - the whole point of v3');

// Every {{ key }} in the converted wording must be in the registry, or the
// template could never be published (LegalEditor refuses unknown keys).
const registry = new Set(FIELDS.map((f) => f.key));
const used = new Set();
for (const b of blocks) {
  const text = [b.content.text, b.content.label, b.content.value, b.content.right, b.content.left]
    .filter((s) => typeof s === 'string').join(' ');
  for (const m of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) used.add(m[1]);
  for (const c of b.content.columns ?? []) used.add(c.key);
}
const unknown = [...used].filter((k) => !registry.has(k));
if (unknown.length) throw new Error(`placeholders missing from the registry: ${unknown.join(', ')}`);
const unusedFields = FIELDS.filter((f) => !used.has(f.key)).map((f) => f.key);

// ---- emit the SQL ----------------------------------------------------------

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const jb = (o) => `${q(JSON.stringify(o))}::jsonb`;

const fieldRows = FIELDS.map((f) =>
  `  perform legal._seed_field(v_ws, ${q(f.key)}, ${q(f.ar)}, ${q(f.type)}, ${f.req});`).join('\n');

const nq = (s) => (s == null ? 'null' : q(s));
const blockRows = blocks.map((b, i) =>
  `    (v_ver, v_ws, ${i + 1}, ${q(b.type)}, ${jb(b.content)}, ` +
  `${b.optional ? 'true' : 'false'}, ${nq(b.optionalGroup ?? null)}, ${nq(b.optionalLabel ?? null)})`
).join(',\n');

const sql = `-- ============================================================
-- ${basename(OUT)}   GENERATED - do not hand-edit.
--   node scripts/build-legal-seed.mjs
--
-- Ports the live "${TEMPLATE_NAME}" contract into legal.*: ${FIELDS.length} typed
-- fields and ${blocks.length} blocks as version ${VERSION}, published, in workspace
-- ${WORKSPACE}.
--
-- Source: public/contracts/contract-template-ar.js
-- sha256: ${mod.sha256}
--
-- Idempotent: fields upsert by key, the template and its blocks seed once,
-- and archiving already-archived versions is a no-op. Safe to run twice.
-- Run in staging, then prod. Then: notify pgrst.
-- ============================================================

set search_path = legal, public;

create or replace function legal._seed_field(
  p_ws uuid, p_key text, p_label text, p_type text, p_req boolean
) returns void language sql as $fn$
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required,
     default_value, num_min, num_max, list_id, owner_dept, alert_days)
  values (p_ws, p_key, p_label, '', 'text', p_type, p_req, '', null, null, null, 'legal', null)
  on conflict (workspace_id, key) do update
    set label = excluded.label, field_type = excluded.field_type, required = excluded.required;
$fn$;

do $seed$
declare
  v_ws  uuid := ${q(WORKSPACE)};
  v_tpl uuid;
  v_ver uuid;
  n_arch integer;
begin
  if not exists (select 1 from public.workspaces where id = v_ws) then
    raise exception 'workspace % not found - check you are on the right database', v_ws;
  end if;

  -- 1. the field registry --------------------------------------
${fieldRows}

  -- 2. the template and its one published version ---------------
  select id into v_tpl from legal.doc_template
   where workspace_id = v_ws and name = ${q(TEMPLATE_NAME)};
  if v_tpl is null then
    insert into legal.doc_template (workspace_id, doc_kind, name, description)
    values (v_ws, 'vendor_contract', ${q(TEMPLATE_NAME)},
            'Ported from public/contracts/contract-template-ar.js')
    returning id into v_tpl;
  end if;

  select id into v_ver from legal.doc_template_version
   where template_id = v_tpl and version = ${VERSION};
  if v_ver is null then
    -- Blocks are writable only while the version is a draft (098 freeze).
    insert into legal.doc_template_version (template_id, workspace_id, version, status)
    values (v_tpl, v_ws, ${VERSION}, 'draft') returning id into v_ver;

    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content,
                                          optional, optional_group, optional_label)
    values
${blockRows};

    update legal.doc_template_version
       set status = 'published', published_at = now()
     where id = v_ver;
    raise notice 'seeded % blocks', ${blocks.length};
  else
    raise notice 'version ${VERSION} already exists - blocks left alone';
  end if;

  -- 3. retire every other published vendor_contract -------------
  -- There is no unpublish or archive button in the UI, and the New-contract
  -- picker lists every published version, so the old 5-block stub would sit
  -- beside this one with only its name to tell them apart.
  update legal.doc_template_version v
     set status = 'archived'
   where v.workspace_id = v_ws
     and v.status = 'published'
     and v.id <> v_ver
     and v.template_id in (
       select id from legal.doc_template
        where workspace_id = v_ws and doc_kind = 'vendor_contract');
  get diagnostics n_arch = row_count;
  raise notice 'archived % other published vendor_contract version(s)', n_arch;
end
$seed$;

drop function if exists legal._seed_field(uuid, text, text, text, boolean);
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, sql, 'utf8');

console.log(`wrote ${OUT}`);
console.log(`  blocks ${blocks.length}, fields ${FIELDS.length}, placeholders used ${used.size}`);
if (unusedFields.length) console.log(`  NOTE registry fields not used by the wording: ${unusedFields.join(', ')}`);
