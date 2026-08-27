'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  triageMarketingTask, deleteTask, useLegacyVendors,
  type PMTask, type Profile, type ServiceType, type ServiceTypeStep,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { closerLabel } from '@/lib/sales-closer';
import {
  buildQueue, orderQueue, currentItem, nextAfter, queuePosition, queueLine,
  remainingLine, submitProblems, canSubmit, stepGroups, allStepIds, stepCounts, rowChecked,
  toggleRow, pruneSteps, stepsLine, deleteWarning, deletedMessage, triagedMessage,
  searchQueue, emptyQueueMessage, shortDate,
  PRIORITIES, EMPTY_DRAFT,
  type Draft, type Priority, type QueueItem, type StepGroup,
} from '@/lib/triage';

/**
 * Marketing triage — one campaign at a time.
 *
 * Rebuilt Aug 2026, eighth screen of the UI pass. Siraj picked "one at a
 * time": triage is processing, not browsing, so the screen shows one
 * campaign, full width, with everything needed to decide and a Next that
 * brings the following one.
 *
 * What was here: a list beside a panel that only existed once you clicked
 * something — so the grid went from one column to two under the cursor at
 * the exact moment you were aiming at a row. The list arrived newest-first,
 * so the campaign that had waited longest was at the bottom, and nothing
 * said how long anything had waited even though the Dashboard calls three
 * days in triage urgent.
 *
 * And it carried the most dangerous control in the app: a ✕ at
 * `top:10 right:10` on a card whose whole surface opens the task, wired
 * straight to `deleteTask` — no confirmation, no undo. That is gone. Delete
 * lives at the bottom of the form now, behind a question that names the
 * campaign.
 *
 * Kept exactly as it was, because it was already right: **nothing in the
 * subtask list is pre-ticked.** Triaging with zero subtasks is a supported
 * outcome; the campaign is created bare and subtasks are added later. This
 * used to auto-tick every step, which meant the fastest path through triage
 * created the largest pile of subtasks nobody asked for.
 *
 * All the deciding is in lib/triage.ts, pure and tested.
 */
export function MarketingInbox({
  tasks, serviceTypes, steps, profiles, currentUserId, workspaceId,
  role, onTriaged,
}: {
  tasks: PMTask[];
  serviceTypes: ServiceType[];
  steps: ServiceTypeStep[];
  profiles: (Profile & { role: WorkspaceRole })[];
  currentUserId: string;
  workspaceId: string;
  role: WorkspaceRole | null;
  onTriaged: () => void;
}) {
  const { vendors } = useLegacyVendors();

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [showQueue, setShowQueue] = useState(false);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Read after mount, never during render.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const canTriage = Boolean(role && ['owner', 'admin', 'marketing'].includes(role));
  const canDelete = Boolean(role && ['owner', 'admin', 'marketing', 'sales'].includes(role));
  const keyAccounts = profiles.filter((p) => ['key_account', 'admin', 'owner'].includes(p.role));

  const queue = useMemo(
    () => (today ? buildQueue(tasks as any, today) : []),
    [tasks, today],
  );
  const ordered = useMemo(() => orderQueue(queue, skipped), [queue, skipped]);
  const item = currentItem(ordered, pickedId);
  const pos = queuePosition(ordered, item?.id ?? null);

  const groups = useMemo(
    () => stepGroups(draft.serviceTypeIds, steps as any, serviceTypes as any),
    [draft.serviceTypeIds, steps, serviceTypes],
  );
  const offered = allStepIds(groups);
  const chosenSteps = useMemo(() => new Set(draft.stepIds), [draft.stepIds]);
  // In rows, not ids — a shared step is one tick-box holding several ids.
  const counts = stepCounts(groups, chosenSteps);

  // Dropping a service type drops its steps. Never adds — see the note above.
  useEffect(() => {
    setDraft((d) => {
      const kept = pruneSteps(d.stepIds, groups);
      return kept === d.stepIds ? d : { ...d, stepIds: kept };
    });
  }, [groups]);

  // A fresh campaign is a fresh decision. Carrying the last one's priority
  // and service types across would be a default wearing a disguise.
  const itemId = item?.id ?? null;
  useEffect(() => {
    setDraft(EMPTY_DRAFT);
    setConfirmDelete(false);
    setError('');
  }, [itemId]);

  const problems = submitProblems(draft);
  const owner = keyAccounts.find((p) => p.id === draft.keyAccountId);

  const goNext = (fromId: string) => setPickedId(nextAfter(ordered, fromId));

  const triage = async () => {
    if (!item || !canSubmit(draft)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await triageMarketingTask({
        task_id: item.id,
        workspace_id: workspaceId,
        priority: draft.priority as Priority,
        service_type_ids: draft.serviceTypeIds,
        key_account_id: draft.keyAccountId,
        creator_id: currentUserId,
        selected_step_ids: draft.stepIds,
      });
      setMessage(triagedMessage(item.name, owner?.full_name ?? 'them', draft.stepIds.length));
      goNext(item.id);
      onTriaged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await deleteTask(item.id);
      setMessage(deletedMessage(item.name));
      setConfirmDelete(false);
      goNext(item.id);
      onTriaged();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canTriage) {
    return (
      <div className="aq-card animate-fade-in" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Marketing only</h2>
        <p style={{ color: 'var(--aq-text-muted)', marginTop: 8, fontSize: 14 }}>
          Only marketing, admin and owner can assign campaigns.
          Your role is <strong>{role || 'unset'}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        fontSize: 12.5, color: 'var(--aq-text-muted)',
      }}>
        <span>{today ? queueLine(pos) : 'Loading…'}</span>
        {ordered.length > 1 && (
          <span style={{ display: 'flex', gap: 4 }} aria-hidden>
            {ordered.slice(0, 12).map((x, i) => (
              <i
                key={x.id}
                style={{
                  width: 22, height: 4, borderRadius: 2, display: 'block',
                  background: x.id === itemId ? 'var(--aq-text)'
                    : i < pos.index ? 'var(--aq-accent)' : 'var(--aq-border-light)',
                }}
              />
            ))}
          </span>
        )}
        {ordered.length > 0 && (
          <button
            type="button"
            className="aq-btn aq-btn-ghost"
            onClick={() => setShowQueue((v) => !v)}
            aria-pressed={showQueue}
            style={{ marginLeft: 'auto', fontSize: 12.5, padding: '5px 10px' }}
          >{showQueue ? 'Hide the queue' : 'See the whole queue'}</button>
        )}
      </div>

      {error && (
        <div role="alert" style={{
          padding: '10px 14px', borderRadius: 'var(--aq-radius)',
          background: '#fee2e2', color: '#991b1b', fontSize: 13,
        }}>{error}</div>
      )}
      {message && !error && (
        <div role="status" style={{
          padding: '10px 14px', borderRadius: 'var(--aq-radius)',
          background: 'var(--aq-accent-light)', color: '#14603a', fontSize: 13, fontWeight: 600,
        }}>{message}</div>
      )}

      {showQueue && (
        <QueueList
          items={searchQueue(ordered, query)}
          query={query}
          onQuery={setQuery}
          total={ordered.length}
          currentId={itemId}
          onPick={(id) => { setPickedId(id); setShowQueue(false); }}
        />
      )}

      {!today ? (
        <div className="aq-card" style={{ padding: 34 }} />
      ) : !item ? (
        <div className="aq-card" style={{
          padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 14,
        }}>
          {emptyQueueMessage('', queue.length)}
        </div>
      ) : (
        <div className="aq-card" style={{ padding: '20px 22px' }}>
          {/* ── Who and what ─────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 19, fontWeight: 700 }}>{item.name}</h2>
            <span style={{
              fontSize: 12.5, whiteSpace: 'nowrap',
              color: item.stale ? '#b91c1c' : 'var(--aq-text-muted)',
              fontWeight: item.stale ? 700 : 400,
            }}>{item.waitedLabel}</span>
            <span style={{
              marginLeft: 'auto', fontSize: 14.5,
              fontWeight: item.hasBudget ? 600 : 400,
              fontVariantNumeric: 'tabular-nums',
              color: item.hasBudget ? 'var(--aq-text)' : 'var(--aq-text-muted)',
              fontStyle: item.hasBudget ? 'normal' : 'italic',
            }}>{item.budgetLabel}</span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', margin: '4px 0 0' }}>
            {[
              item.brand,
              closerLabel(item.raw as any, profiles, vendors || []) !== '—'
                ? `from ${closerLabel(item.raw as any, profiles, vendors || [])}`
                : null,
              item.arrived ? `on ${shortDate(item.arrived, today)}` : null,
            ].filter(Boolean).join(' · ')}
          </p>

          {/* The brief, whole. This layout has the width for it — the old
              panel was a third of the screen and cut it at 110 characters. */}
          {item.brief && (
            <p style={{
              fontSize: 13, color: 'var(--aq-text-secondary)', lineHeight: 1.55,
              background: 'var(--aq-bg-sunken)', padding: '11px 13px',
              borderRadius: 'var(--aq-radius)', margin: '14px 0 0',
              whiteSpace: 'pre-wrap',
            }}>{item.brief}</p>
          )}

          {/* ── The decision ─────────────────────────────────── */}
          <div style={{
            display: 'grid', gap: 18, marginTop: 18,
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            alignItems: 'start',
          }}>
            <div>
              <Field label="Priority">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {PRIORITIES.map((p) => (
                    <Pick
                      key={p.key}
                      on={draft.priority === p.key}
                      dark
                      onClick={() => setDraft((d) => ({ ...d, priority: p.key }))}
                    >{p.label}</Pick>
                  ))}
                </div>
              </Field>

              <Field label="Service types" hint="pick one or more">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {serviceTypes.map((s) => (
                    <Pick
                      key={s.id}
                      on={draft.serviceTypeIds.includes(s.id)}
                      onClick={() => setDraft((d) => ({
                        ...d,
                        serviceTypeIds: d.serviceTypeIds.includes(s.id)
                          ? d.serviceTypeIds.filter((x) => x !== s.id)
                          : [...d.serviceTypeIds, s.id],
                      }))}
                    >{s.icon ? `${s.icon} ` : ''}{s.name}</Pick>
                  ))}
                </div>
              </Field>

              <Field label="Key account manager">
                <select
                  className="aq-select"
                  value={draft.keyAccountId}
                  onChange={(e) => setDraft((d) => ({ ...d, keyAccountId: e.target.value }))}
                  style={{ fontSize: 13 }}
                >
                  <option value="">— Select —</option>
                  {keyAccounts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} — {p.role === 'key_account' ? 'Key account' : p.role}
                    </option>
                  ))}
                </select>
                {keyAccounts.length === 0 && (
                  <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>
                    Nobody can be a key account yet. Promote somebody in Settings → Team.
                  </div>
                )}
              </Field>
            </div>

            <div>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6,
              }}>
                <span className="aq-label" style={{ margin: 0 }}>Subtasks</span>
                <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                  · optional{counts.offered ? ` · ${stepsLine(counts.chosen, counts.offered)}` : ''}
                </span>
                {offered.length > 0 && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setDraft((d) => ({ ...d, stepIds: offered }))}
                    >All</button>
                    <button
                      type="button" className="aq-btn aq-btn-ghost"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => setDraft((d) => ({ ...d, stepIds: [] }))}
                    >None</button>
                  </span>
                )}
              </div>

              {groups.length === 0 ? (
                <p style={{
                  fontSize: 12.5, color: 'var(--aq-text-muted)',
                  background: 'var(--aq-bg-sunken)', padding: '12px 14px',
                  borderRadius: 'var(--aq-radius)', margin: 0,
                }}>
                  Pick a service type and its subtasks appear here.
                </p>
              ) : (
                <div style={{
                  background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)',
                  padding: '12px 14px',
                }}>
                  {groups.map((g, gi) => (
                    <StepBlock
                      key={g.key}
                      group={g}
                      first={gi === 0}
                      chosen={chosenSteps}
                      onToggle={(row) => setDraft((d) => ({ ...d, stepIds: toggleRow(row, d.stepIds) }))}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── What happens next ────────────────────────────── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            flexWrap: 'wrap', marginTop: 20,
          }}>
            <button
              type="button"
              className="aq-btn aq-btn-primary"
              onClick={triage}
              disabled={busy || problems.length > 0}
            >
              {busy ? 'Sending…'
                : owner ? `Send to ${owner.full_name.split(' ')[0]}${pos.total > 1 ? ' & next' : ''}`
                : 'Send to key account'}
            </button>
            {ordered.length > 1 && (
              // "Not now", never "never" — a skip that removed the campaign
              // from the screen would be a quiet way to lose one.
              <button
                type="button"
                className="aq-btn aq-btn-secondary"
                onClick={() => {
                  setSkipped((s) => (s.includes(item.id) ? s : [...s, item.id]));
                  goNext(item.id);
                }}
                disabled={busy}
              >Skip — decide later</button>
            )}
            <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
              {problems.length > 0 ? problems[0] : remainingLine(pos)}
            </span>

            {canDelete && !confirmDelete && (
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                style={{ marginLeft: 'auto', fontSize: 12.5, color: '#b91c1c' }}
              >Delete campaign…</button>
            )}
          </div>

          {/* The ✕ that used to live on the row, as the question it should
              always have been. It names the campaign, because "Are you
              sure?" on a screen with four campaigns is not a question
              anybody can answer. */}
          {confirmDelete && (
            <div role="alertdialog" aria-label="Confirm delete" style={{
              marginTop: 14, padding: '12px 14px', borderRadius: 'var(--aq-radius)',
              background: '#fee2e2', border: '1px solid #fecaca',
            }}>
              <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0, lineHeight: 1.5 }}>
                {deleteWarning(item)}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className="aq-btn"
                  onClick={remove}
                  disabled={busy}
                  style={{ background: '#b91c1c', color: '#fff', border: 'none', fontSize: 12.5 }}
                >{busy ? 'Deleting…' : 'Yes, delete it'}</button>
                <button
                  type="button"
                  className="aq-btn aq-btn-secondary"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  style={{ fontSize: 12.5 }}
                >Keep it</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── */

function QueueList({
  items, query, onQuery, total, currentId, onPick,
}: {
  items: QueueItem[];
  query: string;
  onQuery: (q: string) => void;
  total: number;
  currentId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="aq-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px' }}>
        <input
          className="aq-input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search campaign, brand or client…"
          style={{ fontSize: 12.5, padding: '7px 11px' }}
        />
      </div>
      {items.length === 0 ? (
        <p style={{
          padding: '18px 14px 24px', textAlign: 'center',
          fontSize: 13, color: 'var(--aq-text-muted)', margin: 0,
        }}>{emptyQueueMessage(query, total)}</p>
      ) : items.map((i) => (
        <button
          key={i.id}
          type="button"
          onClick={() => onPick(i.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 11, width: '100%',
            padding: '10px 14px', border: 'none', font: 'inherit', textAlign: 'left',
            borderTop: '1px solid var(--aq-border-light)', cursor: 'pointer',
            background: i.id === currentId ? 'var(--aq-bg-sunken)' : 'transparent',
          }}
        >
          <span aria-hidden style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: i.stale ? '#b91c1c' : 'transparent',
          }} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{i.name}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
              {[i.brand, i.budgetLabel].filter(Boolean).join(' · ')}
            </span>
          </span>
          <span style={{
            fontSize: 11.5, whiteSpace: 'nowrap',
            color: i.stale ? '#b91c1c' : 'var(--aq-text-muted)',
            fontWeight: i.stale ? 700 : 400,
          }}>{i.waitedLabel}</span>
        </button>
      ))}
    </div>
  );
}

function StepBlock({
  group, first, chosen, onToggle,
}: {
  group: StepGroup;
  first: boolean;
  chosen: Set<string>;
  onToggle: (row: { stepIds: string[] }) => void;
}) {
  return (
    <div style={{
      marginTop: first ? 0 : 10,
      paddingTop: first ? 0 : 10,
      borderTop: first ? 'none' : '1px solid var(--aq-border-light)',
    }}>
      <div style={{
        fontSize: 11.5, fontWeight: 700, color: 'var(--aq-text-secondary)', marginBottom: 4,
      }}>{group.label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {group.rows.map((row) => (
          <label
            key={row.key}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={rowChecked(row, chosen)}
              onChange={() => onToggle(row)}
              style={{ width: 14, height: 14 }}
            />
            <span>{row.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="aq-label" style={{ marginBottom: 6 }}>
        {label}
        {hint && (
          <span style={{
            fontWeight: 400, textTransform: 'none', letterSpacing: 0,
            color: 'var(--aq-text-muted)',
          }}> · {hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Pick({
  on, dark, onClick, children,
}: {
  on: boolean;
  dark?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const bg = dark ? 'var(--aq-text)' : 'var(--aq-accent)';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 500,
        padding: '6px 12px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${on ? bg : 'var(--aq-border-light)'}`,
        background: on ? bg : 'var(--aq-bg-elevated)',
        color: on ? '#fff' : 'var(--aq-text-secondary)',
      }}
    >{children}</button>
  );
}
