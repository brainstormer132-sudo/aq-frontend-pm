/**
 * Where a slow screen's time actually went.
 *
 * -- WHY --------------------------------------------------------------
 *
 * "Vendor performance takes genuinely 5 minutes to open" was true, and the
 * first fix aimed at the wrong half of it because nobody could see which
 * half. The second guess was right, but it was still a guess until the
 * shape of the code was read carefully enough to be sure.
 *
 * The app already times every network read. It just never says so where
 * anybody can hear it: the warning is behind
 * `process.env.NODE_ENV !== 'production'`, which is exactly where the
 * problem is not. On the deployed site the instrumentation is silent.
 *
 * So: keep a running total per read, and let somebody print it. Then
 * "Data is slow" becomes a table with a number beside each query, and the
 * next fix is aimed rather than guessed.
 *
 * This file is the pure part - the arithmetic and the formatting - so it
 * can be tested without a browser or a database.
 */

export interface Mark {
  /** What the read was called at its call site. */
  label: string;
  /** How many times it went to the network. Cache hits are not counted. */
  calls: number;
  /** Every call added up. */
  totalMs: number;
  /** The worst single one. */
  maxMs: number;
}

/** Fold one timing into the running totals. Returns the same map, for chaining. */
export function record(marks: Map<string, Mark>, label: string, ms: number): Map<string, Mark> {
  const key = String(label ?? '').trim() || '(unlabelled)';
  const took = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  const cur = marks.get(key);
  if (cur) {
    cur.calls += 1;
    cur.totalMs += took;
    if (took > cur.maxMs) cur.maxMs = took;
  } else {
    marks.set(key, { label: key, calls: 1, totalMs: took, maxMs: took });
  }
  return marks;
}

/**
 * Slowest first, because that is the only order anybody reads.
 *
 * Ties break on calls then label, so the same data always prints the same
 * way - a report that reshuffles between runs is one nobody trusts.
 */
export function ranked(marks: Map<string, Mark>): Mark[] {
  return [...marks.values()].sort((a, b) => (b.totalMs - a.totalMs)
    || (b.calls - a.calls)
    || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/**
 * The report, as text somebody can paste into a message.
 *
 * Fixed-width on purpose: it is read in a console and copied into chat,
 * and a table that relies on the console's own formatting loses its shape
 * on the way.
 */
export function report(marks: Map<string, Mark>, queries: number, cacheHits: number): string {
  const rows = ranked(marks);
  if (!rows.length) return 'aq perf: nothing timed yet on this page.';

  const total = rows.reduce((a, r) => a + r.totalMs, 0);
  const w = Math.max(5, ...rows.map((r) => r.label.length));
  const out: string[] = [];
  out.push(`aq perf: ${queries} network read${queries === 1 ? '' : 's'}, `
    + `${cacheHits} served from cache, ${total}ms in total`);
  out.push(`${'query'.padEnd(w)}  ${'calls'.padStart(5)}  ${'total'.padStart(8)}  ${'worst'.padStart(8)}`);
  for (const r of rows) {
    out.push(`${r.label.padEnd(w)}  ${String(r.calls).padStart(5)}  `
      + `${(`${r.totalMs}ms`).padStart(8)}  ${(`${r.maxMs}ms`).padStart(8)}`);
  }
  return out.join('\n');
}
