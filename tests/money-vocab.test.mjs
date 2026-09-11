/**
 * The three money bugs found on 7 Sep 2026, frozen.
 *
 * Every case here failed before the fix. They are grouped by the bug rather
 * than by the function, because the interesting thing about all three is not
 * the arithmetic — it was fine — but that a name or a comment said one thing
 * and the code did another, and nothing in between could tell.
 */
import { clientPaymentState, contractState, moneyByMonth, isComplete } from '../.test-build/dashboard-data.js';
import { clientLedger, vendorLedger } from '../.test-build/money-ledger.js';
import { totalsOf, groupByAdType, contractDetails, lineNet } from '../.test-build/ad-lines.js';
import { contractPlan } from '../.test-build/vendor-contracts.js';
import { bookingRows } from '../.test-build/campaign-page.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => {
  if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); }
};

/* ════════════════════════════════════════════════════════════════
   1. 'unpaid' is not 'paid'

   `s.includes('paid')` was true for 'unpaid' and 'not paid'. That alone
   would have been a labelling slip; what made it expensive is that
   money-ledger's clampPaid() returns the FULL total whenever the state is
   'paid', so an unpaid campaign reported a zero balance and dropped out of
   the outstanding figure entirely.
   ════════════════════════════════════════════════════════════════ */

eq('unpaid is outstanding',
  clientPaymentState({ client_payment_status: 'unpaid' }).key, 'unpaid');
eq('"not paid" is outstanding',
  clientPaymentState({ client_payment_status: 'not paid' }).key, 'unpaid');
eq('"Unpaid" with a capital is outstanding',
  clientPaymentState({ client_payment_status: 'Unpaid' }).key, 'unpaid');
eq('  unpaid  with whitespace is outstanding',
  clientPaymentState({ client_payment_status: '  unpaid  ' }).key, 'unpaid');

// The states the picker actually offers that nothing has taught the ledger
// about. They must land in the SAFE bucket — chased, not silently settled.
for (const s of ['no_payment', 'refund', 'credit', 'adjustment']) {
  eq(`${s} is not treated as paid`,
    clientPaymentState({ client_payment_status: s }).key, 'unpaid');
}

// And the values that really do mean paid still do.
for (const s of ['paid', 'Paid', 'settled', 'done']) {
  eq(`${s} is paid`, clientPaymentState({ client_payment_status: s }).key, 'paid');
}
eq('partial is partial',
  clientPaymentState({ client_payment_status: 'partial' }).key, 'partial');
eq('nothing recorded is outstanding',
  clientPaymentState({ client_payment_status: null }).key, 'unpaid');

// Same shape, same bug: 'unsigned'.includes('signed').
eq('unsigned is not signed', contractState({ contract_status: 'unsigned' }).key, 'pending');
eq('not_signed is not signed', contractState({ contract_status: 'not_signed' }).key, 'pending');
eq('signed is signed', contractState({ contract_status: 'signed' }).key, 'signed');
eq('signed_attached is signed',
  contractState({ contract_status: 'signed_attached' }).key, 'signed');
eq('nothing is no contract', contractState({ contract_status: null }).key, 'none');

/* ════════════════════════════════════════════════════════════════
   2. The net is per ad, so quantity multiplies it

   One line, quantity 6, billed 1,500 per ad, vendor's fee 700 per ad.
   The client owes 9,000; the vendor is owed 4,200. The old code multiplied
   the price and summed the net flat, reporting a cost of 700.
   ════════════════════════════════════════════════════════════════ */

const sixAds = [{ ad_type: 'Home Ad', quantity: 6, unit_price: 1500, net_amount: 700 }];

eq('a line of six: the client is billed 9,000', totalsOf(sixAds).amount, 9000);
eq('a line of six: the vendor is owed 4,200 (not 700)', totalsOf(sixAds).net, 4200);
eq('lineNet multiplies by quantity', lineNet(sixAds[0]), 4200);

// The booking row the campaign page renders from must say the same.
{
  const [row] = bookingRows({
    subtasks: [{ id: 'b1', title: 'Booking' }],
    ads: [{ subtask_id: 'b1', ad_type: 'Home Ad', quantity: 6, unit_price: 1500, net_amount: 700 }],
  });
  eq('booking row price', row.price, 9000);
  eq('booking row vendor cost', row.net, 4200);
}

// Quantity 1 is unchanged by the fix — the regression guard.
{
  const one = [{ ad_type: 'Store Visit', quantity: 1, unit_price: 5000, net_amount: 3000 }];
  eq('quantity 1 price', totalsOf(one).amount, 5000);
  eq('quantity 1 net', totalsOf(one).net, 3000);
}

// Null is "not worked out", never zero. The distinction is the whole reason
// a contract can refuse to be written.
{
  const noNet = [{ ad_type: 'Home Ad', quantity: 3, unit_price: 1000, net_amount: null }];
  eq('no net worked out: netKnown false', totalsOf(noNet).netKnown, false);
  eq('no net worked out: net is 0, meaning nothing to add up', totalsOf(noNet).net, 0);
  eq('and the priced line is counted as missing one', totalsOf(noNet).netMissing, 1);
  eq('lineNet is null, not 0', lineNet(noNet[0]), null);
}

// Free work is a decision and is distinguishable from an unknown fee.
{
  const free = [{ ad_type: 'Reminder', quantity: 2, unit_price: 0, net_amount: 0 }];
  eq('a zero fee IS known', totalsOf(free).netKnown, true);
  eq('a zero fee is zero', totalsOf(free).net, 0);
  eq('and does not count as missing', totalsOf(free).netMissing, 0);
}

/* ════════════════════════════════════════════════════════════════
   3. A vendor contract states the VENDOR'S fee

   `AdLineTotals.amount` was documented as "what the vendor is owed" and was
   the client's price. Whoever wired it into the contract believed the
   comment. The contract for six ads at 1,500 costing 700 each went to the
   influencer reading SAR 9,000.
   ════════════════════════════════════════════════════════════════ */

{
  const text = contractDetails(sixAds, 'Booking');
  ok('the contract states the fee (4,200)', text.includes('4,200'));
  ok('the contract does NOT state the client price (9,000)', !text.includes('9,000'));
  ok('and the total says whose it is', text.includes('Total payable to the vendor'));
  ok('per-ad rate is the fee, not the charge', text.includes('SAR 700 each'));
  ok('and not the charge', !text.includes('SAR 1,500 each'));
}

// With no fee agreed, the document says so rather than substituting a number.
{
  const text = contractDetails(
    [{ ad_type: 'Home Ad', quantity: 6, unit_price: 1500, net_amount: null }], 'Booking');
  ok('says the fee is not agreed', text.includes('not agreed yet'));
  ok('names how many lines are missing one', text.includes('1 line has no agreed fee'));
  ok('and still does not print the client price', !text.includes('9,000'));
}

// A mixed group averages to a rate nobody agreed. 2 @ 1,000 + 1 @ 1,500 of
// fee is 3,500 over 3 ads = 1,166.67, which multiplies back to 3,500.01.
// The old code printed "SAR 1,167 each · SAR 3,500" in a signed document.
{
  const mixed = [
    { ad_type: 'Home Ad', quantity: 2, unit_price: 2000, net_amount: 1000 },
    { ad_type: 'Home Ad', quantity: 1, unit_price: 3000, net_amount: 1500 },
  ];
  eq('group net adds up', groupByAdType(mixed)[0].net, 3500);
  const text = contractDetails(mixed, null);
  ok('a mixed group shows the total only', text.includes('3 × Home Ad — SAR 3,500'));
  ok('and invents no per-ad rate', !text.includes('each'));
}

// An even group still gets its per-ad rate, because that is what was agreed
// and what the vendor will check.
{
  const even = [
    { ad_type: 'Home Ad', quantity: 2, unit_price: 2000, net_amount: 1000 },
    { ad_type: 'Home Ad', quantity: 2, unit_price: 2000, net_amount: 1000 },
  ];
  ok('an even group keeps the rate', contractDetails(even, null).includes('SAR 1,000 each'));
}

/* ── contractPlan carries the fee, and null when there is none ───── */
{
  const lines = [
    { id: 'l1', ad_type: 'Home Ad', quantity: 6, unit_price: 1500, net_amount: 700 },
    { id: 'l2', ad_type: 'Store Visit', quantity: 1, unit_price: 5000, net_amount: 3000 },
  ];
  eq('combined: the fee, not the price', contractPlan(lines, 'combined')[0].amount, 7200);

  const split = contractPlan(lines, 'per-line');
  eq('per-line: first is the fee', split[0].amount, 4200);
  eq('per-line: second is the fee', split[1].amount, 3000);

  const noFee = [{ id: 'l1', ad_type: 'Home Ad', quantity: 6, unit_price: 1500 }];
  eq('no fee agreed: null, never the client price',
    contractPlan(noFee, 'combined')[0].amount, null);

  // One line priced, one not: what IS agreed is summed, and the gap shows up
  // in the checklist rather than being papered over here.
  const partial = [
    { id: 'l1', ad_type: 'Home Ad', quantity: 2, unit_price: 1500, net_amount: 700 },
    { id: 'l2', ad_type: 'Store Visit', quantity: 1, unit_price: 5000 },
  ];
  eq('partial fees sum what is known', contractPlan(partial, 'combined')[0].amount, 1400);
}

{
  // Money by month spans from the first month with anything to the last,
  // not a fixed six. The Asana import brought a whole year.
  const row = (m, price, net) => ({ created_at: `2026-${m}-15T00:00:00Z`, price, net_amount: net });
  const year = moneyByMonth([row('01', 100, 60), row('04', 50, 20), row('09', 10, 5)]);
  eq('January to September is nine months', year.length, 9);
  eq('starts at the first month with work', year[0].key, '2026-01');
  eq('ends at the last', year[8].key, '2026-09');
  eq('quiet months stay in at zero', year[1].price, 0);
  eq('gross is price less net', year[0].gross, 40);
  const capped = moneyByMonth([row('01', 1, 0), row('09', 1, 0)], 6);
  eq('a cap keeps the most recent months', capped.map((b) => b.key)[0], '2026-04');
  eq('and the cap is honoured', capped.length, 6);
  eq('one month is one bar', moneyByMonth([row('06', 1, 0)]).length, 1);
  eq('nothing is nothing', moneyByMonth([]).length, 0);
}

{
  // The ledgers hold completed campaigns only. Siraj: "make sure that
  // collection and liability only gets added when the task is complete".
  const camp = (id, status, stage, extra = {}) => ({ id, parent_task_id: null, title: id, client_id: 'c', created_at: '2026-06-01', status, stage, client_payment_status: 'unpaid', ...extra });
  const book = (id, parent, net) => ({ id, parent_task_id: parent, title: `${id} booking`, vendor_id: 1, price: net + 1000, net_amount: net, status: 'done', stage: 'completed' });
  const parents = [camp('running', 'pending', 'in_progress'), camp('done', 'done', 'completed'), camp('cancelled', 'cancelled', 'in_progress'), camp('stage-done', 'pending', 'completed')];
  const subs = [book('b1', 'running', 900), book('b2', 'done', 800), book('b3', 'cancelled', 700), book('b4', 'stage-done', 600)];
  eq('isComplete: done', isComplete(parents[1]), true);
  eq('isComplete: stage completed', isComplete(parents[3]), true);
  eq('isComplete: running', isComplete(parents[0]), false);
  eq('isComplete: cancelled', isComplete(parents[2]), false);
  const cl = clientLedger({ parents, subtasks: subs });
  eq('collection: only the completed campaigns', cl.map((r) => r.id).sort(), ['done', 'stage-done']);
  const vl = vendorLedger({ subtasks: subs, parents });
  eq('liability: only bookings on completed campaigns, even when the booking itself is done', vl.map((r) => r.id).sort(), ['b2', 'b4']);
  eq('liability: the booking keeps its own net', vl.find((r) => r.id === 'b2').total, 800);
}
{
  // A completed campaign can still carry cancelled bookings among its live
  // ones. Cancelled means nothing was delivered, so it is neither money we
  // can bill (collection) nor money we owe (liability). Before the fix, its
  // price swelled the campaign's bill and its net became a vendor row.
  const camp = { id: 'k', parent_task_id: null, title: 'k', client_id: 'c', created_at: '2026-06-01', status: 'done', stage: 'completed', client_payment_status: 'unpaid' };
  const live = { id: 'live', parent_task_id: 'k', title: 'live booking', vendor_id: 1, price: 1000, net_amount: 800,  status: 'done',      stage: 'completed' };
  const cxl  = { id: 'cxl',  parent_task_id: 'k', title: 'cxl booking',  vendor_id: 1, price: 5000, net_amount: 4000, status: 'cancelled', stage: 'in_progress' };
  const cl = clientLedger({ parents: [camp], subtasks: [live, cxl] });
  eq('collection: cancelled booking is not billed', cl.find((r) => r.id === 'k').total, 1000);
  const vl = vendorLedger({ subtasks: [live, cxl], parents: [camp] });
  eq('liability: cancelled booking never becomes a row', vl.map((r) => r.id).sort(), ['live']);
  eq('liability: only the live net is owed', vl.reduce((a, r) => a + r.total, 0), 800);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
