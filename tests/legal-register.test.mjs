/**
 * One register, with everything in it.
 *
 * The rules that matter, in order:
 *
 *   1. A FILED DOCUMENT CAN NEVER ENTER A PRINT SELECTION. A generated
 *      contract is rebuilt from its template version's blocks; a filed one is
 *      somebody else's PDF with nothing to rebuild. One in the stack is a
 *      blank page in the middle of forty, and nobody notices until it has
 *      been handed to somebody.
 *   2. A RE-UPLOAD AFTER A REJECTION IS WHAT SHOWS. 084 allows a corrected
 *      copy after a rejection, so a reference can carry several rejected rows
 *      and at most one live one. Showing the newest regardless would leave a
 *      document reading "rejected" forever after it had been fixed.
 *   3. THE ORDER IS CHRONOLOGICAL, NOT URGENT-FIRST. A register that reorders
 *      itself around today's work is one you cannot find last April in.
 *   4. THE SCREEN NEVER OFFERS WHAT MIGRATION 127 WILL REFUSE. canReview is
 *      exactly owner, admin and legal.
 */
import {
  registerRows, printableOnly, printableIds, registerTally,
  sortRegister, filterRegister, canReview, cannotReviewHere,
  registerNote, registerSummary,
} from '../.test-build/legal-register.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const contract = (o = {}) => ({
  id: o.id ?? 'c1', title: o.title ?? 'Rabea tea', contract_no: o.contract_no ?? 'AQ-2026-001',
  doc_kind: o.doc_kind ?? 'vendor_contract', status: o.status ?? 'issued',
  created_at: o.created_at ?? '2026-09-10T10:00:00Z',
});
const doc = (o = {}) => ({
  id: o.id ?? 'd1', title: o.title ?? 'Rawad Media - Tokyo',
  reference: 'reference' in o ? o.reference : 'CTR011000029',
  doc_kind: o.doc_kind ?? 'vendor_contract', party_name: o.party_name ?? 'Rawad Media',
  created_at: o.created_at ?? '2026-04-29T15:32:00Z',
});
const up = (o = {}) => ({ id: o.id ?? 'u1', contract_id: o.contract_id ?? 'CTR011000029', status: o.status ?? 'pending' });

// -- 1. the merge ----------------------------------------------------
{
  const rows = registerRows([contract()], [doc()], [up()]);
  eq('both sources are in it', rows.map((r) => r.source), ['generated', 'filed']);
  eq('a generated row keeps its number', rows[0].reference, 'AQ-2026-001');
  eq('a generated row has no review', [rows[0].review, rows[0].uploadId, rows[0].needsReview],
    [null, null, false]);
  eq('a filed row carries its party', rows[1].party, 'Rawad Media');
  eq('and the upload waiting on it', [rows[1].review, rows[1].uploadId, rows[1].needsReview],
    ['pending', 'u1', true]);
  // The upload's own ROW comes with it. Looking it up again from the id
  // would let the row and the file disagree about which upload is live -
  // the exact drift the live/rejected rule above exists to prevent.
  eq('and that upload row, not just its id', rows[1].upload?.id, 'u1');
  eq('a generated row carries no upload row', rows[0].upload, null);

  // Matched BY REFERENCE, because that is the only key the two systems share.
  eq('an upload against another reference does not attach',
    registerRows([], [doc()], [up({ contract_id: 'CTR999' })])[0].review, null);
  // A document with no reference can never be matched - guessing by title
  // would attach a decision to the wrong document.
  eq('a document with no reference is never matched',
    registerRows([], [doc({ reference: null })], [up({ contract_id: '' })])[0].review, null);
  eq('nothing at all is an empty register', registerRows([], [], []), []);
  eq('and null arguments do not throw', registerRows(null, null, null), []);
}

// -- 2. rule 2, the live upload -------------------------------------
{
  const rows = registerRows([], [doc()], [
    up({ id: 'old', status: 'rejected' }),
    up({ id: 'new', status: 'pending' }),
  ]);
  eq('a corrected copy after a rejection is what shows',
    [rows[0].review, rows[0].uploadId], ['pending', 'new']);
  eq('and the row that comes with it is the same one', rows[0].upload?.id, 'new');

  // ...whichever order they arrive in, because a read is not ordered by
  // anything this function controls.
  const other = registerRows([], [doc()], [
    up({ id: 'new', status: 'pending' }),
    up({ id: 'old', status: 'rejected' }),
  ]);
  eq('order of the uploads does not change that', other[0].uploadId, 'new');

  // An accepted one is live too - it is the decision that stands.
  eq('an acceptance stands',
    registerRows([], [doc()], [up({ id: 'a', status: 'accepted' })])[0].review, 'accepted');
  // With only rejections, the rejection IS the state - there is nothing else
  // to show, and hiding it would make a rejected document look untouched.
  eq('only rejections still show a rejection',
    registerRows([], [doc()], [up({ id: 'r', status: 'rejected' })])[0].review, 'rejected');
  eq('and it is not "waiting"',
    registerRows([], [doc()], [up({ id: 'r', status: 'rejected' })])[0].needsReview, false);
}

// -- 3. rule 1, which is the one that would be shipped broken --------
{
  const rows = registerRows(
    [contract({ id: 'c1' }), contract({ id: 'c2' })],
    [doc({ id: 'd1' }), doc({ id: 'd2', reference: 'X2' })],
    [],
  );
  eq('only generated rows are printable', printableOnly(rows).map((r) => r.id), ['c1', 'c2']);
  eq('and Select all takes only those', printableIds(rows), ['c1', 'c2']);
  ok('no filed row survives printableOnly',
    printableOnly(rows).every((r) => r.source === 'generated'));
  // Stated the way it would actually go wrong: a register of ONLY filed
  // documents must offer nothing to print, not everything.
  eq('a register of filed documents prints nothing',
    printableIds(registerRows([], [doc(), doc({ id: 'd2', reference: 'X' })], [])), []);
}

// -- 4. counts and order --------------------------------------------
{
  const rows = registerRows(
    [contract({ id: 'c1' })],
    [doc({ id: 'd1' }), doc({ id: 'd2', reference: 'X2' }), doc({ id: 'd3', reference: 'X3' })],
    [up({ contract_id: 'CTR011000029' }), up({ id: 'u2', contract_id: 'X2', status: 'accepted' })],
  );
  eq('the counts', registerTally(rows), { total: 4, generated: 1, filed: 3, awaitingReview: 1 });
  eq('nothing is all zeroes', registerTally([]), { total: 0, generated: 0, filed: 0, awaitingReview: 0 });

  // Rule 3: newest first, and the row that needs attention does NOT jump.
  const mixed = registerRows(
    [contract({ id: 'new', created_at: '2026-09-20T00:00:00Z' })],
    [doc({ id: 'old', created_at: '2026-01-01T00:00:00Z' })],
    [up({ contract_id: 'CTR011000029' })],
  );
  eq('newest first, even when the oldest is the one waiting',
    sortRegister(mixed).map((r) => r.id), ['new', 'old']);
  eq('ties break on id', sortRegister([
    { id: 'z', created_at: 'same' }, { id: 'y', created_at: 'same' },
  ]).map((r) => r.id), ['y', 'z']);
}

// -- 5. the filter ---------------------------------------------------
{
  const rows = registerRows(
    [contract({ id: 'c1', title: 'Almarai', status: 'draft' })],
    [doc({ id: 'd1' }), doc({ id: 'd2', reference: 'X2', title: 'Zain lease', party_name: 'Zain' })],
    [up({ contract_id: 'CTR011000029' })],
  );
  eq('nothing filtered', filterRegister(rows, '', '', '').map((r) => r.id), ['c1', 'd1', 'd2']);
  eq('generated only', filterRegister(rows, '', 'generated', '').map((r) => r.id), ['c1']);
  eq('filed only', filterRegister(rows, '', 'filed', '').map((r) => r.id), ['d1', 'd2']);
  eq('waiting only', filterRegister(rows, '', 'review', '').map((r) => r.id), ['d1']);

  eq('by title', filterRegister(rows, 'almarai', '', '').map((r) => r.id), ['c1']);
  eq('by the other side', filterRegister(rows, 'zain', '', '').map((r) => r.id), ['d2']);
  eq('by reference', filterRegister(rows, 'CTR011', '', '').map((r) => r.id), ['d1']);

  // A status filter is about a contract's lifecycle. A filed document has
  // none, so picking one hides them rather than showing every filed row under
  // every status - which is what a `||` here would have done.
  eq('a status filter hides filed documents',
    filterRegister(rows, '', '', 'draft').map((r) => r.id), ['c1']);
  eq('and an unmatched status shows nothing',
    filterRegister(rows, '', '', 'void').map((r) => r.id), []);
  eq('search and source together',
    filterRegister(rows, 'zain', 'filed', '').map((r) => r.id), ['d2']);
}

// -- 6. rule 4, who may decide --------------------------------------
{
  eq('the three that 127 lets through',
    ['owner', 'admin', 'legal'].map(canReview), [true, true, true]);
  eq('and the ones it does not',
    ['marketing', 'operations', 'sales', 'finance', 'member', 'key_account'].map(canReview),
    [false, false, false, false, false, false]);
  eq('no role at all is not a reviewer', canReview(null), false);
  eq('case does not matter', canReview('LEGAL'), true);

  const rows = registerRows([contract()], [doc(), doc({ id: 'd9', reference: 'nope' })], [up()]);
  const [gen, waiting, untouched] = rows;
  eq('a reviewer can act on a waiting filed row', cannotReviewHere(waiting, 'legal'), null);
  ok('but not on a generated contract',
    /generated here/.test(String(cannotReviewHere(gen, 'legal'))));
  ok('nor on a filed one nobody uploaded to',
    /Nobody has sent/.test(String(cannotReviewHere(untouched, 'owner'))));
  ok('and marketing cannot act at all',
    /Only legal/.test(String(cannotReviewHere(waiting, 'marketing'))));
}

// -- 7. what the screen says ----------------------------------------
{
  eq('a generated line', registerNote(registerRows([contract()], [], [])[0], { created: '10 Sep' }),
    'AQ-2026-001 \u00b7 10 Sep');
  eq('a filed line', registerNote(registerRows([], [doc()], [])[0], { created: '29 Apr' }),
    'CTR011000029 \u00b7 filed from outside \u00b7 Rawad Media \u00b7 29 Apr');

  eq('an empty register', registerSummary([]), 'Nothing in the register yet.');
  eq('contracts only',
    registerSummary(registerRows([contract()], [], [])), '1 contract generated here.');
  eq('and some filed',
    registerSummary(registerRows([contract()], [doc()], [])),
    '1 contract generated here, 1 filed from outside.');
  eq('and one waiting',
    registerSummary(registerRows([contract()], [doc()], [up()])),
    '1 contract generated here, 1 filed from outside. 1 signed copy is waiting to be looked at.');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
