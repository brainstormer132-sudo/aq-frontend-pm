'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  approvePendingVendor,
  rejectPendingVendor,
  useLegacyVendors,
  usePendingVendors,
  useVendorCategoriesLegacy,
  type LegacyBankAccount,
  type LegacyVendor,
  type LegacyVendorCategory,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { vendorOps, type ExternalInvite } from '@/lib/contract-api';
import { InviteLinkModal } from '@/components/workflow/InviteLinkModal';
import { AdminCreatePortalModal } from '@/components/workflow/AdminCreatePortalModal';
import { VendorEditorModal } from '@/components/workflow/VendorEditorModal';

export function VendorsView({ role, userName }: { role: WorkspaceRole | null; userName: string }) {
  const { vendors, banks, refetch: refetchVendors } = useLegacyVendors();
  const { items: pending, refetch: refetchPending } = usePendingVendors();
  const { categories } = useVendorCategoriesLegacy();
  const [tab, setTab] = useState<'vendors' | 'pending'>('vendors');
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<LegacyVendor | null>(null);
  /** vendor.id of the card currently expanded inline. null = none. */
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [activeInvite, setActiveInvite] = useState<ExternalInvite | null>(null);
  const [portalTarget, setPortalTarget] = useState<{
    role: 'vendor' | 'client'; label: string; vendor_id?: number; client_id?: string; email?: string | null;
  } | null>(null);

  const canCreate = Boolean(role && ['owner','admin','marketing'].includes(role));
  const canApprove = canCreate;
  const canEdit = canCreate;
  const pendingOnly = pending.filter((p) => p.status === 'pending');

  const banksByVendor = new Map<number, LegacyBankAccount[]>();
  for (const bank of banks) {
    const arr = banksByVendor.get(bank.vendor_id);
    if (arr) arr.push(bank);
    else banksByVendor.set(bank.vendor_id, [bank]);
  }

  const categoryById = useMemo(() => {
    const m = new Map<string, LegacyVendorCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const visibleVendors = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((v) => !q || [
      v.name,
      v.license_number,
      v.id_number,
      v.signatory_name,
      v.contact_name,
      v.email,
      v.phone,
      ...(banksByVendor.get(v.id) ?? []).flatMap((b) => [b.bank_name, b.iban, b.account_name]),
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [banksByVendor, query, vendors]);

  const openCreate = () => { setEditVendor(null); setError(''); setEditorOpen(true); };
  const openEdit = (v: LegacyVendor) => { setEditVendor(v); setError(''); setEditorOpen(true); };
  const closeEditor = () => { setEditorOpen(false); setEditVendor(null); };
  const onSaved = async () => {
    await Promise.all([refetchPending(), refetchVendors()]);
  };

  const toggleExpand = (vendorId: number) => {
    setExpandedId((cur) => (cur === vendorId ? null : vendorId));
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
          <button className="aq-btn aq-btn-primary" disabled={!canCreate} onClick={openCreate}>
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
            onAction={openCreate}
          />
        ) : (
          <div style={gridStyle}>
            {visibleVendors.map((vendor) => {
              const vendorBanks = banksByVendor.get(vendor.id) ?? [];
              const v = vendor as any;
              const inviteStatus: string = v.invite_status || 'none';
              const email: string | null = v.email || null;
              const cat = vendor.category_id ? categoryById.get(vendor.category_id) ?? null : null;
              const idLabel = cat?.requires_license ? 'License' : 'ID';
              const idValue = cat?.requires_license
                ? (vendor.license_number || vendor.id_number || '—')
                : (vendor.id_number || vendor.license_number || '—');
              const isExpanded = expandedId === vendor.id;
              // Clicking the card toggles the inline summary. Buttons
              // inside the card use stopPropagation so they don't also
              // collapse the expand.
              return (
                <article
                  key={vendor.id}
                  className="aq-card"
                  style={{ padding: 18, cursor: 'pointer' }}
                  onClick={() => toggleExpand(vendor.id)}
                  aria-expanded={isExpanded}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h3 style={{ fontSize: 16, fontWeight: 800 }}>{vendor.name}</h3>
                        {cat && (
                          <span
                            className="aq-badge"
                            style={{ background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)' }}
                          >
                            {cat.label}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                        {idLabel}: {idValue}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
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
                        onClick={(e) => {
                          e.stopPropagation();
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
                    <Meta label="Contact" value={vendor.contact_name || '—'} />
                    <Meta label="Phone" value={vendor.phone || '—'} />
                    <Meta label="Bank" value={vendorBanks[0]?.bank_name} />
                    <Meta label="IBAN" value={vendorBanks[0]?.iban} />
                    {vendor.vat_number ? <Meta label="VAT" value={vendor.vat_number} /> : null}
                    {vendor.signatory_name ? <Meta label="Signatory" value={vendor.signatory_name} /> : null}
                  </dl>

                  {/*
                   * Expanded block: extra details only shown when the
                   * card is clicked. Includes every bank (not just the
                   * primary), per-category specifics, and notes.
                   */}
                  {isExpanded && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginTop: 14,
                        paddingTop: 12,
                        borderTop: '1px solid var(--aq-border-light)',
                        display: 'flex', flexDirection: 'column', gap: 10,
                      }}
                    >
                      {vendorBanks.length > 1 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                            All bank accounts
                          </div>
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {vendorBanks.map((b) => (
                              <li key={b.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ color: 'var(--aq-text-secondary)' }}>{b.bank_name || '—'}</span>
                                <span style={{ fontFamily: 'monospace' }}>{b.iban || '—'}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <CategoryDetail vendor={vendor} category={cat} />
                      {vendor.details && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                            Notes
                          </div>
                          <p style={{ fontSize: 12, color: 'var(--aq-text-secondary)', margin: 0, whiteSpace: 'pre-wrap' }}>{vendor.details}</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canEdit && (
                      <button
                        type="button"
                        className="aq-btn aq-btn-secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => openEdit(vendor)}
                      >
                        Edit
                      </button>
                    )}
                    {(role === 'owner' || role === 'admin') && (
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
                    )}
                  </div>
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
            onAction={openCreate}
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

      <VendorEditorModal
        open={editorOpen}
        vendor={editVendor}
        banks={editVendor ? (banksByVendor.get(editVendor.id) ?? []) : []}
        categories={categories}
        canEdit={canEdit}
        onClose={closeEditor}
        onSaved={onSaved}
      />

      <InviteLinkModal invite={activeInvite} onClose={() => setActiveInvite(null)} />
      <AdminCreatePortalModal
        open={portalTarget !== null}
        target={portalTarget}
        onClose={() => setPortalTarget(null)}
      />
    </div>
  );
}

/**
 * CategoryDetail — small read-only block shown when a vendor card
 * is expanded. Surfaces the per-category fields that are set, so a
 * user can confirm them without entering the editor.
 */
function CategoryDetail({ vendor, category }: { vendor: LegacyVendor; category: LegacyVendorCategory | null }) {
  if (!category) return null;
  const rows: Array<[string, string | number | null | undefined]> = [];
  const key = category.key;
  if (key === 'influencer' || key === 'ugc') {
    rows.push(['Platforms', vendor.platforms]);
  } else if (key === 'logistics') {
    rows.push(['Location link', vendor.location_link]);
    rows.push(['Short address', vendor.short_address]);
  } else if (key === 'model') {
    rows.push(['Age', vendor.age]);
    rows.push(['Gender', vendor.gender]);
  } else if (key === 'rentals') {
    rows.push(['Rental type', vendor.rental_type]);
  } else if (key === 'events') {
    rows.push(['Opening', vendor.event_opening]);
    rows.push(['Ceremony', vendor.event_ceremony]);
  } else if (key === 'location') {
    rows.push(['Location type', vendor.location_type]);
    rows.push(['Location link', vendor.location_link]);
  }
  const visible = rows.filter(([, v]) => v != null && String(v).trim() !== '');
  if (visible.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {category.label} details
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 12px', fontSize: 12, margin: 0 }}>
        {visible.map(([label, value]) => (
          <Fragment key={label}>
            <dt style={{ color: 'var(--aq-text-muted)' }}>{label}</dt>
            <dd style={{ margin: 0 }}>{String(value)}</dd>
          </Fragment>
        ))}
      </dl>
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
