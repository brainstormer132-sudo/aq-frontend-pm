/**
 * Clients and Vendors — the same screen twice, so one file.
 *
 * Both were a search box, an Add button, and a wall of cards at
 * `minmax(320px, 1fr)`. With 23 clients and 61 vendors that is eighty-odd
 * cards, each printing four fields nobody asked for — including, on the
 * vendor side, sixty-one IBANs at once. Neither could be sorted or filtered
 * by anything except free text.
 *
 * Siraj picked the register (Aug 2026): the same table as All Tasks and
 * Contracts, pointed at people.
 *
 * Everything that decides what a row says, where it sorts and what a filter
 * keeps lives here — pure, no React, no Supabase, no argless `new Date()`.
 */

/* ── Portal state ───────────────────────────────────────────────── */

export type PortalState = 'active' | 'invited' | 'none';

/**
 * The real state worth showing.
 *
 * The client cards used to carry a green badge reading "active" that flipped
 * to "open" when you expanded the card — UI state rendered as though it were
 * record state, on every row. What actually varies between one client and
 * the next is whether they can log in.
 */
export function portalState(invite: string | null | undefined): PortalState {
  const s = String(invite ?? '').trim().toLowerCase();
  if (s === 'accepted' || s === 'active') return 'active';
  if (s === 'invite_sent' || s === 'pending_invite' || s === 'invited') return 'invited';
  return 'none';
}

export function portalLabel(p: PortalState): string {
  return p === 'active' ? 'Portal active' : p === 'invited' ? 'Invite sent' : 'No portal';
}

/* ── A row ──────────────────────────────────────────────────────── */

export interface RegistryRow {
  id: string;
  name: string;
  /** Signatory for a client; category for a vendor. */
  who: string | null;
  /** CR number for a client; ID or licence number for a vendor. */
  ident: string | null;
  portal: PortalState;
  portalLabel: string;
  /** Campaigns for a client; bank accounts on file for a vendor. */
  count: number;
  /** Billed for a client; null on the vendor side, which has no such figure here. */
  value: number | null;
  /**
   * Fields that are empty and will therefore be empty in a contract.
   *
   * This is the thing neither screen said anything about: a client with no
   * VAT number generates contracts with no VAT number, and nobody finds out
   * until Legal reads one.
   */
  gaps: string[];
  raw: Record<string, unknown>;
}

function txt(v: unknown): string {
  return String(v ?? '').trim();
}

function money(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ── Clients ────────────────────────────────────────────────────── */

export interface ClientInput {
  id: string;
  company_name?: string | null;
  signatory_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  company_email?: string | null;
  contact_phone?: string | null;
  cr_number?: string | null;
  vat_number?: string | null;
  street?: string | null;
  city?: string | null;
  postcode?: string | null;
  country?: string | null;
  invite_status?: string | null;
  [k: string]: unknown;
}

/** A campaign, as much of one as this screen reads. */
export interface CampaignInput { id: string; client_id?: string | null }
/** One row of the rollup view the Dashboard already loads. */
export interface RollupInput { parent_task_id: string; sum_prices?: number | null }

/**
 * The four things that go into every contract and are quietly missing.
 *
 * The address counts as one gap, not four — a contract with no street is the
 * same problem as a contract with no city, and listing them separately turns
 * one omission into four rows of noise.
 */
export function clientGaps(c: ClientInput): string[] {
  const out: string[] = [];
  if (!txt(c.signatory_name)) out.push('signatory');
  if (!txt(c.vat_number)) out.push('VAT number');
  if (!txt(c.cr_number)) out.push('CR number');
  if (![c.street, c.city, c.postcode].some((v) => txt(v))) out.push('address');
  return out;
}

export function buildClients(input: {
  clients: ClientInput[];
  campaigns?: CampaignInput[];
  rollup?: RollupInput[];
}): RegistryRow[] {
  const sumByParent = new Map<string, number>();
  for (const r of input.rollup || []) sumByParent.set(r.parent_task_id, Number(r.sum_prices ?? 0));

  const perClient = new Map<string, { n: number; value: number }>();
  for (const t of input.campaigns || []) {
    const cid = txt(t.client_id);
    if (!cid) continue;
    const cur = perClient.get(cid) ?? { n: 0, value: 0 };
    cur.n += 1;
    cur.value += sumByParent.get(t.id) ?? 0;
    perClient.set(cid, cur);
  }

  return (input.clients || []).map((c) => {
    const agg = perClient.get(c.id) ?? { n: 0, value: 0 };
    const portal = portalState(c.invite_status);
    return {
      id: c.id,
      name: txt(c.company_name) || 'Unnamed client',
      who: txt(c.signatory_name) || null,
      ident: txt(c.cr_number) || null,
      portal,
      portalLabel: portalLabel(portal),
      count: agg.n,
      value: money(agg.value),
      gaps: clientGaps(c),
      raw: c as Record<string, unknown>,
    };
  });
}

/* ── Vendors ────────────────────────────────────────────────────── */

export interface VendorInput {
  id: number | string;
  name?: string | null;
  category_id?: string | null;
  vendor_category?: string | null;
  license_number?: string | null;
  id_number?: string | null;
  signatory_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
  invite_status?: string | null;
  [k: string]: unknown;
}

export interface BankInput {
  id?: number | string;
  vendor_id: number | string;
  bank_name?: string | null;
  iban?: string | null;
  account_name?: string | null;
}

export interface CategoryInput { id: string; label?: string | null; key?: string | null }

/**
 * A vendor with no bank account cannot be paid, and the contract goes out
 * with the payment block blank. That is worth a column of its own — on the
 * old screen the only way to find out was to read sixty-one cards.
 */
export function vendorGaps(v: VendorInput, banks: BankInput[]): string[] {
  const out: string[] = [];
  if (banks.length === 0) out.push('bank details');
  else if (!banks.some((b) => txt(b.iban))) out.push('IBAN');
  if (!txt(v.signatory_name)) out.push('signatory');
  if (!txt(v.id_number) && !txt(v.license_number)) out.push('ID or licence');
  return out;
}

export function buildVendors(input: {
  vendors: VendorInput[];
  banks?: BankInput[];
  categories?: CategoryInput[];
}): RegistryRow[] {
  const byVendor = new Map<string, BankInput[]>();
  for (const b of input.banks || []) {
    const k = String(b.vendor_id);
    byVendor.set(k, [...(byVendor.get(k) ?? []), b]);
  }
  const catById = new Map((input.categories || []).map((c) => [c.id, txt(c.label) || txt(c.key)]));

  return (input.vendors || []).map((v) => {
    const key = String(v.id);
    const banks = byVendor.get(key) ?? [];
    const portal = portalState(v.invite_status);
    return {
      id: key,
      name: txt(v.name) || 'Unnamed vendor',
      // The free-text `vendor_category` is legacy and read-only; the lookup
      // wins where there is one.
      who: (v.category_id ? catById.get(v.category_id) : null) || txt(v.vendor_category) || null,
      ident: txt(v.id_number) || txt(v.license_number) || null,
      portal,
      portalLabel: portalLabel(portal),
      count: banks.length,
      value: null,
      gaps: vendorGaps(v, banks),
      raw: v as Record<string, unknown>,
    };
  });
}

/* ── Sorting ────────────────────────────────────────────────────── */

export type SortKey = 'name' | 'who' | 'ident' | 'portal' | 'count' | 'value' | 'gaps';
export type SortDir = 'asc' | 'desc';
export interface Sort { key: SortKey; dir: SortDir }

const PORTAL_ORDER: PortalState[] = ['none', 'invited', 'active'];

/** Busiest first. Alphabetical is only useful once you know the name. */
export const DEFAULT_SORT: Sort = { key: 'count', dir: 'desc' };

export function firstDir(key: SortKey): SortDir {
  // Names read A→Z. Portal reads worst-first — clicking it means "who still
  // cannot log in", and PORTAL_ORDER puts `none` at the ascending end.
  // The counting columns open at the most: the most work, the most money,
  // the most missing.
  if (key === 'name' || key === 'who' || key === 'ident' || key === 'portal') return 'asc';
  return 'desc';
}

export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: firstDir(key) };
  return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
}

function cmpText(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;          // blanks sink either way
  if (!b) return -1;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

export function sortRows(rows: RegistryRow[], sort: Sort): RegistryRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const blank = (r: RegistryRow) => {
    if (sort.key === 'who') return !r.who;
    if (sort.key === 'ident') return !r.ident;
    if (sort.key === 'value') return r.value == null;
    return false;
  };

  return [...rows].sort((a, b) => {
    const ba = blank(a), bb = blank(b);
    if (ba !== bb) return ba ? 1 : -1;

    let c = 0;
    switch (sort.key) {
      case 'name':   c = cmpText(a.name, b.name); break;
      case 'who':    c = cmpText(a.who, b.who); break;
      case 'ident':  c = cmpText(a.ident, b.ident); break;
      case 'portal': c = PORTAL_ORDER.indexOf(a.portal) - PORTAL_ORDER.indexOf(b.portal); break;
      case 'count':  c = a.count - b.count; break;
      case 'value':  c = (a.value ?? 0) - (b.value ?? 0); break;
      case 'gaps':   c = a.gaps.length - b.gaps.length; break;
    }
    if (c !== 0) return c * dir;
    return cmpText(a.name, b.name);
  });
}

/* ── Filtering ──────────────────────────────────────────────────── */

export interface Filter {
  query: string;
  /** Only rows nobody can log in as. */
  noPortal: boolean;
  /** Only rows with something missing that a contract needs. */
  withGaps: boolean;
  /** Vendors: narrow to one category. Ignored on the client side. */
  category: string | null;
  /** Clients: only ones with no campaigns at all. */
  noWork: boolean;
}

export const EMPTY_FILTER: Filter = {
  query: '', noPortal: false, withGaps: false, category: null, noWork: false,
};

/**
 * Everything a row can be found by.
 *
 * Deliberately wide, and deliberately including the bank fields on the vendor
 * side: finance search this screen by IBAN when a payment bounces, which is
 * the one good reason the IBAN was ever on the card.
 */
function haystack(r: RegistryRow, extra: string[]): string {
  const q = r.raw;
  return [
    r.name, r.who, r.ident, r.portalLabel,
    q.vat_number, q.contact_email, q.company_email, q.contact_name,
    q.email, q.phone, q.contact_phone, q.city, q.signatory_name,
    q.license_number, q.id_number,
    ...extra,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function filterRows(
  rows: RegistryRow[],
  filter: Filter,
  extraText: (r: RegistryRow) => string[] = () => [],
): RegistryRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter.noPortal && r.portal !== 'none') return false;
    if (filter.withGaps && r.gaps.length === 0) return false;
    if (filter.noWork && r.count > 0) return false;
    if (filter.category && r.who !== filter.category) return false;
    if (!q) return true;
    return haystack(r, extraText(r)).includes(q);
  });
}

export function isFiltered(f: Filter): boolean {
  return Boolean(f.query.trim() || f.noPortal || f.withGaps || f.category || f.noWork);
}

/* ── What the header says ───────────────────────────────────────── */

export interface Summary {
  shown: number;
  total: number;
  noPortal: number;
  withGaps: number;
  value: number;
}

export function summarise(all: RegistryRow[], shown: RegistryRow[]): Summary {
  let noPortal = 0, withGaps = 0, value = 0;
  for (const r of all) {
    if (r.portal === 'none') noPortal += 1;
    if (r.gaps.length) withGaps += 1;
    if (r.value != null) value += r.value;
  }
  return { shown: shown.length, total: all.length, noPortal, withGaps, value };
}

export function money$(v: number | null): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function summaryLine(s: Summary, noun: string): string {
  const parts: string[] = [];
  parts.push(s.shown === s.total
    ? `${s.total} ${noun}${s.total === 1 ? '' : 's'}`
    : `${s.shown} of ${s.total} ${noun}s`);
  if (s.value > 0) parts.push(`SAR ${money$(s.value)} billed`);
  if (s.withGaps > 0) parts.push(`${s.withGaps} missing contract details`);
  if (s.noPortal > 0) parts.push(`${s.noPortal} without a portal`);
  return parts.join(' · ');
}

export function emptyMessage(f: Filter, total: number, noun: string): string {
  if (total === 0) return `No ${noun}s yet. Add the first one and their campaigns can start.`;
  if (f.query.trim()) return `Nothing matches “${f.query.trim()}”.`;
  if (f.withGaps) return `Every ${noun} has the details a contract needs. Good.`;
  if (f.noPortal) return `Every ${noun} can log in.`;
  if (f.noWork) return 'Everybody here has had work.';
  if (f.category) return `No ${noun}s in ${f.category}.`;
  return `No ${noun}s match these filters.`;
}

/** The line under a row that has something missing. */
export function gapLine(gaps: string[]): string {
  if (gaps.length === 0) return '';
  const list = gaps.length === 1
    ? gaps[0]
    : `${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]}`;
  return `No ${list} — blank in every contract.`;
}

/* ── Deleting ───────────────────────────────────────────────────── */

/**
 * The question that was never asked.
 *
 * `clientOps.remove` and `vendorOps.remove` both fired straight from a
 * button, with no confirmation on either screen.
 */
export function deleteWarning(row: RegistryRow | null, noun: string): string {
  if (!row) return '';
  const worked = row.count > 0 && noun === 'client'
    ? ` They have ${row.count} campaign${row.count === 1 ? '' : 's'} on record.`
    : '';
  return `Delete “${row.name}” permanently?${worked} This cannot be undone.`;
}

export function deletedMessage(name: string): string {
  return `Deleted “${name}”.`;
}

/**
 * The Zoho reset, said out loud.
 *
 * It used to be Ctrl/Cmd + click on the ordinary Import button, documented
 * only in that button's `title` tooltip — and Cmd-click is what a Mac user
 * does to open something in a new tab. It is its own named control now, and
 * it asks.
 */
export function resetWarning(count: number): string {
  return `Delete all ${count} client${count === 1 ? '' : 's'} and re-import them from Zoho? `
    + 'Everything not in Zoho is lost, including anything added by hand. This cannot be undone.';
}

/* ── The columns ────────────────────────────────────────────────── */

export interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
}

export const CLIENT_COLUMNS: Column[] = [
  { key: 'name',   label: 'Client',       align: 'left' },
  { key: 'who',    label: 'Signatory',    align: 'left' },
  { key: 'ident',  label: 'CR',           align: 'left' },
  { key: 'portal', label: 'Portal',       align: 'left' },
  { key: 'count',  label: 'Campaigns',    align: 'right' },
  { key: 'value',  label: 'Billed (SAR)', align: 'right' },
];

export const VENDOR_COLUMNS: Column[] = [
  { key: 'name',   label: 'Vendor',        align: 'left' },
  { key: 'who',    label: 'Category',      align: 'left' },
  { key: 'ident',  label: 'ID or licence', align: 'left' },
  { key: 'portal', label: 'Portal',        align: 'left' },
  { key: 'count',  label: 'Bank accounts', align: 'right' },
];

export function sortHint(col: Column, sort: Sort): string {
  if (sort.key !== col.key) return `Sort by ${col.label.toLowerCase()}`;
  return sort.dir === 'asc' ? 'Sorted ascending' : 'Sorted descending';
}
