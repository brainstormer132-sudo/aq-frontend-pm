/**
 * The bookkeeping behind saving without waiting.
 *
 * Every field on the campaign page used to `await` its own round trip and then
 * `await` a refetch of the whole campaign — so typing a price and tabbing to
 * the next box froze the page twice, and doing it ten times down a list of
 * bookings meant twenty waits. Siraj: *"dont make it slow and unresponsive
 * make as much of the work as you can seemless for the user and then loads for
 * the server later and if an error happens show the error and why."*
 *
 * So the screen changes immediately and the write happens behind it. That is
 * only honest if three things are true, and this module is where they are
 * decided — pure, so they can be tested without a browser or a database:
 *
 *  1. **A later edit wins.** Two writes to the same field must not race; the
 *     second replaces the first rather than queueing behind it.
 *  2. **A failure is visible and named.** Not "save failed" — which field, on
 *     which row, and what the database actually said.
 *  3. **A failure puts the old value back.** The screen must never keep showing
 *     a number the server rejected.
 *
 * No React, no Supabase, no `new Date()` without being handed the time.
 */

export interface Write {
  /** Row this belongs to — a campaign id or a subtask id. */
  id: string;
  /** Column being written. */
  field: string;
  /** What the user typed. */
  value: unknown;
  /** What was there before, so a failure can put it back. */
  was: unknown;
  /** How this field should be named to a person. */
  label: string;
  /** When it was queued, for ordering and for the "still saving" hint. */
  at: number;
}

export interface WriteFailure {
  id: string;
  field: string;
  label: string;
  /** The value that was refused, so the message can quote it. */
  value: unknown;
  /** What the server said, cleaned up. */
  reason: string;
  at: number;
}

export type Queue = Record<string, Write>;

/** One slot per (row, field) — that is what makes a later edit replace an earlier one. */
export function keyOf(id: string, field: string): string {
  return `${id}::${field}`;
}

/**
 * Add a write, replacing any earlier one for the same field.
 *
 * `was` is carried over from the write being replaced, not from the row: if
 * you type 100, then 200, then the save fails, the value to restore is
 * whatever was there before you started — not the 100 that never landed.
 */
export function enqueue(queue: Queue, write: Write): Queue {
  const k = keyOf(write.id, write.field);
  const existing = queue[k];
  return {
    ...queue,
    [k]: existing ? { ...write, was: existing.was } : write,
  };
}

/** Drop a write once it has landed — but only if it is still the same one. */
export function settle(queue: Queue, id: string, field: string, at: number): Queue {
  const k = keyOf(id, field);
  const current = queue[k];
  // A newer edit arrived while this one was in flight. Leave it queued, or
  // the newer value would be dropped and the screen would drift from the row.
  if (!current || current.at !== at) return queue;
  const { [k]: _gone, ...rest } = queue;
  return rest;
}

/** Everything still unsaved for one row, so a field can read through the queue. */
export function overlayFor(queue: Queue, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const w of Object.values(queue)) {
    if (w.id === id) out[w.field] = w.value;
  }
  return out;
}

/** The row as the user believes it to be: what the server has, plus what is in flight. */
export function withPending<T extends Record<string, any>>(row: T, queue: Queue): T {
  const id = String((row as any)?.id ?? '');
  if (!id) return row;
  const overlay = overlayFor(queue, id);
  return Object.keys(overlay).length ? { ...row, ...overlay } : row;
}

export function pendingCount(queue: Queue): number {
  return Object.keys(queue).length;
}

/* ── When it goes wrong ─────────────────────────────────────────── */

const PG_HINTS: { test: RegExp; say: (m: string) => string }[] = [
  {
    test: /duplicate key|already exists|unique constraint/i,
    say: () => 'that value is already used somewhere it has to be unique',
  },
  {
    test: /violates check constraint .*contract_length_unit/i,
    say: () => 'the unit has to be days, weeks or months',
  },
  {
    test: /violates check constraint .*contract_length_pair/i,
    say: () => 'a length needs both a number and a unit, or neither',
  },
  {
    test: /violates check constraint/i,
    say: () => 'the database refused that value',
  },
  {
    test: /violates foreign key/i,
    say: () => 'the thing it points at no longer exists — reload the page',
  },
  {
    test: /violates not-null/i,
    say: () => 'that field cannot be left empty',
  },
  {
    test: /invalid input syntax for type (\w+)/i,
    say: (m) => `that is not a valid ${(/type (\w+)/i.exec(m)?.[1]) ?? 'value'}`,
  },
  {
    test: /permission denied|row-level security|RLS/i,
    say: () => 'your role is not allowed to change this',
  },
  {
    test: /JWT|expired|not authenticated/i,
    say: () => 'your session expired — sign in again',
  },
  {
    test: /Failed to fetch|NetworkError|ERR_INTERNET|offline/i,
    say: () => 'the connection dropped',
  },
];

/**
 * Turn what the server said into something worth reading.
 *
 * The old panel put the raw string in a `window.alert`, so a check-constraint
 * violation arrived as a paragraph of Postgres naming a constraint nobody had
 * heard of. The original text is kept as `detail` — it is what makes a bug
 * report useful — but the sentence on screen is the one a person can act on.
 */
export function explain(err: unknown): { reason: string; detail: string } {
  const detail = messageOf(err);
  if (!detail) return { reason: 'it did not say why', detail: '' };
  for (const h of PG_HINTS) {
    if (h.test.test(detail)) return { reason: h.say(detail), detail };
  }
  // Unrecognised: show it, but only the first sentence. Postgres errors carry
  // a HINT and a DETAIL that push the useful half off the screen.
  const first = detail.split('\n')[0].trim();
  return { reason: first.length > 160 ? `${first.slice(0, 157)}…` : first, detail };
}

function messageOf(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err.trim();
  const e = err as any;
  const parts = [e.message, e.details, e.hint].filter(
    (x) => typeof x === 'string' && x.trim(),
  );
  return parts.join('\n').trim();
}

/** "Price on Nora Al-Sudairi could not be saved — your role is not allowed to change this." */
export function failureLine(f: WriteFailure, rowName?: string): string {
  const where = rowName ? ` on ${rowName}` : '';
  return `${f.label}${where} could not be saved — ${f.reason}.`;
}

/**
 * One sentence for a whole pile of failures.
 *
 * Ten bookings edited at once and the network drops: ten identical banners is
 * noise, so identical reasons are counted rather than repeated.
 */
export function failureSummary(failures: WriteFailure[]): string {
  if (!failures.length) return '';
  if (failures.length === 1) return failureLine(failures[0]);
  const reasons = new Map<string, number>();
  for (const f of failures) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1);
  if (reasons.size === 1) {
    const [reason] = [...reasons.keys()];
    return `${failures.length} changes could not be saved — ${reason}.`;
  }
  return `${failures.length} changes could not be saved.`;
}
