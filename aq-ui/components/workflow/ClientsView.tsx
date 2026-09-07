'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  usePendingClients,
  selectAllRows,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import {
  buildClients, sortRows, filterRows, nextSort, summarise, summaryLine,
  emptyMessage, isFiltered, deleteWarning, deletedMessage, resetWarning,
  CLIENT_COLUMNS, DEFAULT_SORT, EMPTY_FILTER,
  type CampaignInput, type Filter, type RegistryRow, type RollupInput, type Sort,
} from '@/lib/registry';
import {
  RegistryTable, RegistryToolbar, RegistryHeader, Confirm, Chip, AddButton,
  Detail, DETAIL_GRID,
} from './RegistryTable';
import {
  brands as brandsApi, clientOps, manualCreate, zoho as zohoApi,
  type BrandRow, type ZohoImportJobStatus,
} from '@/lib/contract-api';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import { AdminCreatePortalModal } from '@/components/workflow/AdminCreatePortalModal';

const supabase = createSupabase();

export function ClientsView({
  role, campaigns = [], rollup = [],
}: {
  role: WorkspaceRole | null;
  /** Campaigns the page already loaded, so a row can say how much work a
   *  client has had and what it billed. No extra query. */
  campaigns?: CampaignInput[];
  rollup?: RollupInput[];
}) {
  // Read approved clients directly from public.clients so manual-created
  // rows appear immediately. The legacy pending_clients flow still works
  // (approve_pending_client bridges those rows into public.clients), so
  // both paths converge here.
  const [allClients, setAllClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = async () => {
    setLoading(true);
    // Paged: PostgREST stops at 1000 rows without saying so, which is why
        // this list and its count both sat at exactly 1000.
        const data = await selectAllRows<any>('ClientsView', () => supabase
      .from('clients')
      .select('id, pending_client_id, company_name, signatory_name, contact_name, contact_email, company_email, contact_phone, cr_number, vat_number, street, city, postcode, country, invite_status, status')
      .eq('status', 'active')
      .order('company_name'), (msg) => setError(msg));
    setAllClients(data ?? []);
    setLoading(false);
  };
  useEffect(() => { refetch(); }, []);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    company_name: '',
    cr_number: '',
    vat_number: '',
    signatory_name: '',
    email: '',
    phone: '',
    street: '',
    city: '',
    postcode: '',
    country: 'Saudi Arabia',
  });

  const canCreate = Boolean(role && ['owner','admin','marketing','sales'].includes(role));
  const canImport = Boolean(role && ['owner','admin'].includes(role));

  // Zoho bulk import state — backend now runs the job in the background
  // and we poll for progress, so we keep a ZohoImportJobStatus around to
  // render live counts in the modal.
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ZohoImportJobStatus | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Diagnostic: shift+click the Import button to dump one Zoho contact's
  // raw shape to the console + clipboard so we can see which field name
  // holds the CRN for this tenant. Doesn't actually run an import.
  const runZohoDebug = async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const data = await zohoApi.sampleContact();
      const pretty = JSON.stringify(data, null, 2);
      try { await navigator.clipboard.writeText(pretty); } catch {}
      // eslint-disable-next-line no-console
      console.log('Zoho sample contact:', data);
      setImportError(
        'Sample fetched — copied to clipboard. Open DevTools console for full output, ' +
        'or paste the clipboard contents back to me. Top-level keys: ' +
        (Array.isArray(data?.all_top_level_keys) ? data.all_top_level_keys.join(', ') : 'none')
      );
    } catch (e: any) {
      setImportError('Debug fetch failed: ' + (e?.message ?? String(e)));
    } finally {
      setImportBusy(false);
    }
  };

  /**
   * Reset wipes every client in this workspace and immediately re-imports
   * from Zoho. Use when you want a clean slate. Triggered via ctrl/cmd+click
   * on the Import button.
   */
  const runZohoReset = async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const { deleted } = await zohoApi.resetClients();
      // eslint-disable-next-line no-console
      console.log(`Reset deleted ${deleted} clients. Starting fresh import…`);
      // Fall through to a fresh import.
      await runZohoImportInner();
    } catch (e: any) {
      setImportError('Reset failed: ' + (e?.message ?? String(e)));
      setImportBusy(false);
    }
  };

  const runZohoImportInner = async () => {
    const { job_id } = await zohoApi.importCustomers();
    const startedAt = Date.now();
    const maxMs = 10 * 60 * 1000;
    while (true) {
      await new Promise((r) => setTimeout(r, 2000));
      let status: ZohoImportJobStatus;
      try {
        status = await zohoApi.importStatus(job_id);
      } catch (e: any) {
        if (Date.now() - startedAt > maxMs) throw e;
        continue;
      }
      setImportResult(status);
      if (status.status !== 'running') break;
      if (Date.now() - startedAt > maxMs) throw new Error('Import timed out after 10 minutes — refresh the page to see what landed.');
    }
    await refetch();
  };

  const runZohoImport = async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const { job_id } = await zohoApi.importCustomers();
      // Poll every 2s until the job is no longer 'running'. Cap at ~10
      // minutes so a stuck job can't loop forever.
      const startedAt = Date.now();
      const maxMs = 10 * 60 * 1000;
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        let status: ZohoImportJobStatus;
        try {
          status = await zohoApi.importStatus(job_id);
        } catch (e: any) {
          // Transient network errors — wait and retry. If the backend redeployed
          // mid-job the job_id is gone and we surface that.
          if (Date.now() - startedAt > maxMs) throw e;
          continue;
        }
        setImportResult(status);
        if (status.status !== 'running') break;
        if (Date.now() - startedAt > maxMs) throw new Error('Import timed out after 10 minutes — refresh the page to see what landed.');
      }
      await refetch();
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
    }
  };
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState('');
  const [portalFor, setPortalFor] = useState<RegistryRow | null>(null);

  const rows = useMemo(
    () => buildClients({ clients: allClients, campaigns, rollup }),
    [allClients, campaigns, rollup],
  );
  const shown = useMemo(
    () => sortRows(filterRows(rows, { ...filter, query }), sort),
    [rows, filter, query, sort],
  );
  const summary = summarise(rows, shown);
  const deleting = confirmDeleteId ? rows.find((r) => r.id === confirmDeleteId) ?? null : null;

  const removeClient = async (row: RegistryRow) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await clientOps.remove(row.id);
      setMessage(deletedMessage(row.name));
      setConfirmDeleteId(null);
      setExpandedId(null);
      await refetch();
    } catch (e: any) {
      // A sentence, not a window.alert with SQL in it for somebody to paste
      // into the Supabase editor.
      setError(`Could not delete ${row.name}. ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!form.company_name.trim()) {
      setError('Company name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Route through the contract backend so field mapping (phone→contact_phone,
      // email→contact_email, etc.) and audit logging happen server-side. The
      // backend's vendors.py:manual_create_client is gated to admin/owner roles.
      await manualCreate.client({
        company_name: form.company_name.trim(),
        cr_number: form.cr_number.trim(),
        vat_number: form.vat_number.trim(),
        signatory_name: form.signatory_name.trim(),
        email: form.email.trim(),
        company_email: form.email.trim(),
        phone: form.phone.trim(),
        street: form.street.trim(),
        city: form.city.trim(),
        postcode: form.postcode.trim(),
        country: form.country.trim(),
      });
      setForm({
        company_name: '',
        cr_number: '',
        vat_number: '',
        signatory_name: '',
        email: '',
        phone: '',
        street: '',
        city: '',
        postcode: '',
        country: 'Saudi Arabia',
      });
      setOpen(false);
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <RegistryHeader title="Clients" line={summaryLine(summary, 'client')}>
        {canImport && (
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            disabled={importBusy}
            onClick={() => runZohoImport()}
            style={{ fontSize: 12.5, padding: '6px 12px' }}
          >{importBusy ? 'Importing…' : 'Import from Zoho'}</button>
        )}
        {/* Ink, not accent green — green already means "portal active" two
            columns over, and a green button beside green pills makes the
            colour stop meaning anything. */}
        <AddButton
          label="Add a client"
          onClick={() => setOpen(true)}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Only owners, admins, marketing and sales add clients'}
        />
      </RegistryHeader>

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

      <RegistryToolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search name, CR, VAT, signatory, email or city…"
      >
        <Chip
          label="Missing contract details"
          count={summary.withGaps}
          danger
          on={filter.withGaps}
          onClick={() => setFilter((f) => ({ ...f, withGaps: !f.withGaps }))}
        />
        <Chip
          label="No portal"
          count={summary.noPortal}
          on={filter.noPortal}
          onClick={() => setFilter((f) => ({ ...f, noPortal: !f.noPortal }))}
        />
        <Chip
          label="No campaigns yet"
          count={rows.filter((r) => r.count === 0).length}
          on={filter.noWork}
          onClick={() => setFilter((f) => ({ ...f, noWork: !f.noWork }))}
        />
        {isFiltered({ ...filter, query }) && (
          <button
            type="button"
            className="aq-btn aq-btn-ghost"
            onClick={() => { setFilter(EMPTY_FILTER); setQuery(''); }}
            style={{ fontSize: 12.5, padding: '5px 10px', color: 'var(--aq-text-secondary)' }}
          >Clear</button>
        )}
      </RegistryToolbar>

      {/* The reset used to be Ctrl/Cmd + click on the Import button, with the
          only documentation in that button's tooltip — and Cmd-click is what
          a Mac user does to open something in a new tab. Its own named
          control now, and it asks. */}
      {canImport && (
        confirmReset ? (
          <Confirm
            text={resetWarning(rows.length)}
            confirmLabel="Yes, wipe and re-import"
            busy={importBusy}
            onConfirm={() => { setConfirmReset(false); runZohoReset(); }}
            onCancel={() => setConfirmReset(false)}
          />
        ) : (
          <div style={{ display: 'flex' }}>
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={() => setConfirmReset(true)}
              disabled={importBusy}
              style={{ marginLeft: 'auto', fontSize: 12, color: '#b91c1c', padding: '4px 8px' }}
            >Wipe all clients and re-import from Zoho…</button>
          </div>
        )
      )}

      {deleting && (
        <Confirm
          text={deleteWarning(deleting, 'client')}
          confirmLabel="Yes, delete"
          busy={busy}
          onConfirm={() => removeClient(deleting)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {loading && allClients.length === 0 ? (
        <div className="aq-card" style={{ padding: 34 }} />
      ) : shown.length === 0 ? (
        <div className="aq-card" style={{
          padding: 34, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13.5,
        }}>{emptyMessage({ ...filter, query }, rows.length, 'client')}</div>
      ) : (
        <RegistryTable
          rows={shown}
          columns={CLIENT_COLUMNS}
          sort={sort}
          onSort={(k) => setSort((cur) => nextSort(cur, k))}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          renderDetail={(r) => (
            <ClientDetail
              row={r}
              isAdmin={role === 'owner' || role === 'admin'}
              onPortal={() => setPortalFor(r)}
              onDelete={() => setConfirmDeleteId(r.id)}
            />
          )}
        />
      )}

      <AdminCreatePortalModal
        open={portalFor != null}
        target={portalFor ? {
          role: 'client',
          label: portalFor.name,
          client_id: portalFor.id,
          email: String(portalFor.raw.company_email ?? portalFor.raw.contact_email ?? '') || null,
        } : null}
        onClose={() => setPortalFor(null)}
      />

      {(importResult || importError) && (
        <Modal title="Zoho Import" onClose={() => { setImportResult(null); setImportError(null); }}>
          {importError ? (
            <div className="aq-badge aq-badge-error" style={{ padding: 12 }}>
              {importError}
            </div>
          ) : importResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Live status banner — shows running/done/error + the latest message */}
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--aq-radius)',
                background: importResult.status === 'done' ? '#dcfce7'
                          : importResult.status === 'error' ? '#fee2e2'
                          : 'var(--aq-bg-sunken)',
                color: importResult.status === 'done' ? '#166534'
                      : importResult.status === 'error' ? '#991b1b'
                      : 'var(--aq-text)',
                fontSize: 13, fontWeight: 600,
              }}>
                {importResult.status === 'running' && '⏳ '}
                {importResult.status === 'done' && '✓ '}
                {importResult.status === 'error' && '✗ '}
                {importResult.message}
                {importResult.status === 'running' && importResult.total > 0 && (
                  <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7 }}>
                    ({importResult.scanned} of {importResult.total})
                  </span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <ImportStat label="Scanned" value={importResult.scanned} />
                <ImportStat label="Created" value={importResult.created} accent="#16a34a" />
                <ImportStat label="Updated" value={importResult.updated} accent="#2563eb" />
                <ImportStat label="Skipped" value={importResult.skipped} accent="#6b7280" />
              </div>
              {importResult.errors.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--aq-error)' }}>
                    {importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}
                  </summary>
                  <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: 'var(--aq-text-muted)' }}>
                    {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
              {importResult.created_names.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    New clients ({importResult.created_names.length})
                  </summary>
                  <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12 }}>
                    {importResult.created_names.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </details>
              )}
              {importResult.updated_names.length > 0 && (
                <details>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                    Updated ({importResult.updated_names.length})
                  </summary>
                  <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12 }}>
                    {importResult.updated_names.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
          <Actions
            busy={false}
            disabled={false}
            submitLabel="Close"
            onCancel={() => { setImportResult(null); setImportError(null); }}
            onSubmit={() => { setImportResult(null); setImportError(null); }}
          />
        </Modal>
      )}

      {open && (
        <Modal title="Add Client" onClose={() => setOpen(false)}>
          <div style={formGrid}>
            <Field label="Client / company name" required>
              <input className="aq-input" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} autoFocus />
            </Field>
            <Field label="CR number">
              <input className="aq-input" value={form.cr_number} onChange={(e) => setForm({ ...form, cr_number: e.target.value })} />
            </Field>
            <Field label="VAT number">
              <input className="aq-input" value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
            </Field>
            <Field label="Signatory name">
              <input className="aq-input" value={form.signatory_name} onChange={(e) => setForm({ ...form, signatory_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="aq-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="aq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Street">
              <input className="aq-input" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
            </Field>
            <Field label="City">
              <input className="aq-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Postcode">
              <input className="aq-input" value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
            </Field>
            <Field label="Country">
              <input className="aq-input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </Field>
          </div>
          <Actions busy={busy} disabled={!form.company_name.trim()} submitLabel="Add Client" onCancel={() => setOpen(false)} onSubmit={submit} />
        </Modal>
      )}
    </div>
  );
}

function ImportStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="aq-card" style={{ padding: 12, textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || 'var(--aq-text)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div className="aq-card" style={modalCard} onClick={(e) => e.stopPropagation()}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={{ fontSize: 20, fontWeight: 800 }}>{title}</h3>
          <button className="aq-btn aq-btn-ghost" onClick={onClose}>Close</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label>
      <div className="aq-label">{label}{required ? ' *' : ''}</div>
      {children}
    </label>
  );
}

function Actions({
  busy, disabled, submitLabel, onCancel, onSubmit,
}: {
  busy: boolean;
  disabled?: boolean;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
      <button className="aq-btn aq-btn-ghost" onClick={onCancel}>Cancel</button>
      <button className="aq-btn aq-btn-primary" disabled={busy || disabled} onClick={onSubmit}>
        {busy ? 'Saving...' : submitLabel}
      </button>
    </div>
  );
}

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 200,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
};

const modalCard: React.CSSProperties = {
  width: '100%',
  maxWidth: 760,
  padding: 24,
  maxHeight: '90vh',
  overflow: 'auto',
};

// ───────────────────────────────────────────────────────────────────────────
// ClientCard — collapsed by default; click to expand brand management
// + admin/owner delete.
// ───────────────────────────────────────────────────────────────────────────

/**
 * What was behind the card, now behind the row.
 *
 * CR, VAT, phone and address stop being printed on eighty-five cards at once
 * and live here — where a missing one can be called missing, because it will
 * be missing in the contract too.
 */
function ClientDetail({
  row, isAdmin, onPortal, onDelete,
}: {
  row: RegistryRow;
  isAdmin: boolean;
  onPortal: () => void;
  onDelete: () => void;
}) {
  const c = row.raw as any;
  const address = [c.street, c.city, c.postcode, c.country].filter(Boolean).join(', ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={DETAIL_GRID}>
        <Detail label="CR number" value={c.cr_number} missing />
        <Detail label="VAT number" value={c.vat_number} missing />
        <Detail label="Signatory" value={c.signatory_name} missing />
        <Detail label="Contact" value={c.contact_name} />
        <Detail label="Email" value={c.company_email || c.contact_email} />
        <Detail label="Phone" value={c.contact_phone} />
        <Detail label="Address" value={address} missing />
      </div>

      <BrandManagerInline clientId={row.id} />

      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={onPortal}
            style={{ fontSize: 12, padding: '5px 11px' }}
          >{row.portal === 'active' ? 'Reset password' : 'Make portal'}</button>
          <button
            type="button"
            className="aq-btn aq-btn-ghost"
            onClick={onDelete}
            style={{ fontSize: 12, padding: '5px 11px', color: '#b91c1c' }}
          >Delete client…</button>
        </div>
      )}
    </div>
  );
}

function BrandManagerInline({ clientId }: { clientId: string }) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await brandsApi.withCounts(clientId);
      setBrands(list);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [clientId]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy('add');
    setError('');
    try {
      await brandsApi.create(clientId, name.trim());
      setName('');
      await refresh();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(
        msg.includes('not a member')
          ? `${msg}\n\nThe contract backend has not been restarted since the auth fix. Restart uvicorn.`
          : msg,
      );
    } finally {
      setBusy(null);
    }
  };

  const onRename = async (b: BrandRow) => {
    const next = window.prompt('Rename brand', b.brand_name);
    if (!next || next.trim() === b.brand_name) return;
    setBusy(b.id);
    try {
      await brandsApi.update(b.id, { brand_name: next.trim() });
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (b: BrandRow) => {
    setBusy(b.id);
    try {
      await brandsApi.remove(b.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <strong style={{ fontSize: 12, color: 'var(--aq-text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Brands
      </strong>

      <form onSubmit={onAdd} style={{ display: 'flex', gap: 8 }}>
        <input
          className="aq-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New brand name"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="aq-btn aq-btn-primary"
          style={{ padding: '6px 14px', fontSize: 12 }}
          disabled={!name.trim() || busy === 'add'}
        >
          {busy === 'add' ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && <div className="aq-badge aq-badge-error" style={{ display: 'block' }}>{error}</div>}

      {loading ? (
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>Loading…</p>
      ) : brands.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>No brands yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {brands.map((b) => (
            <li key={b.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--aq-border-light)',
              borderRadius: 'var(--aq-radius)',
            }}>
              <strong style={{ flex: 1, fontSize: 13 }}>{b.brand_name}</strong>
              <span className="aq-badge aq-badge-muted" style={{ fontSize: 11 }}>
                {b.contract_count ?? 0} contracts
              </span>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11 }}
                disabled={busy === b.id}
                onClick={() => onRename(b)}
              >Rename</button>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11, color: 'var(--aq-error)' }}
                disabled={busy === b.id || (b.contract_count ?? 0) > 0}
                title={(b.contract_count ?? 0) > 0 ? 'Has contracts; rename instead.' : ''}
                onClick={() => onDelete(b)}
              >Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
