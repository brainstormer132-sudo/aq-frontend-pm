'use client';

import { useEffect, useState } from 'react';

/**
 * A date box that saves when you have finished with it — on blur, or on
 * Enter — and never while the picker is open.
 *
 * The obvious version, `onChange={save}`, fires on every step of picking a
 * date. Clicking through to August 2026 wrote 2026-01-01, then 2026-08-01,
 * then the real date: three saves, two of them wrong, and on the bulk editor
 * the wrong ones went to every selected row. It read as the field
 * "auto-submitting".
 *
 * Unchanged in, nothing out: re-blurring a field you did not touch saves
 * nothing, so it never shows up in someone's activity feed as an edit.
 *
 * Lives in its own file because the rule is easy to get wrong and two copies
 * of it would eventually disagree.
 */
export function DateField({
  value, onCommit, disabled, min, style, 'aria-label': ariaLabel,
}: {
  value: string | null | undefined;
  onCommit: (next: string | null) => void;
  disabled?: boolean;
  min?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  // Follow the row if it changes underneath us — a refetch, or somebody else.
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const commit = () => {
    const next = draft || null;
    if ((value ?? null) === next) return;
    onCommit(next);
  };

  return (
    <input
      type="date"
      className="aq-input"
      style={style}
      value={draft}
      min={min}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}
