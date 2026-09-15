import {
  latestQuotation, financeRows, statusLabel, statusBadge,
  normalizeTag, hasTag, rowsForTag, rowsForTab, tabCounts, paginate,
  FINANCE_TABS, FINANCE_PAGE_SIZES,
  rowMatchesTab, hasOpenRequest, openRequests, daysAgo,
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

// -- tags: normalize / hasTag -------------------------------------
eq('normalizeTag strips # and lowercases', normalizeTag('#Quotation '), 'quotation');
eq('normalizeTag of blank', normalizeTag('  '), '');
ok('hasTag is case- and #-insensitive', hasTag(['#Quotation'], 'quotation'));
ok('hasTag no match', !hasTag(['#invoice'], 'quotation'));
ok('hasTag empty list', !hasTag([], 'quotation'));

// -- rowsForTab / rowsForTag / tabCounts --------------------------
{
  const rows = [
    { taskId: 't1', title: 'A', brand: '', amount: 10, quotation: null, actionLabel: 'Generate quotation' },
    { taskId: 't2', title: 'B', brand: '', amount: 20, quotation: null, actionLabel: 'Generate quotation' },
    { taskId: 't3', title: 'C', brand: '', amount: 30, quotation: null, actionLabel: 'Generate quotation' },
  ];
  const tags = { t1: ['#Quotation'], t2: ['#invoice', '#transaction'], t3: [] };
  eq('rowsForTab All (empty tag) -> everything', rowsForTab(rows, tags, '').map((r) => r.taskId), ['t1', 't2', 't3']);
  eq('rowsForTab quotation -> t1', rowsForTab(rows, tags, 'quotation').map((r) => r.taskId), ['t1']);
  eq('rowsForTab invoice -> t2', rowsForTab(rows, tags, 'invoice').map((r) => r.taskId), ['t2']);
  eq('rowsForTag never returns All', rowsForTag(rows, tags, '').length, 0);
  eq('rowsForTab requotation -> none', rowsForTab(rows, tags, 'requotation').length, 0);
  const m = new Map(Object.entries(tags));
  eq('rowsForTab accepts a Map', rowsForTab(rows, m, 'quotation').map((r) => r.taskId), ['t1']);
  const counts = tabCounts(rows, tags);
  eq('tabCounts includes All', counts, { all: 3, quotation: 1, requotation: 0, invoice: 1, transaction: 1 });
}

// -- paginate -----------------------------------------------------
{
  const items = Array.from({ length: 23 }, (_, i) => i);
  eq('page 1 size 10', paginate(items, 1, 10).items.length, 10);
  eq('page count', paginate(items, 1, 10).pageCount, 3);
  eq('total', paginate(items, 1, 10).total, 23);
  eq('last page is short', paginate(items, 3, 10).items, [20, 21, 22]);
  eq('out-of-range page clamps to last', paginate(items, 99, 10).page, 3);
  eq('page below 1 clamps to 1', paginate(items, 0, 10).page, 1);
  eq('empty list is one page', paginate([], 1, 10).pageCount, 1);
  eq('bigger page size', paginate(items, 1, 25).items.length, 23);
  eq('default sizes', FINANCE_PAGE_SIZES[0], 10);
  eq('five tabs, All first', FINANCE_TABS.map((t) => t.key), ['all', 'quotation', 'requotation', 'invoice', 'transaction']);
}

// -- open requests: Finance sees what the campaign asked for ------
const req = (t, kind, at, by) => ({ pm_task_id: t, doc_kind: kind, status: 'pending',
  requested_by: by ?? 'u1', requested_at: at ?? '2026-09-10T00:00:00Z' });
const TODAY = '2026-09-15';

{
  const rows = financeRows([camp('t1')], [], [req('t1', 'quotation', '2026-09-12T00:00:00Z')]);
  eq('open quotation request captured', !!rows[0].requests.quotation, true);
  eq('first quotation bucket', rows[0].quotationBucket, 'quotation');
  ok('has open request', hasOpenRequest(rows[0]));
  const tags = { t1: [] };
  eq('routes to Quotation tab by request (no tag)', rowsForTab(rows, tags, 'quotation').map((r) => r.taskId), ['t1']);
  eq('NOT in Re-quotation tab', rowsForTab(rows, tags, 'requotation').length, 0);
  eq('NOT in Invoice tab', rowsForTab(rows, tags, 'invoice').length, 0);
}
{
  const rows = financeRows(
    [camp('t2')],
    [doc({ t: 't2', status: 'accepted' })],
    [req('t2', 'quotation', '2026-09-13T00:00:00Z')],
  );
  eq('re-quotation bucket', rows[0].quotationBucket, 'requotation');
  const tags = { t2: [] };
  eq('routes to Re-quotation tab', rowsForTab(rows, tags, 'requotation').map((r) => r.taskId), ['t2']);
  eq('NOT in first Quotation tab', rowsForTab(rows, tags, 'quotation').length, 0);
}
{
  const rows = financeRows([camp('t3')], [], [req('t3', 'invoice')]);
  eq('open invoice request captured', !!rows[0].requests.invoice, true);
  const tags = { t3: [] };
  eq('routes to Invoice tab', rowsForTab(rows, tags, 'invoice').map((r) => r.taskId), ['t3']);
}
{
  const rows = financeRows(
    [camp('q'), camp('i'), camp('rq')],
    [doc({ t: 'rq', status: 'accepted' })],
    [req('q', 'quotation'), req('i', 'invoice'), req('rq', 'quotation')],
  );
  const counts = tabCounts(rows, { q: [], i: [], rq: [] });
  eq('counts reflect requests', counts, { all: 3, quotation: 1, requotation: 1, invoice: 1, transaction: 0 });
}
{
  const rows = financeRows(
    [camp('a'), camp('b')],
    [],
    [req('a', 'quotation', '2026-09-14T00:00:00Z'), req('b', 'invoice', '2026-09-09T00:00:00Z')],
  );
  const strip = openRequests(rows, TODAY);
  eq('two open requests', strip.length, 2);
  eq('oldest first (b waited longer)', strip.map((s) => s.taskId), ['b', 'a']);
  eq('kind carried', strip[0].kind, 'invoice');
  eq('age in days', strip[0].ageDays, 6);
}
{
  const rows = financeRows([camp('t')], [], []);
  ok('tag still matches', rowMatchesTab(rows[0], { t: ['#invoice'] }, 'invoice'));
  ok('no tag, no request -> no match', !rowMatchesTab(rows[0], { t: [] }, 'invoice'));
}
eq('daysAgo undated -> null', daysAgo('', TODAY), null);
eq('daysAgo future -> 0 (never negative)', daysAgo('2026-09-20T00:00:00Z', TODAY), 0);

console.log(`finance: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
