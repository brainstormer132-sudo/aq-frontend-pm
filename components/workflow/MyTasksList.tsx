'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import {
  updateTaskFields, isRequestSubtaskKind, taskRowColor,
  useCrmTasks, completeCrmTask, type PMTask, type CrmTask,
} from '@/hooks/use-workflow';
import { followUpUrgency } from '@/lib/crm-sync';

const supabase = createClient();

/**
 * Tasks the current user is on the hook for: directly assigned, or in
 * task_members. Includes both parent and child tasks (members work on
 * the per-step subtasks; key accounts review the parents).
 *
 * Phase 3: subtasks are NESTED under their parent campaign rather than
 * listed flat. The parent is the source of truth, so it is always shown
 * — even when the user isn't on the parent themselves, in which case it
 * renders as a dimmed context header with no actions of its own.
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
  /** Ids that are genuinely *mine*. Anything else in `tasks` is context. */
  const [mineIds, setMineIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
          // task_members is not workspace-scoped, so scope it here — otherwise
          // membership in another workspace leaks rows into this list.
          .eq('workspace_id', workspaceId)
          .in('id', memberTaskIds);
        if (tmErr) throw tmErr;
        memberTasks = (data || []) as PMTask[];
      }

      const merged = new Map<string, PMTask>();
      [...(assigned || []), ...memberTasks].forEach((t: any) => merged.set(t.id, t as PMTask));
      const mine = new Set(merged.keys());

      // Pull in any parent I'm not personally on, so its subtasks have
      // something to nest under. Best-effort: if RLS hides the parent the
      // child simply renders at the top level instead.
      const missingParentIds = Array.from(new Set(
        Array.from(merged.values())
          .map((t) => t.parent_task_id)
          .filter((id): id is string => Boolean(id) && !merged.has(id as string)),
      ));
      if (missingParentIds.length) {
        const { data: parents } = await supabase
          .from('pm_tasks')
          .select('*')
          .in('id', missingParentIds);
        (parents || []).forEach((p: any) => {
          if (!merged.has(p.id)) merged.set(p.id, p as PMTask);
        });
      }

      setTasks(Array.from(merged.values()));
      setMineIds(mine);
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

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Group children under their parent ──────────────────────────────
  // `roots` holds real parents plus any orphan child whose parent we
  // couldn't load. Children are ordered by `position`, the same order the
  // task detail panel uses.
  const { roots, childrenByParent } = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const kids = new Map<string, PMTask[]>();
    const tops: PMTask[] = [];
    tasks.forEach((t) => {
      if (t.parent_task_id && byId.has(t.parent_task_id)) {
        const arr = kids.get(t.parent_task_id) ?? [];
        arr.push(t);
        kids.set(t.parent_task_id, arr);
      } else {
        tops.push(t);
      }
    });
    kids.forEach((arr) => arr.sort((a, b) =>
      (a.position ?? 0) - (b.position ?? 0) ||
      String(a.created_at).localeCompare(String(b.created_at))
    ));
    return { roots: tops, childrenByParent: kids };
  }, [tasks]);

  const q = query.trim().toLowerCase();
  const matches = (t: PMTask) => !q || [
    t.task_name, t.title, t.brand_name, t.legacy_client_id,
    t.id, t.description, t.stage, t.priority, t.status, t.subtask_kind,
  ].some((v) => String(v || '').toLowerCase().includes(q));

  // A parent that matches keeps ALL of its children (you searched for the
  // campaign — you want the campaign). A parent that doesn't match is kept
  // only as a header for whichever children DO match.
  const groups = useMemo(() => {
    return roots.map((parent) => {
      const children = childrenByParent.get(parent.id) ?? [];
      if (!q) return { parent, children };
      if (matches(parent)) return { parent, children };
      const hits = children.filter(matches);
      return hits.length ? { parent, children: hits } : null;
    }).filter((g): g is { parent: PMTask; children: PMTask[] } => g !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roots, childrenByParent, q]);

  const shownMineCount = useMemo(
    () => groups.reduce(
      (acc, g) =>
        acc + (mineIds.has(g.parent.id) ? 1 : 0)
            + g.children.filter((c) => mineIds.has(c.id)).length,
      0,
    ),
    [groups, mineIds],
  );

  if (loading) return <div className="aq-card" style={{ padding: 24, color: 'var(--aq-text-muted)' }}>Loading your tasks…</div>;

  if (error) {
    return (
      <div className="aq-card" style={{ padding: 24 }}>
        <div className="aq-badge aq-badge-error">Error</div>
        <p style={{ marginTop: 10, fontSize: 14, color: 'var(--aq-text-secondary)' }}>{error}</p>
      </div>
    );
  }

  if (!mineIds.size) {
    // Campaign work may be empty while CRM follow-ups are not. Saying
    // "nothing on your plate" over three overdue follow-ups is exactly the
    // invisibility this section exists to fix.
    return (
      <>
        <FollowUps
          workspaceId={workspaceId}
          userId={userId}
          refreshKey={refreshKey}
        />
        <div className="aq-card" style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)', marginTop: 12 }}>
          No campaign work assigned to you.
        </div>
      </>
    );
  }

  // One task row. `context` = shown only so its children have a home.
  // Deliberately a plain render function, not a nested component — a nested
  // component would be a new type on every render and remount every row on
  // each keystroke in the search box.
  const renderTaskRow = (t: PMTask, context: boolean, child = false) => {
    const done = t.status === 'done';
    // Shared with the detail panel so the two can't drift apart.
    const isRequest = isRequestSubtaskKind(t.subtask_kind);
    // Subtask kind if it has one, else priority. Same palette as the detail
    // panel, so a vendor row is the same teal wherever you meet it.
    const accent = taskRowColor(t);
    return (
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        padding: child ? '9px 12px' : '12px 14px',
        borderRadius: 'var(--aq-radius)',
        border: '1px solid var(--aq-border-light)',
        borderLeft: `4px solid ${accent.solid}`,
        background: done ? 'var(--aq-accent-light)'
          : context ? 'var(--aq-bg-sunken)'
          : 'var(--aq-bg-elevated)',
        opacity: context ? 0.75 : 1,
      }}>
        <button
          type="button"
          onClick={() => onOpen?.(t.id)}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent',
            border: 'none', padding: 0, cursor: onOpen ? 'pointer' : 'default',
            fontFamily: 'inherit', color: 'inherit',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          <strong style={{
            fontSize: child ? 13 : 14,
            fontWeight: child ? 600 : 700,
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {t.task_name || t.title}
          </strong>
          <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            {context
              ? 'Not assigned to you — shown for context'
              : (
                <>
                  {t.brand_name ? `${t.brand_name} · ` : ''}
                  stage {t.stage} · priority {t.priority}
                </>
              )}
          </span>
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {isRequest && (
            <span className={`aq-badge ${
              t.request_status === 'fulfilled' ? 'aq-badge-success'
              : t.request_status === 'requested' ? 'aq-badge-warning'
              : 'aq-badge-muted'
            }`}>
              {String(t.request_status ?? 'not_requested').replace('_', ' ')}
            </span>
          )}
          {!context && (
            <span className={`aq-badge ${done ? 'aq-badge-success' : 'aq-badge-muted'}`}>{t.status}</span>
          )}
          {!context && !done && (
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={(e) => { e.stopPropagation(); markDone(t.id); }}
              disabled={busyId === t.id}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >{busyId === t.id ? '…' : 'Mark done'}</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
    <FollowUps workspaceId={workspaceId} userId={userId} refreshKey={refreshKey} />
    <div className="aq-card animate-fade-in" style={{ padding: 20, marginTop: 12 }}>
      <header style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>My tasks</h2>
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {shownMineCount} of {mineIds.size} task{mineIds.size === 1 ? '' : 's'} shown, grouped by campaign.
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

      {groups.length === 0 && (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          Nothing matches “{query}”.
        </p>
      )}

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.map(({ parent, children }) => {
          const isContext = !mineIds.has(parent.id);
          const isCollapsed = collapsed.has(parent.id);
          const doneKids = children.filter((c) => c.status === 'done').length;
          return (
            <li key={parent.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {renderTaskRow(parent, isContext)}

              {children.length > 0 && (
                <div style={{ display: 'flex', gap: 8, paddingLeft: 14 }}>
                  {/* Rail connecting the subtasks to their campaign. */}
                  <div aria-hidden style={{
                    width: 2, flexShrink: 0, borderRadius: 1,
                    background: 'var(--aq-border-light)',
                  }} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(parent.id)}
                      style={{
                        alignSelf: 'flex-start',
                        background: 'transparent', border: 'none', padding: '2px 0',
                        cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 12, color: 'var(--aq-text-muted)',
                      }}
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? '▸' : '▾'} {children.length} subtask{children.length === 1 ? '' : 's'}
                      {doneKids > 0 ? ` · ${doneKids} done` : ''}
                    </button>
                    {!isCollapsed && (
                      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {children.map((c) => (
                          <li key={c.id}>
                            {renderTaskRow(c, !mineIds.has(c.id), true)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
    </>
  );
}

/**
 * CRM follow-ups assigned to you.
 *
 * They used to exist only inside the CRM screen, which made a follow-up a
 * promise to yourself that nothing ever reminded you about. They sit above
 * campaign work rather than mixed into it, because a call to make and a
 * subtask to deliver are different kinds of obligation and merging them
 * makes both harder to scan.
 */
function FollowUps({
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
