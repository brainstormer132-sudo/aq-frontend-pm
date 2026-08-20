'use client';

import { useState } from 'react';
import {
  createAdLines, updateAdLine, deleteAdLine, syncBookingPriceFromAds,
  AD_TYPE_OPTIONS, type AdLine,
} from '@/hooks/use-workflow';
import {
  totalsOf, lineTotal, lineProblems, adTypeSummary, newLines, lineLabel, hasProof,
  adsMissingProof, AD_LINE_STATUSES, type AdLineSpec,
} from '@/lib/ad-lines';
import { AddAdLinesDialog } from './AddAdLinesDialog';
import { DateField } from './DateField';

/**
 * The ads inside one vendor booking — the third level: campaign, then the
 * vendor booked for it, then each ad that vendor owes.
 *
 * They are ads, not tasks of their own, and that is deliberate. Everything
 * that is true of the booking stays on the booking: one vendor, one price
 * roll-up, ONE contract written from all the lines. What differs per ad —
 * its day, its brief, its status, its proof — lives on the ad. Promoting
 * them to real tasks would have split the contract too.
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
  /** Refresh the booking above — its price is written from these ads. */
  onTotalChanged?: () => Promise<void> | void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const totals = totalsOf(lines);
  const undated = lines.filter((l) => !l.due_date);
  const unproven = adsMissingProof(lines);

  /** Every write moves the booking's price, so every write pushes it up. */
  const syncUp = async () => {
    await syncBookingPriceFromAds(subtaskId);
    await onTotalChanged?.();
  };

  const add = async (spec: AdLineSpec) => {
    setError('');
    try {
      await createAdLines(newLines(subtaskId, lines, spec));
      await refetch();
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
      await refetch();
      if ('unit_price' in fields) await syncUp();
    }
    catch (e: any) { setError(e?.message ?? String(e)); }
    finally { setBusy(null); }
  };

  const remove = async (line: AdLine) => {
    if (!line.id) return;
    setBusy(line.id); setError('');
    try { await deleteAdLine(line.id); setOpenId(null); await refetch(); await syncUp(); }
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

      {/* ── The roll-up, above the list ──────────────────────────────
          This is the number that goes on the contract and into the
          campaign's money. It is computed from the ads below and cannot be
          typed, so it cannot disagree with them. */}
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
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>Loading…</p>
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
        {/* One price box, not a unit price plus a total. Two boxes for one
            number is two ways to be wrong, and the wrong one goes into a
            contract. Zero is legal and is labelled below, not blanked. */}
        <Cell label="Price (SAR)" width={140}>
          <NumberCell
            value={Number(line.unit_price)} min={0} step="0.01" disabled={!canEdit}
            onCommit={(v) => onPatch({ unit_price: v })}
          />
        </Cell>
        {Number(line.unit_price) === 0 && (
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', padding: '7px 0' }}>
            No charge — it still goes in the contract.
          </div>
        )}
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
  value, onCommit, disabled, placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
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

function NumberCell({
  value, onCommit, disabled, min, step,
}: {
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  min?: number;
  step?: string;
}) {
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
