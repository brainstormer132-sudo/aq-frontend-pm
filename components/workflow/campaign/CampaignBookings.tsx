'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  useLegacyVendors, useVendorAdLines,
  updateTaskFields, updateTasksBulk, removeSubtask, syncBookingPriceFromAds,
  ensureTrackingRowsForBooking, shouldTrackVendorOnSheet, vendorNeedsInsight,
  vendorCategoryKey,
  vendorDataRequirements, vendorContractReadiness, contractTally,
  vendorSubtaskTitle, isAutoVendorTitle,
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
  inkButton, quietButton, SMALL_BTN, TONE, Chip, toneOf, HILITE, Money,
  platformTone } from './ui';
import {
  money, initials, parseMoney, bulkResultLine, bookingSubtitle, brandMark,
  type BookingRow,
} from '@/lib/campaign-page';
import type { OptimisticSave } from '@/hooks/use-optimistic-save';

const UNDO_MS = 4000;

/**
 * A field the ads below have already answered.
 *
 * Drawn like `Val calc` — dashed, sunken — so it reads as reported rather
 * than as a control somebody has disabled, which is the same distinction
 * Client price makes once the lines carry money. The values are chips
 * because there can be several: a booking is one vendor, not one ad type.
 */
function FromAds({ values, colourise, lines }: {
  values: string[];
  colourise?: (v: string) => { bg: string; fg: string };
  lines: number;
}) {
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      minHeight: 32, padding: '5px 10px', borderRadius: 8,
      border: '1px dashed var(--aq-border)', background: 'var(--aq-bg-sunken)',
      fontSize: 13, color: 'var(--aq-text-secondary)',
    }}>
      {values.map((v) => (
        <Chip key={v} label={v} colours={colourise?.(v)} />
      ))}
      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
        · from the {lines} {lines === 1 ? 'ad' : 'ads'} below
      </span>
    </span>
  );
}

/** The campaign's platform list as one string, for a tracking row's prefill. */
function campaignPlatformText(t: any): string | null {
  const list = t?.platforms ?? [];
  return Array.isArray(list) && list.length ? list.join(', ') : null;
}

const BOOKING_LABELS: Record<string, string> = {
  price: 'Client price', net_amount: 'Vendors cost', platform: 'Platform', ad_type: 'Ad type',
  title: 'Name', assignee_id: 'Assigned to', due_date: 'Due date',
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
  task, subtasks, adLinesBySubtask, refetchAdLines, bookings, role, currentUserId,
  workspaceId, client, taskPlatforms, profiles, opt, onChanged,
}: {
  task: PMTask;
  subtasks: PMTask[];
  adLinesBySubtask: Map<string, any[]>;
  /**
   * The page's own copy of the ad lines, refreshed.
   *
   * `onChanged` refetches the campaign and its subtasks — not the lines. An
   * ad edited here therefore updated inside this card and nowhere else: the
   * tile above it kept the old price, the pips the old count, the masthead
   * the old money, until the page was reloaded.
   */
  refetchAdLines: () => Promise<void> | void;
  // Typed, not `[k: string]: any`. The loose index signature let `b.amount`
  // — a field BookingRow has never had — typecheck as `any` and come back
  // undefined, so every row read "no price yet" and every contract
  // readiness check believed the booking was unpriced.
  bookings: BookingRow[];
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
    // The campaign and the ads are passed because the readiness check now
    // reads them: the brand name lives on the campaign, and a booking priced
    // entirely through its lines has no price of its own. Without them every
    // per-line booking counted as "blocked", which is the number on the card.
    () => contractTally(
      vendorSubtasks, vendors as any, banks as any,
      task, adLinesBySubtask as any,
    ),
    [vendorSubtasks, vendors, banks, task, adLinesBySubtask],
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

  /**
   * Assign a vendor, and put their ads on the client's sheet.
   *
   * This read `vendor.category ?? vendor.service_type` — and `LegacyVendor`
   * has neither. The column is `vendor_category`, which `useLegacyVendors`
   * backfills from the 029 `category_id` FK before anything sees it. The
   * vendor object is typed `any` at the find() above, so nothing caught it:
   * the expression was `undefined` for every vendor in the book, the gate was
   * therefore always false, and **picking a vendor never once put a row on
   * the tracking sheet or switched it on**. `service_type` is not even on
   * this table — it belongs to `managed_vendors`.
   *
   * Gated on shouldTrackVendorOnSheet, not isTrackableVendorCategory. They
   * differ on the unknown case and the difference matters: an uncategorised
   * vendor should reach the sheet, because a row nobody wanted is deleted in
   * a second and a row that never appeared is invisible. That is the drawer's
   * rule and it was arrived at the hard way.
   */
  const changeVendor = (sub: PMTask, vendorId: string | null) => run(async () => {
    const id = vendorId ? Number(vendorId) : null;
    await updateTaskFields(sub.id, { vendor_id: id } as any);
    if (id == null) return;

    const vendor = (vendors as any[]).find((v) => Number(v.id) === id);
    if (!vendor) return;

    // Name the booking after the vendor, unless somebody has named it
    // themselves. Same update as vendor_id in the drawer, and for the same
    // reason: the contract request copies the title into its details, so a
    // rename afterwards arrives too late to reach the document.
    const brand = (task as any).brand_name ?? null;
    if (isAutoVendorTitle((sub as any).title, brand)) {
      await updateTaskFields(sub.id, {
        title: vendorSubtaskTitle(brand, String(vendor.name ?? '')),
      } as any);
    }

    const category = vendorCategoryKey(vendor);

    if (!shouldTrackVendorOnSheet(category)) {
      // Say so out loud. Silence here is what made this look broken even
      // before the bug: the vendor saved, nothing appeared, and there was no
      // way to tell whether it had failed or been skipped on purpose.
      setNotice(`${vendor.name} was not added to the tracking sheet — ${category ?? 'that'} work is not tracked there. Add a row by hand if you need one.`);
      return;
    }

    // The flag first: a sheet that is switched off used to swallow the rows.
    if (!(task as any).has_tracking) {
      await updateTaskFields(task.id, { has_tracking: true } as any);
    }
    const added = await ensureTrackingRowsForBooking({
      parent_task_id: task.id,
      subtask_id: sub.id,
      vendor_name: String(vendor.name ?? ''),
      // Prefill from whatever is already known, the campaign included.
      platform: (sub as any).platform ?? campaignPlatformText(task) ?? null,
      type_of_ad: (sub as any).ad_type ?? (task as any).ad_type ?? null,
      profile_link: vendor.platforms ?? null,
      product: (task as any).brand_name ?? null,
      price_excl: (sub as any).price ?? null,
    } as any);
    setNotice(added > 0
      ? `${added} ${added === 1 ? 'row' : 'rows'} added to the tracking sheet — one per ad.`
      : `${vendor.name}'s ads are already on the tracking sheet.`);
  });


  const vendorOptions = useMemo(
    () => (vendors as any[]).map((v) => ({
      value: String(v.id),
      label: String(v.name ?? ''),
      hint: String(vendorCategoryKey(v) ?? ''),
    })),
    [vendors],
  );

  // Tiles by default; rows for a campaign with a lot of vendors, or for
  // anybody who would rather read a list. Nothing differs but the drawing.
  const [asGrid, setAsGrid] = useState(true);

  const pendingIds = new Set(pending.map((p) => p.id));
  const shown = bookings.filter((b) => !pendingIds.has(b.id));

  // Everything the opened booking's form needs, worked out once. It used to
  // be computed inside the map for all of them, which meant running the
  // contract-readiness check on twenty vendors to draw one form.
  const openCtx = useMemo(() => {
    if (!openId) return null;
    const row = shown.find((b) => b.id === openId);
    const sub = row ? subtaskById.get(row.id) : null;
    if (!row || !sub) return null;
    const vendorId = Number((sub as any).vendor_id);
    const vendor = (vendors as any[]).find((v) => Number(v.id) === vendorId) ?? null;
    const bank = (banks as any[]).find((x) => Number(x.vendor_id) === vendorId) ?? null;
    return {
      row,
      sub,
      lines: adLinesBySubtask.get(row.id) ?? [],
      vendor,
      bank,
      already: !!(sub as any).contract_request_id,
      readiness: vendorContractReadiness(
        sub, vendor, bank, row.price ?? null, task,
        (adLinesBySubtask.get(row.id) ?? []) as any,
      ),
      requirements: vendorDataRequirements(sub, vendor),
      mark: brandMark(row.name),
    };
  }, [openId, shown, subtaskById, vendors, banks, adLinesBySubtask, task]);

  return (
    <Card
      // Amber while any booking is still without a contract, green once
      // every one has been asked for. A card with nothing outstanding
      // should not wear the same colour as one with three.
      bead={TONE[tally.requested >= tally.total && tally.total > 0 ? 'green' : 'amber'].edge}
      id="bookings"
      title="Bookings"
      hint={`${bookings.length} vendor${bookings.length === 1 ? '' : 's'} · ${tally.requested} of ${tally.total} contracts requested`}
      right={
        <>
          {shown.length > 1 && (
            <button
              type="button"
              style={quietButton()}
              aria-pressed={!asGrid}
              onClick={() => setAsGrid((g) => !g)}
            >{asGrid ? 'As a list' : 'As tiles'}</button>
          )}
          {canEdit && (
            <button type="button" style={inkButton(busy)} disabled={busy} onClick={() => setAdding(true)}>
              Add vendors
            </button>
          )}
        </>
      }
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
      {/*
          Tiles, not rows.

          Siraj: *"the whole task page is really bland especially that we are
          a marketing and creative agency"*. The vendors ARE the campaign, and
          they were eight words of grey text each. A tile gives the vendor a
          face — a monogram in their own colour, their price at size, and a pip
          per ad that fills in as each one posts, so how far along a booking is
          reads without being counted.

          The colour is keyed on the VENDOR, through the same brandMark() the
          masthead swatch uses, so Bright Studios is the same green here and
          anywhere else that draws them.

          A campaign with twenty vendors is a lot of tiles, so the header
          carries a toggle back to rows. Nothing is hidden in either — the
          same bookings, drawn two ways.
      */}
      {asGrid ? (
        <div style={{
          display: 'grid', gap: 11,
          gridTemplateColumns: 'repeat(auto-fill, minmax(214px, 1fr))',
        }}>
          {shown.map((b) => (
            <VendorTile
              key={b.id}
              row={b}
              ads={adLinesBySubtask.get(b.id)?.length ?? 0}
              open={openId === b.id}
              canEdit={canEdit}
              selected={selected.has(b.id)}
              onSelect={(on) => setSelected((prev) => {
                const n = new Set(prev);
                if (on) n.add(b.id); else n.delete(b.id);
                return n;
              })}
              onOpen={() => setOpenId(openId === b.id ? null : b.id)}
            />
          ))}
        </div>
      ) : (
        shown.map((b, i) => (
          <VendorRow
            key={b.id}
            row={b}
            ads={adLinesBySubtask.get(b.id)?.length ?? 0}
            first={i === 0}
            open={openId === b.id}
            canEdit={canEdit}
            selected={selected.has(b.id)}
            onSelect={(on) => setSelected((prev) => {
              const n = new Set(prev);
              if (on) n.add(b.id); else n.delete(b.id);
              return n;
            })}
            onOpen={() => setOpenId(openId === b.id ? null : b.id)}
          />
        ))
      )}

      {/* The opened booking, full width under the grid.
          A booking's detail is thirty fields; squeezing it into a 214px
          column would be a worse form than the one we started with. */}
      {openCtx && (
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: '2px solid var(--aq-text)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 11, marginBottom: 4,
          }}>
            <span aria-hidden style={{
              width: 26, height: 26, borderRadius: 8, flex: '0 0 auto',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10.5, fontWeight: 800, color: '#fff',
              background: `linear-gradient(135deg, ${openCtx.mark.from}, ${openCtx.mark.to})`,
            }}>{initials(openCtx.row.name)}</span>
            <strong style={{ fontSize: 14.5 }}>{openCtx.row.name}</strong>
            <Chip label={openCtx.row.contractLabel} tone={toneOf(openCtx.row.contract)} />
            <button
              type="button"
              style={{ ...quietButton(), marginLeft: 'auto' }}
              onClick={() => setOpenId(null)}
            >Close</button>
          </div>
          {(() => {
            const { row: b, sub, lines, vendor, already, readiness, requirements } = openCtx;
            return (
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
              <F k="Client price">
                {b.pricedPerLine ? (
                  <Val calc>{b.price == null ? '—' : money(b.price)} · from the {lines.length} ads below</Val>
                ) : (
                  <Money
                    canEdit={canEdit}
                    value={(sub as any).price ?? ''}
                    placeholder="0.00"
                    onCommit={(v) => saveOn(sub.id, 'price', parseMoney(v), (sub as any).price)}
                  />
                )}
              </F>
              <F k="Vendors cost">
                {b.pricedPerLine && b.net != null ? (
                  <Val calc>{money(b.net)} · added up from the ads</Val>
                ) : (
                  <Money
                    canEdit={canEdit}
                    value={(sub as any).net_amount ?? ''}
                    placeholder="0.00"
                    onCommit={(v) => saveOn(sub.id, 'net_amount', parseMoney(v), (sub as any).net_amount)}
                  />
                )}
              </F>
              <F k="AQ net">
                <Val calc>{
                  b.price != null && b.net != null ? money(b.price - b.net) : '—'
                }</Val>
              </F>
              {/* Three fields the drawer had on a booking and the page
                  did not, so a booking could not be named, assigned or
                  dated without going back to the old panel. */}
              <F k="Name">
                <Text
                  canEdit={canEdit}
                  value={(sub as any).title ?? ''}
                  placeholder="Named after the vendor"
                  onCommit={(v) => saveOn(sub.id, 'title', v || null, (sub as any).title)}
                />
              </F>
              <F k="Assigned to">
                <Pick
                  canEdit={canEdit}
                  value={(sub as any).assignee_id}
                  options={(profiles as any[]).map((p) => ({ v: p.id, l: displayName(p) }))}
                  onChange={(v) => saveOn(sub.id, 'assignee_id', v, (sub as any).assignee_id)}
                />
              </F>
              <F k="Due">
                {canEdit
                  ? <DateField
                      aria-label="Due"
                      value={(sub as any).due_date}
                      onCommit={(v) => saveOn(sub.id, 'due_date', v, (sub as any).due_date)}
                    />
                  : <Val>{(sub as any).due_date ?? '—'}</Val>}
              </F>
              {/* Platform and Ad type follow the same rule as Client price:
                  once the ads below carry them, the ads are the source and
                  these report. One vendor doing a Home Ad on TikTok and a
                  Store Visit on Instagram is one booking, and no single
                  dropdown can say that — so when the lines answer, the
                  answer is a list. */}
              <F k="Platform">
                {b.platformsFromAds ? (
                  <FromAds
                    values={b.platformList}
                    colourise={(p) => platformTone(p)}
                    lines={lines.length}
                  />
                ) : (
                  <Pick
                    canEdit={canEdit}
                    value={(sub as any).platform}
                    options={platformNames.map((p) => ({ v: p, l: p }))}
                    onChange={(v) => saveOn(sub.id, 'platform', v, (sub as any).platform)}
                  />
                )}
              </F>
              <F k="Ad type">
                {b.adTypesFromAds ? (
                  <FromAds
                    values={b.adTypeList.map((a) => labelFor(a))}
                    lines={lines.length}
                  />
                ) : (
                  <Pick
                    canEdit={canEdit}
                    value={(sub as any).ad_type}
                    options={[...AD_TYPES].map((a) => ({ v: String(a), l: labelFor(String(a)) }))}
                    onChange={(v) => saveOn(sub.id, 'ad_type', v, (sub as any).ad_type)}
                  />
                )}
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
              {vendorNeedsInsight(vendorCategoryKey(vendor)) && (
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
              refetch={async () => {
                // Together, not one after the other: neither reads the
                // other's result, and each is a round trip to Frankfurt.
                await Promise.all([refetchAdLines(), onChanged()]);
              }}
              platformOptions={platformNames}
              defaultPlatform={(sub as any).platform ?? (task as any).platform ?? null}
              onTotalChanged={async () => {
                // The write has to land before the reads — they are what
                // shows the new price. After that the two reads are
                // independent, so they go together.
                await syncBookingPriceFromAds(sub.id);
                await Promise.all([refetchAdLines(), onChanged()]);
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
            );
          })()}
        </div>
      )}

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

/* ── One vendor, as a tile ──────────────────────────────────────── */

/**
 * The pips.
 *
 * One per ad, filled as each posts. A number ("2 of 4 posted") is read; a row
 * of pips is seen, and the whole grid can be scanned for the booking that has
 * not started. Above twelve ads they would be slivers, so it falls back to
 * a bar — the same information at a size that still means something.
 */
function Pips({ total, done }: { total: number; done: number }) {
  if (total <= 0) return null;
  const pct = Math.round((Math.min(done, total) / total) * 100);

  if (total > 12) {
    return (
      <span
        aria-label={`${done} of ${total} posted`}
        style={{
          display: 'block', height: 4, borderRadius: 2, marginTop: 9,
          background: 'var(--aq-border)', overflow: 'hidden',
        }}
      >
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: HILITE }} />
      </span>
    );
  }

  return (
    <span aria-label={`${done} of ${total} posted`} style={{ display: 'flex', gap: 3, marginTop: 9 }}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} aria-hidden style={{
          height: 4, flex: 1, borderRadius: 2,
          background: i < done ? HILITE : 'var(--aq-border)',
        }} />
      ))}
    </span>
  );
}

function VendorTile({ row, ads, open, canEdit, selected, onSelect, onOpen }: {
  row: BookingRow;
  ads: number;
  open: boolean;
  canEdit: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOpen: () => void;
}) {
  const mark = brandMark(row.name);
  const tone = TONE[toneOf(row.contract)];

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      border: `1px solid ${open ? 'var(--aq-text)' : 'var(--aq-border-light)'}`,
      boxShadow: open ? '0 0 0 1px var(--aq-text)' : undefined,
      borderRadius: 12, padding: 13, background: 'var(--aq-bg)',
    }}>
      {/* The contract's state as a stripe: the whole grid says which
          bookings are stuck without a word being read. */}
      <span aria-hidden style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: tone.edge,
      }} />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 9 }}>
        <span aria-hidden style={{
          width: 38, height: 38, borderRadius: 11, flex: '0 0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: '#fff',
          background: `linear-gradient(135deg, ${mark.from}, ${mark.to})`,
        }}>{initials(row.name)}</span>
        {canEdit && (
          <input
            type="checkbox"
            aria-label={`Select ${row.name}`}
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            style={{ marginLeft: 'auto' }}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        style={{
          display: 'block', width: '100%', textAlign: 'left', background: 'none',
          border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{
          display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }} title={row.name}>{row.name}</span>
        <Chip label={row.contractLabel} tone={toneOf(row.contract)} />
        <span style={{
          display: 'block', fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em',
          margin: '7px 0 0', fontVariantNumeric: 'tabular-nums',
          color: row.price == null ? 'var(--aq-text-muted)' : undefined,
        }}>{row.price == null ? '—' : money(row.price)}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 3 }}>
          {bookingSubtitle({ ...(row as any), contractNote: '' }, ads)}
        </span>
      </button>

      <Pips total={row.ads} done={row.posted} />
    </div>
  );
}

/* ── The same booking, as a row ─────────────────────────────────── */

function VendorRow({ row, ads, first, open, canEdit, selected, onSelect, onOpen }: {
  row: BookingRow;
  ads: number;
  first: boolean;
  open: boolean;
  canEdit: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onOpen: () => void;
}) {
  const mark = brandMark(row.name);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
      borderTop: first ? 'none' : '1px solid var(--aq-border-light)',
      background: open ? 'var(--aq-bg-sunken)' : undefined,
    }}>
      {canEdit && (
        <input
          type="checkbox"
          aria-label={`Select ${row.name}`}
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
        />
      )}
      <span aria-hidden style={{
        width: 30, height: 30, borderRadius: 9, flex: '0 0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, color: '#fff',
        background: `linear-gradient(135deg, ${mark.from}, ${mark.to})`,
      }}>{initials(row.name)}</span>
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={open}
        style={{
          flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
          border: 'none', padding: 0, font: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5 }}>{row.name}</span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
          fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2,
        }}>
          <Chip label={row.contractLabel} tone={toneOf(row.contract)} />
          {bookingSubtitle({ ...(row as any), contractNote: '' }, ads)}
        </span>
      </button>
      <span style={{ width: 84, flex: '0 0 auto' }}>
        <Pips total={row.ads} done={row.posted} />
      </span>
      <span style={{
        fontSize: 13.5, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        color: row.price == null ? 'var(--aq-text-muted)' : undefined,
      }}>
        {row.price == null ? <Chip label="no price yet" tone="amber" /> : money(row.price)}
      </span>
    </div>
  );
}
