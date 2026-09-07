import { attentionItems, CONTRACT_PATIENCE_DAYS } from '../.test-build/attention.js';
import {
  contractTrack, contractIsStuck,
  CONTRACT_PATIENCE_DAYS as PAGE_PATIENCE,
} from '../.test-build/campaign-page.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const TODAY = '2026-08-27';

// The two lists must agree, or the dashboard sends you to a campaign that
// says everything is fine.
eq('one threshold, not two', CONTRACT_PATIENCE_DAYS, PAGE_PATIENCE);
eq('and it is a week', CONTRACT_PATIENCE_DAYS, 7);

/* ── contractIsStuck ─────────────────────────────────────────────── */
const req = (created, status = 'pending') => ({ status, created_at: created });

eq('a week is stuck',
  contractIsStuck(contractTrack(req('2026-08-20'), TODAY, null)), true);
eq('six days is not',
  contractIsStuck(contractTrack(req('2026-08-21'), TODAY, null)), false);
eq('sent today is not',
  contractIsStuck(contractTrack(req(TODAY), TODAY, null)), false);
eq('a month is very stuck',
  contractIsStuck(contractTrack(req('2026-07-01'), TODAY, null)), true);
// Signed, rejected and cancelled all came back. None of them is waiting.
eq('signed is not stuck',
  contractIsStuck(contractTrack(
    { status: 'generated', created_at: '2026-06-01', generated_at: '2026-06-05' },
    TODAY, null)), false);
eq('rejected is not stuck',
  contractIsStuck(contractTrack(req('2026-06-01', 'rejected'), TODAY, null)), false);
eq('cancelled is not stuck',
  contractIsStuck(contractTrack(req('2026-06-01', 'cancelled'), TODAY, null)), false);
// Never asked for is a different problem, handled by its own gap.
eq('no request is not stuck',
  contractIsStuck(contractTrack(null, TODAY, null)), false);
eq('blocked is not stuck',
  contractIsStuck(contractTrack(null, TODAY, 'IBAN')), false);
// The day count itself, which is what the message prints.
eq('counts the days',
  contractTrack(req('2026-08-13'), TODAY, null).waitingDays, 14);

/* ── The dashboard list ──────────────────────────────────────────── */
const booking = (over) => ({
  id: 'b1', parent_task_id: 'c1', title: 'Reem', subtask_kind: 'vendor',
  vendor_id: 7, price: 12000, contract_request_id: 'r1', ...over,
});
const campaign = { id: 'c1', title: 'Ramadan push', stage: 'in_progress' };

const run = (tasks, sentAt, status) => attentionItems(
  { tasks, requestSentAt: sentAt, contractStatus: status }, TODAY, {},
).items.filter((i) => i.kind === 'contract_stuck');

{
  const items = run([campaign, booking()], new Map([['b1', '2026-08-10']]));
  eq('one stuck contract', items.length, 1);
  eq('named', items[0].title, 'Reem');
  eq('with its campaign', items[0].context, 'Ramadan push');
  eq('and the count', items[0].message, 'Contract has been with Legal 17 days.');
  eq('soon, not urgent', items[0].severity, 'soon');
  eq('days for the sort', items[0].days, 17);
  eq('opens the booking', items[0].taskId, 'b1');
}
{
  eq('inside the window says nothing',
    run([campaign, booking()], new Map([['b1', '2026-08-25']])).length, 0);
  eq('exactly on the threshold counts',
    run([campaign, booking()], new Map([['b1', '2026-08-20']])).length, 1);
}
// A contract that came back is not stuck, however old.
{
  eq('generated', run([campaign, booking()],
    new Map([['b1', '2026-06-01']]), new Map([['b1', 'generated']])).length, 0);
  eq('rejected', run([campaign, booking()],
    new Map([['b1', '2026-06-01']]), new Map([['b1', 'rejected']])).length, 0);
  eq('cancelled', run([campaign, booking()],
    new Map([['b1', '2026-06-01']]), new Map([['b1', 'cancelled']])).length, 0);
  // The status can also sit on the task itself (028 put it there).
  eq('status on the task', run(
    [campaign, { ...booking(), contract_status: 'generated' }],
    new Map([['b1', '2026-06-01']])).length, 0);
}
// No sent date at all — nothing to count from, so nothing is claimed.
{
  eq('no map at all', run([campaign, booking()], undefined).length, 0);
  eq('map without this booking', run([campaign, booking()], new Map()).length, 0);
}
// The earlier gaps still win: an unpriced booking is a price problem, not a
// contract one, and a booking with no vendor is neither.
{
  const items = attentionItems(
    { tasks: [campaign, booking({ price: null })],
      requestSentAt: new Map([['b1', '2026-06-01']]) },
    TODAY, {},
  ).items;
  eq('price comes first', items.some((i) => i.kind === 'price_missing'), true);
  eq('and stuck is not also claimed',
    items.some((i) => i.kind === 'contract_stuck'), false);
}
// Several, ordered by how long they have waited.
{
  const items = run([
    campaign,
    booking({ id: 'b1', title: 'Reem' }),
    booking({ id: 'b2', title: 'Layla' }),
    booking({ id: 'b3', title: 'Bright' }),
  ], new Map([['b1', '2026-08-10'], ['b2', '2026-07-01'], ['b3', '2026-08-19']]));
  eq('three', items.length, 3);
  eq('longest wait first', items.map((i) => i.title), ['Layla', 'Reem', 'Bright']);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
