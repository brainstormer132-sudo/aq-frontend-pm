'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface PickerOption {
  value: string;
  label: string;
  /** Second line — CR number, category, licence, whatever identifies a duplicate. */
  hint?: string | null;
  /** Extra text to match against that isn't shown. */
  keywords?: string | null;
}

/**
 * Type-ahead picker for long reference lists.
 *
 * A plain <select> with several hundred clients in it is unusable: you can
 * only jump by first letter, and near-duplicates ("ALTER Agency Ltd" twice)
 * are indistinguishable. This filters as you type, shows a disambiguating
 * hint line, and keeps the keyboard working.
 *
 * Deliberately dependency-free and uncontrolled-input — the app has no combobox
 * library and this matches the existing aq-* / inline-style house style.
 */
export function SearchablePicker({
  options, value, onChange, placeholder = 'Search…', emptyLabel = '— None —',
  disabled = false, maxWidth = 360, allowClear = true, autoFocus = false,
}: {
  options: PickerOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  maxWidth?: number | string;
  allowClear?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  // Filter on every token, so "alter gb" finds "ALTER Agency Ltd · CR GB…".
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 200);
    const tokens = q.split(/\s+/);
    const scored: { o: PickerOption; score: number }[] = [];
    for (const o of options) {
      const hay = `${o.label} ${o.hint ?? ''} ${o.keywords ?? ''}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) continue;
      // Prefix matches first — typing "aba" should surface "Abaya Queen"
      // above something that merely contains "aba" halfway through.
      scored.push({ o, score: o.label.toLowerCase().startsWith(q) ? 0 : 1 });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, 200).map((s) => s.o);
  }, [options, query]);

  useEffect(() => { setActiveIndex(0); }, [query, open]);

  // Click outside closes without committing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const commit = (opt: PickerOption | null) => {
    onChange(opt ? opt.value : null);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIndex]) commit(filtered[activeIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setQuery(''); }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative', maxWidth, width: '100%' }}>
      <input
        ref={inputRef}
        className="aq-input"
        style={{ width: '100%', cursor: disabled ? 'not-allowed' : 'text' }}
        disabled={disabled}
        autoFocus={autoFocus}
        // Showing the selection as the input value while closed means one
        // control does both jobs — no separate "selected" chip to keep in sync.
        value={open ? query : (selected?.label ?? '')}
        placeholder={selected ? selected.label : placeholder}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />

      {allowClear && selected && !open && !disabled && (
        <button
          type="button"
          onClick={() => commit(null)}
          aria-label="Clear selection"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--aq-text-muted)', fontSize: 14, lineHeight: 1, padding: 4,
          }}
        >✕</button>
      )}

      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', zIndex: 50, top: 'calc(100% + 4px)', left: 0, right: 0,
            maxHeight: 280, overflowY: 'auto', listStyle: 'none', margin: 0, padding: 4,
            background: 'var(--aq-bg-elevated)',
            border: '1px solid var(--aq-border-light)',
            borderRadius: 'var(--aq-radius)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
        >
          {allowClear && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); commit(null); }}
                style={rowStyle(false)}
              >{emptyLabel}</button>
            </li>
          )}

          {filtered.length === 0 && (
            <li style={{ padding: '10px 12px', fontSize: 13, color: 'var(--aq-text-muted)' }}>
              Nothing matches “{query}”.
            </li>
          )}

          {filtered.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                // onMouseDown, not onClick: the input's blur would close the
                // list before a click ever landed.
                onMouseDown={(e) => { e.preventDefault(); commit(o); }}
                onMouseEnter={() => setActiveIndex(i)}
                style={rowStyle(i === activeIndex, o.value === value)}
              >
                <span style={{ display: 'block' }}>{o.label}</span>
                {o.hint && (
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 1 }}>
                    {o.hint}
                  </span>
                )}
              </button>
            </li>
          ))}

          {filtered.length >= 200 && (
            <li style={{ padding: '8px 12px', fontSize: 11, color: 'var(--aq-text-muted)' }}>
              Showing the first 200 — keep typing to narrow it down.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function rowStyle(active: boolean, selected = false): React.CSSProperties {
  return {
    width: '100%', textAlign: 'left', cursor: 'pointer',
    padding: '8px 12px', borderRadius: 'var(--aq-radius)',
    border: 'none', font: 'inherit', fontSize: 13,
    background: active ? 'var(--aq-bg-sunken)' : 'transparent',
    color: 'var(--aq-text)',
    fontWeight: selected ? 700 : 400,
  };
}
