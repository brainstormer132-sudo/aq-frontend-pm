'use client';

import { useMemo, useRef, useState } from 'react';
import {
  approvePendingVendor,
  createApprovedVendorRegistration,
  rejectPendingVendor,
  updateVendorRegistration,
  useLegacyVendors,
  usePendingVendors,
  useVendorCategoriesLegacy,
  useVendorFiles,
  uploadVendorFile,
  deleteVendorFile,
  getVendorFileDownloadUrl,
  VENDOR_FILE_MAX_BYTES,
  type LegacyVendor,
  type LegacyVendorCategory,
  type VendorFileRow,
  type VendorRegistrationInput,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { vendorOps, type ExternalInvite } from '@/lib/contract-api';
import { InviteLinkModal } from '@/components/workflow/InviteLinkModal';
import { AdminCreatePortalModal } from '@/components/workflow/AdminCreatePortalModal';

// ────────────────────────────────────────────────────────────────────
// Form state — matches the union of base + per-category fields the
// vendor form can collect. Per-category keys stay in state even when
// hidden so users don't lose values if they switch categories back.
// ────────────────────────────────────────────────────────────────────
type VendorForm = {
  full_name: string;
  category_id: string;     // '' = no category yet
  id_number: string;
  license_number: string;
  signatory_name: string;
  contact_name: string;
  email: string;
  phone: string;
  vat_number: string;
  details: string;
  // Legacy free-text — still surfaced for the platforms field.
  platforms: string;
  // Bank
  bank_name: string;
  account_name: string;
  iban: string;
  account_number: string;
  swift_code: string;
  // Per-category
  location_link: string;
  short_address: string;
  age: string;             // kept as string for the input; parsed to int on save
  gender: string;
  rental_type: string;
  event_opening: string;
  event_ceremony: string;
  location_type: string;
};

const EMPTY_FORM: VendorForm = {
  full_name: '',
  category_id: '',
  id_number: '',
  license_number: '',
  signatory_name: '',
  contact_name: '',
  email: '',
  phone: '',
  vat_number: '',
  details: '',
  platforms: '',
  bank_name: '',
  account_name: '',
  iban: '',
  account_number: '',
  swift_code: '',
  location_link: '',
  short_address: '',
  age: '',
  gender: '',
  rental_type: '',
  event_opening: '',
  event_ceremony: '',
  location_type: '',
};

function formToPayload(form: VendorForm): VendorRegistrationInput {
  const ageNum = form.age.trim() ? parseInt(form.age, 10) : null;
  return {
    full_name:      form.full_name.trim(),
    category_id:    form.category_id || null,
    id_number:      form.id_number.trim(),
    license_number: form.license_number.trim(),
    signatory_name: form.signatory_name.trim(),
    contact_name:   form.contact_name.trim(),
    email:          form.email.trim(),
    phone:          form.phone.trim(),
    vat_number:     form.vat_number.trim(),
    details:        form.details.trim(),
    platforms:      form.platforms.trim(),
    bank_name:      form.bank_name.trim(),
    account_name:   form.account_name.trim(),
    iban:           form.iban.trim(),
    account_number: form.account_number.trim(),
    swift_code:     form.swift_code.trim(),
    location_link:  form.location_link.trim(),
    short_address:  form.short_address.trim(),
    age:            Number.isFinite(ageNum as number) ? (ageNum as number) : null,
    gender:         form.gender.trim(),
    rental_type:    form.rental_type.trim(),
    event_opening:  form.event_opening.trim(),
    event_ceremony: form.event_ceremony.trim(),
    location_type:  form.location_type.trim(),
  };
}

function vendorToForm(v: LegacyVendor, bank?: { bank_name: string; account_name: string; iban: string; account_number: string; swift_code: string } | null): VendorForm {
  return {
    full_name:      v.name ?? '',
    category_id:    v.category_id ?? '',
    id_number:      v.id_number ?? '',
    license_number: v.license_number ?? '',
    signatory_name: v.signatory_name ?? '',
    contact_name:   v.contact_name ?? '',
    email:          v.email ?? '',
    phone:          v.phone ?? '',
    vat_number:     v.vat_number ?? '',
    details:        v.details ?? '',
    platforms:      v.platforms ?? '',
    bank_name:      bank?.bank_name      ?? '',
    account_name:   bank?.account_name   ?? '',
    iban:           bank?.iban           ?? '',
    account_number: bank?.account_number ?? '',
    swift_code:     bank?.swift_code     ?? '',
    location_link:  v.location_link  ?? '',
    short_address:  v.short_address  ?? '',
    age:            v.age == null ? '' : String(v.age),
    gender:         v.gender ?? '',
    rental_type:    v.rental_type ?? '',
    event_opening:  v.event_opening ?? '',
    event_ceremony: v.event_ceremony ?? '',
    location_type:  v.location_type ?? '',
  };
}

export function VendorsView({ role, userName }: { role: WorkspaceRole | null; userName: string }) {
  const { vendors, banks, refetch: refetchVendors } = useLegacyVendors();
  const { items: pending, refetch: refetchPending } = usePendingVendors();
  const { categories } = useVendorCategoriesLegacy();
  const [tab, setTab] = useState<'vendors' | 'pending'>('vendors');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [editVendor, setEditVendor] = useState<LegacyVendor | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [activeInvite, setActiveInvite] = useState<ExternalInvite | null>(null);
  const [portalTarget, setPortalTarget] = useState<{
    role: 'vendor' | 'client'; label: string; vendor_id?: number; client_id?: string; email?: string | null;
  } | null>(null);
  const [form, setForm] = useState<VendorForm>(EMPTY_FORM);

  const canCreate = Boolean(role && ['owner','admin','marketing'].includes(role));
  const canApprove = canCreate;
  const canEdit = canCreate;
  const pendingOnly = pending.filter((p) => p.status === 'pending');

  const banksByVendor = new Map<number, typeof banks>();
  for (const bank of banks) {
    if (!banksByVendor.has(bank.vendor_id)) banksByVendor.set(bank.vendor_id, [] as any);
    (banksByVendor.get(bank.vendor_id) as any).push(bank);
  }

  // Lookup helpers
  const categoryById = useMemo(() => {
    const m = new Map<string, LegacyVendorCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);
  const selectedCategory = form.category_id ? categoryById.get(form.category_id) ?? null : null;

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

  const openCreate = () => { setForm(EMPTY_FORM); setEditVendor(null); setError(''); setOpen(true); };
  const openEdit = (v: LegacyVendor) => {
    const primaryBank = (banksByVendor.get(v.id) ?? [])[0] ?? null;
    setForm(vendorToForm(v, primaryBank as any));
    setEditVendor(v);
    setError('');
    setOpen(true);
  };

  const submit = async () => {
    if (!form.full_name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const payload = formToPayload(form);
      if (editVendor) {
        await updateVendorRegistration(editVendor.id, payload);
      } else {
        await createApprovedVendorRegistration(payload);
      }
      setForm(EMPTY_FORM);
      setOpen(false);
      setEditVendor(null);
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
              return (
                <article key={vendor.id} className="aq-card" style={{ padding: 18 }}>
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
                    <Meta label="Contact" value={vendor.contact_name || '—'} />
                    <Meta label="Phone" value={vendor.phone || '—'} />
                    <Meta label="Bank" value={vendorBanks[0]?.bank_name} />
                    <Meta label="IBAN" value={vendorBanks[0]?.iban} />
                    {vendor.vat_number ? <Meta label="VAT" value={vendor.vat_number} /> : null}
                    {vendor.signatory_name ? <Meta label="Signatory" value={vendor.signatory_name} /> : null}
                  </dl>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
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

      {open && (
        <Modal
          title={editVendor ? `Edit ${editVendor.name}` : 'Add Vendor'}
          onClose={() => { setOpen(false); setEditVendor(null); }}
        >
          <VendorFormFields
            form={form}
            setForm={setForm}
            categories={categories}
            selectedCategory={selectedCategory}
          />
          {/*
            File uploads only show on Edit (we need a saved vendor_id
            to attach files to). For a brand-new vendor: save the
            basics first, then re-open the edit modal to add files.
          */}
          {editVendor && (
            <VendorFilesSection vendorId={editVendor.id} canEdit={canEdit} />
          )}
          <Actions
            busy={busy}
            disabled={!form.full_name.trim()}
            submitLabel={editVendor ? 'Save Changes' : 'Add Vendor'}
            onCancel={() => { setOpen(false); setEditVendor(null); }}
            onSubmit={submit}
          />
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

// ────────────────────────────────────────────────────────────────────
// VendorFormFields — category picker + base + per-category conditional
// fields. Lives inside the same Modal we already had.
//
// Field visibility logic by category key:
//
//   influencer / ugc     → license_number (otherwise id_number)
//   logistics            → + location_link, short_address
//   model                → + age, gender
//   rentals              → + rental_type
//   events               → + event_opening, event_ceremony
//   location             → + location_type, location_link
//
//   All other categories show only the base fields.
// ────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────
// VendorFilesSection — list, upload, download, delete vendor files.
//
// Files live in the Supabase Storage bucket `vendor-files`; metadata is
// in public.vendor_files (migration 030). One simple list, any file
// type, 25 MB cap per upload. Downloads use short-lived signed URLs.
//
// Renders only when editVendor is set (we need a saved vendor_id to
// attach things to).
// ────────────────────────────────────────────────────────────────────
function VendorFilesSection({ vendorId, canEdit }: { vendorId: number; canEdit: boolean }) {
  const { files, loading, refetch } = useVendorFiles(vendorId);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickFiles = () => fileInputRef.current?.click();

  const onFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    // Reset the input so picking the same filename again still triggers
    // a change event.
    e.target.value = '';

    setUploading(true);
    setError('');
    try {
      // Upload sequentially so a 25 MB cap rejection doesn't kill the
      // whole batch silently — we surface the first failure.
      for (const f of picked) {
        await uploadVendorFile(vendorId, f);
      }
      await refetch();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setUploading(false);
    }
  };

  const onDownload = async (file: VendorFileRow) => {
    setBusyId(file.id);
    setError('');
    try {
      const url = await getVendorFileDownloadUrl(file);
      // Use a hidden anchor with `download` so the filename is preserved
      // in the saved file (mirrors how Content-Disposition is wired on
      // the contract endpoints).
      const a = document.createElement('a');
      a.href = url;
      a.download = file.file_name;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (file: VendorFileRow) => {
    if (!window.confirm(`Delete "${file.file_name}"? This cannot be undone.`)) return;
    setBusyId(file.id);
    setError('');
    try {
      await deleteVendorFile(file);
      await refetch();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{
      gridColumn: '1 / -1',
      marginTop: 8, padding: 16,
      border: '1px solid var(--aq-border-light)',
      borderRadius: 'var(--aq-radius)',
      background: 'var(--aq-bg-sunken)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Files</div>
          <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 2 }}>
            IDs, licenses, bank confirmations, anything else. Max 25 MB per file.
          </div>
        </div>
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={onFilesChosen}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={onPickFiles}
              disabled={uploading}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              {uploading ? 'Uploading...' : '+ Upload'}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="aq-badge aq-badge-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>Loading files...</div>
        ) : files.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
            No files yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, margin: 0, padding: 0 }}>
            {files.map((f) => (
              <li key={f.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px',
                background: 'var(--aq-bg-elevated)',
                border: '1px solid var(--aq-border-light)',
                borderRadius: 'var(--aq-radius)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                    {formatBytes(f.file_size)} · {new Date(f.uploaded_at).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="aq-btn aq-btn-ghost"
                  onClick={() => onDownload(f)}
                  disabled={busyId === f.id}
                  style={{ padding: '4px 10px', fontSize: 12 }}
                >
                  {busyId === f.id ? 'Working...' : 'Download'}
                </button>
                {canEdit && (
                  <button
                    type="button"
                    className="aq-btn aq-btn-ghost"
                    onClick={() => onDelete(f)}
                    disabled={busyId === f.id}
                    style={{ padding: '4px 10px', fontSize: 12, color: 'var(--aq-error)' }}
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function VendorFormFields({
  form,
  setForm,
  categories,
  selectedCategory,
}: {
  form: VendorForm;
  setForm: (updater: (f: VendorForm) => VendorForm) => void;
  categories: LegacyVendorCategory[];
  selectedCategory: LegacyVendorCategory | null;
}) {
  const set = <K extends keyof VendorForm>(key: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const key = selectedCategory?.key ?? null;
  const showLicense = !!selectedCategory?.requires_license;

  // Per-category visibility
  const showLogistics = key === 'logistics';
  const showModel     = key === 'model';
  const showRentals   = key === 'rentals';
  const showEvents    = key === 'events';
  const showLocation  = key === 'location';

  return (
    <div style={formGrid}>
      {/* CATEGORY — pick this first so the rest of the form can react. */}
      <Field label="Category" required>
        <select
          className="aq-input"
          value={form.category_id}
          onChange={set('category_id')}
        >
          <option value="">Select a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Vendor name" required>
        <input className="aq-input" value={form.full_name} onChange={set('full_name')} autoFocus />
      </Field>

      {/* ID vs LICENSE — driven by category.requires_license. */}
      {showLicense ? (
        <Field label="License number">
          <input className="aq-input" value={form.license_number} onChange={set('license_number')} />
        </Field>
      ) : (
        <Field label="ID number">
          <input className="aq-input" value={form.id_number} onChange={set('id_number')} />
        </Field>
      )}
      <Field label="Signatory name">
        <input className="aq-input" value={form.signatory_name} onChange={set('signatory_name')} placeholder="Whose name signs the contract" />
      </Field>

      {/* CONTACT */}
      <Field label="Contact name">
        <input className="aq-input" value={form.contact_name} onChange={set('contact_name')} />
      </Field>
      <Field label="Contact phone">
        <input className="aq-input" value={form.phone} onChange={set('phone')} />
      </Field>
      <Field label="Contact email">
        <input className="aq-input" type="email" value={form.email} onChange={set('email')} />
      </Field>
      <Field label="VAT number (optional)">
        <input className="aq-input" value={form.vat_number} onChange={set('vat_number')} placeholder="Tax registration #" />
      </Field>

      {/* BANK */}
      <Field label="Bank name">
        <input className="aq-input" value={form.bank_name} onChange={set('bank_name')} />
      </Field>
      <Field label="Account name">
        <input className="aq-input" value={form.account_name} onChange={set('account_name')} />
      </Field>
      <Field label="IBAN">
        <input className="aq-input" value={form.iban} onChange={set('iban')} />
      </Field>
      <Field label="Account number">
        <input className="aq-input" value={form.account_number} onChange={set('account_number')} />
      </Field>
      <Field label="SWIFT">
        <input className="aq-input" value={form.swift_code} onChange={set('swift_code')} />
      </Field>

      {/* PLATFORMS — only really relevant for influencer/ugc, but harmless elsewhere. */}
      {(key === 'influencer' || key === 'ugc') && (
        <Field label="Platforms">
          <input className="aq-input" value={form.platforms} onChange={set('platforms')} placeholder="e.g. Instagram, TikTok" />
        </Field>
      )}

      {/* ───── PER-CATEGORY OPTIONAL FIELDS ───── */}
      {showLogistics && (
        <>
          <Field label="Location link (optional)">
            <input className="aq-input" value={form.location_link} onChange={set('location_link')} placeholder="Google Maps URL" />
          </Field>
          <Field label="Short address (optional)">
            <input className="aq-input" value={form.short_address} onChange={set('short_address')} />
          </Field>
        </>
      )}
      {showModel && (
        <>
          <Field label="Age (optional)">
            <input className="aq-input" type="number" min={0} value={form.age} onChange={set('age')} />
          </Field>
          <Field label="Gender (optional)">
            <select className="aq-input" value={form.gender} onChange={set('gender')}>
              <option value="">—</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </Field>
        </>
      )}
      {showRentals && (
        <Field label="Rental type (optional)">
          <input className="aq-input" value={form.rental_type} onChange={set('rental_type')} placeholder="e.g. Camera, lighting, props" />
        </Field>
      )}
      {showEvents && (
        <>
          <Field label="Opening (optional)">
            <input className="aq-input" value={form.event_opening} onChange={set('event_opening')} />
          </Field>
          <Field label="Ceremony (optional)">
            <input className="aq-input" value={form.event_ceremony} onChange={set('event_ceremony')} />
          </Field>
        </>
      )}
      {showLocation && (
        <>
          <Field label="Location type (optional)">
            <input className="aq-input" value={form.location_type} onChange={set('location_type')} placeholder="e.g. Studio, outdoor" />
          </Field>
          <Field label="Location link (optional)">
            <input className="aq-input" value={form.location_link} onChange={set('location_link')} placeholder="Google Maps URL" />
          </Field>
        </>
      )}

      {/* DETAILS — full width by spanning the grid. */}
      <label style={{ gridColumn: '1 / -1' }}>
        <div className="aq-label">Details (optional)</div>
        <textarea
          className="aq-input"
          value={form.details}
          onChange={set('details')}
          rows={3}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Any relevant notes about this vendor"
        />
      </label>
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
