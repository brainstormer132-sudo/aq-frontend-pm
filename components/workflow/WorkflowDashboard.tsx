'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useWorkspaceStats, useRecentActivity, useTaskCountsByMember,
  useWorkflowTasks, useCrmTasks, useOpenContractRequests,
  usePmTaskCampaignRollup,
  type Profile, type WorkspaceRole,
} from '@/hooks/use-workflow';
import { countFollowUps } from '@/lib/crm-sync';
import { attentionItems, attentionSummary, type AttentionItem, type Severity } from '@/lib/attention';
import { SkeletonRows, SkeletonLine } from '@/components/Skeleton';
import { FollowUps } from './FollowUps';

/**
 * Home.
 *
 * Rebuilt Aug 2026. It had grown seven stat tiles in two mismatched rows, a
 * money table, a team roster and two lists — everything anyone had ever
 * asked for, in the order they asked for it, with nothing more important
 * than anything else. Siraj: *"show what you need to do and if any of the
 * tasks have problems."*
 *
 * So, in order down the page:
 *
 *   1. What is wrong        — the new part. Ranked, one line each.
 *   2. What is on your desk — your tasks and your follow-ups, one list.
 *   3. How the work is going — four quiet numbers, not tiles.
 *   4. Who is carrying what — last, and small.
 *
 * The campaign money table left for the Data view, which is where anyone
 * looking for money already goes, and where it can be filtered.
 *
 * Every number here comes from rows the page already loads. Nothing added
 * to this screen costs another request — it is the first thing anyone sees
 * and the last thing that should be slow.
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
  onGoTo: (view: 'inbox' | 'marketing-triage' | 'all-tasks' | 'team' | 'new-task' | 'crm' | 'data') => void;
}) {
  const roleLabel = (v: string | null | undefined) => (v === 'key_account' ? 'Key account' : v);

  const { stats, rows, loading } = useWorkspaceStats(workspaceId, userId);
  const { items: activity } = useRecentActivity(workspaceId, 6);
  const { counts } = useTaskCountsByMember(workspaceId);
  const { tasks: allTasks } = useWorkflowTasks(workspaceId, 'all');
  const { rows: campaignRollup } = usePmTaskCampaignRollup(workspaceId);
  const { items: followUps } = useCrmTasks(workspaceId, { assignedTo: userId });
  // Contracts still out with Legal. One narrow query — open requests only —
  // and it is what lets the list chase something nothing has ever chased.
  const { sentAt: requestSentAt, status: contractStatus } = useOpenContractRequests(workspaceId);

  // Today is read after mount, never during render: the server does not know
  // what day it is where you are, and the two renders disagreeing is a
  // hydration error. The old greeting read the clock the same way.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const crm = useMemo(
    () => (today ? countFollowUps(followUps || [], today) : { overdue: 0, today: 0, open: 0 }),
    [followUps, today],
  );

  const attention = useMemo(
    () => (today
      ? attentionItems(
          { tasks: rows, rollup: campaignRollup, followUps, requestSentAt, contractStatus },
          today, { userId, limit: 7 },
        )
      : { items: [], hiddenCount: 0, counts: { urgent: 0, soon: 0, tidy: 0 } }),
    [rows, campaignRollup, followUps, requestSentAt, contractStatus, today, userId],
  );

  const myTasks = useMemo(
    () => allTasks
      .filter((t: any) => t.assignee_id === userId || t.key_account_id === userId || t.creator_id === userId)
      .filter((t: any) => t.status !== 'done' && t.stage !== 'completed')
      .slice(0, 6),
    [allTasks, userId],
  );

  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const busiest = useMemo(
    () => profiles
      .map((p) => ({ ...p, count: counts[p.id] ?? 0 }))
      .sort((a, b) => b.count - a.count),
    [profiles, counts],
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <header>
        <h2 style={{ fontSize: 24, fontWeight: 800 }}>Hello, {userName.split(' ')[0]}.</h2>
        <p style={{ color: 'var(--aq-text-secondary)', marginTop: 4, fontSize: 14 }}>
          {loading || !today
            ? 'Checking what needs your attention…'
            : attention.counts.urgent + attention.counts.soon === 0
              ? `Nothing is overdue and nothing is stuck${role ? `, in your ${roleLabel(role)} view` : ''}.`
              : attentionSummary(attention.counts)}
        </p>
      </header>

      {/* ── 1. What is wrong ──────────────────────────────────────
          The part that did not exist. A campaign with a vendor booked, no
          price on it and no contract requested used to look exactly like a
          campaign that was fine, and stayed that way until somebody opened
          it. What counts as a problem lives in lib/attention.ts. */}
      <section className="aq-card" style={{ padding: 20 }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Needs attention</h3>
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
              Ranked by severity, longest-waiting first.
            </p>
          </div>
          {attention.hiddenCount > 0 && (
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => onGoTo('all-tasks')}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >{attention.hiddenCount} more</button>
          )}
        </header>

        {loading || !today ? (
          <SkeletonRows rows={4} height={46} gap={0} label="Checking for issues" />
        ) : attention.items.length === 0 ? (
          <p style={{ fontSize: 13.5, color: 'var(--aq-text-muted)' }}>
            Nothing needs chasing — no overdue dates, no unpriced bookings, and no
            campaign whose vendors do not add up.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {attention.items.map((item, i) => (
              <li key={item.key}>
                <AttentionRow item={item} first={i === 0} onOpen={() => onOpenTask(item.taskId)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 2. What is on your desk ───────────────────────────────
          Tasks and CRM follow-ups in one place. They are both things you
          have to do, and keeping them on separate screens is how "Overdue
          0" managed to be true of campaigns and wrong about the person
          reading it. */}
      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(240px, 1fr)', gap: 16 }}>
        <div className="aq-card" style={{ padding: 20 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Assigned to you</h3>
            <button
              className="aq-btn aq-btn-ghost"
              onClick={() => onGoTo('all-tasks')}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >All tasks</button>
          </header>

          {loading ? (
            <SkeletonRows rows={4} height={44} gap={0} label="Loading your tasks" />
          ) : myTasks.length === 0 && crm.open === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>
              Nothing is assigned to you right now.
            </p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
              {myTasks.map((t: any, i: number) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t.id)} style={rowButton(i === 0)}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block', ...ellipsis }}>
                        {t.task_name || t.title}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                        {[t.brand_name, String(t.stage ?? '').replace(/_/g, ' ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {t.due_date && (
                      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', whiteSpace: 'nowrap' }}>
                        {t.due_date}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* The CRM's follow-ups, in the same list rather than a card of
              their own above everything. Ticking one here ticks it there. */}
          {crm.open > 0 && (
            <div style={{ marginTop: myTasks.length ? 0 : 4 }}>
              <FollowUps workspaceId={workspaceId} userId={userId} bare />
            </div>
          )}
        </div>

        <div className="aq-card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Recent activity</h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[0, 1, 2, 3].map((i) => (
                <SkeletonLine key={i} width={`${60 + ((i * 11) % 35)}%`} height={11} />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Nothing yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
              {activity.map((a) => (
                <li key={a.id} style={{ fontSize: 12, color: 'var(--aq-text-secondary)', lineHeight: 1.45 }}>
                  {/* The name comes with the entry now. `user_id` is null
                      when the system did it — the nightly purge — and
                      "Someone" would be wrong about that in a way that
                      matters: nobody did it, a schedule did. */}
                  <strong>{a.user_name ?? (a.user_id ? 'Someone' : 'The system')}</strong>{' '}
                  {humanAction(a.action)}
                  {a.entity_name && (
                    <>
                      {' '}
                      <span style={{
                        // Struck through once the task is really gone, so a
                        // name you cannot click is visibly a name that no
                        // longer exists rather than a broken link.
                        textDecoration: a.task_exists ? undefined : 'line-through',
                        color: a.task_exists ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                      }}>{a.entity_name}</span>
                    </>
                  )}
                  <span style={{ color: 'var(--aq-text-muted)' }}>
                    {' · '}{new Date(a.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── 3. How the work is going ──────────────────────────────
          Four numbers, deliberately quiet. Nothing happens as a result of
          reading them, so they do not get the size or the colour of the
          things that do. Triage keeps a button, because it has an action —
          and it only appears when something is actually waiting. */}
      <section className="aq-card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 28 }}>
          <Figure label="In progress" value={stats.inProgress} loading={loading} />
          <Figure label="Completed" value={stats.completed} sub={`of ${stats.total}`} loading={loading} />
          <Figure
            label="Overdue"
            value={stats.overdue + crm.overdue}
            loading={loading}
            tone={stats.overdue + crm.overdue ? 'bad' : 'plain'}
          />
          <Figure label="Due today" value={stats.dueToday + crm.today} loading={loading} />
          <div style={{ flex: 1 }} />
          {stats.pendingMarketing > 0 && (
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={() => onGoTo('marketing-triage')}
              style={{ fontSize: 13 }}
            >
              Marketing inbox · {stats.pendingMarketing} waiting
            </button>
          )}
        </div>
      </section>

      {/* ── 4. Who is carrying what ───────────────────────────────
          A list, busiest first, so it answers "who is free" in one glance.
          It was a grid of identical cards in database order, which answered
          nothing until you had read all of them. */}
      {busiest.length > 0 && (
        <section className="aq-card" style={{ padding: 20 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Workload</h3>
            <button
              className="aq-btn aq-btn-ghost"
              onClick={() => onGoTo('team')}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >Team</button>
          </header>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {busiest.map((p) => {
              const max = Math.max(1, busiest[0].count);
              return (
                <li key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 150, fontSize: 13, ...ellipsis }}>{p.full_name}</span>
                  <span style={{ width: 92, fontSize: 11, color: 'var(--aq-text-muted)', ...ellipsis }}>
                    {roleLabel(p.role)}
                  </span>
                  {/* Length, not colour. How much someone is carrying is a
                      quantity; colour here would read as a verdict on them. */}
                  <span style={{ flex: 1, height: 8, background: 'var(--aq-bg-sunken)', borderRadius: 99 }}>
                    <span style={{
                      display: 'block', height: '100%', borderRadius: 99,
                      width: `${(p.count / max) * 100}%`,
                      background: p.count === 0 ? 'transparent' : 'var(--aq-text-muted)',
                    }} />
                  </span>
                  <span style={{
                    width: 54, textAlign: 'right', fontSize: 12,
                    fontVariantNumeric: 'tabular-nums',
                    color: p.count === 0 ? 'var(--aq-text-muted)' : 'var(--aq-text)',
                  }}>
                    {p.count === 0 ? 'None' : p.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */

const SEVERITY_STYLE: Record<Severity, { dot: string; label: string }> = {
  urgent: { dot: '#dc2626', label: 'Urgent' },
  soon:   { dot: '#ca8a04', label: 'Soon' },
  tidy:   { dot: '#a8a29e', label: 'Missing data' },
};

function AttentionRow({
  item, first, onOpen,
}: { item: AttentionItem; first: boolean; onOpen: () => void }) {
  const s = SEVERITY_STYLE[item.severity];
  return (
    <button type="button" onClick={onOpen} style={rowButton(first)} data-severity={item.severity}>
      {/* A dot AND the word. Colour alone would put the whole ranking out of
          reach of anyone who cannot separate the red from the amber. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, width: 88, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
        <span style={{
          fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase',
          color: 'var(--aq-text-muted)',
        }}>{s.label}</span>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block', ...ellipsis }}>
          {item.title}
          {item.context && (
            <span style={{ fontWeight: 400, color: 'var(--aq-text-muted)' }}> · {item.context}</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: 'var(--aq-text-secondary)' }}>{item.message}</span>
      </span>
    </button>
  );
}

function Figure({
  label, value, sub, loading, tone = 'plain',
}: {
  label: string; value: number; sub?: string; loading?: boolean; tone?: 'plain' | 'bad';
}) {
  return (
    <div>
      <div className="aq-label" style={{ marginBottom: 2 }}>{label}</div>
      {loading ? (
        <SkeletonLine width={44} height={22} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            color: tone === 'bad' ? 'var(--aq-error)' : 'var(--aq-text)',
          }}>{value}</span>
          {sub && <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

const ellipsis = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
};

/** Every row on this page has the same shape: full width, a rule between. */
function rowButton(first: boolean): React.CSSProperties {
  return {
    width: '100%', textAlign: 'left', background: 'none', border: 'none',
    borderTop: first ? 'none' : '1px solid var(--aq-border-light)',
    padding: '10px 4px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 12, font: 'inherit',
  };
}

function humanAction(a: string) {
  const m: Record<string, string> = {
    created: 'created',
    updated: 'updated a task',
    deleted: 'deleted',
    completed: 'completed',
    assigned: 'assigned a task',
    unassigned: 'unassigned a task',
    commented: 'left a comment',
    moved: 'moved a task',
    status_changed: 'changed task status',
    priority_changed: 'changed priority',
    restored: 'restored',
    // Nobody "deleted" it at this point — its 30 days ran out.
    purged: 'was removed for good:',
    contract_requested: 'requested a contract for',
    contract_generated: 'got a signed contract for',
    sheet_published: 'published the tracking sheet for',
  };
  return m[a] ?? a;
}
