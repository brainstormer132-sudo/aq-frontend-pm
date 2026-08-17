'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeMentionQuery, applyMention, displayName,
  type MentionPick, type Profile,
} from '@/hooks/use-workflow';

/**
 * A comment box that understands @mentions.
 *
 * Type @ and a name fragment; pick a teammate; the text gets a token that
 * renders as their CURRENT full name wherever it's shown. Nobody's email
 * or username ever appears — the picker lists names, and a person with no
 * name set reads "Unnamed member" until they set one.
 *
 * Uses onMouseDown rather than onClick for the same reason SearchablePicker
 * does: the textarea's blur would close the list before a click landed.
 */
export function MentionBox({
  value, onChange, onSubmit, people, placeholder, disabled, onPicksChange,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  people: Profile[];
  placeholder?: string;
  disabled?: boolean;
  /**
   * Every mention the user has picked, so the caller can run encodeMentions()
   * before saving. The box shows names; the database stores ids.
   */
  onPicksChange?: (picks: MentionPick[]) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [picks, setPicks] = useState<MentionPick[]>([]);

  // A cleared box has no mentions left to resolve. Without this, sending a
  // comment and starting a new one would re-apply the previous picks.
  useEffect(() => {
    if (value === '' && picks.length) {
      setPicks([]);
      onPicksChange?.([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const active = useMemo(
    () => (open ? activeMentionQuery(value, caret) : null),
    [open, value, caret],
  );

  const matches = useMemo(() => {
    if (!active) return [];
    const q = active.query.trim().toLowerCase();
    const scored = people
      .map((p) => ({ p, name: displayName(p) }))
      // Someone who hasn't set a name can't be told apart from anyone else
      // who hasn't, so they're not offered as a mention target.
      .filter((x) => x.name !== 'Unnamed member')
      .filter((x) => !q || x.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        return ap !== bp ? ap - bp : a.name.localeCompare(b.name);
      });
    return scored.slice(0, 8);
  }, [active, people]);

  const showList = open && active !== null && matches.length > 0;

  const sync = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart ?? 0);
    setOpen(true);
  };

  const choose = (userId: string) => {
    if (!active) return;
    const name = displayName(people.find((p) => p.id === userId));
    const next = applyMention(value, active.start, caret, userId, name);
    onChange(next.text);
    setPicks((prev) => {
      const merged = [...prev, { id: userId, name }];
      onPicksChange?.(merged);
      return merged;
    });
    setOpen(false);
    // Put the caret after the inserted token on the next frame, once React
    // has written the new value into the textarea.
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      setCaret(next.caret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showList) {
      if (e.key === 'ArrowDown') {
        e.preventDefault(); setHighlight((h) => (h + 1) % matches.length); return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); choose(matches[Math.min(highlight, matches.length - 1)].p.id); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault(); onSubmit();
    }
  };

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <textarea
        ref={ref}
        className="aq-input"
        rows={3}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? 'Add a comment… (@ to mention, Cmd/Ctrl+Enter to send)'}
        onChange={(e) => { onChange(e.target.value); sync(e.currentTarget); }}
        onKeyUp={(e) => sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
      />

      {showList && (
        <ul
          style={{
            position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%',
            marginTop: 4, listStyle: 'none', maxHeight: 220, overflowY: 'auto',
            background: 'var(--aq-bg-elevated)',
            border: '1px solid var(--aq-border)',
            borderRadius: 'var(--aq-radius)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          }}
          role="listbox"
        >
          {matches.map((m, i) => (
            <li key={m.p.id}>
              <button
                type="button"
                // mousedown, not click — blur fires first and would close this.
                onMouseDown={(e) => { e.preventDefault(); choose(m.p.id); }}
                onMouseEnter={() => setHighlight(i)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: '7px 11px', fontSize: 13, fontFamily: 'inherit',
                  border: 'none', color: 'var(--aq-text)',
                  background: i === highlight ? 'var(--aq-accent-light)' : 'transparent',
                }}
                role="option"
                aria-selected={i === highlight}
              >{m.name}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Renders stored comment text, turning mention tokens into names. */
export function CommentText({
  segments,
}: {
  segments: { kind: 'text' | 'mention'; value?: string; name?: string }[];
}) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'mention' ? (
          <strong
            key={i}
            style={{
              color: 'var(--aq-accent-strong, #0b6b4f)',
              background: 'var(--aq-accent-light)',
              borderRadius: 4, padding: '0 3px',
            }}
          >@{s.name}</strong>
        ) : (
          <span key={i}>{s.value}</span>
        ),
      )}
    </>
  );
}
