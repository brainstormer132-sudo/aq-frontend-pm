/** lib/attention.ts - folding repeats. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { groupAttention, groupNoun } = require('../.test-build/attention.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const item = (kind, title, key, severity = 'tidy', days = 0) => ({
  key, kind, severity, taskId: key, title, context: 'C', message: 'm', days,
});

// The reported case: nine "priced, no contract" for one creator fold to one.
const leen = Array.from({ length: 9 }, (_, i) =>
  item('contract_missing', 'Leen AlSharif', `cm:${i}`));
const g1 = groupAttention(leen);
eq('nine identical fold to one group', g1.length, 1);
eq('and the group counts nine', g1[0].count, 9);
eq('the group carries all nine to expand', g1[0].items.length, 9);
eq('and leads with the first', g1[0].lead.key, 'cm:0');

// same creator, but genuinely different problems do not fold together.
const mixed = groupAttention([
  item('contract_missing', 'Leen AlSharif', 'a'),
  item('price_missing', 'Leen AlSharif', 'b'),
  item('contract_missing', 'Leen AlSharif', 'c'),
]);
eq('two kinds, two groups', mixed.length, 2);
eq('contract_missing folded its two', mixed[0].count, 2);
eq('price_missing stands alone', mixed[1].count, 1);

// different creators do not fold.
eq('different subjects stay apart',
  groupAttention([item('contract_missing', 'Leen', 'a'), item('contract_missing', 'Maya', 'b')]).length, 2);

// date-stamped events never fold, even same subject + kind.
const overdue = groupAttention([
  item('overdue', 'Campaign X', 'o1', 'urgent', 5),
  item('overdue', 'Campaign X', 'o2', 'urgent', 2),
]);
eq('overdue never folds - each date is its own line', overdue.length, 2);

// order is preserved: first-seen group comes first.
const ordered = groupAttention([
  item('no_vendors', 'B', 'nv1'),
  item('contract_missing', 'A', 'cm1'),
  item('no_vendors', 'B', 'nv2'),
]);
eq('group order follows first appearance', ordered.map((g) => g.key.split('|')[0]), ['no_vendors', 'contract_missing']);

eq('empty in, empty out', groupAttention([]), []);
eq('missing in, empty out', groupAttention(undefined), []);

// case and whitespace in the subject do not split a group.
eq('case-insensitive subject',
  groupAttention([item('contract_missing', 'Leen', 'a'), item('contract_missing', ' leen ', 'b')]).length, 1);

eq('the noun for a booking', groupNoun('contract_missing', 9), '9 bookings');
eq('singular reads right', groupNoun('contract_missing', 1), '1 booking');
eq('a campaign-level noun', groupNoun('no_vendors', 3), '3 campaigns');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);