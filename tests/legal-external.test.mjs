/**
 * Agreements that were never made in this app.
 *
 * What is worth protecting here:
 *
 *   1. EXPIRY BEATS SIGNED. "Signed" on a lease that ran out in March is a
 *      green badge on a problem, and the whole reason to file these is so
 *      that nothing runs out unnoticed.
 *   2. UNSIGNED IS A REAL STATE. A draft the other side sent over is on file
 *      and not yet agreed, which is different from "we do not know".
 *   3. A WORD FILE IS FINE HERE and is not fine as a signed counterpart. One
 *      is what the other side emailed; the other is meant to be a scan of
 *      something somebody put a pen to.
 *   4. The list leads with whatever needs attention, not with whatever was
 *      filed most recently.
 */
import {
  EXTERNAL_PREFIX, EXTERNAL_EXTENSIONS, EXTERNAL_MAX_BYTES,
  validateExternalFile, validateExternalDoc, externalStoragePath,
  externalState, externalBadge, externalLabel, externalNote,
  filterExternal, sortExternal, externalTally, addDays,
  filingDeleteWarning,
} from '../.test-build/legal-external.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const TODAY = '2026-09-22';
const d = (o) => ({
  id: o.id ?? 'e1', title: o.title ?? 'Office lease',
  doc_kind: o.kind ?? 'other', party_name: o.party ?? '',
  reference: o.ref ?? null, signed_on: o.signed ?? null, expires_on: o.expires ?? null,
  notes: o.notes ?? '', file_path: 'external/w/e1/r-x.pdf', file_name: o.file ?? 'lease.pdf',
  file_bytes: o.bytes ?? null, created_at: o.at ?? null,
});

/* -- 1. expiry beats signed ----------------------------------------- */

eq('a signed agreement with no expiry reads as signed',
  externalState(d({ signed: '2026-01-01' }), TODAY), 'signed');
eq('one that has run out reads as expired, signed or not',
  externalState(d({ signed: '2026-01-01', expires: '2026-08-01' }), TODAY), 'expired');
eq('and one running out soon warns',
  externalState(d({ signed: '2026-01-01', expires: '2026-10-05' }), TODAY), 'expiring');
eq('one expiring far off is just signed',
  externalState(d({ signed: '2026-01-01', expires: '2027-10-05' }), TODAY), 'signed');
// The boundaries, because a window is only as good as its edges.
eq('expiring today is not expired yet',
  externalState(d({ signed: 'x', expires: TODAY }), TODAY), 'expiring');
eq('the last day of the window still warns',
  externalState(d({ signed: 'x', expires: addDays(TODAY, 30) }), TODAY), 'expiring');
eq('one day past it does not',
  externalState(d({ signed: 'x', expires: addDays(TODAY, 31) }), TODAY), 'signed');
eq('yesterday is expired', externalState(d({ expires: addDays(TODAY, -1) }), TODAY), 'expired');

eq('expired reads as an error', externalBadge('expired'), 'aq-badge-error');
eq('expiring warns', externalBadge('expiring'), 'aq-badge-warning');
eq('signed is good', externalBadge('signed'), 'aq-badge-success');
eq('unsigned is neither', externalBadge('unsigned'), 'aq-badge-muted');
eq('and the words match', externalLabel('unsigned'), 'Not signed');

/* -- 2. unsigned is a real state ------------------------------------ */

eq('no signing date means not signed', externalState(d({}), TODAY), 'unsigned');
eq('a blank one too', externalState(d({ signed: '   ' }), TODAY), 'unsigned');
// Still counted as filed - it is on the shelf, it is just not agreed.
{
  const t = externalTally([
    d({ id: 'a', signed: '2026-01-01' }),
    d({ id: 'b' }),
    d({ id: 'c', signed: '2026-02-01', expires: '2026-08-01' }),
    d({ id: 'd', signed: '2026-02-01', expires: '2026-10-01' }),
  ], TODAY);
  eq('everything on file is counted', t.filed, 4);
  eq('signed counts the ones with a date', t.signed, 3);
  eq('expired is its own number', t.expired, 1);
  eq('and so is expiring', t.expiring, 1);
  eq('nothing filed is all zeroes', externalTally([], TODAY),
    { filed: 0, signed: 0, expiring: 0, expired: 0 });
}

/* -- 3. a Word file is fine here ------------------------------------ */
//
// It is what the other side emailed. Refusing it would send her to find a
// printer to make a worse copy of something she already has.

eq('a Word file is accepted', validateExternalFile({ name: 'NDA.docx', size: 40_000 }), null);
eq('and the old format too', validateExternalFile({ name: 'lease.doc', size: 40_000 }), null);
eq('a PDF of course', validateExternalFile({ name: 'msa.pdf', size: 120_000 }), null);
eq('and a photo of a signed page', validateExternalFile({ name: 'IMG_1.HEIC', size: 900_000 }), null);
ok('everything a signed counterpart allows is allowed here too',
  EXTERNAL_EXTENSIONS.includes('pdf') && EXTERNAL_EXTENSIONS.includes('heic'));
ok('nothing executable', validateExternalFile({ name: 'x.exe', size: 10 }) !== null);
ok('nor a spreadsheet, which is not an agreement',
  validateExternalFile({ name: 'terms.xlsx', size: 10 }) !== null);
ok('an empty file is refused', validateExternalFile({ name: 'a.pdf', size: 0 }) !== null);
eq('exactly the limit is allowed',
  validateExternalFile({ name: 'a.pdf', size: EXTERNAL_MAX_BYTES }), null);
ok('over it is not', validateExternalFile({ name: 'a.pdf', size: EXTERNAL_MAX_BYTES + 1 }) !== null);

/* -- the form ------------------------------------------------------- */

eq('a complete filing is ready',
  validateExternalDoc({ title: 'Office lease', doc_kind: 'other' }), null);
ok('it needs a name you would search for',
  (validateExternalDoc({ title: '  ', doc_kind: 'other' }) ?? '').includes('search for'));
ok('and a kind', (validateExternalDoc({ title: 'x', doc_kind: '' }) ?? '').includes('what kind'));
ok('an unknown kind is not a kind',
  validateExternalDoc({ title: 'x', doc_kind: 'invoice' }) !== null);
// The same rule migration 118 holds, checked while she is still looking at
// the two boxes rather than after a failed save.
ok('it cannot expire before it was signed',
  (validateExternalDoc({ title: 'x', doc_kind: 'nda', signed_on: '2026-06-01', expires_on: '2026-01-01' }) ?? '')
    .includes('expire before'));
eq('the same day is fine - a one-day agreement is a real thing',
  validateExternalDoc({ title: 'x', doc_kind: 'nda', signed_on: '2026-06-01', expires_on: '2026-06-01' }), null);
eq('an expiry with no signing date is fine',
  validateExternalDoc({ title: 'x', doc_kind: 'nda', expires_on: '2026-01-01' }), null);

/* -- the storage key ------------------------------------------------ */

const ar = externalStoragePath('ws1', 'e1', '\u0639\u0642\u062f \u0627\u0644\u0625\u064a\u062c\u0627\u0631.pdf', 'abc123');
ok('an Arabic name still produces a usable key', /^[\x20-\x7e]+$/.test(ar));
ok('filed under the external prefix, so it cannot collide with a contract',
  ar.startsWith(`${EXTERNAL_PREFIX}/ws1/e1/`));
ok('and keeps its extension', ar.endsWith('.pdf'));
ok('a different filing of the same name does not collide',
  externalStoragePath('ws1', 'e1', 'a.pdf', 'r1') !== externalStoragePath('ws1', 'e1', 'a.pdf', 'r2'));

/* -- 4. the list leads with what needs attention -------------------- */

{
  const rows = [
    d({ id: 'new', at: '2026-09-20' }),
    d({ id: 'expired-old', expires: '2026-01-01', at: '2026-01-01' }),
    d({ id: 'soon', expires: '2026-10-01', at: '2026-02-01' }),
    d({ id: 'older', at: '2026-05-01' }),
    d({ id: 'expired-recent', expires: '2026-08-01', at: '2026-08-01' }),
  ];
  // Expired first (soonest deadline first within it), then expiring, then
  // everything else newest first.
  eq('expired leads, then expiring, then the rest newest first',
    sortExternal(rows, TODAY).map((r) => r.id),
    ['expired-old', 'expired-recent', 'soon', 'new', 'older']);
  eq('sorting does not mutate the input', rows[0].id, 'new');
  eq('an empty list sorts to an empty list', sortExternal([], TODAY), []);
}

/* -- finding one ---------------------------------------------------- */

{
  const rows = [
    d({ id: 'a', title: 'Office lease', party: 'Adex Tower', kind: 'other' }),
    d({ id: 'b', title: 'Almarai MSA', party: 'Almarai', kind: 'client_contract', ref: 'ALM-2024-77' }),
    d({ id: 'c', title: 'Mutual NDA', party: 'Snap Inc', kind: 'nda' }),
  ];
  eq('the title finds it', filterExternal(rows, 'lease', '').map((r) => r.id), ['a']);
  eq('so does the other side', filterExternal(rows, 'almarai', '').map((r) => r.id), ['b']);
  eq('and their own reference', filterExternal(rows, 'ALM-2024', '').map((r) => r.id), ['b']);
  // The label, not the key - nobody has seen the word client_contract.
  eq('the kind is searched as it is labelled',
    filterExternal(rows, 'client contract', '').map((r) => r.id), ['b']);
  eq('the kind filter is exact', filterExternal(rows, '', 'nda').map((r) => r.id), ['c']);
  eq('nothing typed is everything', filterExternal(rows, '', '').length, 3);
}

eq('the line under the title says who and what',
  externalNote(d({ party: 'Adex Tower', kind: 'other', file: 'lease.pdf', bytes: 120344 })),
  'Adex Tower \u00b7 Other \u00b7 lease.pdf (118 KB)');
eq('with no other side it still says the kind and the file',
  externalNote(d({ kind: 'nda', file: 'nda.pdf' })), 'NDA \u00b7 nda.pdf');


/* -- what it says before it removes a filing --------------------------- */
// The native dialog did name the title, but said nothing about the FILE -
// and the file is the part that cannot be recovered. A filing row can be
// typed again in a minute; the signed PDF somebody uploaded cannot.
{
  const w = filingDeleteWarning({ title: 'NDA - Rabea', file_name: 'nda-rabea.pdf' });
  ok('it names the filing', w.includes('"NDA - Rabea"'));
  ok('and the file that goes with it', w.includes('nda-rabea.pdf'));
  ok('and says it cannot be undone', w.includes('cannot be undone'));
  // A filing with no upload must not promise to delete a file that is not there.
  ok('no file, no sentence about one',
    !filingDeleteWarning({ title: 'NDA' }).includes('uploaded file'));
  ok('an unnamed filing still reads as a sentence',
    filingDeleteWarning({}).startsWith('Remove this filing?'));
  ok('and so does nothing at all', filingDeleteWarning(null).length > 15);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
