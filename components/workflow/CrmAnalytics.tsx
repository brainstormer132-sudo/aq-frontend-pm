'use client';

import { useMemo } from 'react';
import {
  useCrmDeals, useCrmTasks, useCrmRecentActivities,
  DEAL_STAGES, type CrmDeal, type DealStage, type CrmTask, type CrmActivity,
} from '@/hooks/use-workflow';

/**
 * CRM Analytics — pipeline + activity reporting.
 *
 * Layout:
 *   1. Pipeline summary stats (open value, weighted pipeline, won this Qtr,
 *      win rate, avg deal size, avg cycle time).
 *   2. Stage funnel — bar per stage with count + total $.
 *   3. Leaderboards — by owner: open value, won value (last 90d), deal count.
 *   4. Activity report — counts by kind (note/call/meeting/email) over the
 *      last 90 days, plus a tiny sparkline of activity-per-week.
 *   5. Tasks report — overdue count, due-this-week count, oldest open task.
 *
 * All maths is client-side from the existing hooks — no extra fetches.
 */
export function CrmAnalytics({ workspaceId }: { workspaceId: string }) {
  const { items: deals, loading: dealsLoading } = useCrmDeals(workspaceId);
  const { items: tasks, loading: tasksLoading } = useCrmTasks(workspaceId, { includeCompleted: true });
  const { items: activities, loading: actLoading } = useCrmRecentActivities(workspaceId, 500);

  const m = useMemo(() => computeMetrics(deals, tasks, activities), [deals, tasks, activities]);

  if (dealsLoading || tasksLoading || actLoading) {
    return <p style={{ color: 'var(--aq-text-muted)' }}>Loading analytics…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800 }}>Pipeline analytics</h2>

      {/* Top stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
      }}>
        <StatCard label="Open pipeline"      value={fmtMoney(m.openValue)}    sub={`${m.openCount} deals`} />
        <StatCard label="Weighted forecast"  value={fmtMoney(m.weightedValue)} sub="probability-weighted" />
        <StatCard label="Won — last 90d"     value={fmtMoney(m.wonValue90)}    sub={`${m.wonCount90} closed`} accent="#15803d" />
        <StatCard label="Win rate"           value={`${Math.round(m.winRate * 100)}%`} sub="won vs won+lost" />
        <StatCard label="Avg deal size"      value={fmtMoney(m.avgDealSize)}   sub="all-time" />
        <StatCard label="Avg cycle (days)"   value={m.avgCycleDays ? String(m.avgCycleDays) : '—'} sub="prospect → won" />
      </div>

      {/* Stage funnel */}
      <section className="aq-card" style={{ padding: 18 }}>
        <header style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>Stage funnel</strong>
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            Open + closed deals grouped by stage.
          </div>
        </header>
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DEAL_STAGES.map((s) => {
            const row = m.byStage[s.key];
            const pct = m.maxStageValue > 0 ? Math.round((row.value / m.maxStageValue) * 100) : 0;
            return (
              <li key={s.key} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 120px', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: stageColor(s.key) }}>{s.label}</span>
                <div style={{
                  background: 'var(--aq-bg-sunken)', height: 16, borderRadius: 999,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%',
                    background: stageColor(s.key),
                    transition: 'width 200ms',
                  }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', textAlign: 'right' }}>
                  {row.count} · {fmtMoney(row.value)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Owner leaderboard */}
      <section className="aq-card" style={{ padding: 18 }}>
        <header style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 14 }}>Owner leaderboard</strong>
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            Open + won-this-quarter pipeline value, per deal owner.
          </div>
        </header>
        {m.owners.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>No deals yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--aq-text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={th}>Owner</th>
                <th style={thR}>Open</th>
                <th style={thR}>Won 90d</th>
                <th style={thR}>Lost 90d</th>
                <th style={thR}>Deals</th>
              </tr>
            </thead>
            <tbody>
              {m.owners.map((o) => (
                <tr key={o.name} style={{ borderTop: '1px solid var(--aq-border-light)' }}>
                  <td style={td}><strong>{o.name}</strong></td>
                  <td style={tdR}>{fmtMoney(o.openValue)}</td>
                  <td style={{ ...tdR, color: '#15803d', fontWeight: 600 }}>{fmtMoney(o.wonValue90)}</td>
                  <td style={{ ...tdR, color: '#991b1b' }}>{fmtMoney(o.lostValue90)}</td>
                  <td style={tdR}>{o.dealCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Two columns: Activity & Tasks reporting */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: 12,
      }}>
        {/* Activity */}
        <section className="aq-card" style={{ padding: 18 }}>
          <header style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Activity — last 90 days</strong>
            <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
              {m.activity90Total} total touchpoints across all clients & vendors.
            </div>
          </header>
          {Object.keys(m.activityByKind).length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>No activity logged yet.</p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(m.activityByKind).sort((a,b) => b[1] - a[1]).map(([kind, count]) => {
                  const pct = m.activity90Total > 0 ? Math.round((count / m.activity90Total) * 100) : 0;
                  return (
                    <li key={kind} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 60px', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{kindIcon(kind)} {kind}</span>
                      <div style={{ background: 'var(--aq-bg-sunken)', height: 10, borderRadius: 999 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--aq-accent)', borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)', textAlign: 'right' }}>{count}</span>
                    </li>
                  );
                })}
              </ul>
              <Sparkline points={m.weeklyActivity} />
            </>
          )}
        </section>

        {/* Tasks */}
        <section className="aq-card" style={{ padding: 18 }}>
          <header style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 14 }}>Follow-up health</strong>
            <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
              Open tasks and how on top of them the team is.
            </div>
          </header>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Open tasks"     value={String(m.tasksOpen)} />
            <Row label="Overdue"        value={String(m.tasksOverdue)} accent={m.tasksOverdue > 0 ? '#b91c1c' : undefined} />
            <Row label="Due this week"  value={String(m.tasksDueWeek)} accent={m.tasksDueWeek > 0 ? '#92400e' : undefined} />
            <Row label="Completed 30d"  value={String(m.tasksCompleted30)} accent="#15803d" />
            <Row label="Avg time to complete" value={m.avgCompleteDays ? `${m.avgCompleteDays}d` : '—'} />
            <Row label="Stuck (no due date)"  value={String(m.tasksNoDate)} />
          </ul>
        </section>
      </div>

      {/* Stuck deals */}
      {m.stuckDeals.length > 0 && (
        <section className="aq-card" style={{ padding: 18 }}>
          <header style={{ marginBottom: 10 }}>
            <strong style={{ fontSize: 14 }}>Stuck deals — no movement in 14+ days</strong>
            <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
              Open deals that haven't changed stage in a while.
            </div>
          </header>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {m.stuckDeals.slice(0, 8).map((d) => (
              <li key={d.id} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '6px 10px', borderRadius: 'var(--aq-radius)',
                background: 'var(--aq-bg-sunken)', fontSize: 13,
              }}>
                <span><strong>{d.name}</strong> <span style={{ color: 'var(--aq-text-muted)' }}>· {d.stage}</span></span>
                <span style={{ color: 'var(--aq-text-muted)' }}>{daysSince(d.stage_changed_at)} days</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── UI bits ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="aq-card" style={{ padding: 14 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--aq-text-muted)', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: accent || 'var(--aq-text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <li style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '6px 0', borderBottom: '1px dashed var(--aq-border-light)', fontSize: 13,
    }}>
      <span style={{ color: 'var(--aq-text-secondary)' }}>{label}</span>
      <strong style={{ color: accent || 'var(--aq-text)' }}>{value}</strong>
    </li>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return null;
  const max = Math.max(...points, 1);
  const w = 220, h = 36;
  const step = w / Math.max(points.length - 1, 1);
  const path = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(' ');
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginBottom: 4 }}>
        Activity per week (oldest → newest)
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
        <path d={path} fill="none" stroke="var(--aq-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ─── Metric computation ──────────────────────────────────────────────

interface StageRow { count: number; value: number; }
interface OwnerRow {
  name: string;
  dealCount: number;
  openValue: number;
  wonValue90: number;
  lostValue90: number;
}

interface Metrics {
  openCount: number;
  openValue: number;
  weightedValue: number;
  wonValue90: number;
  wonCount90: number;
  winRate: number;
  avgDealSize: number;
  avgCycleDays: number;
  byStage: Record<DealStage, StageRow>;
  maxStageValue: number;
  owners: OwnerRow[];
  activity90Total: number;
  activityByKind: Record<string, number>;
  weeklyActivity: number[];
  tasksOpen: number;
  tasksOverdue: number;
  tasksDueWeek: number;
  tasksCompleted30: number;
  tasksNoDate: number;
  avgCompleteDays: number;
  stuckDeals: CrmDeal[];
}

function computeMetrics(deals: CrmDeal[], tasks: CrmTask[], activities: CrmActivity[]): Metrics {
  const now = new Date();
  const cutoff90 = new Date(now.getTime() - 90 * 86_400_000);
  const cutoff30 = new Date(now.getTime() - 30 * 86_400_000);
  const endOfToday = new Date(now); endOfToday.setHours(23,59,59,999);
  const inOneWeek = new Date(now.getTime() + 7 * 86_400_000);

  const openDeals = deals.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const wonDeals  = deals.filter((d) => d.stage === 'won');
  const lostDeals = deals.filter((d) => d.stage === 'lost');

  const openValue = sum(openDeals.map((d) => Number(d.value || 0)));
  const weightedValue = sum(openDeals.map((d) =>
    Number(d.value || 0) * ((d.probability ?? defaultProb(d.stage)) / 100)
  ));

  const wonRecent = wonDeals.filter((d) => d.closed_at && new Date(d.closed_at) >= cutoff90);
  const lostRecent = lostDeals.filter((d) => d.closed_at && new Date(d.closed_at) >= cutoff90);
  const wonValue90 = sum(wonRecent.map((d) => Number(d.value || 0)));
  const wonCount90 = wonRecent.length;

  const totalClosed = wonDeals.length + lostDeals.length;
  const winRate = totalClosed > 0 ? wonDeals.length / totalClosed : 0;
  const avgDealSize = deals.length > 0 ? sum(deals.map((d) => Number(d.value || 0))) / deals.length : 0;

  // Average cycle time for won deals (created → closed).
  const cycles = wonDeals
    .filter((d) => d.closed_at && d.created_at)
    .map((d) => (new Date(d.closed_at!).getTime() - new Date(d.created_at).getTime()) / 86_400_000);
  const avgCycleDays = cycles.length > 0 ? Math.round(sum(cycles) / cycles.length) : 0;

  // By-stage breakdown
  const byStage = {} as Record<DealStage, StageRow>;
  DEAL_STAGES.forEach((s) => { byStage[s.key] = { count: 0, value: 0 }; });
  for (const d of deals) {
    const row = byStage[d.stage];
    if (!row) continue;
    row.count += 1;
    row.value += Number(d.value || 0);
  }
  const maxStageValue = Math.max(...Object.values(byStage).map((r) => r.value), 1);

  // Owner leaderboard
  const ownerMap = new Map<string, OwnerRow>();
  for (const d of deals) {
    const name = d.owner_name || 'Unassigned';
    let row = ownerMap.get(name);
    if (!row) {
      row = { name, dealCount: 0, openValue: 0, wonValue90: 0, lostValue90: 0 };
      ownerMap.set(name, row);
    }
    row.dealCount += 1;
    if (d.stage !== 'won' && d.stage !== 'lost') row.openValue += Number(d.value || 0);
    if (d.stage === 'won'  && d.closed_at && new Date(d.closed_at) >= cutoff90) row.wonValue90 += Number(d.value || 0);
    if (d.stage === 'lost' && d.closed_at && new Date(d.closed_at) >= cutoff90) row.lostValue90 += Number(d.value || 0);
  }
  const owners = Array.from(ownerMap.values()).sort((a, b) => (b.openValue + b.wonValue90) - (a.openValue + a.wonValue90));

  // Activity
  const recentAct = activities.filter((a) => new Date(a.occurred_at) >= cutoff90);
  const activityByKind: Record<string, number> = {};
  for (const a of recentAct) activityByKind[a.kind] = (activityByKind[a.kind] || 0) + 1;

  // Weekly bins: 13 weeks (~90d).
  const weeks = 13;
  const weeklyActivity = new Array(weeks).fill(0);
  for (const a of recentAct) {
    const wIdx = Math.min(
      weeks - 1,
      Math.floor((now.getTime() - new Date(a.occurred_at).getTime()) / (7 * 86_400_000))
    );
    weeklyActivity[weeks - 1 - wIdx] += 1;
  }

  // Tasks
  let tasksOpen = 0, tasksOverdue = 0, tasksDueWeek = 0, tasksCompleted30 = 0, tasksNoDate = 0;
  const completeDurations: number[] = [];
  for (const t of tasks) {
    if (t.completed_at) {
      if (new Date(t.completed_at) >= cutoff30) tasksCompleted30 += 1;
      if (t.due_at) {
        const d = (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 86_400_000;
        completeDurations.push(Math.max(0, d));
      }
    } else {
      tasksOpen += 1;
      if (!t.due_at) tasksNoDate += 1;
      else {
        const due = new Date(t.due_at);
        if (due < now) tasksOverdue += 1;
        else if (due <= inOneWeek) tasksDueWeek += 1;
      }
    }
  }
  const avgCompleteDays = completeDurations.length > 0
    ? Math.round(sum(completeDurations) / completeDurations.length) : 0;

  // Stuck deals
  const stuckDeals = openDeals
    .filter((d) => daysSince(d.stage_changed_at) >= 14)
    .sort((a, b) => daysSince(b.stage_changed_at) - daysSince(a.stage_changed_at));

  return {
    openCount: openDeals.length,
    openValue,
    weightedValue,
    wonValue90, wonCount90,
    winRate, avgDealSize, avgCycleDays,
    byStage, maxStageValue,
    owners,
    activity90Total: recentAct.length,
    activityByKind,
    weeklyActivity,
    tasksOpen, tasksOverdue, tasksDueWeek, tasksCompleted30, tasksNoDate,
    avgCompleteDays,
    stuckDeals,
  };
}

function sum(arr: number[]): number {
  let s = 0; for (const v of arr) s += v; return s;
}
function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}
function defaultProb(stage: DealStage): number {
  switch (stage) {
    case 'prospect':    return 10;
    case 'qualified':   return 30;
    case 'proposal':    return 55;
    case 'negotiation': return 75;
    case 'won':         return 100;
    case 'lost':        return 0;
    default:            return 10;
  }
}
function stageColor(s: DealStage): string {
  switch (s) {
    case 'prospect':    return '#64748b';
    case 'qualified':   return '#0369a1';
    case 'proposal':    return '#6d28d9';
    case 'negotiation': return '#b45309';
    case 'won':         return '#15803d';
    case 'lost':        return '#991b1b';
    default:            return '#64748b';
  }
}
function kindIcon(k: string): string {
  const map: Record<string, string> = {
    note: '📝', call: '📞', meeting: '🤝', email: '✉️', status_change: '⚑',
  };
  return map[k] || '•';
}
function fmtMoney(v: number): string {
  if (!isFinite(v) || v === 0) return 'SAR 0';
  return `SAR ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 700 };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '8px' };
const tdR: React.CSSProperties = { padding: '8px', textAlign: 'right' };
