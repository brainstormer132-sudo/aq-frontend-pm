'use client';

import { useState } from 'react';
import {
  money$, gapLine, sortHint,
  type Column, type PortalState, type RegistryRow, type Sort,
} from '@/lib/registry';

/**
 * The register, shared by Clients and Vendors.
 *
 * Both screens were a search box, an Add button and a wall of cards at
 * `minmax(320px, 1fr)`. With 23 clients and 61 vendors that is eighty-odd
 * cards, each printing four fields nobody asked for — and on the vendor
 * side, sixty-one IBANs at once. Neither could be sorted or filtered by
 * anything except free text.
 *
 * Siraj picked the register (Aug 2026), so this is the same table as All
 * Tasks and Contracts. Three screens behaving identically is one thing to
 * learn.
 *
 * The **Add** button is the app's ink rather than the accent green, at
 * Siraj's request — and it turns out to be the right call for a reason
 * beyond taste: green already means *portal active* in the pills two
 * columns over, and a green button beside green pills makes the colour stop
 * meaning anything.
 */

export const INK = 'var(--aq-text)';

/* ── Header ─────────────────────────────────────────────────────── */

export function RegistryHeader({
  title, line, children,
}: {
  title: string;
  line: string;
  children?: React.ReactNode;
}) {
  return (
    <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700 }}>{title}</h2>
      <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>{line}</span>
      {children && (
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {children}
        </span>
      )}
    </header>
  );
}

/* ── Toolbar ────────────────────────────────────────────────────── */

export function RegistryToolbar({
  query, onQuery, placeholder, children,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="aq-card">
      <div style={{ padding: '12px 14px 0' }}>
        <input
          className="aq-input"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        flexWrap: 'wrap', padding: '12px 14px',
      }}>
        {children}
      </div>
    </div>
  );
}

export function Chip({
  label, count, on, onClick, danger,
}: {
  label: string;
  count?: number;
  on: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        font: 'inherit', fontSize: 12, fontWeight: on ? 600 : 500,
        padding: '5px 11px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1px solid ${on ? INK : 'var(--aq-border-light)'}`,
        background: on ? INK : 'var(--aq-bg-elevated)',
        color: on ? '#fff' : 'var(--aq-text-secondary)',
      }}
    >
      {label}
      {count != null && count > 0 && (
        <span style={{
          marginLeft: 5, opacity: on ? 0.75 : 0.6,
          fontVariantNumeric: 'tabular-nums',
          // A count worth acting on is worth reading. Red only where the
          // number IS the problem, and never as the only signal — the label
          // beside it already says what it is.
          color: danger && !on ? '#b91c1c' : undefined,
          fontWeight: danger && !on ? 700 : undefined,
        }}>{count}</span>
      )}
    </button>
  );
}

/** The primary action. Ink, not accent — see the note at the top. */
export function AddButton({
  label, onClick, disabled, title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        font: 'inherit', fontSize: 13, fontWeight: 600,
        padding: '7px 14px', borderRadius: 'var(--aq-radius)',
        border: `1px solid ${INK}`, background: INK, color: '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1, whiteSpace: 'nowrap',
      }}
    >{label}</button>
  );
}

/* ── Confirm ────────────────────────────────────────────────────── */

/**
 * The question neither screen asked.
 *
 * `clientOps.remove` and `vendorOps.remove` both fired straight from a
 * button. So did the Zoho reset, which deletes every client in the
 * workspace — and it was a modifier key on the ordinary Import button,
 * documented only in that button's `title`.
 */
export function Confirm({
  text, confirmLabel, busy, onConfirm, onCancel,
}: {
  text: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label="Confirm" style={{
      padding: '12px 14px', borderRadius: 'var(--aq-radius)',
      background: '#fee2e2', border: '1px solid #fecaca',
    }}>
      <p style={{ fontSize: 12.5, color: '#991b1b', margin: 0, lineHeight: 1.5 }}>{text}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="aq-btn"
          onClick={onConfirm}
          disabled={busy}
          style={{ background: '#b91c1c', color: '#fff', border: 'none', fontSize: 12.5 }}
        >{busy ? 'Working…' : confirmLabel}</button>
        <button
          type="button"
          className="aq-btn aq-btn-secondary"
          onClick={onCancel}
          disabled={busy}
          style={{ fontSize: 12.5 }}
        >Cancel</button>
      </div>
    </div>
  );
}

/* ── The table ──────────────────────────────────────────────────── */

const PORTAL_STYLE: Record<PortalState, { bg: string; fg: string }> = {
  active:  { bg: 'var(--aq-accent-light)', fg: '#14603a' },
  invited: { bg: '#e0e7ff', fg: '#3730a3' },
  none:    { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-muted)' },
};

export function RegistryTable({
  rows, columns, sort, onSort, expandedId, onToggle, renderDetail, showValue = true,
}: {
  rows: RegistryRow[];
  columns: Column[];
  sort: Sort;
  onSort: (k: Column['key']) => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
  renderDetail: (row: RegistryRow) => React.ReactNode;
  showValue?: boolean;
}) {
  return (
    <div className="aq-card" style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 820,
      }}>
        <thead>
          <tr>
            {columns.map((c) => {
              const on = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  style={{
                    textAlign: c.align, padding: 0,
                    borderBottom: '1px solid var(--aq-border)',
                    position: 'sticky', top: 0, zIndex: 1,
                    background: 'var(--aq-bg-elevated)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSort(c.key)}
                    title={sortHint(c, sort)}
                    style={{
                      display: 'flex', gap: 4, width: '100%',
                      justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start',
                      padding: '9px 12px', border: 'none', background: 'none',
                      font: 'inherit', fontSize: 10, fontWeight: 700,
                      letterSpacing: '.07em', textTransform: 'uppercase',
                      color: on ? 'var(--aq-text)' : 'var(--aq-text-muted)',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    {c.label}
                    <span aria-hidden style={{ fontSize: 8, opacity: on ? 1 : 0 }}>
                      {on && sort.dir === 'desc' ? '▼' : '▲'}
                    </span>
                  </button>
                </th>
              );
            })}
            <th style={{
              padding: '9px 12px', borderBottom: '1px solid var(--aq-border)',
              position: 'sticky', top: 0, zIndex: 1, background: 'var(--aq-bg-elevated)',
              width: 1,
            }}><span style={SR_ONLY}>Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = expandedId === r.id;
            const p = PORTAL_STYLE[r.portal];
            return (
              <Fragmentish key={r.id}>
                <tr
                  onClick={() => onToggle(r.id)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(r.id); }
                  }}
                  className="aq-tr"
                  style={{ cursor: 'pointer' }}
                >
                  <Td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* A missing contract field is a dot AND a sentence
                          under the name — never colour on its own. */}
                      <span aria-hidden style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: r.gaps.length ? '#b91c1c' : 'transparent',
                      }} />
                      <span>
                        <span style={{ fontWeight: 600 }}>{r.name}</span>
                        {r.gaps.length > 0 && (
                          <span style={{
                            display: 'block', fontSize: 11, color: '#a16207',
                            fontWeight: 600, marginTop: 2, whiteSpace: 'normal', maxWidth: 300,
                          }}>{gapLine(r.gaps)}</span>
                        )}
                      </span>
                    </span>
                  </Td>
                  <Td muted={!r.who} italic={!r.who}>{r.who ?? 'not set'}</Td>
                  <Td muted={!r.ident} italic={!r.ident}>{r.ident ?? 'not set'}</Td>
                  <Td>
                    <span style={{
                      display: 'inline-block', fontSize: 10.5, fontWeight: 700,
                      padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                      background: p.bg, color: p.fg,
                    }}>{r.portalLabel}</span>
                  </Td>
                  <Td align="right">
                    <span style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: r.count === 0 ? '#b91c1c' : 'var(--aq-text)',
                      fontWeight: r.count === 0 ? 700 : 400,
                    }}>{r.count}</span>
                  </Td>
                  {showValue && (
                    <Td align="right" muted={r.value == null}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money$(r.value)}</span>
                    </Td>
                  )}
                  <Td align="right">
                    <span aria-hidden style={{ color: 'var(--aq-text-muted)', fontSize: 10 }}>
                      {open ? '▴' : '▾'}
                    </span>
                  </Td>
                </tr>
                {open && (
                  <tr>
                    <td
                      colSpan={columns.length + 1}
                      style={{
                        padding: '14px 16px',
                        background: 'var(--aq-bg-sunken)',
                        borderBottom: '1px solid var(--aq-border-light)',
                      }}
                    >{renderDetail(r)}</td>
                  </tr>
                )}
              </Fragmentish>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A keyed fragment, so a row and its detail are one child. */
function Fragmentish({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Td({
  children, align = 'left', muted, italic,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  italic?: boolean;
}) {
  return (
    <td style={{
      padding: '9px 12px', textAlign: align,
      borderBottom: '1px solid var(--aq-border-light)',
      color: muted ? 'var(--aq-text-muted)' : 'var(--aq-text)',
      fontStyle: italic ? 'italic' : 'normal',
      whiteSpace: align === 'right' ? 'nowrap' : undefined,
      verticalAlign: 'top',
    }}>{children}</td>
  );
}

export function Detail({
  label, value, missing,
}: { label: string; value?: string | null; missing?: boolean }) {
  const empty = !String(value ?? '').trim();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
        textTransform: 'uppercase', color: 'var(--aq-text-muted)',
      }}>{label}</div>
      <div style={{
        fontSize: 12.5, marginTop: 2, wordBreak: 'break-word',
        color: empty ? (missing ? '#b91c1c' : 'var(--aq-text-muted)') : 'var(--aq-text)',
        fontWeight: empty && missing ? 600 : 400,
        fontStyle: empty ? 'italic' : 'normal',
      }}>{empty ? (missing ? 'missing' : '—') : value}</div>
    </div>
  );
}

export const DETAIL_GRID: React.CSSProperties = {
  display: 'grid', gap: 12,
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
};

const SR_ONLY: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};
