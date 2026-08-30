'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createAdLines, updateAdLine, deleteAdLine, syncBookingPriceFromAds,
  AD_TYPE_OPTIONS, type AdLine,
} from '@/hooks/use-workflow';
import {
  totalsOf, lineTotal, lineProblems, adTypeSummary, newLines, lineLabel, hasProof,
  adsMissingProof, AD_LINE_STATUSES, type AdLineSpec,
} from '@/lib/ad-lines';
import { AddAdLinesDialog } from './AddAdLinesDialog';
import { groupDigits, caretAfterGrouping } from '@/lib/campaign-page';
import { DateField } from './DateField';
import { SkeletonRows } from '@/components/Skeleton';

/**
 * The ads inside one vendor booking — the third level: campaign, then the
 * vendor booked for it, then each ad that vendor owes.
 *
 * They are ads, not tasks of their own, and that is deliberate. Everything
 * that is true of the booking stays on the booking: one vendor, one price of
 * its own, ONE contract written from all the lines. What differs per ad —
 * its day, its brief, its status, its price, its proof — lives on the ad.
 * Promoting them to real tasks would have split the contract too.
 *
 * The list only shows things. Editing happens inside one ad at a time,
 * opened by clicking it, because a grid of forty live inputs is where you
 * change the wrong row without noticing.
 *
 * Zero is a legal price and the card says so out loud. The instinct on
 * seeing "SAR 0" is to treat it as unfinished, and a free reminder that
 * gets "fixed" or deleted is work that ends up delivered but not contracted.
 */
export function AdLinesCard({
  subtaskId, canEdit, lines, loading, refetch, platformOptions, defaultPlatform,
  onTotalChanged,
}: {
  subtaskId: string;
  canEdit: boolean;
  lines: AdLine[];
  loading: boolean;
  refetch: () => Promise<void> | void;
  platformOptions: string[];
  defaultPlatform?: string | null;
  /** Refresh the booking above — its Price is filled in from these ads. */
  onTotalChanged?: () => Promise<void> | void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const totals = totalsOf(lines);
  const undated = lines.filter((l) => !l.due_date);
  const unproven = adsMissingProof(lines);

  /**
   * Anything that moves the money re-fills the booking's Price.
   *
   * `onTotalChanged` owns the whole sequence — the write, then the
   * refetches. It used to be called AFTER a `syncBookingPriceFromAds` here
   * as well, and the parent then did its own, so every ad line edit wrote
   * the same price twice and refetched everything twice: about eleven
   * sequential round trips to add one line. At Frankfurt latency that is
   * over a second of waiting for work already done.
   *
   * `refetch` is not called alongside this either — `onTotalChanged`
   * refetches the lines itself, and doing both made a third duplicate pair.
   */
  const syncUp = async () => { await onTotalChanged?.(); };

  const add = async (spec: AdLineSpec) => {
    setError('');
    try {
      await createAdLines(newLines(subtaskId, lines, spec));
      await syncUp();
      setAdding(false);
    } catch (e: any) { setError(e?.message ?? String(e)); throw e; }
  };

  const patch = async (line: AdLine, fields: Partial<AdLine>) => {
    if (!line.id) return;
    const problems = lineProblems({ ...line, ...fields });
    if (problems.length) { setError(problems[0]); return; }
    setBusy(line.id); setError('');
    try {
      await updateAdLine(line.id, fields);
      // Quantity moves the money too, now that it multiplies the price.
      // When it does, syncUp refetches; when it doesn't, refetch alone is
      // the whole job. Never both — that was two round trips for one edit.
      if ('unit_price' in fields || 'quantity' in fields) await syncUp();
      else await refetch();
    }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (line: AdLine) => {
    if (!line.id) return;
    setBusy(line.id); setError('');
    try { await deleteAdLine(line.id); setOpenId(null); await syncUp(); }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  return (
    <section className="aq-card" style={{ padding: 18, marginTop: 14 }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700 }}>Ads in this booking</h3>
          <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
            One contract covers all of them. Click one to set its date, brief and proof.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={() => setAdding(true)}
            style={{ fontSize: 12.5, padding: '5px 12px', whiteSpace: 'nowrap' }}
          >Add lines</button>
        )}
      </header>

      {/* ── What the ads add up to ───────────────────────────────────
          Written up into the booking's Price whenever it changes — and the
          field up there stays typeable, so a number that was agreed
          differently can still be entered by hand. */}
      {lines.length > 0 && (
        <div style={{
          padding: '10px 14px', marginBottom: 12,
          borderRadius: 'var(--aq-radius)',
          background: 'var(--aq-bg-sunken)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--aq-text-secondary)' }}>
              <strong>{totals.ads} ad{totals.ads === 1 ? '' : 's'}</strong>
              {lines.length !== totals.ads && ` across ${lines.length} lines`}
              {totals.freeLines > 0 && ` · ${totals.freeLines} free`}
            </span>
            <strong style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>
              SAR {Math.round(totals.amount).toLocaleString('en-US')}
            </strong>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--aq-text-muted)', marginTop: 5 }}>
            The contract will read: {adTypeSummary(lines)}
          </p>
        </div>
      )}

      {error && <p style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 8 }}>{error}</p>}

      {loading ? (
        // An empty booking and one that has not loaded yet used to look the
        // same, and the empty one says "no ads yet" — which people acted on.
        <SkeletonRows rows={3} height={44} gap={0} label="Loading ads" />
      ) : lines.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
          No ads yet. Without them the contract is written from the single price on
          this booking, which is right for a one-off and wrong for a package.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {lines.map((l, i) => {
            const open = openId === l.id;
            const total = lineTotal(l);
            return (
              <div key={l.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--aq-border-light)' }}>
                {/* The row: shows, does not edit. */}
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : (l.id ?? null))}
                  aria-expanded={open}
                  style={{
                    width: '100%', textAlign: 'left', background: 'none', border: 'none',
                    padding: '9px 4px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    opacity: busy === l.id ? 0.6 : 1,
                  }}
                >
                  <span style={{
                    fontSize: 11, color: 'var(--aq-text-muted)', width: 26,
                    flexShrink: 0, fontVariantNumeric: 'tabular-nums',
                  }}>
                    {open ? '▾' : '▸'} {i + 1}
                  </span>

                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 600, display: 'block',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{lineLabel(l)}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>
                      {[
                        l.platform,
                        l.due_date || 'no due date',
                        l.status ?? 'Not started',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>

                  {/* Status-only colour: a missing proof is a state, not a series. */}
                  {!hasProof(l) && (l.status ?? '') !== 'Cancelled' && (
                    <span style={{
                      fontSize: 10.5, padding: '2px 7px', borderRadius: 99,
                      background: '#fef2f2', color: '#b91c1c', whiteSpace: 'nowrap', flexShrink: 0,
                    }}>no proof</span>
                  )}

                  <span style={{
                    fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
                    color: total === 0 ? 'var(--aq-text-muted)' : 'var(--aq-text)',
                    whiteSpace: 'nowrap', flexShrink: 0,
                  }}>
                    {total === 0 ? 'no charge' : Math.round(total).toLocaleString('en-US')}
                  </span>
                </button>

                {open && (
                  <AdDetail
                    line={l}
                    canEdit={canEdit}
                    busy={busy === l.id}
                    platformOptions={platformOptions}
                    defaultPlatform={defaultPlatform}
                    onPatch={(f) => patch(l, f)}
                    onRemove={() => remove(l)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {undated.length > 0 && (
        <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 10 }}>
          {undated.length} ad{undated.length === 1 ? '' : 's'} with no due date —
          they stay off the calendar and out of the contract&apos;s schedule until they have one.
        </p>
      )}
      {unproven.length > 0 && lines.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 4 }}>
          {unproven.length} of {lines.length} still without proof of posting.
        </p>
      )}

      {adding && (
        <AddAdLinesDialog
          platformOptions={platformOptions}
          defaultPlatform={defaultPlatform}
          onCancel={() => setAdding(false)}
          onAdd={add}
        />
      )}
    </section>
  );
}

/**
 * One ad, opened. This is its detail view — the same fields a booking has,
 * asked about the single piece of work rather than the whole package.
 */
/** The same words the campaign uses for the client's side, so one term does
 *  not mean two things depending on which row you are reading. */
const AD_PAYMENT_STATES = [
  { v: 'unpaid', l: 'Unpaid' },
  { v: 'partial', l: 'Partial payment' },
  { v: 'paid', l: 'Paid' },
  { v: 'no_payment', l: 'No payment due' },
  { v: 'refund', l: 'Refunded' },
  { v: 'credit', l: 'Credit note' },
  { v: 'adjustment', l: 'Adjustment' },
];

function AdDetail({
  line, canEdit, busy, platformOptions, defaultPlatform, onPatch, onRemove,
}: {
  line: AdLine;
  canEdit: boolean;
  busy: boolean;
  platformOptions: string[];
  defaultPlatform?: string | null;
  onPatch: (fields: Partial<AdLine>) => void;
  onRemove: () => void;
}) {
  const platforms = [
    ...(defaultPlatform && !platformOptions.includes(defaultPlatform) ? [defaultPlatform] : []),
    ...platformOptions,
    ...(line.platform && !platformOptions.includes(line.platform) && line.platform !== defaultPlatform
      ? [line.platform] : []),
  ];

  return (
    <div style={{
      padding: '4px 4px 14px 40px',
      display: 'flex', flexDirection: 'column', gap: 9,
      opacity: busy ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        <Cell label="Ad type" width={170}>
          <select
            className="aq-select" disabled={!canEdit}
            value={line.ad_type ?? ''}
            onChange={(e) => onPatch({ ad_type: e.target.value })}
          >
            {/* An ad type saved before the dropdown existed must still be
                selectable, or opening the ad would silently change it. */}
            {line.ad_type && !AD_TYPE_OPTIONS.includes(line.ad_type as any) && (
              <option value={line.ad_type}>{line.ad_type}</option>
            )}
            {AD_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Cell>

        <Cell label="Platform" width={150}>
          <select
            className="aq-select" disabled={!canEdit}
            value={line.platform ?? ''}
            onChange={(e) => onPatch({ platform: e.target.value || null })}
          >
            <option value="">— none —</option>
            {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Cell>

        <Cell label="Due date" width={150}>
          <DateField
            value={line.due_date}
            disabled={!canEdit}
            aria-label="Ad due date"
            onCommit={(v) => onPatch({ due_date: v })}
          />
        </Cell>

        <Cell label="Status" width={140}>
          <select
            className="aq-select" disabled={!canEdit}
            value={line.status ?? 'Not started'}
            onChange={(e) => onPatch({ status: e.target.value })}
          >
            {AD_LINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Cell>
      </div>

      <Cell label="Brief">
        <TextCell
          value={line.description ?? ''}
          disabled={!canEdit}
          placeholder="what this one is — which branch, which product"
          onCommit={(v) => onPatch({ description: v || null })}
        />
      </Cell>

      <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
        <Cell label="Quantity" width={90}>
          <NumberCell
            value={line.quantity} min={1} disabled={!canEdit}
            onCommit={(v) => onPatch({ quantity: v })}
          />
        </Cell>
        {/* The per-ad rate, and what the line comes to. It was briefly one
            flat price for the whole line; a line of 4 at 5,000.66 then read
            as 5,000 for all four, so the multiplication is back and is shown
            rather than left to be worked out. "each" is in the label because
            without it the two numbers look like the same number twice. */}
        <Cell label="Price each (SAR)" width={140}>
          <NumberCell
            money
            value={Number(line.unit_price)} min={0} step="0.01" disabled={!canEdit}
            onCommit={(v) => onPatch({ unit_price: v })}
          />
        </Cell>
        <Cell label="Line total" width={150}>
          <div style={{ padding: '7px 0', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {lineTotal(line) === 0
              ? <span style={{ color: 'var(--aq-text-muted)', fontWeight: 400 }}>
                  no charge — still in the contract
                </span>
              : <>
                  {Number(line.quantity) > 1 && (
                    <span style={{ color: 'var(--aq-text-muted)', fontWeight: 400 }}>
                      {line.quantity} × {Number(line.unit_price).toLocaleString('en-US')} ={' '}
                    </span>
                  )}
                  {lineTotal(line).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </>}
          </div>
        </Cell>
      </div>

      {/* ── Proof, for this ad ────────────────────────────────────────
          It moved down here (058) because an influencer booked for twelve
          pieces posts twelve times. One link on the booking said "some of
          it happened" and nothing about which. */}
      <div style={{ paddingTop: 9, borderTop: '1px dashed var(--aq-border-light)' }}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Cell label="Proof of posting" width={260}>
            <TextCell
              value={line.proof_of_posting_link ?? ''}
              disabled={!canEdit}
              placeholder="https://…"
              onCommit={(v) => onPatch({ proof_of_posting_link: v || null })}
            />
          </Cell>
          <Cell label="Posted on" width={150}>
            <DateField
              value={line.posted_on}
              disabled={!canEdit}
              aria-label="Date this ad was posted"
              onCommit={(v) => onPatch({ posted_on: v })}
            />
          </Cell>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '7px 0' }}>
            <input
              type="checkbox"
              checked={Boolean(line.proof_of_posting_attached)}
              disabled={!canEdit}
              onChange={(e) => onPatch({ proof_of_posting_attached: e.target.checked })}
              style={{ width: 15, height: 15 }}
            />
            File attached
          </label>
        </div>
      </div>

      {/* ── What this one ad is worth ────────────────────────────────
          Siraj asked for a quotation, a net, a payment date and a status
          per line. They were only ever on the booking, so ten ads under one
          vendor shared one number and one payment state — and a booking
          half-paid across two months could not be described at all. */}
      <div style={{ paddingTop: 9, borderTop: '1px dashed var(--aq-border-light)' }}>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Cell label="Quotation #" width={170}>
            <TextCell
              value={line.quotation_no ?? ''}
              disabled={!canEdit}
              placeholder="QT-…"
              onCommit={(v) => onPatch({ quotation_no: v || null } as any)}
            />
          </Cell>
          <Cell label="Net on this ad" width={140}>
            <TextCell
              money
              value={line.net_amount == null ? '' : String(line.net_amount)}
              disabled={!canEdit}
              placeholder="0.00"
              onCommit={(v) => {
                // Blank clears it. A cleared net is "not worked out", which
                // is a different claim from zero — zero says we made nothing.
                const t = v.trim();
                if (!t) { onPatch({ net_amount: null } as any); return; }
                const n = Number(t.replace(/[, ]/g, ''));
                if (Number.isFinite(n) && n >= 0) onPatch({ net_amount: n } as any);
              }}
            />
          </Cell>
          <Cell label="Net paid on" width={150}>
            <DateField
              value={line.net_payment_date ?? null}
              disabled={!canEdit}
              aria-label="Date the net on this ad was paid"
              onCommit={(v) => onPatch({ net_payment_date: v } as any)}
            />
          </Cell>
          <Cell label="Net payment" width={160}>
            <select
              className="aq-select"
              aria-label="Net payment status for this ad"
              value={line.net_payment_status ?? ''}
              disabled={!canEdit}
              onChange={(e) => onPatch({ net_payment_status: e.target.value || null } as any)}
              style={{ width: '100%', fontSize: 12.5 }}
            >
              <option value="">— not set —</option>
              {AD_PAYMENT_STATES.map((o) => (
                <option key={o.v} value={o.v}>{o.l}</option>
              ))}
            </select>
          </Cell>
        </div>
      </div>

      {canEdit && (
        <div>
          <button
            type="button"
            className="aq-btn aq-btn-secondary"
            onClick={onRemove}
            disabled={busy}
            style={{ fontSize: 12, padding: '3px 9px' }}
          >Remove this ad</button>
        </div>
      )}
    </div>
  );
}

function Cell({ label, width, children }: { label: string; width?: number; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', width: width ?? '100%', maxWidth: '100%' }}>
      <span className="aq-label" style={{ display: 'block', marginBottom: 3 }}>{label}</span>
      {children}
    </label>
  );
}

/** Text that saves on blur or Enter — never per keystroke. */
function TextCell({
  value, onCommit, disabled, placeholder, money,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Group the thousands as it is typed. */
  money?: boolean;
}) {
  // A money cell formats as it is typed; everything else is a plain box.
  const [draft, setDraft] = useState(money ? groupDigits(value) : value);
  const box = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  useEffect(() => { if (money) setDraft(groupDigits(value)); }, [value, money]);
  useEffect(() => {
    if (caret.current == null || !box.current) return;
    box.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  if (!money) {
    return (
      <input
        className="aq-input"
        defaultValue={value}
        disabled={disabled}
        placeholder={placeholder}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== value.trim()) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    );
  }

  return (
    <input
      ref={box}
      className="aq-input"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      style={{ fontVariantNumeric: 'tabular-nums' }}
      onChange={(e) => {
        const raw = e.target.value;
        const next = groupDigits(raw);
        caret.current = caretAfterGrouping(raw, e.target.selectionStart ?? raw.length, next);
        setDraft(next);
      }}
      onBlur={() => { if (draft.trim() !== groupDigits(value)) onCommit(draft.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function NumberCell({
  value, onCommit, disabled, min, step, money,
}: {
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  min?: number;
  step?: string;
  /** Group the thousands while typing. A price, not a count. */
  money?: boolean;
}) {
  // A native number input cannot show separators — the browser owns the
  // rendering — so a money cell is a text box that formats itself instead.
  const [draft, setDraft] = useState(money ? groupDigits(String(value ?? '')) : '');
  const box = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  useEffect(() => {
    if (money) setDraft(groupDigits(String(value ?? '')));
  }, [value, money]);

  useEffect(() => {
    if (caret.current == null || !box.current) return;
    box.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  if (!money) {
    return (
      <input
        className="aq-input"
        type="number"
        min={min}
        step={step}
        defaultValue={value}
        disabled={disabled}
        style={{ textAlign: 'right' }}
        onBlur={(e) => { const v = Number(e.target.value); if (v !== value) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    );
  }

  return (
    <input
      ref={box}
      className="aq-input"
      inputMode="decimal"
      value={draft}
      disabled={disabled}
      style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      onChange={(e) => {
        const raw = e.target.value;
        const next = groupDigits(raw);
        caret.current = caretAfterGrouping(raw, e.target.selectionStart ?? raw.length, next);
        setDraft(next);
      }}
      onBlur={() => {
        const n = Number(draft.replace(/,/g, ''));
        if (!Number.isFinite(n) || n < 0) { setDraft(groupDigits(String(value ?? ''))); return; }
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}
