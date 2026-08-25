'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  useLegacyVendors, useVendorAdLines,
  updateTaskFields, updateTasksBulk, removeSubtask, syncBookingPriceFromAds,
  ensureTrackingRowsForBooking, isTrackableVendorCategory, vendorNeedsInsight,
  vendorDataRequirements, vendorContractReadiness, contractTally,
  sendVendorContractRequests,
  displayName, labelFor, AD_TYPES, TASK_STATUSES,
  type PMTask, type WorkspaceRole,
} from '@/hooks/use-workflow';
import { AddVendorsModal } from '../AddVendorsModal';
import { AdLinesCard } from '../AdLinesCard';
import { SearchablePicker } from '../SearchablePicker';
import { DateField } from '../DateField';
import {
  Card, Group, Fields, F, Val, Pick, Text, Check, Note, UndoBar, Missing,
  inkButton, quietButton, SMALL_BTN,
} from './ui';
import {
  money, initials, parseMoney, bulkResultLine, bookingSubtitle,
} from '@/lib/campaign-page';
import type { OptimisticSave } from '@/hooks/use-optimistic-save';

const UNDO_MS = 4000;

const BOOKING_LABELS: Record<string, string> = {
  price: 'Price', net_amount: 'Net', platform: 'Platform', ad_type: 'Ad type',
  vendor_payment_date: 'Paid on', insight_link: 'Insight link',
  insight_attached: 'Insight file', proof_of_posting_link: 'Proof link',
  proof_of_posting_attached: 'Proof file', vendor_id: 'Vendor',
};

/**
 * Bookings — the vendors on this campaign, and everything you do to them.
 *
 * This is the half of the old drawer that mattered most and the half the
 * campaign page shipped without: adding vendors, pricing them, editing their
 * ads, and asking legal for their contracts. Siraj, on the read-only page:
 * *"I cant do anything right now with the tasks… their is no way to ask for
 * contracts add vendors."*
 *
 * Two things are deliberately different from the drawer.
 *
 * **A booking opens in place.** In the drawer, clicking a vendor replaced the
 * whole panel with that vendor and you lost sight of the campaign; getting
 * back was a "← Back to parent task" link. Here the row expands underneath
 * itself, so the campaign's money and the vendor's price are on screen
 * together — which is the comparison anyone opening a booking is making.
 *
 * **Nothing is destroyed behind a dialog.** Removing a booking starts a four
 * second window with an Undo, the pattern the drawer already used, because a
 * confirm dialog asked forty times a day is a dialog nobody reads.
 */
export function CampaignBookings({
  task, subtasks, adLinesBySubtask, bookings, role, currentUserId,
  workspaceId, client, taskPlatforms, profiles, opt, onChanged,
}: {
  task: PMTask;
  subtasks: PMTask[];
  adLinesBySubtask: Map<string, any[]>;
  bookings: { id: string; name: string; [k: string]: any }[];
  role: WorkspaceRole | null;
  currentUserId: string;
  workspaceId: string;
  client: any | null;
  taskPlatforms: { id: string; name: string }[];
  profiles: any[];
  /** Saves land on screen first and go to the server behind them. */
  opt: OptimisticSave;
  onChanged: () => Promise<void> | void;
}) {
  const { vendors, banks } = useLegacyVendors();

  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Pending removals, each with its own countdown. Kept in a ref as well so
  // the pagehide flush can reach them without a stale closure.
  const [pending, setPending] = useState<{ id: string; title: string; left: number }[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const canEdit = role !== 'member';
  const canRequestContract = !!role
    && ['owner', 'admin', 'marketing', 'sales', 'key_account'].includes(role);

  const vendorSubtasks = useMemo(
    () => subtasks.filter((s) => (s as any).subtask_kind === 'vendor' || (s as any).vendor_id != null),
    [subtasks],
  );

  const tally = useMemo(
    () => contractTally(vendorSubtasks, vendors as any, banks as any),
    [vendorSubtasks, vendors, banks],
  );

  const platformNames = useMemo(
    () => taskPlatforms.map((p) => String((p as any).name ?? '')).filter(Boolean),
    [taskPlatforms],
  );

  const subtaskById = useMemo(() => {
    const m = new Map<string, PMTask>();
    for (const s of vendorSubtasks) m.set(s.id, s);
    return m;
  }, [vendorSubtasks]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); await onChanged(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  /* ── Removing, with a way back ─────────────────────────────────── */

  const commitRemove = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearInterval(t); timers.current.delete(id); }
    setPending((p) => p.filter((x) => x.id !== id));
    void run(async () => { await removeSubtask(id); });
  };

  const startRemove = (id: string, title: string) => {
    setSelected((s) => { const n = new Set(s); n.delete(id); return n; });
    setPending((p) => [...p.filter((x) => x.id !== id), { id, title, left: UNDO_MS / 1000 }]);
    const timer = setInterval(() => {
      setPending((p) => {
        const row = p.find((x) => x.id === id);
        if (!row) return p;
        if (row.left <= 1) { commitRemove(id); return p.filter((x) => x.id !== id); }
        return p.map((x) => (x.id === id ? { ...x, left: x.left - 1 } : x));
      });
    }, 1000);
    timers.current.set(id, timer);
  };

  const undoRemove = (id: string) => {
    const t = timers.current.get(id);
    if (t) { clearInterval(t); timers.current.delete(id); }
    setPending((p) => p.filter((x) => x.id !== id));
  };

  /* ── Bulk ──────────────────────────────────────────────────────── */

  const selectedList = useMemo(
    () => [...selected].map((id) => subtaskById.get(id)).filter(Boolean) as PMTask[],
    [selected, subtaskById],
  );

  const bulkEdit = (fields: Partial<PMTask>) => run(async () => {
    await updateTasksBulk([...selected], fields);
    setNotice(`Updated ${selected.size} booking${selected.size === 1 ? '' : 's'}.`);
  });

  const bulkRequestContracts = () => run(async () => {
    const res = await sendVendorContractRequests({
      subtasks: selectedList,
      parent: task,
      vendors: vendors as any,
      banks: banks as any,
      client,
      requestedBy: currentUserId,
    });
    setNotice(bulkResultLine(res.sent, res.skipped));
    setSelected(new Set());
  });

  /* ── One booking's fields ──────────────────────────────────────── */

  const saveOn = (subtaskId: string, field: string, value: unknown, was?: unknown) =>
    opt.set(subtaskId, field, value, {
      label: BOOKING_LABELS[field] ?? field,
      was,
      rowName: subtaskById.get(subtaskId)?.title ?? undefined,
    });

  const changeVendor = (sub: PMTask, vendorId: string | null) => run(async () => {
    const id = vendorId ? Number(vendorId) : null;
    await updateTaskFields(sub.id, { vendor_id: id } as any);
    const vendor = (vendors as any[]).find((v) => Number(v.id) === id);
    if (vendor && isTrackableVendorCategory(vendor.category ?? vendor.service_type)) {
      await ensureTrackingRowsForBooking({
        parent_task_id: task.id,
        subtask_id: sub.id,
        vendor_name: String(vendor.name ?? ''),
        platform: (sub as any).platform ?? (task as any).platform ?? null,
        price_excl: (sub as any).price ?? null,
      });
      if (!(task as any).has_tracking) {
        await updateTaskFields(task.id, { has_tracking: true } as any);
      }
      setNotice(`${vendor.name} is on the tracking sheet.`);
    }
  });


  const vendorOptions = useMemo(
    () => (vendors as any[]).map((v) => ({
      value: String(v.id),
      label: String(v.name ?? ''),
      hint: String(v.category ?? v.service_type ?? ''),
    })),
    [vendors],
  );

  const pendingIds = new Set(pending.map((p) => p.id));
  const shown = bookings.filter((b) => !pendingIds.has(b.id));

  return (
    <Card
      id="bookings"
      title="Bookings"
      hint={`${bookings.length} vendor${bookings.length === 1 ? '' : 's'} · ${tally.requested} of ${tally.total} contracts requested`}
      right={canEdit ? (
        <button type="button" style={inkButton(busy)} disabled={busy} onClick={() => setAdding(true)}>
          Add vendors
        </button>
      ) : null}
    >
      {error && <Note tone="bad">{error}</Note>}
      {notice && !error && <Note tone="good">{notice}</Note>}

      {/* ── The bulk bar ─────────────────────────────────────────── */}
      {canEdit && selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '9px 12px', borderRadius: 9, marginBottom: 12,
          background: 'var(--aq-bg-sunken)', border: '1px solid var(--aq-border-light)',
        }}>
          <strong style={{ fontSize: 12.5 }}>{selected.size} selected</strong>

          {/* Status, assignee and a due date used to live here. Siraj: they were
              never the reason anyone multi-selected bookings — asking for the
              contracts was. Bulk-setting a status across ten vendors mostly
              produced ten wrong statuses. */}
          {canRequestContract && (
            <button type="button" style={inkButton(busy)} disabled={busy} onClick={bulkRequestContracts}>
              Request {selected.size} contract{selected.size === 1 ? '' : 's'}
            </button>
          )}

          <button
            type="button" style={{ ...quietButton(busy), color: '#991b1b' }} disabled={busy}
            onClick={() => { selectedList.forEach((s) => startRemove(s.id, s.title ?? '')); }}
          >Remove</button>

          <button type="button" style={quietButton()} onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* ── Removals in flight ───────────────────────────────────── */}
      {pending.map((p) => (
        <div key={p.id} style={{ marginBottom: 8 }}>
          <UndoBar
            label={`Removed ${p.title || 'the booking'}.`}
            seconds={p.left}
            onUndo={() => undoRemove(p.id)}
            onNow={() => commitRemove(p.id)}
          />
        </div>
      ))}

      {!shown.length && !pending.length && (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', margin: '4px 0' }}>
          Nobody is booked on this campaign yet.
          {canEdit ? ' Add vendors and their prices roll up into the money above.' : ''}
        </p>
      )}

      {/* ── The bookings ─────────────────────────────────────────── */}
      {shown.map((b, i) => {
        const sub = subtaskById.get(b.id);
        if (!sub) return null;
        const open = openId === b.id;
        const lines = adLinesBySubtask.get(b.id) ?? [];
        const vendor = (vendors as any[]).find((v) => Number(v.id) === Number((sub as any).vendor_id)) ?? null;
        const bank = (banks as any[]).find((x) => Number(x.vendor_id) === Number((sub as any).vendor_id)) ?? null;
        const already = !!(sub as any).contract_request_id;
        const readiness = vendorContractReadiness(sub, vendor, bank, b.amount ?? null);
        const requirements = vendorDataRequirements(sub, vendor);

        return (
          <div key={b.id} style={{
            borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)',
            padding: '11px 0',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {canEdit && (
                <input
                  type="checkbox"
                  aria-label={`Select ${b.name}`}
                  checked={selected.has(b.id)}
                  onChange={(e) => setSelected((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(b.id); else n.delete(b.id);
                    return n;
                  })}
                />
              )}

              <span aria-hidden style={{
                width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto',
                background: 'var(--aq-bg-sunken)', color: 'var(--aq-text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>{initials(b.name)}</span>

              <button
                type="button"
                onClick={() => setOpenId(open ? null : b.id)}
                aria-expanded={open}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
                  border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
                }}
              >
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{b.name}</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--aq-text-muted)' }}>
                  {bookingSubtitle(b as any, lines.length)}
                </span>
              </button>

              <span style={{
                fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                color: b.amount == null ? 'var(--aq-text-muted)' : undefined,
              }}>
                {b.amount == null ? 'no price yet' : money(b.amount)}
              </span>
            </div>

            {open && (
              <div style={{ paddingLeft: canEdit ? 26 : 0, marginTop: 12 }}>
                {/* The one thing that blocks the contract, said before the fields. */}
                {canRequestContract && !already && !readiness.ready && (
                  <Note tone="warn">
                    <strong>The contract cannot be requested yet.</strong>
                    <Missing items={readiness.missing as any} />
                  </Note>
                )}
                {already && <Note tone="good">A contract has been requested for this booking.</Note>}

                <Fields>
                  <F k="Vendor">
                    {canEdit && !already ? (
                      <SearchablePicker
                        options={vendorOptions}
                        value={(sub as any).vendor_id != null ? String((sub as any).vendor_id) : null}
                        onChange={(v) => changeVendor(sub, v)}
                        placeholder="Search vendors…"
                      />
                    ) : <Val>{vendor?.name ?? '— none —'}</Val>}
                  </F>
                  {/* An influencer is priced per piece, so once the ads below
                      carry prices they are the source and this only reports
                      them. Typing here was worse than useless: the next edit
                      to any line called syncBookingPriceFromAds and wiped it. */}
                  <F k="Price">
                    {b.pricedPerLine ? (
                      <Val calc>{b.price == null ? '—' : money(b.price)} · from the {lines.length} ads below</Val>
                    ) : (
                      <Text
                        numeric canEdit={canEdit}
                        value={(sub as any).price ?? ''}
                        placeholder="0.00"
                        onCommit={(v) => saveOn(sub.id, 'price', parseMoney(v), (sub as any).price)}
                      />
                    )}
                  </F>
                  <F k="Net">
                    {b.pricedPerLine && b.net != null ? (
                      <Val calc>{money(b.net)} · added up from the ads</Val>
                    ) : (
                      <Text
                        numeric canEdit={canEdit}
                        value={(sub as any).net_amount ?? ''}
                        placeholder="0.00"
                        onCommit={(v) => saveOn(sub.id, 'net_amount', parseMoney(v), (sub as any).net_amount)}
                      />
                    )}
                  </F>
                  <F k="AQ gross">
                    <Val calc>{
                      b.price != null && b.net != null ? money(b.price - b.net) : '—'
                    }</Val>
                  </F>
                  <F k="Platform">
                    <Pick
                      canEdit={canEdit}
                      value={(sub as any).platform}
                      options={platformNames.map((p) => ({ v: p, l: p }))}
                      onChange={(v) => saveOn(sub.id, 'platform', v, (sub as any).platform)}
                    />
                  </F>
                  <F k="Ad type">
                    <Pick
                      canEdit={canEdit}
                      value={(sub as any).ad_type}
                      options={[...AD_TYPES].map((a) => ({ v: String(a), l: labelFor(String(a)) }))}
                      onChange={(v) => saveOn(sub.id, 'ad_type', v, (sub as any).ad_type)}
                    />
                  </F>
                  <F k="Paid on">
                    {canEdit
                      ? <DateField
                          aria-label="Paid on"
                          value={(sub as any).vendor_payment_date}
                          onCommit={(v) => saveOn(sub.id, 'vendor_payment_date', v, (sub as any).vendor_payment_date)}
                        />
                      : <Val>{(sub as any).vendor_payment_date ?? '—'}</Val>}
                  </F>
                  {vendorNeedsInsight(vendor?.category ?? vendor?.service_type) && (
                    <>
                      <F k="Insight link">
                        <Text
                          canEdit={canEdit}
                          value={(sub as any).insight_link}
                          placeholder="https://…"
                          onCommit={(v) => saveOn(sub.id, 'insight_link', v || null, (sub as any).insight_link)}
                        />
                      </F>
                      <F k="Insight file">
                        <Check
                          canEdit={canEdit}
                          checked={!!(sub as any).insight_attached}
                          onChange={(v) => saveOn(sub.id, 'insight_attached', v, (sub as any).insight_attached)}
                        />
                      </F>
                    </>
                  )}
                  {/* Proof lives on the ad once there are ads to hang it on. */}
                  {!lines.length && (
                    <>
                      <F k="Proof link">
                        <Text
                          canEdit={canEdit}
                          value={(sub as any).proof_of_posting_link}
                          placeholder="https://…"
                          onCommit={(v) => saveOn(sub.id, 'proof_of_posting_link', v || null, (sub as any).proof_of_posting_link)}
                        />
                      </F>
                      <F k="Proof file">
                        <Check
                          canEdit={canEdit}
                          checked={!!(sub as any).proof_of_posting_attached}
                          onChange={(v) => saveOn(sub.id, 'proof_of_posting_attached', v, (sub as any).proof_of_posting_attached)}
                        />
                      </F>
                    </>
                  )}
                </Fields>

                {requirements.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                      Still needed for this vendor
                    </span>
                    <Missing items={requirements as any} />
                  </div>
                )}

                <Group title="The ads" />
                <AdLinesCard
                  subtaskId={sub.id}
                  canEdit={canEdit}
                  lines={lines}
                  loading={false}
                  refetch={onChanged}
                  platformOptions={platformNames}
                  defaultPlatform={(sub as any).platform ?? (task as any).platform ?? null}
                  onTotalChanged={async () => {
                    await syncBookingPriceFromAds(sub.id);
                    await onChanged();
                  }}
                />

                {/* Asking for the contract is not here any more — it is on the
                    Vendor contracts card, where every vendor's stands together
                    and one button asks for all of them. */}
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', marginTop: 14 }}>
                  {canEdit && (
                    <button
                      type="button"
                      style={{ ...quietButton(busy), color: '#991b1b', marginLeft: 'auto' }}
                      disabled={busy}
                      onClick={() => { setOpenId(null); startRemove(sub.id, b.name); }}
                    >Remove this booking</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {adding && (
        <AddVendorsModal
          open={adding}
          onClose={() => setAdding(false)}
          parentTaskId={task.id}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          brandName={task.brand_name ?? null}
          priority={(task as any).priority}
          existingVendorCount={vendorSubtasks.length}
          taskPlatforms={taskPlatforms as any}
          onCreated={async (count, trackable) => {
            if (trackable && !(task as any).has_tracking) {
              await updateTaskFields(task.id, { has_tracking: true } as any);
            }
            setNotice(`Added ${count} booking${count === 1 ? '' : 's'}.`);
            setAdding(false);
            await onChanged();
          }}
        />
      )}
    </Card>
  );
}
