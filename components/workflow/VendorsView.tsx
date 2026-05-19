'use client';

import { useMemo, useState } from 'react';
import {
  approvePendingVendor,
  createApprovedVendorRegistration,
  rejectPendingVendor,
  useLegacyVendors,
  usePendingVendors,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { externalInvites, vendorOps, type ExternalInvite } from '@/lib/contract-api';
import { InviteLinkModal } from '@/components/workflow/InviteLinkModal';
import { AdminCreatePortalModal } from '@/components/workflow/AdminCreatePortalModal';

export function VendorsView({ role, userName }: { role: WorkspaceRole | null; userName: string }) {
  const { vendors, banks, refetch: refetchVendors } = useLegacyVendors();
  const { items: pending, refetch: refetchPending } = usePendingVendors();
  const [tab, setTab] = useState<'vendors' | 'pending'>('vendors');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [activeInvite, setActiveInvite] = useState<ExternalInvite | null>(null);
  const [portalTarget, setPortalTarget] = useState<{
    role: 'vendor' | 'client'; label: string; vendor_id?: number; client_id?: string; email?: string | null;
  } | null>(null);
  const [form, setForm] = useState({
    full_name: '',
    license_number: '',
    email: '',
    phone: '',
    vendor_category: '',
    platforms: '',
    bank_name: '',
    account_name: '',
    iban: '',
    account_number: '',
    swift_code: '',
  });

  const canCreate = Boolean(role && ['owner','admin','marketing'].includes(role));
  const canApprove = canCreate;
  const pendingOnly = pending.filter((p) => p.status === 'pending');

  const banksByVendor = new Map<number, typeof banks>();
  for (const bank of banks) {
    if (!banksByVendor.has(bank.vendor_id)) banksByVendor.set(bank.vendor_id, [] as any);
    (banksByVendor.get(bank.vendor_id) as any).push(bank);
  }

  const visibleVendors = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((v) => !q || [
      v.name, v.license_number, ...(banksByVendor.get(v.id) ?? []).flatMap((b) => [b.bank_name, b.iban, b.account_name]),
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [banksByVendor, query, vendors]);

  const submit = async () => {
    if (!form.full_name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await createApprovedVendorRegistration(form);
      setForm({
        full_name: '',
        license_number: '',
        email: '',
        phone: '',
        vendor_category: '',
        platforms: '',
        bank_name: '',
        account_name: '',
        iban: '',
        account_number: '',
        swift_code: '',
      });
      setOpen(false);
      await Promise.all([refetchPending(), refetchVendors()]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: number, action: 'approve' | 'reject') => {
    setBusyId(id);
    setError('');
    try {
      if (action === 'approve') await approvePendingVendor(id, userName);
      else await rejectPendingVendor(id);
      await Promise.all([refetchPending(), refetchVendors()]);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-fade-in" style={{ minHeight: 'calc(100vh - 180px)' }}>
      <div style={registryHeader}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800 }}>Vendors</h2>
          <span style={{ color: 'var(--aq-text-muted)', fontSize: 15 }}>
            {visibleVendors.length} vendor{visibleVendors.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <label style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: 8, fontSize: 14 }}>🔍</span>
            <input
              className="aq-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              style={{ width: 220, paddingLeft: 34 }}
            />
          </label>
          <button className="aq-btn aq-btn-primary" disabled={!canCreate} onClick={() => setOpen(true)}>
            + Add Vendor
          </button>
        </div>
      </div>

      <div style={tabsStyle}>
        <button className={tab === 'vendors' ? 'registry-tab active' : 'registry-tab'} onClick={() => setTab('vendors')}>
          Vendors
        </button>
        <button className={tab === 'pending' ? 'registry-tab active' : 'registry-tab'} onClick={() => setTab('pending')}>
          Pending Requests {pendingOnly.length ? `(${pendingOnly.length})` : ''}
        </button>
      </div>

      {error && <div className="aq-badge aq-badge-error" style={{ marginTop: 14 }}>{error}</div>}

      {tab === 'vendors' && (
        visibleVendors.length === 0 ? (
          <EmptyState
            icon="🏭"
            title="No vendors yet"
            body="Add your first vendor or accept one from pending requests."
            actionLabel="+ Add Vendor"
            canCreate={canCreate}
            onAction={() => setOpen(true)}
          />
        ) : (
          <div style={gridStyle}>
            {visibleVendors.map((vendor) => {
              const vendorBanks = banksByVendor.get(vendor.id) ?? [];
              const v = vendor as any;
              const inviteStatus: string = v.invite_status || 'none';
              const email: string | null = v.email || null;
              return (
                <article key={vendor.id} className="aq-card" style={{ padding: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 16, fontWeight: 800 }}>{vendor.name}</h3>
                      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                        {vendor.license_number || 'No ID on file'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <span className={`aq-badge ${
                        inviteStatus === 'accepted'      ? 'aq-badge-success'
                        : inviteStatus === 'invite_sent' ? 'aq-badge-info'
                        : inviteStatus === 'pending_invite' ? 'aq-badge-warning'
                        : 'aq-badge-muted'
                      }`}>
                        {inviteStatus === 'accepted'      ? 'Portal active'
                          : inviteStatus === 'invite_sent' ? 'Invite sent'
                          : inviteStatus === 'pending_invite' ? 'Invite pending'
                          : 'No portal'}
                      </span>
                      <button
                        type="button"
                        className="aq-btn aq-btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        title="Set a password for this vendor's portal account"
                        onClick={() => {
                          setPortalTarget({
                            role: 'vendor',
                            label: vendor.name,
                            vendor_id: Number(vendor.id),
                            email: email,
                          });
                        }}
                      >
                        {inviteStatus === 'accepted' ? 'Reset password' : 'Make portal'}
                      </button>
                    </div>
                  </div>
                  <dl style={metaGrid}>
                    <Meta label="Bank" value={vendorBanks[0]?.bank_name} />
                    <Meta label="IBAN" value={vendorBanks[0]?.iban} />
                    <Meta label="Account" value={vendorBanks[0]?.account_name} />
                    <Meta label="SWIFT" value={vendorBanks[0]?.swift_code} />
                  </dl>
                  {(role === 'owner' || role === 'admin') && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                      <button
                        type="button"
                        className="aq-btn aq-btn-ghost"
                        style={{ padding: '4px 10px', fontSize: 12, color: 'var(--aq-error)' }}
                        onClick={async () => {
                          try {
                            await vendorOps.remove(Number(vendor.id));
                            await refetchVendors();
                          } catch (err: any) {
                            window.alert(
                              `Could not delete vendor "${vendor.name}".\n\n${err?.message ?? String(err)}\n\nIf this says "not a member of any AQ workspace", the contract backend has not been restarted with the latest auth code. Restart uvicorn and try again.`,
                            );
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )
      )}

      {tab === 'pending' && (
        pendingOnly.length === 0 ? (
          <EmptyState
            icon="📨"
            title="No pending requests"
            body="Vendor registration requests will appear here for review."
            actionLabel="+ Add Vendor"
            canCreate={canCreate}
            onAction={() => setOpen(true)}
          />
        ) : (
          <div style={gridStyle}>
            {pendingOnly.map((request) => (
              <article key={request.id} className="aq-card" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800 }}>{request.full_name}</h3>
                <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                  {request.license_number || 'No ID'} · {request.iban || 'No IBAN'}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button className="aq-btn aq-btn-primary" disabled={!canApprove || busyId === request.id} onClick={() => act(request.id, 'approve')}>
                    Approve
                  </button>
                  <button className="aq-btn aq-btn-ghost" disabled={!canApprove || busyId === request.id} onClick={() => act(request.id, 'reject')}>
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {open && (
        <Modal title="Add Vendor" onClose={() => setOpen(false)}>
          <div style={formGrid}>
            <Field label="Vendor name" required>
              <input className="aq-input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} autoFocus />
            </Field>
            <Field label="ID / license number">
              <input className="aq-input" value={form.license_number} onChange={(e) => setForm({ ...form, license_number: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="aq-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="aq-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Category">
              <input className="aq-input" value={form.vendor_category} onChange={(e) => setForm({ ...form, vendor_category: e.target.value })} placeholder="Influencer, filming, model..." />
            </Field>
            <Field label="Platform">
              <input className="aq-input" value={form.platforms} onChange={(e) => setForm({ ...form, platforms: e.target.value })} placeholder="For influencers only" />
            </Field>
            <Field label="Bank name">
              <input className="aq-input" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} />
            </Field>
            <Field label="Account name">
              <input className="aq-input" value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} />
            </Field>
            <Field label="IBAN">
              <input className="aq-input" value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
            </Field>
            <Field label="Account number">
              <input className="aq-input" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} />
            </Field>
            <Field label="SWIFT">
              <input className="aq-input" value={form.swift_code} onChange={(e) => setForm({ ...form, swift_code: e.target.value })} />
            </Field>
          </div>
          <Actions busy={busy} disabled={!form.full_name.trim()} submitLabel="Add Vendor" onCancel={() => setOpen(false)} onSubmit={submit} />
        </Modal>
      )}

      <InviteLinkModal invite={activeInvite} onClose={() => setActiveInvite(null)} />
      <AdminCreatePortalModal
        open={portalTarget !== null}
        target={portalTarget}
        onClose={() => setPortalTarget(null)}
      />
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
      <div style={{ fontSize: 54, marginBottom: 24 }}>{icon}</div>
      <h3 style={{ fontSize: 20, fontWeight: 800 }}>{title}</h3>
      <p style={{ color: 'var(--aq-text-muted)', fontSize: 16, lineHeight: 1.5, marginTop: 14, maxWidth: 380 }}>
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
const tabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 28,
  borderBottom: '1px solid var(--aq-border-light)',
  margin: '0 -4px',
  padding: '0 4px',
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
