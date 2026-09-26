/**
 * "Have we already said this?" - asked once, not once per candidate.
 *
 * The three notify crons (contracts/chase, finance/payments-due,
 * registry/expiry-check) all had the same shape:
 *
 *   for (const c of candidates) {
 *     const { count } = await admin.from('notifications')
 *       .select('id', { count: 'exact', head: true })
 *       .eq('link', link).gte('created_at', since);
 *     if (count) { skipped++; continue; }
 *     ...notify...
 *   }
 *
 * One round trip per candidate, before any work is done, and the expiry
 * one nests a second loop inside the first so it is candidates x
 * workspaces. That is fine with twenty rows and it is the shape that has
 * broken every screen in this codebase at four thousand: a Vercel cron has
 * a wall-clock limit, and when it is reached the run stops partway with
 * some people told and some not, which is worse than not running.
 *
 * The window (`since`) is fixed for the whole run, so every one of those
 * queries could have been one query. That is all this does: take every
 * link the run might use, ask once which of them already have a
 * notification, and answer from memory after that.
 *
 * WHY THE SET IS RETURNED RATHER THAN A PREDICATE: the caller adds to it.
 * The old code asked the database again for every candidate, so if two
 * candidates produced the SAME link, the second saw the first one's
 * insert and skipped. Reading once loses that unless the caller marks each
 * link as it sends it - `sent.add(link)` - which is why `sent` is a plain
 * mutable Set and not a frozen answer.
 */

/** PostgREST puts the filter in the URL, so `in(...)` has to stay short. */
export const LINK_BATCH = 200;

/** Distinct, non-empty links, in batches small enough for one `in(...)`. */
export function linkBatches(links: readonly string[], size: number = LINK_BATCH): string[][] {
  const n = Math.max(1, Math.trunc(size));
  const seen = new Set<string>();
  for (const l of links) {
    const s = String(l ?? '').trim();
    if (s) seen.add(s);
  }
  const all = Array.from(seen);
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += n) out.push(all.slice(i, i + n));
  return out;
}

export interface LinkRead {
  data: ReadonlyArray<{ link?: string | null }> | null;
  error: { message: string } | null;
}

/**
 * Which of these links have already been notified inside the window.
 *
 * `read` is handed one batch at a time and does the query; everything
 * about Supabase stays in the route, so this is testable with a function
 * that counts how many times it was called.
 *
 * An error stops the walk and comes back as a string - a half-read set
 * would make the caller send duplicates, which is the one outcome worse
 * than sending nothing.
 */
export async function sentLinks(
  links: readonly string[],
  // PromiseLike, not Promise: a PostgREST query builder is a thenable and
  // is not a Promise, so `(batch) => admin.from(...).select(...)` is
  // exactly the shape callers want to pass and would not type otherwise.
  read: (batch: string[]) => PromiseLike<LinkRead>,
  size: number = LINK_BATCH,
): Promise<{ sent: Set<string>; error: string | null }> {
  const sent = new Set<string>();
  for (const batch of linkBatches(links, size)) {
    const { data, error } = await read(batch);
    if (error) return { sent, error: error.message };
    for (const row of data ?? []) {
      const l = String(row?.link ?? '').trim();
      if (l) sent.add(l);
    }
  }
  return { sent, error: null };
}
