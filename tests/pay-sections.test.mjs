import {
  PAYMENT_SECTIONS, hasAdvance, inPaymentSection, paymentSectionRows,
  paymentSectionCounts, paymentRemaining, payStateOf,
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

console.log(`pay-sections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
