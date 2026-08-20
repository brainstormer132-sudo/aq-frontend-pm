'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  createSalesTask,
  useClients,
  useClientBrands,
  useLegacyVendors,
  type Profile,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { SearchablePicker } from './SearchablePicker';
import type { CampaignPrefill } from '@/lib/crm-sync';
import { closerFields, closerOptions } from '@/lib/sales-closer';

/**
 * Sales create-task screen. Open boxes for sales fields; greyed-out
 * lockers for the marketing-side fields (Priority / Service Type /
 * Key Account / Done) which display as "Marketing will fill"
 * placeholders.
 *
 * Hardened (2026-05-15): Client and Brand are now picked from
 * dropdowns sourced from `clients` / `client_brands`, not free
 * text. Client must be picked first; the Brand dropdown then
 * cascades to that client's brands.
 */
export function NewTaskForm({
  workspaceId, currentUserId, role, profiles, onCreated, prefill,
}: {
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  profiles: (Profile & { role: WorkspaceRole })[];
  onCreated?: (taskId: string) => void;
  /**
   * Starting point for the form — currently set when a CRM deal is won.
   * It only ever fills boxes in; the person still reviews and submits, so a
   * won deal never becomes a campaign behind anybody's back.
   */
  prefill?: CampaignPrefill | null;
}) {
  const [taskName, setTaskName]       = useState(prefill?.task_name ?? '');
  const [clientId, setClientId]       = useState<string>(prefill?.client_id ?? '');
  const [brandId, setBrandId]         = useState<string>('');
  const [salesCloser, setSalesCloser] = useState('');
  const [budget, setBudget]           = useState(prefill?.budget != null ? String(prefill.budget) : '');
  const [details, setDetails]         = useState(prefill?.details ?? '');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState('');

  const { clients, loading: clientsLoading } = useClients();
  const { brands, loading: brandsLoading }   = useClientBrands(clientId || null);
  const { vendors }                          = useLegacyVendors();

  // One generic "Influencer" option (061). A new task has no legacy named
  // influencer to preserve, so nothing is passed as the current value.
  const influencerClosers = useMemo(() => closerOptions([], vendors || []), [vendors]);

  // Reset brand whenever client changes — old brand wouldn't belong to new client.
  useEffect(() => { setBrandId(''); }, [clientId]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId],
  );

  const canCreate = role && ['owner','admin','sales','marketing'].includes(role);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!taskName.trim()) {
      setError('Task name is required.');
      return;
    }
    if (!selectedClient) {
      setError('Pick a client from the list.');
      return;
    }
    if (!selectedBrand) {
      setError('Pick a brand from the list. (If the brand isn\'t there, add it under Vendors & Clients first.)');
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSalesTask({
        workspace_id: workspaceId,
        task_name: taskName.trim(),
        brand_name: selectedBrand.brand_name,
        legacy_client_id: selectedClient.cr_number || selectedClient.id,
        client_id: selectedClient.id,
        brand_id: selectedBrand.id,
        // One picker, the two mutually exclusive columns behind it.
        ...closerFields(salesCloser),
        budget: budget ? Number(budget.replace(/,/g, '')) : null,
        details: details.trim() || null,
        creator_id: currentUserId,
      });
      setSuccess(`Task "${created.task_name}" sent to marketing for triage.`);
      // reset form
      setTaskName(''); setClientId(''); setBrandId('');
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
              Pick the client and brand from the lists. Marketing will pick up the task once you submit.
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
            <Field label="Client *">
              {/* Type-ahead rather than a <select>: this list runs to several
                  hundred rows, with near-duplicate company names that are only
                  told apart by their CR number — hence the hint line. */}
              <SearchablePicker
                options={clients.map((c) => ({
                  value: c.id,
                  label: c.company_name,
                  hint: c.cr_number ? `CR ${c.cr_number}` : null,
                  keywords: c.vat_number,
                }))}
                value={clientId || null}
                onChange={(v) => setClientId(v ?? '')}
                disabled={clientsLoading}
                maxWidth="100%"
                placeholder={clientsLoading
                  ? 'Loading clients…'
                  : clients.length === 0
                    ? 'No clients yet — add one under Clients'
                    : 'Search clients…'}
                emptyLabel="— No client —"
              />
            </Field>

            <Field label="Brand *">
              <SearchablePicker
                options={brands.map((b) => ({ value: b.id, label: b.brand_name }))}
                value={brandId || null}
                onChange={(v) => setBrandId(v ?? '')}
                disabled={!clientId || brandsLoading}
                maxWidth="100%"
                placeholder={!clientId
                  ? 'Pick a client first'
                  : brandsLoading
                    ? 'Loading brands…'
                    : brands.length === 0
                      ? 'No brands for this client'
                      : 'Search brands…'}
                emptyLabel="— No brand —"
              />
            </Field>
          </div>

          {selectedClient && (
            <div style={{
              fontSize: 12, color: 'var(--aq-text-muted)',
              padding: '6px 10px',
              background: 'var(--aq-bg-sunken)',
              borderRadius: 'var(--aq-radius)',
            }}>
              <strong style={{ color: 'var(--aq-text)' }}>{selectedClient.company_name}</strong>
              {selectedClient.signatory_name && ` · Signatory: ${selectedClient.signatory_name}`}
              {selectedClient.contact_email && ` · ${selectedClient.contact_email}`}
              {selectedBrand && ` · Brand: ${selectedBrand.brand_name}`}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Sales closer">
              {/* Colleagues and influencers in one list — an influencer who
                  brought the client in is the closer too. */}
              <select
                className="aq-select"
                value={salesCloser}
                onChange={(e) => setSalesCloser(e.target.value)}
              >
                <option value="">— Select —</option>
                <optgroup label="Team">
                  {profiles.map((p) => (
                    <option key={p.id} value={`p:${p.id}`}>
                      {p.full_name} {p.role !== 'member' ? `(${p.role === 'key_account' ? 'Key account' : p.role})` : ''}
                    </option>
                  ))}
                </optgroup>
                {/* One option, not the whole register. Since 061 the answer
                    is "an influencer brought them in"; the hundreds of names
                    were a list nobody could get through. A row saved with a
                    specific influencer still shows that name here. */}
                {influencerClosers.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
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
