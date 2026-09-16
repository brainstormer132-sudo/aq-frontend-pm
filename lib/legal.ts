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
export type EditorBlockType = 'title' | 'h' | 'p' | 'li' | 'kv';

export const EDITOR_BLOCK_TYPES: { key: EditorBlockType; label: string; hint: string }[] = [
  { key: 'title', label: 'Title', hint: 'The document heading, once at the top.' },
  { key: 'h', label: 'Section heading', hint: 'A heading for a section.' },
  { key: 'p', label: 'Paragraph', hint: 'A block of body text.' },
  { key: 'li', label: 'Bullet', hint: 'One bullet in a list.' },
  { key: 'kv', label: 'Field', hint: 'A label and its value, e.g. Term: 12 months.' },
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
  return t === 'kv' ? { label: '', value: '' } : { text: '' };
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

export interface Placeholder {
  id: string;
  key: string;
  label: string;
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
