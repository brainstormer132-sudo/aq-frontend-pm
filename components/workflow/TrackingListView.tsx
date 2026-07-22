'use client';

import { useState } from 'react';
import { useTrackingCampaigns, type PMTask, type WorkspaceRole } from '@/hooks/use-workflow';
import { TrackingSheetPanel } from './TrackingSheetPanel';

/**
 * Sidebar view: every campaign flagged with a tracking sheet.
 *
 * A campaign gets flagged when "Tracking Sheet" is chosen as a subtask at
 * Marketing triage (sets pm_tasks.has_tracking = true). Clicking a row opens
 * that campaign's tracking sheet, where vendors / ad rows are added and edited.
 */
export function TrackingListView({
  workspaceId, role,
}: {
  workspaceId: string;
  role: WorkspaceRole | null;
}) {
  const { items, loading, refetch } = useTrackingCampaigns(workspaceId);
  const [open, setOpen] = useState<PMTask | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Tracking Sheets</h1>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
          Campaigns with a tracking sheet. Add the “Tracking Sheet” subtask at triage to create one.
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--aq-text-muted)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{
          border: '1px dashed var(--aq-border-light)',
          borderRadius: 'var(--aq-radius)',
          padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)',
        }}>
          No tracking sheets yet. Pick “Tracking Sheet” as a subtask when triaging a campaign to start one.
        </div>
      ) : (
        <div className="aq-card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 640, width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Brand</Th>
                <Th>Stage</Th>
                <Th>Created</Th>
                <Th align="right"></Th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setOpen(t)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--aq-border-light)' }}
                >
                  <Td><span style={{ fontWeight: 600 }}>{t.task_name || t.title}</span></Td>
                  <Td>{t.brand_name || '—'}</Td>
                  <Td>
                    <span className={`aq-badge ${
                      t.stage === 'completed' ? 'aq-badge-success'
                      : t.stage === 'pending_marketing' ? 'aq-badge-warning'
                      : 'aq-badge-info'
                    }`}>{t.stage.replace('_', ' ')}</span>
                  </Td>
                  <Td muted>{(t.created_at || '').slice(0, 10) || '—'}</Td>
                  <Td align="right">
                    <button
                      className="aq-btn aq-btn-secondary"
                      style={{ padding: '4px 12px' }}
                      onClick={(e) => { e.stopPropagation(); setOpen(t); }}
                    >Open sheet</button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <TrackingSheetPanel
          taskId={open.id}
          taskTitle={open.task_name || open.title}
          brandName={open.brand_name}
          role={role}
          onClose={() => { setOpen(null); refetch(); }}
        />
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align, padding: '10px 14px', fontSize: 12, fontWeight: 700,
      color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: 0.3, whiteSpace: 'nowrap',
    }}>{children}</th>
  );
}

function Td({ children, align = 'left', muted = false }: {
  children?: React.ReactNode; align?: 'left' | 'right'; muted?: boolean;
}) {
  return (
    <td style={{
      textAlign: align, padding: '12px 14px', fontSize: 13,
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)', whiteSpace: 'nowrap',
    }}>{children}</td>
  );
}
