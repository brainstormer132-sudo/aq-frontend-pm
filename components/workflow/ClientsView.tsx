'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  usePendingClients,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import {
  brands as brandsApi, clientOps, manualCreate, zoho as zohoApi,
  type BrandRow, type ZohoImportSummary,
} from '@/lib/contract-api';
import { createClient as createSupabase } from '@/lib/supabase-browser';
import { AdminCreatePortalModal } from '@/components/workflow/AdminCreatePortalModal';

const supabase = createSupabase();

export function ClientsView({ role }: { role: WorkspaceRole | null }) {
  // Read approved clients directly from public.clients so manual-created
  // rows appear immediately. The legacy pending_clients flow still works
  // (approve_pending_client bridges those rows into public.clients), so
  // both paths converge here.
  const [allClients, setAllClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const refetch = async () => {
    setLoading(true);
    const { data, error: e } = await supabase
      .from('clients')
      .select('id, pending_client_id, company_name, signatory_name, contact_name, contact_email, company_email, contact_phone, cr_number, vat_number, street, city, postcode, country, invite_status, status')
      .eq('status', 'active')
      .order('company_name');
    if (e) setError(e.message);
    setAllClients((data as any[] | null) ?? []);
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

  // Zoho bulk import state
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ZohoImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const runZohoImport = async () => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const summary = await zohoApi.importCustomers();
      setImportResult(summary);
      await refetch();
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
    } finally {
      setImportBusy(false);
    }
  };
  const clients = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allClients.filter((c: any) => !q || [
      c.company_name, c.cr_number, c.vat_number, c.signatory_name,
      c.contact_email, c.company_email, c.contact_phone,
    ].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [allClients, query]);

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
    <RegistryShell
      title="Clients"
      count={`${clients.length} client${clients.length === 1 ? '' : 's'}`}
      search={query}
      setSearch={setQuery}
      actionLabel="+ Add Client"
      canCreate={canCreate}
      onAction={() => setOpen(true)}
      secondaryActionLabel={importBusy ? 'Importing…' : 'Import from Zoho'}
      onSecondaryAction={runZohoImport}
      showSecondaryAction={canImport}
      secondaryActionBusy={importBusy}
    >
      {error && <div className="aq-badge aq-badge-error">{error}</div>}

      {clients.length === 0 ? (
        <EmptyState
          icon="🏢"
          title="No clients yet"
          body="Add your first client to start managing their projects and brands."
          actionLabel="+ Add Client"
          canCreate={canCreate}
          onAction={() => setOpen(true)}
        />
      ) : (
        <div style={gridStyle}>
          {clients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              role={role}
              onChanged={refetch}
            />
          ))}
        </div>
      )}

      {(importResult || importError) && (
        <Modal title="Zoho Import" onClose={() => { setImportResult(null); setImportError(null); }}>
          {importError ? (
            <div className="aq-badge aq-badge-error" style={{ padding: 12 }}>
              {importError}
            </div>
          ) : importResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
    </RegistryShell>
  );
}

function RegistryShell({
  title, count, search, setSearch, actionLabel, canCreate, onAction,
  secondaryActionLabel, onSecondaryAction, showSecondaryAction, secondaryActionBusy,
  children,
}: {
  title: string;
  count: string;
  search: string;
  setSearch: (v: string) => void;
  actionLabel: string;
  canCreate: boolean;
  onAction: () => void;
  /** Optional secondary action (e.g. "Import from Zoho") rendered to the left of the primary button. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  showSecondaryAction?: boolean;
  secondaryActionBusy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-fade-in" style={{ minHeight: 'calc(100vh - 180px)' }}>
      <div style={registryHeader}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800 }}>{title}</h2>
          <span style={{ color: 'var(--aq-text-muted)', fontSize: 15 }}>{count}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <label style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: 8, fontSize: 14 }}>🔍</span>
            <input
              className="aq-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              style={{ width: 220, paddingLeft: 34 }}
            />
          </label>
          {showSecondaryAction && onSecondaryAction && secondaryActionLabel && (
            <button
              className="aq-btn aq-btn-ghost"
              disabled={secondaryActionBusy}
              onClick={onSecondaryAction}
              title="Pull customers from Zoho Books"
            >
              {secondaryActionLabel}
            </button>
          )}
          <button className="aq-btn aq-btn-primary" disabled={!canCreate} onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      </div>
      {children}
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

function EmptyState({
  icon, title, body, actionLabel, canCreate, onAction,
}: {
  icon: string;
  title: string;
  body: string;
  actionLabel: string;
  canCreate: boolean;
  onAction: () => void;
}) {
  return (
    <div style={emptyState}>
      <div style={{ fontSize: 50, marginBottom: 24 }}>{icon}</div>
      <h3 style={{ fontSize: 20, fontWeight: 800 }}>{title}</h3>
      <p style={{ color: 'var(--aq-text-muted)', fontSize: 16, lineHeight: 1.5, marginTop: 14, maxWidth: 360 }}>
        {body}
      </p>
      <button className="aq-btn aq-btn-primary" disabled={!canCreate} onClick={onAction} style={{ marginTop: 26, padding: '13px 22px', fontSize: 16 }}>
        {actionLabel}
      </button>
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

function Meta({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt style={{ fontSize: 11, color: 'var(--aq-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>{label}</dt>
      <dd style={{ fontSize: 13, marginTop: 2 }}>{value || '—'}</dd>
    </div>
  );
}

const registryHeader: React.CSSProperties = {
  height: 58,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid var(--aq-border-light)',
  margin: '-4px -4px 0',
  padding: '0 4px 14px',
};
const emptyState: React.CSSProperties = {
  minHeight: 520,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 14,
  paddingTop: 22,
};
const metaGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  marginTop: 16,
};
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

function ClientCard({
  client, role, onChanged,
}: {
  client: any;
  role: WorkspaceRole | null;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const isAdmin = role === 'owner' || role === 'admin';

  // Rows now come from public.clients directly, so the row's id IS the
  // approved client id. No async resolution needed.
  const approvedClientId: string | null = client?.id ? String(client.id) : null;
  const resolveError = '';

  const onDelete = async () => {
    if (!approvedClientId) {
      window.alert(
        `Cannot delete "${client.company_name}".\n\n` +
        `This row is in pending_clients but never got bridged into public.clients ` +
        `(no row with pending_client_id=${client.id}).\n\n` +
        `Either re-approve from the registration queue, or run this in Supabase SQL Editor:\n\n` +
        `SELECT * FROM public.approve_pending_client(${client.id});`
      );
      return;
    }
    try {
      await clientOps.remove(approvedClientId);
      await onChanged();
    } catch (err: any) {
      window.alert(
        `Could not delete "${client.company_name}".\n\n${err?.message ?? String(err)}\n\n` +
        `If this says "not a member of any AQ workspace", the contract backend has not been restarted with the latest auth code. Restart uvicorn and try again.`
      );
    }
  };

  return (
    <article className="aq-card" style={{ padding: 18 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12,
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 800 }}>{client.company_name}</h3>
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
            {client.signatory_name || 'No signatory'} · {client.company_email || client.email || 'No email'}
          </p>
        </div>
        <span className="aq-badge aq-badge-success">{open ? 'open' : 'active'}</span>
      </button>

      <dl style={metaGrid}>
        <Meta label="CR" value={client.cr_number} />
        <Meta label="VAT" value={client.vat_number} />
        <Meta label="Phone" value={client.contact_phone} />
        <Meta label="Address" value={[client.street, client.city, client.postcode, client.country].filter(Boolean).join(', ')} />
      </dl>

      <AdminCreatePortalModal
        open={portalOpen}
        target={portalOpen && approvedClientId ? {
          role: 'client',
          label: client.company_name,
          client_id: approvedClientId,
          email: client.company_email || client.email || null,
        } : null}
        onClose={() => setPortalOpen(false)}
      />

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--aq-border-light)' }}>
          {resolveError ? (
            <p style={{ color: 'var(--aq-error)', fontSize: 13 }}>{resolveError}</p>
          ) : !approvedClientId ? (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 12 }}>
              Looking up the brand record…
            </p>
          ) : (
            <BrandManagerInline clientId={approvedClientId} />
          )}

          {isAdmin && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="aq-btn aq-btn-secondary"
                style={{ padding: '6px 12px', fontSize: 12 }}
                disabled={!approvedClientId}
                title={approvedClientId ? 'Set a password and create the client portal account' : 'Bridge the client first (see Delete error)'}
                onClick={() => setPortalOpen(true)}
              >
                Make portal
              </button>
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                style={{ padding: '6px 12px', fontSize: 12, color: 'var(--aq-error)' }}
                onClick={onDelete}
              >
                Delete client
              </button>
            </div>
          )}
        </div>
      )}
    </article>
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
