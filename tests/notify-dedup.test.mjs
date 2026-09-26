/**
 * One question, asked once.
 *
 * What is worth protecting here is small and entirely about round trips:
 *
 *   1. ONE READ PER BATCH, NOT ONE PER CANDIDATE. Four hundred links is
 *      two reads, not four hundred.
 *   2. NOTHING TO ASK, NOTHING ASKED. No candidates must mean no query.
 *   3. A HALF-READ SET IS NOT AN ANSWER. An error stops the walk and is
 *      reported, because a partial set makes the caller send duplicates.
 *   4. THE CALLER CAN ADD TO IT. Two candidates with the same link must
 *      still produce one notification, which the old per-candidate query
 *      got for free and this only gets if `sent` stays mutable.
 */
import { linkBatches, sentLinks, LINK_BATCH } from '../.test-build/notify-dedup.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/* -- batching ---------------------------------------------------------- */

eq('nothing batches to nothing', linkBatches([]), []);
eq('one link is one batch', linkBatches(['/a']), [['/a']]);
eq('duplicates collapse', linkBatches(['/a', '/a', '/b']), [['/a', '/b']]);
eq('blanks and nulls are dropped', linkBatches(['/a', '', '   ', null, undefined]), [['/a']]);
eq('links are trimmed', linkBatches([' /a ']), [['/a']]);

const many = Array.from({ length: 450 }, (_, i) => `/l/${i}`);
eq('450 links at the default size is 3 batches', linkBatches(many).map((b) => b.length), [200, 200, 50]);
eq('the batch size is honoured', linkBatches(many, 100).map((b) => b.length), [100, 100, 100, 100, 50]);
eq('a size of zero does not divide by zero', linkBatches(['/a', '/b'], 0).length, 2);
ok('the default is 200', LINK_BATCH === 200);

/* -- reading ----------------------------------------------------------- */

function reader(rows, err) {
  const calls = [];
  const fn = async (batch) => {
    calls.push(batch.length);
    if (err) return { data: null, error: { message: err } };
    return { data: rows.filter((r) => batch.includes(r.link)), error: null };
  };
  fn.calls = calls;
  return fn;
}

{
  const read = reader([{ link: '/a' }]);
  const { sent, error } = await sentLinks(['/a', '/b'], read);
  eq('the link that was sent comes back', Array.from(sent), ['/a']);
  ok('and the one that was not, does not', !sent.has('/b'));
  ok('no error', error === null);
  eq('one read for two links', read.calls, [2]);
}

{
  const read = reader(many.slice(0, 5).map((link) => ({ link })));
  const { sent } = await sentLinks(many, read);
  eq('450 links is three reads, not 450', read.calls, [200, 200, 50]);
  eq('and it found the five', sent.size, 5);
}

{
  const read = reader([]);
  const { sent, error } = await sentLinks([], read);
  eq('no candidates asks nothing', read.calls, []);
  eq('and answers empty', sent.size, 0);
  ok('with no error', error === null);
}

{
  const read = reader([], 'permission denied');
  const { sent, error } = await sentLinks(many, read);
  eq('an error stops the walk after the first batch', read.calls, [200]);
  eq('and is reported', error, 'permission denied');
  eq('with nothing claimed to be sent', sent.size, 0);
}

{
  // The property the per-candidate query used to give for free.
  const read = reader([]);
  const { sent } = await sentLinks(['/x', '/x'], read);
  ok('a fresh link is not in the set', !sent.has('/x'));
  sent.add('/x');
  ok('and once the caller marks it, the second copy is skipped', sent.has('/x'));
}

{
  // A row with no link must not put an empty string in the set, or every
  // candidate whose link failed to build would silently count as sent.
  const read = async () => ({ data: [{ link: null }, { link: '  ' }, { link: '/real' }], error: null });
  const { sent } = await sentLinks(['/real'], read);
  eq('only real links land in the set', Array.from(sent), ['/real']);
}

console.log(`notify-dedup: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
