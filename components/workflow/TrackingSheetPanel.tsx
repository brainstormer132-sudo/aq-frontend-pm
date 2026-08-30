'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  useTrackingRows,
  usePublishedTrackingRows,
  useCampaignBookings,
  addTrackingRowsFromBookings,
  createTrackingRow,
  updateTrackingRow,
  deleteTrackingRow,
  publishTrackingSheet,
  unpublishTrackingSheet,
  AD_STATUSES,
  type AdStatus,
  type TrackingRow,
  type TrackingRowInput,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { exportTrackingXlsx } from '@/lib/tracking-export';
import { Chip, Confirm, AddButton, INK } from './RegistryTable';
import {
  expandBookings, planSync, plannedRows, adoptionPatch, syncSentence, syncLabel,
  syncWarning, syncTotal, rowOrigin, liveAdLineIds,
} from '@/lib/tracking-sync';
import {
  buildSheet, filterSheet, sheetTotals, statusCounts, sheetEmptyMessage, isSheetFiltered,
  publishStatus, publishWarning, unpublishWarning, deleteWarning,
  exportLabel, exportWarning, formProblems, situationalPanels,
  money, withVat, statusTone,
  TRACKING_AD_TYPES, PLATFORM_SUGGESTIONS, EMPTY_SHEET_FILTER,
  type SheetFilter, type SheetRow,
} from '@/lib/tracking';

/**
 * Tracking sheet for a single campaign (parent pm_task with has_tracking).
 *
 * One row per ad / vendor deliverable, modelled on the client's Excel. Rows are
 * added and edited through a popup. Opened from the Tracking Sheets list or the
 * task's "Tracking sheet" button — it is not a top-level sidebar view.
 *
 * What changed (Aug 2026, variant A):
 *
 *  - **Row numbers stopped moving.** `#` was the index in the filtered list, so
 *    turning on a status filter renumbered the sheet. It is now the row's place
 *    in the sheet's own order and does not change when the view narrows.
 *  - **The export says what it will export.** It has always been handed the
 *    *filtered* rows: filter to Posted, press Export, and the client receives a
 *    file with every unposted ad silently missing. The button now counts, and a
 *    line beside it says how many rows a filter is leaving out.
 *  - **Publish lives here.** It was only on the task panel, so the sheet could
 *    not tell you whether the client was looking at it.
 *  - **Type of ad is the vendor booking's list**, not free text — so the
 *    situational panels open because somebody chose Store Visit, not because
 *    the string happened to contain "store".
 *  - The browser `confirm()` on delete and `alert()` on a failed export are
 *    gone. Deleting names the row and the person on it.
 *  - An unpriced row reads "—". It was "0.00", which says free.
 *
 * Then variant B (migration 063): **one row per AD.**
 *
 *  - A vendor booked for six home ads and six store visits used to get twelve
 *    ad lines and exactly ONE sheet row — one posting date and one status
 *    standing for all twelve. Rows are keyed to (ad_line_id, ad_line_seq) now,
 *    so a line of four is four rows.
 *  - Rows that came from a booking carry a **booked** marker and their price is
 *    read-only: it is the contract's number, and two editable copies of one
 *    figure is how the sheet and the contract come to disagree with nothing
 *    able to say which the vendor signed.
 *  - Existing sheets are NOT rewritten. The banner says how many booked ads are
 *    missing and adds them only when asked — these are live client sheets, and
 *    a migration is the wrong place to rewrite them.
 *  - Nothing is ever removed. A row whose ad line has gone says "booking
 *    removed" and stays, because the date and the link on it may be the only
 *    copy.
 *
 * Still true: the sheet and vendor_ad_lines hold the same ad in two tables.
 * Collapsing them into one is variant C, and a bigger migration.
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
  const { rows: publishedRows, refetch: refetchPublished } = usePublishedTrackingRows(taskId);
  // The campaign's vendor bookings, and the ads inside them. The sheet is one
  // row per ad now (migration 063), so this is what it is meant to mirror.
  const { bookings, refetch: refetchBookings } = useCampaignBookings(taskId);

  const [editing, setEditing] = useState<TrackingRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<SheetFilter>(EMPTY_SHEET_FILTER);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<'publish' | 'unpublish' | 'sync' | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit = role !== 'member';

  const [today, setToday] = useState<string | null>(null);
  useEffect(() => { setToday(new Date().toISOString().slice(0, 10)); }, []);

  const sheet = useMemo(
    () => (today ? buildSheet(rows as any, today) : []),
    [rows, today],
  );
  const shown = useMemo(() => filterSheet(sheet, filter), [sheet, filter]);
  const totals = useMemo(() => sheetTotals(sheet, shown), [sheet, shown]);
  const counts = useMemo(() => statusCounts(sheet), [sheet]);

  const publish = useMemo(() => publishStatus({
    // pm_tasks.tracking_published_at is not on this component's props, so the
    // snapshot itself is the source of truth: if there are published rows, it
    // has been published, whatever the flag on the task says.
    publishedAt: publishedRows[0]?.published_at ?? null,
    working: rows.map((r) => ({ id: r.id, updated_at: r.updated_at })),
    published: publishedRows.map((p) => ({
      source_row_id: p.source_row_id, updated_at: p.updated_at,
    })),
    today: today ?? '',
  }), [rows, publishedRows, today]);

  const ads = useMemo(() => expandBookings(bookings as any), [bookings]);
  const plan = useMemo(() => planSync({ ads, rows: rows as any }), [ads, rows]);
  const live = useMemo(() => liveAdLineIds(ads), [ads]);
  const origins = useMemo(() => {
    const m = new Map<string, ReturnType<typeof rowOrigin>>();
    for (const r of rows) m.set(r.id, rowOrigin(r as any, live));
    return m;
  }, [rows, live]);

  const byId = useMemo(() => {
    const m = new Map<string, SheetRow>();
    for (const r of sheet) m.set(r.id, r);
    return m;
  }, [sheet]);

  const doExport = async () => {
    if (!shown.length) return;
    setExporting(true); setError('');
    try {
      const order = new Map(shown.map((r, i) => [r.id, i]));
      const picked = rows
        .filter((r) => order.has(r.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      await exportTrackingXlsx(taskTitle, picked);
      setNotice(`Exported ${picked.length} row${picked.length === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setError(e?.message ?? 'The export failed. Nothing was sent to anyone.');
    } finally {
      setExporting(false);
    }
  };

  const doSync = async () => {
    setBusy(true); setError('');
    try {
      // Adopt first, then insert: a placeholder claimed by the ad it stood in
      // for must not be able to end up beside a fresh copy of itself. That
      // ordering is between the adoptions and the INSERT — the adoptions
      // have no order among themselves, each touching its own row, so they
      // go together. Twenty placeholders was twenty sequential writes, and
      // every one of them is now a trip to Frankfurt.
      await Promise.all(plan.toAdopt.map((adoption) =>
        updateTrackingRow(String(adoption.row.id), adoptionPatch(adoption) as any)));
      const start = rows.reduce((max, r) => Math.max(max, Number(r.position) || 0), -1) + 1;
      const added = await addTrackingRowsFromBookings(taskId, plannedRows(plan, start, brandName));
      await Promise.all([refetch(), refetchBookings()]);
      setConfirming(null);
      const total = added + plan.toAdopt.length;
      setNotice(`${total} ${total === 1 ? 'ad' : 'ads'} added from the bookings.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const doPublish = async () => {
    setBusy(true); setError('');
    try {
      const n = await publishTrackingSheet(taskId);
      await refetchPublished();
      setConfirming(null);
      setNotice(`The client can now see ${n} row${n === 1 ? '' : 's'}.`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const doUnpublish = async () => {
    setBusy(true); setError('');
    try {
      await unpublishTrackingSheet(taskId);
      await refetchPublished();
      setConfirming(null);
      setNotice('The client can no longer see this sheet.');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const closeModal = () => { setEditing(null); setCreating(false); };
  const afterSave = async () => { await refetch(); closeModal(); };

  const exportWarn = exportWarning(shown.length, sheet.length);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 190,
        background: 'rgba(15, 29, 34, 0.55)',
        display: 'flex', justifyContent: 'flex-end',
      }}
      onClick={onClose}
      role="dialog" aria-modal="true" aria-label={`Tracking sheet — ${taskTitle}`}
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
          padding: '18px 24px 14px',
          borderBottom: '1px solid var(--aq-border-light)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16, position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--aq-bg-elevated)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.25 }}>{taskTitle}</h2>
            <p style={{ marginTop: 3, fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
              {brandName ? `${brandName} · ` : ''}
              {sheet.length} {sheet.length === 1 ? 'ad' : 'ads'}
              {totals.incl != null && ` · SAR ${money(totals.incl)}${totals.partial ? ' shown' : ''} incl. VAT`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={doExport}
              disabled={exporting || shown.length === 0}
              title={exportWarn ?? 'Download this sheet as an Excel file'}
            >{exporting ? 'Exporting…' : exportLabel(shown.length, sheet.length)}</button>
            {canEdit && (
              <>
                <button
                  type="button"
                  className="aq-btn"
                  onClick={() => setConfirming('publish')}
                  disabled={busy || sheet.length === 0}
                  // Ink, not the accent green: green already means "Posted" in
                  // the status column, and a green button beside green pills
                  // makes the colour stop meaning anything.
                  style={{
                    background: INK, borderColor: INK, color: '#fff',
                    opacity: busy || sheet.length === 0 ? 0.45 : 1,
                  }}
                >{publish.state === 'never' ? 'Publish to client' : 'Update client sheet'}</button>
                <AddButton label="+ Add ad" onClick={() => setCreating(true)} />
              </>
            )}
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={onClose}
              aria-label="Close"
            >✕</button>
          </div>
        </header>

        {/* What the client is seeing */}
        <div style={{
          padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 10,
          flexWrap: 'wrap', fontSize: 12.5,
          background: publish.tone === 'warn' ? '#fef3c7'
            : publish.tone === 'ok' ? 'var(--aq-accent-light)'
            : 'var(--aq-bg-sunken)',
          color: publish.tone === 'warn' ? '#78350f'
            : publish.tone === 'ok' ? '#14603a'
            : 'var(--aq-text-secondary)',
          borderBottom: '1px solid var(--aq-border-light)',
        }}>
          <span>{publish.sentence}</span>
          {canEdit && publish.state !== 'never' && (
            <button
              type="button"
              onClick={() => setConfirming('unpublish')}
              disabled={busy}
              style={{
                font: 'inherit', fontSize: 12, fontWeight: 600, marginLeft: 'auto',
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'inherit', textDecoration: 'underline',
              }}
            >Withdraw it</button>
          )}
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div role="alert" style={{
              background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
            }}>{error}</div>
          )}
          {notice && (
            <div role="status" style={{
              background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                style={{
                  font: 'inherit', fontSize: 11, marginLeft: 'auto', background: 'none',
                  border: 'none', cursor: 'pointer', color: 'var(--aq-text-muted)',
                  textDecoration: 'underline',
                }}
              >dismiss</button>
            </div>
          )}

          {canEdit && syncSentence(plan) && confirming !== 'sync' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              background: 'var(--aq-accent-light)', color: '#14603a',
              padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5,
            }}>
              <span style={{ flex: 1, minWidth: 220 }}>{syncSentence(plan)}</span>
              {syncTotal(plan) > 0 && (
                <button
                  type="button"
                  className="aq-btn"
                  onClick={() => setConfirming('sync')}
                  disabled={busy}
                  style={{ background: INK, borderColor: INK, color: '#fff', fontSize: 12 }}
                >{syncLabel(plan)}</button>
              )}
            </div>
          )}

          {confirming === 'sync' && (
            <Confirm
              text={syncWarning(plan)}
              confirmLabel={syncLabel(plan)}
              busy={busy}
              onConfirm={doSync}
              onCancel={() => setConfirming(null)}
            />
          )}

          {confirming === 'publish' && (
            <Confirm
              text={publishWarning(publish, sheet.length)}
              confirmLabel={publish.state === 'never' ? 'Publish to client' : 'Replace the client copy'}
              busy={busy}
              onConfirm={doPublish}
              onCancel={() => setConfirming(null)}
            />
          )}
          {confirming === 'unpublish' && (
            <Confirm
              text={unpublishWarning()}
              confirmLabel="Withdraw the sheet"
              busy={busy}
              onConfirm={doUnpublish}
              onCancel={() => setConfirming(null)}
            />
          )}

          {loading || !today ? (
            <div style={{ color: 'var(--aq-text-muted)', fontSize: 13 }}>Loading tracking sheet…</div>
          ) : sheet.length === 0 ? (
            <div style={{
              border: '1px dashed var(--aq-border-light)',
              borderRadius: 'var(--aq-radius)',
              padding: 40, textAlign: 'center', color: 'var(--aq-text-muted)', fontSize: 13,
            }}>
              No ads tracked yet.{canEdit && ' Use “+ Add ad” to add the first row.'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="aq-input"
                  style={{ flex: '1 1 240px', minWidth: 180, width: 'auto' }}
                  value={filter.query}
                  onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                  placeholder="Search influencer, product, ad type or notes"
                  aria-label="Search this sheet"
                />
                <Chip
                  label="All"
                  count={sheet.length}
                  on={!filter.status}
                  onClick={() => setFilter((f) => ({ ...f, status: '' }))}
                />
                {AD_STATUSES.map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    count={counts[s] ?? 0}
                    on={filter.status === s}
                    onClick={() => setFilter((f) => ({ ...f, status: f.status === s ? '' : s }))}
                  />
                ))}
              </div>

              {exportWarn && (
                <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>{exportWarn}</p>
              )}

              <div className="aq-card" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ minWidth: 1040, width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
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
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={11} style={{
                          padding: '18px 12px', fontSize: 13, color: 'var(--aq-text-muted)',
                          borderTop: '1px solid var(--aq-border-light)',
                        }}>{sheetEmptyMessage(filter, sheet.length)}</td>
                      </tr>
                    )}
                    {shown.map((r) => (
                      <tr
                        key={r.id}
                        className="aq-tr"
                        tabIndex={canEdit ? 0 : -1}
                        onClick={() => canEdit && openRow(r.id)}
                        onKeyDown={(e) => {
                          if (canEdit && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault(); openRow(r.id);
                          }
                        }}
                        style={{
                          cursor: canEdit ? 'pointer' : 'default',
                          borderTop: '1px solid var(--aq-border-light)',
                        }}
                      >
                        <Td muted>{r.num}</Td>
                        <Td>
                          <span style={{ fontWeight: 600 }}>{r.name || '—'}</span>
                          {origins.get(r.id)?.booked && (
                            <span
                              title={origins.get(r.id)?.priceNote}
                              style={{
                                marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px',
                                borderRadius: 999,
                                background: origins.get(r.id)?.orphaned
                                  ? 'var(--aq-bg-sunken)' : 'var(--aq-accent-light)',
                                color: origins.get(r.id)?.orphaned
                                  ? 'var(--aq-text-muted)' : '#14603a',
                              }}
                            >{origins.get(r.id)?.label}</span>
                          )}
                          {r.isEvent && (
                            <span style={{
                              marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 7px',
                              borderRadius: 999, background: '#fef3c7', color: '#92400e',
                            }}>event</span>
                          )}
                        </Td>
                        <Td muted={!r.platform}>{r.platform || '—'}</Td>
                        <Td muted={!r.adType}>{r.adType || '—'}</Td>
                        <Td muted={!r.product}>{r.product || '—'}</Td>
                        <Td muted>{r.shooting}</Td>
                        <Td muted={r.posting === '—'}>{r.posting}</Td>
                        <Td><StatusPill status={r.status} /></Td>
                        <Td
                          align="right"
                          muted={r.excl == null || Boolean(origins.get(r.id)?.booked)}
                        >{money(r.excl)}</Td>
                        <Td align="right" muted={r.incl == null}>{money(r.incl)}</Td>
                        <Td muted={!r.link}>
                          {r.link
                            ? <a href={r.link} target="_blank" rel="noopener noreferrer"
                                 onClick={(e) => e.stopPropagation()}
                                 style={{ color: 'var(--aq-accent)' }}>link</a>
                            : '—'}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--aq-border)', fontWeight: 700 }}>
                      <Td></Td>
                      <Td>{totals.label}</Td>
                      <Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td>
                      <Td align="right">{money(totals.excl)}</Td>
                      <Td align="right">{money(totals.incl)}</Td>
                      <Td></Td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </aside>

      {(editing || creating) && (
        <TrackingRowModal
          taskId={taskId}
          row={editing}
          num={editing ? byId.get(editing.id)?.num ?? null : null}
          origin={editing ? origins.get(editing.id) ?? null : null}
          onClose={closeModal}
          onSaved={afterSave}
        />
      )}
    </div>
  );

  function openRow(id: string) {
    const row = rows.find((r) => r.id === id) ?? null;
    if (row) setEditing(row);
  }
}

// ============================================================
// Row popup editor
// ============================================================

function TrackingRowModal({
  taskId, row, num, origin, onClose, onSaved,
}: {
  taskId: string;
  row: TrackingRow | null;
  num: number | null;
  /** Set when the row came from a vendor booking. */
  origin: { booked: boolean; orphaned: boolean; label: string; priceNote: string } | null;
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
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof TrackingRowInput>(k: K, v: TrackingRowInput[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const priceIncl = withVat(f.price_excl);
  const panels = situationalPanels(f.type_of_ad, f.is_event);

  // A row typed before the picker existed keeps its value as an extra option
  // rather than being silently rewritten to the nearest match.
  const adType = (f.type_of_ad ?? '') as string;
  const legacyAdType = adType && !TRACKING_AD_TYPES.includes(adType as any);

  const save = async () => {
    const found = formProblems(f as any);
    setProblems(found);
    if (found.length) return;
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
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>
            {isNew ? 'Add an ad' : num ? `Row ${num}` : 'Edit the row'}
          </h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 12.5, marginTop: 4 }}>
            One row per ad. The extra fields appear when the ad type asks for them.
          </p>
        </header>

        {problems.length > 0 && (
          <div role="alert" style={{
            background: '#fef3c7', border: '1px solid #fde68a', color: '#78350f',
            padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5, marginBottom: 14,
          }}>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        )}

        {error && (
          <div role="alert" style={{
            background: '#fee2e2', border: '1px solid #fecaca', color: '#991b1b',
            padding: '10px 14px', borderRadius: 'var(--aq-radius)', fontSize: 12.5, marginBottom: 14,
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
              <input className="aq-input" list="aq-tracking-platforms" value={f.platform ?? ''}
                     onChange={(e) => set('platform', e.target.value)} placeholder="Instagram, TikTok…" />
              <datalist id="aq-tracking-platforms">
                {PLATFORM_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </Field>
            <Field label="Type of ad">
              {/* The vendor booking's own list. Same words on both sides — the
                  free-text box is why the same ad arrived spelled five ways. */}
              <select className="aq-select" value={adType}
                      onChange={(e) => set('type_of_ad', e.target.value)}>
                <option value="">Not set</option>
                {legacyAdType && <option value={adType}>{adType} (as typed)</option>}
                {TRACKING_AD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
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
                     onChange={(e) => set('ad_link', e.target.value)} placeholder="https://…" />
            </Field>
          </div>

          {/* Pricing — incl. VAT is derived */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Price excl. VAT (SAR)">
              {/* A booked ad's price is the contract's number. Editing it here
                  would put the sheet and the contract at different figures
                  with nothing able to say which one the vendor agreed to. */}
              <input
                className="aq-input"
                inputMode="decimal"
                value={String(f.price_excl ?? 0)}
                readOnly={Boolean(origin?.booked && !origin.orphaned)}
                onChange={(e) => set('price_excl', e.target.value === '' ? 0 : Number(e.target.value))}
                placeholder="0.00"
                style={origin?.booked && !origin.orphaned
                  ? { background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-muted)' }
                  : undefined}
              />
              {origin?.booked && (
                <p style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 4 }}>
                  {origin.priceNote}
                </p>
              )}
            </Field>
            <Field label="Price incl. 15% VAT (SAR)">
              <input className="aq-input" value={priceIncl == null ? 'not priced' : money(priceIncl)} readOnly
                     style={{ background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-muted)' }} />
            </Field>
          </div>

          {/* Event flag — gates the licence-plate photo */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
            <input type="checkbox" checked={Boolean(f.is_event)}
                   onChange={(e) => set('is_event', e.target.checked)}
                   style={{ width: 16, height: 16 }} />
            <span>This is an event (requires a licence-plate photo)</span>
          </label>

          {panels.storeVisit && (
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
              {panels.plateRequired && (
                <Field label="Licence-plate photo link *">
                  <input className="aq-input" value={f.license_plate_url ?? ''}
                         onChange={(e) => set('license_plate_url', e.target.value)}
                         placeholder="Link to the licence-plate photo" />
                </Field>
              )}
            </SituationalGroup>
          )}

          {panels.homeAd && (
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

          {confirmDelete && (
            <Confirm
              text={deleteWarning({ name: (f.influencer_name ?? '') as string, num: num ?? undefined })}
              confirmLabel="Remove the row"
              busy={busy}
              onConfirm={remove}
              onCancel={() => setConfirmDelete(false)}
            />
          )}
        </div>

        <footer style={{
          marginTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        }}>
          <div>
            {!isNew && !confirmDelete && (
              <button type="button" className="aq-btn aq-btn-ghost" disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                      style={{ color: '#b91c1c' }}>Delete row</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="aq-btn aq-btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
            <button
              type="button"
              className="aq-btn"
              disabled={busy}
              onClick={save}
              style={{ background: INK, borderColor: INK, color: '#fff', opacity: busy ? 0.45 : 1 }}
            >{busy ? 'Saving…' : isNew ? 'Add the ad' : 'Save changes'}</button>
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
      textAlign: align, padding: '9px 12px', fontSize: 10, fontWeight: 700,
      color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '.07em',
      whiteSpace: 'nowrap', borderBottom: '1px solid var(--aq-border)',
    }}>{children}</th>
  );
}

function Td({ children, align = 'left', muted = false }: {
  children?: React.ReactNode; align?: 'left' | 'right'; muted?: boolean;
}) {
  return (
    <td style={{
      textAlign: align, padding: '10px 12px',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)', whiteSpace: 'nowrap',
      fontVariantNumeric: align === 'right' ? 'tabular-nums' : undefined,
    }}>{children}</td>
  );
}

const STATUS_STYLE = {
  ok:   { bg: 'var(--aq-accent-light)', fg: '#14603a' },
  info: { bg: '#dbeafe', fg: '#1e40af' },
  warn: { bg: '#fef3c7', fg: '#92400e' },
  bad:  { bg: '#fee2e2', fg: '#991b1b' },
  none: { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-muted)' },
} as const;

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[statusTone(status)];
  return (
    <span style={{
      display: 'inline-block', fontSize: 10.5, fontWeight: 700,
      padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
      background: s.bg, color: s.fg,
    }}>{status}</span>
  );
}
