'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceStats, useRecentActivity, useTaskCountsByMember,
  useWorkflowTasks, useCrmTasks,
  usePmTaskCampaignRollup,
  type Profile, type WorkspaceRole, type PmTaskCampaignRollup,
} from '@/hooks/use-workflow';
import { countFollowUps } from '@/lib/crm-sync';
import { FollowUps } from './FollowUps';

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
  onGoTo: (view: 'inbox' | 'marketing-triage' | 'all-tasks' | 'team' | 'new-task') => void;
}) {
  const roleLabel = (value: string | null | undefined) => value === 'key_account' ? 'Key account' : value;
  const { stats } = useWorkspaceStats(workspaceId, userId);
  const { items: activity } = useRecentActivity(workspaceId, 10);
  const { counts } = useTaskCountsByMember(workspaceId);
  const { tasks: allTasks } = useWorkflowTasks(workspaceId, 'all');
  const { rows: campaignRollup } = usePmTaskCampaignRollup(workspaceId);

  const myTasks = useMemo(
    () => allTasks
      .filter((t: any) => t.assignee_id === userId || t.key_account_id === userId || t.creator_id === userId)
      .filter((t: any) => t.status !== 'done')
      .slice(0, 6),
    [allTasks, userId],
  );

  // CRM follow-ups count as work. They were invisible outside the CRM
  // screen, so "Overdue 0" could be true of campaigns and wrong about you.
  const { items: followUps } = useCrmTasks(workspaceId, { assignedTo: userId });
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);
  const crm = useMemo(
    () => (today ? countFollowUps(followUps || [], today) : { overdue: 0, today: 0, open: 0 }),
    [followUps, today],
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

      {/* Follow-ups moved here when My Tasks was retired — the counters above
          already count them, so this is where they belong. */}
      <FollowUps workspaceId={workspaceId} userId={userId} />

      {/* Stat cards */}
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <Stat label="My tasks"          value={stats.mine + crm.open}  onClick={() => onGoTo('all-tasks')} />
        <Stat label="Overdue"           value={stats.overdue + crm.overdue} tone={stats.overdue + crm.overdue ? 'error' : 'default'} />
        <Stat label="Due today"         value={stats.dueToday + crm.today}  tone={stats.dueToday + crm.today ? 'warning' : 'default'} />
        <Stat label="Pending triage"    value={stats.pendingMarketing} onClick={() => onGoTo('marketing-triage')} tone={stats.pendingMarketing ? 'info' : 'default'} />
      </section>
      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <Stat label="Tasks completed"   value={stats.completed} sub={`of ${stats.total} total`} tone="success" />
        <Stat label="In progress"       value={stats.inProgress} />
        <Stat label="Total tasks"       value={stats.total}        onClick={() => onGoTo('all-tasks')} />
      </section>

      {/* Campaign rollup — sum of price/net/gross per parent campaign.
          Reads the pm_task_campaign_rollup view from migration 028.
          Hidden when no campaigns have any operations data yet. */}
      {campaignRollup.length > 0 && (
        <CampaignRollupSection rows={campaignRollup} onOpenTask={onOpenTask} />
      )}

      {/* My tasks + Activity */}
      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="aq-card" style={{ padding: 20 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>My tasks</h3>
            <button className="aq-btn aq-btn-ghost" onClick={() => onGoTo('all-tasks')} style={{ padding: '4px 10px', fontSize: 12 }}>
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

/**
 * Per-campaign rollup row. Reads from the `pm_task_campaign_rollup` view
 * (migration 028). One row per parent task with Σ price / Σ net /
 * Σ AQ gross / vendor count, plus a variance badge that lights up
 * when the sum of child prices doesn't match the parent's manually-
 * entered Total Amount (the same data-entry check the ops team currently
 * does by re-reading the Asana export).
 */
function CampaignRollupSection({
  rows, onOpenTask,
}: {
  rows: PmTaskCampaignRollup[];
  onOpenTask: (id: string) => void;
}) {
  // Hide campaigns with zero vendors AND zero parent total — they're
  // either blank parents that someone abandoned, or new ones with nothing
  // entered yet. Show the rest sorted by Σ prices descending so the
  // biggest deals are at the top.
  const interesting = rows
    .filter((r) => r.vendor_count > 0 || (r.parent_total_amount ?? 0) > 0)
    .sort((a, b) => (b.sum_prices || 0) - (a.sum_prices || 0))
    .slice(0, 8);

  if (interesting.length === 0) return null;

  const total = (key: 'sum_prices' | 'sum_nets' | 'sum_aq_gross') =>
    interesting.reduce((acc, r) => acc + (r[key] || 0), 0);

  const money = (n: number | null | undefined) =>
    n == null ? '—' : `SAR ${Math.round(Number(n)).toLocaleString()}`;

  return (
    <section className="aq-card" style={{ padding: 20 }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12, gap: 12, flexWrap: 'wrap',
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 700 }}>Active campaigns</h3>
        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
          Σ prices <strong style={{ color: 'var(--aq-text)' }}>{money(total('sum_prices'))}</strong>
          {' · '}Σ nets <strong style={{ color: 'var(--aq-text)' }}>{money(total('sum_nets'))}</strong>
          {' · '}Σ AQ gross <strong style={{ color: 'var(--aq-accent)' }}>{money(total('sum_aq_gross'))}</strong>
        </span>
      </header>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ color: 'var(--aq-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={th}>Campaign</th>
              <th style={th}>Vendors</th>
              <th style={{ ...th, textAlign: 'right' }}>Σ Prices</th>
              <th style={{ ...th, textAlign: 'right' }}>Σ Nets</th>
              <th style={{ ...th, textAlign: 'right' }}>Σ AQ Gross</th>
              <th style={{ ...th, textAlign: 'right' }}>Margin</th>
              <th style={th}>Variance</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {interesting.map((r) => {
              const margin = r.sum_prices > 0
                ? Math.round((r.sum_aq_gross / r.sum_prices) * 100)
                : null;
              const variance = Number(r.price_vs_total_variance || 0);
              const mismatch = Math.abs(variance) > 1;  // SAR 1 tolerance for rounding
              return (
                <tr
                  key={r.parent_task_id}
                  onClick={() => onOpenTask(r.parent_task_id)}
                  style={{ cursor: 'pointer', borderTop: '1px solid var(--aq-border-light)' }}
                >
                  <td style={td}>
                    <strong>{r.title}</strong>
                    {r.brand_name && (
                      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{r.brand_name}</div>
                    )}
                  </td>
                  <td style={td}>
                    {r.vendors_done}/{r.vendor_count}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.sum_prices)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(r.sum_nets)}</td>
                  <td style={{
                    ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                    color: r.sum_aq_gross > 0 ? 'var(--aq-accent)' : 'var(--aq-text-muted)',
                    fontWeight: 700,
                  }}>{money(r.sum_aq_gross)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {margin == null ? '—' : (
                      <span className={`aq-badge ${margin >= 30 ? 'aq-badge-success' : margin >= 15 ? 'aq-badge-info' : 'aq-badge-warning'}`}>
                        {margin}%
                      </span>
                    )}
                  </td>
                  <td style={td}>
                    {mismatch ? (
                      <span
                        className="aq-badge aq-badge-warning"
                        title={`Σ prices ${money(r.sum_prices)} vs Total ${money(r.parent_total_amount)} — someone forgot to update one of them`}
                      >
                        {variance > 0 ? '+' : ''}{money(variance)}
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>OK</span>
                    )}
                  </td>
                  <td style={td}>
                    {r.contract_status && (
                      <span className="aq-badge aq-badge-muted" style={{ marginRight: 6 }}>
                        {r.contract_status}
                      </span>
                    )}
                    {r.client_payment_status && (
                      <span className={`aq-badge ${r.client_payment_status === 'paid' ? 'aq-badge-success' : 'aq-badge-warning'}`}>
                        {r.client_payment_status}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontWeight: 700,
  borderBottom: '1px solid var(--aq-border-light)',
};
const td: React.CSSProperties = {
  padding: '10px', verticalAlign: 'top',
};

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
