/**
 * The Data view counts money the way the Asana board does.
 *
 * Two things the panels above never did: count a campaign whose money sits on
 * the parent row (no priced sub-rows), and slice by Approval stage / Statues /
 * Client Payment. Reproduced against the 2024/2026 exports, these were the
 * whole gap - 12M of parent-only money in 2024, and the status filters that
 * made the board's tiles disagree with the app.
 */
import { moneyContribs, asanaTiles, buildDashboard, ALL_TIME } from '../.test-build/dashboard-data.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const camp = (id, o = {}) => ({
  id, parent_task_id: null, title: 't', task_name: null, brand_name: null,
  client_id: null, vendor_id: null, assignee_id: null, created_at: '2026-01-01',
  stage: 'in_progress', status: 'pending', subtask_kind: null,
  price: null, net_amount: null, client_payment_status: null, client_payment_amount: null,
  contract_status: null, vendor_payment_amount: null, vendor_payment_date: null,
  approval_stage: null, budget: null, ...o,
});
const sub = (id, parent, o = {}) => camp(id, { parent_task_id: parent, ...o });

// 1. a campaign broken into priced sub-rows: contribs come from the sub-rows,
//    the parent's budget is NOT double-counted.
{
  const parents = [camp('c1', { budget: 100, approval_stage: 'approved', client_payment_status: 'unpaid', status: 'done' })];
  const subs = [
    sub('s1', 'c1', { price: 60, net_amount: 40, status: 'done' }),
    sub('s2', 'c1', { price: 40, net_amount: 25, status: 'pending' }),
  ];
  const cs = moneyContribs(parents, subs);
  eq('priced children give two contribs', cs.length, 2);
  eq('budget is not added when children are priced', cs.reduce((a, r) => a + r.price, 0), 100);
  eq('a sub inherits its campaign approval', cs[0].approval, 'approved');
  eq('a sub inherits its campaign client payment', cs[0].clientPay, 'unpaid');
  eq('a sub keeps its OWN status', [cs[0].status, cs[1].status], ['done', 'pending']);
}

// 2. a campaign whose sub-rows carry no money: its budget is counted once.
{
  const parents = [camp('c2', { budget: 5000, approval_stage: 'approved', status: 'done', client_payment_status: 'unpaid' })];
  const subs = [sub('s3', 'c2', { price: 0, net_amount: 0, status: 'done' })];
  const cs = moneyContribs(parents, subs);
  eq('parent-only money is not dropped', cs.length, 1);
  eq('the parent contributes its budget', cs[0].price, 5000);
  eq('the parent gross is the whole price', cs[0].price - cs[0].net, 5000);
}

// 3. a childless campaign with a budget still counts.
{
  const cs = moneyContribs([camp('c3', { budget: 700, status: 'pending' })], []);
  eq('childless campaign is counted', cs.length, 1);
  eq('childless campaign carries its budget', cs[0].price, 700);
}

// 4. the tiles.
{
  const parents = [
    camp('A', { approval_stage: 'approved', client_payment_status: 'unpaid', status: 'done' }),
    camp('B', { approval_stage: 'approved', client_payment_status: 'paid', status: 'pending' }),
    camp('P', { approval_stage: 'approved', client_payment_status: 'unpaid', status: 'done', budget: 1000 }),
  ];
  const subs = [
    sub('a1', 'A', { price: 100, net_amount: 60, status: 'done' }),
    sub('a2', 'A', { price: 50, net_amount: 20, status: 'pending' }),
    sub('b1', 'B', { price: 200, net_amount: 150, status: 'pending' }),
    sub('b2', 'B', { price: 80, net_amount: 30, status: 'cancelled' }),
  ];
  const t = asanaTiles(parents, subs);
  eq('sumPrice counts everything incl parent-only', t.sumPrice, 100 + 50 + 200 + 80 + 1000);
  eq('salesDone = the done rows (a1 + parent-only P)', t.salesDone, 100 + 1000);
  eq('salesPending = the pending rows', t.salesPending, 50 + 200);
  // gross and (Unpaid) are AD-line only: parent-only P (no vendor net) is out.
  eq('estAqGross is approved + done/pending AD gross', t.estAqGross, 40 + 30 + 50);
  eq('approvedDoneUnpaid is AD only (P excluded)', t.approvedDoneUnpaid, 100);
  eq('approvedPendingUnpaid excludes the paid one', t.approvedPendingUnpaid, 50);
}

// 5. no_payment is NOT unpaid - Asana's filter is the literal value.
{
  const parents = [camp('N', { approval_stage: 'approved', status: 'done', client_payment_status: 'no_payment' })];
  const subs = [sub('n1', 'N', { price: 300, net_amount: 100, status: 'done' })];
  const t = asanaTiles(parents, subs);
  eq('no_payment is excluded from the unpaid tile', t.approvedDoneUnpaid, 0);
  eq('but it still counts in gross', t.estAqGross, 200);
}

// 6. a non-approved campaign stays out of the approved tiles but in sales/price.
{
  const parents = [camp('H', { approval_stage: 'hold', status: 'done', client_payment_status: 'unpaid' })];
  const subs = [sub('h1', 'H', { price: 400, net_amount: 100, status: 'done' })];
  const t = asanaTiles(parents, subs);
  eq('hold is out of estAqGross', t.estAqGross, 0);
  eq('hold is out of approvedDoneUnpaid', t.approvedDoneUnpaid, 0);
  eq('hold is still in sumPrice and salesDone', [t.sumPrice, t.salesDone], [400, 400]);
}

// 7. a sub-row's OWN approval / payment wins over its campaign's - an approved
//    campaign can hold a cancelled sub-row, or one already paid.
{
  const parents = [camp('K', { approval_stage: 'approved', client_payment_status: 'unpaid', status: 'done' })];
  const subs = [
    sub('k1', 'K', { price: 100, net_amount: 20, status: 'done', approval_stage: 'approved', client_payment_status: 'unpaid' }),
    sub('k2', 'K', { price: 500, net_amount: 100, status: 'done', approval_stage: 'canceled', client_payment_status: 'unpaid' }),
    sub('k3', 'K', { price: 300, net_amount: 50, status: 'done', approval_stage: 'approved', client_payment_status: 'paid' }),
  ];
  const t = asanaTiles(parents, subs);
  eq('estAqGross uses each sub-row own approval', t.estAqGross, (100 - 20) + (300 - 50));
  eq('approvedDoneUnpaid uses the sub-row own payment', t.approvedDoneUnpaid, 100);
  const cs = moneyContribs(parents, [sub('k4', 'K', { price: 10, net_amount: 1, status: 'done' })]);
  eq('a sub-row with no approval inherits the campaign', cs[0].approval, 'approved');
}

// 8. the whole-workspace model carries the board tiles; a scoped lookup does not.
{
  const tasks = [
    camp('W1', { client_id: 'cl1', approval_stage: 'approved', client_payment_status: 'unpaid', status: 'done' }),
    sub('w1a', 'W1', { price: 200, net_amount: 50, status: 'done', approval_stage: 'approved', client_payment_status: 'unpaid' }),
    camp('W2', { client_id: 'cl1', status: 'pending', budget: 1000 }), // parent-only money
  ];
  const base = { tasks, clients: [{ id: 'cl1', company_name: 'C' }], vendors: [], people: [], range: ALL_TIME };
  const ws = buildDashboard({ ...base, scope: null });
  eq('the workspace model carries the board tiles', !!ws.asana, true);
  eq('board sumPrice includes the parent-only budget', ws.asana.sumPrice, 200 + 1000);
  eq('board approvedDoneUnpaid is the AD row only', ws.asana.approvedDoneUnpaid, 200);
  const scoped = buildDashboard({ ...base, scope: { kind: 'client', id: 'cl1', name: 'C', meta: '' } });
  eq('a scoped lookup has no board tiles', scoped.asana, undefined);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
