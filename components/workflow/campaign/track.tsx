'use client';

import React, { useEffect, useState } from 'react';
import type { Track } from '@/lib/campaign-page';

const UNITS = ['days', 'weeks', 'months'] as const;

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
  const [u, setU] = useState(unit ?? 'months');

  useEffect(() => { setNum(n == null ? '' : String(n)); }, [n]);
  useEffect(() => { setU(unit ?? 'months'); }, [unit]);

  if (!canEdit) return null;

  const commit = (rawNum: string, rawUnit: string) => {
    const parsed = Number(rawNum.trim());
    // Clearing the box clears both halves. A stray unit with no number would
    // fail the check constraint rather than saving quietly.
    if (!rawNum.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      if (n != null) onCommit(null, null);
      return;
    }
    if (parsed === n && rawUnit === unit) return;
    onCommit(Math.round(parsed), rawUnit);
  };

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        className="aq-input"
        aria-label="Contract length"
        inputMode="numeric"
        placeholder="—"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        onBlur={() => commit(num, u)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{ width: 58, fontSize: 12.5, textAlign: 'right', padding: '5px 8px' }}
      />
      <select
        className="aq-select"
        aria-label="Contract length unit"
        value={u}
        onChange={(e) => { setU(e.target.value); commit(num, e.target.value); }}
        style={{ fontSize: 12.5, padding: '5px 6px', width: 88 }}
      >
        {UNITS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </span>
  );
}
