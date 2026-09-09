/**
 * Run async work a few at a time, not all at once.
 *
 * The tracking loader fanned every batch out together - `Promise.all` over
 * every 100-id chunk - so 350 campaigns hit Supabase in one burst of eight
 * paging reads, and the adopt step fired one write per placeholder at once.
 * Siraj asked to lower it to three at a time. This keeps at most `limit`
 * calls in flight, starts the next the moment one finishes, and returns the
 * results in the original order so callers that zip them back up still can.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const list = Array.from(items ?? []);
  const results = new Array<R>(list.length);
  let cap = Math.floor(Number(limit));
  if (!isFinite(cap) || cap < 1) cap = 1;

  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      results[i] = await fn(list[i], i);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(cap, list.length); w += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/** How many requests the app will keep in flight at once. Siraj, three. */
export const REQUEST_CONCURRENCY = 3;