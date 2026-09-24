/**
 * Printing a stack of contracts at once.
 *
 * The guarantee this suite exists for is the first one below: a batch of ONE
 * is byte for byte the document that printing that contract on its own
 * produces. Everything else here is detail; that one assertion is what stops
 * the batch quietly becoming a second, worse renderer that misses the next
 * letterhead fix.
 *
 * After it: that every contract asked for comes out, in the order asked for,
 * separated by a page break; that a contract with nothing to print is LEFT
 * OUT AND SAID rather than handed over as a blank page with a letterhead on
 * it; that the clauses somebody switched off stay off; and that the blocks
 * come back in position order however the pages they arrived on were sliced.
 */
import {
  chunk, versionIdsOf, valuesByContract, blocksByVersion, buildPrintDocs,
  skippedNote, filterContracts, toggleId, selectedInOrder, bulkPrintNote,
  BULK_PRINT_WARN_AT,
} from '../.test-build/legal-bulk.js';
import {
  contractPrintHTML, contractsPrintHTML, contractSheetHtml, printReference,
  bulkPrintTitle, printDocTitle, FINGERPRINT_KEY, OPT_OFF_KEY,
} from '../.test-build/legal.js';
import { printApproval } from '../.test-build/legal.js';
import { supersedeLinks } from '../.test-build/legal-supersede.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const blk = (o) => ({
  id: o.id, version_id: o.v, workspace_id: 'w', position: o.pos,
  block_type: o.t ?? 'p', content: o.c ?? { text: o.text ?? 'Body' },
  optional: o.optional ?? false, optional_group: o.group ?? null,
  optional_label: o.label ?? null, condition: null, clause_id: null,
});
const ct = (o) => ({
  id: o.id, version_id: o.v, title: o.title ?? 'A contract',
  status: o.status ?? 'issued', contract_no: o.no ?? null,
  template_name: o.tpl ?? 'UGC agreement', doc_kind: o.kind ?? 'vendor_contract',
});
const fld = (id, key, value) => ({ contract_id: id, key, value });

/* -- 1. a batch of one IS the single print --------------------------- */
//
// Not "looks the same" - the same string. The two paths share
// contractSheetHtml, and this is the assertion that keeps them sharing it.

const oneDoc = {
  title: 'Rawad UGC',
  blocks: [blk({ id: 'b1', v: 'v1', pos: 1, t: 'title', c: { text: 'UGC AGREEMENT' } }),
    blk({ id: 'b2', v: 'v1', pos: 2, text: 'The vendor shall deliver {{ deliverables }}.' })],
  values: { deliverables: '3 reels' },
  dir: 'ltr',
  meta: { status: 'issued', reference: 'AQ-2026-0108' },
};
// The title the single path derives (printDocTitle: the contract's NUMBER
// when it has one). Passed in explicitly so this stays an assertion about the
// SHEET being shared, which is its job, and not about how each path names its
// own <title>.
const oneTitle = printDocTitle(oneDoc.meta.reference, oneDoc.title);
eq('a batch of one is the single document, byte for byte',
  contractsPrintHTML([oneDoc], oneTitle), contractPrintHTML(oneDoc));

const rtlDoc = { ...oneDoc, dir: 'rtl' };
eq('and the same for an Arabic one, whose whole layout turns round',
  contractsPrintHTML([rtlDoc], oneTitle), contractPrintHTML(rtlDoc));

ok('a mixed batch lays out left to right',
  contractsPrintHTML([rtlDoc, oneDoc]).includes('<html lang="en" dir="ltr">'));
// Deliberately not a majority vote. Two Arabic contracts and one English is
// still laid out left to right, because a document that flips its scrollbar
// depending on which rows happened to be ticked is disorienting - and every
// Arabic sheet turns itself round regardless.
ok('and still does when the Arabic ones outnumber the English one',
  contractsPrintHTML([rtlDoc, rtlDoc, oneDoc]).includes('<html lang="en" dir="ltr">'));
ok('an all-Arabic batch does not',
  contractsPrintHTML([rtlDoc, rtlDoc]).includes('<html lang="ar" dir="rtl">'));
ok('and each sheet still carries its own direction',
  contractsPrintHTML([rtlDoc, oneDoc]).includes('<table class="page" lang="ar" dir="rtl">'));

/* -- 2. every contract, in order, on its own page --------------------- */

const two = contractsPrintHTML([
  { ...oneDoc, title: 'First', meta: { reference: 'AQ-0001' } },
  { ...oneDoc, title: 'Second', meta: { reference: 'AQ-0002' } },
]);
eq('one sheet per contract', two.split('<table class="page"').length - 1, 2);
ok('in the order given', two.indexOf('AQ-0001') < two.indexOf('AQ-0002'));
ok('the second starts a fresh page', two.includes('table.page + table.page'));
ok('both spellings of the page break, because engines disagree',
  two.includes('page-break-before: always') && two.includes('break-before: page'));
eq('the document is named for the count', bulkPrintTitle(12), '12 contracts');
eq('and reads naturally at one', bulkPrintTitle(1), 'Contract');
ok('an empty batch is still a document, not a crash',
  contractsPrintHTML([]).startsWith('<!doctype html>'));

/* -- 3. the reference: the number once it has one -------------------- */
//
// The fill screen printed `Ref: <first 8 of the row id>` while the register
// showed the contract number. Same contract, two names, depending on which
// button was pressed.

eq('an issued contract prints its number',
  printReference({ id: '9f2c1a4e-0000', contract_no: 'AQ-2026-0108' }), 'AQ-2026-0108');
eq('a draft has no number yet, so it falls back to the id',
  printReference({ id: '9f2c1a4e-0000', contract_no: null }), '');
eq('and blank is not a number', printReference({ id: 'abcdefgh12', contract_no: '  ' }), '');
eq('nothing at all prints nothing', printReference({}), '');
// CHANGED 22 Sep. It used to fall back to `Ref: <first eight of the id>`,
// which predates the labelled meta strip at the top of the page. Under that
// fallback a draft printed "CONTRACT NO  Ref: 9f2c1a4e" - a label saying
// "number" over a value saying "Ref", for a thing that is not a number. The
// id now has its own labelled row, so the number row is simply absent until
// there is a number.
ok('a draft contributes no number row at all',
  !contractPrintHTML({ title: 't', dir: 'ltr', values: {},
    blocks: [{ block_type: 'p', content: { text: 'x' } }],
    meta: { reference: printReference({ id: '9f2c1a4e-1111-2222-3333-444444444444', contract_no: null }),
            contractId: '9f2c1a4e-1111-2222-3333-444444444444', status: 'draft' },
  }).includes('Contract no'));

/* -- 4. building the documents from raw rows ------------------------- */

const blocks = [
  blk({ id: 'b2', v: 'v1', pos: 2, text: 'Second clause.' }),
  blk({ id: 'b1', v: 'v1', pos: 1, t: 'title', c: { text: 'UGC AGREEMENT' } }),
  blk({ id: 'b9', v: 'v2', pos: 1, t: 'title', c: { text: 'NDA' } }),
];
const built = buildPrintDocs({
  contracts: [ct({ id: 'c1', v: 'v1', title: 'One', no: 'AQ-0001' }),
    ct({ id: 'c2', v: 'v2', title: 'Two', status: 'draft' })],
  blocks,
  fields: [fld('c1', 'deliverables', '3 reels'), fld('c1', FINGERPRINT_KEY, 'abc123'),
    fld('c2', 'deliverables', '1 post')],
});
eq('one document per contract', built.docs.length, 2);
eq('nothing was left out', built.skipped.length, 0);
eq('the blocks come back in position order, whatever order they arrived in',
  built.docs[0].blocks.map((b) => b.id), ['b1', 'b2']);
eq('each contract gets its own values', built.docs[1].values.deliverables, '1 post');
eq('and its own reference', built.docs[0].meta.reference, 'AQ-0001');
eq('a draft carries its status through, so the page says DRAFT',
  built.docs[1].meta.status, 'draft');
ok('a draft prints the word', contractsPrintHTML([built.docs[1]]).includes('>DRAFT<'));
ok('an issued one does not', !contractsPrintHTML([built.docs[0]]).includes('>DRAFT<'));
ok('the fingerprint is stamped on the one that has one',
  contractsPrintHTML([built.docs[0]]).includes('class="doc-fp-hash"'));
ok('and not invented for the one that does not',
  !contractsPrintHTML([built.docs[1]]).includes('class="doc-fp-hash"'));

/* -- 5. a contract with nothing to print is left out, and said ------- */
//
// The alternative is one blank page with a letterhead on it, handed to
// somebody as an agreement.

const gone = buildPrintDocs({
  contracts: [ct({ id: 'c1', v: 'v1', title: 'One' }), ct({ id: 'c3', v: 'vX', title: 'Orphan' })],
  blocks, fields: [],
});
eq('the one that can be printed is', gone.docs.length, 1);
eq('the one that cannot is not', gone.docs.map((d) => d.title), ['One']);
eq('and it is named', gone.skipped[0].title, 'Orphan');
eq('with a reason', gone.skipped[0].why, 'its template version has no content');
eq('one skip reads as one', skippedNote(gone.skipped),
  'Orphan was left out - its template version has no content.');
eq('nothing skipped says nothing', skippedNote([]), null);

// Group before you cap: five hundred is one fact, not five hundred rows.
const many = Array.from({ length: 7 }, (_, i) => ({ id: `x${i}`, title: `T${i}`, why: 'its template version has no content' }));
eq('many skips are counted, then the first few named',
  skippedNote(many, 2),
  '7 contracts were left out (T0, T1, and 5 more) - its template version has no content.');

/* -- 6. the clauses somebody switched off stay off ------------------- */

const optBlocks = [
  blk({ id: 'k1', v: 'v3', pos: 1, text: 'Always.' }),
  blk({ id: 'k2', v: 'v3', pos: 2, text: 'Only sometimes.', optional: true, group: 'g1' }),
];
const off = buildPrintDocs({
  contracts: [ct({ id: 'c4', v: 'v3' })], blocks: optBlocks,
  fields: [fld('c4', OPT_OFF_KEY, 'k2')],
});
eq('a clause turned off is not printed', off.docs[0].blocks.map((b) => b.id), ['k1']);
ok('and its wording is nowhere in the document',
  !contractsPrintHTML(off.docs).includes('Only sometimes'));
const on = buildPrintDocs({
  contracts: [ct({ id: 'c4', v: 'v3' })], blocks: optBlocks, fields: [],
});
eq('left on, it is printed', on.docs[0].blocks.map((b) => b.id), ['k1', 'k2']);

const allOff = buildPrintDocs({
  contracts: [ct({ id: 'c5', v: 'v3', title: 'Hollow' })],
  blocks: [blk({ id: 'k2', v: 'v3', pos: 2, text: 'Only.', optional: true, group: 'g1' })],
  fields: [fld('c5', OPT_OFF_KEY, 'k2')],
});
eq('a contract with every clause off is left out too', allOff.docs.length, 0);
eq('and says which', allOff.skipped[0].why, 'every clause in it is switched off');

/* -- 7. the reads that feed it -------------------------------------- */

eq('one read per version, not per contract',
  versionIdsOf([ct({ id: 'a', v: 'v1' }), ct({ id: 'b', v: 'v1' }), ct({ id: 'c', v: 'v2' })]).length, 2);
eq('a contract with no version is not asked for', versionIdsOf([{ id: 'a', version_id: '' }]), []);
eq('ids go to the database in pieces', chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
eq('an empty list is no reads at all', chunk([], 50), []);
ok('a silly size still terminates', chunk([1, 2, 3], 0).length === 3);
eq('field rows fold by contract',
  valuesByContract([fld('c1', 'a', '1'), fld('c2', 'a', '2'), fld('c1', 'b', '3')]).c1, { a: '1', b: '3' });
eq('a null value is an empty string, not a null', valuesByContract([fld('c1', 'a', null)]).c1.a, '');
eq('blocks fold by version', Object.keys(blocksByVersion(blocks)).sort(), ['v1', 'v2']);

/* -- 8. finding the contracts to tick ------------------------------- */

const rows = [
  ct({ id: 'c1', v: 'v1', title: 'Rawad UGC', no: 'AQ-2026-0108', status: 'issued' }),
  ct({ id: 'c2', v: 'v1', title: 'Nadia NDA', tpl: 'NDA form', kind: 'nda', status: 'draft' }),
  ct({ id: 'c3', v: 'v2', title: 'Client - Almarai', kind: 'client_contract', status: 'issued' }),
];
eq('the number finds it', filterContracts(rows, 'AQ-2026-0108', '').map((r) => r.id), ['c1']);
eq('so does part of the title', filterContracts(rows, 'nadia', '').map((r) => r.id), ['c2']);
eq('and the template name', filterContracts(rows, 'NDA form', '').map((r) => r.id), ['c2']);
// The label, not the key: nobody has ever seen the word vendor_contract.
eq('the kind is searched as it is LABELLED',
  filterContracts(rows, 'influencer', '').map((r) => r.id), ['c1']);
eq('and the status too', filterContracts(rows, 'draft', '').map((r) => r.id), ['c2']);
eq('the status filter is exact', filterContracts(rows, '', 'issued').map((r) => r.id), ['c1', 'c3']);
eq('both together narrow further', filterContracts(rows, 'client', 'issued').map((r) => r.id), ['c3']);
eq('nothing typed is everything', filterContracts(rows, '', '').length, 3);

eq('ticking adds', toggleId(['a'], 'b'), ['a', 'b']);
eq('ticking again removes', toggleId(['a', 'b'], 'a'), ['b']);
// The stack prints in the order of the register, not the order of ticking.
eq('the selection prints in screen order, not click order',
  selectedInOrder(rows, ['c3', 'c1']).map((r) => r.id), ['c1', 'c3']);
eq('an id no longer on screen is not printed', selectedInOrder(rows, ['zz']), []);

eq('a small batch says nothing', bulkPrintNote(3), null);
ok('a big one warns rather than refuses', (bulkPrintNote(BULK_PRINT_WARN_AT) ?? '').includes('big print'));

/* -- 9. a batch never hands over a replaced contract looking current -- */
//
// The whole reason buildPrintDocs takes the links from the CALLER rather than
// from the contracts being printed: printing one old contract on its own is
// exactly the case where its correction is not in the selection.

{
  const original = ct({ id: 'c1', v: 'v1', title: 'Original', no: 'AQ-0001' });
  const liveCorr = ct({ id: 'c9', v: 'v1', title: 'Correction', no: 'AQ-0009', status: 'issued' });
  liveCorr.supersedes_id = 'c1';
  liveCorr.supersede_reason = 'the fee was wrong';
  const links = supersedeLinks([original, liveCorr]);

  // Printing the ORIGINAL ALONE - the correction is nowhere in the selection.
  const one = buildPrintDocs({ contracts: [original], blocks, fields: [], links });
  ok('a replaced contract printed on its own still says it was replaced',
    contractsPrintHTML(one.docs).includes('SUPERSEDED - replaced by AQ-0009.'));
  ok('and the notice is the boxed one, not a footnote',
    contractsPrintHTML(one.docs).includes('class="doc-replaced"'));

  const both = buildPrintDocs({ contracts: [original, liveCorr], blocks, fields: [], links });
  ok('the correction says what it replaces',
    contractsPrintHTML(both.docs).includes('This agreement replaces AQ-0001.'));
  ok('the reason stays off the paper',
    !contractsPrintHTML(both.docs).includes('the fee was wrong'));

  // A correction still in DRAFT has replaced nothing.
  const draftCorr = ct({ id: 'c8', v: 'v1', title: 'Draft correction', status: 'draft' });
  draftCorr.supersedes_id = 'c1';
  draftCorr.supersede_reason = 'still working on it';
  const pending = buildPrintDocs({
    contracts: [original], blocks, fields: [],
    links: supersedeLinks([original, draftCorr]),
  });
  ok('a contract with only a DRAFT correction prints clean',
    !contractsPrintHTML(pending.docs).includes('SUPERSEDED'));

  // No links at all is the ordinary case and must print nothing extra.
  const plain = buildPrintDocs({ contracts: [original], blocks, fields: [] });
  ok('a workspace that has never corrected anything prints no notice',
    !contractsPrintHTML(plain.docs).includes('SUPERSEDED')
    && !contractsPrintHTML(plain.docs).includes('doc-replaces"'));
}

/* -- the approval reaches the batch too ------------------------------
 *
 * The failure this pins: a stack of forty where only the contracts printed
 * one at a time carry the owner's signing line. Nobody notices until somebody
 * is holding the one that does not.
 */
{
  const blocks = [blk({ id: 'b1', v: 'v9', pos: 1, text: 'Body' })];
  const yes = { ...ct({ id: 'c-yes', v: 'v9', no: 'AQ-2026-0201' }),
    approved_at: '2026-09-23T10:00:00Z', approved_name: 'Siraj Q' };
  const no = ct({ id: 'c-no', v: 'v9', no: 'AQ-2026-0202', status: 'draft' });

  const built = buildPrintDocs({ contracts: [yes, no], blocks, fields: [] });
  eq('the approved one carries its approval into the batch',
    built.docs[0].meta.approval, { name: 'Siraj Q', on: '2026-09-23' });
  eq('and the unapproved one carries none', built.docs[1].meta.approval, undefined);

  const html = contractsPrintHTML(built.docs);
  eq('exactly one signing line in a stack of two',
    html.split('doc-approval"').length - 1, 1);
  ok('and it names the owner who approved it', html.includes('<bdi>Siraj Q</bdi>'));

  // A batch of one is still byte for byte the single print - the guarantee
  // this whole suite opens with, re-checked now that meta has one more field
  // in it that only one of the two paths fills.
  const single = contractSheetHtml(built.docs[0]);
  ok('a batch of one with an approval is the single print',
    contractsPrintHTML([built.docs[0]]).includes(single));
  eq('and printApproval is what both of them used',
    printApproval(yes), built.docs[0].meta.approval);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
