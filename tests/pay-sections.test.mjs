import {
  PAYMENT_SECTIONS, hasAdvance, inPaymentSection, paymentSectionRows,
  paymentSectionCounts, paymentRemaining, payStateOf,
  normalizePayState, expectedAdvance, buildPaymentRows,
} from '../.test-build/finance.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

// Payment sections: All / Partial paid / Advanced
{
  eq('three sections, All first', PAYMENT_SECTIONS.map((s) => s.key), ['all', 'partial', 'advanced']);

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

  eq('section counts', paymentSectionCounts(rows), { all: 5, partial: 2, advanced: 2 });
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
  eq('sections over built rows', paymentSectionCounts(rows), { all: 2, partial: 1, advanced: 1 });
}

console.log(`pay-sections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
