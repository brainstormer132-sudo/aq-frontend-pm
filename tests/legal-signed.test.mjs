/**
 * The signed copy that comes back on paper.
 *
 * The rules that matter, in order:
 *
 *   1. THE SCREEN NEVER OFFERS WHAT THE DATABASE WILL REFUSE. Every reason
 *      cannotFileSigned gives back is also enforced by migration 117; these
 *      assertions are what let a disabled button say why it is disabled.
 *   2. A PHOTO IS A VALID SIGNED COPY. What actually happens is somebody
 *      signs the paper and photographs it on a phone. A system that only
 *      takes PDFs makes that person find a scanner or give up.
 *   3. THE STORAGE KEY IS ASCII. Supabase rejects an Arabic object key
 *      outright, and a contract named in Arabic is the normal case here.
 *   4. `awaiting` is the working number - what went out and has not come
 *      back - and a VOID contract is in none of the counts.
 */
import {
  SIGNED_BUCKET, SIGNED_EXTENSIONS, SIGNED_MAX_BYTES,
  hasSignedCopy, cannotFileSigned, fileExtension, validateSignedFile,
  humanBytes, signedStoragePath, signedNote, signedTally, awaitingSignature,
} from '../.test-build/legal-signed.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const ct = (o) => ({
  id: o.id ?? 'c1', status: o.status ?? 'issued', contract_no: o.no ?? 'AQ-2026-1001',
  signed_path: o.path ?? null, signed_name: o.name ?? null, signed_bytes: o.bytes ?? null,
  signed_on: o.on ?? null, signed_recorded_at: o.rec ?? null, created_at: o.at ?? null,
});

/* -- 1. never offer what 117 will refuse ---------------------------- */

eq('an issued, numbered contract can take its signed copy',
  cannotFileSigned(ct({})), null);
ok('a draft cannot - it has no number and no fingerprint yet',
  (cannotFileSigned(ct({ status: 'draft' })) ?? '').includes('issue it first'));
ok('nor can one with no status at all',
  cannotFileSigned({ id: 'c1', status: null }) !== null);
ok('a withdrawn contract has nothing to sign',
  (cannotFileSigned(ct({ status: 'void' })) ?? '').includes('withdrawn'));
ok('and one already signed says so rather than offering again',
  (cannotFileSigned(ct({ status: 'signed', path: 'p', name: 'n' })) ?? '').includes('already on file'));
// A contract issued before numbering existed (108) has no number. 117 refuses
// it, so the screen has to as well rather than showing a button that throws.
ok('an issued contract with no number is refused, not offered',
  (cannotFileSigned(ct({ no: '' })) ?? '').includes('never properly issued'));

eq('the copy is on file when there is a path', hasSignedCopy(ct({ path: 'a/b.pdf' })), true);
eq('and not when the path is blank', hasSignedCopy(ct({ path: '   ' })), false);
eq('nor when there is none', hasSignedCopy(ct({})), false);

/* -- 2. a photo is a valid signed copy ------------------------------ */

eq('a PDF is fine', validateSignedFile({ name: 'scan.pdf', size: 120344 }), null);
eq('a phone photo is fine', validateSignedFile({ name: 'IMG_4821.HEIC', size: 2_400_000 }), null);
eq('and a JPEG', validateSignedFile({ name: 'signed page 1.jpg', size: 900_000 }), null);
eq('and a scanner TIFF', validateSignedFile({ name: 'doc.tiff', size: 5_000_000 }), null);
ok('every listed extension is accepted',
  SIGNED_EXTENSIONS.every((e) => validateSignedFile({ name: `x.${e}`, size: 10 }) === null));
ok('a Word file is not a signed copy',
  (validateSignedFile({ name: 'contract.docx', size: 40_000 }) ?? '').includes('.docx'));
ok('and nothing executable gets through',
  validateSignedFile({ name: 'setup.exe', size: 40_000 }) !== null);
ok('a file with no extension is refused, because there is no telling what it is',
  (validateSignedFile({ name: 'scan', size: 40_000 }) ?? '').includes('no extension'));
ok('an empty file is refused', (validateSignedFile({ name: 'a.pdf', size: 0 }) ?? '').includes('empty'));
ok('nothing chosen is refused', validateSignedFile({}) !== null);
eq('exactly the limit is allowed', validateSignedFile({ name: 'a.pdf', size: SIGNED_MAX_BYTES }), null);
ok('one byte over says how big it is and why the limit exists',
  (validateSignedFile({ name: 'a.pdf', size: SIGNED_MAX_BYTES + 1 }) ?? '').includes('video by mistake'));
eq('the extension is read from the end, not the first dot',
  fileExtension('signed.contract.final.PDF'), 'pdf');
eq('a dotfile has no extension', fileExtension('.gitignore'), '');

eq('bytes read as somebody would say them', humanBytes(900), '900 B');
eq('kilobytes round', humanBytes(120344), '118 KB');
eq('megabytes keep a decimal while small', humanBytes(2_400_000), '2.3 MB');
eq('and drop it once large', humanBytes(24_000_000), '23 MB');

/* -- 3. the storage key is ASCII ------------------------------------ */
//
// Supabase rejects a non-ASCII object key outright. A contract named in
// Arabic is the normal case here, so this is not an edge.

const arabic = signedStoragePath('ws1', 'c1', '\u0639\u0642\u062f \u0645\u0648\u0642\u0639.pdf', 'abc123');
ok('an Arabic file name still produces a usable key', /^[\x20-\x7e]+$/.test(arabic));
ok('and keeps something to recognise it by', arabic.endsWith('.pdf'));
ok('the key is filed under the workspace and the contract',
  arabic.startsWith('ws1/c1/'));
ok('and carries a random segment, so re-filing never collides',
  signedStoragePath('ws1', 'c1', 'a.pdf', 'aaa') !== signedStoragePath('ws1', 'c1', 'a.pdf', 'bbb'));
eq('spaces and punctuation collapse rather than breaking the key',
  signedStoragePath('ws1', 'c1', 'signed copy (final).pdf', 'r1'), 'ws1/c1/r1-signed_copy_final_.pdf');
ok('a name that is nothing but punctuation still gets a key',
  signedStoragePath('ws1', 'c1', '\u0639\u0642\u062f', 'r1').includes('signed.'));
eq('the bucket is the private one from 117', SIGNED_BUCKET, 'legal-signed');

/* -- 4. what the screen says, and the checklist --------------------- */

eq('nothing on file says nothing', signedNote(ct({}), {}), null);
eq('the date on the paper leads, because that is the one that matters',
  signedNote(ct({ path: 'p', name: 'scan.pdf', bytes: 120344, on: '2026-03-04' }),
    { on: '4 Mar 2026', recorded: '19 Mar 2026' }),
  'Signed 4 Mar 2026, filed 19 Mar 2026 - scan.pdf (118 KB)');
eq('with no date on the paper it says when it was filed',
  signedNote(ct({ path: 'p', name: 'scan.pdf' }), { recorded: '19 Mar 2026' }),
  'Filed 19 Mar 2026 - scan.pdf');
eq('and with no dates at all it still names the file',
  signedNote(ct({ path: 'p', name: 'scan.pdf' }), {}), 'scan.pdf');

{
  const rows = [
    ct({ id: 'a', status: 'issued', at: '2026-01-05' }),
    ct({ id: 'b', status: 'signed', path: 'p', name: 'n', at: '2026-01-02' }),
    ct({ id: 'c', status: 'issued', at: '2026-01-01' }),
    ct({ id: 'd', status: 'draft', at: '2026-01-09' }),
    ct({ id: 'e', status: 'void', at: '2026-01-03' }),
  ];
  const t = signedTally(rows);
  // A signed contract was issued too - it is not a separate population.
  eq('signed counts inside issued', t.issued, 3);
  eq('signed is signed', t.signed, 1);
  eq('awaiting is what went out and has not come back', t.awaiting, 2);
  // Nobody is waiting on a withdrawn contract, and counting it would put a
  // number on the checklist that no amount of chasing can clear.
  ok('a void contract is in none of the counts',
    signedTally([ct({ status: 'void' })]).issued === 0
    && signedTally([ct({ status: 'void' })]).awaiting === 0);
  ok('and neither is a draft', signedTally([ct({ status: 'draft' })]).issued === 0);
  eq('nothing at all is all zeroes', signedTally([]), { issued: 0, signed: 0, awaiting: 0 });

  // Oldest first: the oldest one outstanding is the one to chase, and the
  // register is sorted newest-first everywhere else.
  eq('the checklist is the outstanding ones, oldest first',
    awaitingSignature(rows).map((r) => r.id), ['c', 'a']);
  eq('nothing outstanding is an empty checklist',
    awaitingSignature([ct({ status: 'signed', path: 'p', name: 'n' })]), []);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
