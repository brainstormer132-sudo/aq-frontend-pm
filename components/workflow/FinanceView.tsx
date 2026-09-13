'use client';

/**
 * Finance -> Quotations. One row per campaign: its value, the latest quotation
 * (number + status), and the action it is asking for -- Generate the first
 * quotation, or Re-quote an existing one. The button calls the aq-backend, which
 * builds the line items and creates the Zoho estimate; on success we refetch so
 * the new EST-#### and status appear.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceRole } from '@/hooks/use-workflow';
import { usePmTaskCampaignRollup } from '@/hooks/use-workflow';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import {
  financeRows, statusLabel, statusBadge, type FinanceDocLite, type FinanceRow,
} from '@/lib/finance';
import { generateQuotation } from '@/lib/contract-api';

function money(n: number): string {
  return n ? `SAR ${Math.round(n).toLocaleString('en-US')}` : '-';
}

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
  const [error, setError] = useState('');
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [q, setQ] = useState('');

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

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const rows = useMemo(
    () => financeRows(campaigns ?? [], docs ?? []),
    [campaigns, docs],
  );

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    if (!text) return rows;
    return rows.filter((r) =>
      `${r.title} ${r.brand} ${r.quotation?.number ?? ''}`.toLowerCase().includes(text));
  }, [rows, q]);

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

  const loading = campaignsLoading || docs == null;

  return (
    <>
      <div className="portal-section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Quotations</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--aq-text-muted)', fontSize: 14 }}>
            Generate a client quotation from a campaign, or re-quote an existing one. Quotations are created in Zoho.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="aq-input"
            placeholder="Search campaign, brand, EST#..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <button type="button" className="aq-btn aq-btn-secondary aq-btn-sm"
            onClick={() => { refetchCampaigns(); loadDocs(); }}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          fontSize: 13, color: 'var(--aq-error)', padding: '10px 14px',
          background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)', marginBottom: 12,
        }}>{error}</div>
      )}

      <div className="portal-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="portal-docs-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Campaign</th>
              <th className="num">Value</th>
              <th>Quotation</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--aq-text-muted)', padding: 18 }}>
                {rows.length === 0 ? 'No campaigns yet.' : 'No campaigns match that search.'}
              </td></tr>
            ) : (
              filtered.map((r) => (
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
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="aq-btn aq-btn-primary aq-btn-sm"
                      disabled={busyTask === r.taskId}
                      onClick={() => onGenerate(r)}>
                      {busyTask === r.taskId ? 'Working...' : r.actionLabel}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
