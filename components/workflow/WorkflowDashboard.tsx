'use client';

import { useMemo } from 'react';
import {
  useWorkspaceStats, useRecentActivity, useTaskCountsByMember,
  useWorkflowTasks, type Profile, type WorkspaceRole,
} from '@/hooks/use-workflow';

/**
 * Home dashboard — replaces the role-default landing page.
 * Stat cards, my-tasks-at-a-glance, recent activity, member workload.
 */
export function WorkflowDashboard({
  workspaceId, userId, userName, role, profiles, onOpenTask, onGoTo,
}: {
  workspaceId: string;
  userId: string;
  userName: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  onOpenTask: (id: string) => void;
  onGoTo: (view: 'inbox' | 'marketing-triage' | 'all-tasks' | 'my-tasks' | 'team' | 'new-task') => void;
}) {
  const roleLabel = (value: string | null | undefined) => value === 'key_account' ? 'Key account' : value;
  const { stats } = useWorkspaceStats(workspaceId, userId);
  const { items: activity } = useRecentActivity(workspaceId, 10);
  const { counts } = useTaskCountsByMember(workspaceId);
  const { tasks: allTasks } = useWorkflowTasks(workspaceId, 'all');

  const myTasks = useMemo(
    () => allTasks
      .filter((t: any) => t.assignee_id === userId || t.key_account_id === userId || t.creator_id === userId)
      .filter((t: any) => t.status !== 'done')
      .slice(0, 6),
    [allTasks, userId],
  );

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const greeting = makeGreeting();

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header>
        <h2 style={{ fontSize: 24, fontWeight: 800 }}>{greeting}, {userName.split(' ')[0]}.</h2>
        <p style={{ color: 'var(--aq-text-secondary)', marginTop: 4 }}>
          Here's what's happening in {role ? `your ${roleLabel(role)} view of ` : ''}AQ Creativity.
        </p>
      </header>

      {/* Stat cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Stat label="My tasks"          value={stats.mine}             onClick={() => onGoTo('my-tasks')} />
        <Stat label="Overdue"           value={stats.overdue}          tone={stats.overdue ? 'error' : 'default'} />
        <Stat label="Due today"         value={stats.dueToday}         tone={stats.dueToday ? 'warning' : 'default'} />
        <Stat label="Pending triage"    value={stats.pendingMarketing} onClick={() => onGoTo('marketing-triage')} tone={stats.pendingMarketing ? 'info' : 'default'} />
      </section>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <Stat label="Tasks completed"   value={stats.completed} sub={`of ${stats.total} total`} tone="success" />
        <Stat label="In progress"       value={stats.inProgress} />
        <Stat label="Total tasks"       value={stats.total}        onClick={() => onGoTo('all-tasks')} />
      </section>

      {/* My tasks + Activity */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="aq-card" style={{ padding: 20 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>My tasks</h3>
            <button className="aq-btn aq-btn-ghost" onClick={() => onGoTo('my-tasks')} style={{ padding: '4px 10px', fontSize: 12 }}>
              View all
            </button>
          </header>
          {myTasks.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              No active tasks assigned to you. Enjoy it.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {myTasks.map((t: any) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t.id)}
                          style={rowBtnStyle}>
                    <div>
                      <strong style={{ fontSize: 13 }}>{t.task_name || t.title}</strong>
                      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                        {t.brand_name ? `${t.brand_name} · ` : ''}
                        stage {String(t.stage).replace('_',' ')} · priority {t.priority}
                      </div>
                    </div>
                    <span className={`aq-badge ${t.stage === 'completed' ? 'aq-badge-success' : 'aq-badge-info'}`}>
                      {String(t.stage).replace('_',' ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="aq-card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Recent activity</h3>
          {activity.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>No recent activity.</p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activity.map((a) => {
                const who = profileById.get(a.user_id);
                return (
                  <li key={a.id} style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>
                    <strong>{who?.full_name ?? 'Someone'}</strong> {humanAction(a.action)}
                    <span style={{ color: 'var(--aq-text-muted)', marginLeft: 6 }}>· {new Date(a.created_at).toLocaleDateString()}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Team workload */}
      {profiles.length > 0 && (
        <section className="aq-card" style={{ padding: 20 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Team workload</h3>
            <button className="aq-btn aq-btn-ghost" onClick={() => onGoTo('team')} style={{ padding: '4px 10px', fontSize: 12 }}>
              Open team
            </button>
          </header>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {profiles.map((p) => {
              const c = counts[p.id] ?? 0;
              return (
                <div key={p.id} style={{
                  padding: '10px 14px', borderRadius: 'var(--aq-radius)',
                  border: '1px solid var(--aq-border-light)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.full_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{roleLabel(p.role)}</div>
                  </div>
                  <span className={`aq-badge ${c > 5 ? 'aq-badge-warning' : c > 0 ? 'aq-badge-info' : 'aq-badge-muted'}`}>
                    {c} task{c === 1 ? '' : 's'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({
  label, value, sub, tone = 'default', onClick,
}: {
  label: string; value: number | string; sub?: string;
  tone?: 'default' | 'success' | 'warning' | 'error' | 'info';
  onClick?: () => void;
}) {
  const palette = {
    default: { bg: 'var(--aq-bg-elevated)', accent: 'var(--aq-text)' },
    success: { bg: 'var(--aq-bg-elevated)', accent: 'var(--aq-accent)' },
    warning: { bg: 'var(--aq-bg-elevated)', accent: '#ca8a04' },
    error:   { bg: 'var(--aq-bg-elevated)', accent: 'var(--aq-error)' },
    info:    { bg: 'var(--aq-bg-elevated)', accent: '#0284c7' },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="aq-card"
      style={{
        padding: 18, textAlign: 'left',
        background: palette.bg, fontFamily: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        border: '1px solid var(--aq-border-light)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 28, fontWeight: 800, color: palette.accent }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 2 }}>{sub}</div>}
    </button>
  );
}

const rowBtnStyle: React.CSSProperties = {
  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '10px 12px', borderRadius: 'var(--aq-radius)',
  border: '1px solid var(--aq-border-light)', background: 'transparent',
  cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
};

function makeGreeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function humanAction(a: string) {
  const m: Record<string, string> = {
    created: 'created a task',
    updated: 'updated a task',
    deleted: 'deleted a task',
    completed: 'completed a task',
    assigned: 'assigned a task',
    unassigned: 'unassigned a task',
    commented: 'left a comment',
    moved: 'moved a task',
    status_changed: 'changed task status',
    priority_changed: 'changed priority',
  };
  return m[a] ?? a;
}
