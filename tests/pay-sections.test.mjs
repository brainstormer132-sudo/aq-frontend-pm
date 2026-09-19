import {
  PAYMENT_SECTIONS, hasAdvance, inPaymentSection, paymentSectionRows,
  paymentSectionCounts, paymentRemaining, payStateOf,
  normalizePayState, expectedAdvance, buildPaymentRows, sortByDue,
} from '../.test-build/finance.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

// Payment sections: All / Partial paid / Overdue / Advanced
{
  eq('four sections, All first, Overdue before Advanced',
    PAYMENT_SECTIONS.map((s) => s.key), ['all', 'partial', 'overdue', 'advanced']);

  const rows = [
    { state: 'paid',    advance: 0 },
    { state: 'partial', advance: 0 },
    { state: 'unpaid',  advance: 30000, advanceDate: '2026-03-01' },
    { state: 'partial', advance: 50000 },
    { state: 'unpaid',  advance: 0 },
  ];

  eq('All keeps everything', paymentSectionRows(rows, 'all').length, 5);
  eq('partial count', paymentSectionRows(rows, 'partial').length, 2);
  eq('advanced count', paymentSectionRows(rows, 'advanced').length, 2);

  ok('partial row is in partial', inPaymentSection({ state: 'partial' }, 'partial'));
  ok('paid row is NOT in partial', !inPaymentSection({ state: 'paid' }, 'partial'));
  ok('advance>0 is advanced', inPaymentSection({ state: 'unpaid', advance: 1 }, 'advanced'));
  ok('advance 0 is not advanced', !inPaymentSection({ state: 'partial', advance: 0 }, 'advanced'));
  ok('a partial with an advance is in BOTH', inPaymentSection(rows[3], 'partial') && inPaymentSection(rows[3], 'advanced'));

  ok('hasAdvance reads the amount', hasAdvance({ advance: 5 }) && !hasAdvance({ advance: 0 }) && !hasAdvance({}));

  eq('section counts', paymentSectionCounts(rows), { all: 5, partial: 2, overdue: 0, advanced: 2 });

  ok('overdue row is in overdue', inPaymentSection({ state: 'unpaid', overdue: true }, 'overdue'));
  ok('non-overdue row is NOT in overdue', !inPaymentSection({ state: 'unpaid', overdue: false }, 'overdue'));
  ok('missing overdue flag is not overdue', !inPaymentSection({ state: 'unpaid' }, 'overdue'));
}

// Remaining balance + amount-derived state
{
  eq('remaining = billed - paid', paymentRemaining(100000, 40000), 60000);
  eq('nothing paid owes it all', paymentRemaining(100000, 0), 100000);
  eq('paid in full owes nothing', paymentRemaining(100000, 100000), 0);
  eq('overpayment floors at zero', paymentRemaining(100000, 120000), 0);
  eq('halala rounding', paymentRemaining(100.004, 0), 100);

  eq('nothing paid => unpaid', payStateOf(100, 0), 'unpaid');
  eq('paid in full => paid', payStateOf(100, 100), 'paid');
  eq('some paid => partial', payStateOf(100, 40), 'partial');
  eq('no bill, no state to force', payStateOf(0, 0), 'unpaid');
}

// Recorded status normalized to three buckets
{
  eq('paid', normalizePayState('paid'), 'paid');
  eq('partial', normalizePayState('partial'), 'partial');
  eq('partly variant', normalizePayState('Partly paid'), 'partial');
  eq('pending is unpaid', normalizePayState('pending'), 'unpaid');
  eq('blank is null (fall back to amounts)', normalizePayState(''), null);
  eq('unknown is null', normalizePayState('weird'), null);
}

// Expected advance from the client contract terms
{
  eq('in advance expects the whole bill', expectedAdvance(100000, 'in_advance', null), 100000);
  eq('split expects the up-front share', expectedAdvance(100000, 'split', 50), 50000);
  eq('split clamps a silly pct', expectedAdvance(100000, 'split', 250), 100000);
  eq('on delivery expects nothing', expectedAdvance(100000, 'on_delivery', null), 0);
  eq('net days expects nothing', expectedAdvance(100000, 'net_days', null), 0);
  eq('no bill, no expectation', expectedAdvance(0, 'in_advance', null), 0);
}

// Building rows: recorded status wins, else amounts; remaining + expected carried
{
  const rows = buildPaymentRows([
    { taskId: 't1', title: 'Ramadan', brand: 'Sunbulah', billed: 100000, paid: 40000,
      status: 'partial', advance: 40000, advanceDate: '2026-03-01',
      paymentTerms: 'split', paymentSplitPct: 40 },
    { taskId: 't2', title: 'Eid', billed: 50000, paid: 0, status: '', paymentTerms: 'in_advance' },
    { taskId: '', title: 'no id dropped', billed: 1, paid: 0 },
  ]);
  eq('id-less row dropped', rows.length, 2);
  eq('recorded status wins', rows[0].state, 'partial');
  eq('remaining carried', rows[0].remaining, 60000);
  eq('advance carried', rows[0].advance, 40000);
  eq('expected advance from split', rows[0].expectedAdvance, 40000);
  eq('blank status derives from amounts', rows[1].state, 'unpaid');
  eq('title falls back to brand', buildPaymentRows([{ taskId: 't', brand: 'B', billed: 1, paid: 0 }])[0].title, 'B');
  eq('sections over built rows', paymentSectionCounts(rows), { all: 2, partial: 1, overdue: 0, advanced: 1 });
}

// Overpayment (and a stale recorded status) must read as paid, not partial.
{
  // Overpaid with NO recorded status: amounts alone -> paid.
  const over = buildPaymentRows([
    { taskId: 't1', billed: 100000, paid: 120000 },
  ]);
  eq('overpaid, no status -> paid', over[0].state, 'paid');
  eq('overpaid remaining floors at zero', over[0].remaining, 0);

  // Overpaid but the recorded status is a stale "partial" from before the
  // final payment: the money wins, so it is paid, not partial.
  const stale = buildPaymentRows([
    { taskId: 't2', billed: 100000, paid: 120000, status: 'partial' },
  ]);
  eq('overpaid + stale partial -> paid', stale[0].state, 'paid');

  // Exactly paid in full with a stale "partly paid" status -> paid.
  const exact = buildPaymentRows([
    { taskId: 't3', billed: 100000, paid: 100000, status: 'Partly paid' },
  ]);
  eq('paid in full + stale partial -> paid', exact[0].state, 'paid');

  // A genuine partial (balance remains) still reads partial from the amounts.
  const partial = buildPaymentRows([
    { taskId: 't4', billed: 100000, paid: 40000 },
  ]);
  eq('genuine partial stays partial', partial[0].state, 'partial');

  // Recorded "paid" on a bill with a balance still wins (unchanged behaviour):
  // a human marked it paid, and the amounts do not contradict a settled bill.
  const marked = buildPaymentRows([
    { taskId: 't5', billed: 100000, paid: 40000, status: 'paid' },
  ]);
  eq('recorded paid on a balance still wins', marked[0].state, 'paid');

  // Overpaid campaigns land in the paid-not-partial bucket, so the Partial
  // section no longer collects them.
  eq('overpaid not in partial', paymentSectionRows(over, 'partial').length, 0);
}

// Due date + overdue, from the payment schedule (net terms, delivered in the past)
{
  const today = '2026-03-01';
  const built = buildPaymentRows([
    // net 30, delivered 2026-01-01, unpaid -> balance was due 2026-01-31, overdue by March.
    { taskId: 'late', billed: 100000, paid: 0,
      paymentTerms: 'net_days', paymentNetDays: 30, deliveredOn: '2026-01-01' },
    // same terms but paid in full -> nothing owed, so not overdue and no next due.
    { taskId: 'paid', billed: 100000, paid: 100000,
      paymentTerms: 'net_days', paymentNetDays: 30, deliveredOn: '2026-01-01' },
    // no terms at all -> no due date, never overdue.
    { taskId: 'noterms', billed: 100000, paid: 0 },
  ], today);
  const by = Object.fromEntries(built.map((r) => [r.taskId, r]));

  eq('a net-30 bill delivered in January is due 2026-01-31', by.late.due, '2026-01-31');
  ok('and it reads overdue by March', by.late.overdue === true);
  ok('with a positive days-late count', typeof by.late.daysLate === 'number' && by.late.daysLate > 0);
  ok('the delivered date makes the basis actual', by.late.dueBasis === 'actual');

  ok('a fully-paid bill is not overdue', by.paid.overdue === false);
  eq('and has no next due', by.paid.due, null);

  ok('no terms means no due date', by.noterms.due === null && by.noterms.overdue === false);

  eq('only the unpaid net-30 row is in the overdue section',
    paymentSectionRows(built, 'overdue').map((r) => r.taskId), ['late']);

  // Omitting today: dates may still show, but nothing is judged late.
  const noToday = buildPaymentRows([
    { taskId: 'x', billed: 100000, paid: 0, paymentTerms: 'net_days', paymentNetDays: 30, deliveredOn: '2026-01-01' },
  ]);
  ok('with no today, nothing reads as overdue', noToday[0].overdue === false);
}

// sortByDue: most-late first, then soonest date, then undated, stably.
{
  const ordered = sortByDue([
    { taskId: 'a', due: '2026-05-01', daysLate: null },
    { taskId: 'b', due: '2026-01-01', daysLate: 40 },
    { taskId: 'c', due: null, daysLate: null },
    { taskId: 'd', due: '2026-02-01', daysLate: 10 },
    { taskId: 'e', due: '2026-03-01', daysLate: null },
  ]).map((r) => r.taskId);
  eq('most overdue first, then soonest due, undated last', ordered, ['b', 'd', 'e', 'a', 'c']);

  eq('empty is empty', sortByDue([]), []);
  eq('stable on ties', sortByDue([
    { taskId: 'p', due: '2026-04-01', daysLate: null },
    { taskId: 'q', due: '2026-04-01', daysLate: null },
  ]).map((r) => r.taskId), ['p', 'q']);
}

console.log(`pay-sections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
