/**
 * The signed copy somebody outside sent back, and the decision on it.
 *
 * The rules that matter, in order:
 *
 *   1. AN UNRECOGNISED STATUS IS `pending`. A row this code does not
 *      understand is a row nobody has decided on, and it belongs in front of
 *      a person. Defaulting the other way empties the queue silently, which
 *      is the failure that cannot be noticed.
 *   2. AN ACCEPTED UPLOAD CAN STILL BE REJECTED. Deliberately unlike the
 *      contract app's version (084), because here accepting is what marks
 *      the contract signed, so a wrong acceptance has to have a way out.
 *   3. THE CANNED REASONS PASS THEIR OWN FLOOR. A minimum length with
 *      one-tap reasons that fall under it is a rule that only ever fires on
 *      the person trying to do the right thing.
 *   4. THE QUEUE IS OLDEST FIRST, THE HISTORY IS NEWEST FIRST. The oldest
 *      thing waiting is the one to look at; history is read from the top.
 */
import {
  REASON_MIN, REASON_MAX, REJECT_REASONS,
  reviewState, reviewLabel, reviewBadge, uploaderLabel,
  cannotAccept, cannotReject, reasonError, normaliseReason,
  humanBytes, reviewNote, reviewTally, pendingReview, decidedReview,
  filterReview, queueSummary,
} from '../.test-build/legal-review.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const up = (o = {}) => ({
  id: o.id ?? 'u1',
  contract_id: o.contract_id ?? 'AQ-001',
  status: o.status ?? 'pending',
  uploader_role: o.uploader_role ?? 'vendor',
  uploader_email: o.uploader_email ?? null,
  original_filename: o.original_filename ?? null,
  byte_size: o.byte_size ?? null,
  rejection_reason: o.rejection_reason ?? null,
  created_at: o.created_at ?? '2026-09-01T10:00:00Z',
  reviewed_at: o.reviewed_at ?? null,
  contract_title: o.contract_title ?? null,
});

// -- 1. the status, and which way it defaults -----------------------
{
  eq('accepted reads as accepted', reviewState(up({ status: 'accepted' })), 'accepted');
  eq('rejected reads as rejected', reviewState(up({ status: 'rejected' })), 'rejected');
  eq('pending reads as pending', reviewState(up({ status: 'pending' })), 'pending');
  eq('case and whitespace do not matter', reviewState(up({ status: ' ACCEPTED ' })), 'accepted');

  // The one that matters. A status this code has never heard of - a value
  // added to the table later, a typo in a manual fix - must put the row in
  // front of somebody, not out of sight behind "done".
  eq('an unknown status is pending', reviewState(up({ status: 'under_review' })), 'pending');
  eq('no status at all is pending', reviewState(up({ status: null })), 'pending');
  eq('an empty status is pending', reviewState(up({ status: '' })), 'pending');

  // And the consequence, stated as the thing that would actually be noticed:
  // a row with an odd status is IN the queue.
  eq('an unknown status is in the queue',
    pendingReview([up({ id: 'x', status: 'under_review' })]).map((u) => u.id), ['x']);

  eq('labels', [reviewLabel('pending'), reviewLabel('accepted'), reviewLabel('rejected')],
    ['Needs a look', 'Accepted', 'Rejected']);
  eq('badges', [reviewBadge('pending'), reviewBadge('accepted'), reviewBadge('rejected')],
    ['aq-badge-warning', 'aq-badge-success', 'aq-badge-error']);
}

// -- 2. who sent it -------------------------------------------------
{
  eq('a vendor', uploaderLabel('vendor'), 'the vendor');
  eq('a client', uploaderLabel('client'), 'the client');
  eq('case does not matter', uploaderLabel('VENDOR'), 'the vendor');
  // Not guessed. Which of the two sent it decides who gets chased.
  eq('an unknown role says so', uploaderLabel('partner'), 'someone outside');
  eq('no role says so', uploaderLabel(null), 'someone outside');
}

// -- 3. what can be decided, and what cannot ------------------------
{
  eq('a pending upload can be accepted', cannotAccept(up()), null);
  ok('an accepted upload cannot be accepted again',
    /already accepted/i.test(String(cannotAccept(up({ status: 'accepted' })))));

  // The sentence names who has to act, because "cannot be accepted" on its
  // own leaves the reader with nothing to do next.
  const r = String(cannotAccept(up({ status: 'rejected', uploader_role: 'client' })));
  ok('a rejected upload cannot be accepted', /cannot be accepted/i.test(r));
  ok('and the refusal says who has to send another', /the client/.test(r));

  eq('a pending upload can be rejected', cannotReject(up()), null);
  // Rule 2. This is the deliberate difference from 084 and it is the whole
  // reason a wrong acceptance is recoverable.
  eq('an ACCEPTED upload can still be rejected', cannotReject(up({ status: 'accepted' })), null);
  ok('a rejected upload cannot be rejected again',
    /already rejected/i.test(String(cannotReject(up({ status: 'rejected' })))));
}

// -- 4. the reason -------------------------------------------------
{
  eq('no reason is refused', typeof reasonError(''), 'string');
  eq('whitespace is no reason', typeof reasonError('   \n  '), 'string');
  eq('null is no reason', typeof reasonError(null), 'string');
  ok('"no" is refused', !!reasonError('no'));
  ok('"bad scan" is refused - it is under the floor', !!reasonError('bad scan'));
  eq('a real reason is accepted', reasonError('The scan is unreadable.'), null);
  eq('exactly the floor is accepted', reasonError('a'.repeat(REASON_MIN)), null);
  ok('one under the floor is refused', !!reasonError('a'.repeat(REASON_MIN - 1)));
  eq('exactly the ceiling is accepted', reasonError('a'.repeat(REASON_MAX)), null);
  ok('one over the ceiling is refused', !!reasonError('a'.repeat(REASON_MAX + 1)));
  // Length is judged on the TRIMMED reason, so padding does not buy a pass.
  ok('spaces do not get you over the floor', !!reasonError(`  ${'a'.repeat(REASON_MIN - 1)}  `));

  // Rule 3. Every one-tap reason must satisfy the rule it exists to make
  // painless. If a future reason is added that is too short, this fails.
  ok('there are canned reasons at all', REJECT_REASONS.length >= 4);
  for (const reason of REJECT_REASONS) {
    eq(`canned reason passes: ${reason.slice(0, 24)}`, reasonError(reason), null);
  }
  ok('the canned reasons are all different', new Set(REJECT_REASONS).size === REJECT_REASONS.length);

  eq('a pasted reason collapses to one line',
    normaliseReason('  The scan\n\nis unreadable.  '), 'The scan is unreadable.');
  eq('nothing is nothing', normaliseReason(null), '');
}

// -- 5. the line under the title -----------------------------------
{
  eq('bytes', [humanBytes(0), humanBytes(900), humanBytes(2048), humanBytes(5 * 1024 * 1024)],
    ['0 B', '900 B', '2 KB', '5.0 MB']);

  eq('who and when',
    reviewNote(up(), { sent: '1 Sep 2026' }), 'Sent by the vendor on 1 Sep 2026');
  eq('with an email and a file',
    reviewNote(up({ uploader_email: 'a@b.com', original_filename: 'signed.pdf', byte_size: 2048 }),
      { sent: '1 Sep 2026' }),
    'Sent by the vendor on 1 Sep 2026 \u00b7 a@b.com \u00b7 signed.pdf (2 KB)');
  eq('a size with no name still shows',
    reviewNote(up({ byte_size: 2048 }), {}), 'Sent by the vendor \u00b7 2 KB');
  eq('and when it was decided',
    reviewNote(up({ status: 'accepted' }), { sent: '1 Sep', decided: '3 Sep' }),
    'Sent by the vendor on 1 Sep \u00b7 decided 3 Sep');
}

// -- 6. the counts and the two orders ------------------------------
{
  const rows = [
    up({ id: 'a', created_at: '2026-09-03T10:00:00Z' }),
    up({ id: 'b', created_at: '2026-09-01T10:00:00Z' }),
    up({ id: 'c', status: 'accepted', created_at: '2026-08-01T10:00:00Z', reviewed_at: '2026-08-02T10:00:00Z' }),
    up({ id: 'd', status: 'rejected', created_at: '2026-08-05T10:00:00Z', reviewed_at: '2026-08-09T10:00:00Z',
      rejection_reason: 'The scan is unreadable.' }),
  ];

  eq('the counts', reviewTally(rows), { pending: 2, accepted: 1, rejected: 1 });
  eq('nothing is all zeroes', reviewTally([]), { pending: 0, accepted: 0, rejected: 0 });
  eq('an unknown status counts as pending, not as nothing',
    reviewTally([up({ status: 'weird' })]), { pending: 1, accepted: 0, rejected: 0 });

  // Rule 4.
  eq('the queue is oldest first', pendingReview(rows).map((u) => u.id), ['b', 'a']);
  eq('the history is newest decision first', decidedReview(rows).map((u) => u.id), ['d', 'c']);

  // A stable tie-break, so two uploads sent in the same second do not swap
  // places between renders.
  const tie = [
    up({ id: 'z', created_at: '2026-09-01T10:00:00Z' }),
    up({ id: 'y', created_at: '2026-09-01T10:00:00Z' }),
  ];
  eq('ties break on id', pendingReview(tie).map((u) => u.id), ['y', 'z']);

  // A decided row with no reviewed_at falls back to when it was sent rather
  // than sorting to the bottom as an empty string.
  eq('a decision with no timestamp still sorts',
    decidedReview([
      up({ id: 'old', status: 'accepted', created_at: '2026-01-01T00:00:00Z' }),
      up({ id: 'new', status: 'accepted', created_at: '2026-07-01T00:00:00Z' }),
    ]).map((u) => u.id), ['new', 'old']);

  // Neither list drops anything: every row is in exactly one of them.
  eq('the two lists together are everything',
    pendingReview(rows).length + decidedReview(rows).length, rows.length);
}

// -- 7. search -----------------------------------------------------
{
  const rows = [
    up({ id: 'a', contract_title: 'Rabea tea - Rawad Media', contract_id: 'AQ-001' }),
    up({ id: 'b', contract_title: 'Almarai', contract_id: 'AQ-002',
      uploader_email: 'sara@vendor.com', original_filename: 'scan_final.pdf' }),
    up({ id: 'c', status: 'rejected', contract_title: 'Zain', contract_id: 'AQ-003',
      rejection_reason: 'The scan is unreadable - please send a clearer copy.' }),
  ];
  eq('empty search keeps everything', filterReview(rows, '').map((u) => u.id), ['a', 'b', 'c']);
  eq('by contract name', filterReview(rows, 'rabea').map((u) => u.id), ['a']);
  eq('by reference', filterReview(rows, 'AQ-002').map((u) => u.id), ['b']);
  eq('by sender', filterReview(rows, 'sara@').map((u) => u.id), ['b']);
  eq('by file name', filterReview(rows, 'scan_final').map((u) => u.id), ['b']);
  // "which ones did we send back for a blurry scan" - the word is in the
  // reason and nowhere else.
  eq('by rejection reason', filterReview(rows, 'unreadable').map((u) => u.id), ['c']);
  eq('nothing matches', filterReview(rows, 'zzz'), []);
}

// -- 8. the heading ------------------------------------------------
{
  eq('nothing waiting', queueSummary([]), 'Nothing is waiting to be looked at.');
  eq('nothing waiting, with history',
    queueSummary([up({ status: 'accepted' })]), 'Nothing is waiting to be looked at.');
  eq('one', queueSummary([up()]), '1 signed copy is waiting.');
  eq('several from one side',
    queueSummary([up({ id: '1' }), up({ id: '2' })]), '2 signed copies are waiting.');
  // Both sides is worth saying: chasing a vendor and chasing a client are
  // two different conversations.
  eq('both sides',
    queueSummary([up({ id: '1' }), up({ id: '2', uploader_role: 'client' }), up({ id: '3' })]),
    '3 signed copies are waiting - 2 from vendors, 1 from clients.');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
