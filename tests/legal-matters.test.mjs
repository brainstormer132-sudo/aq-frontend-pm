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
  legalKpis, kpiBadge,
  isCollectionMatter, splitMatters, distinctParties,
  matterDeleteWarning, groupThousands,
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
    '1 client overdue on completed campaigns, SAR 1,500.00 outstanding');
}
{
  const two = matterWarnings({
    rows: [row({ id: 'T1', outstanding: 1500 }), row({ id: 'T2', outstanding: 500.5 })],
    side: 'vendor',
  });
  eq('two vendors is plural and totals them',
    warningsLine(two, 'vendor'),
    '2 vendors overdue on completed campaigns, SAR 2,000.50 outstanding');
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
    '1 client overdue on completed campaigns, SAR 1,000.00 outstanding (1 already a matter)');
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

/* -- collection is not a case, and a case is not collection --------- */
//
// His job description asks for both numbers, and they come out of one table.
// If a matter could land in both, the two KPIs on his sheet would add up to
// more work than exists - so the property worth protecting is that they
// partition the open matters exactly.

eq('a client who has not paid is collection',
  isCollectionMatter({ kind: 'client_unpaid' }), true);
// Money going OUT. A vendor chasing us is a dispute she manages, not a debt
// she collects, and calling it collection would put it in both numbers.
eq('a vendor we have not paid is NOT collection',
  isCollectionMatter({ kind: 'vendor_unpaid' }), false);
eq('a breach is not collection', isCollectionMatter({ kind: 'breach' }), false);
eq('nor a rights dispute', isCollectionMatter({ kind: 'content' }), false);
eq('nor other', isCollectionMatter({ kind: 'other' }), false);
eq('a kind nobody recognises is a case, not collection',
  isCollectionMatter({ kind: 'nonsense' }), false);
eq('and so is a missing one', isCollectionMatter({}), false);

{
  const ms = [
    matter({ id: 'a', kind: 'client_unpaid' }),
    matter({ id: 'b', kind: 'vendor_unpaid' }),
    matter({ id: 'c', kind: 'breach' }),
    matter({ id: 'd', kind: 'client_unpaid' }),
  ];
  const sp = splitMatters(ms);
  eq('collection is the unpaid clients', sp.collection.map((m) => m.id), ['a', 'd']);
  eq('everything else is a case', sp.cases.map((m) => m.id), ['b', 'c']);
  eq('nothing is in both', sp.collection.length + sp.cases.length, ms.length);
  eq('the order inside each is the order it came in',
    splitMatters([matter({ id: 'z', kind: 'breach' }), matter({ id: 'y', kind: 'breach' })])
      .cases.map((m) => m.id), ['z', 'y']);
  eq('splitting nothing is two empty lists',
    splitMatters([]), { collection: [], cases: [] });
}

/* -- how many people, not how many rows ----------------------------- */
//
// Siraj asked for collection "both, side by side": four clients, nine cases.
// One client owing on five campaigns is five rows and one phone call.

eq('nobody is nobody', distinctParties([]), 0);
eq('five matters against one client is one client', distinctParties([
  matter({ id: '1', client_id: 'c1' }), matter({ id: '2', client_id: 'c1' }),
  matter({ id: '3', client_id: 'c1' }), matter({ id: '4', client_id: 'c1' }),
  matter({ id: '5', client_id: 'c1' }),
]), 1);
eq('two clients are two', distinctParties([
  matter({ id: '1', client_id: 'c1' }), matter({ id: '2', client_id: 'c2' }),
]), 2);
// 113 sets client_id to null when the record is deleted and keeps the name,
// which is the whole reason party_name is snapshotted.
eq('a matter whose client record was deleted still counts as somebody',
  distinctParties([matter({ id: '1', client_id: null, party_name: 'Almarai' })]), 1);
eq('and two of them against the same name are one',
  distinctParties([
    matter({ id: '1', client_id: null, party_name: 'Almarai' }),
    matter({ id: '2', client_id: null, party_name: 'almarai  ' }),
  ]), 1);
// The fold: one linked, one typed, same client. Counting these as two is the
// bug this function exists to avoid.
eq('a linked and a typed matter against the same client are one client',
  distinctParties([
    matter({ id: '1', client_id: 'c1', party_name: 'Almarai' }),
    matter({ id: '2', client_id: null, party_name: 'Almarai' }),
  ]), 1);
eq('but a different name beside it is still its own', distinctParties([
  matter({ id: '1', client_id: 'c1', party_name: 'Almarai' }),
  matter({ id: '2', client_id: null, party_name: 'Almarai' }),
  matter({ id: '3', client_id: null, party_name: 'Snap Inc' }),
]), 2);
// The side decides WHICH id is read; 113's CHECK says only one is meaningful.
eq('vendors are counted on the vendor id', distinctParties([
  matter({ id: '1', party_type: 'vendor', client_id: null, vendor_id: 7 }),
  matter({ id: '2', party_type: 'vendor', client_id: null, vendor_id: 7 }),
  matter({ id: '3', party_type: 'vendor', client_id: null, vendor_id: 8 }),
]), 2);
eq('a vendor id of zero is an id, not a missing one', distinctParties([
  matter({ id: '1', party_type: 'vendor', client_id: null, vendor_id: 0, party_name: 'A' }),
  matter({ id: '2', party_type: 'vendor', client_id: null, vendor_id: 0, party_name: 'B' }),
]), 1);
eq('a client and a vendor with the same name are two parties', distinctParties([
  matter({ id: '1', party_type: 'client', client_id: 'c1', party_name: 'Adex' }),
  matter({ id: '2', party_type: 'vendor', client_id: null, vendor_id: 1, party_name: 'Adex' }),
]), 2);

/* -- the KPI strip -------------------------------------------------- */

const kpi = (o) => legalKpis({ contracts: [], matters: [], unhandled: 0, ...o });
const val = (ks, k) => ks.find((x) => x.key === k).value;
const note = (ks, k) => ks.find((x) => x.key === k).note;
const tone = (ks, k) => ks.find((x) => x.key === k).tone;
const second = (ks, k) => ks.find((x) => x.key === k).second;

// His three, plus the one that says what to do next.
eq('five numbers, in this order', kpi({}).map((k) => k.key),
  ['issued', 'signed', 'collection', 'cases', 'unchased']);
eq('an empty workspace is all zeros', kpi({}).map((k) => k.value), [0, 0, 0, 0, 0]);
eq('every KPI has a label', kpi({}).filter((k) => !k.label).length, 0);

{
  const contracts = [{ status: 'issued' }, { status: 'issued' }, { status: 'draft' },
    { status: 'signed' }, { status: 'void' }];
  const ks = kpi({ contracts });
  // A signed contract was ISSUED. Counting only status='issued' made this
  // number go DOWN when a contract came back - see the header.
  eq('issued counts everything that left draft', val(ks, 'issued'), 3);
  eq('signed counts only signed', val(ks, 'signed'), 1);
  eq('drafts are a note, not a number of their own', note(ks, 'issued'), '1 still a draft');
  eq('and the signed note says how many are still out', note(ks, 'signed'), '2 still out');
}
// The regression, stated as the thing it was: three contracts out, all three
// signed, and "how many documents issued" used to read zero.
eq('all of them signed still reads as three issued',
  val(kpi({ contracts: [{ status: 'signed' }, { status: 'signed' }, { status: 'signed' }] }), 'issued'), 3);
eq('and says they all came back',
  note(kpi({ contracts: [{ status: 'signed' }] }), 'signed'), 'all of them came back');
eq('nothing issued says so rather than nothing', note(kpi({}), 'signed'), 'nothing issued yet');
eq('a void contract is in no count',
  val(kpi({ contracts: [{ status: 'void' }] }), 'issued'), 0);
eq('status is matched case-insensitively', val(kpi({ contracts: [{ status: 'ISSUED' }] }), 'issued'), 1);
eq('a contract with no status counts as nothing',
  kpi({ contracts: [{ status: null }, {}] }).map((k) => k.value), [0, 0, 0, 0, 0]);

{
  // Four unpaid campaigns across two clients, one breach, one closed.
  const ms = [
    matter({ id: '1', kind: 'client_unpaid', client_id: 'c1' }),
    matter({ id: '2', kind: 'client_unpaid', client_id: 'c1' }),
    matter({ id: '3', kind: 'client_unpaid', client_id: 'c2' }),
    matter({ id: '4', kind: 'breach', client_id: 'c3', status: 'filed' }),
    matter({ id: '5', kind: 'client_unpaid', client_id: 'c4', status: 'won', closed_at: '2026-02-01' }),
  ];
  const ks = kpi({ matters: ms });
  eq('collection counts the clients', val(ks, 'collection'), 2);
  eq('and the cases beside them', second(ks, 'collection').value, 3);
  eq('the units are written out', [ks[2].unit, second(ks, 'collection').label], ['clients', 'cases']);
  eq('cases counts what is not collection', val(ks, 'cases'), 1);
  eq('and calls out the ones in court', note(ks, 'cases'), '1 in court');
  eq('a lawsuit makes it read as bad', tone(ks, 'cases'), 'bad');
  // THE PROPERTY: every open matter is in exactly one of the two.
  eq('collection cases and legal cases account for every open matter',
    second(ks, 'collection').value + val(ks, 'cases'), 4);
  eq('a closed matter is in neither', val(ks, 'collection') + val(ks, 'cases'), 3);
}
eq('one client reads in the singular',
  kpi({ matters: [matter({ kind: 'client_unpaid', client_id: 'c1' })] })[2].unit, 'client');
eq('and one case does too',
  second(kpi({ matters: [matter({ kind: 'client_unpaid', client_id: 'c1' })] }), 'collection').label, 'case');
eq('an unpaid vendor is a case, not collection',
  [val(kpi({ matters: [matter({ kind: 'vendor_unpaid', party_type: 'vendor' })] }), 'collection'),
    val(kpi({ matters: [matter({ kind: 'vendor_unpaid', party_type: 'vendor' })] }), 'cases')], [0, 1]);
eq('open but nothing filed reads as a warning',
  tone(kpi({ matters: [matter({ kind: 'breach', status: 'warned' })] }), 'cases'), 'warn');
eq('nothing open reads as good', tone(kpi({}), 'cases'), 'good');
eq('nobody in collection reads as good', tone(kpi({}), 'collection'), 'good');
eq('and says so rather than leaving a bare zero',
  note(kpi({}), 'collection'), 'nobody owes us on an open matter');

eq('unchased carries the unhandled count', val(kpi({ unhandled: 7 }), 'unchased'), 7);
eq('and never goes negative', val(kpi({ unhandled: -3 }), 'unchased'), 0);
eq('nothing unchased reads as good', tone(kpi({ unhandled: 0 }), 'unchased'), 'good');
// It is not a subset of Collection: these have no matter at all, and raising
// one moves the number from here to there.
eq('something unchased says no matter has been raised',
  note(kpi({ unhandled: 2 }), 'unchased'), 'overdue with no matter raised');

// The screen holds no colour logic of its own.
eq('bad is the error badge', kpiBadge('bad'), 'aq-badge-error');
eq('warn is the warning badge', kpiBadge('warn'), 'aq-badge-warning');
eq('good is the success badge', kpiBadge('good'), 'aq-badge-success');
eq('plain is muted', kpiBadge('plain'), 'aq-badge-muted');


/* -- what it says before it deletes a matter --------------------------- */
// Siraj, on the native dialogs: "fix it". The old one was
// `confirm('Delete this matter and its whole log?')` - which names nothing,
// so on a screen with four matters open it is not a question anybody can
// answer, and asked the same way every time it trains people to click
// through it.
{
  const m = { title: 'Unpaid invoice 412', party_name: 'Rabea' };
  const w = matterDeleteWarning(m, 6);
  eq('it names the matter', w.includes('"Unpaid invoice 412"'), true);
  eq('and who it is against', w.includes('Rabea'), true);
  // The one consequence that is not obvious. The log is the record of what
  // was said and when, which is the part somebody would actually miss.
  eq('it counts the log entries going with it', w.includes('6 log entries'), true);
  eq('and says it cannot be undone', w.includes('cannot be undone'), true);
  eq('one entry is singular', matterDeleteWarning(m, 1).includes('1 log entry'), true);
  eq('no count still warns about the log', matterDeleteWarning(m).includes('whole log'), true);
  eq('and zero is not printed as a number', matterDeleteWarning(m, 0).includes('0 log'), false);
  // A matter with nothing filled in still gets a sentence: a confirmation
  // with no words in it is worse than the dialog it replaces.
  eq('an unnamed matter still reads as a sentence',
    matterDeleteWarning({}).startsWith('Delete this matter?'), true);
  eq('and so does nothing at all', matterDeleteWarning(null).length > 20, true);
  eq('no party, no dangling "against"',
    matterDeleteWarning({ title: 'X' }).includes('against'), false);
}


// CHANGED 22 Sep: the aggregate names its unit.
//
// It read as a bare "1,500.00" while every row underneath it said
// "SAR 40,000.00". The same rule that made the SLICE explicit in this
// sentence - "on completed campaigns" rather than just "overdue" - applies
// to the unit: a money figure says what it is measured in.
//
// The formatting is also hand-rolled now. This file is the rules module for
// Cases and its header claims purity, and toLocaleString is an Intl call -
// the same class of thing as the toLocaleDateString that renders "Sept"
// under node and "Sep" in a browser.
eq('thousands, with two decimals', groupThousands(1234.5), '1,234.50');
eq('exactly a thousand gets its comma', groupThousands(1000), '1,000.00');
eq('under a thousand gets none', groupThousands(999.994), '999.99');
eq('millions get both', groupThousands(1234567.891), '1,234,567.89');
eq('zero', groupThousands(0), '0.00');
// The sign goes in front of the digits, which is where a reader looks.
eq('a negative keeps its sign in front', groupThousands(-1234.5), '-1,234.50');
eq('junk is not NaN on the screen', groupThousands('abc'), '0.00');


/* -- `party` decorates a warning, it never selects one ------------------ */
// This is the property that let LegalCases collapse three ledger passes into
// one. Two call sites derived the same warnings and had already drifted -
// one passed `party`, the other did not - and unifying them was only safe
// because `party` cannot change WHICH rows become warnings, just the ids
// carried on them. Verified by reading matterWarnings, and pinned here so
// the next person does not have to re-read it.
{
  const rows = [
    row({ id: 'a', daysLate: 9, outstanding: 500 }),
    row({ id: 'b', daysLate: 2, outstanding: 250 }),
    row({ id: 'c', outstanding: 0 }),
  ];
  const without = matterWarnings({ rows, side: 'client' });
  const party = new Map([['a', { clientId: 'C1', vendorId: null }]]);
  const withParty = matterWarnings({ rows, side: 'client', party });

  eq('the same rows are warnings either way',
    withParty.map((w) => w.sourceKey), without.map((w) => w.sourceKey));
  eq('and in the same order',
    withParty.map((w) => w.daysLate), without.map((w) => w.daysLate));
  eq('the count cannot move', withParty.length, without.length);
  // What it DOES do: hang the record's ids on the warning so raising a matter
  // links to the real client or vendor rather than only carrying a name.
  eq('it fills the id it knows', withParty[0].clientId, 'C1');
  eq('and leaves the ones it does not', withParty[1].clientId, null);
  eq('without it, no ids at all', without[0].clientId, null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
