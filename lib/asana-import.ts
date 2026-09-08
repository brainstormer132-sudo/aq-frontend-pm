/**
 * Asana -> AQ import: the pure half.
 *
 * Reads the CSV Asana exports for a project (`Export / Print -> CSV`) and
 * turns it into a plan - campaigns, vendor bookings, ad lines, and the
 * clients / brands / vendors they need - then renders that plan as SQL for
 * the Supabase SQL editor.
 *
 * -- Why SQL and not the app ---------------------------------------
 *
 * The SQL editor runs as the table owner, inside one transaction per file,
 * with no PostgREST 1000-row cap and no RLS in the way. Every write is
 * keyed on `asana_gid` (migration 077), so a re-run after a fresh export
 * updates instead of duplicating, and `99_wipe.sql` takes the whole import
 * out again in one statement. That is the property the Zoho import lacked
 * (see claude/aq-zoho-import-fix.md) and the first thing this one has.
 *
 * -- Rules this file follows ---------------------------------------
 *
 * Pure. No React, no Supabase, no argless `new Date()`. The script in
 * `scripts/asana-import.mjs` does the file I/O; `tests/asana-import.test.mjs`
 * exercises the compiled module.
 *
 * -- What Asana's export actually looks like -----------------------
 *
 * - `Task ID` is a 16-digit gid. Opening the CSV in Excel rounds it to
 *   `1.2182E+15`; `readRows` refuses such a file rather than import 6,000
 *   rows sharing 265 keys.
 * - `Parent task` is the parent's NAME, not its gid, and names repeat.
 *   Asana writes a parent's subtasks directly beneath it, so the nearest
 *   preceding parent row with that name is the parent. That rule resolved
 *   5,892 of 5,895 subtasks on the first real file; the other three named
 *   a parent that was unique anyway.
 * - Money: on 5,266 rows with all three numbers, `Price - Net = AQ Gross`
 *   held every time. Net is the talent's fee; it lands in `net_amount`.
 * - `Vendor Name` is a dropdown with two placeholders, `UGC` and
 *   `Other Vendor...`, and the real person typed into `Other Vendor...`.
 */

// -----------------------------------------------------------------
// CSV
// -----------------------------------------------------------------

/** RFC 4180 parser: quotes, doubled quotes, embedded newlines, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // A trailing empty line is not a row.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * Fill columns missing from one export with the same columns from another.
 *
 * Asana only exports the custom fields currently shown on the project, so
 * two exports a day apart can differ in columns (the second JED_Deals_26
 * export had no Contract, Packages or Links). The rows themselves come out
 * in the same order, so when both files have the same row count and every
 * row agrees on Name and Parent task, a column absent from `primary` is
 * copied from `extra` by position. Anything else is refused: guessing a
 * join for 6,000 rows is how the wrong contract lands on a campaign.
 */
export function mergeExports(primary: string, extra: string): { text: string; added: string[] } {
  const a = parseCsv(primary);
  const b = parseCsv(extra);
  if (a.length !== b.length) throw new Error(`Cannot merge: ${a.length - 1} rows vs ${b.length - 1}.`);
  const ah = a[0].map(normHeader);
  const bh = b[0].map(normHeader);
  const col = (h: string[], want: string) => h.indexOf(want);
  const an = col(ah, 'name'); const ap = col(ah, 'parent task');
  const bn = col(bh, 'name'); const bp = col(bh, 'parent task');
  if (an < 0 || bn < 0) throw new Error('Cannot merge: a file has no Name column.');
  for (let r = 1; r < a.length; r++) {
    if (clean(a[r][an] ?? '') !== clean(b[r][bn] ?? '') || clean(a[r][ap] ?? '') !== clean(b[r][bp] ?? '')) {
      throw new Error(`Cannot merge: row ${r + 1} differs ("${a[r][an]}" vs "${b[r][bn]}"). The exports are not the same rows in the same order.`);
    }
  }
  const missing: number[] = [];
  bh.forEach((h, i) => { if (h && !ah.includes(h)) missing.push(i); });
  const added = missing.map((i) => b[0][i].trim());
  const out = a.map((row, r) => [...row, ...missing.map((i) => b[r][i] ?? '')]);
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return { text: out.map((row) => row.map(esc).join(',')).join('\n') + '\n', added };
}

// -----------------------------------------------------------------
// Rows
// -----------------------------------------------------------------

export interface AsanaRow {
  gid: string;
  createdAt: string;
  completedAt: string;
  name: string;
  parentName: string;
  assigneeEmail: string;
  dueDate: string;
  tags: string;
  notes: string;
  dept: string;
  sales: string;
  source: string;
  clientCtg: string;
  client: string;
  brand: string;
  picName: string;
  picNo: string;
  picEmail: string;
  vendor: string;
  otherVendor: string;
  platform: string;
  adType: string;
  approval: string;
  totalAmount: string;
  price: string;
  status: string;
  quotationNo: string;
  clientPayment: string;
  invoiceNo: string;
  paymentDate: string;
  paidAmount: string;
  net: string;
  netPaymentDate: string;
  netPayment: string;
  contract: string;
  kam: string;
  packages: string;
  links: string;
  /** Row index in the file, 0-based, so order-dependent rules are testable. */
  index: number;
}

/**
 * Asana's headers carry stray spaces and dots ("Brand Name ", "Statues ",
 * "Net.."). Match on a normalised form so a re-export with the trailing
 * space removed still reads.
 */
const HEADERS: Record<keyof Omit<AsanaRow, 'index'>, string> = {
  gid: 'task id',
  createdAt: 'created at',
  completedAt: 'completed at',
  name: 'name',
  parentName: 'parent task',
  assigneeEmail: 'assignee email',
  dueDate: 'due date',
  tags: 'tags',
  notes: 'notes',
  dept: 'department ctg',
  sales: 'sales',
  source: 'source',
  clientCtg: 'client ctg',
  client: 'client account name',
  brand: 'brand name',
  picName: 'pic name',
  picNo: 'pic no',
  picEmail: 'pic email',
  vendor: 'vendor name',
  otherVendor: 'other vendor',
  platform: 'platform',
  adType: 'ad type',
  approval: 'approval stage',
  totalAmount: 'total amount',
  price: 'price',
  status: 'statues',
  quotationNo: 'quotation no',
  clientPayment: 'client payment',
  invoiceNo: 'invoice no',
  paymentDate: 'payment date',
  paidAmount: 'paid amount',
  net: 'net',
  netPaymentDate: 'net payment date',
  netPayment: 'net payment',
  contract: 'contract',
  kam: 'key account mangers',
  packages: 'packages',
  links: 'links',
};

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[.\s]+/g, ' ').trim();
}

export interface ReadResult {
  rows: AsanaRow[];
  /** Headers that were expected and not found. `gid` missing is fatal. */
  missing: string[];
  /** Headers in the file this reader does not know. Informational. */
  ignored: string[];
}

export function readRows(text: string): ReadResult {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], missing: Object.keys(HEADERS), ignored: [] };
  const header = table[0].map(normHeader);
  const idx: Partial<Record<keyof AsanaRow, number>> = {};
  const missing: string[] = [];
  for (const [key, want] of Object.entries(HEADERS) as [keyof AsanaRow, string][]) {
    // First exact match; "net" must not grab "net payment".
    let i = header.indexOf(want);
    if (i < 0) i = header.findIndex((h) => h.startsWith(want) && !HEADERS_PREFIX_CLASH(want, h));
    if (i < 0) missing.push(key);
    else idx[key] = i;
  }
  const known = new Set(Object.values(idx));
  const ignored = table[0].filter((_, i) => !known.has(i)).map((h) => h.trim());
  if (idx.gid === undefined) throw new Error('This file has no "Task ID" column - is it an Asana CSV export?');

  const rows: AsanaRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const get = (k: keyof AsanaRow) => {
      const i = idx[k];
      return i === undefined ? '' : clean(cells[i] ?? '');
    };
    const gid = get('gid');
    if (!gid) continue;
    if (!/^\d{12,20}$/.test(gid)) {
      throw new Error(
        `Row ${r + 1}: Task ID is "${gid}", not a 16-digit Asana id. `
        + 'The file was opened and saved in Excel, which rounds the ids. '
        + 'Export again from Asana and upload without opening it.',
      );
    }
    const row = {} as AsanaRow;
    for (const k of Object.keys(HEADERS) as (keyof AsanaRow)[]) (row as any)[k] = get(k);
    row.index = r - 1;
    rows.push(row);
  }
  return { rows, missing, ignored };
}

function HEADERS_PREFIX_CLASH(want: string, h: string): boolean {
  // 'net' also prefixes 'net payment' and 'net payment date'; 'payment date'
  // must not match 'net payment date'; 'brand name' must not grab 'brand name.'
  // twice (the second is a dead duplicate column, and it normalises to the
  // same thing - handled by indexOf taking the first).
  if (want === 'net') return h.startsWith('net payment') || h.startsWith('net ');
  return false;
}

/** Trim, fold non-breaking spaces, drop the leading apostrophe Excel/Asana put on phone numbers. */
export function clean(s: string): string {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+(?=\+?\d)/, '');
}

/** Case- and whitespace-insensitive key for matching names. */
export function fold(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .toLowerCase()
    .replace(/[\s\-_.,()]+/g, ' ')
    .trim();
}

// -----------------------------------------------------------------
// Parents
// -----------------------------------------------------------------

export interface ParentResolution {
  /** child gid -> parent gid */
  parentOf: Map<string, string>;
  /** Subtasks whose parent could not be found at all. */
  orphans: AsanaRow[];
  /** Parent names that occur more than once, with how many times. */
  duplicateNames: Map<string, number>;
}

export function resolveParents(rows: AsanaRow[]): ParentResolution {
  const parents = rows.filter((r) => !r.parentName);
  const byName = new Map<string, AsanaRow[]>();
  for (const p of parents) {
    const list = byName.get(p.name) ?? [];
    list.push(p);
    byName.set(p.name, list);
  }
  const duplicateNames = new Map<string, number>();
  for (const [n, list] of byName) if (list.length > 1) duplicateNames.set(n, list.length);

  const parentOf = new Map<string, string>();
  const orphans: AsanaRow[] = [];
  let lastParent: AsanaRow | null = null;
  for (const r of rows) {
    if (!r.parentName) { lastParent = r; continue; }
    const candidates = byName.get(r.parentName) ?? [];
    let parent: AsanaRow | null = null;
    if (candidates.length === 1) parent = candidates[0];
    else if (candidates.length > 1) {
      // Nearest preceding parent with that name - Asana writes subtasks
      // under their parent, so file order is the tie-break.
      for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].index < r.index) { parent = candidates[i]; break; }
      }
      if (!parent && lastParent && lastParent.name === r.parentName) parent = lastParent;
      if (!parent) parent = candidates[0];
    }
    if (parent) parentOf.set(r.gid, parent.gid);
    else orphans.push(r);
  }
  return { parentOf, orphans, duplicateNames };
}

// -----------------------------------------------------------------
// Vocabulary
// -----------------------------------------------------------------

export type TaskStatus = 'pending' | 'on_hold' | 'done' | 'cancelled';
export type ApprovalStage = 'ready_for_review' | 'changes_needed' | 'approved' | 'hold' | 'cancelled';
export type PayStatus = 'unpaid' | 'partial' | 'paid' | 'no_payment' | 'refund' | 'credit' | 'adjustment';
export type ContractStatus = 'no_contract' | 'po' | 'pending' | 'on_process' | 'done' | 'signed_attached';
export type LineStatus = 'Not started' | 'Scheduled' | 'Shot' | 'Posted' | 'Cancelled';

export function mapStatus(s: string): TaskStatus {
  switch (fold(s)) {
    case 'done': return 'done';
    case 'canceled': case 'cancelled': return 'cancelled';
    case 'on hold': case 'hold': return 'on_hold';
    default: return 'pending'; // Pending, On Going, blank
  }
}

/** Asana's per-vendor status read as the ad line's own. */
export function mapLineStatus(s: string): LineStatus {
  switch (fold(s)) {
    case 'done': return 'Posted';
    case 'canceled': case 'cancelled': return 'Cancelled';
    case 'on going': return 'Scheduled';
    default: return 'Not started';
  }
}

/**
 * Returns the stage, and whether the Asana value had to be folded into
 * `cancelled` (No Reply By Client, Declined By Inf., Declined By Client).
 * The original is kept on the campaign's description so nothing is lost.
 */
export function mapApproval(s: string): { stage: ApprovalStage | null; folded: boolean } {
  const f = fold(s);
  if (!f) return { stage: null, folded: false };
  if (f === 'approved') return { stage: 'approved', folded: false };
  if (f === 'canceled' || f === 'cancelled') return { stage: 'cancelled', folded: false };
  if (f === 'hold' || f === 'on hold') return { stage: 'hold', folded: false };
  if (f === 'ready for review') return { stage: 'ready_for_review', folded: false };
  if (f === 'changes needed') return { stage: 'changes_needed', folded: false };
  if (f.startsWith('declined') || f.startsWith('no reply')) return { stage: 'cancelled', folded: true };
  return { stage: null, folded: true };
}

export function mapPayment(s: string): PayStatus | null {
  switch (fold(s)) {
    case 'paid': return 'paid';
    case 'unpaid': case 'not paid': return 'unpaid';
    case 'partial paid': case 'partial': case 'partially paid': return 'partial';
    case 'no payment': case 'free spot': case 'free': return 'no_payment';
    case 'adjustment': return 'adjustment';
    case 'refund': return 'refund';
    case 'credit': return 'credit';
    default: return null;
  }
}

export function mapContract(s: string): ContractStatus | null {
  const f = fold(s);
  if (f.startsWith('signed')) return 'signed_attached';
  switch (f) {
    case 'no contract': return 'no_contract';
    case 'on process': return 'on_process';
    case 'pending': return 'pending';
    case 'po': return 'po';
    case 'done': return 'done';
    default: return null;
  }
}

export function mapSource(s: string): 'AQ' | 'Influencer' | 'Outsourced' | null {
  const f = fold(s);
  if (!f) return null;
  if (f === 'aq') return 'AQ';
  if (f.startsWith('inf')) return 'Influencer';
  if (f.startsWith('out')) return 'Outsourced';
  return null;
}

/** Values that appear in Asana's Platform column but are not platforms. */
const NOT_A_PLATFORM = new Set(['client', 'off line', 'offline', 'photoshoot', 'aq fee', 'commission', '']);

/** "SnapChat, Instagram, TikTok" -> ['SnapChat','Instagram','TikTok'], canonical spelling. */
export function splitPlatforms(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/[,/]/)) {
    const p = clean(part);
    if (!p) continue;
    const canon = canonicalPlatform(p);
    if (!out.includes(canon)) out.push(canon);
  }
  return out;
}

export function isRealPlatform(name: string): boolean {
  return !NOT_A_PLATFORM.has(fold(name));
}

function canonicalPlatform(p: string): string {
  switch (fold(p)) {
    case 'tiktok': case 'tik tok': return 'TikTok';
    case 'snapchat': case 'snap chat': case 'snap': return 'Snapchat';
    case 'instagram': case 'ig': return 'Instagram';
    case 'youtube': return 'YouTube';
    case 'x': case 'twitter': return 'X';
    case 'linkedin': return 'LinkedIn';
    case 'off line': case 'offline': return 'Off Line';
    default: return p;
  }
}

/** Campaign ad type: Asana's own list is already the app's list, bar one spelling. */
export function mapAdType(s: string): { adType: string | null; custom: string | null } {
  const f = fold(s);
  if (!f) return { adType: null, custom: null };
  if (f === 'multiservices' || f === 'multi services' || f === 'multi service') {
    return { adType: 'Multi Service', custom: null };
  }
  return { adType: clean(s), custom: null };
}

/** Department Ctg -> service type name candidates, best first. */
export function serviceTypeCandidates(s: string): string[] {
  const raw = clean(s);
  if (!raw) return [];
  const f = fold(raw);
  const alias: Record<string, string[]> = {
    'billboard': ['Billboards'],
    'billboards': ['Billboards'],
    'package ad': ['Package Ad', 'Package AD'],
    'campaign': ['Influencers Campaign', 'Campaign'],
    'ad hoc': ['AD Hoc', 'Ad Hoc'],
    'annual contracts': ['Annual Contracts', 'Annual Contract'],
  };
  const list = alias[f] ?? [];
  if (!list.some((n) => fold(n) === f)) list.push(raw);
  return list;
}

// -----------------------------------------------------------------
// Vendors
// -----------------------------------------------------------------

export interface VendorRef {
  /** `asana:` + folded name; the registry's `import_key`. */
  key: string;
  name: string;
  /** vendors.vendor_category text; '' when unknown. */
  category: string;
  /** vendor_categories.key when one applies. */
  categoryKey: string | null;
  /** The name was typed into `Other Vendor...` rather than picked. */
  freeText: boolean;
}

const PLACEHOLDERS = new Set(['ugc', 'other vendor', 'other vendor...', 'other', '']);

export const UNNAMED_UGC = 'UGC - unnamed (Asana)';
export const UNNAMED_OTHER = 'Vendor - unnamed (Asana)';

/**
 * Which person a vendor row is for. Dropdown value when it is a real name;
 * else the free-text `Other Vendor...`; else a per-kind placeholder so the
 * booking still exists and its money still rolls up.
 */
export function resolveVendor(row: AsanaRow): VendorRef {
  const picked = clean(row.vendor);
  const typed = clean(row.otherVendor);
  const pf = fold(picked);
  if (!PLACEHOLDERS.has(pf)) {
    const isAgency = pf === 'aq agency';
    return {
      key: 'asana:' + pf,
      name: picked,
      category: isAgency ? 'Agency' : '',
      categoryKey: null,
      freeText: false,
    };
  }
  const isUgc = pf === 'ugc';
  if (typed) {
    return {
      key: 'asana:' + fold(typed),
      name: typed,
      category: isUgc ? 'UGC' : '',
      categoryKey: isUgc ? 'ugc' : null,
      freeText: true,
    };
  }
  const name = isUgc ? UNNAMED_UGC : UNNAMED_OTHER;
  return {
    key: 'asana:' + fold(name),
    name,
    category: isUgc ? 'UGC' : '',
    categoryKey: isUgc ? 'ugc' : null,
    freeText: false,
  };
}

// -----------------------------------------------------------------
// Plan
// -----------------------------------------------------------------

export interface PlanClient {
  key: string;
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  category: string | null;
  brands: string[];
}

export interface PlanVendor extends VendorRef {
  bookings: number;
}

export interface PlanCampaign {
  gid: string;
  title: string;
  createdAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
  status: TaskStatus;
  stage: 'in_progress' | 'completed';
  serviceTypes: string[];
  salesName: string | null;
  salesInfluencer: boolean;
  source: string | null;
  clientKey: string | null;
  clientFold: string | null;
  brandName: string | null;
  platforms: string[];
  adType: string | null;
  adTypeCustom: string | null;
  approval: ApprovalStage | null;
  budget: number | null;
  quotationNumbers: string[];
  invoiceNumbers: string[];
  clientPayment: PayStatus | null;
  clientPaymentDate: string | null;
  clientPaymentAmount: number | null;
  netPaymentDate: string | null;
  contract: ContractStatus | null;
  kam: string | null;
  assigneeEmail: string | null;
  description: string | null;
}

export interface PlanBooking {
  gid: string;
  parentGid: string;
  position: number;
  title: string;
  createdAt: string | null;
  completedAt: string | null;
  dueDate: string | null;
  status: TaskStatus;
  vendorKey: string;
  vendorFold: string;
  price: number | null;
  net: number | null;
  platform: string | null;
  adType: string | null;
  quotationNo: string | null;
  invoiceNo: string | null;
  vendorPayment: PayStatus | null;
  vendorPaymentDate: string | null;
  lineStatus: LineStatus;
  assigneeEmail: string | null;
  description: string | null;
}

export interface Plan {
  clients: PlanClient[];
  vendors: PlanVendor[];
  campaigns: PlanCampaign[];
  bookings: PlanBooking[];
  lookups: {
    clientCategories: string[];
    platforms: string[];
    sources: string[];
  };
  warnings: string[];
  /** Counters for the report. */
  stats: Record<string, number>;
}

function num(s: string): number | null {
  const t = s.replace(/[,\s]/g, '').replace(/^SAR/i, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Asana dates: ISO `2026-09-06` from a clean export, `9/6/2026` after Excel. */
export function isoDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return null;
}

function pushUnique(list: string[], v: string) {
  const c = clean(v);
  if (c && !list.includes(c)) list.push(c);
}

/** The Asana-only facts a campaign carries, kept as text rather than dropped. */
function describe(lines: [string, string][]): string | null {
  const body = lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (!body.length) return null;
  return ['Imported from Asana.', ...body].join('\n');
}

export function planImport(rows: AsanaRow[], projectName = 'Asana'): Plan {
  const { parentOf, orphans, duplicateNames } = resolveParents(rows);
  const warnings: string[] = [];
  const stats: Record<string, number> = {};
  const bump = (k: string, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };

  for (const o of orphans) warnings.push(`Subtask ${o.gid} "${o.name}" names a parent that is not in the file: "${o.parentName}". Skipped.`);
  for (const [n, c] of duplicateNames) warnings.push(`Campaign name "${n}" occurs ${c} times; subtasks were attributed by file order.`);

  const clients = new Map<string, PlanClient>();
  const vendors = new Map<string, PlanVendor>();
  const clientCategories: string[] = [];
  const platforms: string[] = [];
  const sources: string[] = [];

  const parents = rows.filter((r) => !r.parentName);
  const childrenOf = new Map<string, AsanaRow[]>();
  for (const r of rows) {
    const p = parentOf.get(r.gid);
    if (!p) continue;
    const list = childrenOf.get(p) ?? [];
    list.push(r);
    childrenOf.set(p, list);
  }

  const campaigns: PlanCampaign[] = [];
  const bookings: PlanBooking[] = [];

  for (const p of parents) {
    const kids = childrenOf.get(p.gid) ?? [];
    let title = clean(p.name);
    if (!title || /^retrieving data/i.test(title)) {
      warnings.push(`Campaign ${p.gid} has no usable name ("${title}"); imported as "(untitled Asana task ${p.gid})".`);
      title = `(untitled Asana task ${p.gid})`;
      bump('untitled campaigns');
    }

    // Client
    let clientKey: string | null = null;
    let clientFold: string | null = null;
    const clientName = clean(p.client);
    if (clientName) {
      clientFold = fold(clientName);
      clientKey = 'asana:' + clientFold;
      let c = clients.get(clientKey);
      if (!c) {
        c = { key: clientKey, name: clientName, contactName: '', contactPhone: '', contactEmail: '', category: null, brands: [] };
        clients.set(clientKey, c);
      }
      // First non-empty contact wins; Asana repeats the same PIC on every row.
      if (!c.contactName) c.contactName = clean(p.picName);
      if (!c.contactPhone) c.contactPhone = clean(p.picNo);
      if (!c.contactEmail) c.contactEmail = clean(p.picEmail);
      const cat = clean(p.clientCtg);
      if (cat) { if (!c.category) c.category = cat; pushUnique(clientCategories, cat); }
    } else bump('campaigns without client');

    const brandName = clean(p.brand) || null;
    if (brandName && clientKey) pushUnique(clients.get(clientKey)!.brands, brandName);
    if (!brandName) bump('campaigns without brand');

    // Platforms
    const pl = splitPlatforms(p.platform);
    for (const x of pl) if (isRealPlatform(x)) pushUnique(platforms, x);

    // Source
    const source = mapSource(p.source);
    if (source) pushUnique(sources, source);

    // Sales
    const salesRaw = clean(p.sales);
    const salesF = fold(salesRaw);
    const salesInfluencer = salesF === 'inf' || salesF === 'influencer';
    const salesIsChannel = salesF.startsWith('aq website') || salesF === 'aq ig' || salesF === 'aq instagram';
    const salesName = salesRaw && !salesInfluencer && !salesIsChannel ? salesRaw.replace(/\s+/g, ' ') : null;

    // Approval
    const ap = mapApproval(p.approval);
    if (ap.folded) bump('approval folded into cancelled');

    // Money
    const budget = num(p.totalAmount) ?? num(p.price);
    const status = mapStatus(p.status);

    // Quotation / invoice numbers: the parent's own, then the vendor rows',
    // distinct, in order of first appearance.
    const quotationNumbers: string[] = [];
    const invoiceNumbers: string[] = [];
    pushUnique(quotationNumbers, p.quotationNo);
    pushUnique(invoiceNumbers, p.invoiceNo);
    for (const k of kids) { pushUnique(quotationNumbers, k.quotationNo); pushUnique(invoiceNumbers, k.invoiceNo); }
    if (quotationNumbers.length > 1) bump('campaigns with several quotation numbers');

    const ad = mapAdType(p.adType);
    const kam = clean(p.kam) || null;

    const description = describe([
      ['Project', projectName],
      ['Approval stage in Asana', ap.folded ? clean(p.approval) : ''],
      ['Sales in Asana', salesRaw],
      ['Key account', kam ?? ''],
      ['Packages', clean(p.packages)],
      ['Tags', clean(p.tags)],
      ['Links', clean(p.links)],
      ['Notes', clean(p.notes)],
    ]);

    campaigns.push({
      gid: p.gid,
      title,
      createdAt: isoDate(p.createdAt),
      completedAt: isoDate(p.completedAt),
      dueDate: isoDate(p.dueDate),
      status,
      stage: status === 'done' ? 'completed' : 'in_progress',
      serviceTypes: serviceTypeCandidates(p.dept),
      salesName,
      salesInfluencer,
      source,
      clientKey,
      clientFold,
      brandName,
      platforms: pl,
      adType: ad.adType,
      adTypeCustom: ad.custom,
      approval: ap.stage,
      budget,
      quotationNumbers,
      invoiceNumbers,
      clientPayment: mapPayment(p.clientPayment),
      clientPaymentDate: isoDate(p.paymentDate),
      clientPaymentAmount: num(p.paidAmount),
      netPaymentDate: isoDate(p.netPaymentDate),
      contract: mapContract(p.contract),
      kam,
      assigneeEmail: clean(p.assigneeEmail).toLowerCase() || null,
      description,
    });
    bump('campaigns');

    kids.forEach((k, position) => {
      const v = resolveVendor(k);
      let pv = vendors.get(v.key);
      if (!pv) { pv = { ...v, bookings: 0 }; vendors.set(v.key, pv); }
      pv.bookings++;
      if (v.freeText) bump('bookings with a free-text vendor');
      if (v.name === UNNAMED_UGC || v.name === UNNAMED_OTHER) bump('bookings with no vendor name');

      const price = num(k.price);
      const net = num(k.net);
      if (price !== null && net !== null && net > price) bump('bookings where net exceeds price');
      if ((price !== null && price < 0) || (net !== null && net < 0)) {
        warnings.push(`Booking ${k.gid} "${k.name}" carries a negative amount (price ${price}, net ${net}) - a discount row. Kept on the booking; its ad line is unpriced.`);
        bump('discount rows (negative amounts)');
      }

      const kAd = mapAdType(k.adType);
      const kStatus = mapStatus(k.status);
      const pls = splitPlatforms(k.platform);
      for (const x of pls) if (isRealPlatform(x)) pushUnique(platforms, x);
      let bTitle = clean(k.name);
      if (!bTitle) { bTitle = `(untitled booking ${k.gid})`; bump('untitled bookings'); }

      bookings.push({
        gid: k.gid,
        parentGid: p.gid,
        position,
        title: bTitle,
        createdAt: isoDate(k.createdAt),
        completedAt: isoDate(k.completedAt),
        dueDate: isoDate(k.dueDate),
        status: kStatus,
        vendorKey: v.key,
        vendorFold: fold(v.name),
        price,
        net,
        platform: pls.length ? pls.join(', ') : null,
        adType: kAd.adType,
        quotationNo: clean(k.quotationNo) || null,
        invoiceNo: clean(k.invoiceNo) || null,
        vendorPayment: mapPayment(k.netPayment),
        vendorPaymentDate: isoDate(k.netPaymentDate),
        lineStatus: mapLineStatus(k.status),
        assigneeEmail: clean(k.assigneeEmail).toLowerCase() || null,
        description: describe([
          ['Tags', clean(k.tags)],
          ['Links', clean(k.links)],
          ['Notes', clean(k.notes)],
        ]),
      });
      bump('bookings');
    });
  }

  return {
    clients: [...clients.values()],
    vendors: [...vendors.values()],
    campaigns,
    bookings,
    lookups: { clientCategories, platforms, sources },
    warnings,
    stats,
  };
}

// -----------------------------------------------------------------
// SQL
// -----------------------------------------------------------------

export function lit(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  return "'" + v.replace(/'/g, "''") + "'";
}

export function arr(v: string[]): string {
  if (!v.length) return "'{}'::text[]";
  return 'array[' + v.map((x) => lit(x)).join(',') + ']::text[]';
}

export interface SqlFile { name: string; sql: string }

export interface RenderOptions {
  /** Force a workspace instead of requiring exactly one to exist. */
  workspaceId?: string | null;
  /** Rows per booking / ad-line file. The SQL editor copes with ~1,500. */
  chunk?: number;
  /** A tag written into the description so a later wipe can be scoped. */
  projectName?: string;
}

/**
 * Every file is self-contained: it opens a transaction, builds the same
 * temp helpers, does its work, prints a summary row, commits. Run them in
 * name order. Re-running any of them is safe.
 */
export function renderSql(plan: Plan, opts: RenderOptions = {}): SqlFile[] {
  const chunk = Math.max(100, opts.chunk ?? 1500);
  const files: SqlFile[] = [];

  files.push({ name: '01_registries.sql', sql: renderRegistries(plan, opts) });
  files.push({ name: '02_campaigns.sql', sql: renderCampaigns(plan, opts) });

  const bChunks = chunks(plan.bookings, chunk);
  bChunks.forEach((rows, i) => {
    files.push({ name: `03_bookings_${pad(i + 1)}_of_${pad(bChunks.length)}.sql`, sql: renderBookings(rows, opts) });
  });
  bChunks.forEach((rows, i) => {
    files.push({ name: `04_ad_lines_${pad(i + 1)}_of_${pad(bChunks.length)}.sql`, sql: renderAdLines(rows, opts) });
  });
  files.push({ name: '99_wipe.sql', sql: renderWipe(opts) });
  return files;
}

function pad(n: number): string { return String(n).padStart(2, '0'); }

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
}

/** Shared preamble: transaction, workspace, helpers. */
function preamble(opts: RenderOptions, title: string): string {
  const ws = opts.workspaceId
    ? `select ${lit(opts.workspaceId)}::uuid as ws, w.owner_id as uid from public.workspaces w where w.id = ${lit(opts.workspaceId)}::uuid`
    : `select w.id as ws, w.owner_id as uid from public.workspaces w order by w.created_at limit 1`;
  return `-- ${title}
-- Generated by scripts/asana-import.mjs from lib/asana-import.ts.
-- Safe to re-run: every write is keyed on asana_gid / import_key.
-- Requires migration 077_asana_import_keys.sql.
begin;

create temp table ctx on commit drop as ${ws};

do $chk$
begin
  if (select count(*) from ctx) <> 1 then
    raise exception 'Could not pick a workspace (% found). Re-generate with --workspace <uuid>.',
      (select count(*) from public.workspaces);
  end if;
${opts.workspaceId ? '' : `  if (select count(*) from public.workspaces) <> 1 then
    raise exception 'There are % workspaces; re-generate with --workspace <uuid> to say which.',
      (select count(*) from public.workspaces);
  end if;
`}end $chk$;

-- Case- and punctuation-insensitive key for matching names. Mirrors fold()
-- in lib/asana-import.ts.
create or replace function pg_temp._fold(t text) returns text language sql immutable as $f$
  select trim(regexp_replace(lower(replace(coalesce(t,''), chr(160), ' ')), '[[:space:]_.,()-]+', ' ', 'g'))
$f$;

-- A client by import key, else by folded name (a row that already existed,
-- e.g. from Zoho). Oldest wins when several match.
create or replace function pg_temp._client(k text, f text) returns uuid language sql stable as $f$
  select coalesce(
    (select c.id from public.clients c, ctx where c.workspace_id = ctx.ws and c.import_key = k limit 1),
    (select c.id from public.clients c, ctx where c.workspace_id = ctx.ws and pg_temp._fold(c.company_name) = f
       order by c.created_at nulls last, c.id limit 1))
$f$;

create or replace function pg_temp._vendor(k text, f text) returns bigint language sql stable as $f$
  select coalesce(
    (select v.id from public.vendors v where v.import_key = k limit 1),
    (select v.id from public.vendors v where pg_temp._fold(v.name) = f order by v.id limit 1))
$f$;

create or replace function pg_temp._profile(f text) returns uuid language sql stable as $f$
  select p.id from public.profiles p, ctx
   where pg_temp._fold(p.full_name) = f
     and exists (select 1 from public.workspace_members m where m.workspace_id = ctx.ws and m.user_id = p.id)
   order by p.created_at nulls last limit 1
$f$;

-- First name only ("Khulood"): one match or nothing.
create or replace function pg_temp._profile_prefix(f text) returns uuid language sql stable as $f$
  select case when count(*) = 1 then (array_agg(p.id))[1] end
    from public.profiles p, ctx
   where f <> '' and pg_temp._fold(p.full_name) like pg_temp._fold(f) || '%'
     and exists (select 1 from public.workspace_members m where m.workspace_id = ctx.ws and m.user_id = p.id)
$f$;

create or replace function pg_temp._user_by_email(e text) returns uuid language sql stable as $f$
  select u.id from auth.users u, ctx
   where e is not null and lower(u.email) = lower(e)
     and exists (select 1 from public.workspace_members m where m.workspace_id = ctx.ws and m.user_id = u.id)
   limit 1
$f$;

create or replace function pg_temp._lookup(tbl text, nm text) returns uuid language plpgsql stable as $f$
declare r uuid;
begin
  if nm is null or nm = '' then return null; end if;
  execute format('select id from public.%I t, ctx where t.workspace_id = ctx.ws and lower(t.name) = lower($1) limit 1', tbl)
    into r using nm;
  return r;
end $f$;

-- First candidate that exists as a service type wins; else create the first.
create or replace function pg_temp._service_type(cands text[]) returns uuid language plpgsql as $f$
declare c text; r uuid;
begin
  if cands is null or array_length(cands, 1) is null then return null; end if;
  foreach c in array cands loop
    select id into r from public.service_types s, ctx where s.workspace_id = ctx.ws and lower(s.name) = lower(c) limit 1;
    if r is not null then return r; end if;
  end loop;
  insert into public.service_types (workspace_id, name, position)
    select ctx.ws, cands[1], coalesce((select max(position) from public.service_types s where s.workspace_id = ctx.ws), 0) + 1 from ctx
    returning id into r;
  return r;
end $f$;
`;
}

function renderRegistries(plan: Plan, opts: RenderOptions): string {
  const out: string[] = [preamble(opts, 'Asana import 1/4 - lookups, clients, brands, vendors')];

  out.push(`
-- -- Lookups -----------------------------------------------------`);
  for (const name of plan.lookups.clientCategories) {
    out.push(`insert into public.client_categories (workspace_id, name, position)
  select ctx.ws, ${lit(name)}, coalesce((select max(position) from public.client_categories x where x.workspace_id = ctx.ws), 0) + 1 from ctx
  where not exists (select 1 from public.client_categories x, ctx where x.workspace_id = ctx.ws and lower(x.name) = lower(${lit(name)}));`);
  }
  for (const name of plan.lookups.sources) {
    out.push(`insert into public.task_sources (workspace_id, name, position)
  select ctx.ws, ${lit(name)}, coalesce((select max(position) from public.task_sources x where x.workspace_id = ctx.ws), 0) + 1 from ctx
  where not exists (select 1 from public.task_sources x, ctx where x.workspace_id = ctx.ws and lower(x.name) = lower(${lit(name)}));`);
  }
  for (const name of plan.lookups.platforms) {
    out.push(`insert into public.task_platforms (workspace_id, name, position)
  select ctx.ws, ${lit(name)}, coalesce((select max(position) from public.task_platforms x where x.workspace_id = ctx.ws), 0) + 1 from ctx
  where not exists (select 1 from public.task_platforms x, ctx where x.workspace_id = ctx.ws and lower(x.name) = lower(${lit(name)}));`);
  }

  out.push(`
-- -- Clients -----------------------------------------------------
-- A client whose folded name already exists (Zoho, hand-added) is reused
-- and left untouched. Only genuinely new ones are inserted, and they carry
-- import_key so 99_wipe.sql can find them.
create temp table asana_clients (
  key text primary key, name text, contact_name text, contact_phone text, contact_email text, category text
) on commit drop;
insert into asana_clients values`);
  out.push(plan.clients.map((c) =>
    `  (${lit(c.key)}, ${lit(c.name)}, ${lit(c.contactName)}, ${lit(c.contactPhone)}, ${lit(c.contactEmail)}, ${lit(c.category)})`,
  ).join(',\n') + ';');
  out.push(`
insert into public.clients (workspace_id, company_name, contact_name, contact_phone, contact_email, signatory_name, client_category_id, status, import_key)
select ctx.ws, a.name, a.contact_name, a.contact_phone, a.contact_email, coalesce(a.contact_name, ''),
       pg_temp._lookup('client_categories', a.category), 'active', a.key
  from asana_clients a, ctx
 where pg_temp._client(a.key, pg_temp._fold(a.name)) is null;

-- Fill a blank category on a matched client from Asana; never overwrite one.
update public.clients c
   set client_category_id = pg_temp._lookup('client_categories', a.category)
  from asana_clients a
 where c.id = pg_temp._client(a.key, pg_temp._fold(a.name))
   and c.client_category_id is null and a.category is not null;

-- -- Brands ------------------------------------------------------
create temp table asana_brands (client_key text, client_name text, brand text) on commit drop;
insert into asana_brands values`);
  const brandRows: string[] = [];
  for (const c of plan.clients) for (const b of c.brands) brandRows.push(`  (${lit(c.key)}, ${lit(c.name)}, ${lit(b)})`);
  out.push((brandRows.length ? brandRows.join(',\n') : "  (null, null, null)") + ';');
  out.push(`
insert into public.client_brands (client_id, brand_name, status)
select pg_temp._client(b.client_key, pg_temp._fold(b.client_name)), b.brand, 'active'
  from asana_brands b
 where b.brand is not null
   and pg_temp._client(b.client_key, pg_temp._fold(b.client_name)) is not null
   and not exists (
     select 1 from public.client_brands x
      where x.client_id = pg_temp._client(b.client_key, pg_temp._fold(b.client_name))
        and lower(x.brand_name) = lower(b.brand));

-- -- Vendors -----------------------------------------------------
-- Same rule: an existing registry row with the same folded name is reused.
create temp table asana_vendors (key text primary key, name text, category text, category_key text, bookings int) on commit drop;
insert into asana_vendors values`);
  out.push(plan.vendors.map((v) =>
    `  (${lit(v.key)}, ${lit(v.name)}, ${lit(v.category)}, ${lit(v.categoryKey)}, ${v.bookings})`,
  ).join(',\n') + ';');
  out.push(`
insert into public.vendors (name, vendor_category, category_id, created_at, import_key)
select a.name, coalesce(a.category, ''),
       (select id from public.vendor_categories vc where vc.key = a.category_key limit 1),
       now()::text, a.key
  from asana_vendors a
 where pg_temp._vendor(a.key, pg_temp._fold(a.name)) is null;

-- -- Summary -----------------------------------------------------
select 'clients' as what,
       (select count(*) from asana_clients) as in_file,
       (select count(*) from public.clients c, ctx where c.workspace_id = ctx.ws and c.import_key like 'asana:%') as created_by_import,
       (select count(*) from asana_clients a where (select import_key from public.clients c where c.id = pg_temp._client(a.key, pg_temp._fold(a.name))) is null) as matched_existing
union all
select 'vendors',
       (select count(*) from asana_vendors),
       (select count(*) from public.vendors v where v.import_key like 'asana:%'),
       (select count(*) from asana_vendors a where (select import_key from public.vendors v where v.id = pg_temp._vendor(a.key, pg_temp._fold(a.name))) is null)
union all
select 'brands', (select count(*) from asana_brands where brand is not null), (select count(*) from public.client_brands), null;

commit;
`);
  return out.join('\n');
}

function renderCampaigns(plan: Plan, opts: RenderOptions): string {
  const out: string[] = [preamble(opts, 'Asana import 2/4 - campaigns (parent tasks)')];
  out.push(`
create temp table asana_campaigns (
  gid text primary key, title text, created_at date, completed_at date, due_date date,
  status text, stage text, service_types text[], sales_name text, sales_inf boolean, source text,
  client_key text, client_fold text, brand text, platforms text[], ad_type text, ad_type_custom text,
  approval text, budget numeric, quotation_numbers text[], invoice_numbers text[],
  client_payment text, client_payment_date date, client_payment_amount numeric, net_payment_date date,
  contract text, kam text, assignee_email text, description text
) on commit drop;
insert into asana_campaigns values`);
  out.push(plan.campaigns.map((c) => '  (' + [
    lit(c.gid), lit(c.title), lit(c.createdAt), lit(c.completedAt), lit(c.dueDate),
    lit(c.status), lit(c.stage), arr(c.serviceTypes), lit(c.salesName), c.salesInfluencer ? 'true' : 'false', lit(c.source),
    lit(c.clientKey), lit(c.clientFold), lit(c.brandName), arr(c.platforms), lit(c.adType), lit(c.adTypeCustom),
    lit(c.approval), lit(c.budget), arr(c.quotationNumbers), arr(c.invoiceNumbers),
    lit(c.clientPayment), lit(c.clientPaymentDate), lit(c.clientPaymentAmount), lit(c.netPaymentDate),
    lit(c.contract), lit(c.kam), lit(c.assigneeEmail), lit(c.description),
  ].join(', ') + ')').join(',\n') + ';');

  out.push(`
insert into public.pm_tasks (
  workspace_id, creator_id, asana_gid, title, task_name, description,
  status, stage, priority, created_at, completed_at, due_date,
  sales_closer_id, sales_closer_influencer, source_id,
  client_id, client_category_id, brand_id, brand_name,
  platforms, ad_type, ad_type_custom, approval_stage, budget,
  quotation_numbers, invoice_numbers, quotation_no, invoice_no,
  client_payment_status, client_payment_date, client_payment_amount, net_payment_date,
  contract_status, key_account_id, assignee_id, request_status, position
)
select
  ctx.ws, ctx.uid, a.gid, a.title, a.title, a.description,
  a.status::public.task_status, a.stage::public.task_stage, 'none'::public.task_priority, a.created_at, a.completed_at, a.due_date,
  case when a.sales_inf then null else pg_temp._profile(pg_temp._fold(a.sales_name)) end,
  a.sales_inf,
  pg_temp._lookup('task_sources', a.source),
  cl.id, cl.client_category_id,
  (select b.id from public.client_brands b where b.client_id = cl.id and lower(b.brand_name) = lower(a.brand) order by b.created_at limit 1),
  a.brand,
  a.platforms, a.ad_type, a.ad_type_custom, a.approval, a.budget,
  a.quotation_numbers, a.invoice_numbers, a.quotation_numbers[1], a.invoice_numbers[1],
  a.client_payment, a.client_payment_date, a.client_payment_amount, a.net_payment_date,
  a.contract, pg_temp._profile_prefix(a.kam), pg_temp._user_by_email(a.assignee_email), 'not_requested', 0
from asana_campaigns a
cross join ctx
left join public.clients cl on cl.id = pg_temp._client(a.client_key, a.client_fold)
on conflict (workspace_id, asana_gid) where asana_gid is not null do update set
  title = excluded.title, task_name = excluded.task_name, description = excluded.description,
  status = excluded.status, stage = excluded.stage, completed_at = excluded.completed_at, due_date = excluded.due_date,
  sales_closer_id = excluded.sales_closer_id, sales_closer_influencer = excluded.sales_closer_influencer, source_id = excluded.source_id,
  client_id = excluded.client_id, client_category_id = excluded.client_category_id, brand_id = excluded.brand_id, brand_name = excluded.brand_name,
  platforms = excluded.platforms, ad_type = excluded.ad_type, ad_type_custom = excluded.ad_type_custom, approval_stage = excluded.approval_stage, budget = excluded.budget,
  quotation_numbers = excluded.quotation_numbers, invoice_numbers = excluded.invoice_numbers, quotation_no = excluded.quotation_no, invoice_no = excluded.invoice_no,
  client_payment_status = excluded.client_payment_status, client_payment_date = excluded.client_payment_date, client_payment_amount = excluded.client_payment_amount, net_payment_date = excluded.net_payment_date,
  contract_status = excluded.contract_status, key_account_id = excluded.key_account_id, assignee_id = excluded.assignee_id,
  deleted_at = null, deleted_by = null;

-- Service type (Department Ctg.) - the junction and the legacy column.
insert into public.task_service_types (task_id, service_type_id, position)
select t.id, pg_temp._service_type(a.service_types), 0
  from asana_campaigns a
  join public.pm_tasks t on t.asana_gid = a.gid
  cross join ctx
 where t.workspace_id = ctx.ws
   and pg_temp._service_type(a.service_types) is not null
on conflict do nothing;

update public.pm_tasks t
   set service_type_id = (select service_type_id from public.task_service_types s where s.task_id = t.id order by position limit 1)
  from asana_campaigns a, ctx
 where t.asana_gid = a.gid and t.workspace_id = ctx.ws and t.service_type_id is null;

-- -- Summary -----------------------------------------------------
select 'campaigns' as what,
       (select count(*) from asana_campaigns) as in_file,
       (select count(*) from public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.parent_task_id is null and t.asana_gid is not null) as in_db,
       (select count(*) from public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid is not null and t.parent_task_id is null and t.client_id is null) as without_client,
       (select count(*) from public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid is not null and t.parent_task_id is null and t.sales_closer_id is null and not t.sales_closer_influencer) as without_sales_closer;

commit;
`);
  return out.join('\n');
}

function renderBookings(rows: PlanBooking[], opts: RenderOptions): string {
  const out: string[] = [preamble(opts, 'Asana import 3/4 - vendor bookings (subtasks)')];
  out.push(`
create temp table asana_bookings (
  gid text primary key, parent_gid text, position int, title text, created_at date, completed_at date, due_date date,
  status text, vendor_key text, vendor_fold text, price numeric, net numeric, platform text, ad_type text,
  quotation_no text, invoice_no text, vendor_payment text, vendor_payment_date date, assignee_email text, description text
) on commit drop;
insert into asana_bookings values`);
  out.push((rows.length ? rows.map((b) => '  (' + [
    lit(b.gid), lit(b.parentGid), b.position, lit(b.title), lit(b.createdAt), lit(b.completedAt), lit(b.dueDate),
    lit(b.status), lit(b.vendorKey), lit(b.vendorFold), lit(b.price), lit(b.net), lit(b.platform), lit(b.adType),
    lit(b.quotationNo), lit(b.invoiceNo), lit(b.vendorPayment), lit(b.vendorPaymentDate), lit(b.assigneeEmail), lit(b.description),
  ].join(', ') + ')').join(',\n') : '  (null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null)') + ';');

  out.push(`
do $chk$
declare missing int;
begin
  select count(*) into missing from asana_bookings b
   where b.gid is not null and not exists (select 1 from public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid = b.parent_gid);
  if missing > 0 then
    raise exception '% bookings name a campaign that is not in pm_tasks yet. Run 02_campaigns.sql first.', missing;
  end if;
end $chk$;

insert into public.pm_tasks (
  workspace_id, creator_id, asana_gid, parent_task_id, position, title, description,
  status, stage, priority, subtask_kind, request_status, created_at, completed_at, due_date,
  vendor_id, price, net_amount, platform, ad_type, quotation_no, invoice_no,
  vendor_payment_date, vendor_payment_amount, assignee_id
)
select
  ctx.ws, ctx.uid, b.gid, p.id, b.position, b.title, b.description,
  b.status::public.task_status, 'in_progress'::public.task_stage, 'none'::public.task_priority, 'vendor', 'not_requested', b.created_at, b.completed_at, b.due_date,
  pg_temp._vendor(b.vendor_key, b.vendor_fold), b.price, b.net, b.platform, b.ad_type, b.quotation_no, b.invoice_no,
  b.vendor_payment_date,
  case when b.vendor_payment = 'paid' then b.net else null end,
  pg_temp._user_by_email(b.assignee_email)
from asana_bookings b
cross join ctx
join public.pm_tasks p on p.workspace_id = ctx.ws and p.asana_gid = b.parent_gid
where b.gid is not null
on conflict (workspace_id, asana_gid) where asana_gid is not null do update set
  parent_task_id = excluded.parent_task_id, position = excluded.position, title = excluded.title, description = excluded.description,
  status = excluded.status, completed_at = excluded.completed_at, due_date = excluded.due_date,
  vendor_id = excluded.vendor_id, price = excluded.price, net_amount = excluded.net_amount, platform = excluded.platform, ad_type = excluded.ad_type,
  quotation_no = excluded.quotation_no, invoice_no = excluded.invoice_no,
  vendor_payment_date = excluded.vendor_payment_date, vendor_payment_amount = excluded.vendor_payment_amount, assignee_id = excluded.assignee_id,
  deleted_at = null, deleted_by = null;

select 'bookings (this file)' as what,
       (select count(*) from asana_bookings where gid is not null) as in_file,
       (select count(*) from asana_bookings b, public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid = b.gid) as in_db,
       (select count(*) from asana_bookings b, public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid = b.gid and t.vendor_id is null) as without_vendor;

commit;
`);
  return out.join('\n');
}

function renderAdLines(rows: PlanBooking[], opts: RenderOptions): string {
  const out: string[] = [preamble(opts, 'Asana import 4/4 - one ad line per booking')];
  out.push(`
create temp table asana_lines (
  booking_gid text primary key, ad_type text, platform text, unit_price numeric, net numeric, due_date date,
  status text, quotation_no text, net_payment_date date, net_payment_status text, posted_on date, notes text
) on commit drop;
insert into asana_lines values`);
  out.push((rows.length ? rows.map((b) => '  (' + [
    lit(b.gid), lit(b.adType ?? 'Unspecified'), lit(b.platform), lit(Math.max(0, b.price ?? 0)),
    lit(b.net !== null && b.net < 0 ? null : b.net), lit(b.dueDate),
    lit(b.lineStatus), lit(b.quotationNo), lit(b.vendorPaymentDate), lit(b.vendorPayment),
    lit(b.lineStatus === 'Posted' ? (b.completedAt ?? b.dueDate) : null),
    lit((b.price !== null && b.price < 0) || (b.net !== null && b.net < 0)
      ? `Discount row from Asana: price ${b.price ?? '-'}, net ${b.net ?? '-'}. The negative amount is on the booking, not this line.`
      : null),
  ].join(', ') + ')').join(',\n') : '  (null,null,null,null,null,null,null,null,null,null,null,null)') + ';');

  out.push(`
do $chk$
declare missing int;
begin
  select count(*) into missing from asana_lines l
   where l.booking_gid is not null and not exists (select 1 from public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid = l.booking_gid);
  if missing > 0 then
    raise exception '% ad lines belong to a booking that is not in pm_tasks yet. Run the 03_bookings files first.', missing;
  end if;
end $chk$;

insert into public.vendor_ad_lines (
  subtask_id, position, ad_type, platform, quantity, unit_price, net_amount, due_date, status,
  quotation_no, net_payment_date, net_payment_status, posted_on, notes, asana_gid
)
select t.id, 0, l.ad_type, l.platform, 1, coalesce(l.unit_price, 0), l.net, l.due_date, l.status,
       l.quotation_no, l.net_payment_date, l.net_payment_status, l.posted_on, l.notes, l.booking_gid || ':1'
  from asana_lines l
  cross join ctx
  join public.pm_tasks t on t.workspace_id = ctx.ws and t.asana_gid = l.booking_gid
 where l.booking_gid is not null
on conflict (asana_gid) where asana_gid is not null do update set
  subtask_id = excluded.subtask_id, ad_type = excluded.ad_type, platform = excluded.platform,
  unit_price = excluded.unit_price, net_amount = excluded.net_amount, due_date = excluded.due_date, status = excluded.status,
  quotation_no = excluded.quotation_no, net_payment_date = excluded.net_payment_date, net_payment_status = excluded.net_payment_status,
  posted_on = excluded.posted_on, notes = excluded.notes;

select 'ad lines (this file)' as what,
       (select count(*) from asana_lines where booking_gid is not null) as in_file,
       (select count(*) from asana_lines l, public.vendor_ad_lines x where x.asana_gid = l.booking_gid || ':1') as in_db;

commit;
`);
  return out.join('\n');
}

function renderWipe(opts: RenderOptions): string {
  return `-- Asana import - take it all out again.
-- Deletes only rows the import created (asana_gid / import_key set).
-- Clients and vendors that already existed and were merely matched are
-- left alone; so is anything a person has since attached to an imported
-- row from elsewhere (a brand still in use, a vendor with another booking).
begin;

create temp table ctx on commit drop as ${opts.workspaceId
    ? `select ${lit(opts.workspaceId)}::uuid as ws`
    : `select w.id as ws from public.workspaces w order by w.created_at limit 1`};

delete from public.vendor_ad_lines where asana_gid is not null;

-- Hard delete, not the recycle bin: these rows never existed in the app.
delete from public.pm_tasks t using ctx where t.workspace_id = ctx.ws and t.asana_gid is not null;

delete from public.client_brands b
 using public.clients c, ctx
 where b.client_id = c.id and c.workspace_id = ctx.ws and c.import_key like 'asana:%'
   and not exists (select 1 from public.pm_tasks t where t.brand_id = b.id);

delete from public.vendors v
 where v.import_key like 'asana:%'
   and not exists (select 1 from public.pm_tasks t where t.vendor_id = v.id or t.sales_closer_vendor_id = v.id);

delete from public.clients c using ctx
 where c.workspace_id = ctx.ws and c.import_key like 'asana:%'
   and not exists (select 1 from public.pm_tasks t where t.client_id = c.id);

select
  (select count(*) from public.pm_tasks t, ctx where t.workspace_id = ctx.ws and t.asana_gid is not null) as tasks_left,
  (select count(*) from public.vendor_ad_lines where asana_gid is not null) as lines_left,
  (select count(*) from public.clients c, ctx where c.workspace_id = ctx.ws and c.import_key like 'asana:%') as clients_left,
  (select count(*) from public.vendors where import_key like 'asana:%') as vendors_left;

commit;
`;
}

// -----------------------------------------------------------------
// Report
// -----------------------------------------------------------------

export function report(plan: Plan, read: ReadResult, fileName = 'export.csv'): string {
  const s = plan.stats;
  const n = (k: string) => s[k] ?? 0;
  const lines: string[] = [];
  lines.push(`# Asana import - dry run of ${fileName}`, '');
  lines.push(`- Campaigns: **${n('campaigns')}** (${n('untitled campaigns')} without a usable name, ${n('campaigns without client')} without a client, ${n('campaigns without brand')} without a brand)`);
  lines.push(`- Vendor bookings: **${n('bookings')}** -> one ad line each`);
  lines.push(`- Clients in file: **${plan.clients.length}** | brands: **${plan.clients.reduce((a, c) => a + c.brands.length, 0)}**`);
  lines.push(`- Vendors in file: **${plan.vendors.length}** (${plan.vendors.filter((v) => v.freeText).length} typed as free text; ${n('bookings with no vendor name')} bookings carry no name at all and go to a placeholder vendor)`);
  lines.push(`- Approval stages folded into *cancelled*: ${n('approval folded into cancelled')} | campaigns with several quotation numbers: ${n('campaigns with several quotation numbers')} | bookings where net > price: ${n('bookings where net exceeds price')}`);
  lines.push('', 'Lookups that will be created if missing:');
  lines.push(`- Client categories: ${plan.lookups.clientCategories.join(', ') || '-'}`);
  lines.push(`- Platforms: ${plan.lookups.platforms.join(', ') || '-'}`);
  lines.push(`- Sources: ${plan.lookups.sources.join(', ') || '-'}`);
  const sts = new Map<string, number>();
  for (const c of plan.campaigns) { const k = c.serviceTypes[0] ?? '(none)'; sts.set(k, (sts.get(k) ?? 0) + 1); }
  lines.push(`- Service types: ${[...sts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ')}`);
  if (read.missing.length) lines.push('', `Columns expected and not found: ${read.missing.join(', ')}`);
  if (read.ignored.length) lines.push('', `Columns in the file this import does not read: ${read.ignored.join(', ')}`);
  const top = plan.vendors.filter((v) => v.freeText).sort((a, b) => b.bookings - a.bookings).slice(0, 15);
  if (top.length) {
    lines.push('', 'Most-booked free-text vendors (check these against the registry by eye):');
    for (const v of top) lines.push(`- ${v.name} - ${v.bookings}`);
  }
  if (plan.warnings.length) {
    lines.push('', `## Warnings (${plan.warnings.length})`, '');
    for (const w of plan.warnings.slice(0, 60)) lines.push(`- ${w}`);
    if (plan.warnings.length > 60) lines.push(`- ... and ${plan.warnings.length - 60} more`);
  }
  return lines.join('\n') + '\n';
}
