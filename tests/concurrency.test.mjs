/** lib/concurrency.ts - run work a few at a time. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mapWithConcurrency, REQUEST_CONCURRENCY } = require('../.test-build/concurrency.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async () => {
  eq('the cap is three', REQUEST_CONCURRENCY, 3);

  // never more than `limit` in flight, and it does drive up to the limit.
  let inFlight = 0, peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  const out = await mapWithConcurrency(items, 3, async (n) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await tick(5);
    inFlight -= 1;
    return n * 2;
  });
  eq('results come back in order', out, items.map((n) => n * 2));
  eq('never exceeded the cap of 3', peak <= 3, true);
  eq('and actually reached it', peak, 3);

  // fewer items than the cap: fine.
  eq('two items under a cap of 3', await mapWithConcurrency([1, 2], 3, async (n) => n + 1), [2, 3]);
  eq('empty input', await mapWithConcurrency([], 3, async () => 1), []);
  eq('a missing list is empty', await mapWithConcurrency(undefined, 3, async () => 1), []);

  // a cap below 1 is clamped to 1 (sequential), not an infinite loop.
  let seqPeak = 0, seqIn = 0;
  await mapWithConcurrency([1, 2, 3], 0, async () => { seqIn += 1; seqPeak = Math.max(seqPeak, seqIn); await tick(2); seqIn -= 1; });
  eq('a cap of 0 runs one at a time', seqPeak, 1);

  // order holds even when later items finish sooner.
  const staggered = await mapWithConcurrency([30, 5, 15], 3, async (ms) => { await tick(ms); return ms; });
  eq('order is input order, not finish order', staggered, [30, 5, 15]);

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
run();