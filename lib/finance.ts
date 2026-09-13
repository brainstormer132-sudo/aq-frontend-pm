/**
 * Finance view logic, pure. No React, no Supabase.
 *
 * Joins the campaign rollup to the finance_documents rows so the Finance screen
 * can show, per campaign: its value, the latest quotation (number + status), and
 * the one action that campaign is asking for -- generate the first quotation, or
 * re-quote (re-issue) an existing one.
 *
 * "Latest quotation" ignores voided rows: a quotation that was thrown away is
 * not the current one. A rejected quotation IS the current one -- the client
 * said no and finance has to decide what to do next, so it must stay visible.
 */

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseFloat(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export type QuotationStatus =
  | 'draft' | 'generated' | 'sent' | 'accepted' | 'rejected' | 'void';

export interface FinanceDocLite {
  id: string;
  pm_task_id: string;
  kind: string;                 // 'quotation' | 'invoice'
  document_number?: string | null;
  status?: string | null;
  amount?: number | string | null;
  created_at?: string | null;
}

export interface CampaignLite {
  parent_task_id: string;
  title?: string | null;
  brand_name?: string | null;
  parent_total_amount?: number | null;
  sum_prices?: number | null;
  client_payment_status?: string | null;
}

export interface QuotationSummary {
  id: string;
  number: string;
  status: string;
  amount: number;
}

export interface FinanceRow {
  taskId: string;
  title: string;
  brand: string;
  amount: number;
  quotation: QuotationSummary | null;
  /** What this campaign is asking finance to do next. */
  actionLabel: 'Generate quotation' | 'Re-quote';
}

/** Human label for a quotation status. */
export function statusLabel(status: unknown): string {
  switch (txt(status).toLowerCase()) {
    case 'generated': return 'Generated';
    case 'sent':      return 'Sent to client';
    case 'accepted':  return 'Accepted';
    case 'rejected':  return 'Rejected';
    case 'void':      return 'Void';
    case 'draft':     return 'Draft';
    default:          return txt(status) || '-';
  }
}

/** The aq-badge modifier for a status, matching the app's badge palette. */
export function statusBadge(status: unknown): string {
  switch (txt(status).toLowerCase()) {
    case 'accepted':  return 'aq-badge-success';
    case 'rejected':  return 'aq-badge-error';
    case 'sent':      return 'aq-badge-info';
    case 'void':      return 'aq-badge-muted';
    default:          return 'aq-badge-warning'; // generated / draft: awaiting
  }
}

function createdMs(v: unknown): number {
  const t = Date.parse(txt(v));
  return Number.isFinite(t) ? t : 0;
}

/**
 * The current quotation for a campaign: the newest non-void 'quotation' doc.
 * Returns null if there is none (voided-only counts as none).
 */
export function latestQuotation(docs: FinanceDocLite[]): FinanceDocLite | null {
  const live = (docs ?? []).filter(
    (d) => txt(d.kind).toLowerCase() === 'quotation' && txt(d.status).toLowerCase() !== 'void',
  );
  if (!live.length) return null;
  return live.reduce((best, d) => (createdMs(d.created_at) >= createdMs(best.created_at) ? d : best));
}

function summarise(doc: FinanceDocLite | null): QuotationSummary | null {
  if (!doc) return null;
  return {
    id: txt(doc.id),
    number: txt(doc.document_number) || '(no number)',
    status: txt(doc.status).toLowerCase(),
    amount: num(doc.amount),
  };
}

/**
 * Build the Finance screen rows. Campaigns that still need a first quotation
 * sort to the top (that is the work), then rejected ones (a decision is owed),
 * then the rest by value, biggest first.
 */
export function financeRows(campaigns: CampaignLite[], docs: FinanceDocLite[]): FinanceRow[] {
  const byTask = new Map<string, FinanceDocLite[]>();
  for (const d of docs ?? []) {
    const k = txt(d.pm_task_id);
    if (!k) continue;
    (byTask.get(k) ?? byTask.set(k, []).get(k)!).push(d);
  }

  const rows: FinanceRow[] = (campaigns ?? []).map((c): FinanceRow => {
    const taskId = txt(c.parent_task_id);
    const q = summarise(latestQuotation(byTask.get(taskId) ?? []));
    const amount = num(c.parent_total_amount) || num(c.sum_prices);
    return {
      taskId,
      title: txt(c.title) || txt(c.brand_name) || 'Untitled campaign',
      brand: txt(c.brand_name),
      amount,
      quotation: q,
      actionLabel: q ? 'Re-quote' : 'Generate quotation',
    };
  }).filter((r) => r.taskId);

  const rank = (r: FinanceRow): number => {
    if (!r.quotation) return 0;                          // needs a quotation
    if (r.quotation.status === 'rejected') return 1;     // decision owed
    return 2;                                            // settled-ish
  };
  return rows.sort((a, b) => rank(a) - rank(b) || b.amount - a.amount
    || a.title.localeCompare(b.title));
}

// -----------------------------------------------------------------
// Finance menu: tabs keyed on Asana tags, and paging
// -----------------------------------------------------------------
//
// Finance opens on "All" (every campaign, like the old screen) and then has a
// tab per Asana tag. A tag tab shows only campaigns carrying that tag
// (pm_tasks.tags, imported from Asana); "All" shows everything, so the screen
// is never mysteriously empty before anything is tagged. Tags are matched
// case-insensitively and with a leading '#' ignored.

export type FinanceTabKey = 'all' | 'quotation' | 'requotation' | 'invoice' | 'transaction';

export interface FinanceTab {
  key: FinanceTabKey;
  /** The Asana tag a campaign must carry; empty means "no filter" (All). */
  tag: string;
  label: string;
  blurb: string;
}

/** The finance tabs, in order. All first, then one per Asana tag Siraj uses. */
export const FINANCE_TABS: FinanceTab[] = [
  { key: 'all',         tag: '',            label: 'All',          blurb: 'Every campaign.' },
  { key: 'quotation',   tag: 'quotation',   label: 'Quotation',    blurb: 'Client wants a quotation - generate it.' },
  { key: 'requotation', tag: 'requotation', label: 'Re-quotation', blurb: 'A new quotation was asked for - re-issue it.' },
  { key: 'invoice',     tag: 'invoice',     label: 'Invoice',      blurb: 'Ready to invoice.' },
  { key: 'transaction', tag: 'transaction', label: 'Transaction',  blurb: 'Record the client payment.' },
];

/** Lowercase, trim, and drop a leading '#'. "#Quotation " -> "quotation". */
export function normalizeTag(tag: unknown): string {
  return txt(tag).toLowerCase().replace(/^#+/, '').trim();
}

/** True when the tag list contains the wanted tag (case- and #-insensitive). */
export function hasTag(tags: string[] | null | undefined, wanted: string): boolean {
  const w = normalizeTag(wanted);
  if (!w) return false;
  return (tags ?? []).some((t) => normalizeTag(t) === w);
}

function tagsOf(
  tagsByTask: Record<string, string[]> | Map<string, string[]>,
  id: string,
): string[] {
  return tagsByTask instanceof Map ? (tagsByTask.get(id) ?? []) : (tagsByTask[id] ?? []);
}

/**
 * Rows for a tab. An empty `tag` (the All tab) returns every row; otherwise
 * only the rows whose campaign carries that tag. `tagsByTask` maps a task id
 * to its Asana tags.
 */
export function rowsForTab(
  rows: FinanceRow[],
  tagsByTask: Record<string, string[]> | Map<string, string[]>,
  tag: string,
): FinanceRow[] {
  if (!normalizeTag(tag)) return rows ?? [];
  return (rows ?? []).filter((r) => hasTag(tagsOf(tagsByTask, r.taskId), tag));
}

/** Back-compat alias: filter to a specific tag (never the All behaviour). */
export function rowsForTag(
  rows: FinanceRow[],
  tagsByTask: Record<string, string[]> | Map<string, string[]>,
  tag: string,
): FinanceRow[] {
  return (rows ?? []).filter((r) => hasTag(tagsOf(tagsByTask, r.taskId), tag));
}

/** How many campaigns each tab holds, for the tab badges. */
export function tabCounts(
  rows: FinanceRow[],
  tagsByTask: Record<string, string[]> | Map<string, string[]>,
): Record<FinanceTabKey, number> {
  const out = { all: 0, quotation: 0, requotation: 0, invoice: 0, transaction: 0 } as Record<FinanceTabKey, number>;
  for (const tab of FINANCE_TABS) out[tab.key] = rowsForTab(rows, tagsByTask, tab.tag).length;
  return out;
}

export const FINANCE_PAGE_SIZES = [10, 25, 50] as const;

export interface Paged<T> {
  items: T[];
  page: number;       // 1-based, clamped into range
  pageCount: number;  // at least 1
  total: number;
}

/**
 * One page of `items`. `page` is 1-based and clamped so an out-of-range page
 * (e.g. after the list shrinks) lands on the last real page rather than empty.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): Paged<T> {
  const all = items ?? [];
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (p - 1) * size;
  return { items: all.slice(start, start + size), page: p, pageCount, total: all.length };
}