'use client';

import { useCallback, useRef, useState } from 'react';
import { updateTaskFields } from '@/hooks/use-workflow';
import {
  enqueue, settle, withPending, pendingCount, explain,
  type Queue, type Write, type WriteFailure,
} from '@/lib/pending-writes';

let seq = 0;
/** A monotonic stamp. Not a clock — two writes in the same millisecond must differ. */
function stamp(): number { return ++seq; }

export interface OptimisticSave {
  /** Change a field now, save it behind the screen. */
  set: (id: string, field: string, value: unknown, opts?: {
    label?: string; was?: unknown; rowName?: string;
  }) => void;
  /** Several fields on one row, as one write. */
  setMany: (id: string, fields: Record<string, unknown>, opts?: {
    labels?: Record<string, string>; was?: Record<string, unknown>; rowName?: string;
  }) => void;
  /** A row as the user believes it to be: the server's copy plus what is in flight. */
  view: <T extends Record<string, any>>(row: T) => T;
  /** Same, for a list. */
  viewAll: <T extends Record<string, any>>(rows: T[]) => T[];
  /** How many writes have not landed. */
  inFlight: number;
  /** What was refused, and why. */
  failures: WriteFailure[];
  /** Send the failed writes again. */
  retry: () => void;
  /** Give up on them and put the old values back. */
  discard: () => void;
}

/**
 * Save without waiting.
 *
 * The page used to `await` a write and then `await` a refetch for every single
 * field, so typing a price and tabbing away froze twice. Now the value lands
 * on screen immediately, the write goes out behind it, and the page only
 * refetches once things go quiet — one refetch for a burst of edits instead of
 * one per keystroke.
 *
 * When a write is refused the value goes back to what it was and the failure
 * is named: which field, on which row, and what the server actually said. It
 * is never silently kept on screen, because a number that looks saved and is
 * not is worse than an error.
 */
export function useOptimisticSave(onSettled?: () => void | Promise<void>): OptimisticSave {
  const [queue, setQueue] = useState<Queue>({});
  const [failures, setFailures] = useState<WriteFailure[]>([]);
  const rowNames = useRef<Map<string, string>>(new Map());
  // One refetch after a burst, not one per field.
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRefetch = useCallback(() => {
    if (!onSettled) return;
    if (quiet.current) clearTimeout(quiet.current);
    quiet.current = setTimeout(() => { void onSettled(); }, 600);
  }, [onSettled]);

  const send = useCallback((write: Write, fields: Record<string, unknown>) => {
    updateTaskFields(write.id, fields as any)
      .then(() => {
        setQueue((q) => settle(q, write.id, write.field, write.at));
        scheduleRefetch();
      })
      .catch((err) => {
        const { reason, detail } = explain(err);
        // Roll back: drop the write so the row reads as the server has it.
        setQueue((q) => settle(q, write.id, write.field, write.at));
        setFailures((f) => [
          ...f.filter((x) => !(x.id === write.id && x.field === write.field)),
          { id: write.id, field: write.field, label: write.label,
            value: write.value, reason, at: write.at },
        ]);
        // eslint-disable-next-line no-console
        console.error('[campaign] save refused', write.id, write.field, detail);
      });
  }, [scheduleRefetch]);

  const set = useCallback((
    id: string, field: string, value: unknown,
    opts?: { label?: string; was?: unknown; rowName?: string },
  ) => {
    if (opts?.rowName) rowNames.current.set(id, opts.rowName);
    const write: Write = {
      id, field, value, was: opts?.was ?? null,
      label: opts?.label ?? field, at: stamp(),
    };
    setQueue((q) => enqueue(q, write));
    setFailures((f) => f.filter((x) => !(x.id === id && x.field === field)));
    send(write, { [field]: value });
  }, [send]);

  const setMany = useCallback((
    id: string, fields: Record<string, unknown>,
    opts?: { labels?: Record<string, string>; was?: Record<string, unknown>; rowName?: string },
  ) => {
    if (opts?.rowName) rowNames.current.set(id, opts.rowName);
    const at = stamp();
    const keys = Object.keys(fields);
    if (!keys.length) return;

    setQueue((q) => keys.reduce((acc, field) => enqueue(acc, {
      id, field, value: fields[field], was: opts?.was?.[field] ?? null,
      label: opts?.labels?.[field] ?? field, at,
    }), q));
    setFailures((f) => f.filter((x) => !(x.id === id && keys.includes(x.field))));

    // One request for the whole group — two columns that must agree (a length
    // and its unit) would otherwise be refused by the pair constraint when the
    // first arrives on its own.
    updateTaskFields(id, fields as any)
      .then(() => {
        setQueue((q) => keys.reduce((acc, field) => settle(acc, id, field, at), q));
        scheduleRefetch();
      })
      .catch((err) => {
        const { reason, detail } = explain(err);
        setQueue((q) => keys.reduce((acc, field) => settle(acc, id, field, at), q));
        setFailures((f) => [
          ...f.filter((x) => !(x.id === id && keys.includes(x.field))),
          ...keys.map((field) => ({
            id, field, label: opts?.labels?.[field] ?? field,
            value: fields[field], reason, at,
          })),
        ]);
        // eslint-disable-next-line no-console
        console.error('[campaign] save refused', id, keys.join(', '), detail);
      });
  }, [scheduleRefetch]);

  const view = useCallback(
    <T extends Record<string, any>>(row: T): T => withPending(row, queue),
    [queue],
  );
  const viewAll = useCallback(
    <T extends Record<string, any>>(rows: T[]): T[] => rows.map((r) => withPending(r, queue)),
    [queue],
  );

  const retry = useCallback(() => {
    const again = failures;
    setFailures([]);
    for (const f of again) {
      set(f.id, f.field, f.value, { label: f.label, rowName: rowNames.current.get(f.id) });
    }
  }, [failures, set]);

  const discard = useCallback(() => {
    setFailures([]);
    void onSettled?.();
  }, [onSettled]);

  return {
    set, setMany, view, viewAll,
    inFlight: pendingCount(queue),
    failures, retry, discard,
  };
}

/** The name to put in a failure sentence, when the caller recorded one. */
export type { WriteFailure };
