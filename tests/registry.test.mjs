/** lib/registry.ts - the register's pure helpers. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { pageSlice, PAGE_SIZES, DEFAULT_PAGE_SIZE } = require('../.test-build/registry.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);

eq('default is 10, and it is the first choice', [DEFAULT_PAGE_SIZE, PAGE_SIZES[0]], [10, 10]);
eq('the sizes on offer', [...PAGE_SIZES], [10, 50, 100]);

const first = pageSlice(nums(1815), 1, 10);
eq('a full first page of ten', [first.rows.length, first.from, first.to], [10, 1, 10]);
eq('and it knows the whole', [first.page, first.pages, first.total], [1, 182, 1815]);
eq('the tenth page starts at 91', pageSlice(nums(1815), 10, 10).from, 91);
const last = pageSlice(nums(1815), 182, 10);
eq('the last page is the remainder', [last.rows.length, last.from, last.to], [5, 1811, 1815]);

eq('a page past the end clamps', pageSlice(nums(1815), 999, 10).page, 182);
eq('page zero clamps to one', pageSlice(nums(1815), 0, 10).page, 1);
eq('a negative page clamps to one', pageSlice(nums(1815), -3, 10).page, 1);
eq('nonsense clamps to one', pageSlice(nums(1815), 'x', 10).page, 1);

// the case that matters after a filter: many pages become one.
const shrunk = pageSlice(nums(7), 12, 10);
eq('a shrunken list clamps the page', [shrunk.page, shrunk.pages, shrunk.rows.length], [1, 1, 7]);

eq('an empty list is one empty page', pageSlice([], 1, 10), { rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
eq('and a missing one', pageSlice(null, 1, 10).total, 0);
eq('size 0 means all of it', pageSlice(nums(1815), 1, 0).rows.length, 1815);
eq('size 100 gives a hundred', pageSlice(nums(1815), 1, 100).rows.length, 100);
eq('exactly one page when it fits', pageSlice(nums(50), 1, 50).pages, 1);
eq('51 rows is two pages of fifty', pageSlice(nums(51), 1, 50).pages, 2);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
