/**
 * The Legal Registry's rules.
 *
 * The thing worth protecting here is that the warnings are DERIVED. Nothing
 * in this file writes a row; matterWarnings reads what money-ledger already
 * decided and turns it into a list. So the tests are mostly about the three
 * ways that join can go wrong: showing a problem that is not one, offering a
 * problem somebody is already handling, and moving a key so the same dispute
 * is offered twice.
 */
import {
  MATTER_STATUSES, matterStatusLabel, matterStatusBadge, matterClosed, nextStatuses,
  MATTER_KINDS, matterKindLabel, EVENT_KINDS, eventKindLabel,
  warningSourceKey, matterWarnings, unhandledCount, warningsLine,
  sortMatters, mattersLine,
  partySearch, newMatterProblems, parseMatterAmount, defaultMatterTitle, searchMatters,
} from '../.test-build/legal-matters.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

/* -- the ladder ---------------------------------------------------- */

eq('every status is unique', new Set(MATTER_STATUSES.map((s) => s.key)).size, MATTER_STATUSES.length);
eq('the ladder is the eight in 113', MATTER_STATUSES.map((s) => s.key),
  ['open', 'warned', 'escalated', 'filed', 'won', 'settled', 'lost', 'dropped']);
eq('open comes first', MATTER_STATUSES[0].key, 'open');
eq('the four outcomes are the closed ones',
  MATTER_STATUSES.filter((s) => s.closed).map((s) => s.key), ['won', 'settled', 'lost', 'dropped']);
eq('every status has a label', MATTER_STATUSES.filter((s) => !s.label).length, 0);
eq('every status has a badge', MATTER_STATUSES.filter((s) => !s.badge).length, 0);

eq('label reads', matterStatusLabel('filed'), 'Lawsuit filed');
eq('label of a status we do not know falls back to Open', matterStatusLabel('zzz'), 'Open');
eq('label of null falls back to Open', matterStatusLabel(null), 'Open');
eq('badge of a status we do not know is not blank', matterStatusBadge(undefined), 'aq-badge-warning');
eq('won is a success badge', matterStatusBadge('won'), 'aq-badge-success');
eq('filed is an error badge', matterStatusBadge('filed'), 'aq-badge-error');

eq('open is not closed', matterClosed('open'), false);
eq('warned is not closed', matterClosed('warned'), false);
eq('filed is not closed', matterClosed('filed'), false);
eq('won is closed', matterClosed('won'), true);
eq('lost is closed', matterClosed('lost'), true);
eq('settled is closed', matterClosed('settled'), true);
eq('dropped is closed', matterClosed('dropped'), true);
// An unknown status must read as OPEN, not closed: a matter with a status
// nobody recognises is the one that most needs to stay on the screen.
eq('unknown status is not closed', matterClosed('nonsense'), false);
eq('null status is not closed', matterClosed(null), false);

eq('nextStatuses drops the one it is on', nextStatuses('open').includes('open'), false);
eq('nextStatuses offers the other seven', nextStatuses('open').length, 7);
// Closed is not a dead end: "followed through until won or loss" still has to
// survive somebody marking it lost by mistake.
eq('a closed matter can be reopened', nextStatuses('won').includes('open'), true);
eq('unknown status still offers all eight', nextStatuses('zzz').length, 8);

/* -- kinds --------------------------------------------------------- */

eq('both money kinds exist', MATTER_KINDS.map((k) => k.key).filter((k) => k.endsWith('_unpaid')),
  ['client_unpaid', 'vendor_unpaid']);
eq('kind label reads', matterKindLabel('vendor_unpaid'), 'Vendor not paid');
eq('unknown kind is Other', matterKindLabel('zzz'), 'Other');
eq('null kind is Other', matterKindLabel(null), 'Other');

// The trigger in 113 writes kind='status' and log_matter_event refuses it from
// a person, so it must not be offered - but it must still read.
eq('status is not offered as a log kind', EVENT_KINDS.some((k) => k.key === 'status'), false);
eq('status still has a label', eventKindLabel('status'), 'Status');
eq('event label reads', eventKindLabel('letter'), 'Letter');
eq('unknown event kind is Note', eventKindLabel('zzz'), 'Note');

/* -- the source key ------------------------------------------------ */

eq('key is side and task', warningSourceKey('client', 'T1'), 'client:T1');
eq('the two sides of one task are different keys',
  warningSourceKey('client', 'T1') === warningSourceKey('vendor', 'T1'), false);
eq('whitespace does not make a new key', warningSourceKey('vendor', '  T1 '), 'vendor:T1');
// This is the property the whole handled-check rests on: the key must not move
// when the debt ages or grows, or the same dispute is offered again next to
// the matter already handling it.
{
  const a = warningSourceKey('client', 'T9');
  const b = warningSourceKey('client', 'T9');
  eq('the same task gives the same key twice', a === b, true);
}

/* -- the warnings -------------------------------------------------- */

function row(o) {
  return {
    id: 'T', party: 'P', campaign: 'C', total: 100, paid: 0, outstanding: 100,
    state: 'unpaid', stateLabel: 'Unpaid', tone: 'bad', open: false, mismatch: null,
    due: '2026-01-01', dueBasis: 'terms', overdue: true, daysLate: 10, terms: 'Net 30',
    ...o,
  };
}

{
  const ws = matterWarnings({ rows: [row({ id: 'T1' })], side: 'client' });
  eq('one overdue row is one warning', ws.length, 1);
  eq('it carries the key', ws[0].sourceKey, 'client:T1');
  eq('it carries the side', ws[0].side, 'client');
  eq('it carries the party', ws[0].party, 'P');
  eq('it carries the campaign', ws[0].campaign, 'C');
  eq('it carries the task', ws[0].taskId, 'T1');
  eq('it carries the amount', ws[0].amount, 100);
  eq('it carries the days', ws[0].daysLate, 10);
  eq('it carries the due date', ws[0].due, '2026-01-01');
  eq('nothing is handled without a handled set', ws[0].handled, false);
  eq('no party map means no ids', [ws[0].clientId, ws[0].vendorId], [null, null]);
}

// Only what the ledger already calls overdue. The rule for what is owed lives
// in money-ledger - only COMPLETED campaigns - and is not restated here.
eq('not overdue is not a warning',
  matterWarnings({ rows: [row({ overdue: false })], side: 'client' }).length, 0);
eq('overdue but paid off is not a warning',
  matterWarnings({ rows: [row({ outstanding: 0 })], side: 'client' }).length, 0);
eq('a negative balance is not a warning',
  matterWarnings({ rows: [row({ outstanding: -50 })], side: 'client' }).length, 0);
eq('a row with no task id is skipped',
  matterWarnings({ rows: [row({ id: '' })], side: 'client' }).length, 0);
eq('no rows is no warnings', matterWarnings({ rows: [], side: 'vendor' }).length, 0);
eq('undefined rows is no warnings', matterWarnings({ rows: undefined, side: 'vendor' }).length, 0);

// daysLate is null in the ledger when nothing is late; an overdue row with a
// null count must still show, at zero, rather than sorting as NaN.
{
  const ws = matterWarnings({ rows: [row({ daysLate: null })], side: 'client' });
  eq('null daysLate reads as 0', ws[0].daysLate, 0);
  eq('junk outstanding reads as 0 and drops out',
    matterWarnings({ rows: [row({ outstanding: 'abc' })], side: 'client' }).length, 0);
}

// Worst first: longest overdue, then largest, then the key so two identical
// rows do not swap places between renders.
{
  const ws = matterWarnings({
    rows: [
      row({ id: 'a', daysLate: 5, outstanding: 900 }),
      row({ id: 'b', daysLate: 90, outstanding: 10 }),
      row({ id: 'c', daysLate: 90, outstanding: 5000 }),
      row({ id: 'd', daysLate: 5, outstanding: 900 }),
    ],
    side: 'client',
  });
  eq('worst first', ws.map((w) => w.taskId), ['c', 'b', 'a', 'd']);
}
{
  // The same four in a different order must come out the same way.
  const ws = matterWarnings({
    rows: [
      row({ id: 'd', daysLate: 5, outstanding: 900 }),
      row({ id: 'c', daysLate: 90, outstanding: 5000 }),
      row({ id: 'a', daysLate: 5, outstanding: 900 }),
      row({ id: 'b', daysLate: 90, outstanding: 10 }),
    ],
    side: 'client',
  });
  eq('the sort does not depend on input order', ws.map((w) => w.taskId), ['c', 'b', 'a', 'd']);
}

// The party map is what lets a matter raised here link to the real record.
{
  const ws = matterWarnings({
    rows: [row({ id: 'T1' }), row({ id: 'T2', daysLate: 1 })],
    side: 'vendor',
    party: new Map([['T1', { clientId: 'C7', vendorId: 42 }]]),
  });
  const byId = Object.fromEntries(ws.map((w) => [w.taskId, w]));
  eq('the mapped task carries its ids', [byId.T1.clientId, byId.T1.vendorId], ['C7', 42]);
  eq('an unmapped task carries nulls', [byId.T2.clientId, byId.T2.vendorId], [null, null]);
}

// Handled warnings stay in the list. They are marked, not dropped, because
// "we are dealing with that one" is what legal wants beside the untouched ones.
{
  const ws = matterWarnings({
    rows: [row({ id: 'T1', daysLate: 30 }), row({ id: 'T2', daysLate: 20 })],
    side: 'client',
    handled: new Set(['client:T1']),
  });
  eq('a handled warning is still listed', ws.length, 2);
  eq('and is marked handled', ws.map((w) => w.handled), [true, false]);
  eq('unhandledCount counts the rest', unhandledCount(ws), 1);
  // The handled set is keyed by side: a client matter must not silence the
  // vendor problem on the same task.
  const vs = matterWarnings({
    rows: [row({ id: 'T1' })], side: 'vendor', handled: new Set(['client:T1']),
  });
  eq('a client matter does not handle the vendor side', vs[0].handled, false);
}
eq('nothing handled in an empty list', unhandledCount([]), 0);

/* -- the line ------------------------------------------------------ */

// Siraj's rule: name the slice with the number.
eq('empty client line names the slice',
  warningsLine([], 'client'), 'Nothing overdue on completed campaigns.');
eq('empty vendor line names the slice',
  warningsLine([], 'vendor'), 'No unpaid vendors on completed campaigns.');
{
  const one = matterWarnings({ rows: [row({ id: 'T1', outstanding: 1500 })], side: 'client' });
  eq('one client is singular and says the slice',
    warningsLine(one, 'client'),
    '1 client overdue on completed campaigns, 1,500.00 outstanding');
}
{
  const two = matterWarnings({
    rows: [row({ id: 'T1', outstanding: 1500 }), row({ id: 'T2', outstanding: 500.5 })],
    side: 'vendor',
  });
  eq('two vendors is plural and totals them',
    warningsLine(two, 'vendor'),
    '2 vendors overdue on completed campaigns, 2,000.50 outstanding');
}
{
  const mixed = matterWarnings({
    rows: [row({ id: 'T1', outstanding: 1000 }), row({ id: 'T2', outstanding: 9999 })],
    side: 'client',
    handled: new Set(['client:T2']),
  });
  // The total is the UNHANDLED money only - the handled one is counted in the
  // tail, not in the number somebody is about to act on.
  eq('handled money is not in the total',
    warningsLine(mixed, 'client'),
    '1 client overdue on completed campaigns, 1,000.00 outstanding (1 already a matter)');
}
{
  const all = matterWarnings({
    rows: [row({ id: 'T1' }), row({ id: 'T2' })],
    side: 'client',
    handled: new Set(['client:T1', 'client:T2']),
  });
  eq('all handled says so instead of a total',
    warningsLine(all, 'client'), '2 overdue, all with a matter open.');
}

/* -- how a matter reads -------------------------------------------- */

function matter(o) {
  return {
    id: 'm', title: 't', party_type: 'client', party_name: 'P',
    kind: 'client_unpaid', status: 'open', amount: 0,
    opened_at: '2026-01-01', closed_at: null, source_key: null, ...o,
  };
}

{
  const ms = sortMatters([
    matter({ id: 'closed-old', status: 'won', closed_at: '2026-02-01' }),
    matter({ id: 'small', amount: 10 }),
    matter({ id: 'closed-new', status: 'lost', closed_at: '2026-05-01' }),
    matter({ id: 'big', amount: 90000 }),
  ]);
  eq('open first, biggest first, closed last most-recent first',
    ms.map((m) => m.id), ['big', 'small', 'closed-new', 'closed-old']);
}
{
  // Same money: the older matter is the one that has been waiting longer.
  const ms = sortMatters([
    matter({ id: 'newer', amount: 100, opened_at: '2026-06-01' }),
    matter({ id: 'older', amount: 100, opened_at: '2026-01-01' }),
  ]);
  eq('same amount: oldest first', ms.map((m) => m.id), ['older', 'newer']);
}
{
  const input = [matter({ id: 'a', amount: 5 }), matter({ id: 'b', amount: 9 })];
  const out = sortMatters(input);
  eq('sortMatters does not mutate its input', input.map((m) => m.id), ['a', 'b']);
  eq('and returns the sorted copy', out.map((m) => m.id), ['b', 'a']);
}
eq('amount as a string still sorts',
  sortMatters([matter({ id: 'a', amount: '5' }), matter({ id: 'b', amount: '900' })])
    .map((m) => m.id), ['b', 'a']);
eq('a null amount sorts last among open',
  sortMatters([matter({ id: 'a', amount: null }), matter({ id: 'b', amount: 1 })])
    .map((m) => m.id), ['b', 'a']);
eq('sorting nothing is nothing', sortMatters([]).length, 0);

eq('no matters says so', mattersLine([]), 'No matters yet.');
eq('open only', mattersLine([matter({}), matter({})]), '2 open');
eq('filed is called out', mattersLine([matter({}), matter({ status: 'filed' })]), '2 open, 1 in court');
eq('closed are counted separately',
  mattersLine([matter({}), matter({ status: 'won', closed_at: '2026-02-01' })]), '1 open - 1 closed');
eq('all closed reads as zero open',
  mattersLine([matter({ status: 'lost', closed_at: '2026-02-01' })]), '0 open - 1 closed');

/* -- raising one by hand -------------------------------------------- */

const PARTIES = [
  { id: '1', name: 'Alsara Media' },
  { id: '2', name: 'Sara Al Otaibi' },
  { id: '3', name: 'Rawad Media' },
  { id: '4', name: 'sara studio' },
  { id: '5', name: 'Zed' },
];

// A blank box still offers something: an empty list before anybody types
// reads as "there are no vendors", which is the opposite of the truth.
eq('blank query offers the first few', partySearch('', PARTIES, 3).map((p) => p.id), ['1', '2', '3']);
eq('blank query respects the cap', partySearch('', PARTIES, 0).length, 0);
eq('no options is no options', partySearch('sara', [], 8).length, 0);

// Starts-with beats contains: searching "sara" finds Sara before Alsara.
eq('a name that starts with the query comes first',
  partySearch('sara', PARTIES, 8).map((p) => p.name),
  ['Sara Al Otaibi', 'sara studio', 'Alsara Media']);
eq('search is case-insensitive', partySearch('SARA', PARTIES, 8).length, 3);
eq('the query is trimmed', partySearch('  rawad  ', PARTIES, 8).map((p) => p.id), ['3']);
eq('no match is an empty list', partySearch('zzzz', PARTIES, 8).length, 0);

// The cap is the point: four thousand vendors is a frozen tab, not a picker.
{
  const many = Array.from({ length: 4000 }, (_, i) => ({ id: String(i), name: `Vendor ${i}` }));
  eq('four thousand vendors are capped', partySearch('vendor', many, 8).length, 8);
  eq('and so is a blank query over them', partySearch('', many, 8).length, 8);
}
eq('an option with no name is skipped', partySearch('a', [{ id: '1', name: '' }], 8).length, 0);

// newMatterProblems
const draft = (o) => ({ partyName: 'Rawad', partyId: '3', title: 'A title', kind: 'breach', amount: '', ...o });
eq('a complete draft has no problems', newMatterProblems(draft({})), []);
eq('no party is a problem', newMatterProblems(draft({ partyName: '  ' })), ['Name the other side.']);
eq('no title is a problem', newMatterProblems(draft({ title: '' })), ['Give the matter a title.']);
eq('an unknown kind is a problem', newMatterProblems(draft({ kind: 'zzz' })), ['Pick what it is about.']);
eq('every kind in the list is accepted',
  MATTER_KINDS.filter((k) => newMatterProblems(draft({ kind: k.key })).length).length, 0);
eq('a blank amount is fine', newMatterProblems(draft({ amount: '   ' })), []);
eq('a number with commas is fine', newMatterProblems(draft({ amount: '12,500' })), []);
eq('a non-number amount is a problem',
  newMatterProblems(draft({ amount: 'soon' })), ['The amount is not a number.']);
eq('a negative amount is a problem',
  newMatterProblems(draft({ amount: '-5' })), ['The amount cannot be negative.']);
eq('problems come back in the order they would be fixed',
  newMatterProblems({ partyName: '', title: '', kind: '', amount: 'x' }),
  ['Name the other side.', 'Give the matter a title.', 'Pick what it is about.',
    'The amount is not a number.']);

// parseMatterAmount
eq('blank is null, not zero', parseMatterAmount('  '), null);
eq('commas are stripped', parseMatterAmount('12,500.50'), 12500.5);
eq('junk is null', parseMatterAmount('soon'), null);
eq('negative is null', parseMatterAmount('-1'), null);
eq('zero is a real amount', parseMatterAmount('0'), 0);

// defaultMatterTitle
eq('title names the party and what it is about',
  defaultMatterTitle('Rawad Media', 'breach'), 'Rawad Media - Breach of contract');
eq('an unknown kind still titles as Other', defaultMatterTitle('Rawad', 'zzz'), 'Rawad - Other');
eq('no party yet: just the kind', defaultMatterTitle('  ', 'content'), 'Content or rights');

// searchMatters
{
  const ms = [
    matter({ id: 'a', title: 'Rawad Media - unpaid', party_name: 'Rawad Media', kind: 'vendor_unpaid' }),
    matter({ id: 'b', title: 'Content takedown', party_name: 'Zed', kind: 'content', status: 'filed' }),
  ];
  eq('a blank search changes nothing', searchMatters('', ms).map((m) => m.id), ['a', 'b']);
  eq('search matches the title', searchMatters('takedown', ms).map((m) => m.id), ['b']);
  eq('search matches the party', searchMatters('rawad', ms).map((m) => m.id), ['a']);
  // Nobody types "vendor_unpaid" into a search box.
  eq('search matches the kind by its LABEL, not its key',
    searchMatters('not paid', ms).map((m) => m.id), ['a']);
  eq('the key itself is not what is searched', searchMatters('vendor_unpaid', ms).length, 0);
  eq('search matches the status label', searchMatters('lawsuit', ms).map((m) => m.id), ['b']);
  eq('no match is empty', searchMatters('zzzz', ms).length, 0);
  eq('the order is left alone', searchMatters('e', ms).map((m) => m.id), ['a', 'b']);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
