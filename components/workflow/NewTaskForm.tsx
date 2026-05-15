'use client';

import { useState } from 'react';
import { createSalesTask, type Profile, type WorkspaceRole } from '@/hooks/use-workflow';

/**
 * Sales create-task screen — matches the user's hand-drawn sketch.
 * Open boxes for sales fields; greyed-out lockers for the marketing-side
 * fields (Priority / Service Type / Key Account / Done) which display
 * as "Marketing will fill" placeholders.
 */
export function NewTaskForm({
  workspaceId, currentUserId, role, profiles, onCreated,
}: {
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  onCreated?: (taskId: string) => void;
}) {
  const [taskName, setTaskName]   = useState('');
  const [clientName, setClientName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [salesCloser, setSalesCloser] = useState('');
  const [budget, setBudget]       = useState('');
  const [details, setDetails]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  const canCreate = role && ['owner','admin','sales','marketing'].includes(role);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!taskName.trim() || !clientName.trim() || !brandName.trim()) {
      setError('Task name, client, and brand are required.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSalesTask({
        workspace_id: workspaceId,
        task_name: taskName.trim(),
        brand_name: brandName.trim(),
        legacy_client_id: clientName.trim(),
        sales_closer_id: salesCloser || null,
        budget: budget ? Number(budget.replace(/,/g, '')) : null,
        details: details.trim() || null,
        creator_id: currentUserId,
      });
      setSuccess(`Task "${created.task_name}" sent to marketing for triage.`);
      // reset form
      setTaskName(''); setClientName(''); setBrandName('');
      setSalesCloser(''); setBudget(''); setDetails('');
      onCreated?.(created.id);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate) {
    return (
      <div className="aq-card animate-fade-in" style={{ padding: 32, textAlign: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Not your screen</h2>
        <p style={{ color: 'var(--aq-text-muted)', marginTop: 8, fontSize: 14 }}>
          Only sales, marketing, admin, and owner roles can create new tasks.
          Your role is <strong>{role || 'unset'}</strong>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="animate-fade-in">
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
        gap: 20,
        alignItems: 'start',
      }}>
        {/* LEFT — sales-fillable */}
        <div className="aq-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <header>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>New Task</h2>
            <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
              Fill these fields. Marketing will pick up the task once you submit.
            </p>
          </header>

          <Field label="Task name *">
            <input
              className="aq-input"
              value={taskName}
              onChange={(e) => setTaskName(e.target.value)}
              placeholder="e.g. Q2 Influencer push for Brand X"
              required
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Client ID / name *">
              <input
                className="aq-input"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Client identifier"
                required
              />
            </Field>
            <Field label="Brand name *">
              <input
                className="aq-input"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Brand"
                required
              />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Sales closer">
              <select
                className="aq-select"
                value={salesCloser}
                onChange={(e) => setSalesCloser(e.target.value)}
              >
                <option value="">— Select —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} {p.role !== 'member' ? `(${p.role === 'key_account' ? 'Key account' : p.role})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Budget (SAR)">
              <input
                className="aq-input"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </Field>
          </div>

          <Field label="Details / brief">
            <textarea
              className="aq-textarea"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={5}
              placeholder="Anything marketing should know up front."
            />
          </Field>

          {error && (
            <div style={{
              background: 'var(--aq-error)', color: '#fff',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)',
              fontSize: 13,
            }}>{error}</div>
          )}
          {success && (
            <div style={{
              background: 'var(--aq-accent-light)', color: 'var(--aq-accent)',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)',
              fontSize: 13, fontWeight: 600,
            }}>{success}</div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="aq-btn aq-btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send to marketing'}
            </button>
          </div>
        </div>

        {/* RIGHT — locked panels (marketing's job) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <LockedField title="Priority of sale" hint="Marketing will pick" />
          <LockedField title="Type of service" hint="Marketing will pick" />
          <LockedField title="Key account manager" hint="Marketing will assign" highlight />
          <LockedField title="Status" hint="Auto: pending marketing" />
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="aq-label">{label}</div>
      {children}
    </div>
  );
}

function LockedField({ title, hint, highlight }: { title: string; hint: string; highlight?: boolean }) {
  return (
    <div
      className="aq-card"
      style={{
        padding: 18,
        background: highlight ? 'rgba(120, 41, 53, 0.08)' : 'rgba(15, 29, 34, 0.04)',
        border: highlight ? '1px solid rgba(120, 41, 53, 0.25)' : '1px solid var(--aq-border-light)',
        opacity: 0.85,
      }}
    >
      <div className="aq-label" style={{ color: highlight ? '#7a2935' : undefined }}>{title}</div>
      <div style={{
        marginTop: 6, fontSize: 13, color: 'var(--aq-text-muted)',
        fontStyle: 'italic',
      }}>{hint}</div>
    </div>
  );
}
