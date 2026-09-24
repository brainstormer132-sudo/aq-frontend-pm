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
// A CONTRACT now, not a request to the deleted contract app. `draft` is what
// `pending` was: raised, and legal have not dealt with it.
const req = (created, status = 'draft') => ({ status, created_at: created });

eq('a week is stuck',
  contractIsStuck(contractTrack(req('2026-08-20'), TODAY, null)), true);
eq('six days is not',
  contractIsStuck(contractTrack(req('2026-08-21'), TODAY, null)), false);
eq('sent today is not',
  contractIsStuck(contractTrack(req(TODAY), TODAY, null)), false);
eq('a month is very stuck',
  contractIsStuck(contractTrack(req('2026-07-01'), TODAY, null)), true);
// Signed came back. Void is not in flight. Neither is waiting.
eq('signed is not stuck',
  contractIsStuck(contractTrack(
    { status: 'signed', created_at: '2026-06-01', signed_on: '2026-06-05' },
    TODAY, null)), false);
eq('void is not stuck',
  contractIsStuck(contractTrack(req('2026-06-01', 'void'), TODAY, null)), false);
// Never asked for is a different problem, handled by its own gap.
eq('no contract is not stuck',
  contractIsStuck(contractTrack(null, TODAY, null)), false);
eq('blocked is not stuck',
  contractIsStuck(contractTrack(null, TODAY, 'IBAN')), false);
// The day count itself, which is what the message prints.
eq('counts the days',
  contractTrack(req('2026-08-13'), TODAY, null).waitingDays, 14);

/* -- ISSUED: the state the old tracking could not see ---------------- */
//
// A request went to 'generated' the moment a document existed, so a contract
// issued five weeks ago and never signed read as finished. It is not
// finished - it is out with a vendor who has not signed it - and it is
// exactly as stuck as one legal never opened.
{
  const out = contractTrack(
    { status: 'issued', contract_no: 'AQ-2026-0108',
      created_at: '2026-07-01', issued_at: '2026-07-05' },
    TODAY, null);
  eq('an unsigned issued contract is still waiting', out.state, 'waiting');
  eq('and it is stuck', contractIsStuck(out), true);
  eq('its badge is its number', out.badge, 'AQ-2026-0108');
  eq('and it says it is not signed yet', out.answeredLabel.includes('not signed'), true);
  // Counted from the ISSUE, not from the raise: a vendor cannot be late with
  // something that had not been sent to them.
  eq('the clock runs from the issue', out.waitingDays,
    contractTrack({ status: 'issued', created_at: '2026-07-05', issued_at: '2026-07-05' },
      TODAY, null).waitingDays);
  const fresh = contractTrack(
    { status: 'issued', created_at: '2026-06-01', issued_at: TODAY }, TODAY, null);
  eq('issued today is not stuck, however old the draft was',
    contractIsStuck(fresh), false);
}
{
  const signed = contractTrack(
    { status: 'signed', contract_no: 'AQ-2026-0108',
      created_at: '2026-07-01', signed_on: '2026-07-20' }, TODAY, null);
  eq('a signed contract is done', signed.state, 'done');
  eq('its badge is its number too', signed.badge, 'AQ-2026-0108');
  eq('a signed contract with no number still says so',
    contractTrack({ status: 'signed', created_at: '2026-07-01' }, TODAY, null).badge,
    'Signed');
}
eq('void says to ask again',
  contractTrack(req('2026-06-01', 'void'), TODAY, null).answeredLabel, 'Ask again');
eq('and is not counted as waiting',
  contractTrack(req('2026-06-01', 'void'), TODAY, null).waitingDays, null);
// Status arrives from PostgREST as text; nothing guarantees its case.
eq('the status is read case-insensitively',
  contractTrack({ status: 'SIGNED', created_at: '2026-07-01' }, TODAY, null).state, 'done');

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
