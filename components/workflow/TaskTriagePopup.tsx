'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  triageMarketingTask,
  type PMTask, type Profile, type ServiceType, type ServiceTypeStep,
} from '@/hooks/use-workflow';
import {
  stepGroups, allStepIds, stepCounts, rowChecked, toggleRow, pruneSteps,
  stepsLine, submitProblems, canSubmit,
  PRIORITIES, EMPTY_DRAFT,
  type Draft, type Priority, type StepGroup,
} from '@/lib/triage';

/**
 * Set up a task - the triage that used to live in the Marketing Inbox, now a
 * popup on the task itself. It appears the moment you open a task that has not
 * been triaged (stage 'pending_marketing'), so marketing sets the type of
 * work, priority, key account and the subtask checklist right there. Siraj:
 * *"as soon as you enter a new task without a triage done a small popup will
 * come up and tell you to add the stuff we used to do prior."*
 *
 * Same call the inbox made (triageMarketingTask), so the result is identical:
 * the service types are stored, the subtasks are spawned, and the task moves
 * into progress.
 */
export function TaskTriagePopup({
  task, serviceTypes, steps, profiles, workspaceId, currentUserId, onDone, onClose,
}: {
  task: PMTask;
  serviceTypes: ServiceType[];
  steps: ServiceTypeStep[];
  profiles: Profile[];
  workspaceId: string;
  currentUserId: string;
  onDone: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY_DRAFT,
    priority: ((task as any).priority as Priority) ?? EMPTY_DRAFT.priority,
    keyAccountId: (task as any).key_account_id ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const keyAccounts = profiles.filter((p) => ['key_account', 'admin', 'owner'].includes((p as any).role));

  const groups = useMemo(
    () => stepGroups(draft.serviceTypeIds, steps as any, serviceTypes as any),
    [draft.serviceTypeIds, steps, serviceTypes],
  );
  const offered = allStepIds(groups);
  const chosenSteps = useMemo(() => new Set(draft.stepIds), [draft.stepIds]);
  const counts = stepCounts(groups, chosenSteps);

  // Dropping a service type drops its steps.
  useEffect(() => {
    setDraft((d) => {
      const kept = pruneSteps(d.stepIds, groups);
      return kept === d.stepIds ? d : { ...d, stepIds: kept };
    });
  }, [groups]);

  const problems = submitProblems(draft);
  const owner = keyAccounts.find((p) => p.id === draft.keyAccountId);

  const triage = async () => {
    if (!canSubmit(draft)) return;
    setBusy(true); setError('');
    try {
      await triageMarketingTask({
        task_id: task.id,
        workspace_id: workspaceId,
        priority: draft.priority as Priority,
        service_type_ids: draft.serviceTypeIds,
        key_account_id: draft.keyAccountId,
        creator_id: currentUserId,
        selected_step_ids: draft.stepIds,
      });
      await onDone();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set up this task"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div className="aq-card" style={{ width: 'min(680px, 100%)', padding: 0 }}>
        <header style={{
          display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
          padding: '16px 20px 0',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Set up this task</h2>
          <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            {(task as any).task_name || (task as any).title || 'New task'}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              marginLeft: 'auto', font: 'inherit', fontSize: 12.5, fontWeight: 600,
              padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid var(--aq-border)', background: 'var(--aq-bg-elevated)',
              color: 'var(--aq-text)',
            }}
          >Later</button>
        </header>

        <p style={{ fontSize: 12.5, color: 'var(--aq-text-muted)', margin: 0, padding: '6px 20px 0' }}>
          Marketing: set the type of work, priority and key account. This creates the
          subtask checklist and moves the task into progress.
        </p>

        <div style={{ padding: '14px 20px 0' }}>
          <Field label="Priority">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PRIORITIES.map((p) => (
                <Pick key={p.key} on={draft.priority === p.key} dark
                  onClick={() => setDraft((d) => ({ ...d, priority: p.key }))}>{p.label}</Pick>
              ))}
            </div>
          </Field>

          <Field label="Service types" hint="pick one or more">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {serviceTypes.map((s) => (
                <Pick key={s.id} on={draft.serviceTypeIds.includes(s.id)}
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
              <option value="">- Select -</option>
              {keyAccounts.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p as any).full_name} - {(p as any).role === 'key_account' ? 'Key account' : (p as any).role}
                </option>
              ))}
            </select>
            {keyAccounts.length === 0 && (
              <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>
                Nobody can be a key account yet. Promote somebody in Settings -&gt; Team.
              </div>
            )}
          </Field>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="aq-label" style={{ margin: 0 }}>Subtasks</span>
            <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
              - optional{counts.offered ? ` - ${stepsLine(counts.chosen, counts.offered)}` : ''}
            </span>
            {offered.length > 0 && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button type="button" className="aq-btn aq-btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={() => setDraft((d) => ({ ...d, stepIds: offered }))}>All</button>
                <button type="button" className="aq-btn aq-btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={() => setDraft((d) => ({ ...d, stepIds: [] }))}>None</button>
              </span>
            )}
          </div>

          {groups.length === 0 ? (
            <p style={{
              fontSize: 12.5, color: 'var(--aq-text-muted)', background: 'var(--aq-bg-sunken)',
              padding: '12px 14px', borderRadius: 'var(--aq-radius)', margin: 0,
            }}>Pick a service type and its subtasks appear here.</p>
          ) : (
            <div style={{ background: 'var(--aq-bg-sunken)', borderRadius: 'var(--aq-radius)', padding: '12px 14px' }}>
              {groups.map((g, gi) => (
                <StepBlock key={g.key} group={g} first={gi === 0} chosen={chosenSteps}
                  onToggle={(row) => setDraft((d) => ({ ...d, stepIds: toggleRow(row, d.stepIds) }))} />
              ))}
            </div>
          )}
        </div>

        {error && (
          <p style={{ fontSize: 12.5, color: '#b91c1c', margin: 0, padding: '10px 20px 0' }}>{error}</p>
        )}

        <footer style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          padding: '16px 20px 18px',
        }}>
          <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            {problems[0] ?? (owner ? `Goes to ${(owner as any).full_name}.` : 'Ready to set up.')}
          </span>
          <button
            type="button"
            onClick={triage}
            disabled={busy || !canSubmit(draft)}
            className="aq-btn aq-btn-primary"
            style={{ marginLeft: 'auto', fontSize: 13.5, opacity: busy || !canSubmit(draft) ? 0.6 : 1 }}
          >{busy ? 'Setting up...' : 'Set up task'}</button>
        </footer>
      </div>
    </div>
  );
}

/* -- The three small pieces, from the old inbox ------------------- */

function StepBlock({ group, first, chosen, onToggle }: {
  group: StepGroup;
  first: boolean;
  chosen: Set<string>;
  onToggle: (row: { stepIds: string[] }) => void;
}) {
  return (
    <div style={{
      marginTop: first ? 0 : 10, paddingTop: first ? 0 : 10,
      borderTop: first ? 'none' : '1px solid var(--aq-border-light)',
    }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--aq-text-secondary)', marginBottom: 4 }}>
        {group.label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {group.rows.map((row) => (
          <label key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={rowChecked(row, chosen)} onChange={() => onToggle(row)} style={{ width: 14, height: 14 }} />
            <span>{row.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="aq-label" style={{ marginBottom: 6 }}>
        {label}
        {hint && (
          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--aq-text-muted)' }}> - {hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Pick({ on, dark, onClick, children }: {
  on: boolean; dark?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const bg = dark ? 'var(--aq-text)' : 'var(--aq-accent)';
  return (
    <button
      type="button" onClick={onClick} aria-pressed={on}
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