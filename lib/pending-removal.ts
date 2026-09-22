/**
 * Delete, with a window to change your mind.
 *
 * -- WHY NOT A CONFIRM DIALOG -----------------------------------------
 *
 * Siraj: "fix delete showing a popup on google it should be the same thing
 * also as all tasks".
 *
 * `components/workflow/campaign/ui.tsx` already says why, and it is worth
 * repeating: a dialog asks you the same question forty times and trains you to
 * click through it, where an undo window only costs you anything on the
 * occasion you were actually wrong. The campaign screens have worked this way
 * for a while; the legal screens were still raising `window.confirm`, and the
 * Tasks list did something worse - its `x` deleted immediately, with no
 * confirmation of any kind.
 *
 * -- WHAT THIS FILE IS -------------------------------------------------
 *
 * The state machine, pure, so it can be tested. The three screens that already
 * do this each keep a `Map` of `setInterval` handles, one timer per pending
 * row, and hand-roll the same bookkeeping. That is three copies of a thing
 * with a race in it: a timer that fires after its row has gone still has to
 * find nothing to do.
 *
 * Here there is ONE tick for the whole list and no timers in the state at all.
 * `tick` returns the rows that are still counting and the ids whose time is
 * up, and the caller commits those. Nothing to clear, nothing to leak, and the
 * arithmetic is testable without a clock.
 *
 * No React, no Supabase, no argless `new Date()`. Relative imports only.
 */

export interface Pending {
  id: string;
  /** What the undo bar says was removed. */
  title: string;
  /** Whole seconds left before it commits. */
  left: number;
}

/**
 * How long the window is.
 *
 * Four seconds, which is what CampaignBookings, CampaignWork and
 * CampaignActivity all use. Long enough to catch the wrong row, short enough
 * that a list of them does not pile up on screen.
 */
export const UNDO_SECONDS = 4;

/**
 * Start the window for one row.
 *
 * Re-starting a row that is already pending REPLACES it rather than adding a
 * second entry - two undo bars for one row is a bug the list shape invites.
 */
export function startPending(
  list: Pending[], id: string, title: string, seconds: number = UNDO_SECONDS,
): Pending[] {
  const key = String(id ?? '');
  if (!key) return list;
  const s = Math.max(1, Math.trunc(seconds));
  return [...(list ?? []).filter((p) => p.id !== key), { id: key, title: String(title ?? ''), left: s }];
}

/** Take a row out of the window without committing it. */
export function cancelPending(list: Pending[], id: string): Pending[] {
  return (list ?? []).filter((p) => p.id !== String(id ?? ''));
}

/**
 * One second later.
 *
 * Returns the rows still counting and the ids whose window has closed. The
 * caller commits `due` and renders `next` - and because the expired rows are
 * removed in the same step that reports them, a row can never be committed
 * twice by a tick that arrives late.
 */
export function tickPending(list: Pending[]): { next: Pending[]; due: string[] } {
  const next: Pending[] = [];
  const due: string[] = [];
  for (const p of list ?? []) {
    if (p.left <= 1) due.push(p.id);
    else next.push({ ...p, left: p.left - 1 });
  }
  return { next, due };
}

/** Commit everything at once - what "Delete now" does, and what unmount does. */
export function flushPending(list: Pending[]): { next: Pending[]; due: string[] } {
  return { next: [], due: (list ?? []).map((p) => p.id) };
}

/**
 * What the bar says.
 *
 * The row's own name when it has one, because "Removed Rabea." tells you
 * whether you hit the right line and "Removed the task." does not. A row with
 * no title falls back to the kind of thing it was.
 */
export function removedLabel(title: string, kind: string = 'item'): string {
  const t = String(title ?? '').trim();
  return t ? `Removed ${t}.` : `Removed the ${String(kind ?? 'item').trim() || 'item'}.`;
}

/** The ids currently in the window, for hiding those rows from the list. */
export function pendingIds(list: Pending[]): Set<string> {
  return new Set((list ?? []).map((p) => p.id));
}
