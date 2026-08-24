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
import {
  buildVendors, sortRows, filterRows, nextSort, summarise, summaryLine,
  emptyMessage, isFiltered, deleteWarning, deletedMessage,
  VENDOR_COLUMNS, DEFAULT_SORT, EMPTY_FILTER,
  type Filter, type RegistryRow, type Sort,
} from '@/lib/registry';
import {
  RegistryTable, RegistryToolbar, RegistryHeader, Confirm, Chip, AddButton,
  Detail, DETAIL_GRID,
} from './RegistryTable';
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

  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const rows = useMemo(
    () => buildVendors({ vendors: vendors as any, banks: banks as any, categories: categories as any }),
    [vendors, banks, categories],
  );
  // The bank fields stay searchable even though they are off the list:
  // finance look this screen up by IBAN when a payment bounces, which is the
  // one good reason the IBAN was ever printed on the card.
  const bankText = (r: RegistryRow) =>
    (banksByVendor.get(Number(r.id)) ?? []).flatMap((b) => [
      String(b.bank_name ?? ''), String(b.iban ?? ''), String(b.account_name ?? ''),
    ]);
  const shown = useMemo(
    () => sortRows(filterRows(rows, { ...filter, query }, bankText), sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, filter, query, sort, banks],
  );
  const summary = summarise(rows, shown);
  const deleting = confirmDeleteId ? rows.find((r) => r.id === confirmDeleteId) ?? null : null;

  const presentCategories = useMemo(() => {
    const seen = new Set(rows.map((r) => r.who).filter(Boolean) as string[]);
    return [...seen].sort((a, b) => a.localeCompare(b, 'en'));
  }, [rows]);

  const removeVendor = async (row: RegistryRow) => {
    setBusyId(Number(row.id)); setError(''); setMessage('');
    try {
      await vendorOps.remove(Number(row.id));
      setMessage(deletedMessage(row.name));
      setConfirmDeleteId(null);
      setExpandedId(null);
      await refetchVendors();
    } catch (e: any) {
      // A sentence, not a window.alert telling somebody to restart uvicorn.
      setError(`Could not delete ${row.name}. ${e?.message ?? String(e)}`);
    } finally {
      setBusyId(null);
    }
  };

  const openCreate = () => { setEditVendor(null); setError(''); setEditorOpen(true); };
  const openEdit = (v: LegacyVendor) => { setEditVendor(v); setError(''); setEditorOpen(true); };
  const closeEditor = () => { setEditorOpen(false); setEditVendor(null); };
  const onSaved = async () => {
    await Promise.all([refetchPending(), refetchVendors()]);
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
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <RegistryHeader title="Vendors" line={summaryLine(summary, 'vendor')}>
        {/* Ink, not accent green — green already means "portal active" two
            columns over, and a green button beside green pills makes the
            colour stop meaning anything. */}
        <AddButton
          label="Add a vendor"
          onClick={openCreate}
          disabled={!canCreate}
          title={canCreate ? undefined : 'Only owners, admins and marketing add vendors'}
        />
      </RegistryHeader>

      <div style={{ display: 'flex', gap: 6 }}>
        <Chip
          label="Vendors"
          count={rows.length}
          on={tab === 'vendors'}
          onClick={() => setTab('vendors')}
        />
        <Chip
          label="Pending requests"
          count={pendingOnly.length}
          on={tab === 'pending'}
          onClick={() => setTab('pending')}
        />
      </div>

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

      {tab === 'vendors' && (
        <>
          <RegistryToolbar
            query={query}
            onQuery={setQuery}
            placeholder="Search name, ID, licence, contact, bank or IBAN…"
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
            {/* Only categories that exist here. A filter that can only ever
                empty the table reads like a broken screen. */}
            <select
              className="aq-select"
              value={filter.category ?? ''}
              onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value || null }))}
              style={{ width: 'auto', fontSize: 12.5, padding: '5px 10px' }}
              aria-label="Category"
            >
              <option value="">Every category</option>
              {presentCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {isFiltered({ ...filter, query }) && (
              <button
                type="button"
                className="aq-btn aq-btn-ghost"
                onClick={() => { setFilter(EMPTY_FILTER); setQuery(''); }}
                style={{ fontSize: 12.5, padding: '5px 10px', color: 'var(--aq-text-secondary)' }}
              >Clear</button>
            )}
          </RegistryToolbar>

          {deleting && (
            <Confirm
              text={deleteWarning(deleting, 'vendor')}
              confirmLabel="Yes, delete"
              busy={busyId != null}
              onConfirm={() => removeVendor(deleting)}
              onCancel={() => setConfirmDeleteId(null)}
            />
          )}

          {shown.length === 0 ? (
            <div className="aq-card" style={{
              padding: 34, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13.5,
            }}>{emptyMessage({ ...filter, query }, rows.length, 'vendor')}</div>
          ) : (
            <RegistryTable
              rows={shown}
              columns={VENDOR_COLUMNS}
              showValue={false}
              sort={sort}
              onSort={(k) => setSort((cur) => nextSort(cur, k))}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              renderDetail={(r) => (
                <VendorDetail
                  row={r}
                  banks={banksByVendor.get(Number(r.id)) ?? []}
                  category={categoryById.get(String((r.raw as any).category_id ?? '')) ?? null}
                  canEdit={canEdit}
                  isAdmin={role === 'owner' || role === 'admin'}
                  onEdit={() => openEdit(r.raw as unknown as LegacyVendor)}
                  onPortal={() => setPortalTarget({
                    role: 'vendor',
                    label: r.name,
                    vendor_id: Number(r.id),
                    email: String((r.raw as any).email ?? '') || null,
                  })}
                  onDelete={() => setConfirmDeleteId(r.id)}
                />
              )}
            />
          )}
        </>
      )}

      {tab === 'pending' && (
        pendingOnly.length === 0 ? (
          <div className="aq-card" style={{
            padding: 34, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13.5,
          }}>
            No pending requests. Vendor registrations land here for review.
          </div>
        ) : (
          <div className="aq-card" style={{ overflow: 'hidden' }}>
            {pendingOnly.map((request, i) => (
              <div
                key={request.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
                }}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600 }}>
                    {request.full_name}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                    {request.license_number || 'no ID'} · {request.iban ? 'IBAN on file' : 'no IBAN'}
                  </span>
                </span>
                <button
                  className="aq-btn aq-btn-ghost"
                  disabled={!canApprove || busyId === request.id}
                  onClick={() => act(request.id, 'reject')}
                  style={{ fontSize: 12, padding: '4px 10px', color: 'var(--aq-text-secondary)' }}
                >Reject</button>
                <button
                  className="aq-btn aq-btn-primary"
                  disabled={!canApprove || busyId === request.id}
                  onClick={() => act(request.id, 'approve')}
                  style={{ fontSize: 12, padding: '4px 11px' }}
                >{busyId === request.id ? 'Working…' : 'Approve'}</button>
              </div>
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
 * What was on the card, now behind the row.
 *
 * The IBAN in particular: the old list printed bank name and IBAN on every
 * card, so sixty-one IBANs were on screen at once. They are still
 * *searchable* — finance look this screen up by IBAN when a payment
 * bounces — they are just not printed sixty-one times.
 */
function VendorDetail({
  row, banks, category, canEdit, isAdmin, onEdit, onPortal, onDelete,
}: {
  row: RegistryRow;
  banks: LegacyBankAccount[];
  category: LegacyVendorCategory | null;
  canEdit: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onPortal: () => void;
  onDelete: () => void;
}) {
  const v = row.raw as unknown as LegacyVendor;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={DETAIL_GRID}>
        <Detail label="Contact" value={v.contact_name} />
        <Detail label="Email" value={v.email} />
        <Detail label="Phone" value={v.phone} />
        <Detail label="Signatory" value={v.signatory_name} missing />
        <Detail label="VAT" value={v.vat_number} />
        <Detail label="ID number" value={v.id_number} />
        <Detail label="Licence" value={v.license_number} />
      </div>

      <div>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
          textTransform: 'uppercase', color: 'var(--aq-text-muted)', marginBottom: 5,
        }}>Bank accounts</div>
        {banks.length === 0 ? (
          <p style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600, margin: 0 }}>
            None on file — this vendor cannot be paid, and the contract goes out
            with the payment block blank.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {banks.map((b) => (
              <li key={b.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12.5,
              }}>
                <span style={{ color: 'var(--aq-text-secondary)' }}>{b.bank_name || '—'}</span>
                <span style={{
                  fontFamily: 'ui-monospace, monospace',
                  color: b.iban ? 'var(--aq-text)' : '#b91c1c',
                  fontWeight: b.iban ? 400 : 600,
                }}>{b.iban || 'no IBAN'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CategoryDetail vendor={v} category={category} />

      {v.details && (
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
            textTransform: 'uppercase', color: 'var(--aq-text-muted)', marginBottom: 4,
          }}>Notes</div>
          <p style={{
            fontSize: 12.5, color: 'var(--aq-text-secondary)', margin: 0, whiteSpace: 'pre-wrap',
          }}>{v.details}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {canEdit && (
          <button
            type="button" className="aq-btn aq-btn-secondary" onClick={onEdit}
            style={{ fontSize: 12, padding: '5px 11px' }}
          >Edit</button>
        )}
        <button
          type="button" className="aq-btn aq-btn-secondary" onClick={onPortal}
          style={{ fontSize: 12, padding: '5px 11px' }}
        >{row.portal === 'active' ? 'Reset password' : 'Make portal'}</button>
        {isAdmin && (
          <button
            type="button" className="aq-btn aq-btn-ghost" onClick={onDelete}
            style={{ fontSize: 12, padding: '5px 11px', color: '#b91c1c' }}
          >Delete vendor…</button>
        )}
      </div>
    </div>
  );
}

/**
 * CategoryDetail — small read-only block shown when a vendor row
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
