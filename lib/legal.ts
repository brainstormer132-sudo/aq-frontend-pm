// Pure helpers for the legal document system. No React, no Supabase, no
// argless Date - compiled and exercised by tests/legal.test.mjs.

export type DocKind = 'vendor_contract' | 'nda' | 'client_contract' | 'other';
export type VersionStatus = 'draft' | 'published' | 'archived';

export const DOC_KINDS: { key: DocKind; label: string }[] = [
  { key: 'vendor_contract', label: 'Vendor contract' },
  { key: 'nda', label: 'NDA' },
  { key: 'client_contract', label: 'Client contract' },
  { key: 'other', label: 'Other' },
];

export function kindLabel(k: string): string {
  return DOC_KINDS.find((d) => d.key === k)?.label ?? 'Other';
}

/** The words shown on a version's status pill. */
export function statusLabel(s: string | null | undefined): string {
  return s === 'published' ? 'Published' : s === 'archived' ? 'Archived' : s === 'draft' ? 'Draft' : 'No version';
}

/** The badge colour class for a status. Draft is a waiting colour, published a
 *  success one, archived muted. */
export function statusBadge(s: string | null | undefined): string {
  return s === 'published' ? 'aq-badge-success'
    : s === 'archived' ? 'aq-badge-muted'
    : s === 'draft' ? 'aq-badge-warning'
    : 'aq-badge-muted';
}

export interface LegalTemplateLite {
  id: string;
  doc_kind: DocKind;
  name: string;
  description?: string | null;
  updated_at?: string | null;
  /** Newest version's number and status, folded from doc_template_version. */
  latest_version?: number | null;
  latest_status?: VersionStatus | null;
}

/**
 * Group templates under their kind, in DOC_KINDS order, name-sorted within a
 * kind. Empty kinds are dropped so the screen shows only sections that exist.
 */
export function groupTemplatesByKind(
  rows: LegalTemplateLite[],
): { key: DocKind; label: string; items: LegalTemplateLite[] }[] {
  return DOC_KINDS
    .map((d) => ({
      key: d.key,
      label: d.label,
      items: rows.filter((r) => r.doc_kind === d.key).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.items.length > 0);
}

/** Validate the New-template form. Returns an error sentence, or null if ok. */
export function validateNewTemplate(name: string, kind: string): string | null {
  if (!name.trim()) return 'A template needs a name.';
  if (!DOC_KINDS.some((d) => d.key === kind)) return 'Pick a document type.';
  return null;
}

// ---- blocks (the editable body of a template version) -------------------

/**
 * The block types the editor can add and edit. The `legal.doc_template_block`
 * CHECK allows more (table, sig, clause); the editor grows into those later, so
 * a block whose type is outside this list still renders (read-only) but is not
 * offered in the Add palette.
 */
export type EditorBlockType = 'title' | 'h' | 'p' | 'li' | 'kv' | 'table';

export const EDITOR_BLOCK_TYPES: { key: EditorBlockType; label: string; hint: string }[] = [
  { key: 'title', label: 'Title', hint: 'The document heading, once at the top.' },
  { key: 'h', label: 'Section heading', hint: 'A heading for a section.' },
  { key: 'p', label: 'Paragraph', hint: 'A block of body text.' },
  { key: 'li', label: 'Bullet', hint: 'One bullet in a list.' },
  { key: 'kv', label: 'Field', hint: 'A label and its value, e.g. Term: 12 months.' },
  { key: 'table', label: 'Table', hint: 'A grid of typed columns; rows are added per contract (e.g. the outputs table).' },
];

export function blockTypeLabel(t: string): string {
  return EDITOR_BLOCK_TYPES.find((b) => b.key === t)?.label ?? t;
}

/** True when the editor knows how to edit this block type inline. */
export function isEditableBlockType(t: string): t is EditorBlockType {
  return EDITOR_BLOCK_TYPES.some((b) => b.key === t);
}

export interface TemplateBlock {
  id: string;
  version_id: string;
  workspace_id: string;
  position: number;
  block_type: string;
  content: Record<string, unknown>;
  optional?: boolean;
  condition?: string | null;
  clause_id?: string | null;
}

/** The default content object for a freshly added block of a given type. */
export function defaultBlockContent(t: EditorBlockType): Record<string, unknown> {
  if (t === 'kv') return { label: '', value: '' };
  if (t === 'table') return { columns: [] };
  return { text: '' };
}

/** The single text field of a text block (title/h/p/li). Empty for others. */
export function blockText(b: Pick<TemplateBlock, 'content'>): string {
  const v = b.content?.text;
  return typeof v === 'string' ? v : '';
}

/** The {label, value} of a kv block, each defaulting to ''. */
export function blockKV(b: Pick<TemplateBlock, 'content'>): { label: string; value: string } {
  const l = b.content?.label, v = b.content?.value;
  return { label: typeof l === 'string' ? l : '', value: typeof v === 'string' ? v : '' };
}

/**
 * Move the item at `index` one step up (dir -1) or down (dir +1), returning a
 * new array. Out-of-range moves (first up, last down) return the array
 * unchanged. Pure - does not mutate the input.
 */
export function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Stamp `position` = array index onto each block, returning new objects. This
 * is what the reorder write sends: the whole list with contiguous positions, in
 * one upsert (the deferrable unique on (version_id, position) lets the swap land
 * in a single statement). Pure.
 */
export function withPositions<T extends { position: number }>(blocks: T[]): T[] {
  return blocks.map((b, i) => (b.position === i ? b : { ...b, position: i }));
}

/** The next position for an appended block: one past the current max, or 0. */
export function nextPosition(blocks: Pick<TemplateBlock, 'position'>[]): number {
  return blocks.reduce((m, b) => Math.max(m, b.position + 1), 0);
}

/** A version can be published once it has at least one block. */
export function canPublish(blocks: unknown[]): boolean {
  return blocks.length > 0;
}

// ---- direction (bidi / RTL) --------------------------------------------

export type Dir = 'rtl' | 'ltr';

// Arabic (incl. supplement, extended-A) and its presentation forms, plus
// Hebrew. Enough to tell an Arabic contract from an English one; individual
// fields still use dir="auto" so a Latin name inside Arabic text sits right.
const RTL_RE = /[\u0591-\u07ff\u08a0-\u08ff\ufb1d-\ufdfd\ufe70-\ufefc]/;

/** True if the string contains any right-to-left (Arabic/Hebrew) character. */
export function hasRTLChars(s: string): boolean {
  return RTL_RE.test(s);
}

/** All the human text a block carries (the text field, or a kv's label+value). */
export function blockAllText(b: Pick<TemplateBlock, 'content'>): string {
  const kv = blockKV(b);
  return `${blockText(b)} ${kv.label} ${kv.value}`.trim();
}

/**
 * The document's overall writing direction, decided by its content: 'rtl' when
 * more of its non-empty blocks read right-to-left than left-to-right, else
 * 'ltr'. Empty or tied -> 'ltr'. The editor uses this as the default and lets
 * the user override it. Pure.
 */
export function detectDir(blocks: Pick<TemplateBlock, 'content'>[]): Dir {
  let rtl = 0, ltr = 0;
  for (const b of blocks) {
    const s = blockAllText(b);
    if (!s) continue;
    if (hasRTLChars(s)) rtl++; else ltr++;
  }
  return rtl > ltr ? 'rtl' : 'ltr';
}

// ---- placeholders (merge fields) ---------------------------------------
//
// A template's wording carries {{ merge fields }} - {{ brand_name }},
// {{ Amount_full }}, {{ iban }} - filled per contract when it is generated.
// The set of valid fields is a workspace-scoped registry (legal.placeholder).
// A key is letters, numbers and underscores, tolerating spaces inside the
// braces (the existing DOCX writes "{{ id }}").

const PLACEHOLDER_G = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * A field's input type (migration 099). "Legal chooses, it does not write":
 * list draws from a managed list, number is a bounded entry, date a date, auto
 * is system-filled, and text is the only free entry - names, ID numbers, IBANs.
 */
export type FieldType = 'text' | 'number' | 'date' | 'list' | 'auto';

export const FIELD_TYPES: { key: FieldType; label: string; hint: string }[] = [
  { key: 'text', label: 'Text', hint: 'Free text - names, ID numbers, IBANs.' },
  { key: 'number', label: 'Number', hint: 'A number within a min and max.' },
  { key: 'date', label: 'Date', hint: 'A date.' },
  { key: 'list', label: 'List', hint: 'Choose from a managed list.' },
  { key: 'auto', label: 'Auto', hint: 'Filled automatically by the system.' },
];

export function fieldTypeLabel(t: string): string {
  return FIELD_TYPES.find((f) => f.key === t)?.label ?? t;
}

export interface Placeholder {
  id: string;
  key: string;
  label: string;
  field_type: FieldType;
  required: boolean;
  default_value: string;
  num_min: number | null;
  num_max: number | null;
  list_id: string | null;
  owner_dept: Dept;
  /** Date alert window (migration 101): null = not tracked; 0 = expiry (must be
   *  today or later); N > 0 = warn when within N days. A past tracked date
   *  blocks issuing. Only meaningful on a `date` field. */
  alert_days: number | null;
}

/** The columns a field write sends - the shape of the new/edit field form. */
export type FieldDef = Omit<Placeholder, 'id'>;

/** Validate a field definition. Returns an error sentence, or null if ok. */
export function validateFieldDef(f: Pick<FieldDef, 'field_type' | 'num_min' | 'num_max' | 'list_id'>): string | null {
  if (f.field_type === 'list' && !f.list_id) return 'Pick a list for a list field.';
  if (f.field_type === 'number' && f.num_min != null && f.num_max != null && f.num_min > f.num_max) {
    return 'The minimum cannot exceed the maximum.';
  }
  return null;
}

/** A short human description of a field's type and bounds, for the field row. */
export function describeField(
  f: Pick<Placeholder, 'field_type' | 'num_min' | 'num_max' | 'list_id' | 'required'>,
  lists: { id: string; name: string }[],
): string {
  const parts: string[] = [];
  if (f.field_type === 'list') {
    const l = lists.find((x) => x.id === f.list_id);
    parts.push(l ? `List: ${l.name}` : 'List (none set)');
  } else if (f.field_type === 'number') {
    const lo = f.num_min, hi = f.num_max;
    parts.push(lo != null || hi != null ? `Number ${lo ?? ''}-${hi ?? ''}` : 'Number');
  } else {
    parts.push(fieldTypeLabel(f.field_type));
  }
  if (f.required) parts.push('required');
  return parts.join(' \u00b7 ');
}

/** Every placeholder key found in a string, in order, with repeats. */
export function parsePlaceholderKeys(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(PLACEHOLDER_G.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** The distinct placeholder keys used across a set of blocks, sorted. */
export function usedPlaceholderKeys(blocks: Pick<TemplateBlock, 'content'>[]): string[] {
  const set = new Set<string>();
  for (const b of blocks) for (const k of parsePlaceholderKeys(blockAllText(b))) set.add(k);
  return [...set].sort();
}

/** Keys used in the wording that are not in the registry (typos / new fields). */
export function unknownPlaceholders(used: string[], registered: string[]): string[] {
  const reg = new Set(registered);
  return used.filter((k) => !reg.has(k));
}

/** Validate a registry key. Returns an error sentence, or null if ok. */
export function validatePlaceholderKey(key: string): string | null {
  const k = key.trim();
  if (!k) return 'A field needs a key.';
  if (!/^[A-Za-z0-9_]+$/.test(k)) return 'Use letters, numbers and underscores only (no spaces).';
  return null;
}

/**
 * Fill placeholders from a values map. A key with no value is left as its
 * literal {{ key }} so a missing field is visible, not silently blank. Pure.
 */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(new RegExp(PLACEHOLDER_G.source, 'g'),
    (m, k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : m));
}

// ---- managed lists (the dropdown enumerations) -------------------------
//
// "Legal chooses, it does not write": a list-type field draws from a managed
// list, and each list is owned by a department (migration 099). This slice is
// the lists themselves; wiring a field to a list comes next.

export type Dept = 'legal' | 'finance' | 'operations' | 'admin';

export const DEPTS: { key: Dept; label: string }[] = [
  { key: 'legal', label: 'Legal' },
  { key: 'finance', label: 'Finance' },
  { key: 'operations', label: 'Operations' },
  { key: 'admin', label: 'Admin' },
];

export function deptLabel(d: string): string {
  return DEPTS.find((x) => x.key === d)?.label ?? d;
}

export interface ManagedList {
  id: string;
  key: string;
  name: string;
  owner_dept: Dept;
}

export interface ManagedListValue {
  id: string;
  list_id: string;
  value: string;
  label: string;
  position: number;
  active: boolean;
}

/** Validate a list-value entry. Returns an error sentence, or null if ok. */
export function validateListValue(value: string): string | null {
  return value.trim() ? null : 'A value cannot be empty.';
}

/** A list's values in display order: by position, then by value. Pure. */
export function sortListValues<T extends { position: number; value: string }>(values: T[]): T[] {
  return values.slice().sort((a, b) => (a.position - b.position) || a.value.localeCompare(b.value));
}

// ---- contracts (a filled-in document, stamped to a template version) ----
//
// A contract is created FROM a published template version and carries the
// filled field values (legal.contract + legal.contract_field, migration 100).
// The New-Contract screen shows only the fields the version's wording uses,
// each typed per the registry - "Legal chooses, it does not write". A draft
// is editable; once issued/signed the values freeze in the database.

export type ContractStatus = 'draft' | 'issued' | 'signed' | 'void';

export const CONTRACT_STATUSES: { key: ContractStatus; label: string }[] = [
  { key: 'draft', label: 'Draft' },
  { key: 'issued', label: 'Issued' },
  { key: 'signed', label: 'Signed' },
  { key: 'void', label: 'Void' },
];

/** The words on a contract's status pill. Unknown/blank reads as Draft. */
export function contractStatusLabel(s: string | null | undefined): string {
  return CONTRACT_STATUSES.find((x) => x.key === s)?.label ?? 'Draft';
}

/** The badge colour class for a contract status. */
export function contractStatusBadge(s: string | null | undefined): string {
  return s === 'signed' ? 'aq-badge-success'
    : s === 'issued' ? 'aq-badge-info'
    : s === 'void' ? 'aq-badge-muted'
    : 'aq-badge-warning';
}

/** A contract's field values are editable only while it is a draft. */
export function contractEditable(status: string | null | undefined): boolean {
  return status == null || status === 'draft';
}

export interface Contract {
  id: string;
  workspace_id: string;
  template_id: string;
  version_id: string;
  title: string;
  status: ContractStatus;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ContractFieldValue {
  id?: string;
  contract_id?: string;
  key: string;
  value: string;
}

/**
 * The registry fields a version's wording actually uses, in first-appearance
 * order, resolved to their definitions. Keys with no registry entry are
 * dropped - Publish blocks unknown keys, so a published version has none, and
 * dropping is safe if the registry later loses one. Pure.
 */
export function fillFieldsForBlocks(
  blocks: Pick<TemplateBlock, 'content'>[],
  placeholders: Placeholder[],
): Placeholder[] {
  const byKey = new Map(placeholders.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const out: Placeholder[] = [];
  for (const b of blocks) {
    for (const k of parsePlaceholderKeys(blockAllText(b))) {
      if (seen.has(k)) continue;
      seen.add(k);
      const p = byKey.get(k);
      if (p) out.push(p);
    }
  }
  return out;
}

/**
 * Validate one entered field value against its type and bounds. An empty value
 * is allowed unless the field is required (a draft can be saved part-filled;
 * issuing is what enforces required). For a list field, pass its allowed active
 * values to check membership. Returns an error sentence, or null if ok. Pure.
 */
export function validateFieldValue(
  f: Pick<Placeholder, 'field_type' | 'required' | 'num_min' | 'num_max'>,
  value: string,
  list?: { values: string[] },
): string | null {
  const v = (value ?? '').trim();
  if (!v) return f.required ? 'This field is required.' : null;
  if (f.field_type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return 'Enter a number.';
    if (f.num_min != null && n < f.num_min) return `Must be at least ${f.num_min}.`;
    if (f.num_max != null && n > f.num_max) return `Must be at most ${f.num_max}.`;
  }
  if (f.field_type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Pick a date.';
  if (f.field_type === 'list' && list && !list.values.includes(v)) return 'Choose a value from the list.';
  return null;
}

/**
 * True when every field passes validation - required ones filled, numbers in
 * range, list values in their list - so the contract can be issued. `listsByKey`
 * maps a field key to its allowed active values. Pure.
 */
export function contractReady(
  fields: Placeholder[],
  values: Record<string, string>,
  listsByKey?: Record<string, string[]>,
): boolean {
  return fields.every((f) => validateFieldValue(
    f, values[f.key] ?? '', listsByKey?.[f.key] ? { values: listsByKey[f.key] } : undefined,
  ) === null);
}

/**
 * The initial values map for a fresh contract: each field's default_value,
 * where one is set. Pure.
 */
export function seedContractValues(fields: Placeholder[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) if (f.default_value) out[f.key] = f.default_value;
  return out;
}

// The reserved contract_field keys that hold a contract's integrity stamp. They
// are written at issue time (while the contract is still a draft, so the freeze
// trigger permits them) and are not template fields, so they never appear as a
// fillable input. The double-underscore prefix keeps them out of any template's
// {{ placeholder }} namespace.
export const FINGERPRINT_KEY = '__aq_fingerprint';
export const ISSUED_AT_KEY = '__aq_issued_at';

/**
 * The canonical string a contract's fingerprint is taken over: the stamped
 * version id, then every block in order with its placeholders filled from
 * `values`. Deterministic and stable - the same version + values always yield
 * the same string, so re-hashing it later verifies the issued content is
 * unchanged. Reserved keys (they are not blocks) do not enter it. Pure.
 */
export function contractCanonical(
  versionId: string,
  blocks: (Pick<TemplateBlock, 'block_type' | 'content'> & { id?: string })[],
  values: Record<string, string>,
): string {
  const lines = [`v:${versionId}`];
  for (const b of blocks) {
    if (b.block_type === 'kv') {
      const kv = blockKV(b);
      lines.push(`kv|${fillPlaceholders(kv.label, values)}=${fillPlaceholders(kv.value, values)}`);
    } else if (b.block_type === 'table') {
      const cols = tableColumns(b).map((c) => c.key).join(',');
      lines.push(`table|${cols}|${values[tableKey(b.id ?? '')] ?? ''}`);
    } else {
      lines.push(`${b.block_type}|${fillPlaceholders(blockText(b), values)}`);
    }
  }
  return lines.join('\n');
}

/**
 * A SHA-256 hex digest shown human-readably: uppercase, grouped in fours. The
 * whole digest is kept (nothing truncated). Pure.
 */
export function formatFingerprint(hex: string): string {
  const h = String(hex ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return h.replace(/(.{4})/g, '$1 ').trim();
}

// ---- optional clauses (per-contract include / exclude) ------------------
//
// A template block may be marked `optional` (the doc_template_block.optional
// column). When a contract is made, an optional clause is included by default
// and the operator can switch it off; the ids of the switched-off blocks are
// stored in a reserved contract_field so the choice is frozen at issue. An
// excluded clause drops from the generated document, the print, the fields to
// fill, and the fingerprint.

export const OPT_OFF_KEY = '__aq_opt_off';

/** True when a block can be toggled off per contract. */
export function isOptionalBlock(b: Pick<TemplateBlock, 'optional'>): boolean {
  return b.optional === true;
}

/** The block ids switched OFF, parsed from the reserved field's CSV value. */
export function parseOffIds(csv: string | null | undefined): string[] {
  return String(csv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Serialise a set of switched-off block ids back to the reserved field value. */
export function serializeOffIds(ids: string[]): string {
  return [...new Set(ids.filter(Boolean))].join(',');
}

/**
 * The blocks that appear in the generated document: all except the optional
 * ones this contract has switched off. Pure - preserves order, does not mutate.
 */
export function visibleBlocks<T extends { id?: string }>(blocks: T[], offIds: string[]): T[] {
  if (!offIds.length) return blocks;
  const off = new Set(offIds);
  return blocks.filter((b) => !(b.id != null && off.has(b.id)));
}

// ---- date alerts (a tracked date warns, and an expired one blocks) ------
//
// A date field can carry an alert window (placeholder.alert_days, migration
// 101). On the New-Contract screen a tracked date that is in the past is
// "expired" (red) and disables Issue; one within the window is "expiring soon"
// (amber, advisory). Dates are compared as YYYY-MM-DD strings (lexical order is
// chronological). Pure - the caller passes today as a string, no argless Date.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export type DateAlert = 'expired' | 'soon' | 'ok';

/** `iso` (YYYY-MM-DD) shifted by `n` days, as YYYY-MM-DD. Pure (Date with args). */
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * A tracked date's alert state against today. `null` when the field is not
 * tracked (alertDays null) or nothing valid is entered. Past -> 'expired';
 * within `alertDays` (when > 0) -> 'soon'; otherwise 'ok'. Pure.
 */
export function dateAlertState(dateStr: string, alertDays: number | null, todayStr: string): DateAlert | null {
  if (alertDays == null) return null;
  const d = (dateStr ?? '').trim();
  if (!ISO_DATE.test(d) || !ISO_DATE.test(todayStr)) return null;
  if (d < todayStr) return 'expired';
  if (alertDays > 0 && d <= addDaysISO(todayStr, alertDays)) return 'soon';
  return 'ok';
}

export interface ContractDateAlert { key: string; label: string; state: DateAlert; }

/**
 * The actionable date alerts across a contract's fields - the tracked date
 * fields whose entered value is expired or expiring soon. Pure.
 */
export function contractDateAlerts(
  fields: Pick<Placeholder, 'key' | 'label' | 'field_type' | 'alert_days'>[],
  values: Record<string, string>,
  todayStr: string,
): ContractDateAlert[] {
  const out: ContractDateAlert[] = [];
  for (const f of fields) {
    if (f.field_type !== 'date' || f.alert_days == null) continue;
    const st = dateAlertState(values[f.key] ?? '', f.alert_days, todayStr);
    if (st === 'expired' || st === 'soon') out.push({ key: f.key, label: f.label || f.key, state: st });
  }
  return out;
}

/** True when any alert is a hard block (an expired date). Pure. */
export function hasBlockingAlert(alerts: { state: DateAlert }[]): boolean {
  return alerts.some((a) => a.state === 'expired');
}

/** The words shown on a date alert. */
export function dateAlertLabel(state: DateAlert): string {
  return state === 'expired' ? 'Expired' : state === 'soon' ? 'Expiring soon' : 'OK';
}

// ---- outputs table (a grid of typed columns, rows filled per contract) --
//
// A `table` block carries a set of columns; each column is a registry field
// (referenced by key, with a label snapshot for display), so a cell reuses that
// field's type - a list column is a dropdown, a number column is bounded. The
// template defines the columns; the contract adds rows. Row data is stored as
// JSON in a reserved contract_field keyed by the block id, so it freezes with
// everything else at issue and enters the fingerprint.

export const TABLE_KEY_PREFIX = '__aq_table_';
export interface TableColumn { key: string; label: string; }
export type TableRow = Record<string, string>;

/** The reserved contract_field key that holds a table block's row data. */
export function tableKey(blockId: string): string {
  return `${TABLE_KEY_PREFIX}${blockId}`;
}

/** A table block's columns, from its content. Malformed entries are dropped. Pure. */
export function tableColumns(b: Pick<TemplateBlock, 'content'>): TableColumn[] {
  const raw = (b.content as any)?.columns;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.key === 'string' && c.key)
    .map((c) => ({ key: c.key as string, label: typeof c.label === 'string' ? c.label : c.key }));
}

/** Resolve a table's columns to their registry fields (for typed cell inputs),
 *  dropping any whose key is not registered. Pure. */
export function tableColumnFields(cols: TableColumn[], placeholders: Placeholder[]): (TableColumn & { field: Placeholder })[] {
  const byKey = new Map(placeholders.map((p) => [p.key, p]));
  const out: (TableColumn & { field: Placeholder })[] = [];
  for (const c of cols) {
    const f = byKey.get(c.key);
    if (f) out.push({ ...c, field: f });
  }
  return out;
}

/** Parse a table block's stored rows (JSON). Returns [] on anything malformed;
 *  each row is coerced to a flat string map. Pure. */
export function parseTableRows(json: string | null | undefined): TableRow[] {
  if (!json) return [];
  let v: unknown;
  try { v = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(v)) return [];
  return v.map((r) => {
    const out: TableRow = {};
    if (r && typeof r === 'object') {
      for (const [k, val] of Object.entries(r as Record<string, unknown>)) {
        out[k] = val == null ? '' : String(val);
      }
    }
    return out;
  });
}

/** Serialise table rows back to the reserved field value. Pure. */
export function serializeTableRows(rows: TableRow[]): string {
  return JSON.stringify(rows ?? []);
}

/** A fresh empty row for the given columns (every cell ''). Pure. */
export function emptyTableRow(cols: TableColumn[]): TableRow {
  const out: TableRow = {};
  for (const c of cols) out[c.key] = '';
  return out;
}

// ---- printable contract (a self-contained document to Print / Save as PDF) --
//
// An issued (or draft) contract is rendered to a stand-alone HTML document -
// letterhead, the version's blocks with their placeholders filled, a footer -
// and opened in a new window for the browser's Print / Save-as-PDF. No server,
// no PDF library: the browser is the renderer. Pure here (the caller supplies
// any date string), so it is testable.

/** HTML-escape a string for safe insertion as element text or an attribute. */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PrintMeta {
  org?: string;
  status?: string;
  reference?: string;
  generatedOn?: string;
  fingerprint?: string;
}

/**
 * A self-contained, print-ready HTML document for a filled contract. The blocks
 * are rendered in order with their placeholders filled from `values`; unfilled
 * placeholders stay visible as their literal {{ key }} so a gap is obvious.
 * Direction (`dir`) drives lang + text alignment for Arabic. All interpolated
 * content is HTML-escaped. Pure - pass any date as `meta.generatedOn`.
 */
export function contractPrintHTML(args: {
  title: string;
  blocks: (Pick<TemplateBlock, 'block_type' | 'content'> & { id?: string })[];
  values: Record<string, string>;
  dir: Dir;
  meta?: PrintMeta;
}): string {
  const { title, blocks, values, dir, meta = {} } = args;

  const body = blocks.map((b) => {
    if (b.block_type === 'kv') {
      const kv = blockKV(b);
      return `<div class="kv"><span class="kv-l">${escapeHtml(fillPlaceholders(kv.label, values))}:</span> `
        + `<span class="kv-v">${escapeHtml(fillPlaceholders(kv.value, values))}</span></div>`;
    }
    if (b.block_type === 'table') {
      const cols = tableColumns(b);
      if (!cols.length) return '';
      const rows = parseTableRows(values[tableKey(b.id ?? '')]);
      const head = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
      const bodyRows = rows.length
        ? rows.map((r) => `<tr>${cols.map((c) => `<td>${escapeHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${cols.length}" class="doc-table-empty">(no rows)</td></tr>`;
      return `<table class="doc-table"><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
    const text = escapeHtml(fillPlaceholders(blockText(b), values));
    switch (b.block_type) {
      case 'title': return `<h1 class="doc-title">${text}</h1>`;
      case 'h': return `<h2 class="doc-h">${text}</h2>`;
      case 'li': return `<div class="doc-li">&bull; ${text}</div>`;
      case 'p': return `<p class="doc-p">${text}</p>`;
      default: return text ? `<p class="doc-p">${text}</p>` : '';
    }
  }).filter(Boolean).join('\n  ');

  const org = escapeHtml(meta.org ?? 'AQ Creativity');
  const safeTitle = escapeHtml(title || 'Contract');
  const metaLines = [
    safeTitle,
    meta.status ? `Status: ${escapeHtml(meta.status)}` : '',
    meta.generatedOn ? `Generated: ${escapeHtml(meta.generatedOn)}` : '',
  ].filter(Boolean).join('<br>');
  const ref = meta.reference ? escapeHtml(meta.reference) : '';
  const fp = meta.fingerprint ? escapeHtml(meta.fingerprint) : '';
  const lang = dir === 'rtl' ? 'ar' : 'en';
  const metaAlign = dir === 'rtl' ? 'left' : 'right';

  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, 'Helvetica Neue', sans-serif; color: #1a1a1a; line-height: 1.75; font-size: 12pt; }
  .sheet { max-width: 800px; margin: 0 auto; padding: 32px; }
  .lh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 22px; }
  .lh-org { font-size: 18pt; font-weight: 800; letter-spacing: .5px; }
  .lh-meta { font-size: 9pt; color: #555; text-align: ${metaAlign}; line-height: 1.5; }
  .doc-title { font-size: 18pt; font-weight: 800; text-align: center; margin: 8px 0 20px; }
  .doc-h { font-size: 13pt; font-weight: 700; margin: 18px 0 6px; }
  .doc-p { margin: 8px 0; text-align: justify; }
  .doc-li { margin: 4px 0; padding-inline-start: 8px; }
  .kv { margin: 6px 0; }
  .kv-l { font-weight: 700; }
  .doc-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10.5pt; }
  .doc-table th, .doc-table td { border: 1px solid #999; padding: 4px 6px; text-align: start; vertical-align: top; }
  .doc-table th { background: #f0f0f0; font-weight: 700; }
  .doc-table-empty { color: #888; text-align: center; }
  .foot { margin-top: 28px; border-top: 1px solid #bbb; padding-top: 8px; font-size: 9pt; color: #666; }
  .foot-row { display: flex; justify-content: space-between; gap: 12px; }
  .foot-fp { margin-top: 6px; font-family: 'Courier New', monospace; font-size: 8pt; color: #444; word-break: break-all; direction: ltr; text-align: left; }
  @media print {
    .sheet { max-width: none; padding: 0; }
    @page { size: A4; margin: 18mm; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="lh">
    <div class="lh-org">${org}</div>
    <div class="lh-meta">${metaLines}</div>
  </div>
  ${body}
  <div class="foot">
    <div class="foot-row"><span>${ref}</span><span>${org}</span></div>
    ${fp ? `<div class="foot-fp">Fingerprint (SHA-256): ${fp}</div>` : ''}
  </div>
</div>
</body>
</html>`;
}
