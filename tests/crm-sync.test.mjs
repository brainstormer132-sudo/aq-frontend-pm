import { prefillFromDeal } from '../.test-build/crm-sync.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const deal = (over = {}) => ({
  id: 'd-1',
  name: 'Ramadan 2026',
  value: 120000,
  target_type: 'client',
  target_id: 'c-9',
  brand_id: 'b-3',
  owner_id: 'p-7',
  expected_close_date: '2026-03-01',
  notes: 'Two reels, one static.',
  ...over,
});

// The whole deal carries over.
{
  const p = prefillFromDeal(deal());
  eq('name', p.task_name, 'Ramadan 2026');
  eq('client', p.client_id, 'c-9');
  eq('budget', p.budget, 120000);
  eq('deal link', p.deal_id, 'd-1');
  eq('owner becomes closer', p.sales_closer_id, 'p-7');
  eq('close date becomes due date', p.due_date, '2026-03-01');
  eq('brand carries', p.brand_id, 'b-3');
}

// A vendor deal has no client to hang a campaign on.
{
  const p = prefillFromDeal(deal({ target_type: 'vendor' }));
  eq('vendor target => no client', p.client_id, null);
  // The link and the closer still carry - they are not client-specific.
  eq('vendor deal still links', p.deal_id, 'd-1');
  eq('vendor deal keeps closer', p.sales_closer_id, 'p-7');
  // A brand belongs to a client, so a vendor deal drops it even if one is set.
  eq('vendor deal drops brand', p.brand_id, null);
}

// The new fields degrade to null, never to an empty string.
{
  const p = prefillFromDeal({
    name: 'Bare deal', value: null, target_type: 'client', target_id: 'c-2',
  });
  eq('no id => null link', p.deal_id, null);
  eq('no owner => null closer', p.sales_closer_id, null);
  eq('no close date => null due', p.due_date, null);
  eq('no value => null budget', p.budget, null);
  eq('no brand => null brand', p.brand_id, null);
}

// A datetime close date is trimmed to the day.
{
  const p = prefillFromDeal(deal({ expected_close_date: '2026-03-01T00:00:00Z' }));
  eq('due date is the day only', p.due_date, '2026-03-01');
}

// Zero / non-positive value is not a budget.
{
  const p = prefillFromDeal(deal({ value: 0 }));
  eq('zero value => null budget', p.budget, null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
