'use client';

import React, { useEffect, useState } from 'react';
import type { Track } from '@/lib/campaign-page';


/**
 * The two-bead track: asked on the left, answered on the right.
 *
 * The rail between them is the waiting. It is drawn solid once the answer
 * arrives and hollow while it has not, so a row that is still waiting is
 * visibly unfinished from across the room — but the state is also written in
 * the pill and both dates are in words, because a hollow line is not something
 * a screen reader can read out.
 */
export function TrackRow({ name, track, sub, detail, actions }: {
  name: string;
  track: Track;
  sub?: string;
  detail?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const tone = TONES[track.state];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 14,
      alignItems: 'center', padding: '13px 0', borderTop: '1px solid var(--aq-border-light)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{name}</span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2.5px 9px', borderRadius: 999,
            background: tone.bg, color: tone.fg, whiteSpace: 'nowrap',
          }}>{track.badge}</span>
          {sub && <span style={{ fontSize: 12.5, color: 'var(--aq-text-muted)' }}>{sub}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginTop: 7 }}>
          <Node label={track.askedLabel} on={track.state !== 'none' && track.state !== 'blocked'} tone={tone} />
          {track.answeredLabel && (
            <>
              <span aria-hidden style={{
                flex: 1, height: 1, minWidth: 22, margin: '0 9px',
                background: track.state === 'done' ? 'var(--aq-accent)' : 'var(--aq-border)',
              }} />
              <Node label={track.answeredLabel} on={track.state === 'done'} tone={tone} />
            </>
          )}
        </div>

        {detail && <div style={{ marginTop: 6 }}>{detail}</div>}
      </div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>{actions}</div>
    </div>
  );
}

const TONES: Record<string, { bg: string; fg: string; bead: string }> = {
  none:    { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-muted)', bead: 'var(--aq-border)' },
  waiting: { bg: '#fef3c7', fg: '#78350f', bead: '#b45309' },
  done:    { bg: 'var(--aq-accent-light)', fg: '#14603a', bead: 'var(--aq-accent)' },
  blocked: { bg: '#fee2e2', fg: '#991b1b', bead: '#b91c1c' },
};

function Node({ label, on, tone }: { label: string; on: boolean; tone: { bead: string } }) {
  return (
    <span style={{
      display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5,
      color: 'var(--aq-text-muted)', whiteSpace: 'nowrap',
    }}>
      <span aria-hidden style={{
        width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto',
        background: on ? tone.bead : 'var(--aq-border)',
      }} />
      {label}
    </span>
  );
}

/**
 * How long the contract runs — a number and a unit, never a free-text box.
 *
 * "2 weeks" typed by one person and "two weeks" by another cannot be compared,
 * sorted, or added to a date. Both halves commit together, because a number
 * with no unit is not a duration and the database refuses the pair (066).
 */
export function LengthField({ n, unit, canEdit, onCommit }: {
  n: number | null | undefined;
  unit: string | null | undefined;
  canEdit: boolean;
  onCommit: (n: number | null, unit: string | null) => void;
}) {
  const [num, setNum] = useState(n == null ? '' : String(n));
  useEffect(() => { setNum(n == null ? '' : String(n)); }, [n]);

  if (!canEdit) return null;

  const commit = (raw: string) => {
    const parsed = Number(raw.trim());
    // Clearing the box clears both halves. A stray unit with no number would
    // fail the pair check in 066 rather than saving quietly.
    if (!raw.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      if (n != null) onCommit(null, null);
      return;
    }
    const days = Math.round(parsed);
    if (days === n && unit === 'days') return;
    onCommit(days, 'days');
  };

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        className="aq-input"
        aria-label="Contract length in days"
        inputMode="numeric"
        placeholder="—"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        onBlur={() => commit(num)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 58, fontSize: 12.5, textAlign: 'right', padding: '5px 8px' }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>days</span>
    </span>
  );
}

// Three kinds of contract, not four ways of describing one. Siraj: *"no
// 50/50 is one contract type / prepay / and afterpay"*.
//
// 50/50 carries no percentage box any more — it is the type, and the type is
// half and half. The database column still holds the 50 (067 constrains the
// pair), so nothing downstream has to special-case it.
const TERMS = [
  { v: 'split', l: '50/50' },
  { v: 'in_advance', l: 'Prepay' },
  { v: 'net_days', l: 'Afterpay' },
];

/**
 * When the vendor gets paid.
 *
 * Siraj: *"contracts for vendors are usually 50/50 pre or after after we input
 * a date for example 30-90 days."* The terms only ever existed as prose inside
 * the generated .docx, so the app could show a signed contract without being
 * able to say what had been agreed or when the second half fell due.
 *
 * The second control changes meaning with the first — a percentage for a
 * split, a number of days for net terms — rather than showing both greyed out.
 */
export function TermsField({ terms, splitPct, netDays, canEdit, onCommit }: {
  terms: string | null | undefined;
  splitPct: number | null | undefined;
  netDays: number | null | undefined;
  canEdit: boolean;
  onCommit: (fields: {
    payment_terms: string | null;
    payment_split_pct: number | null;
    payment_net_days: number | null;
  }) => void;
}) {
  const t = terms ?? '';
  if (!canEdit) {
    return <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{termsLabel(t, splitPct, netDays)}</span>;
  }

  const set = (next: string) => {
    // Switching terms clears the number that belonged to the old one — the
    // pair check in 067 refuses a split percentage on net-days terms, and
    // leaving it behind would show "60 days" on a 50/50 contract.
    onCommit({
      payment_terms: next || null,
      // Always 50: it is what the type means, not something to be typed.
      payment_split_pct: next === 'split' ? 50 : null,
      payment_net_days: next === 'net_days' ? (netDays ?? 30) : null,
    });
  };

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <select
        className="aq-select"
        aria-label="When the vendor is paid"
        value={t}
        onChange={(e) => set(e.target.value)}
        style={{ fontSize: 12.5, padding: '5px 6px', width: 168 }}
      >
        <option value="">— terms not set —</option>
        {TERMS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>

      {t === 'net_days' && (
        <SmallNumber
          label="Days after delivery"
          value={netDays ?? 30}
          suffix="days after delivery"
          min={1}
          max={365}
          onCommit={(n) => onCommit({
            payment_terms: 'net_days', payment_split_pct: null, payment_net_days: n,
          })}
        />
      )}
    </span>
  );
}

/** "50/50", "Afterpay — 60 days" — what was agreed, in words. */
export function termsLabel(
  terms: string | null | undefined,
  splitPct: number | null | undefined,
  netDays: number | null | undefined,
): string {
  switch (terms) {
    case 'split': {
      // An older row may carry something other than 50. It is no longer
      // possible to enter, but it is what was agreed, so it is what is shown.
      const up = Number(splitPct ?? 50);
      return up === 50 ? '50/50' : `${up}/${100 - up} — ${up}% up front`;
    }
    case 'in_advance': return 'Prepay';
    case 'net_days': return `Afterpay — ${netDays ?? 30} days after delivery`;
    // Retired from the picker; still readable on the rows that carry it.
    case 'on_delivery': return 'Afterpay — on delivery';
    default: return 'Terms not set';
  }
}

function SmallNumber({ label, value, suffix, min, max, onCommit }: {
  label: string; value: number; suffix: string; min: number; max: number;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <input
        className="aq-input"
        aria-label={label}
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(draft.trim()));
          // Out of range goes back rather than through: the database would
          // refuse it and the row would silently roll back anyway.
          if (!Number.isFinite(n) || n < min || n > max) { setDraft(String(value)); return; }
          if (n !== value) onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 54, fontSize: 12.5, textAlign: 'right', padding: '5px 8px' }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{suffix}</span>
    </span>
  );
}
