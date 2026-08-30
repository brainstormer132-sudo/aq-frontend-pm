'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * Collapse a burst of calls into one, after things go quiet.
 *
 * ── Why this exists ───────────────────────────────────────────────
 *
 * The campaign page subscribes to four tables it cannot filter — comments
 * and attachments carry a BOOKING's id rather than the campaign's, and ad
 * lines and contract requests have no campaign column at all — so those
 * subscriptions are workspace-wide. Every one of them called `refetchAll`,
 * which is nine queries.
 *
 * The comment above them claimed the refetch was "cheap and debounced by
 * the hooks themselves". It was neither. Nothing coalesced it. So a
 * colleague commenting on an unrelated task re-ran nine queries on your open
 * page, and one person bulk-editing twenty ad lines fired a hundred and
 * eighty requests at your browser — each one now a round trip to Frankfurt.
 *
 * ── What it does ──────────────────────────────────────────────────
 *
 * Calls that arrive within `ms` of each other become one call, made after
 * the last of them. Twenty ad-line edits are one refetch, not twenty.
 *
 * **Trailing, not leading.** The last event is the one worth reacting to:
 * firing on the first would fetch a half-finished bulk edit and then never
 * fetch the finished one.
 *
 * The timer is cancelled on unmount, so a page you have navigated away from
 * does not fetch on its way out.
 *
 * @param fn the work to coalesce — captured by ref, so it may change
 *           identity every render without restarting the timer
 * @param ms how long the quiet has to last. 700ms matches the dashboard's
 *           existing sync delay, which was tuned by use.
 */
export function useCoalesced(fn: () => void, ms = 700): () => void {
  const latest = useRef(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kept in a ref rather than a dependency: the callers build `fn` from nine
  // hook refetches, so its identity changes whenever any of them does. As a
  // dependency it would clear the pending timer on almost every render and
  // the debounce would never fire.
  useEffect(() => { latest.current = fn; }, [fn]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, ms);
  }, [ms]);
}
