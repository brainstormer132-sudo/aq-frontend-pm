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

import React, { useEffect, useRef, useState } from 'react';

/* ── Colour, as a vocabulary ──────────────────────────────────────
 *
 * Siraj: *"add some color to the tasks and drop down it looks bland"*.
 *
 * The page was warm stone and one green, which reads as careful and also as
 * undifferentiated: forty fields of the same grey box, and nothing on screen
 * says which of them is waiting on somebody. So rather than tinting things
 * decoratively, there are six tones and each one means one thing everywhere
 * it appears:
 *
 *   grey    nothing entered yet
 *   blue    in flight — somebody is doing it
 *   amber   waiting on someone outside this screen
 *   green   settled, and settled well
 *   red     wrong, blocked, or money going backwards
 *   violet  a deliberate exception — an adjustment, a credit
 *
 * Read a chip's colour anywhere on this page and it says the same thing. The
 * accent green keeps its old job (a good state, never "this is a button"),
 * and the palette stays on the warm ground the app is built on.
 */
export type ToneName = 'grey' | 'blue' | 'amber' | 'green' | 'red' | 'violet';

export const TONE: Record<ToneName, { bg: string; fg: string; edge: string }> = {
  grey:   { bg: 'var(--aq-bg-sunken)',    fg: 'var(--aq-text-muted)', edge: 'var(--aq-border)' },
  blue:   { bg: '#dbeafe',                fg: '#1e40af',              edge: '#60a5fa' },
  amber:  { bg: '#fef3c7',                fg: '#92400e',              edge: '#f59e0b' },
  green:  { bg: 'var(--aq-accent-light)', fg: '#14603a',              edge: 'var(--aq-accent)' },
  red:    { bg: '#fee2e2',                fg: '#991b1b',              edge: '#ef4444' },
  violet: { bg: '#ede9fe',                fg: '#5b21b6',              edge: '#8b5cf6' },
};

/**
 * What each state of each thing means, in one place.
 *
 * One table rather than a switch in every component: a status that gains a
 * value gets its colour here and everywhere at once, and two screens cannot
 * decide that "partial" is amber in one and red in the other.
 */
export const STATE_TONE: Record<string, ToneName> = {
  // Task status
  pending: 'blue', in_progress: 'blue', on_hold: 'amber',
  done: 'green', completed: 'green', cancelled: 'red',
  // Approval
  ready_for_review: 'blue', changes_needed: 'amber', approved: 'green', hold: 'amber',
  // Money, client and vendor alike
  unpaid: 'grey', partial: 'amber', paid: 'green',
  no_payment: 'grey', refund: 'red', credit: 'blue', adjustment: 'violet',
  // Contracts and requests
  none: 'grey', requested: 'amber', signed: 'green', generated: 'green',
  waiting: 'amber', blocked: 'red', pending_marketing: 'amber',
  // Priority
  urgent: 'red', high: 'amber', medium: 'blue', low: 'grey',
  // Where an ad has got to
  Posted: 'green', Shot: 'blue', Scheduled: 'amber',
  'Not started': 'grey', Cancelled: 'red',
};

export function toneOf(value: unknown, fallback: ToneName = 'grey'): ToneName {
  const k = typeof value === 'string' ? value.trim() : '';
  return STATE_TONE[k] ?? fallback;
}

/**
 * The platforms, in colours people already associate with them.
 *
 * Pale grounds rather than the brand hues at full strength — eight saturated
 * logos side by side is a toolbar, not a field. The hue is enough to find
 * Snapchat in a row of six without reading any of them.
 */
const PLATFORM_TONE: Record<string, { bg: string; fg: string }> = {
  instagram: { bg: '#fce7f3', fg: '#9d174d' },
  snapchat:  { bg: '#fef9c3', fg: '#854d0e' },
  tiktok:    { bg: '#e0f2f1', fg: '#134e4a' },
  youtube:   { bg: '#fee2e2', fg: '#991b1b' },
  x:         { bg: '#e7e5e4', fg: '#1c1917' },
  twitter:   { bg: '#e0f2fe', fg: '#075985' },
  facebook:  { bg: '#dbeafe', fg: '#1e3a8a' },
  linkedin:  { bg: '#e0f2fe', fg: '#0c4a6e' },
  whatsapp:  { bg: '#dcfce7', fg: '#14532d' },
  telegram:  { bg: '#e0f2fe', fg: '#075985' },
};

export function platformTone(name: unknown): { bg: string; fg: string } {
  const k = (typeof name === 'string' ? name : '').trim().toLowerCase();
  return PLATFORM_TONE[k] ?? { bg: 'var(--aq-bg-sunken)', fg: 'var(--aq-text-secondary)' };
}

/** One pill. Every coloured label on this page is one of these. */
export function Chip({ label, tone = 'grey', colours, title }: {
  label: React.ReactNode;
  tone?: ToneName;
  /** Overrides the tone — for platforms, which have their own colours. */
  colours?: { bg: string; fg: string };
  title?: string;
}) {
  const c = colours ?? TONE[tone];
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999,
      background: c.bg, color: c.fg, whiteSpace: 'nowrap', lineHeight: 1.5,
    }}>{label}</span>
  );
}

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

export function Card({ title, hint, right, id, bead, children }: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
  id?: string;
  /** A colour for this section, so a long page reads as places rather than cards. */
  bead?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="aq-card" id={id}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '15px 18px 0',
      }}>
        {bead && (
          <span aria-hidden style={{
            width: 8, height: 8, borderRadius: 2, flex: '0 0 auto',
            background: bead, transform: 'rotate(45deg)',
          }} />
        )}
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

/**
 * A dropdown that admits whether it has been answered.
 *
 * A page of identical grey boxes cannot be skimmed: "— None —" and a real
 * answer looked the same from two feet away, so finding the four fields
 * nobody has filled in meant reading all forty.
 *
 * Now an empty one stays plain and an answered one carries a coloured left
 * edge. Pass `stateful` where the VALUE means something — a status, a payment
 * state — and the whole control takes that state's tone, so the row says
 * "waiting" or "paid" before you have read the word.
 */
export function Pick({
  value, options, onChange, canEdit, clearable = true, label, disabled, stateful,
}: {
  value: string | null | undefined;
  options: { v: string; l: string }[];
  onChange: (v: string | null) => void;
  canEdit: boolean;
  clearable?: boolean;
  label?: string;
  disabled?: boolean;
  /** The value is a state, so colour by what it says rather than just "set". */
  stateful?: boolean;
}) {
  const current = options.find((o) => o.v === value);
  const chosen = !!current;
  const tone = TONE[toneOf(value)];

  if (!canEdit) {
    return stateful && chosen
      ? <Chip label={current!.l} tone={toneOf(value)} />
      : <Val label={label}>{current?.l ?? '—'}</Val>;
  }

  // Disabled is its own state, not a faded one: it reads as flat and quiet
  // rather than as an answered field somebody has dimmed.
  const edge = disabled ? 'var(--aq-border-light)'
    : chosen ? (stateful ? tone.edge : 'var(--aq-accent)')
    : 'var(--aq-border)';

  return (
    <select
      className="aq-select"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
      style={{
        width: '100%', fontSize: 13,
        borderLeft: `3px solid ${edge}`,
        background: stateful && chosen && !disabled ? tone.bg : undefined,
        color: stateful && chosen && !disabled ? tone.fg : undefined,
        fontWeight: stateful && chosen ? 600 : undefined,
      }}
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

/**
 * Several values from a list — platforms, mostly.
 *
 * Was a row of chips, which wrapped to three lines on seven platforms and
 * pushed everything under it down the page. Siraj: *"a drop down with a check
 * depending on the platform is cleaner."* So it is a menu that stays one line
 * shut, and the button says what is picked rather than "3 selected" — the
 * names are the thing you are checking at a glance.
 */
export function MultiPick({ values, options, onChange, canEdit, label }: {
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  canEdit: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const picked = (values ?? []).map((v) => String(v));
  const set = new Set(picked);

  // Click-away and Escape. Without these the menu stays open behind whatever
  // you click next, which on a page of fields is most things.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const summary = picked.length ? picked.join(' · ') : 'Choose platforms';
  // Chips rather than "a · b · c": six platforms in one line of text is a
  // string to be parsed; six chips is something the eye lands on.
  const chips = picked.length ? (
    <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
      {picked.map((v) => <Chip key={v} label={v} colours={platformTone(v)} />)}
    </span>
  ) : null;

  if (!canEdit) {
    return chips ?? <Val label={label}>—</Val>;
  }


  return (
    <span ref={wrap} style={{ position: 'relative', display: 'block' }}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          minHeight: 32, padding: '6px 10px', borderRadius: 8, fontSize: 13,
          border: '1px solid var(--aq-border)',
          borderLeft: `3px solid ${picked.length ? 'var(--aq-accent)' : 'var(--aq-border)'}`,
          background: 'var(--aq-bg-elevated)',
          color: picked.length ? 'var(--aq-text)' : 'var(--aq-text-muted)',
          font: 'inherit', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{
          flex: 1, minWidth: 0, overflow: 'hidden',
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 13,
        }} title={summary}>{chips ?? summary}</span>
        <span aria-hidden style={{ opacity: .5, fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <span
          role="listbox"
          aria-multiselectable
          aria-label={label}
          style={{
            position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0,
            minWidth: '100%', maxHeight: 260, overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
            border: '1px solid var(--aq-border)', borderRadius: 10,
            background: 'var(--aq-bg-elevated)', boxShadow: 'var(--aq-shadow-lg)',
            padding: 4,
          }}
        >
          {options.map((o) => {
            const on = set.has(o);
            return (
              <label
                key={o}
                role="option"
                aria-selected={on}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '7px 9px', borderRadius: 7, fontSize: 13,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  background: on ? 'var(--aq-bg-sunken)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? picked.filter((v) => v !== o) : [...picked, o])}
                  style={{ width: 15, height: 15 }}
                />
                {o}
              </label>
            );
          })}
          {!options.length && (
            <span style={{ padding: '7px 9px', fontSize: 12.5, color: 'var(--aq-text-muted)' }}>
              No platforms are set up yet — Settings adds them.
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * A repeatable list of short strings — quotation and invoice numbers.
 *
 * A campaign is often quoted twice and invoiced in parts, which is why these
 * are `text[]` columns rather than one box. The page could only display them.
 */
export function StringList({ values, onChange, canEdit, label, placeholder }: {
  values: string[];
  onChange: (next: string[]) => void;
  canEdit: boolean;
  label?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const clean = (values ?? []).filter((v) => String(v ?? '').trim());
  if (!canEdit) return <Val mono label={label}>{clean.join(', ') || '—'}</Val>;

  const add = () => {
    const v = draft.trim();
    if (!v || clean.includes(v)) { setDraft(''); return; }
    onChange([...clean, v]);
    setDraft('');
  };

  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {clean.length > 0 && (
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {clean.map((v) => (
            <span key={v} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12.5, padding: '4px 6px 4px 10px', borderRadius: 999,
              border: '1px solid var(--aq-border)', background: 'var(--aq-bg-elevated)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(clean.filter((x) => x !== v))}
                style={{
                  font: 'inherit', fontSize: 13, lineHeight: 1, border: 'none',
                  background: 'none', cursor: 'pointer', color: 'var(--aq-text-muted)',
                  padding: '0 3px',
                }}
              >×</button>
            </span>
          ))}
        </span>
      )}
      <input
        className="aq-input"
        aria-label={label}
        value={draft}
        placeholder={placeholder ?? 'Type it and press Enter'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(); }
        }}
        style={{ width: '100%', fontSize: 13 }}
      />
    </span>
  );
}

/**
 * A worked-out number you are still allowed to overrule.
 *
 * Siraj: *"vendors cost should be automatic but still not locked it can be
 * edited."* So it shows the rollup until somebody types something, and then it
 * shows what they typed — plus a line saying what the rollup would have said
 * and a way back, because a silently overridden total is how the money stops
 * adding up and nobody can see why.
 */
export function OverridableMoney({
  computed, override, onCommit, canEdit, label, format,
}: {
  computed: number;
  override: number | null | undefined;
  onCommit: (v: number | null) => void;
  canEdit: boolean;
  label?: string;
  format: (n: number) => string;
}) {
  const overridden = override != null;
  const shown = overridden ? Number(override) : computed;
  const [draft, setDraft] = useState(overridden ? String(override) : '');
  useEffect(() => { setDraft(overridden ? String(override) : ''); }, [override, overridden]);

  if (!canEdit) {
    return <Val calc={!overridden} label={label}>{format(shown)}</Val>;
  }
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <input
        className="aq-input"
        aria-label={label}
        inputMode="decimal"
        value={draft}
        placeholder={format(computed)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const t = draft.trim();
          if (!t) { if (overridden) onCommit(null); return; }
          const n = Number(t.replace(/[, ]/g, ''));
          if (!Number.isFinite(n) || n < 0) { setDraft(overridden ? String(override) : ''); return; }
          if (n !== override) onCommit(n);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        style={{
          width: '100%', fontSize: 13, fontVariantNumeric: 'tabular-nums',
          borderStyle: overridden ? 'solid' : 'dashed',
        }}
      />
      <span style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
        {overridden ? (
          <>
            Overruled. The bookings add up to {format(computed)}.{' '}
            <button
              type="button"
              onClick={() => onCommit(null)}
              style={{
                font: 'inherit', fontSize: 11, border: 'none', background: 'none',
                padding: 0, cursor: 'pointer', textDecoration: 'underline',
                color: 'var(--aq-text-secondary)',
              }}
            >Use that instead</button>
          </>
        ) : 'Added up from the bookings. Type over it if it is wrong.'}
      </span>
    </span>
  );
}
