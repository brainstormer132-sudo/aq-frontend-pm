'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useTask, useTaskSubtasks, useTaskComments, useTaskAttachments, useTaskServiceTypes,
  useLegacyVendors,
  useTaskSources, useClientCategories,
  addComment, deleteComment, addAttachmentLink, uploadTaskAttachment,
  getAttachmentDownloadUrl, deleteAttachment,
  deleteTask as deleteTaskFn, markTaskCompleted, updateTaskFields,
  autoCreateContractRequestForSubtask,
  type Profile, type WorkspaceRole,
} from '@/hooks/use-workflow';
import { TaskAssignees } from './TaskAssignees';
import { RequestContractModal } from './RequestContractModal';
import { TrackingSheetPanel } from './TrackingSheetPanel';

/**
 * Slide-over panel that shows a single task — header, fields, subtasks list,
 * file uploads, and a comments thread. Behavior is role-gated:
 *
 *   - owner / admin / marketing -> full edit + delete
 *   - sales (creator) → can edit own draft tasks
 *   - key_account on the task → can mark complete + see everything
 *   - member → READ-ONLY everywhere except the comment box and uploads
 *
 * Internal navigation: clicking a subtask row opens the subtask in the
 * SAME panel. A "← Back to parent task" button at the top brings you
 * back. Each subtask has its own comments, attachments, budget, and
 * assignee — they are first-class `pm_tasks` rows with `parent_task_id`
 * set, so all the existing hooks just work on them.
 */
export function TaskDetailPanel({
  taskId, currentUserId, role, profiles, onClose, onChanged,
}: {
  taskId: string | null;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  // The task we're CURRENTLY viewing in the panel — may be the original
  // taskId or a subtask the user clicked into.
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskId);
  useEffect(() => { setCurrentTaskId(taskId); }, [taskId]);

  const { task, refetch: refetchTask, loading } = useTask(currentTaskId);
  const { subtasks, refetch: refetchSubs } = useTaskSubtasks(currentTaskId);
  const { comments, refetch: refetchComments } = useTaskComments(currentTaskId);
  const { attachments, refetch: refetchAtt } = useTaskAttachments(currentTaskId);
  const { items: taskServiceTypes } = useTaskServiceTypes(currentTaskId);

  // For subtasks we also need the PARENT task (for brand_name / legacy_client_id
  // when auto-creating a contract request). For top-level tasks parentTask is null.
  const { task: parentTask } = useTask(task?.parent_task_id ?? null);

  // Vendors list — used by the per-subtask vendor picker and the auto-fire flow.
  const { vendors, banks } = useLegacyVendors();

  // Operations lookups (migration 028) — Source + Client Category dropdowns
  // on the parent campaign. Empty list = workspace hasn't seeded any yet,
  // in which case the inputs gracefully degrade to "—".
  const { items: taskSources } = useTaskSources(task?.workspace_id ?? null);
  const { items: clientCategories } = useClientCategories(task?.workspace_id ?? null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);

  // Inline-editable fields. Initialized from `task` and synced when it changes.
  const [budgetDraft, setBudgetDraft] = useState<string>('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  const [vendorSaving, setVendorSaving] = useState(false);
  // Banner shown after the auto-fire creates a contract request.
  const [autoSentBanner, setAutoSentBanner] = useState<string | null>(null);
  useEffect(() => {
    setBudgetDraft(task?.budget != null ? String(task.budget) : '');
    setAutoSentBanner(null);
  }, [task?.id, task?.budget]);

  // File picker (kept hidden; clicking the "Upload file" button triggers it).
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isOpen = Boolean(taskId);

  // Esc key closes.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const isCreator    = task?.creator_id === currentUserId;
  const isKeyAcct    = task?.key_account_id === currentUserId;
  const isAssignee   = task?.assignee_id === currentUserId;
  const isPrivileged = role && ['owner','admin','marketing'].includes(role);
  const canEdit      = Boolean(isPrivileged || (role === 'sales' && isCreator && task?.stage === 'draft'));
  const canDelete    = Boolean(isPrivileged || (role === 'sales' && isCreator));
  const canMarkDone  = Boolean(isKeyAcct || isPrivileged);
  const canRequestContract = Boolean(
    role && ['owner','admin','marketing','sales','key_account'].includes(role)
  );
  // Budget + subtask assignee can always be edited by privileged roles, plus
  // by the key account on this task. Sales (as creator) keeps draft-edit rights.
  const canEditBudget   = Boolean(isPrivileged || isKeyAcct || (role === 'sales' && isCreator && task?.stage === 'draft'));
  const canEditAssignee = canEditBudget;
  // Everyone with workspace access can comment/attach (RLS will reject
  // if they're not actually allowed).
  const canComment = true;
  const canAttach  = true;

  const profileById = useMemo(() => {
    const m = new Map(profiles.map((p) => [p.id, p]));
    return m;
  }, [profiles]);

  const closer        = task?.sales_closer_id ? profileById.get(task.sales_closer_id) : null;
  const ka            = task?.key_account_id  ? profileById.get(task.key_account_id)  : null;
  const subAssignee   = task?.assignee_id     ? profileById.get(task.assignee_id)     : null;

  // Variance: parent budget vs sum of subtask budgets. Only meaningful on a
  // parent that actually has subtasks.
  const subtaskBudgetSum = useMemo(
    () => subtasks.reduce((acc, s) => acc + (Number(s.budget) || 0), 0),
    [subtasks],
  );
  const parentBudget = Number(task?.budget) || 0;
  const variance = parentBudget - subtaskBudgetSum;

  const handleAddComment = async () => {
    if (!task || !commentText.trim()) return;
    setBusy(true); setError('');
    try {
      await addComment(task.id, currentUserId, commentText.trim());
      setCommentText('');
      await refetchComments();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleFilePicked = async (file: File | null) => {
    if (!file || !task) return;
    if (!task.workspace_id) {
      setError('Cannot upload — task has no workspace.');
      return;
    }
    setBusy(true); setError('');
    try {
      await uploadTaskAttachment({
        file,
        task_id: task.id,
        uploader_id: currentUserId,
        workspace_id: task.workspace_id,
      });
      await refetchAtt();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
      // Reset the input so the same filename can be re-picked later.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleOpenAttachment = async (a: { file_url: string; filename: string }) => {
    try {
      const url = await getAttachmentDownloadUrl(a.file_url);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      setError(`Could not open ${a.filename}: ${e?.message ?? String(e)}`);
    }
  };

  const handleDeleteAttachment = async (id: string) => {
    setBusy(true); setError('');
    try { await deleteAttachment(id); await refetchAtt(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleDeleteComment = async (id: string) => {
    setBusy(true); setError('');
    try { await deleteComment(id); await refetchComments(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleDeleteTask = async () => {
    if (!task) return;
    setBusy(true); setError('');
    try {
      await deleteTaskFn(task.id);
      onChanged?.();
      onClose();
    } catch (e: any) { setError(e?.message ?? String(e)); setBusy(false); }
  };

  const handleMarkDone = async () => {
    if (!task) return;
    setBusy(true); setError('');
    try {
      await markTaskCompleted(task.id);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleToggleTracking = async (next: boolean) => {
    if (!task) return;
    setBusy(true); setError('');
    try {
      await updateTaskFields(task.id, { has_tracking: next } as any);
      await refetchTask();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const handleSaveBudget = async () => {
    if (!task) return;
    const raw = budgetDraft.trim().replace(/,/g, '');
    const parsed = raw === '' ? null : Number(raw);
    if (parsed != null && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('Budget must be a positive number or empty.');
      return;
    }
    setBudgetSaving(true); setError('');
    try {
      await updateTaskFields(task.id, { budget: parsed } as any);
      await refetchTask();
      // Refetching subs too refreshes the parent's variance display when a
      // subtask budget was just changed.
      await refetchSubs();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBudgetSaving(false); }
  };

  const handleChangeAssignee = async (newId: string) => {
    if (!task) return;
    setAssigneeSaving(true); setError('');
    try {
      await updateTaskFields(task.id, { assignee_id: newId || null } as any);
      await refetchTask();
      await refetchSubs();
      onChanged?.();
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setAssigneeSaving(false); }
  };

  /**
   * Auto-fire a contract request when a subtask now has BOTH vendor + budget.
   * Idempotent (no-op if `contract_request_id` is already set).
   */
  const tryAutoSendContractRequest = async () => {
    if (!task || !task.parent_task_id) return; // subtasks only
    if (task.contract_request_id) return;       // already sent
    const vendor = task.vendor_id != null
      ? vendors.find((v) => v.id === task.vendor_id) ?? null
      : null;
    if (!vendor) return;
    const amount = Number(task.budget);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!parentTask) return;                    // parent not loaded yet

    const bank = banks.find((b) => b.vendor_id === vendor.id) ?? null;
    try {
      const newId = await autoCreateContractRequestForSubtask({
        subtask: task,
        parent: parentTask,
        vendor,
        bank,
        requestedBy: currentUserId,
        notes: null,
      });
      if (newId) {
        setAutoSentBanner('Contract request sent to the contract maker. Add notes below — they go through as comments.');
        await refetchTask();
        onChanged?.();
      }
    } catch (e: any) {
      setError(`Could not send contract request: ${e?.message ?? String(e)}`);
    }
  };

  const handleChangeVendor = async (newId: string) => {
    if (!task) return;
    setVendorSaving(true); setError('');
    try {
      const numericId = newId ? Number(newId) : null;
      await updateTaskFields(task.id, { vendor_id: numericId } as any);
      await refetchTask();
      // Auto-fire happens after the next refetch when state has the new vendor_id.
    } catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setVendorSaving(false); }
  };

  // Watch for the moment a subtask has vendor + budget + no request yet → fire.
  useEffect(() => {
    if (!task || !task.parent_task_id) return;
    if (task.contract_request_id) return;
    if (!task.vendor_id) return;
    const amount = Number(task.budget);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!parentTask) return;
    if (vendors.length === 0) return;
    tryAutoSendContractRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, task?.vendor_id, task?.budget, task?.contract_request_id, parentTask?.id, vendors.length]);

  if (!isOpen) return null;

  const isSubtaskView = Boolean(task?.parent_task_id);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={onClose}
        style={{ flex: 1, background: 'rgba(15, 29, 34, 0.4)' }}
        aria-hidden="true"
      />
      <aside
        className="animate-slide-in"
        style={{
          width: '100%', maxWidth: 760,
          background: 'var(--aq-bg-elevated)',
          overflow: 'auto',
          boxShadow: 'var(--aq-shadow-lg)',
          display: 'flex', flexDirection: 'column',
        }}
        role="dialog"
        aria-modal="true"
      >
        {loading || !task ? (
          <div style={{ padding: 28, color: 'var(--aq-text-muted)' }}>Loading task…</div>
        ) : (
          <>
            {/* Back-to-parent link, only when viewing a subtask */}
            {isSubtaskView && task.parent_task_id && (
              <div style={{
                padding: '10px 24px',
                borderBottom: '1px solid var(--aq-border-light)',
                background: 'var(--aq-bg-sunken)',
                fontSize: 13,
              }}>
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  onClick={() => setCurrentTaskId(task.parent_task_id!)}
                  style={{ padding: '4px 10px' }}
                >← Back to parent task</button>
              </div>
            )}

            {/* Header */}
            <header style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--aq-border-light)',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
              gap: 16,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`aq-badge ${
                    task.stage === 'completed' ? 'aq-badge-success'
                    : task.stage === 'pending_marketing' ? 'aq-badge-warning'
                    : 'aq-badge-info'
                  }`}>{task.stage.replace('_', ' ')}</span>
                  {task.priority !== 'none' && (
                    <span className="aq-badge aq-badge-muted">{task.priority}</span>
                  )}
                  {isSubtaskView && <span className="aq-badge aq-badge-muted">subtask</span>}
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>
                  {task.task_name || task.title}
                </h2>
                {task.brand_name && (
                  <p style={{ marginTop: 4, fontSize: 13, color: 'var(--aq-text-muted)' }}>
                    {task.brand_name}
                    {task.legacy_client_id && ` · client ${task.legacy_client_id}`}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!isSubtaskView && task.has_tracking && (
                  <button className="aq-btn aq-btn-secondary" onClick={() => setTrackingOpen(true)}>
                    Tracking sheet
                  </button>
                )}
                {!isSubtaskView && canRequestContract && (
                  <button className="aq-btn aq-btn-secondary" onClick={() => setRequestOpen(true)}>
                    Request contract
                  </button>
                )}
                {canMarkDone && task.status !== 'done' && (
                  <button className="aq-btn aq-btn-primary" disabled={busy} onClick={handleMarkDone}>
                    Mark complete
                  </button>
                )}
                {canDelete && (
                  <button className="aq-btn aq-btn-danger" disabled={busy} onClick={handleDeleteTask}>
                    Delete
                  </button>
                )}
                <button className="aq-btn aq-btn-ghost" onClick={onClose} aria-label="Close">✕</button>
              </div>
            </header>

            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {error && (
                <div style={{
                  background: 'var(--aq-error)', color: '#fff',
                  padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 13,
                }}>{error}</div>
              )}

              {!canEdit && role === 'member' && (
                <div className="aq-badge aq-badge-info" style={{ alignSelf: 'flex-start' }}>
                  Read-only — you can comment and upload files
                </div>
              )}

              {autoSentBanner && (
                <div style={{
                  background: 'var(--aq-accent-light)',
                  color: 'var(--aq-accent)',
                  padding: '10px 14px',
                  borderRadius: 'var(--aq-radius)',
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span>{autoSentBanner}</span>
                  <button
                    type="button"
                    className="aq-btn aq-btn-ghost"
                    onClick={() => setAutoSentBanner(null)}
                    style={{ padding: '2px 8px', fontSize: 11 }}
                  >dismiss</button>
                </div>
              )}

              {/* Tracking sheet toggle — parent campaigns only */}
              {!isSubtaskView && canEditBudget && (
                <section className="aq-card" style={{
                  padding: 18, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12,
                }}>
                  <div>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>Tracking sheet</h3>
                    <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                      {task.has_tracking
                        ? 'This campaign has a tracking sheet. Open it from the “Tracking sheet” button above or the Tracking Sheets sidebar.'
                        : 'Turn on to add a tracking sheet for this campaign.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`aq-btn ${task.has_tracking ? 'aq-btn-secondary' : 'aq-btn-primary'}`}
                    disabled={busy}
                    onClick={() => handleToggleTracking(!task.has_tracking)}
                  >
                    {task.has_tracking ? 'Disable' : 'Enable tracking sheet'}
                  </button>
                </section>
              )}

              {/* Fields */}
              <section className="aq-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Details</h3>
                <FieldRow label="Brand"        value={task.brand_name ?? '—'} />
                <FieldRow label="Client"       value={task.legacy_client_id ?? '—'} />
                <FieldRow label="Sales closer" value={closer?.full_name ?? '—'} />
                <FieldRow label="Key account (owner)" value={ka?.full_name ?? '—'} />
                <FieldRow label="Priority"     value={task.priority} />
                <FieldRow label="Service types" value={
                  taskServiceTypes.length
                    ? taskServiceTypes.map((s) => `${s.icon ?? ''} ${s.name}`).join(', ')
                    : '—'
                } />
                <FieldRow label="Created"      value={new Date(task.created_at).toLocaleString()} />
                {task.completed_at && <FieldRow label="Completed" value={new Date(task.completed_at).toLocaleString()} />}

                {/* Editable budget */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
                  padding: '6px 0', fontSize: 13, alignItems: 'center',
                }}>
                  <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Budget (SAR)</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {canEditBudget ? (
                      <>
                        <input
                          className="aq-input"
                          style={{ maxWidth: 180 }}
                          value={budgetDraft}
                          onChange={(e) => setBudgetDraft(e.target.value)}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                        <button
                          type="button"
                          className="aq-btn aq-btn-secondary"
                          onClick={handleSaveBudget}
                          disabled={budgetSaving || (budgetDraft.trim() === (task.budget != null ? String(task.budget) : ''))}
                        >{budgetSaving ? 'Saving…' : 'Save'}</button>
                      </>
                    ) : (
                      <span style={{ color: 'var(--aq-text)' }}>
                        {task.budget != null ? `SAR ${Number(task.budget).toLocaleString()}` : '—'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Per-subtask assignee (the "doer"). Hidden on parents — parents
                    use the multi-collaborator panel below. */}
                {isSubtaskView && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
                    padding: '6px 0', fontSize: 13, alignItems: 'center',
                  }}>
                    <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Assigned to</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {canEditAssignee ? (
                        <select
                          className="aq-input"
                          style={{ maxWidth: 280 }}
                          value={task.assignee_id ?? ''}
                          onChange={(e) => handleChangeAssignee(e.target.value)}
                          disabled={assigneeSaving}
                        >
                          <option value="">— Unassigned —</option>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.full_name}{p.role ? ` (${p.role})` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: 'var(--aq-text)' }}>{subAssignee?.full_name ?? '—'}</span>
                      )}
                      {assigneeSaving && (
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>Saving…</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Per-subtask vendor (picked from the vendors table — not typeable).
                    When this is set AND budget > 0, the contract request auto-fires. */}
                {isSubtaskView && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
                    padding: '6px 0', fontSize: 13, alignItems: 'center',
                  }}>
                    <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>Vendor</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {canEditAssignee ? (
                        <select
                          className="aq-input"
                          style={{ maxWidth: 360 }}
                          value={task.vendor_id ?? ''}
                          onChange={(e) => handleChangeVendor(e.target.value)}
                          disabled={vendorSaving || Boolean(task.contract_request_id)}
                        >
                          <option value="">— No vendor —</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}{v.license_number ? ` · ${v.license_number}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: 'var(--aq-text)' }}>
                          {vendors.find((v) => v.id === task.vendor_id)?.name ?? '—'}
                        </span>
                      )}
                      {vendorSaving && (
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>Saving…</span>
                      )}
                      {task.contract_request_id && (
                        <span className="aq-badge aq-badge-success" style={{ fontSize: 11 }}>
                          Contract request sent
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {task.description && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--aq-border-light)' }}>
                    <div className="aq-label">Description</div>
                    <p style={{ marginTop: 4, fontSize: 14, color: 'var(--aq-text-secondary)', whiteSpace: 'pre-wrap' }}>
                      {task.description}
                    </p>
                  </div>
                )}
              </section>

              {/* ── Operations panel (migration 028) ───────────────────────
                  Per-vendor financial fields on subtasks; per-campaign
                  quotation / invoice / payment / contract on parents. Same
                  edit permissions as the Budget field above. */}
              <OperationsPanel
                task={task}
                isSubtaskView={isSubtaskView}
                canEdit={canEditBudget}
                taskSources={taskSources}
                clientCategories={clientCategories}
                onChanged={async () => { await refetchTask(); onChanged?.(); }}
              />

              {/* Multi-assignee panel — parent only.
                  Subtasks have a single "doer" picker above. */}
              {!isSubtaskView && (
                <TaskAssignees
                  taskId={task.id}
                  currentUserId={currentUserId}
                  role={role}
                  profiles={profiles}
                  canEdit={Boolean(isPrivileged || isKeyAcct)}
                />
              )}

              {/* Subtasks list — clickable rows, no checklist.
                  Only shown on the parent (subtasks don't currently have grandchildren). */}
              {!isSubtaskView && subtasks.length > 0 && (
                <section className="aq-card" style={{ padding: 18 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12,
                    gap: 12, flexWrap: 'wrap',
                  }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                      Subtasks ({subtasks.filter((s) => s.status === 'done').length} of {subtasks.length} done)
                    </h3>
                    <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
                      Distributed: <strong style={{ color: 'var(--aq-text)' }}>SAR {subtaskBudgetSum.toLocaleString()}</strong>
                      {parentBudget > 0 && (
                        <> of SAR {parentBudget.toLocaleString()} ·{' '}
                          <span style={{
                            color: variance < 0 ? 'var(--aq-error)' : variance > 0 ? 'var(--aq-warning, #b45309)' : 'var(--aq-text-muted)',
                          }}>
                            {variance === 0 ? 'fully allocated'
                              : variance > 0 ? `SAR ${variance.toLocaleString()} unallocated`
                              : `SAR ${Math.abs(variance).toLocaleString()} over budget`}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                  <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {subtasks.map((s) => {
                      const done = s.status === 'done';
                      const sa = s.assignee_id ? profileById.get(s.assignee_id) : null;
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setCurrentTaskId(s.id)}
                            style={{
                              width: '100%', textAlign: 'left',
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '10px 12px', borderRadius: 'var(--aq-radius)',
                              background: done ? 'var(--aq-accent-light)' : 'var(--aq-bg-sunken)',
                              border: '1px solid var(--aq-border-light)',
                              cursor: 'pointer',
                            }}
                          >
                            <span style={{
                              flex: 1, fontSize: 14,
                              textDecoration: done ? 'line-through' : 'none',
                              color: done ? 'var(--aq-text-muted)' : 'var(--aq-text)',
                              fontWeight: 600,
                            }}>{s.title}</span>
                            {s.budget != null && (
                              <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                                SAR {Number(s.budget).toLocaleString()}
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                              {sa?.full_name ?? 'Unassigned'}
                            </span>
                            <span className={`aq-badge ${done ? 'aq-badge-success' : 'aq-badge-muted'}`}>
                              {done ? 'done' : s.status}
                            </span>
                            <span aria-hidden style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>›</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p style={{ marginTop: 10, fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    Click a subtask to open it — each has its own files, comments, budget, and assignee.
                  </p>
                </section>
              )}

              {/* Files */}
              <section className="aq-card" style={{ padding: 18 }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  marginBottom: 12, gap: 12,
                }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700 }}>
                    Files ({attachments.length})
                  </h3>
                  {canAttach && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        ref={fileInputRef}
                        type="file"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFilePicked(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        className="aq-btn aq-btn-primary"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={busy}
                      >{busy ? 'Uploading…' : 'Upload file'}</button>
                    </div>
                  )}
                </div>
                {attachments.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                    No files yet. Click <strong>Upload file</strong> above to attach one.
                  </p>
                )}
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {attachments.map((a) => {
                    const canRemove = a.uploader_id === currentUserId || isPrivileged;
                    return (
                      <li key={a.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', borderRadius: 'var(--aq-radius)',
                        background: 'var(--aq-bg-sunken)',
                      }}>
                        <span aria-hidden style={{ fontSize: 18 }}>📎</span>
                        <button
                          type="button"
                          onClick={() => handleOpenAttachment(a)}
                          style={{
                            flex: 1, fontSize: 14, color: 'var(--aq-accent)',
                            background: 'none', border: 'none', padding: 0,
                            cursor: 'pointer', textAlign: 'left',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >{a.filename}</button>
                        <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                          {new Date(a.created_at).toLocaleDateString()}
                        </span>
                        {canRemove && (
                          <button
                            type="button"
                            className="aq-btn aq-btn-ghost"
                            disabled={busy}
                            onClick={() => handleDeleteAttachment(a.id)}
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            aria-label="Remove attachment"
                          >✕</button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Comments */}
              <section className="aq-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                  Comments ({comments.length})
                </h3>
                {comments.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                    Be the first to comment.
                  </p>
                )}
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {comments.map((c) => {
                    const author = c.author?.full_name ?? profileById.get(c.author_id)?.full_name ?? 'Someone';
                    const canRemove = c.author_id === currentUserId || isPrivileged;
                    return (
                      <li key={c.id} style={{
                        padding: '10px 12px', borderRadius: 'var(--aq-radius)',
                        background: 'var(--aq-bg-sunken)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 13 }}>{author}</strong>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                              {new Date(c.created_at).toLocaleString()}
                            </span>
                            {canRemove && (
                              <button
                                type="button"
                                className="aq-btn aq-btn-ghost"
                                onClick={() => handleDeleteComment(c.id)}
                                disabled={busy}
                                style={{ padding: '2px 6px', fontSize: 11 }}
                                aria-label="Delete comment"
                              >✕</button>
                            )}
                          </div>
                        </div>
                        <p style={{ marginTop: 4, fontSize: 14, whiteSpace: 'pre-wrap' }}>{c.content}</p>
                      </li>
                    );
                  })}
                </ul>
                {canComment && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <textarea
                      className="aq-textarea"
                      style={{ minHeight: 60 }}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment… (Cmd/Ctrl+Enter to send)"
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleAddComment();
                      }}
                    />
                    <button
                      type="button"
                      className="aq-btn aq-btn-primary"
                      onClick={handleAddComment}
                      disabled={busy || !commentText.trim()}
                    >Send</button>
                  </div>
                )}
              </section>
            </div>

            {requestOpen && (
              <RequestContractModal
                task={task}
                currentUserId={currentUserId}
                onClose={() => setRequestOpen(false)}
                onCreated={() => { setRequestOpen(false); onChanged?.(); }}
              />
            )}

            {trackingOpen && (
              <TrackingSheetPanel
                taskId={task.id}
                taskTitle={task.task_name || task.title}
                brandName={task.brand_name}
                role={role}
                onClose={() => setTrackingOpen(false)}
              />
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12,
      padding: '6px 0', fontSize: 13,
    }}>
      <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ color: 'var(--aq-text)' }}>{value}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   OperationsPanel
   Edits the migration-028 operations columns. One section that swaps its
   fields based on whether we're looking at a parent campaign or a vendor
   subtask. Each field saves on blur (text/number) or change (select/date).
   ───────────────────────────────────────────────────────────────────── */

import type { PMTask, TaskSource, ClientCategory } from '@/hooks/use-workflow';

function OperationsPanel({
  task, isSubtaskView, canEdit, taskSources, clientCategories, onChanged,
}: {
  task: PMTask;
  isSubtaskView: boolean;
  canEdit: boolean;
  taskSources: TaskSource[];
  clientCategories: ClientCategory[];
  onChanged: () => Promise<void>;
}) {
  // Generic field saver — writes `{ [field]: value }` to pm_tasks and
  // refetches the row. Null-coerced empties so a cleared field actually
  // becomes NULL in the DB, not the string "".
  const save = async (field: keyof PMTask, raw: any) => {
    const value =
      raw === '' || raw === undefined ? null :
      raw;
    try {
      await updateTaskFields(task.id, { [field]: value } as any);
      await onChanged();
    } catch (e: any) {
      window.alert(`Save failed: ${e?.message ?? e}`);
    }
  };

  const numberOrNull = (raw: string): number | null => {
    const trimmed = raw.trim().replace(/,/g, '');
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  // Render a single labeled row with a generic editor. `kind` switches
  // between inline-editable text/number/date/select. Read-only fall-back
  // when canEdit=false.
  const Row = ({
    label, children,
  }: { label: string; children: React.ReactNode }) => (
    <div style={{
      display: 'grid', gridTemplateColumns: '160px 1fr', gap: 12,
      padding: '6px 0', fontSize: 13, alignItems: 'center',
    }}>
      <span style={{ color: 'var(--aq-text-muted)', fontWeight: 600 }}>{label}</span>
      <div>{children}</div>
    </div>
  );

  const fmtMoney = (n: number | null | undefined) =>
    n == null ? '—' : `SAR ${Number(n).toLocaleString()}`;

  // PER-VENDOR (subtask) fields ───────────────────────────────────────
  if (isSubtaskView) {
    return (
      <section className="aq-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Operations · Vendor</h3>

        <Row label="Price (SAR)">
          {canEdit
            ? <TextInput
                defaultValue={task.price != null ? String(task.price) : ''}
                placeholder="0.00"
                inputMode="decimal"
                onCommit={(v) => save('price', numberOrNull(v))}
                style={{ maxWidth: 200 }}
              />
            : <span>{fmtMoney(task.price)}</span>}
        </Row>

        <Row label="Net amount (SAR)">
          {canEdit
            ? <TextInput
                defaultValue={task.net_amount != null ? String(task.net_amount) : ''}
                placeholder="0.00"
                inputMode="decimal"
                onCommit={(v) => save('net_amount', numberOrNull(v))}
                style={{ maxWidth: 200 }}
              />
            : <span>{fmtMoney(task.net_amount)}</span>}
        </Row>

        <Row label="AQ Gross">
          {/* Generated column: read-only. Falls back to "—" until both
              price and net_amount are entered. */}
          <span style={{
            fontWeight: 600,
            color: task.aq_gross != null && Number(task.aq_gross) < 0
              ? 'var(--aq-error)' : 'var(--aq-text)',
          }}>
            {fmtMoney(task.aq_gross)}
            {task.aq_gross != null && task.price != null && Number(task.price) > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--aq-text-muted)' }}>
                ({Math.round((Number(task.aq_gross) / Number(task.price)) * 100)}% margin)
              </span>
            )}
          </span>
        </Row>

        <Row label="Platform">
          {canEdit
            ? <TextInput
                defaultValue={task.platform ?? ''}
                placeholder="Instagram, TikTok"
                onCommit={(v) => save('platform', v.trim() || null)}
              />
            : <span>{task.platform || '—'}</span>}
        </Row>

        <Row label="AD type">
          {canEdit
            ? <TextInput
                defaultValue={task.ad_type ?? ''}
                placeholder="VideoShot"
                onCommit={(v) => save('ad_type', v.trim() || null)}
              />
            : <span>{task.ad_type || '—'}</span>}
        </Row>

        <Row label="Vendor paid (SAR)">
          {canEdit
            ? <TextInput
                defaultValue={task.vendor_payment_amount != null ? String(task.vendor_payment_amount) : ''}
                placeholder="0.00"
                inputMode="decimal"
                onCommit={(v) => save('vendor_payment_amount', numberOrNull(v))}
                style={{ maxWidth: 200 }}
              />
            : <span>{fmtMoney(task.vendor_payment_amount)}</span>}
        </Row>

        <Row label="Vendor paid on">
          {canEdit
            ? <input
                type="date"
                className="aq-input"
                style={{ maxWidth: 200 }}
                defaultValue={task.vendor_payment_date ?? ''}
                onChange={(e) => save('vendor_payment_date', e.target.value || null)}
              />
            : <span>{task.vendor_payment_date || '—'}</span>}
        </Row>
      </section>
    );
  }

  // PER-CAMPAIGN (parent) fields ──────────────────────────────────────
  return (
    <section className="aq-card" style={{ padding: 18 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Operations · Campaign</h3>

      <Row label="Source">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.source_id ?? ''}
              onChange={(e) => save('source_id', e.target.value || null)}
            >
              <option value="">— None —</option>
              {taskSources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          : <span>{taskSources.find((s) => s.id === task.source_id)?.name || '—'}</span>}
      </Row>

      <Row label="Client category">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.client_category_id ?? ''}
              onChange={(e) => save('client_category_id', e.target.value || null)}
            >
              <option value="">— None —</option>
              {clientCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          : <span>{clientCategories.find((c) => c.id === task.client_category_id)?.name || '—'}</span>}
      </Row>

      <Row label="Quotation #">
        {canEdit
          ? <TextInput
              defaultValue={task.quotation_no ?? ''}
              placeholder="QT-2026-…"
              onCommit={(v) => save('quotation_no', v.trim() || null)}
              style={{ maxWidth: 240 }}
            />
          : <span>{task.quotation_no || '—'}</span>}
      </Row>

      <Row label="Quo. breakdown">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.quotation_breakdown ?? ''}
              onChange={(e) => save('quotation_breakdown', e.target.value || null)}
            >
              <option value="">— None —</option>
              <option value="With Breakdown">With Breakdown</option>
              <option value="Without Breakdown">Without Breakdown</option>
            </select>
          : <span>{task.quotation_breakdown || '—'}</span>}
      </Row>

      <Row label="Invoice #">
        {canEdit
          ? <TextInput
              defaultValue={task.invoice_no ?? ''}
              placeholder="INV-…"
              onCommit={(v) => save('invoice_no', v.trim() || null)}
              style={{ maxWidth: 240 }}
            />
          : <span>{task.invoice_no || '—'}</span>}
      </Row>

      <Row label="Client payment">
        {canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="aq-input"
              style={{ maxWidth: 160 }}
              value={task.client_payment_status ?? ''}
              onChange={(e) => save('client_payment_status', e.target.value || null)}
            >
              <option value="">— status —</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </select>
            <input
              type="date"
              className="aq-input"
              style={{ maxWidth: 160 }}
              defaultValue={task.client_payment_date ?? ''}
              onChange={(e) => save('client_payment_date', e.target.value || null)}
            />
            <TextInput
              defaultValue={task.client_payment_amount != null ? String(task.client_payment_amount) : ''}
              placeholder="amount"
              inputMode="decimal"
              onCommit={(v) => save('client_payment_amount', numberOrNull(v))}
              style={{ maxWidth: 160 }}
            />
          </div>
        ) : (
          <span>
            {[task.client_payment_status, task.client_payment_date, fmtMoney(task.client_payment_amount)]
              .filter(Boolean).join(' · ') || '—'}
          </span>
        )}
      </Row>

      <Row label="Contract status">
        {canEdit
          ? <select
              className="aq-input"
              style={{ maxWidth: 240 }}
              value={task.contract_status ?? ''}
              onChange={(e) => save('contract_status', e.target.value || null)}
            >
              <option value="">— None —</option>
              <option value="Pending">Pending</option>
              <option value="On Process">On Process</option>
              <option value="No Contract">No Contract</option>
              <option value="Signed">Signed</option>
            </select>
          : <span>{task.contract_status || '—'}</span>}
      </Row>
    </section>
  );
}

/**
 * Uncontrolled text input that fires `onCommit(value)` on blur or Enter.
 * Lets the OperationsPanel use simple field-by-field saves without
 * juggling a draft state for every column.
 */
function TextInput({
  defaultValue, onCommit, placeholder, inputMode, style,
}: {
  defaultValue: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Reset the input when the parent's defaultValue changes (e.g. after the
  // task refetches with the saved value).
  useEffect(() => {
    if (ref.current && ref.current.value !== defaultValue) {
      ref.current.value = defaultValue;
    }
  }, [defaultValue]);
  return (
    <input
      ref={ref}
      className="aq-input"
      style={style}
      defaultValue={defaultValue}
      placeholder={placeholder}
      inputMode={inputMode}
      onBlur={(e) => {
        if (e.target.value !== defaultValue) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
