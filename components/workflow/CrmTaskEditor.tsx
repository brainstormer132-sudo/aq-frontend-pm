'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addCrmTask, updateCrmTask,
  useCrmDeals, useClients, useLegacyVendors,
  type CrmTask,
} from '@/hooks/use-workflow';

/**
 * Slide-over editor for a single CRM task / follow-up.
 *
 * Lets you set a title, description, due date, assignee, and optional
 * linkage to a client/vendor and/or deal.
 */
export function CrmTaskEditor({
  mode, task,
  workspaceId, currentUserId, currentUserName,
  onClose, onSaved, onDelete,
}: {
  mode: 'create' | 'edit';
  task: CrmTask | null;
  workspaceId: string;
  currentUserId: string;
  currentUserName: string;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const { items: deals }   = useCrmDeals(workspaceId);
  const { clients }        = useClients();
  const { vendors }        = useLegacyVendors();

  const [title, setTitle]               = useState(task?.title ?? '');
  const [description, setDescription]   = useState(task?.description ?? '');
  const [dueAt, setDueAt]               = useState<string>(
    task?.due_at ? toInputDatetime(task.due_at) : ''
  );
  const [assigneeName, setAssigneeName] = useState(task?.assigned_to_name ?? currentUserName);
  const [assigneeId, setAssigneeId]     = useState<string>(task?.assigned_to_id ?? currentUserId);
  const [targetType, setTargetType]     = useState<'' | 'client' | 'vendor'>(task?.target_type ?? '');
  const [targetId, setTargetId]         = useState<string>(task?.target_id ?? '');
  const [dealId, setDealId]             = useState<string>(task?.deal_id ?? '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const targetOptions = useMemo(() => {
    if (targetType === 'client') {
      return (clients || []).map((c) => ({ id: c.id, label: c.company_name }));
    }
    if (targetType === 'vendor') {
      return (vendors || []).map((v) => ({ id: String(v.id), label: v.name }));
    }
    return [];
  }, [targetType, clients, vendors]);

  const dealOptions = useMemo(() =>
    (deals || []).filter((d) => d.stage !== 'won' && d.stage !== 'lost')
      .map((d) => ({ id: d.id, label: `${d.name}${d.stage ? ` (${d.stage})` : ''}` })),
    [deals]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError('Give the task a title.'); return; }
    setBusy(true); setError('');
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        target_type: (targetType || null) as 'client' | 'vendor' | null,
        target_id:   targetType && targetId ? targetId : null,
        deal_id:     dealId || null,
        assigned_to_id:   assigneeId || null,
        assigned_to_name: assigneeName || '',
      };
      if (mode === 'edit' && task) {
        await updateCrmTask(task.id, payload as Partial<CrmTask>);
      } else {
        await addCrmTask({
          workspace_id: workspaceId,
          created_by_id: currentUserId,
          created_by_name: currentUserName,
          ...payload,
        });
      }
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,15,20,0.45)',
        zIndex: 60,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--aq-bg)',
          width: 'min(520px, 100%)',
          height: '100%',
          boxShadow: '-8px 0 28px rgba(0,0,0,0.2)',
          overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--aq-border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <span style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: 'var(--aq-text-muted)', fontWeight: 700,
            }}>
              {mode === 'edit' ? 'Edit task' : 'New task'}
            </span>
            <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
              {mode === 'edit' ? task?.title : 'Add a follow-up'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none',
              fontSize: 22, lineHeight: 1, cursor: 'pointer',
              color: 'var(--aq-text-muted)', padding: 4,
            }}
          >×</button>
        </header>

        <form onSubmit={submit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Title">
            <input
              className="aq-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Send Acme proposal v2"
              required
            />
          </Field>

          <Field label="Description">
            <textarea
              className="aq-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What needs to happen, links, context."
              rows={4}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Due">
              <input
                className="aq-input"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </Field>
            <Field label="Assignee name">
              <input
                className="aq-input"
                value={assigneeName}
                onChange={(e) => setAssigneeName(e.target.value)}
                placeholder="Who's on it?"
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <Field label="Link to">
              <select
                className="aq-select"
                value={targetType}
                onChange={(e) => { setTargetType(e.target.value as any); setTargetId(''); }}
              >
                <option value="">— none —</option>
                <option value="client">Client</option>
                <option value="vendor">Vendor</option>
              </select>
            </Field>
            <Field label={targetType ? `Pick ${targetType}` : 'Contact'}>
              <select
                className="aq-select"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={!targetType}
              >
                <option value="">{targetType ? '— pick one —' : '(pick a type first)'}</option>
                {targetOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Linked deal (optional)">
            <select
              className="aq-select"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
            >
              <option value="">— none —</option>
              {dealOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </Field>

          <button
            type="button"
            onClick={() => { setAssigneeId(currentUserId); setAssigneeName(currentUserName); }}
            className="aq-btn aq-btn-ghost"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
          >Assign to me</button>

          {error && (
            <div style={{
              padding: '8px 12px', background: '#fee2e2', color: '#991b1b',
              borderRadius: 'var(--aq-radius)', fontSize: 13,
            }}>{error}</div>
          )}

          <footer style={{
            display: 'flex', justifyContent: 'space-between',
            marginTop: 6, paddingTop: 12,
            borderTop: '1px solid var(--aq-border-light)',
          }}>
            {mode === 'edit' && onDelete ? (
              <button type="button" onClick={onDelete} className="aq-btn aq-btn-danger" disabled={busy}>
                Delete
              </button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onClose} className="aq-btn aq-btn-ghost" disabled={busy}>Cancel</button>
              <button type="submit" className="aq-btn aq-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add task'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.05em', color: 'var(--aq-text-muted)',
      }}>{label}</span>
      {children}
    </label>
  );
}

/** Build a `YYYY-MM-DDTHH:mm` value for an <input type="datetime-local">. */
function toInputDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
