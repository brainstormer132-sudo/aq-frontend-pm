/**
 * paymentsDue - which campaigns finance should be told about, and why.
 *
 * A campaign is on the list only when the client still owes money: nothing
 * billed and nothing paid-in-full are both silent. An overdue client
 * instalment reports 'overdue'; a delivered campaign with money still to
 * collect reports 'delivered'; overdue wins when both are true. The date
 * arithmetic is paymentSchedule's - these tests check the SELECTION and the
 * words, not the schedule (payment-schedule has its own suite).
 */
import {
  paymentsDue, isDelivered, fmtSar, paymentDueMessage, paymentDueLink,
  NOTIFY_EVERY_DAYS, RECIPIENT_ROLES,
} from '../.test-build/finance-notify.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

const TODAY = '2026-09-15';
const byId = (rows) => Object.fromEntries(paymentsDue(rows, TODAY).map((c) => [c.id, c]));

// Nothing to collect is silent.
{
  const rows = [
    { id: 'nobill', workspace_id: 'w', title: 'No bill', billed: 0, paid: 0,
      status: 'done', paymentTerms: 'on_delivery', completedAt: '2026-09-01' },
    { id: 'paidfull', workspace_id: 'w', title: 'Paid up', billed: 100000, paid: 100000,
      status: 'done', paymentTerms: 'on_delivery', completedAt: '2026-09-01' },
    { id: 'noid', workspace_id: 'w', title: 'x', billed: 5, paid: 0, status: 'done' },
  ];
  const m = byId(rows);
  ok('nothing billed -> not listed', !m.nobill);
  ok('paid in full -> not listed', !m.paidfull);
  eq('id-less/ws-less handled', paymentsDue([{ id: '', workspace_id: 'w', billed: 9 }], TODAY).length, 0);
  eq('no workspace -> dropped', paymentsDue([{ id: 'x', billed: 9, status: 'done' }], TODAY).length, 0);
}

// Overdue: an instalment past its date and unpaid.
{
  // on_delivery, delivered 30 days ago, nothing paid -> overdue.
  const rows = [
    { id: 'late', workspace_id: 'w', title: 'Ramadan', billed: 100000, paid: 0,
      status: 'done', completedAt: '2026-08-16', paymentTerms: 'on_delivery' },
  ];
  const m = byId(rows);
  ok('delivered + unpaid past date -> listed', !!m.late);
  eq('reason overdue', m.late.reason, 'overdue');
  eq('amount is the whole outstanding', m.late.amount, 100000);
  ok('days late reported', m.late.daysLate > 0);
}

// Delivered but not yet late: ready to invoice.
{
  // net_days 30, delivered today -> due in 30 days, not overdue, but money owed.
  const rows = [
    { id: 'ready', workspace_id: 'w', title: 'Eid', billed: 50000, paid: 0,
      status: 'done', completedAt: TODAY, paymentTerms: 'net_days', paymentNetDays: 30 },
  ];
  const m = byId(rows);
  ok('delivered, net-30 not elapsed -> listed', !!m.ready);
  eq('reason delivered', m.ready.reason, 'delivered');
  eq('no days-late on a delivered notice', m.ready.daysLate, null);
  eq('outstanding carried', m.ready.amount, 50000);
}

// In flight, nothing late: not on the list.
{
  // on_delivery, not done, planned finish in the future -> nothing to chase.
  const rows = [
    { id: 'flight', workspace_id: 'w', title: 'Later', billed: 80000, paid: 0,
      status: 'in_progress', paymentTerms: 'on_delivery', dueDate: '2026-12-01' },
  ];
  eq('in flight, nothing due -> not listed', byId(rows).flight, undefined);
}

// Overdue wins over delivered when both could apply.
{
  // split 50/50, campaign started 40 days ago (up-front half overdue),
  // delivered -> both an overdue instalment AND delivered. Reports overdue.
  const rows = [
    { id: 'both', workspace_id: 'w', title: 'Split', billed: 100000, paid: 0,
      status: 'done', completedAt: '2026-09-14', paymentTerms: 'split',
      paymentSplitPct: 50, startDate: '2026-08-06' },
  ];
  const m = byId(rows);
  ok('listed', !!m.both);
  eq('overdue wins', m.both.reason, 'overdue');
}

// Partial payment reduces the outstanding, not the listing.
{
  const rows = [
    { id: 'part', workspace_id: 'w', title: 'Half paid', billed: 100000, paid: 40000,
      status: 'done', completedAt: '2026-08-16', paymentTerms: 'on_delivery' },
  ];
  const m = byId(rows);
  ok('still listed while a balance remains', !!m.part);
  eq('amount is the remaining balance', m.part.amount, 60000);
}

// isDelivered
{
  ok("'done' is delivered", isDelivered('done') && isDelivered('DONE'));
  ok('others are not', !isDelivered('in_progress') && !isDelivered('') && !isDelivered(null));
}

// Money formatting - ASCII, grouped, no decimals.
{
  eq('grouped thousands', fmtSar(60000), 'SAR 60,000');
  eq('rounds halalas', fmtSar(60000.4), 'SAR 60,000');
  eq('zero', fmtSar(0), 'SAR 0');
}

// Messages read the way finance would say them.
{
  const overdue = { id: 't', workspace_id: 'w', title: 'Ramadan', reason: 'overdue', amount: 60000, daysLate: 30, due: '2026-08-16' };
  const msgO = paymentDueMessage(overdue);
  eq('overdue title', msgO.title, 'Client payment overdue');
  eq('overdue body', msgO.body, 'Ramadan - SAR 60,000 30 days overdue.');
  eq('one day singular', paymentDueMessage({ ...overdue, daysLate: 1 }).body, 'Ramadan - SAR 60,000 1 day overdue.');

  const ready = { id: 't', workspace_id: 'w', title: 'Eid', reason: 'delivered', amount: 50000, daysLate: null, due: null };
  const msgD = paymentDueMessage(ready);
  eq('delivered title', msgD.title, 'Delivered, ready to invoice');
  eq('delivered body', msgD.body, 'Eid - delivered, SAR 50,000 to collect.');
}

// Link is per campaign AND per reason, so the two triggers de-dup apart.
{
  const c = { id: 'abc', workspace_id: 'w', title: 't', reason: 'overdue', amount: 1, daysLate: 1, due: null };
  eq('overdue link', paymentDueLink(c), '/dashboard?finance=payments&task=abc&due=overdue');
  eq('delivered link differs', paymentDueLink({ ...c, reason: 'delivered' }), '/dashboard?finance=payments&task=abc&due=delivered');
}

// Config sanity.
{
  ok('re-notify cadence is a few days', NOTIFY_EVERY_DAYS === 3);
  eq('recipients are owner/admin/finance', RECIPIENT_ROLES, ['owner', 'admin', 'finance']);
}

console.log(`finance-notify: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
