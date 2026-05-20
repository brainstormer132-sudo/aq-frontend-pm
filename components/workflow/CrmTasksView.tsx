'use client';

import { useMemo, useState } from 'react';
import {
  useCrmTasks, completeCrmTask, uncompleteCrmTask, deleteCrmTask,
  useCrmDeals, useClients, useLegacyVendors,
  type CrmTask,
} from '@/hooks/use-workflow';
import { CrmTaskEditor } from './CrmTaskEditor';

/**
 * CRM Tasks view — calendar-style follow-up list.
 *
 * Tabs:
 *  - Mine        → tasks assigned to the current user
 *  - All         → workspace-wide tasks
 *
 * Filters: hide/show completed.
 * Groups: Overdue · Today · This week · Later · No date · Completed.
 */
type Filter = 'mine' | 'all';

export function CrmTasksView({
  workspaceId, currentUserId, currentUserName,
}: {
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
}) {
  const [filter, setFilter] = useState<Filter>('mine');
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [creating, setCreating] = useState(false);

  const { items: tasks, loading, refetch } = useCrmTasks(workspaceId, {
    assignedTo: filter === 'mine' ? currentUserId : undefined,
    includeCompleted,
  });

  const { items: deals } = useCrmDeals(workspaceId);
  const { clients } = useClients();
  const { vendors } = useLegacyVendors();

  // Lookups so cards render names instead of bare ids.
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    (deals || []).forEach((d) => m.set(`deal:${d.id}`, d.name));
    (clients || []).forEach((c) => m.set(`client:${c.id}`, c.company_name));
    (vendors || []).forEach((v) => m.set(`vendor:${v.id}`, v.name));
    return m;
  }, [deals, clients, vendors]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => {
      const hay = [
        t.title, t.description, t.assigned_to_name, t.created_by_name,
        t.target_id ? labels.get(`${t.target_type}:${t.target_id}`) : '',
        t.deal_id ? labels.get(`deal:${t.deal_id}`) : '',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, query, labels]);

  const buckets = useMemo(() => groupTasks(filtered), [filtered]);

  const handleComplete = async (t: CrmTask) => {
    try {
      if (t.completed_at) await uncompleteCrmTask(t.id);
      else                await completeCrmTask(t.id, currentUserId);
      await refetch();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    try {
      await deleteCrmTask(id);
      setEditing(null);
      await refetch();
    } catch (e: any) {
      alert(e?.message ?? String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginRight: 'auto' }}>Follow-ups</h2>

        <div style={{ display: 'flex', gap: 4, background: 'var(--aq-bg-sunken)', padding: 4, borderRadius: 999 }}>
          <SegBtn active={filter === 'mine'} onClick={() => setFilter('mine')}>Mine</SegBtn>
          <SegBtn active={filter === 'all'}  onClick={() => setFilter('all')}>All</SegBtn>
        </div>

        <input
          className="aq-input"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--aq-text-muted)' }}>
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
          />
          Show completed
        </label>

        <button
          type="button"
          className="aq-btn aq-btn-primary"
          onClick={() => setCreating(true)}
        >+ New task</button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--aq-text-muted)' }}>Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="aq-card" style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          {filter === 'mine'
            ? 'You have no follow-ups right now. Use "New task" to add one.'
            : 'No tasks match your filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {BUCKET_ORDER.map((b) => {
            const arr = buckets[b];
            if (!arr || !arr.length) return null;
            return (
              <section key={b} className="aq-card" style={{ padding: 0 }}>
                <header style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--aq-border-light)',
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'baseline',
                  background: bucketColor(b),
                  borderTopLeftRadius: 'var(--aq-radius)',
                  borderTopRightRadius: 'var(--aq-radius)',
                }}>
                  <strong style={{ fontSize: 13, color: bucketTextColor(b) }}>
                    {BUCKET_LABEL[b]}
                  </strong>
                  <span style={{ fontSize: 11, color: bucketTextColor(b), opacity: 0.85 }}>
                    {arr.length} {arr.length === 1 ? 'task' : 'tasks'}
                  </span>
                </header>
                <ul style={{ listStyle: 'none' }}>
                  {arr.map((t) => (
                    <li key={t.id} style={{ borderTop: '1px solid var(--aq-border-light)' }}>
                      <TaskRow
                        task={t}
                        contactLabel={t.target_id ? labels.get(`${t.target_type}:${t.target_id}`) || null : null}
                        dealLabel={t.deal_id ? labels.get(`deal:${t.deal_id}`) || null : null}
                        onToggle={() => handleComplete(t)}
                        onClick={() => setEditing(t)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {(editing || creating) && (
        <CrmTaskEditor
          mode={editing ? 'edit' : 'create'}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          task={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await refetch(); }}
          onDelete={editing ? () => handleDelete(editing.id) : undefined}
        />
      )}
    </div>
  );
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 14px',
        background: active ? '#0b0b0e' : 'transparent',
        color: active ? '#fff' : 'var(--aq-text-muted)',
        border: 'none', borderRadius: 999,
        fontWeight: 700, fontSize: 12,
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >{children}</button>
  );
}

function TaskRow({
  task, contactLabel, dealLabel, onToggle, onClick,
}: {
  task: CrmTask;
  contactLabel: string | null;
  dealLabel: string | null;
  onToggle: () => void;
  onClick: () => void;
}) {
  const isDone = !!task.completed_at;
  const overdue = !isDone && task.due_at && new Date(task.due_at) < new Date();
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 14px',
    }}>
      <input
        type="checkbox"
        checked={isDone}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 4, cursor: 'pointer' }}
      />
      <button
        type="button"
        onClick={onClick}
        style={{
          flex: 1, textAlign: 'left',
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <strong style={{
            fontSize: 14, color: isDone ? 'var(--aq-text-muted)' : 'var(--aq-text)',
            textDecoration: isDone ? 'line-through' : 'none',
          }}>{task.title}</strong>
          <span style={{
            fontSize: 11,
            color: overdue ? '#b91c1c' : 'var(--aq-text-muted)',
            fontWeight: overdue ? 700 : 400,
          }}>
            {task.due_at ? formatWhen(task.due_at) : 'no date'}
          </span>
        </div>
        {task.description && (
          <p style={{ marginTop: 3, fontSize: 12, color: 'var(--aq-text-muted)' }}>
            {task.description.length > 140 ? task.description.slice(0, 137) + '…' : task.description}
          </p>
        )}
        <div style={{
          display: 'flex', gap: 6, marginTop: 4, fontSize: 10, alignItems: 'center', flexWrap: 'wrap',
        }}>
          {task.assigned_to_name && (
            <span className="aq-badge aq-badge-muted" style={{ fontSize: 10 }}>
              {task.assigned_to_name}
            </span>
          )}
          {dealLabel && (
            <span className="aq-badge aq-badge-info" style={{ fontSize: 10 }}>
              Deal · {dealLabel}
            </span>
          )}
          {contactLabel && (
            <span className="aq-badge aq-badge-success" style={{ fontSize: 10, textTransform: 'capitalize' }}>
              {task.target_type} · {contactLabel}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

// ─── Grouping helpers ────────────────────────────────────────────────
type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none' | 'done';

const BUCKET_ORDER: Bucket[] = ['overdue', 'today', 'week', 'later', 'none', 'done'];
const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue',
  today:   'Today',
  week:    'This week',
  later:   'Later',
  none:    'No date',
  done:    'Completed',
};

function bucketColor(b: Bucket): string {
  switch (b) {
    case 'overdue': return '#fee2e2';
    case 'today':   return '#fef3c7';
    case 'week':    return '#dbeafe';
    case 'later':   return 'var(--aq-bg-sunken)';
    case 'none':    return 'var(--aq-bg-sunken)';
    case 'done':    return 'var(--aq-bg-sunken)';
  }
}
function bucketTextColor(b: Bucket): string {
  switch (b) {
    case 'overdue': return '#991b1b';
    case 'today':   return '#92400e';
    case 'week':    return '#1e40af';
    default:        return 'var(--aq-text-secondary)';
  }
}

function groupTasks(tasks: CrmTask[]): Record<Bucket, CrmTask[]> {
  const out: Record<Bucket, CrmTask[]> = {
    overdue: [], today: [], week: [], later: [], none: [], done: [],
  };
  const now = new Date();
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const inOneWeek = new Date(now.getTime() + 7 * 86_400_000);

  for (const t of tasks) {
    if (t.completed_at) { out.done.push(t); continue; }
    if (!t.due_at) { out.none.push(t); continue; }
    const due = new Date(t.due_at);
    if (due < now)          out.overdue.push(t);
    else if (due <= endOfToday) out.today.push(t);
    else if (due <= inOneWeek)  out.week.push(t);
    else                    out.later.push(t);
  }
  return out;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
  if (sameDay) return `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (Math.abs(diffDays) < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString();
}
