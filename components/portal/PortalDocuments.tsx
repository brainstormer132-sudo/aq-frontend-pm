'use client';

import { useEffect, useMemo, useState } from 'react';
import { portal, type PortalContractRow, type PortalMe } from '@/lib/portal-api';
import { DownloadBtn, Icon, StatusBadge, exportContractsCsv } from './PortalUI';

/**
 * Documents tab. Single source of truth for the full contracts list.
 * Filters: free-text search + contract-type + year.
 * Toolbar: Export CSV (client-side) + Download all (placeholder for now —
 * will hit GET /external-portal/contracts/download-all once the backend
 * endpoint is wired in the next pass).
 */
export function PortalDocuments({ me }: { me: PortalMe }) {
  const [rows, setRows] = useState<PortalContractRow[] | null>(null);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');

  useEffect(() => {
    portal.contracts()
      .then(setRows)
      .catch((e: any) => {
        setRows([]);
        setError(e?.message ?? String(e));
      });
  }, []);

  const allTypes = useMemo(() => {
    const set = new Set<string>();
    (rows ?? []).forEach((r) => r.contract_type && set.add(r.contract_type));
    return Array.from(set).sort();
  }, [rows]);

  const allYears = useMemo(() => {
    const set = new Set<string>();
    (rows ?? []).forEach((r) => {
      const y = (r.generated_at || '').slice(0, 4);
      if (y) set.add(y);
    });
    return Array.from(set).sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (typeFilter !== 'all' && r.contract_type !== typeFilter) return false;
      if (yearFilter !== 'all' && !(r.generated_at || '').startsWith(yearFilter)) return false;
      if (!text) return true;
      const hay = `${r.contract_id} ${r.brand_name} ${r.amount} ${r.contract_type}`.toLowerCase();
      return hay.includes(text);
    });
  }, [rows, q, typeFilter, yearFilter]);

  const entityCol = me.role === 'client' ? 'Brand' : 'Brand';

  return (
    <>
      <div className="portal-section-head">
        <div>
          <h2>Contracts</h2>
          <p>
            {me.role === 'client'
              ? `Every contract AQ Creativity has generated for ${me.profile.company_name}.`
              : 'Every contract AQ has generated for you. PDFs render after the DOCX is created — usually within a minute or two.'}
          </p>
        </div>
        <div className="portal-toolbar">
          <button
            type="button"
            className="aq-btn aq-btn-secondary aq-btn-sm"
            onClick={() => exportContractsCsv(filtered, `contracts-${new Date().toISOString().slice(0, 10)}.csv`)}
            disabled={!filtered.length}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="aq-btn aq-btn-primary aq-btn-sm"
            disabled
            title="Available after the next backend update"
          >
            <Icon.Download /> Download all
          </button>
        </div>
      </div>

      <div className="portal-card" style={{ padding: 18 }}>
        <div className="portal-filter-bar">
          <div className="search">
            <span className="icon"><Icon.Search /></span>
            <input
              className="aq-input"
              placeholder="Search by contract id, brand, amount…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="aq-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All contract types</option>
            {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="aq-select" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="all">All years</option>
            {allYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {error && (
          <div style={{
            fontSize: 13, color: 'var(--aq-error)',
            padding: '12px 14px', background: 'var(--aq-bg-sunken)',
            borderRadius: 'var(--aq-radius)', marginBottom: 12,
          }}>{error}</div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-docs-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>{entityCol}</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Generated</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Download</th>
              </tr>
            </thead>
            <tbody>
              {rows == null ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--aq-text-muted)' }}>Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--aq-text-muted)' }}>
                  {rows.length === 0 ? 'No contracts yet.' : 'No contracts match those filters.'}
                </td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.contract_id}>
                    <td><code style={{ fontSize: 12 }}>{c.contract_id}</code></td>
                    <td>{c.brand_name || '—'}</td>
                    <td><span className="aq-badge aq-badge-muted">{c.contract_type}</span></td>
                    <td className="num">{c.amount}</td>
                    <td>{c.generated_at}</td>
                    <td><StatusBadge row={c} /></td>
                    <td className="actions">
                      <DownloadBtn contractId={c.contract_id} kind="pdf"  disabled={!c.has_pdf}  />
                      <DownloadBtn contractId={c.contract_id} kind="docx" disabled={!c.has_docx} variant="ghost" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
