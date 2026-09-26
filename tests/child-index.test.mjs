/**
 * Grouping subtasks by campaign, once, instead of scanning for each one.
 *
 * THE BUG THIS FREEZES: three places in lib/dashboard-data.ts wanted "this
 * campaign's subtasks" and each wrote
 *
 *     allSubtasks.filter((x) => x.parent_task_id === p.id)
 *
 * INSIDE a loop over every campaign. It reads perfectly and it is
 * parents x subtasks. Measured on this machine, same rows either way:
 *
 *      200 campaigns x  2,000 subtasks     5ms  ->  0.5ms
 *    1,000 campaigns x 10,000 subtasks   127ms  ->  2.6ms
 *    2,000 campaigns x 20,000 subtasks   374ms  ->  2.6ms
 *
 * The index does not get slower as the campaign count grows, which is the
 * whole point: the filter version does, and it is on the main thread before
 * anything is drawn.
 *
 * What has to stay true for it to be a safe swap is only this: the rows a
 * campaign gets back, and their ORDER, must be exactly what the filter would
 * have produced. Both walk allSubtasks once, start to finish, so they are -
 * and the property test below holds them to it against the filter itself
 * rather than against a fixture somebody typed.
 */
import { subtasksByParent, childrenOf } from '../.test-build/dashboard-data.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/* -- the plain cases ------------------------------------------------- */

eq('nothing groups to nothing', [...subtasksByParent([]).keys()], []);
eq('undefined is not a crash', [...subtasksByParent(undefined).keys()], []);

const one = [{ id: 'a', parent_task_id: 'p1' }];
eq('one child, one key', [...subtasksByParent(one).keys()], ['p1']);
eq('and it is in there', subtasksByParent(one).get('p1').map((x) => x.id), ['a']);

const orphans = [
  { id: 'a', parent_task_id: 'p1' },
  { id: 'b', parent_task_id: null },
  { id: 'c', parent_task_id: '' },
  { id: 'd' },
];
eq('a subtask with no parent is not grouped under one',
  [...subtasksByParent(orphans).keys()], ['p1']);

eq('a campaign with no subtasks gets an empty array, not undefined',
  childrenOf(subtasksByParent(one), 'p-nobody'), []);
ok('and that array can be summed without a guard',
  Array.isArray(childrenOf(new Map(), 'anything')));

/* -- the property that makes the swap safe --------------------------- */

// Against the filter itself, over generated data: same rows, same order,
// for every campaign - including the ones with nothing.
let seed = 99;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

let mismatches = 0;
for (let draw = 0; draw < 25; draw++) {
  const nP = 1 + Math.floor(rnd() * 12);
  const parents = Array.from({ length: nP }, (_, i) => ({ id: `p${i}` }));
  const subs = [];
  const nS = Math.floor(rnd() * 60);
  for (let i = 0; i < nS; i++) {
    // sometimes a parent that does not exist, sometimes none at all
    const r = rnd();
    const parent = r < 0.1 ? null : r < 0.2 ? `ghost${Math.floor(rnd() * 3)}`
      : `p${Math.floor(rnd() * nP)}`;
    subs.push({ id: `s${draw}-${i}`, parent_task_id: parent });
  }
  const index = subtasksByParent(subs);
  for (const p of parents) {
    const byFilter = subs.filter((x) => x.parent_task_id === p.id).map((x) => x.id);
    const byIndex = childrenOf(index, p.id).map((x) => x.id);
    if (JSON.stringify(byFilter) !== JSON.stringify(byIndex)) {
      mismatches += 1;
      if (mismatches <= 3) {
        console.log(`FAIL draw ${draw} campaign ${p.id}\n  filter ${JSON.stringify(byFilter)}`
          + `\n  index  ${JSON.stringify(byIndex)}`);
      }
    }
  }
}
eq('the index agrees with the filter it replaced, over 25 generated draws', mismatches, 0);

// A ghost parent - a subtask pointing at a campaign not in scope - must not
// appear under any real campaign. It is in the index under its own key and
// nobody asks for that key, which is correct and worth stating.
const ghosts = subtasksByParent([{ id: 'x', parent_task_id: 'not-in-scope' }]);
eq('a subtask of an out-of-scope campaign reaches no campaign in scope',
  childrenOf(ghosts, 'p1'), []);

console.log(`child-index: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
