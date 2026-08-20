'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCrmTasks, completeCrmTask, type CrmTask } from '@/hooks/use-workflow';
import { followUpUrgency } from '@/lib/crm-sync';

/**
 * CRM follow-ups assigned to you.
 *
 * They used to exist only inside the CRM screen, which made a follow-up a
 * promise to yourself that nothing ever reminded you about. They sit above
 * campaign work rather than mixed into it, because a call to make and a
 * subtask to deliver are different kinds of obligation and merging them
 * makes both harder to scan.
 */
export function FollowUps({
  workspaceId, userId, refreshKey,
}: {
  workspaceId: string;
  userId: string;
  refreshKey?: number;
}) {
  const { items, loading, refetch } = useCrmTasks(workspaceId, { assignedTo: userId });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);

  // Read after mount, never during render — the server does not know what
  // day it is where you are, and a mismatch between the two renders is a
  // hydration error.
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);
  useEffect(() => { if (refreshKey) refetch(); }, [refreshKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const open = useMemo(() => (items || []).filter((t) => !t.completed_at), [items]);
  if (loading || !open.length) return null;

  const tone = (t: CrmTask) => {
    const u = today ? followUpUrgency(t.due_at, today, t.completed_at) : 'none';
    if (u === 'overdue') return { label: 'Overdue', bg: '#fee2e2', fg: '#b91c1c' };
    if (u === 'today') return { label: 'Today', bg: '#fef9c3', fg: '#a16207' };
    return null;
  };

  const done = async (t: CrmTask) => {
    setBusyId(t.id);
    try { await completeCrmTask(t.id, userId); await refetch(); }
    catch (e) { console.error('completeCrmTask', e); alert('Could not complete that follow-up — see console.'); }
    finally { setBusyId(null); }
  };

  return (
    <div className="aq-card animate-fade-in" style={{ padding: 20 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Follow-ups</h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
          From the CRM — {open.length} open. Ticking one here ticks it there.
        </p>
      </header>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {open.map((t) => {
          const flag = tone(t);
          return (
            <li key={t.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              border: '1px solid var(--aq-border-light)',
              borderRadius: 'var(--aq-radius)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                  {t.due_at ? `Due ${String(t.due_at).slice(0, 10)}` : 'No due date'}
                  {t.description ? ` · ${t.description.slice(0, 80)}` : ''}
                </div>
              </div>
              {flag && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
                  background: flag.bg, color: flag.fg,
                }}>{flag.label}</span>
              )}
              <button
                type="button"
                className="aq-btn aq-btn-secondary"
                disabled={busyId === t.id}
                onClick={() => done(t)}
                style={{ fontSize: 12.5, padding: '5px 12px' }}
              >{busyId === t.id ? 'Saving…' : 'Done'}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
