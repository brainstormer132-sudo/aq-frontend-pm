'use client';

import { useState } from 'react';

/**
 * "Sync now from Asana" - the on-demand pull, beside the Asana board figures
 * in the Data view. The hourly Vercel Cron does the same thing on a schedule;
 * this is the manual trigger for when someone wants it now.
 *
 * One-way (Asana -> app) and idempotent, so pressing it twice is harmless.
 * Only owner / admin / finance see it; the server enforces the same.
 */
const ALLOWED = ['owner', 'admin', 'finance'];

interface SyncSummary {
  campaigns: number;
  bookings: number;
  clients: number;
  vendors: number;
  warnings: string[];
  finishedAt: string;
}

export function AsanaSyncButton({ workspaceId, role }: { workspaceId: string; role: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncSummary | null>(null);

  if (!ALLOWED.includes(role)) return null;

  const sync = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/asana/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `Sync failed (${res.status})`);
      setResult(json as SyncSummary);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aq-card" style={{ padding: '16px 20px', marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 13.5, fontWeight: 700, margin: '0 0 2px' }}>Asana sync</h3>
          <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', margin: 0 }}>
            Pulls the Jed Deals 26 project straight from Asana - no upload. Runs every
            hour on its own; use this to pull the latest now.
          </p>
        </div>
        <button
          type="button"
          className="aq-btn aq-btn-primary"
          disabled={busy}
          onClick={sync}
          style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}
        >{busy ? 'Syncing...' : 'Sync now'}</button>
      </div>

      {error && (
        <p style={{ fontSize: 12.5, color: 'var(--aq-error)', marginTop: 12 }}>{error}</p>
      )}
      {result && !error && (
        <div style={{ fontSize: 12.5, color: 'var(--aq-text)', marginTop: 12 }}>
          <span style={{ color: 'var(--aq-accent)', fontWeight: 600 }}>Synced.</span>{' '}
          {result.campaigns} campaigns, {result.bookings} bookings, {result.clients} clients,{' '}
          {result.vendors} vendors.
          {result.warnings?.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--aq-text-muted)' }}>
                {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--aq-text-muted)' }}>
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}