import {
  creditBalance, creditBalancesByClient, overpaymentCandidates,
} from '../.test-build/client-credits.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

/* The balance is the signed sum of logged entries */
eq('a grant then a use nets out', creditBalance([{ amount: 5000 }, { amount: -2000 }]), 3000);
eq('empty is zero', creditBalance([]), 0);
eq('rubbish amounts are ignored', creditBalance([{ amount: 'x' }, { amount: 1000 }, { amount: null }]), 1000);
eq('a fully-used credit is zero, not negative-by-typo', creditBalance([{ amount: 1000 }, { amount: -1000 }]), 0);

{
  const m = creditBalancesByClient([
    { client_id: 'a', amount: 1000 }, { client_id: 'b', amount: 500 }, { client_id: 'a', amount: -300 },
  ]);
  eq('client a nets', m.get('a'), 700);
  eq('client b', m.get('b'), 500);
}

/* Overpayment candidates: completed, billed < recorded */
const camp = (id, extra = {}) => ({
  id, parent_task_id: null, title: id, task_name: id, client_id: 'c',
  status: 'done', stage: 'completed', ...extra,
});
const sub = (parent, price, extra = {}) => ({
  id: `${parent}-s`, parent_task_id: parent, title: 's', price, net_amount: 0,
  status: 'done', stage: 'completed', ...extra,
});

// Billed 10,000 (6,000 + 4,000), client recorded 12,000 -> 2,000 overpaid.
{
  const cands = overpaymentCandidates({
    parents: [camp('k', { client_payment_amount: 12000 })],
    subtasks: [sub('k', 6000), { ...sub('k', 4000), id: 'k-s2' }],
  });
  eq('one candidate', cands.length, 1);
  eq('billed is the sum of prices', cands[0].billed, 10000);
  eq('recorded is what the client paid', cands[0].recorded, 12000);
  eq('excess is the overpayment', cands[0].excess, 2000);
  eq('and it carries the client', cands[0].clientId, 'c');
}

// A cancelled booking must not inflate the bill and hide an overpayment.
{
  const cands = overpaymentCandidates({
    parents: [camp('k', { client_payment_amount: 7000 })],
    subtasks: [sub('k', 6000), { ...sub('k', 5000), id: 'k-cxl', status: 'cancelled', stage: 'in_progress' }],
  });
  eq('cancelled booking is not billed, so 7000 > 6000 is an overpayment', cands[0]?.excess, 1000);
}

// Paid exactly, or under: not a candidate.
{
  eq('paid exactly is not a candidate',
    overpaymentCandidates({ parents: [camp('k', { client_payment_amount: 10000 })], subtasks: [sub('k', 10000)] }).length, 0);
  eq('underpaid is not a candidate',
    overpaymentCandidates({ parents: [camp('k', { client_payment_amount: 4000 })], subtasks: [sub('k', 10000)] }).length, 0);
}

// A running campaign is never a candidate, however much is recorded.
{
  eq('running campaign excluded',
    overpaymentCandidates({
      parents: [camp('k', { status: 'pending', stage: 'in_progress', client_payment_amount: 99999 })],
      subtasks: [sub('k', 1000)],
    }).length, 0);
}

// Already logged as credit against this campaign: not offered again.
{
  const parents = [camp('k', { client_payment_amount: 12000 })];
  const subtasks = [sub('k', 10000)];
  eq('fully credited -> no candidate',
    overpaymentCandidates({ parents, subtasks, creditedByTask: new Map([['k', 2000]]) }).length, 0);
  const partial = overpaymentCandidates({ parents, subtasks, creditedByTask: new Map([['k', 500]]) });
  eq('partially credited -> only the rest is offered', partial[0].excess, 1500);
}

// Biggest overpayment first.
{
  const cands = overpaymentCandidates({
    parents: [camp('small', { client_payment_amount: 1100 }), camp('big', { client_payment_amount: 9000 })],
    subtasks: [sub('small', 1000), sub('big', 5000)],
  });
  eq('sorted biggest excess first', cands.map((c) => c.taskId), ['big', 'small']);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
