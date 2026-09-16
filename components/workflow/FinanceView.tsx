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
import { usePmTaskCampaignRollup, useWorkspaceProfiles, selectAllRows, selectAllRowsParallel, cachedFetch } from '@/hooks/use-workflow';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import { AqDrawingBlock } from '@/components/AQLoading';
import {
  financeRows, statusLabel, statusBadge, rowsForTab, tabCounts, paginate,
  openRequests, hasOpenRequest,
  FINANCE_TABS, FINANCE_PAGE_SIZES,
  type FinanceDocLite, type FinanceRow, type FinanceTabKey, type DocRequestLite,
} from '@/lib/finance';
import { generateQuotation } from '@/lib/contract-api';
import { FinancePayments } from './FinancePayments';

function money(n: number): string {
  return n ? `SAR ${Math.round(n).toLocaleString('en-US')}` : '-';
}

const REQUEST_KIND_LABEL: Record<'quotation' | 'requotation' | 'invoice', string> = {
  quotation: 'Quotation', requotation: 'Re-quotation', invoice: 'Invoice',
};

/** "today" / "3d ago" / "just now" (undated). */
function ageLabel(days: number | null): string {
  if (days == null) return 'just now';
  if (days === 0) return 'today';
  return `${days}d ago`;
}

/** The "X requested" badge text for a campaign row with open requests. */
function requestBadge(r: FinanceRow): string {
  const parts: string[] = [];
  if (r.requests?.quotation) parts.push(r.quotationBucket === 'requotation' ? 'Re-quotation requested' : 'Quotation requested');
  if (r.requests?.invoice) parts.push('Invoice requested');
  return parts.join(' + ');
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

  const { profiles } = useWorkspaceProfiles(workspaceId);
  const [docs, setDocs] = useState<FinanceDocLite[] | null>(null);
  const [reqs, setReqs] = useState<DocRequestLite[] | null>(null);
  const [error, setError] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'quotations' | 'payments'>('quotations');
  const [tab, setTab] = useState<FinanceTabKey>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(FINANCE_PAGE_SIZES[0]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string>('');

  // Cached (like the rollup) so returning to Finance is instant; `force` skips
  // the cache after a mutation (generate) or an explicit Refresh.
  const loadDocs = useCallback(async (force = false) => {
    if (!workspaceId) { setDocs([]); return; }
    try {
      const data = await cachedFetch(`financeDocs:${workspaceId}`, async () => {
        const supabase = createSupabase();
        return await selectAllRowsParallel<FinanceDocLite>(
          'financeDocuments',
          () => supabase
          .from('finance_documents')
          .select('id, pm_task_id, kind, document_number, status, amount, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false }),
          (m) => { throw new Error(m); },
        );
      }, force);
      setDocs(data);
    } catch (e: any) { setDocs([]); setError(e?.message ?? String(e)); }
  }, [workspaceId]);

  // Open (pending) quotation / invoice requests raised on campaigns (048).
  // Without this the Finance menu never learned an ask existed - it lived only
  // on the campaign's paperwork panel. Workspace-wide, pending only.
  const loadReqs = useCallback(async (force = false) => {
    if (!workspaceId) { setReqs([]); return; }
    const rows = await cachedFetch(`financeReqs:${workspaceId}`, () => selectAllRows<DocRequestLite>(
      'financeDocumentRequests',
      () => createSupabase().from('document_requests')
        .select('pm_task_id, doc_kind, status, requested_by, requested_at')
        .eq('workspace_id', workspaceId)
        .eq('status', 'pending')
        .order('requested_at', { ascending: true }),
      () => { /* requests are supplementary; ignore a read error, treat as none */ },
    ), force);
    setReqs(rows);
  }, [workspaceId]);

  useEffect(() => { loadDocs(); loadReqs(); }, [loadDocs, loadReqs]);

  // Refresh with visible feedback: the button says "Refreshing..." while the
  // three reloads run, and a timestamp appears when they finish, so the finance
  // team can see the list actually pulled the latest.
  const doRefresh = useCallback(async () => {
    setRefreshing(true); setError('');
    try {
      await Promise.all([Promise.resolve(refetchCampaigns()), loadDocs(true), loadReqs(true)]);
      setRefreshedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } finally {
      setRefreshing(false);
    }
  }, [refetchCampaigns, loadDocs, loadReqs]);

  // Full row set, then narrowed to the active tab, then searched.
  const allRows = useMemo(
    () => financeRows(campaigns ?? [], docs ?? [], reqs ?? []),
    [campaigns, docs, reqs],
  );

  // Tags now ride the campaign rollup (migration 094), so the Finance screen
  // reads them straight off `campaigns` instead of a second full scan of
  // pm_tasks - one campaign read for the whole screen.
  const tagsByTask = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const c of campaigns ?? []) m[c.parent_task_id] = c.tags ?? [];
    return m;
  }, [campaigns]);

  // Who to name in the Requests strip: requested_by -> full name.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of profiles ?? []) if (p?.id) m.set(String(p.id), p.full_name ?? '');
    return m;
  }, [profiles]);

  // Every open ask, most-waiting first, for the strip above the tabs.
  const today = new Date().toISOString().slice(0, 10);
  const requestStrip = useMemo(() => openRequests(allRows, today), [allRows, today]);
  const counts = useMemo(
    () => tabCounts(allRows, tagsByTask),
    [allRows, tagsByTask],
  );
  const activeTab = FINANCE_TABS.find((t) => t.key === tab)!;
  const tabbed = useMemo(
    () => rowsForTab(allRows, tagsByTask, activeTab.tag),
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
      await loadDocs(true);
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

      {/* Quotations (the Asana-tag tabs) or Payments (All / Partial paid / Advanced). */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['quotations', 'payments'] as const).map((m) => (
          <button key={m} type="button" className="aq-btn aq-btn-sm"
            onClick={() => setMode(m)}
            style={{
              fontWeight: mode === m ? 700 : 500,
              background: mode === m ? 'var(--aq-accent-light)' : 'transparent',
              border: '1px solid var(--aq-border-light)',
            }}>
            {m === 'quotations' ? 'Quotations' : 'Payments'}
          </button>
        ))}
      </div>

      {mode === 'payments' ? (
        <FinancePayments workspaceId={workspaceId} role={role} onOpenTask={onOpenTask} />
      ) : (
      <>

      {/* Requests strip: what campaigns have asked finance for, so the ask is
          seen here and not only on the campaign's paperwork panel. */}
      {requestStrip.length > 0 && (
        <div style={{ marginBottom: 14, border: '1px solid var(--aq-border-light)', borderRadius: 'var(--aq-radius)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', background: 'var(--aq-bg-sunken)', fontWeight: 700, fontSize: 13 }}>
            Requests
            <span style={{ marginLeft: 6, fontSize: 11, padding: '1px 7px', borderRadius: 999, background: 'var(--aq-accent-light)', color: 'var(--aq-green-strong)' }}>
              {requestStrip.length}
            </span>
          </div>
          {requestStrip.map((rq) => {
            const who = rq.requestedBy ? nameById.get(rq.requestedBy) : '';
            return (
              <div key={`${rq.taskId}:${rq.kind}`}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: '1px solid var(--aq-border-light)', fontSize: 13, flexWrap: 'wrap' }}>
                <span className="aq-badge aq-badge-warning">{REQUEST_KIND_LABEL[rq.kind]}</span>
                <strong>{rq.brand || rq.title}</strong>
                <span style={{ color: 'var(--aq-text-muted)' }}>
                  asked{who ? ` by ${who}` : ''} {ageLabel(rq.ageDays)}
                </span>
                {onOpenTask && (
                  <button type="button" className="aq-btn aq-btn-ghost aq-btn-sm" style={{ marginLeft: 'auto' }}
                    onClick={() => onOpenTask(rq.taskId)}>Open</button>
                )}
              </div>
            );
          })}
        </div>
      )}

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
              <tr><td colSpan={actionable ? 5 : 4} style={{ padding: 8 }}><AqDrawingBlock label={'Loading finance\u2026'} /></td></tr>
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
                    {hasOpenRequest(r) && (
                      <div style={{ marginTop: 3 }}>
                        <span className="aq-badge aq-badge-warning" style={{ fontSize: 11 }}>{requestBadge(r)}</span>
                      </div>
                    )}
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
      )}
    </>
  );
}
