'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { updateTaskFields, type PMTask } from '@/hooks/use-workflow';

const supabase = createClient();

/**
 * Tasks the current user is on the hook for: directly assigned, or in
 * task_members. Includes both parent and child tasks (members work on
 * the per-step subtasks; key accounts review the parents).
 */
export function MyTasksList({
  workspaceId, userId, refreshKey = 0, onOpen,
}: {
  workspaceId: string;
  userId: string;
  /** Bump this number to force a refetch from a parent. */
  refreshKey?: number;
  /** Click row → open task detail panel. */
  onOpen?: (taskId: string) => void;
}) {
  const [tasks, setTasks] = useState<PMTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const fetch = async () => {
    setLoading(true);
    setError('');
    try {
      // Anything assigned to me OR I created OR I'm key account on.
      const { data: assigned, error: aErr } = await supabase
        .from('pm_tasks')
        .select('*')
        .eq('workspace_id', workspaceId)
        .or(`assignee_id.eq.${userId},key_account_id.eq.${userId},creator_id.eq.${userId}`)
        .order('created_at', { ascending: false });
      if (aErr) throw aErr;

      const { data: viaMembers, error: mErr } = await supabase
        .from('task_members')
        .select('task_id')
        .eq('user_id', userId);
      if (mErr) throw mErr;

      const memberTaskIds = (viaMembers || []).map((r: any) => r.task_id);
      let memberTasks: PMTask[] = [];
      if (memberTaskIds.length) {
        const { data, error: tmErr } = await supabase
          .from('pm_tasks')
          .select('*')
          .in('id', memberTaskIds);
        if (tmErr) throw tmErr;
        memberTasks = (data || []) as PMTask[];
      }
      const merged = new Map<string, PMTask>();
      [...(assigned || []), ...memberTasks].forEach((t: any) => merged.set(t.id, t as PMTask));
      setTasks(Array.from(merged.values()));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); /* eslint-disable-next-line */ }, [workspaceId, userId, refreshKey]);

  const markDone = async (id: string) => {
    setBusyId(id);
    try {
      await updateTaskFields(id, { status: 'done', completed_at: new Date().toISOString() } as any);
      await fetch();
    } finally { setBusyId(null); }
  };

  if (loading) return <div className="aq-card" style={{ padding: 24, color: 'var(--aq-text-muted)' }}>Loading your tasks…</div>;

  if (error) {
    return (
      <div className="aq-card" style={{ padding: 24 }}>
        <div className="aq-badge aq-badge-error">Error</div>
        <p style={{ marginTop: 10, fontSize: 14, color: 'var(--aq-text-secondary)' }}>{error}</p>
      </div>
    );
  }

  if (!tasks.length) {
    return (
      <div className="aq-card" style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
        Nothing on your plate. Enjoy it.
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const visible = !q ? tasks : tasks.filter((t: any) => [
    t.task_name, t.title, t.brand_name, t.legacy_client_id,
    t.id, t.description, t.stage, t.priority, t.status,
  ].some((v) => String(v || '').toLowerCase().includes(q)));

  return (
    <div className="aq-card animate-fade-in" style={{ padding: 20 }}>
      <header style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>My tasks</h2>
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {visible.length} of {tasks.length} task{tasks.length === 1 ? '' : 's'} shown.
          </p>
        </div>
        <input
          className="aq-input"
          style={{ maxWidth: 320, minWidth: 220 }}
          placeholder="Search your tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((t) => {
          const done = t.status === 'done';
          return (
            <li key={t.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 14px',
              borderRadius: 'var(--aq-radius)',
              border: '1px solid var(--aq-border-light)',
              background: done ? 'var(--aq-accent-light)' : 'var(--aq-bg-elevated)',
            }}>
              <button
                type="button"
                onClick={() => onOpen?.(t.id)}
                style={{
                  flex: 1, textAlign: 'left', background: 'transparent',
                  border: 'none', padding: 0, cursor: onOpen ? 'pointer' : 'default',
                  fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <strong style={{ fontSize: 14, textDecoration: done ? 'line-through' : 'none' }}>
                  {t.task_name || t.title}
                </strong>
                <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  {t.brand_name ? `${t.brand_name} · ` : ''}
                  stage {t.stage} · priority {t.priority}
                  {t.parent_task_id ? ' · subtask' : ''}
                </span>
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className={`aq-badge ${done ? 'aq-badge-success' : 'aq-badge-muted'}`}>{t.status}</span>
                {!done && (
                  <button
                    type="button"
                    className="aq-btn aq-btn-secondary"
                    onClick={(e) => { e.stopPropagation(); markDone(t.id); }}
                    disabled={busyId === t.id}
                    style={{ padding: '6px 12px', fontSize: 12 }}
                  >{busyId === t.id ? '…' : 'Mark done'}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
