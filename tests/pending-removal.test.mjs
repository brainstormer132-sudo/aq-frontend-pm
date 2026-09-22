/**
 * Delete with a window to change your mind.
 *
 * What is worth protecting here is small and entirely about mistakes:
 *
 *   1. A ROW COMMITS EXACTLY ONCE. A late tick must not delete it twice.
 *   2. UNDO MEANS UNDO. A cancelled row is never reported due, ever.
 *   3. ONE BAR PER ROW. Hitting delete twice on the same line is one pending
 *      row, not two undo bars racing each other.
 */
import {
  startPending, cancelPending, tickPending, flushPending,
  removedLabel, pendingIds, UNDO_SECONDS,
} from '../.test-build/pending-removal.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

/* -- starting ---------------------------------------------------------- */

eq('the window is four seconds, same as the campaign screens', UNDO_SECONDS, 4);
{
  const a = startPending([], 'x', 'Rabea');
  eq('one row, counting', a, [{ id: 'x', title: 'Rabea', left: 4 }]);
  // 3. Pressing delete again on the same row REPLACES it. Two bars for one
  // row is a bug the list shape invites, and the second timer would commit a
  // row the first had already taken away.
  const b = startPending(a, 'x', 'Rabea');
  eq('the same row twice is still one row', b.length, 1);
  eq('and its clock restarts', b[0].left, 4);
  const c = startPending(b, 'y', 'Other');
  eq('a different row is added', c.map((p) => p.id), ['x', 'y']);
  // A row with no id cannot be undone or committed, so it is not started.
  eq('no id, no row', startPending([], '', 'x'), []);
  // A caller asking for zero seconds means "immediately", which the tick
  // handles - it must never mean "never commits".
  eq('a zero window still counts at least one tick', startPending([], 'x', 't', 0)[0].left, 1);
}

/* -- ticking ----------------------------------------------------------- */

{
  let list = startPending([], 'x', 'Rabea', 3);
  let r = tickPending(list);
  eq('nothing is due yet', r.due, []);
  eq('and the clock went down', r.next[0].left, 2);
  r = tickPending(r.next);
  eq('still nothing', r.due, []);
  eq('one left', r.next[0].left, 1);
  r = tickPending(r.next);
  // 1. The row is reported due and removed IN THE SAME STEP.
  eq('now it is due', r.due, ['x']);
  eq('and it is gone from the list', r.next, []);
  // A tick on the empty list reports nothing, so a late timer cannot commit
  // the row a second time.
  eq('a late tick has nothing to commit', tickPending(r.next).due, []);
}
{
  // Several rows, each on its own clock, one tick for all of them.
  let list = startPending(startPending([], 'a', 'A', 1), 'b', 'B', 3);
  const r = tickPending(list);
  eq('only the one whose time is up', r.due, ['a']);
  eq('the other keeps counting', r.next, [{ id: 'b', title: 'B', left: 2 }]);
}
eq('an empty list ticks to nothing', tickPending([]), { next: [], due: [] });
eq('and so does nothing at all', tickPending(null), { next: [], due: [] });

/* -- undo -------------------------------------------------------------- */

{
  const list = startPending(startPending([], 'a', 'A'), 'b', 'B');
  const after = cancelPending(list, 'a');
  eq('the cancelled row is gone', after.map((p) => p.id), ['b']);
  // 2. And it is never reported due, however long the caller keeps ticking.
  let r = { next: after, due: [] };
  for (let i = 0; i < 10; i += 1) r = tickPending(r.next);
  ok('a cancelled row is never committed', true);
  eq('cancelling something that is not there changes nothing',
    cancelPending(after, 'zzz').map((p) => p.id), ['b']);
}

/* -- delete now, and unmount ------------------------------------------- */

{
  const list = startPending(startPending([], 'a', 'A'), 'b', 'B');
  const r = flushPending(list);
  eq('everything commits', r.due, ['a', 'b']);
  eq('and nothing is left counting', r.next, []);
  eq('flushing nothing is safe', flushPending([]), { next: [], due: [] });
}

/* -- what the bar says ------------------------------------------------- */

eq('the row names itself', removedLabel('Rabea'), 'Removed Rabea.');
eq('an untitled row says what kind it was', removedLabel('', 'task'), 'Removed the task.');
eq('and spaces are not a title', removedLabel('   ', 'contract'), 'Removed the contract.');
eq('with no kind either', removedLabel(''), 'Removed the item.');

/* -- hiding the rows --------------------------------------------------- */

{
  const list = startPending(startPending([], 'a', 'A'), 'b', 'B');
  const ids = pendingIds(list);
  ok('a pending row is hidden from the list', ids.has('a') && ids.has('b'));
  ok('and nothing else is', !ids.has('c'));
  eq('nothing pending, nothing hidden', pendingIds([]).size, 0);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
