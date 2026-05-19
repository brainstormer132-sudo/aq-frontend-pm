'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  triageMarketingTask, deleteTask,
  type PMTask, type Profile, type ServiceType, type ServiceTypeStep,
  type WorkspaceRole, type TaskPriority,
} from '@/hooks/use-workflow';

/** Common subtasks live at position >= 101 in the DB seed. */
const COMMON_STEP_THRESHOLD = 100;

/**
 * Marketing triage view.
 * Lists tasks at stage = pending_marketing. Clicking one opens an
 * inline panel where marketing picks priority + service type + key
 * account, then reviews subtask checkboxes before submitting.
 *
 * Subtask behavior:
 *   - Type-specific subtasks (position < 100) are checked by default
 *   - Common subtasks (position >= 101: Tracking Sheet, Quotation,
 *     Payment Confirmation, Invoice, Contracts/Vendoring) are
 *     pre-checked but removable
 *   - Users can toggle any subtask on/off before triaging
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
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [serviceTypeIds, setServiceTypeIds] = useState<string[]>([]);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());
  const [keyAccountId, setKeyAccountId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const canTriage = role && ['owner','admin','marketing'].includes(role);
  const canDelete = role && ['owner','admin','marketing','sales'].includes(role);
  const keyAccountChoices = profiles.filter((p) => ['key_account','admin','owner'].includes(p.role));

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null;

  // All steps belonging to the selected service types, sorted by service
  // type position then step position.
  const availableSteps = useMemo(() => {
    if (!serviceTypeIds.length) return [];
    return steps
      .filter((s) => serviceTypeIds.includes(s.service_type_id))
      .sort((a, b) => {
        const stA = serviceTypes.find((x) => x.id === a.service_type_id);
        const stB = serviceTypes.find((x) => x.id === b.service_type_id);
        const posA = stA?.position ?? 0;
        const posB = stB?.position ?? 0;
        return posA !== posB ? posA - posB : a.position - b.position;
      });
  }, [serviceTypeIds, steps, serviceTypes]);

  // When service types change, auto-select ALL steps (both type-specific
  // and common). Users can then uncheck the ones they don't need.
  useEffect(() => {
    const ids = new Set(availableSteps.map((s) => s.id));
    setSelectedStepIds(ids);
  }, [availableSteps]);

  // Deduplicated common steps across selected service types (to avoid
  // showing "Tracking Sheet" 3 times when 3 types are selected).
  // We show them once and toggle all matching step IDs together.
  const { typeSpecificSteps, commonStepGroups } = useMemo(() => {
    const specific: ServiceTypeStep[] = [];
    const commonMap = new Map<string, ServiceTypeStep[]>(); // title → steps
    for (const s of availableSteps) {
      if (s.position > COMMON_STEP_THRESHOLD) {
        const group = commonMap.get(s.title) || [];
        group.push(s);
        commonMap.set(s.title, group);
      } else {
        specific.push(s);
      }
    }
    return {
      typeSpecificSteps: specific,
      commonStepGroups: Array.from(commonMap.entries()), // [title, steps[]]
    };
  }, [availableSteps]);

  const toggleServiceType = (id: string) => {
    setServiceTypeIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const toggleStep = (stepId: string) => {
    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  };

  /** Toggle an entire common-step group (all service types at once). */
  const toggleCommonGroup = (stepGroup: ServiceTypeStep[]) => {
    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      const allChecked = stepGroup.every((s) => next.has(s.id));
      for (const s of stepGroup) {
        if (allChecked) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  const selectAllSteps = () => setSelectedStepIds(new Set(availableSteps.map((s) => s.id)));
  const deselectAllSteps = () => setSelectedStepIds(new Set());

  const handleDelete = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(taskId); setError('');
    try {
      await deleteTask(taskId);
      if (activeTaskId === taskId) setActiveTaskId(null);
      onTriaged();
    } catch (err: any) { setError(err?.message ?? String(err)); }
    finally { setDeletingId(null); }
  };

  if (!canTriage) {
    return (
      <div className="aq-card animate-fade-in" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Marketing only</h2>
        <p style={{ color: 'var(--aq-text-muted)', marginTop: 8, fontSize: 14 }}>
          The triage inbox is visible to marketing, admin, and owner roles.
        </p>
      </div>
    );
  }

  const handleTriage = async () => {
    if (!activeTaskId) return;
    if (!serviceTypeIds.length) { setError('Pick at least one service type.'); return; }
    if (!keyAccountId)          { setError('Assign a key account.');           return; }
    if (!selectedStepIds.size)  { setError('Select at least one subtask.');    return; }
    setSubmitting(true);
    setError('');
    try {
      await triageMarketingTask({
        task_id: activeTaskId,
        workspace_id: workspaceId,
        priority,
        service_type_ids: serviceTypeIds,
        key_account_id: keyAccountId,
        creator_id: currentUserId,
        selected_step_ids: Array.from(selectedStepIds),
      });
      // reset
      setActiveTaskId(null);
      setServiceTypeIds([]);
      setSelectedStepIds(new Set());
      setKeyAccountId('');
      setPriority('medium');
      onTriaged();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{
      display: 'grid',
      gridTemplateColumns: activeTask ? 'minmax(0, 1fr) minmax(0, 1.2fr)' : '1fr',
      gap: 20,
    }}>
      {/* LEFT — list of pending tasks */}
      <div className="aq-card" style={{ padding: 20 }}>
        <header style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Pending triage</h2>
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {tasks.length} task{tasks.length === 1 ? '' : 's'} from sales waiting for service type and key account.
          </p>
        </header>
        {tasks.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 14 }}>
            No pending tasks. Inbox is clear.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map((t) => {
              const active = t.id === activeTaskId;
              const closer = profiles.find((p) => p.id === t.sales_closer_id);
              return (
                <li key={t.id} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    onClick={() => { setActiveTaskId(t.id); setError(''); }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '14px 16px',
                      paddingRight: canDelete ? 56 : 16,
                      borderRadius: 'var(--aq-radius)',
                      border: active ? '2px solid var(--aq-accent)' : '1px solid var(--aq-border-light)',
                      background: active ? 'var(--aq-accent-light)' : 'var(--aq-bg-elevated)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      fontFamily: 'inherit',
                      transition: 'all var(--aq-transition)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 14 }}>{t.task_name || t.title}</strong>
                      {t.budget != null && (
                        <span className="aq-badge aq-badge-muted">SAR {Number(t.budget).toLocaleString()}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                      {t.brand_name || '(no brand)'} · client {t.legacy_client_id || '—'}
                      {closer ? ` · closer ${closer.full_name}` : ''}
                    </div>
                    {t.description && (
                      <div style={{ fontSize: 12, color: 'var(--aq-text-secondary)', marginTop: 2 }}>
                        {t.description.length > 110 ? t.description.slice(0, 110) + '…' : t.description}
                      </div>
                    )}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={(e) => handleDelete(t.id, e)}
                      disabled={deletingId === t.id}
                      title="Delete task and all subtasks"
                      style={{
                        position: 'absolute', top: 10, right: 10,
                        background: 'transparent', border: 'none',
                        color: 'var(--aq-text-muted)', cursor: 'pointer',
                        padding: '4px 8px', borderRadius: 6, fontSize: 14,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--aq-error)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--aq-text-muted)'; }}
                      aria-label="Delete task"
                    >✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* RIGHT — triage panel */}
      {activeTask && (
        <div className="aq-card animate-slide-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <header>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>Triage · {activeTask.task_name || activeTask.title}</h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
              Set priority, choose service types, pick subtasks, then assign a key account.
            </p>
          </header>

          {/* Priority */}
          <div>
            <div className="aq-label">Priority</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['urgent','high','medium','low','none'] as TaskPriority[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`aq-btn ${priority === p ? 'aq-btn-primary' : 'aq-btn-secondary'}`}
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >{p}</button>
              ))}
            </div>
          </div>

          {/* Service types */}
          <div>
            <div className="aq-label">Service types (pick one or more)</div>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
            }}>
              {serviceTypes.map((s) => {
                const checked = serviceTypeIds.includes(s.id);
                return (
                  <label
                    key={s.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px',
                      border: checked ? '1px solid var(--aq-accent)' : '1px solid var(--aq-border)',
                      background: checked ? 'var(--aq-accent-light)' : 'var(--aq-bg-elevated)',
                      borderRadius: 'var(--aq-radius)',
                      cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleServiceType(s.id)}
                      style={{ width: 14, height: 14 }}
                    />
                    <span>{s.icon ? `${s.icon} ` : ''}{s.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Subtask checkboxes */}
          {availableSteps.length > 0 && (
            <div style={{
              padding: 14, background: 'var(--aq-bg-sunken)',
              borderRadius: 'var(--aq-radius)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div className="aq-label" style={{ margin: 0 }}>
                  Subtasks ({selectedStepIds.size} / {availableSteps.length} selected)
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="aq-btn aq-btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={selectAllSteps}>All</button>
                  <button type="button" className="aq-btn aq-btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={deselectAllSteps}>None</button>
                </div>
              </div>

              {/* Type-specific subtasks grouped by service type */}
              {serviceTypeIds.map((stId) => {
                const st = serviceTypes.find((x) => x.id === stId);
                const stSteps = typeSpecificSteps.filter((s) => s.service_type_id === stId);
                if (!stSteps.length) return null;
                return (
                  <div key={stId} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--aq-text-secondary)', marginBottom: 4 }}>
                      {st?.icon ?? ''} {st?.name ?? 'Unknown'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4 }}>
                      {stSteps.map((s) => (
                        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={selectedStepIds.has(s.id)}
                            onChange={() => toggleStep(s.id)}
                            style={{ width: 14, height: 14 }}
                          />
                          <span>{s.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Common subtasks (deduplicated, shown once) */}
              {commonStepGroups.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--aq-border-light)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--aq-text-secondary)', marginBottom: 4 }}>
                    Common (all service types)
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4 }}>
                    {commonStepGroups.map(([title, group]) => {
                      const allChecked = group.every((s) => selectedStepIds.has(s.id));
                      return (
                        <label key={title} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={() => toggleCommonGroup(group)}
                            style={{ width: 14, height: 14 }}
                          />
                          <span>{title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Key account */}
          <div>
            <div className="aq-label">Key account manager</div>
            <select
              className="aq-select"
              value={keyAccountId}
              onChange={(e) => setKeyAccountId(e.target.value)}
            >
              <option value="">— Select —</option>
              {keyAccountChoices.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.role === 'key_account' ? 'Key account' : p.role})</option>
              ))}
            </select>
            {keyAccountChoices.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--aq-error)', marginTop: 6 }}>
                No key-account-eligible members yet. Promote someone in Settings → Team.
              </div>
            )}
          </div>

          {error && (
            <div style={{
              background: 'var(--aq-error)', color: '#fff',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 13,
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="aq-btn aq-btn-primary"
              onClick={handleTriage}
              disabled={submitting || !serviceTypeIds.length || !keyAccountId || !selectedStepIds.size}
            >{submitting ? 'Triaging…' : 'Send to key account'}</button>
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => { setActiveTaskId(null); setError(''); }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
