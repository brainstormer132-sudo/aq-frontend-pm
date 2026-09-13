import {
  latestQuotation, financeRows, statusLabel, statusBadge,
} from '../.test-build/finance.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

const doc = (o) => ({ id: o.id ?? 'd', pm_task_id: o.t ?? 't1', kind: o.kind ?? 'quotation',
  document_number: o.num ?? 'EST-1', status: o.status ?? 'generated',
  amount: o.amount ?? 100, created_at: o.at ?? '2026-07-01T00:00:00Z' });

// -- latestQuotation ----------------------------------------------
eq('no docs -> null', latestQuotation([]), null);
eq('an invoice is not a quotation', latestQuotation([doc({ kind: 'invoice' })]), null);
{
  const newest = latestQuotation([
    doc({ id: 'a', num: 'EST-1', at: '2026-07-01T00:00:00Z' }),
    doc({ id: 'b', num: 'EST-2', at: '2026-07-05T00:00:00Z' }),
  ]);
  eq('picks the newest by created_at', newest.id, 'b');
}
eq('a voided quotation is not current', latestQuotation([doc({ status: 'void' })]), null);
{
  const r = latestQuotation([doc({ id: 'r', status: 'rejected' })]);
  ok('a rejected quotation IS current', r && r.id === 'r');
}

// -- financeRows --------------------------------------------------
const camp = (id, extra = {}) => ({ parent_task_id: id, title: id, brand_name: id.toUpperCase(),
  parent_total_amount: 1000, ...extra });

{
  const rows = financeRows(
    [camp('t1', { parent_total_amount: 5000 })],
    [doc({ t: 't1', num: 'EST-9', status: 'accepted', amount: 5750 })],
  );
  eq('one row', rows.length, 1);
  eq('amount from parent_total_amount', rows[0].amount, 5000);
  eq('quotation number surfaced', rows[0].quotation.number, 'EST-9');
  eq('accepted -> re-quote action', rows[0].actionLabel, 'Re-quote');
}
{
  const rows = financeRows([camp('t2')], []);
  eq('no docs -> needs a quotation', rows[0].quotation, null);
  eq('no quotation -> generate action', rows[0].actionLabel, 'Generate quotation');
}
{
  // ranking: needs-quote first, then rejected, then settled; value breaks ties
  const rows = financeRows(
    [camp('settled', { parent_total_amount: 100 }),
     camp('needs',   { parent_total_amount: 100 }),
     camp('rejected',{ parent_total_amount: 100 })],
    [doc({ t: 'settled',  status: 'accepted' }),
     doc({ t: 'rejected', status: 'rejected' })],
  );
  eq('order: needs, rejected, settled',
    rows.map((r) => r.taskId), ['needs', 'rejected', 'settled']);
}
{
  const rows = financeRows(
    [camp('small', { parent_total_amount: 100 }), camp('big', { parent_total_amount: 900 })], []);
  eq('within a rank, bigger value first', rows.map((r) => r.taskId), ['big', 'small']);
}
eq('sum_prices used when parent_total_amount is null',
  financeRows([camp('t', { parent_total_amount: null, sum_prices: 250 })], [])[0].amount, 250);

// -- labels -------------------------------------------------------
eq('sent label', statusLabel('sent'), 'Sent to client');
eq('accepted badge', statusBadge('accepted'), 'aq-badge-success');
eq('rejected badge', statusBadge('rejected'), 'aq-badge-error');
eq('generated badge is a waiting colour', statusBadge('generated'), 'aq-badge-warning');

console.log(`finance: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
