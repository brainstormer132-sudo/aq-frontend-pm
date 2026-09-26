/**
 * Where a slow screen's time went, as a number rather than a feeling.
 *
 * WHAT THIS PROTECTS. The app has timed every network read for months and
 * said so only when NODE_ENV was not production - which is precisely where
 * the problem is not. Two performance fixes this week were aimed by reading
 * the code very carefully, and the FIRST ONE WAS AIMED AT THE WRONG HALF:
 * a pager was added to a screen whose five minutes were spent before a
 * single row was drawn.
 *
 * So the totals have to be right and the report has to be readable, because
 * the next fix will be aimed with them.
 *
 *   1. ADDING UP IS ADDING UP. Calls, total, worst - per label.
 *   2. SLOWEST FIRST, ALWAYS THE SAME WAY. A report that reshuffles between
 *      runs on the same data is one nobody trusts.
 *   3. IT NEVER THROWS. It is read when something is already going wrong;
 *      a report that crashes on a missing label is worse than no report.
 */
import { record, ranked, report } from '../.test-build/perf-report.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/* -- adding up ------------------------------------------------------- */

{
  const m = new Map();
  record(m, 'a', 100);
  record(m, 'a', 250);
  record(m, 'b', 40);
  eq('two labels', ranked(m).map((r) => r.label), ['a', 'b']);
  eq('calls counted', m.get('a').calls, 2);
  eq('total added', m.get('a').totalMs, 350);
  eq('worst kept', m.get('a').maxMs, 250);
  eq('and the worst is not the last', record(new Map([['x', { label: 'x', calls: 1, totalMs: 900, maxMs: 900 }]]), 'x', 5).get('x').maxMs, 900);
}

{
  const m = new Map();
  record(m, 'a', 7.6);
  eq('milliseconds are whole numbers', m.get('a').totalMs, 8);
  record(m, 'a', -3);
  eq('a negative duration counts as zero, not as time travel', m.get('a').totalMs, 8);
  record(m, 'a', NaN);
  eq('and so does a NaN', m.get('a').totalMs, 8);
  eq('but the call still counted', m.get('a').calls, 3);
}

{
  const m = new Map();
  record(m, '', 10);
  record(m, null, 10);
  record(m, '   ', 10);
  eq('every unlabelled read lands in one bucket', [...m.keys()], ['(unlabelled)']);
  eq('and they add up', m.get('(unlabelled)').calls, 3);
}

/* -- the order ------------------------------------------------------- */

{
  const m = new Map();
  record(m, 'slow', 500);
  record(m, 'fast', 10);
  record(m, 'middling', 100);
  eq('slowest first', ranked(m).map((r) => r.label), ['slow', 'middling', 'fast']);
}

{
  // Same total: more calls first, then alphabetical. The point is that it
  // is DECIDED, so two runs over the same data print the same table.
  const m = new Map();
  record(m, 'zebra', 50);
  record(m, 'apple', 25); record(m, 'apple', 25);
  eq('a tie breaks on calls, then on name', ranked(m).map((r) => r.label), ['apple', 'zebra']);
  const again = new Map();
  record(again, 'apple', 25); record(again, 'apple', 25);
  record(again, 'zebra', 50);
  eq('and insertion order does not change it',
    ranked(again).map((r) => r.label), ['apple', 'zebra']);
}

/* -- the report ------------------------------------------------------ */

{
  eq('nothing timed says so, rather than printing an empty table',
    report(new Map(), 0, 0), 'aq perf: nothing timed yet on this page.');
}

{
  const m = new Map();
  record(m, 'useDashboardRows subtasks', 1200);
  record(m, 'useDashboardRows subtasks', 800);
  record(m, 'financeDocuments', 90);
  const text = report(m, 3, 11);
  ok('it says how many reads went to the network', /3 network reads/.test(text));
  ok('and how many were cached', /11 served from cache/.test(text));
  ok('and the total', /2090ms in total/.test(text));
  ok('the slowest read is above the faster one',
    text.indexOf('useDashboardRows subtasks') < text.indexOf('financeDocuments'));
  ok('the worst single call is there, not just the total', /1200ms/.test(text));
  ok('every line is the same width, so it survives a copy and paste', (() => {
    const lines = text.split('\n').slice(1);
    return new Set(lines.map((l) => l.length)).size === 1;
  })());
  ok('one read reads as singular', /1 network read,/.test(report(m, 1, 0)));
}

console.log(`perf-report: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
