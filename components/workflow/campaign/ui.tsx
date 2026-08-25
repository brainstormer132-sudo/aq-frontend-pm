'use client';

/**
 * The campaign page's shared vocabulary.
 *
 * These were private to CampaignPage.tsx while the page could only read. Now
 * that each section does real work, the sections live in their own files and
 * need the same nouns — a Card, a labelled Field, a value that admits it was
 * worked out rather than typed. Extracting them is what keeps the page from
 * becoming the next 3,700-line file.
 */

import React, { useEffect, useState } from 'react';

export const SMALL_BTN: React.CSSProperties = {
  padding: '5px 11px', fontSize: 12.5, textDecoration: 'none',
};

/** Ink, never the accent green. Green means a state on this page, not "button". */
export function inkButton(disabled?: boolean): React.CSSProperties {
  return {
    font: 'inherit', fontSize: 12.5, fontWeight: 600,
    padding: '6px 13px', borderRadius: 8,
    border: '1px solid transparent',
    background: disabled ? 'var(--aq-bg-sunken)' : 'var(--aq-text)',
    color: disabled ? 'var(--aq-text-muted)' : '#fff',
    borderColor: disabled ? 'var(--aq-border-light)' : 'var(--aq-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

export function quietButton(disabled?: boolean): React.CSSProperties {
  return {
    font: 'inherit', fontSize: 12.5, fontWeight: 600,
    padding: '6px 13px', borderRadius: 8,
    border: '1px solid var(--aq-border)',
    background: 'var(--aq-bg-elevated)',
    color: disabled ? 'var(--aq-text-muted)' : 'var(--aq-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

export function Dot() {
  return <span aria-hidden style={{ opacity: .4 }}>·</span>;
}

export function Card({ title, hint, right, id, children }: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="aq-card" id={id}>
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
        padding: '15px 18px 0',
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        {hint && <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{hint}</span>}
        {right && <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{right}</span>}
      </header>
      <div style={{ padding: '14px 18px 18px' }}>{children}</div>
    </section>
  );
}

export function Group({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase',
      color: 'var(--aq-text-muted)', margin: '20px 0 10px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {title}
      <span aria-hidden style={{ flex: 1, height: 1, background: 'var(--aq-border-light)' }} />
    </div>
  );
}

export function Fields({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      gap: '10px 26px',
    }}>{children}</div>
  );
}

/**
 * One labelled field.
 *
 * The label is threaded into the control as its accessible name as well as
 * being drawn beside it — a <span> next to an <input> is a caption, not a
 * label, and a screen reader would otherwise announce a page of unnamed boxes.
 */
export function F({ k, children }: { k: string; children: React.ReactNode }) {
  const named = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any>, { label: k })
    : children;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)',
      gap: 10, alignItems: 'center',
    }}>
      <span style={{ fontSize: 11.5, color: 'var(--aq-text-muted)' }}>{k}</span>
      <span style={{ minWidth: 0 }}>{named}</span>
    </div>
  );
}

export function Val({ children, calc, mono, warn, label }: {
  children: React.ReactNode; calc?: boolean; mono?: boolean; warn?: boolean; label?: string;
}) {
  return (
    <span data-field={label} data-calc={calc ? 'yes' : undefined} style={{
      display: 'flex', alignItems: 'center', minHeight: 32,
      border: `1px ${calc ? 'dashed' : 'solid'} ${warn ? '#b45309' : 'var(--aq-border)'}`,
      borderRadius: 8, padding: '6px 10px', fontSize: 13,
      background: calc ? 'var(--aq-bg-sunken)' : warn ? '#fef3c7' : 'var(--aq-bg-elevated)',
      color: calc ? 'var(--aq-text-secondary)' : warn ? '#92400e' : 'var(--aq-text)',
      fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
      fontVariantNumeric: 'tabular-nums',
    }}>{children}</span>
  );
}

export function Pick({ value, options, onChange, canEdit, clearable = true, label, disabled }: {
  value: string | null | undefined;
  options: { v: string; l: string }[];
  onChange: (v: string | null) => void;
  canEdit: boolean;
  clearable?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const current = options.find((o) => o.v === value);
  if (!canEdit) return <Val label={label}>{current?.l ?? '—'}</Val>;
  return (
    <select
      className="aq-select"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      style={{ width: '100%', fontSize: 13 }}
    >
      {clearable && <option value="">— None —</option>}
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

export function Text({ value, placeholder, onCommit, canEdit, warn, label, numeric }: {
  value: string | number | null | undefined;
  placeholder?: string;
  onCommit: (v: string) => void;
  canEdit: boolean;
  warn?: boolean;
  label?: string;
  numeric?: boolean;
}) {
  const asText = value == null ? '' : String(value);
  const [draft, setDraft] = useState(asText);
  useEffect(() => { setDraft(asText); }, [asText]);
  if (!canEdit) return <Val warn={warn} label={label}>{asText || '—'}</Val>;
  return (
    <input
      className="aq-input"
      aria-label={label}
      value={draft}
      inputMode={numeric ? 'decimal' : undefined}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== asText) onCommit(draft.trim()); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: '100%', fontSize: 13,
        borderColor: warn ? '#b45309' : undefined,
        background: warn ? '#fef3c7' : undefined,
      }}
    />
  );
}

export function Check({ checked, onChange, canEdit, label }: {
  checked: boolean; onChange: (v: boolean) => void; canEdit: boolean; label?: string;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minHeight: 32 }}>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={!canEdit}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={{ color: 'var(--aq-text-secondary)' }}>{checked ? 'Yes' : 'Not yet'}</span>
    </label>
  );
}

/** A short banner. `tone` decides what it means, and it always says it in words. */
export function Note({ tone = 'info', children }: {
  tone?: 'info' | 'good' | 'warn' | 'bad';
  children: React.ReactNode;
}) {
  const c = tone === 'bad'
    ? { bg: '#fee2e2', fg: '#991b1b' }
    : tone === 'warn'
      ? { bg: '#fef3c7', fg: '#78350f' }
      : tone === 'good'
        ? { bg: 'var(--aq-accent-light)', fg: '#14603a' }
        : { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-secondary)' };
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} style={{
      padding: '9px 13px', borderRadius: 9, fontSize: 12.5, marginBottom: 10,
      background: c.bg, color: c.fg,
    }}>{children}</div>
  );
}

/**
 * Delete, with a window to change your mind.
 *
 * Carried over from the drawer deliberately. It is better than a confirm
 * dialog for something you do repeatedly — a dialog asks you the same question
 * forty times and trains you to click through it, where this one only costs
 * you anything on the occasion you were actually wrong.
 */
export function UndoBar({ label, seconds, onUndo, onNow }: {
  label: string; seconds: number; onUndo: () => void; onNow: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      padding: '9px 13px', borderRadius: 9, fontSize: 12.5,
      background: '#fef3c7', color: '#78350f',
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <button type="button" onClick={onUndo} style={quietButton()}>
        Undo ({seconds}s)
      </button>
      <button type="button" onClick={onNow} style={{ ...quietButton(), color: '#991b1b' }}>
        Delete now
      </button>
    </div>
  );
}

/** The checklist a contract request has to satisfy before it can be sent. */
export function Missing({ items }: { items: { label: string; hint?: string }[] }) {
  if (!items.length) return null;
  return (
    <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: '#78350f' }}>
      {items.map((m, i) => (
        <li key={i} style={{ marginBottom: 2 }}>
          {m.label}{m.hint ? <span style={{ opacity: .8 }}> — {m.hint}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * What was refused, and why.
 *
 * Saves happen behind the screen now, so a failure has to come and find you.
 * It names the field, the row it was on, and what the server actually said —
 * the old panel put the raw Postgres text in a `window.alert`, which stopped
 * everything to show a constraint name nobody had heard of.
 *
 * Retry sends them again. Discard puts the server's values back on screen, so
 * you are never left looking at a number that was never saved.
 */
export function FailureBanner({ failures, summary, lines, onRetry, onDiscard }: {
  failures: unknown[];
  summary: string;
  lines: string[];
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (!failures.length) return null;
  return (
    <div role="alert" style={{
      padding: '12px 15px', borderRadius: 10, marginBottom: 14,
      background: '#fee2e2', color: '#991b1b',
      border: '1px solid #fca5a5',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, flex: 1, minWidth: 200 }}>{summary}</strong>
        <button type="button" onClick={onRetry} style={quietButton()}>Try again</button>
        <button type="button" onClick={onDiscard} style={quietButton()}>
          Put the old values back
        </button>
      </div>
      {lines.length > 1 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
          {lines.map((l, i) => <li key={i} style={{ marginBottom: 2 }}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

/** A quiet "still saving" marker. Never a spinner that blocks anything. */
export function SavingDot({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11.5, color: 'var(--aq-text-muted)',
    }}>
      <span aria-hidden style={{
        width: 6, height: 6, borderRadius: '50%', background: 'var(--aq-text-muted)',
      }} />
      saving {n === 1 ? 'a change' : `${n} changes`}…
    </span>
  );
}
