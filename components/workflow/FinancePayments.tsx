'use client';

/**
 * Finance -> Payments. Three sections over the money the ledgers track:
 *
 *   All           every campaign with money in play
 *   Partial paid  part of the bill is in; a balance is still owed
 *   Advanced      money paid in advance, before the campaign completed
 *
 * Two sides, like the Data-view ledger: "Client owes" (Collection) and "We owe
 * the vendor" (Liability). Billed comes from the campaign rollup (sum of prices
 * on the client side, sum of nets on the vendor side); paid, advance and the
 * client's payment terms come from the parent pm_tasks row. The section
 * placement + arithmetic is pure and tested in lib/finance.
 *
 * Read-only for now. Recording an advance from here lands in the next
 * increment; the advance the contract terms lead us to EXPECT is shown beside
 * the recorded one so a shortfall is visible.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceRole } from '@/hooks/use-workflow';
import { usePmTaskCampaignRollup, selectAllRows } from '@/hooks/use-workflow';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import {
  buildPaymentRows, paymentSectionRows, paymentSectionCounts,
  paginate, PAYMENT_SECTIONS, FINANCE_PAGE_SIZES,
  type CampaignMoney, type PaymentRow, type PaymentSectionKey,
} from '@/lib/finance';

type Side = 'clients' | 'vendors';

interface MoneyRow {
  id: string;
  task_name: string | null;
  title: string | null;
  brand_name: string | null;
  client_payment_status: string | null;
  client_payment_amount: number | null;
  client_advance_amount: number | null;
  client_advance_date: string | null;
  vendor_payment_amount: number | null;
  vendor_advance_amount: number | null;
  vendor_advance_date: string | null;
  payment_terms: string | null;
  payment_split_pct: number | null;
}

function money(n: number): string {
  return n ? `SAR ${Math.round(n).toLocaleString('en-US')}` : '-';
}

const STATE_BADGE: Record<'paid' | 'partial' | 'unpaid', string> = {
  paid: 'aq-badge-success',
  partial: 'aq-badge-warning',
  unpaid: 'aq-badge-error',
};

export function FinancePayments({
  workspaceId, role, onOpenTask,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const { rows: campaigns, loading: campaignsLoading } = usePmTaskCampaignRollup(workspaceId);
  const [moneyById, setMoneyById] = useState<Record<string, MoneyRow> | null>(null);
  const [error, setError] = useState('');
  const [side, setSide] = useState<Side>('clients');
  const [section, setSection] = useState<PaymentSectionKey>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(FINANCE_PAGE_SIZES[0]);

  const loadMoney = useCallback(async () => {
    if (!workspaceId) { setMoneyById({}); return; }
    const supabase = createSupabase();
    const rows = await selectAllRows<MoneyRow>(
      'financePaymentsMoney',
      () => supabase.from('pm_tasks')
        .select('id, task_name, title, brand_name, client_payment_status, client_payment_amount, client_advance_amount, client_advance_date, vendor_payment_amount, vendor_advance_amount, vendor_advance_date, payment_terms, payment_split_pct')
        .eq('workspace_id', workspaceId)
        .is('parent_task_id', null)
        .order('id', { ascending: true }),
      (m) => setError(m),
    );
    const map: Record<string, MoneyRow> = {};
    for (const r of rows) map[r.id] = r;
    setMoneyById(map);
  }, [workspaceId]);

  useEffect(() => { loadMoney(); }, [loadMoney]);

  // One CampaignMoney per campaign for the chosen side, then the pure builder.
  const rows: PaymentRow[] = useMemo(() => {
    if (!campaigns || !moneyById) return [];
    const built: CampaignMoney[] = campaigns.map((c) => {
      const m = moneyById[c.parent_task_id];
      if (side === 'clients') {
        return {
          taskId: c.parent_task_id,
          title: c.title,
          brand: c.brand_name,
          billed: c.sum_prices,
          paid: m ? Number(m.client_payment_amount ?? 0) : 0,
          status: m?.client_payment_status ?? c.client_payment_status,
          advance: m ? Number(m.client_advance_amount ?? 0) : 0,
          advanceDate: m?.client_advance_date ?? null,
          paymentTerms: m?.payment_terms ?? null,
          paymentSplitPct: m?.payment_split_pct ?? null,
        };
      }
      return {
        taskId: c.parent_task_id,
        title: c.title,
        brand: c.brand_name,
        billed: c.sum_nets,
        paid: m ? Number(m.vendor_payment_amount ?? 0) : 0,
        status: null, // vendor side has no recorded status column; derive from amounts
        advance: m ? Number(m.vendor_advance_amount ?? 0) : 0,
        advanceDate: m?.vendor_advance_date ?? null,
      };
    });
    // A campaign nobody has priced is not a debt - it is unfinished work.
    return buildPaymentRows(built.filter((c) => c.billed > 0 || Number(c.advance ?? 0) > 0));
  }, [campaigns, moneyById, side]);

  const counts = useMemo(() => paymentSectionCounts(rows), [rows]);
  const sectioned = useMemo(() => paymentSectionRows(rows, section), [rows, section]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return sectioned;
    return sectioned.filter((r) => `${r.title} ${r.brand}`.toLowerCase().includes(t));
  }, [sectioned, q]);

  useEffect(() => { setPage(1); }, [side, section, q, pageSize]);
  const paged = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);

  const loading = campaignsLoading || moneyById == null;
  const activeSection = PAYMENT_SECTIONS.find((s) => s.key === section)!;
  const oweLabel = side === 'clients' ? 'Client owes' : 'We owe vendor';

  return (
    <>
      {/* Side: whose money. Same two sides as the Data-view ledger. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['clients', 'vendors'] as Side[]).map((s) => (
          <button key={s} type="button" className="aq-btn aq-btn-sm"
            onClick={() => setSide(s)}
            style={{
              fontWeight: side === s ? 700 : 500,
              background: side === s ? 'var(--aq-accent-light)' : 'transparent',
              border: '1px solid var(--aq-border-light)',
            }}>
            {s === 'clients' ? 'Client owes (Collection)' : 'We owe vendors (Liability)'}
          </button>
        ))}
      </div>

      {/* Sections: All / Partial paid / Advanced, with counts. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, borderBottom: '1px solid var(--aq-border-light)' }}>
        {PAYMENT_SECTIONS.map((s) => (
          <button key={s.key} type="button"
            onClick={() => setSection(s.key)}
            className="aq-btn aq-btn-ghost aq-btn-sm"
            style={{
              borderBottom: section === s.key ? '2px solid var(--aq-accent)' : '2px solid transparent',
              borderRadius: 0, fontWeight: section === s.key ? 700 : 500,
              color: section === s.key ? 'var(--aq-text)' : 'var(--aq-text-muted)',
            }}>
            {s.label}
            <span style={{
              marginLeft: 6, fontSize: 11, padding: '1px 7px', borderRadius: 999,
              background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-muted)',
            }}>{counts[s.key]}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, color: 'var(--aq-text-muted)', fontSize: 13 }}>{activeSection.blurb}</p>
        <input className="aq-input" placeholder="Search campaign or brand..."
          value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
      </div>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--aq-error)', padding: '10px 14px', background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)', marginBottom: 12 }}>{error}</div>
      )}

      <div className="portal-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="portal-docs-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Campaign</th>
              <th className="num">Billed</th>
              <th className="num">Paid</th>
              <th className="num">Remaining</th>
              <th className="num">Advance</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>Loading...</td></tr>
            ) : paged.items.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>
                {rows.length === 0 ? 'Nothing with money in play yet.'
                  : section === 'partial' ? 'Nothing partially paid on this side.'
                  : section === 'advanced' ? 'No advances recorded on this side.'
                  : 'No campaigns match that search.'}
              </td></tr>
            ) : (
              paged.items.map((r) => (
                <tr key={r.taskId}>
                  <td>
                    {onOpenTask ? (
                      <button type="button" onClick={() => onOpenTask(r.taskId)}
                        style={{ background: 'none', border: 0, padding: 0, color: 'var(--aq-link, inherit)', cursor: 'pointer', font: 'inherit', textAlign: 'left' }}>
                        {r.title}
                      </button>
                    ) : r.title}
                    {r.brand && r.brand !== r.title
                      ? <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{r.brand}</div> : null}
                  </td>
                  <td className="num">{money(r.billed)}</td>
                  <td className="num">{money(r.paid)}</td>
                  <td className="num" style={{ color: r.remaining > 0 ? 'var(--aq-text)' : 'var(--aq-text-muted)' }}>{money(r.remaining)}</td>
                  <td className="num">
                    {r.advance > 0 ? money(r.advance) : <span style={{ color: 'var(--aq-text-muted)' }}>-</span>}
                    {r.expectedAdvance > 0 && r.advance < r.expectedAdvance ? (
                      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>of {money(r.expectedAdvance)} due</div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`aq-badge ${STATE_BADGE[r.state]}`}>
                      {r.state === 'partial' ? 'Partially paid' : r.state === 'paid' ? 'Paid' : (side === 'clients' ? 'Outstanding' : 'Unpaid')}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
            {oweLabel} - {paged.total} campaign{paged.total === 1 ? '' : 's'} - page {paged.page} of {paged.pageCount}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
              Per page{' '}
              <select className="aq-input aq-input-sm" value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ width: 'auto', display: 'inline-block' }}>
                {FINANCE_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm"
              disabled={paged.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Prev</button>
            <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm"
              disabled={paged.page >= paged.pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}
