import {
  paymentSchedule, splitAmount, addDays, daysBetween, isoOrNull,
  dueLabel, scheduleTone, deliveredOn,
} from '../.test-build/payment-schedule.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const TODAY = '2026-08-27';

/* ── Date arithmetic ─────────────────────────────────────────────── */
eq('add days', addDays('2026-08-27', 30), '2026-09-26');
eq('across a month end', addDays('2026-01-31', 1), '2026-02-01');
eq('across a year end', addDays('2026-12-31', 1), '2027-01-01');
eq('leap year', addDays('2028-02-28', 1), '2028-02-29');
eq('non-leap February', addDays('2026-02-28', 1), '2026-03-01');
eq('backwards', addDays('2026-03-01', -1), '2026-02-28');
eq('days between', daysBetween('2026-08-01', '2026-08-27'), 26);
eq('negative days between', daysBetween('2026-08-27', '2026-08-01'), -26);
eq('same day', daysBetween('2026-08-27', '2026-08-27'), 0);

// A date that is not a date must be "no date", never today.
eq('rejects nonsense', isoOrNull('soon'), null);
eq('rejects empty', isoOrNull(''), null);
eq('rejects null', isoOrNull(null), null);
// Date() would quietly turn this into 3 March. A due date that moves by
// itself is worse than one that never appears.
eq('rejects 31 February', isoOrNull('2026-02-31'), null);
eq('rejects month 13', isoOrNull('2026-13-01'), null);
eq('accepts a real one', isoOrNull('2026-08-27'), '2026-08-27');
eq('trims a timestamp to its date', isoOrNull('2026-08-27T14:00:00Z'), '2026-08-27');

/* ── Splitting money without losing a halala ─────────────────────── */
eq('an even split', splitAmount(1000, 50), [500, 500]);
eq('an odd total', splitAmount(1001, 50), [500.5, 500.5]);
// The trap: 30% of 1001 rounds to 300.30, and 70% rounds to 700.70. Both
// rounded independently sum to 1001.00 here, but the general rule must be
// that the LAST part absorbs the remainder.
eq('a 30/70 split', splitAmount(1001, 30), [300.3, 700.7]);
eq('a third, remainder on the last', splitAmount(100, 33), [33, 67]);
{
  const [a, b] = splitAmount(0.03, 50);
  eq('the parts always sum to the total', Math.round((a + b) * 100) / 100, 0.03);
}
{
  const [a, b] = splitAmount(9999.99, 50);
  eq('and again on an awkward one', Math.round((a + b) * 100) / 100, 9999.99);
}

/* ── No terms agreed ─────────────────────────────────────────────── */
{
  const s = paymentSchedule({ amount: 10000, today: TODAY });
  eq('no instalments', s.instalments, []);
  eq('says so', s.summary, 'No payment terms agreed.');
  eq('still knows what is owed', s.outstanding, 10000);
  eq('nothing is overdue without terms', s.overdue, false);
  eq('grey', scheduleTone(s), 'grey');
}

/* ── On delivery ─────────────────────────────────────────────────── */
// Delivered three days ago and unpaid: really overdue, on a real date.
{
  const s = paymentSchedule({
    terms: 'on_delivery', amount: 20000,
    deliveredOn: '2026-08-24', today: TODAY,
  });
  eq('one instalment', s.instalments.length, 1);
  eq('for the whole amount', s.instalments[0].amount, 20000);
  eq('due the day it was delivered', s.instalments[0].due, '2026-08-24');
  eq('and that is a fact', s.instalments[0].basis, 'actual');
  eq('overdue', s.instalments[0].state, 'overdue');
  eq('by three days', s.instalments[0].daysLate, 3);
  eq('schedule agrees', s.overdue, true);
  eq('worst', s.worstDaysLate, 3);
  eq('red', scheduleTone(s), 'red');
  eq('label', dueLabel(s.instalments[0]), '3 days overdue');
}
// Not delivered yet: the date comes from the plan and must say so.
{
  const s = paymentSchedule({
    terms: 'on_delivery', amount: 20000,
    dueDate: '2026-09-10', today: TODAY,
  });
  eq('projected date', s.instalments[0].due, '2026-09-10');
  eq('labelled as a projection', s.instalments[0].basis, 'planned');
  eq('not overdue', s.overdue, false);
  eq('upcoming', s.instalments[0].state, 'upcoming');
  eq('the summary says it is a projection',
    s.summary, 'Paid on delivery · projected from the planned finish');
  eq('and so does the row', dueLabel(s.instalments[0]), 'due in 14 days (projected)');
}
// The actual finish beats the plan, even when it is earlier.
{
  const s = paymentSchedule({
    terms: 'on_delivery', amount: 20000,
    deliveredOn: '2026-08-20', dueDate: '2026-09-10', today: TODAY,
  });
  eq('actual wins', s.instalments[0].due, '2026-08-20');
  eq('and is a fact', s.instalments[0].basis, 'actual');
}
// Nothing to count from at all.
{
  const s = paymentSchedule({ terms: 'on_delivery', amount: 20000, today: TODAY });
  eq('no date', s.instalments[0].due, null);
  eq('unknown basis', s.instalments[0].basis, 'unknown');
  eq('unknown state', s.instalments[0].state, 'unknown');
  // NOT red. Nobody is late — the work simply is not done.
  eq('not overdue', s.overdue, false);
  eq('grey, not red', scheduleTone(s), 'grey');
  eq('says why', s.summary, 'Paid on delivery · no delivery date yet');
  eq('row says why', dueLabel(s.instalments[0]), 'no date yet');
}

/* ── Net days ────────────────────────────────────────────────────── */
{
  const s = paymentSchedule({
    terms: 'net_days', netDays: 30, amount: 50000,
    deliveredOn: '2026-08-01', today: TODAY,
  });
  eq('thirty days after delivery', s.instalments[0].due, '2026-08-31');
  eq('a fact', s.instalments[0].basis, 'actual');
  eq('not yet due', s.instalments[0].state, 'due-soon');
  eq('four days out', s.instalments[0].daysLate, -4);
  eq('amber', scheduleTone(s), 'amber');
  eq('label', dueLabel(s.instalments[0]), 'due in 4 days');
}
{
  const s = paymentSchedule({
    terms: 'net_days', netDays: 60, amount: 50000,
    deliveredOn: '2026-06-01', today: TODAY,
  });
  eq('sixty days', s.instalments[0].due, '2026-07-31');
  eq('long overdue', s.instalments[0].daysLate, 27);
  eq('red', scheduleTone(s), 'red');
}
// Net days with nothing delivered cannot produce a date at all — thirty
// days after "we don't know" is not a date.
{
  const s = paymentSchedule({
    terms: 'net_days', netDays: 30, amount: 50000,
    dueDate: '2026-09-01', today: TODAY,
  });
  eq('projected from the plan', s.instalments[0].due, '2026-10-01');
  eq('and marked as such', s.instalments[0].basis, 'planned');
}
{
  const s = paymentSchedule({ terms: 'net_days', amount: 50000, today: TODAY });
  eq('no date at all', s.instalments[0].due, null);
  eq('defaults to 30 in the label', s.instalments[0].label, '30 days after delivery');
}

/* ── In advance ──────────────────────────────────────────────────── */
{
  const s = paymentSchedule({
    terms: 'in_advance', amount: 12000,
    startDate: '2026-08-20', today: TODAY,
  });
  eq('due at the start', s.instalments[0].due, '2026-08-20');
  eq('overdue — the work has started and we have not been paid',
    s.instalments[0].state, 'overdue');
  eq('by seven days', s.instalments[0].daysLate, 7);
}
{
  const s = paymentSchedule({
    terms: 'in_advance', amount: 12000,
    startDate: '2026-09-15', today: TODAY,
  });
  eq('upcoming', s.instalments[0].state, 'upcoming');
  eq('blue', scheduleTone(s), 'blue');
}

/* ── Split — the common one ──────────────────────────────────────── */
{
  const s = paymentSchedule({
    terms: 'split', splitPct: 50, amount: 30000,
    startDate: '2026-08-01', deliveredOn: '2026-08-25', today: TODAY,
  });
  eq('two instalments', s.instalments.length, 2);
  eq('halves', s.instalments.map((i) => i.amount), [15000, 15000]);
  eq('labels', s.instalments.map((i) => i.label), ['50% up front', '50% on delivery']);
  eq('the up-front one is due at the start', s.instalments[0].due, '2026-08-01');
  eq('the rest on delivery', s.instalments[1].due, '2026-08-25');
  eq('both overdue, unpaid', s.instalments.map((i) => i.state), ['overdue', 'overdue']);
  eq('the worst is the oldest', s.worstDaysLate, 26);
  eq('next due is the earliest unpaid', s.nextDue, '2026-08-01');
  eq('summary', s.summary, '50% up front, 50% on delivery');
}
// A 30/70, because it happens.
{
  const s = paymentSchedule({
    terms: 'split', splitPct: 30, amount: 1001,
    startDate: '2026-08-01', deliveredOn: '2026-08-25', today: TODAY,
  });
  eq('thirty and seventy', s.instalments.map((i) => i.amount), [300.3, 700.7]);
  eq('summing to the total',
    Math.round(s.instalments.reduce((t, i) => t + i.amount, 0) * 100) / 100, 1001);
  eq('labels', s.instalments.map((i) => i.label), ['30% up front', '70% on delivery']);
}

/* ── Money already paid settles instalments IN ORDER ─────────────── */
// The vendor has had their 50% up front. They are not also owed it on
// delivery, and a chase list that says otherwise gets ignored in a week.
{
  const s = paymentSchedule({
    terms: 'split', splitPct: 50, amount: 30000, paid: 15000,
    startDate: '2026-08-01', deliveredOn: '2026-08-25', today: TODAY,
  });
  eq('first is settled', s.instalments[0].state, 'paid');
  eq('second is not', s.instalments[1].state, 'overdue');
  eq('half is still owed', s.outstanding, 15000);
  eq('next due is the unpaid one', s.nextDue, '2026-08-25');
  eq('label on the paid one', dueLabel(s.instalments[0]), 'paid');
}
{
  const s = paymentSchedule({
    terms: 'split', splitPct: 50, amount: 30000, paid: 30000,
    startDate: '2026-08-01', deliveredOn: '2026-08-25', today: TODAY,
  });
  eq('both settled', s.instalments.map((i) => i.state), ['paid', 'paid']);
  eq('nothing owed', s.outstanding, 0);
  eq('nothing overdue', s.overdue, false);
  eq('no next due', s.nextDue, null);
  eq('green', scheduleTone(s), 'green');
}
// A part payment smaller than the first instalment settles nothing.
{
  const s = paymentSchedule({
    terms: 'split', splitPct: 50, amount: 30000, paid: 5000,
    startDate: '2026-08-01', deliveredOn: '2026-08-25', today: TODAY,
  });
  eq('not enough to settle the first', s.instalments[0].state, 'overdue');
  eq('but the balance knows', s.outstanding, 25000);
}
// Overpaid — somebody's typo. It must not settle more than exists or go
// negative.
{
  const s = paymentSchedule({
    terms: 'split', splitPct: 50, amount: 30000, paid: 99999,
    startDate: '2026-08-01', deliveredOn: '2026-08-25', today: TODAY,
  });
  eq('all settled', s.instalments.map((i) => i.state), ['paid', 'paid']);
  eq('never negative', s.outstanding, 0);
}

/* ── Unpriced ────────────────────────────────────────────────────── */
// The terms are still worth stating even when nobody has priced the work.
{
  const s = paymentSchedule({
    terms: 'net_days', netDays: 30, deliveredOn: '2026-08-01', today: TODAY,
  });
  eq('no amount', s.instalments[0].amount, null);
  eq('but a real date', s.instalments[0].due, '2026-08-31');
  eq('and the terms are said', s.summary, 'Paid 30 days after delivery');
  eq('nothing known to be owed', s.outstanding, null);
}
eq('zero is not a price',
  paymentSchedule({ terms: 'on_delivery', amount: 0, today: TODAY }).outstanding, null);

/* ── The warning window ──────────────────────────────────────────── */
{
  const near = paymentSchedule({
    terms: 'on_delivery', amount: 100, deliveredOn: '2026-09-03', today: TODAY,
  });
  eq('seven days out is due soon', near.instalments[0].state, 'due-soon');
  const far = paymentSchedule({
    terms: 'on_delivery', amount: 100, deliveredOn: '2026-09-04', today: TODAY,
  });
  eq('eight days out is upcoming', far.instalments[0].state, 'upcoming');
  const wide = paymentSchedule({
    terms: 'on_delivery', amount: 100, deliveredOn: '2026-09-04',
    today: TODAY, warnDays: 14,
  });
  eq('a wider window catches it', wide.instalments[0].state, 'due-soon');
}
{
  const s = paymentSchedule({
    terms: 'on_delivery', amount: 100, deliveredOn: TODAY, today: TODAY,
  });
  eq('due today is not yet overdue', s.instalments[0].state, 'due-soon');
  eq('zero days', s.instalments[0].daysLate, 0);
  eq('label', dueLabel(s.instalments[0]), 'due today');
  eq('and the schedule is not red', s.overdue, false);
}
{
  const s = paymentSchedule({
    terms: 'on_delivery', amount: 100, deliveredOn: '2026-08-26', today: TODAY,
  });
  eq('one day late reads singular', dueLabel(s.instalments[0]), '1 day overdue');
}

/* ── When a booking counts as delivered ──────────────────────────── */
// Every ad up, and the date is the last of them.
eq('all posted', deliveredOn([
  { status: 'Posted', posted_on: '2026-08-10' },
  { status: 'Posted', posted_on: '2026-08-14' },
  { status: 'Posted', posted_on: '2026-08-12' },
]), '2026-08-14');
// Eleven of twelve is not delivered. Starting a net-30 clock here would
// have us paying in full for work still outstanding.
eq('one still to go', deliveredOn([
  { status: 'Posted', posted_on: '2026-08-10' },
  { status: 'Scheduled' },
]), null);
eq('nothing posted', deliveredOn([{ status: 'Not started' }]), null);
eq('no lines at all', deliveredOn([]), null);
// Posted but nobody wrote down when. Delivered, probably — but a guessed
// date is a wrong due date.
eq('posted with no date', deliveredOn([
  { status: 'Posted', posted_on: '2026-08-10' },
  { status: 'Posted', posted_on: null },
]), null);
// A cancellation must not freeze the payment clock forever.
eq('cancelled ads do not block delivery', deliveredOn([
  { status: 'Posted', posted_on: '2026-08-10' },
  { status: 'Cancelled' },
]), '2026-08-10');
eq('all cancelled is not delivered', deliveredOn([
  { status: 'Cancelled' }, { status: 'Cancelled' },
]), null);
// End to end: a delivered booking on net 30.
{
  const on = deliveredOn([
    { status: 'Posted', posted_on: '2026-07-20' },
    { status: 'Posted', posted_on: '2026-07-25' },
  ]);
  const s = paymentSchedule({
    terms: 'net_days', netDays: 30, amount: 18000,
    deliveredOn: on, today: TODAY,
  });
  eq('due 30 days after the last post', s.instalments[0].due, '2026-08-24');
  eq('a fact, not a projection', s.instalments[0].basis, 'actual');
  eq('three days overdue', s.instalments[0].daysLate, 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
