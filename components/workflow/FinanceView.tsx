'use client';

/**
 * Finance. Opens on "All" (every campaign) and then a tab per Asana tag
 * (Quotation / Re-quotation / Invoice / Transaction). A tag tab shows only the
 * campaigns carrying that tag; "All" shows everything, so the screen is never
 * empty before anything is tagged. Everything is paged so a busy workspace
 * never renders four thousand rows at once.
 *
 * Where the tags come from: the Asana import writes pm_tasks.tags, so a tag put
 * on a campaign in Asana (#quotation, #requotation, #invoice, #transaction)
 * flows in on the next sync and decides which tab the campaign shows in. Tags
 * are matched case-insensitively and with a leading '#' ignored.
 *
 * All / Quotation / Re-quotation carry the working action (generate / re-quote
 * via Zoho, already wired). Invoice and Transaction list their campaigns; their
 * actions (issue the Zoho invoice; record the client payment) land next, so
 * those tabs say so rather than showing a dead button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceRole } from '@/hooks/use-workflow';
import { usePmTaskCampaignRollup, selectAllRows } from '@/hooks/use-workflow';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import {
  financeRows, statusLabel, statusBadge, rowsForTab, tabCounts, paginate,
  FINANCE_TABS, FINANCE_PAGE_SIZES,
  type FinanceDocLite, type FinanceRow, type FinanceTabKey,
} from '@/lib/finance';
import { generateQuotation } from '@/lib/contract-api';

function money(n: number): string {
  return n ? `SAR ${Math.round(n).toLocaleString('en-US')}` : '-';
}

/** Tabs whose primary action is live today. */
const ACTIONABLE: Record<FinanceTabKey, boolean> = {
  all: true, quotation: true, requotation: true, invoice: false, transaction: false,
};

export function FinanceView({
  workspaceId, role, onOpenTask,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const { rows: campaigns, loading: campaignsLoading, refetch: refetchCampaigns } =
    usePmTaskCampaignRollup(workspaceId);

  const [docs, setDocs] = useState<FinanceDocLite[] | null>(null);
  const [tagsByTask, setTagsByTask] = useState<Record<string, string[]> | null>(null);
  const [error, setError] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<FinanceTabKey>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(FINANCE_PAGE_SIZES[0]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string>('');

  const loadDocs = useCallback(async () => {
    if (!workspaceId) { setDocs([]); return; }
    const supabase = createSupabase();
    const { data, error: e } = await supabase
      .from('finance_documents')
      .select('id, pm_task_id, kind, document_number, status, amount, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (e) { setDocs([]); setError(e.message ?? String(e)); return; }
    setDocs((data ?? []) as FinanceDocLite[]);
  }, [workspaceId]);

  const loadTags = useCallback(async () => {
    if (!workspaceId) { setTagsByTask({}); return; }
    const supabase = createSupabase();
    // Parent campaigns only, paged (a workspace can hold thousands). A missing
    // tags column (before migration 088) just yields empty tags, not an error.
    const rows = await selectAllRows<{ id: string; tags: string[] | null }>(
      'financeCampaignTags',
      () => supabase.from('pm_tasks')
        .select('id, tags')
        .eq('workspace_id', workspaceId)
        .is('parent_task_id', null)
        .order('id', { ascending: true }),
      () => { /* tags are optional; ignore and treat as untagged */ },
    );
    const map: Record<string, string[]> = {};
    for (const r of rows) map[r.id] = r.tags ?? [];
    setTagsByTask(map);
  }, [workspaceId]);

  useEffect(() => { loadDocs(); loadTags(); }, [loadDocs, loadTags]);

  // Refresh with visible feedback: the button says "Refreshing..." while the
  // three reloads run, and a timestamp appears when they finish, so the finance
  // team can see the list actually pulled the latest.
  const doRefresh = useCallback(async () => {
    setRefreshing(true); setError('');
    try {
      await Promise.all([Promise.resolve(refetchCampaigns()), loadDocs(), loadTags()]);
      setRefreshedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setRefreshing(false);
    }
  }, [refetchCampaigns, loadDocs, loadTags]);

  // Full row set, then narrowed to the active tab, then searched.
  const allRows = useMemo(
    () => financeRows(campaigns ?? [], docs ?? []),
    [campaigns, docs],
  );
  const counts = useMemo(
    () => tabCounts(allRows, tagsByTask ?? {}),
    [allRows, tagsByTask],
  );
  const activeTab = FINANCE_TABS.find((t) => t.key === tab)!;
  const tabbed = useMemo(
    () => rowsForTab(allRows, tagsByTask ?? {}, activeTab.tag),
    [allRows, tagsByTask, activeTab.tag],
  );
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return tabbed;
    return tabbed.filter((r) =>
      `${r.title} ${r.brand} ${r.quotation?.number ?? ''}`.toLowerCase().includes(text));
  }, [tabbed, q]);

  // Any change that reshapes the list resets to the first page.
  useEffect(() => { setPage(1); }, [tab, q, pageSize]);
  const paged = useMemo(() => paginate(filtered, page, pageSize), [filtered, page, pageSize]);

  const onGenerate = async (r: FinanceRow) => {
    setBusyTask(r.taskId);
    setError('');
    try {
      await generateQuotation(r.taskId);
      await loadDocs();
    } catch (e: any) {
      setError(`${r.title}: ${e?.message ?? 'Could not generate the quotation.'}`);
    } finally {
      setBusyTask(null);
    }
  };

  // Tags load fast and are optional; don't hold the whole screen on them.
  const loading = campaignsLoading || docs == null;
  const actionable = ACTIONABLE[tab];

  return (
    <>
      <div className="portal-section-head" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Finance</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--aq-text-muted)', fontSize: 14 }}>
          All campaigns, or grouped by their Asana tag. Quotations are created in Zoho.
        </p>
      </div>

      {/* Tabs: All, then one per Asana tag, with how many campaigns each holds. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14, borderBottom: '1px solid var(--aq-border-light)' }}>
        {FINANCE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="aq-btn aq-btn-ghost aq-btn-sm"
            style={{
              borderBottom: tab === t.key ? '2px solid var(--aq-accent)' : '2px solid transparent',
              borderRadius: 0, fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--aq-text)' : 'var(--aq-text-muted)',
            }}
          >
            {t.label}
            <span style={{
              marginLeft: 6, fontSize: 11, padding: '1px 7px', borderRadius: 999,
              background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-muted)',
            }}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, color: 'var(--aq-text-muted)', fontSize: 13 }}>{activeTab.blurb}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="aq-input"
            placeholder="Search campaign, brand, EST#..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 220 }}
          />
          <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm"
            disabled={refreshing}
            onClick={doRefresh}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {refreshedAt && !refreshing && (
            <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', alignSelf: 'center' }}>
              Updated {refreshedAt}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          fontSize: 13, color: 'var(--aq-error)', padding: '10px 14px',
          background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)', marginBottom: 12,
        }}>{error}</div>
      )}

      {!actionable && !loading && filtered.length > 0 && (
        <div style={{
          fontSize: 12.5, color: 'var(--aq-text-muted)', padding: '8px 14px',
          background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)', marginBottom: 12,
        }}>
          {tab === 'invoice'
            ? 'Issuing the Zoho invoice from here lands next; for now this lists the campaigns tagged for invoicing.'
            : 'Recording the client payment from here lands next; for now this lists the campaigns tagged as transactions.'}
        </div>
      )}

      <div className="portal-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="portal-docs-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Campaign</th>
              <th className="num">Value</th>
              <th>Quotation</th>
              <th>Status</th>
              {actionable && <th style={{ textAlign: 'right' }}>Action</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={actionable ? 5 : 4} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>Loading...</td></tr>
            ) : paged.items.length === 0 ? (
              <tr><td colSpan={actionable ? 5 : 4} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>
                {tab === 'all'
                  ? (allRows.length === 0 ? 'No campaigns yet.' : 'No campaigns match that search.')
                  : tabbed.length === 0
                    ? `No campaigns tagged #${activeTab.tag} yet. Tag them in Asana and Sync, and they appear here.`
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
                  <td className="num">{money(r.amount)}</td>
                  <td>{r.quotation ? <code style={{ fontSize: 12 }}>{r.quotation.number}</code> : <span style={{ color: 'var(--aq-text-muted)' }}>-</span>}</td>
                  <td>{r.quotation
                    ? <span className={`aq-badge ${statusBadge(r.quotation.status)}`}>{statusLabel(r.quotation.status)}</span>
                    : <span className="aq-badge aq-badge-muted">Not quoted</span>}</td>
                  {actionable && (
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="aq-btn aq-btn-primary aq-btn-sm"
                        disabled={busyTask === r.taskId}
                        onClick={() => onGenerate(r)}>
                        {busyTask === r.taskId ? 'Working...' : r.actionLabel}
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paging: page N of M, prev/next, and the page size. */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
            {paged.total} campaign{paged.total === 1 ? '' : 's'} - page {paged.page} of {paged.pageCount}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
              Per page{' '}
              <select
                className="aq-input aq-input-sm"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ width: 'auto', display: 'inline-block' }}
              >
                {FINANCE_PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm"
              disabled={paged.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Prev
            </button>
            <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm"
              disabled={paged.page >= paged.pageCount}
              onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
