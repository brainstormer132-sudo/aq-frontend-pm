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
