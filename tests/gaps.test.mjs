/**
 * campaignGaps - a task is not "complete" until its core fields are filled.
 *
 * Siraj: a task should not show as ready before due date, runs from-to,
 * approval, contract status, brand, brand name, name, category and closed-by
 * are set. Ad type, platforms and key account deliberately do NOT gate it.
 */
import { campaignGaps } from '../.test-build/campaign-page.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };
const keys = (gaps) => new Set(gaps.map((g) => g.key));

const REQUIRED = ['name', 'brand', 'category', 'closer', 'start', 'end', 'approval', 'contract-status'];

// A fully-filled task with no bookings and nothing overdue: no gaps at all.
{
  const g = campaignGaps({
    budget: 1000, dueDate: '2026-01-01', bookings: [], adsWithoutDate: 0, today: '2026-01-01',
    taskName: 'Ramadan', brandName: 'Sunbulah', categoryId: 'cat1', hasCloser: true,
    startDate: '2026-01-01', endDate: '2026-02-01', approval: 'approved',
    contractStatus: 'signed_attached',
  });
  ok('a fully-filled task has no gaps', g.length === 0);
}

// An empty task flags every required field (plus budget + due).
{
  const g = campaignGaps({ bookings: [], adsWithoutDate: 0, today: '2026-01-01' });
  const k = keys(g);
  for (const r of REQUIRED) ok(`empty task flags ${r}`, k.has(r));
  ok('empty task flags due', k.has('due'));
  ok('empty task flags budget', k.has('budget'));
}

// Ad type, platforms and key account never gate completeness.
{
  const g = campaignGaps({
    budget: 1000, dueDate: '2026-01-01', bookings: [], adsWithoutDate: 0, today: '2026-01-01',
    taskName: 'X', brandName: 'B', categoryId: 'c', hasCloser: true,
    startDate: '2026-01-01', endDate: '2026-02-01', approval: 'approved', contractStatus: 'po',
  });
  const k = keys(g);
  ok('no ad-type gap', !k.has('adType') && !k.has('ad_type'));
  ok('no platforms gap', !k.has('platforms'));
  ok('no key-account gap', !k.has('keyAccount') && !k.has('key_account'));
}

// A blank contract status or approach counts as missing, a set one does not.
{
  const missing = campaignGaps({
    budget: 1, dueDate: '2026-01-01', bookings: [], adsWithoutDate: 0, today: '2026-01-01',
    taskName: 'X', brandName: 'B', categoryId: 'c', hasCloser: true,
    startDate: '2026-01-01', endDate: '2026-02-01', approval: 'approved', contractStatus: '',
  });
  ok('blank contract status is a gap', keys(missing).has('contract-status'));
  const set = campaignGaps({
    budget: 1, dueDate: '2026-01-01', bookings: [], adsWithoutDate: 0, today: '2026-01-01',
    taskName: 'X', brandName: 'B', categoryId: 'c', hasCloser: true,
    startDate: '2026-01-01', endDate: '2026-02-01', approval: 'approved', contractStatus: 'no_contract',
  });
  ok('a chosen contract status is not a gap', !keys(set).has('contract-status'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);