/**
 * vendor-performance - per-vendor delivery rollup from ad lines.
 *
 * lineDelivery classifies one line (on-time / late / posted / overdue /
 * pending / cancelled) against today; vendorPerformance groups lines by vendor
 * and sorts the ones that need action to the top.
 */
import {
  lineDelivery, vendorPerformance, reliabilityBand, vendorMoney,
  RELIABLE_PCT, SHAKY_PCT,
} from '../.test-build/vendor-performance.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };

const TODAY = '2026-09-19';

// ── lineDelivery: one line's verdict ──────────────────────────────
eq('posted on the due date is on-time',
  lineDelivery({ status: 'Posted', dueDate: '2026-09-10', postedOn: '2026-09-10' }, TODAY), 'on-time');
eq('posted before due is on-time',
  lineDelivery({ status: 'Posted', dueDate: '2026-09-10', postedOn: '2026-09-08' }, TODAY), 'on-time');
eq('posted after due is late',
  lineDelivery({ status: 'Posted', dueDate: '2026-09-10', postedOn: '2026-09-14' }, TODAY), 'late');
eq('a posted date alone (no due) is delivered but unjudged',
  lineDelivery({ postedOn: '2026-09-14' }, TODAY), 'posted');
eq('status Posted with no dates is delivered but unjudged',
  lineDelivery({ status: 'Posted' }, TODAY), 'posted');
eq('not posted and past due is overdue',
  lineDelivery({ status: 'Scheduled', dueDate: '2026-09-01' }, TODAY), 'overdue');
eq('not posted and due in the future is pending',
  lineDelivery({ status: 'Scheduled', dueDate: '2026-12-01' }, TODAY), 'pending');
eq('not posted with no due date is pending',
  lineDelivery({ status: 'Not started' }, TODAY), 'pending');
eq('due exactly today is not yet overdue', // due < today, so today is still pending
  lineDelivery({ status: 'Scheduled', dueDate: TODAY }, TODAY), 'pending');
eq('cancelled is cancelled even when past due',
  lineDelivery({ status: 'Cancelled', dueDate: '2026-01-01' }, TODAY), 'cancelled');
eq('a junk date is treated as no date',
  lineDelivery({ status: 'Scheduled', dueDate: 'not-a-date' }, TODAY), 'pending');

// ── vendorPerformance: the rollup + ranking ───────────────────────
{
  const lines = [
    // vendor A (id 1): 2 on-time, 1 late, 1 delivered-no-proof, 1 overdue, 1 cancelled
    { vendorId: 1, status: 'Posted', dueDate: '2026-09-01', postedOn: '2026-08-30', hasProof: true },
    { vendorId: 1, status: 'Posted', dueDate: '2026-09-05', postedOn: '2026-09-05', hasProof: true },
    { vendorId: 1, status: 'Posted', dueDate: '2026-09-05', postedOn: '2026-09-12', hasProof: true },  // late
    { vendorId: 1, status: 'Posted', dueDate: '2026-09-05', postedOn: '2026-09-06', hasProof: false }, // late + no proof
    { vendorId: 1, status: 'Scheduled', dueDate: '2026-09-01' },                                       // overdue
    { vendorId: 1, status: 'Cancelled', dueDate: '2026-08-01' },                                       // exempt
    // vendor B (id 2): all on-time, all proof -> reliable, nothing to chase
    { vendorId: 2, status: 'Posted', dueDate: '2026-09-01', postedOn: '2026-08-31', hasProof: true },
    { vendorId: 2, status: 'Posted', dueDate: '2026-09-02', postedOn: '2026-09-02', hasProof: true },
    // a line with no vendor is dropped
    { vendorId: null, status: 'Posted', dueDate: '2026-09-01', postedOn: '2026-09-01' },
  ];
  const perf = vendorPerformance(lines, TODAY);
  eq('two vendors (the null-vendor line dropped)', perf.length, 2);

  const a = perf.find((p) => p.vendorId === '1');
  const b = perf.find((p) => p.vendorId === '2');

  eq('A ads exclude the cancelled line', a.ads, 5);
  eq('A delivered', a.delivered, 4);
  eq('A on-time', a.onTime, 2);
  eq('A late', a.late, 2);
  eq('A overdue', a.overdue, 1);
  eq('A missing proof (the one delivered line without it)', a.missingProof, 1);
  eq('A reliability = 2 of 4 judged = 50%', a.reliabilityPct, 50);
  eq('A needs chasing = overdue + missing proof', a.needsChasing, 2);
  eq('A last posted is the most recent post date', a.lastPostedOn, '2026-09-12');

  eq('B is fully reliable', b.reliabilityPct, 100);
  eq('B has nothing to chase', b.needsChasing, 0);

  // A (needsChasing 2) sorts above B (0).
  eq('the vendor to chase sorts first', perf.map((p) => p.vendorId), ['1', '2']);

  // Empty input is an empty list, not a throw.
  eq('no lines, no rows', vendorPerformance([], TODAY), []);
}

// Ranking: among vendors with nothing to chase, least reliable first; a vendor
// with no judgeable line sinks below one that has a percentage.
{
  const lines = [
    { vendorId: 'x', status: 'Posted', dueDate: '2026-09-01', postedOn: '2026-09-10', hasProof: true }, // late -> 0%
    { vendorId: 'y', status: 'Posted', dueDate: '2026-09-01', postedOn: '2026-08-30', hasProof: true }, // 100%
    { vendorId: 'z', status: 'Posted', postedOn: '2026-09-05', hasProof: true },                        // delivered, unjudged -> null
  ];
  const perf = vendorPerformance(lines, TODAY);
  eq('least reliable first, unjudged last', perf.map((p) => p.vendorId), ['x', 'y', 'z']);
}

// ── reliabilityBand ───────────────────────────────────────────────
eq('90%+ is reliable', reliabilityBand(RELIABLE_PCT), 'reliable');
eq('just under 90 is ok', reliabilityBand(RELIABLE_PCT - 1), 'ok');
eq('70 is ok', reliabilityBand(SHAKY_PCT), 'ok');
eq('under 70 is shaky', reliabilityBand(SHAKY_PCT - 1), 'shaky');
eq('null is none', reliabilityBand(null), 'none');

// ── vendorMoney: owed / paid / outstanding per vendor ─────────────
{
  const m = vendorMoney([
    { vendorId: 1, owed: 5000, paid: 2000 },
    { vendorId: 1, owed: 3000, paid: 3000 },   // same vendor, second booking
    { vendorId: 2, owed: 1000, paid: 0 },
    { vendorId: 3, owed: 1000, paid: 1200 },   // overpaid -> outstanding floors at 0
    { vendorId: null, owed: 999, paid: 0 },    // no vendor -> dropped
  ]);
  eq('vendor 1 owed is summed', m.get('1').owed, 8000);
  eq('vendor 1 paid is summed', m.get('1').paid, 5000);
  eq('vendor 1 outstanding', m.get('1').outstanding, 3000);
  eq('vendor 2 fully outstanding', m.get('2'), { owed: 1000, paid: 0, outstanding: 1000 });
  eq('overpaid floors outstanding at zero', m.get('3').outstanding, 0);
  eq('the null-vendor booking is dropped', m.has(''), false);
  eq('an empty list is an empty map', vendorMoney([]).size, 0);
  // halala rounding: two thirds-of-a-riyal bookings do not drift.
  const r = vendorMoney([
    { vendorId: 'x', owed: 0.1, paid: 0 },
    { vendorId: 'x', owed: 0.2, paid: 0 },
  ]);
  eq('rounds to the halala', r.get('x').owed, 0.3);
  // junk amounts read as zero, not NaN.
  eq('junk owed is zero', vendorMoney([{ vendorId: 'y', owed: 'oops', paid: null }]).get('y'),
    { owed: 0, paid: 0, outstanding: 0 });
}

console.log(`vendor-performance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
