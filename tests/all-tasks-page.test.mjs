/**
 * pageRows - the All Tasks register renders one page at a time.
 *
 * Four thousand campaigns was four thousand table rows in a single render,
 * which froze the screen. pageRows slices the sorted/filtered rows to a page
 * and hands back the numbers the pager shows. It clamps the page, so a filter
 * change that strands you past the end lands on the last real page instead of
 * an empty table.
 */
import { pageRows, PAGE_SIZE } from '../.test-build/all-tasks.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };

const seq = (n) => Array.from({ length: n }, (_, i) => i); // [0,1,2,...]

// Default page size is 100.
ok('PAGE_SIZE is 100', PAGE_SIZE === 100);

// Empty input: one page, no rows, counts read 0 of 0.
{
  const p = pageRows([], 0);
  ok('empty rows', p.rows.length === 0);
  ok('empty pageCount is 1', p.pageCount === 1);
  ok('empty total', p.total === 0);
  ok('empty from', p.from === 0);
  ok('empty to', p.to === 0);
}

// Fewer than one page: everything on page 0.
{
  const p = pageRows(seq(30), 0, 100);
  ok('short page rows', p.rows.length === 30);
  ok('short page pageCount', p.pageCount === 1);
  ok('short page from', p.from === 1);
  ok('short page to', p.to === 30);
}

// Exactly one full page.
{
  const p = pageRows(seq(100), 0, 100);
  ok('full page rows', p.rows.length === 100);
  ok('full page pageCount', p.pageCount === 1);
  ok('full page to', p.to === 100);
}

// Just over one page: two pages, first is full.
{
  const p0 = pageRows(seq(101), 0, 100);
  ok('101 page0 rows', p0.rows.length === 100);
  ok('101 pageCount', p0.pageCount === 2);
  ok('101 page0 first row', p0.rows[0] === 0);
  ok('101 page0 from/to', p0.from === 1 && p0.to === 100);

  const p1 = pageRows(seq(101), 1, 100);
  ok('101 page1 rows', p1.rows.length === 1);
  ok('101 page1 first row', p1.rows[0] === 100);
  ok('101 page1 from/to', p1.from === 101 && p1.to === 101);
}

// A middle page reports the right window.
{
  const p = pageRows(seq(250), 1, 100);
  ok('mid page rows', p.rows.length === 100);
  ok('mid page first row', p.rows[0] === 100);
  ok('mid page from/to', p.from === 101 && p.to === 200);
  ok('mid pageCount', p.pageCount === 3);
}

// Clamp: a page past the end lands on the last real page.
{
  const p = pageRows(seq(250), 99, 100);
  ok('clamp page index', p.page === 2);
  ok('clamp rows', p.rows.length === 50);
  ok('clamp from/to', p.from === 201 && p.to === 250);
}

// Clamp: a negative page lands on page 0.
{
  const p = pageRows(seq(250), -5, 100);
  ok('clamp negative page index', p.page === 0);
  ok('clamp negative first row', p.rows[0] === 0);
}

// A non-integer or NaN page does not throw or produce a bad slice.
{
  const p = pageRows(seq(250), Number.NaN, 100);
  ok('NaN page falls to 0', p.page === 0 && p.rows.length === 100);
  const q = pageRows(seq(250), 1.9, 100);
  ok('float page floors', q.page === 1 && q.from === 101);
}

// A zero or negative size falls back to the default rather than dividing by zero.
{
  const p = pageRows(seq(150), 0, 0);
  ok('zero size falls back', p.pageCount === 2 && p.rows.length === 100);
}

console.log(`all-tasks-page: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
