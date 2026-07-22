'use client';

import { useMemo, useState } from 'react';
import {
  useTrackingRows,
  createTrackingRow,
  updateTrackingRow,
  deleteTrackingRow,
  withVat,
  AD_STATUSES,
  type AdStatus,
  type TrackingRow,
  type TrackingRowInput,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { exportTrackingXlsx } from '@/lib/tracking-export';

/**
 * Tracking sheet for a single campaign (parent pm_task with has_tracking = true).
 *
 * Modelled on the client's Excel: one row per ad / vendor deliverable. Rows are
 * added and edited through a popup (TrackingRowModal). The sheet is opened from
 * the task's "Tracking sheet" button — it is NOT a top-level sidebar view.
 *
 * Columns:
 *   - Always: Influencer, Platform, Type of ad, Content, Product,
 *     Shooting date, Posting date, Ad status, Ad link, Price (excl + incl VAT)
 *   - Situational (Store Visit): Guest, Location, Time, Event → license-plate photo
 *   - Situational (Home Ad): Location, Contact number
 */
export function TrackingSheetPanel({
  taskId, taskTitle, brandName, role, onClose,
}: {
  taskId: string;
  taskTitle: string;
  brandName?: string | null;
  role: WorkspaceRole | null;
  onClose: () => void;
}) {
  const { rows, loading, refetch } = useTrackingRows(taskId);
  const [editing, setEditing] = useState<TrackingRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'All' | AdStatus>('All');
  const [exporting, setExporting] = useState(false);

  const canEdit = role !== 'member';

  const filtered = useMemo(
    () => statusFilter === 'All' ? rows : rows.filter((r) => r.ad_status === statusFilter),
    [rows, statusFilter],
  );

  const totals = useMemo(() => {
    const excl = filtered.reduce((s, r) => s + Number(r.price_excl || 0), 0);
    const incl = filtered.reduce((s, r) => s + Number(r.price_incl || 0), 0);
    return { excl, incl };
  }, [filtered]);

  const doExport = async () => {
    if (!filtered.length) return;
    setExporting(true);
    try {
      await exportTrackingXlsx(taskTitle, filtered);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert((e as any)?.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const closeModal = () => { setEditing(null); setCreating(false); };
  const afterSave = async () => { await refetch(); closeModal(); };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 190,
        background: 'rgba(15, 29, 34, 0.55)',
        display: 'flex', justifyContent: 'flex-end',
      }}
      onClick={onClose}
      role="dialog" aria-modal="true"
    >
      <aside
        className="animate-slide-in"
        style={{
          width: '100%', maxWidth: 1180,
          background: 'var(--aq-bg-elevated)',
          overflow: 'auto',
          boxShadow: 'var(--aq-shadow-lg)',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--aq-border-light)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16, position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--aq-bg-elevated)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="aq-badge aq-badge-info">Tracking sheet</span>
              <span className="aq-badge aq-badge-muted">
                {statusFilter === 'All'
                  ? `${rows.length} row${rows.length === 1 ? '' : 's'}`
                  : `${filtered.length} of ${rows.length}`}
              </span>
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.25 }}>{taskTitle}</h2>
            {brandName && (
              <p style={{ marginTop: 4, fontSize: 13, color: 'var(--aq-text-muted)' }}>{brandName}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              className="aq-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'All' | AdStatus)}
              style={{ width: 'auto' }}
              aria-label="Filter by status"
            >
              <option value="All">All statuses</option>
              {AD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              className="aq-btn aq-btn-secondary"
              onClick={doExport}
              disabled={exporting || rows.length === 0}
            >
              {exporting ? 'Exporting…' : 'Export Excel'}
            </button>
            {canEdit && (
              <button className="aq-btn aq-btn-primary" onClick={() => setCreating(true)}>
                + Add vendor
              </button>
            )}
            <button className="aq-btn aq-btn-ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loading ? (
            <div style={{ color: 'var(--aq-text-muted)' }}>Loading tracking sheet…</div>
          ) : rows.length === 0 ? (
            <div style={{
              border: '1px dashed var(--aq-border-light)',
              borderRadius: 'var(--aq-radius)',
              padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)',
            }}>
              No vendors tracked yet.{canEdit && ' Click “+ Add vendor” to add the first row.'}
            </div>
          ) : (
            <div className="aq-card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="aq-table" style={{ minWidth: 1080, width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Influencer</Th>
                    <Th>Platform</Th>
                    <Th>Type of ad</Th>
                    <Th>Product</Th>
                    <Th>Shooting</Th>
                    <Th>Posting</Th>
                    <Th>Status</Th>
                    <Th align="right">Price (excl.)</Th>
                    <Th align="right">Price (incl. VAT)</Th>
                    <Th>Ad link</Th>
                    {canEdit && <Th align="right"></Th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <Td muted>{/* spacer */}</Td>
                      <td colSpan={canEdit ? 11 : 10} style={{ padding: '16px 12px', fontSize: 13, color: 'var(--aq-text-muted)' }}>
                        No rows match “{statusFilter}”.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r, i) => (
                    <tr
                      key={r.id}
                      onClick={() => canEdit && setEditing(r)}
                      style={{
                        cursor: canEdit ? 'pointer' : 'default',
                        borderTop: '1px solid var(--aq-border-light)',
                      }}
                    >
                      <Td muted>{i + 1}</Td>
                      <Td>
                        <span style={{ fontWeight: 600 }}>{r.influencer_name || '—'}</span>
                        {r.is_event && (
                          <span className="aq-badge aq-badge-warning" style={{ marginLeft: 6 }}>event</span>
                        )}
                      </Td>
                      <Td>{r.platform || '—'}</Td>
                      <Td>{r.type_of_ad || '—'}</Td>
                      <Td>{r.product || '—'}</Td>
                      <Td muted>{r.shooting_date || '—'}</Td>
                      <Td muted>{r.posting_date || '—'}</Td>
                      <Td><StatusChip status={r.ad_status} /></Td>
                      <Td align="right">{fmtMoney(r.price_excl)}</Td>
                      <Td align="right">{fmtMoney(r.price_incl)}</Td>
                      <Td>
                        {r.ad_link
                          ? <a href={r.ad_link} target="_blank" rel="noopener noreferrer"
                               onClick={(e) => e.stopPropagation()}
                               style={{ color: 'var(--aq-accent)' }}>link</a>
                          : '—'}
                      </Td>
                      {canEdit && (
                        <Td align="right">
                          <button
                            className="aq-btn aq-btn-ghost"
                            style={{ padding: '2px 8px' }}
                            onClick={(e) => { e.stopPropagation(); setEditing(r); }}
                          >Edit</button>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--aq-border-light)', fontWeight: 700 }}>
                    <Td muted></Td>
                    <Td>Total</Td>
                    <Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td>
                    <Td align="right">{fmtMoney(totals.excl)}</Td>
                    <Td align="right">{fmtMoney(totals.incl)}</Td>
                    <Td></Td>
                    {canEdit && <Td></Td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </aside>

      {(editing || creating) && (
        <TrackingRowModal
          taskId={taskId}
          row={editing}
          onClose={closeModal}
          onSaved={afterSave}
        />
      )}
    </div>
  );
}

// ============================================================
// Row popup editor
// ============================================================

function TrackingRowModal({
  taskId, row, onClose, onSaved,
}: {
  taskId: string;
  row: TrackingRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !row;
  const [f, setF] = useState<TrackingRowInput>(() => ({
    influencer_name: row?.influencer_name ?? '',
    profile_link: row?.profile_link ?? '',
    platform: row?.platform ?? '',
    type_of_ad: row?.type_of_ad ?? '',
    content: row?.content ?? '',
    product: row?.product ?? '',
    shooting_date: row?.shooting_date ?? null,
    posting_date: row?.posting_date ?? null,
    ad_status: row?.ad_status ?? 'Not started',
    ad_link: row?.ad_link ?? '',
    price_excl: row?.price_excl ?? 0,
    is_event: row?.is_event ?? false,
    guest: row?.guest ?? '',
    location: row?.location ?? '',
    visit_time: row?.visit_time ?? '',
    license_plate_url: row?.license_plate_url ?? '',
    contact_number: row?.contact_number ?? '',
    notes: row?.notes ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof TrackingRowInput>(k: K, v: TrackingRowInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const priceExcl = Number(f.price_excl ?? 0);
  const priceIncl = withVat(priceExcl);

  // Situational panels keyed off the ad type text (case-insensitive contains).
  const adType = (f.type_of_ad ?? '').toLowerCase();
  const isStoreVisit = adType.includes('store') || adType.includes('visit');
  const isHomeAd = adType.includes('home');

  const save = async () => {
    if (!(f.influencer_name ?? '').trim()) { setError('Influencer / vendor name is required.'); return; }
    if (f.is_event && !(f.license_plate_url ?? '').trim()) {
      setError('This is flagged as an event — a license-plate photo link is required.');
      return;
    }
    setBusy(true); setError('');
    try {
      if (isNew) await createTrackingRow(taskId, f);
      else await updateTrackingRow(row!.id, f);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!row) return;
    if (!confirm('Remove this vendor row from the tracking sheet?')) return;
    setBusy(true); setError('');
    try {
      await deleteTrackingRow(row.id);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 210,
        background: 'rgba(15, 29, 34, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
      onClick={onClose}
      role="dialog" aria-modal="true"
    >
      <div
        className="aq-card animate-scale-in"
        style={{ width: '100%', maxWidth: 720, padding: 24, maxHeight: '92vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>{isNew ? 'Add vendor' : 'Edit vendor'}</h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
            One row per ad / deliverable. Situational fields appear based on the ad type.
          </p>
        </header>

        {error && (
          <div style={{
            background: 'var(--aq-error)', color: '#fff',
            padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 13, marginBottom: 14,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Vendor */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Influencer / vendor name *">
              <input className="aq-input" value={f.influencer_name ?? ''}
                     onChange={(e) => set('influencer_name', e.target.value)} placeholder="Name" />
            </Field>
            <Field label="Profile link">
              <input className="aq-input" value={f.profile_link ?? ''}
                     onChange={(e) => set('profile_link', e.target.value)} placeholder="https://…" />
            </Field>
          </div>

          {/* Always-needed ad fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Platform">
              <input className="aq-input" value={f.platform ?? ''}
                     onChange={(e) => set('platform', e.target.value)} placeholder="Instagram, TikTok…" />
            </Field>
            <Field label="Type of ad">
              <input className="aq-input" value={f.type_of_ad ?? ''}
                     onChange={(e) => set('type_of_ad', e.target.value)}
                     placeholder="Store Visit, Home Ad, Reel…" />
            </Field>
          </div>

          <Field label="Content">
            <input className="aq-input" value={f.content ?? ''}
                   onChange={(e) => set('content', e.target.value)} placeholder="Content description" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Product">
              <input className="aq-input" value={f.product ?? ''}
                     onChange={(e) => set('product', e.target.value)} placeholder="Product" />
            </Field>
            <Field label="Shooting date">
              <input className="aq-input" type="date" value={f.shooting_date ?? ''}
                     onChange={(e) => set('shooting_date', e.target.value || null)} />
            </Field>
            <Field label="Posting date">
              <input className="aq-input" type="date" value={f.posting_date ?? ''}
                     onChange={(e) => set('posting_date', e.target.value || null)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Ad status">
              <select className="aq-select" value={f.ad_status ?? 'Not started'}
                      onChange={(e) => set('ad_status', e.target.value as AdStatus)}>
                {AD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Ad link">
              <input className="aq-input" value={f.ad_link ?? ''}
                     onChange={(e) => set('ad_link', e.target.value)} placeholder="Link to the posted ad" />
            </Field>
          </div>

          {/* Pricing — two columns, incl is derived */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Price excl. VAT (SAR)">
              <input className="aq-input" inputMode="decimal" value={String(f.price_excl ?? 0)}
                     onChange={(e) => set('price_excl', e.target.value === '' ? 0 : Number(e.target.value))}
                     placeholder="0.00" />
            </Field>
            <Field label="Price incl. 15% VAT (SAR)">
              <input className="aq-input" value={fmtMoney(priceIncl)} readOnly
                     style={{ background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-muted)' }} />
            </Field>
          </div>

          {/* Event flag — gates the license-plate photo */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={Boolean(f.is_event)}
                   onChange={(e) => set('is_event', e.target.checked)}
                   style={{ width: 16, height: 16 }} />
            <span>This is an event (requires a license-plate photo)</span>
          </label>

          {/* Situational — Store Visit */}
          {(isStoreVisit || f.is_event) && (
            <SituationalGroup title="Store visit details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Guest">
                  <input className="aq-input" value={f.guest ?? ''}
                         onChange={(e) => set('guest', e.target.value)} placeholder="Guest (if any)" />
                </Field>
                <Field label="Time">
                  <input className="aq-input" value={f.visit_time ?? ''}
                         onChange={(e) => set('visit_time', e.target.value)} placeholder="e.g. 6:00 PM" />
                </Field>
              </div>
              <Field label="Location">
                <input className="aq-input" value={f.location ?? ''}
                       onChange={(e) => set('location', e.target.value)} placeholder="Location" />
              </Field>
              {f.is_event && (
                <Field label="License-plate photo link *">
                  <input className="aq-input" value={f.license_plate_url ?? ''}
                         onChange={(e) => set('license_plate_url', e.target.value)}
                         placeholder="Link to the license-plate photo" />
                </Field>
              )}
            </SituationalGroup>
          )}

          {/* Situational — Home Ad */}
          {isHomeAd && (
            <SituationalGroup title="Home ad details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Location">
                  <input className="aq-input" value={f.location ?? ''}
                         onChange={(e) => set('location', e.target.value)} placeholder="Location" />
                </Field>
                <Field label="Contact number">
                  <input className="aq-input" value={f.contact_number ?? ''}
                         onChange={(e) => set('contact_number', e.target.value)} placeholder="Contact number" />
                </Field>
              </div>
            </SituationalGroup>
          )}

          <Field label="Notes">
            <textarea className="aq-input" rows={2} value={f.notes ?? ''}
                      onChange={(e) => set('notes', e.target.value)} placeholder="Anything else" />
          </Field>
        </div>

        <footer style={{
          marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <div>
            {!isNew && (
              <button className="aq-btn aq-btn-danger" disabled={busy} onClick={remove}>Delete row</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="aq-btn aq-btn-ghost" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="aq-btn aq-btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : isNew ? 'Add vendor' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ============================================================
// Small presentational helpers
// ============================================================

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="aq-label">{label}</div>
      {children}
    </div>
  );
}

function SituationalGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: '1px solid var(--aq-border-light)',
      borderRadius: 'var(--aq-radius)',
      padding: 14,
      display: 'flex', flexDirection: 'column', gap: 12,
      background: 'var(--aq-bg-sunken)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                    color: 'var(--aq-text-muted)' }}>{title}</div>
      {children}
    </div>
  );
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align, padding: '10px 12px', fontSize: 12, fontWeight: 700,
      color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: 0.3,
      whiteSpace: 'nowrap',
    }}>{children}</th>
  );
}

function Td({ children, align = 'left', muted = false }: {
  children?: React.ReactNode; align?: 'left' | 'right'; muted?: boolean;
}) {
  return (
    <td style={{
      textAlign: align, padding: '10px 12px', fontSize: 13,
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)', whiteSpace: 'nowrap',
    }}>{children}</td>
  );
}

function StatusChip({ status }: { status: AdStatus }) {
  const cls =
    status === 'Posted' ? 'aq-badge-success'
    : status === 'Cancelled' ? 'aq-badge-error'
    : status === 'Shot' ? 'aq-badge-info'
    : status === 'Scheduled' ? 'aq-badge-warning'
    : 'aq-badge-muted';
  return <span className={`aq-badge ${cls}`}>{status}</span>;
}

function fmtMoney(v: number | null | undefined): string {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
