/**
 * chaseCandidates - which contract requests have sat waiting long enough to
 * chase into the inbox.
 *
 * A request is a candidate only while it is genuinely waiting on a person
 * (pending/approved) and has waited at least CHASE_AFTER_DAYS whole days. A
 * generated/rejected/cancelled request is settled and never chased; a request
 * with no created_at cannot be aged and is skipped rather than guessed at.
 */
import { chaseCandidates, CHASE_AFTER_DAYS } from '../.test-build/contracts.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}`); } };

const TODAY = '2026-09-14';
// created_at N days before TODAY.
const daysAgo = (n) => {
  const d = new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000);
  return d.toISOString();
};

ok('CHASE_AFTER_DAYS is 3', CHASE_AFTER_DAYS === 3);

// Exactly at the threshold is chased; one day under is not.
{
  const rows = [
    { id: 'a', status: 'pending', created_at: daysAgo(3) },
    { id: 'b', status: 'pending', created_at: daysAgo(2) },
  ];
  const got = chaseCandidates(rows, TODAY);
  const ids = got.map((c) => c.id);
  ok('3 days -> chased', ids.includes('a'));
  ok('2 days -> not chased', !ids.includes('b'));
  ok('reports the age', got.find((c) => c.id === 'a')?.ageDays === 3);
}

// Both waiting statuses count.
{
  const rows = [
    { id: 'p', status: 'pending', created_at: daysAgo(5) },
    { id: 'q', status: 'approved', created_at: daysAgo(5) },
  ];
  const ids = chaseCandidates(rows, TODAY).map((c) => c.id);
  ok('pending waits', ids.includes('p'));
  ok('approved waits', ids.includes('q'));
}

// Settled statuses are never chased, however old.
{
  const rows = [
    { id: 'g', status: 'generated', created_at: daysAgo(90) },
    { id: 'r', status: 'rejected', created_at: daysAgo(90) },
    { id: 'c', status: 'cancelled', created_at: daysAgo(90) },
  ];
  ok('settled never chased', chaseCandidates(rows, TODAY).length === 0);
}

// Unknown status folds to pending (statusOf), so it is chaseable when old.
{
  const rows = [{ id: 'u', status: 'weird_value', created_at: daysAgo(10) }];
  ok('unknown status folds to waiting', chaseCandidates(rows, TODAY).length === 1);
}

// No created_at: skipped, not guessed.
{
  const rows = [
    { id: 'n1', status: 'pending', created_at: null },
    { id: 'n2', status: 'pending' },
    { id: 'n3', status: 'pending', created_at: '' },
  ];
  ok('missing date skipped', chaseCandidates(rows, TODAY).length === 0);
}

// A custom threshold overrides the default.
{
  const rows = [{ id: 'x', status: 'pending', created_at: daysAgo(4) }];
  ok('under custom threshold', chaseCandidates(rows, TODAY, 7).length === 0);
  ok('over custom threshold', chaseCandidates(rows, TODAY, 4).length === 1);
}

// Empty input is fine.
ok('empty input', chaseCandidates([], TODAY).length === 0);

console.log(`contracts-chase: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
