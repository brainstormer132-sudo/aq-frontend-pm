import { moneyBar, bookingRows, amountOrNull } from '../.test-build/campaign-page.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/* ── The bug Siraj reported ──────────────────────────────────────── */
// A campaign worth 100,000. Bookings bill the client 100,000 in total and
// the vendors take 70,000 of it. AQ keeps 30,000.
{
  const b = moneyBar({ budget: 100000, vendorCost: 70000, breakdown: 100000 });
  eq('net is budget minus what vendors take', b.net, 30000);
  eq('margin', b.marginRate, 30);
  eq('vendorCost is the vendors', b.vendorCost, 70000);
  eq('breakdown is the client', b.breakdown, 100000);
  eq('no variance when they agree', b.breakdownVariance, 0);
  eq('not overspent', b.overspent, false);
  eq('cost width', Math.round(b.costPct), 70);
}

// The old behaviour, stated as the thing that must NOT happen: feeding the
// breakdown in as the cost made net come out at zero on a correct campaign.
{
  const wrong = moneyBar({ budget: 100000, vendorCost: 100000, breakdown: 100000 });
  eq('the old wiring would have said this', wrong.net, 0);
}

/* ── Budget vs breakdown ─────────────────────────────────────────── */
{
  const b = moneyBar({ budget: 100000, vendorCost: 60000, breakdown: 92000 });
  eq('under-billed variance', b.breakdownVariance, 8000);
  eq('budget still leads the margin', b.net, 40000);
  eq('budget is the typed one', b.budget, 100000);
  eq('not inferred', b.budgetFromBreakdown, false);
}
{
  const b = moneyBar({ budget: 100000, vendorCost: 60000, breakdown: 115000 });
  eq('over-billed variance is negative', b.breakdownVariance, -15000);
}

/* ── No budget typed, but the bookings are priced ────────────────── */
{
  const b = moneyBar({ vendorCost: 30000, breakdown: 50000 });
  eq('falls back to the breakdown', b.budget, 50000);
  eq('says it was inferred', b.budgetFromBreakdown, true);
  eq('margin off the breakdown', b.net, 20000);
  eq('margin rate', b.marginRate, 40);
  eq('no variance to report', b.breakdownVariance, null);
  eq('sentence names the bookings', b.sentence.includes('of bookings'), true);
}

/* ── Nothing entered ─────────────────────────────────────────────── */
{
  const b = moneyBar({});
  eq('empty budget', b.budget, null);
  eq('empty net', b.net, null);
  eq('empty margin', b.marginRate, null);
  eq('empty sentence', b.sentence, 'Nothing priced yet.');
  eq('empty is not inferred', b.budgetFromBreakdown, false);
}
// Vendors committed, nothing billed and no budget: still not a margin of 0.
{
  const b = moneyBar({ vendorCost: 12000 });
  eq('cost with no revenue gives no margin', b.marginRate, null);
  eq('and no net', b.net, null);
  eq('bar is all cost', b.costPct, 100);
  eq('says so', b.sentence.includes('nobody has set'), true);
}

/* ── Overspent ───────────────────────────────────────────────────── */
{
  const b = moneyBar({ budget: 50000, vendorCost: 60000, breakdown: 50000 });
  eq('overspent', b.overspent, true);
  eq('negative net', b.net, -10000);
  eq('bar clamps at 100', b.costPct, 100);
  eq('sentence says more than', b.sentence.includes('more than'), true);
}

/* ── Zero is "not entered", not "free" ───────────────────────────── */
{
  const b = moneyBar({ budget: 80000, vendorCost: 0, breakdown: 80000 });
  eq('zero cost reads as unknown', b.vendorCost, null);
  eq('so net is the whole budget', b.net, 80000);
}
eq('amountOrNull rejects zero', amountOrNull(0), null);
eq('amountOrNull rejects blank', amountOrNull(''), null);
eq('amountOrNull rejects rubbish', amountOrNull('abc'), null);
eq('amountOrNull rejects negatives', amountOrNull(-5), null);
eq('amountOrNull takes strings', amountOrNull('1200.50'), 1200.5);

/* ── The rollup the page does, end to end ────────────────────────── */
// Two bookings. One priced per line (an influencer), one typed flat.
{
  const rows = bookingRows({
    subtasks: [
      { id: 'a', vendor_id: 1, price: null, net_amount: null },
      { id: 'b', vendor_id: 2, price: 20000, net_amount: 14000 },
    ],
    ads: [
      { subtask_id: 'a', quantity: 3, unit_price: 5000, net_amount: 3500 },
      { subtask_id: 'a', quantity: 1, unit_price: 9000, net_amount: 6000 },
    ],
    vendorNames: new Map([[1, 'Reem'], [2, 'Bright Studios']]),
  });
  eq('per-line price is 3x5000 + 9000', rows[0].price, 24000);
  eq('per-line net is 3500 + 6000', rows[0].net, 9500);
  eq('per-line flag', rows[0].pricedPerLine, true);
  eq('flat booking price', rows[1].price, 20000);
  eq('flat booking net', rows[1].net, 14000);
  eq('flat booking is not per-line', rows[1].pricedPerLine, false);

  // What CampaignPage now does with them.
  let breakdown = 0, cost = 0, anyCost = false;
  for (const r of rows) {
    if (r.price != null) breakdown += r.price;
    if (r.net != null) { cost += r.net; anyCost = true; }
  }
  eq('client is billed', breakdown, 44000);
  eq('vendors take', cost, 23500);

  const bar = moneyBar({ budget: 44000, vendorCost: anyCost ? cost : null, breakdown });
  eq('AQ keeps the difference', bar.net, 20500);
  eq('and the breakdown agrees with the budget', bar.breakdownVariance, 0);
}

// Nobody has entered any vendor cost: the margin must not read 100%.
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1, price: 30000 }],
    ads: [],
  });
  eq('no net on the booking', rows[0].net, null);
  let cost = 0, anyCost = false;
  for (const r of rows) if (r.net != null) { cost += r.net; anyCost = true; }
  eq('so there is no cost to report', anyCost, false);
  const bar = moneyBar({ budget: 30000, vendorCost: anyCost ? cost : null, breakdown: 30000 });
  eq('vendorCost stays unknown', bar.vendorCost, null);
  // net still shows the budget, which is honest: nothing is committed yet.
  eq('net is the whole budget until a cost is entered', bar.net, 30000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
