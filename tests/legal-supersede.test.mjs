/**
 * Correcting a contract that has already gone out.
 *
 * The guarantees, in the order they matter:
 *
 *   1. THE SEAL STILL VERIFIES. An original is fingerprinted at issue; its
 *      correction is written afterwards. If the supersede lines ever entered
 *      contractCanonical, every superseded contract would verify as "differs"
 *      - the seal reporting tampering because we told it the truth. That is
 *      the first assertion below and it is the one worth the most.
 *   2. A REPLACED COPY CANNOT BE PRINTED LOOKING CURRENT. The one moment this
 *      matters is somebody pulling an old copy off the printer.
 *   3. A DRAFT CORRECTION REPLACES NOTHING. Starting to type a correction
 *      must not stamp "REPLACED" on a live contract.
 *   4. The correction starts from the original's values but NOT its seal or
 *      its number.
 *   5. The screen never offers a correction the database is about to refuse.
 */
import {
  isLiveCorrection, supersedeLinks, supersedeState, supersedeBadge, supersedeLabel,
  nameOf, supersedeNote, cannotSupersede, validateSupersedeReason, correctionTitle,
  carriedValues, printReplacesLine, printReplacedLine, supersedeChain,
  REASON_MIN, REASON_MAX, SEAL_KEYS,
} from '../.test-build/legal-supersede.js';
import {
  contractCanonical, contractPrintHTML, FINGERPRINT_KEY, ISSUED_AT_KEY, OPT_OFF_KEY,
} from '../.test-build/legal.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const ct = (o) => ({
  id: o.id, title: o.title ?? 'A contract', status: o.status ?? 'issued',
  contract_no: o.no ?? null, supersedes_id: o.of ?? null,
  supersede_reason: o.why ?? (o.of ? 'the fee was wrong' : null),
});

/* -- 1. the seal still verifies ------------------------------------- */
//
// The supersede lines live beside the reference and the fingerprint, OUTSIDE
// the canonical string. Adding them to it would break every already-issued
// contract the day it was corrected.

const blocks = [
  { id: 'b1', block_type: 'title', content: { text: 'UGC AGREEMENT' } },
  { id: 'b2', block_type: 'p', content: { text: 'The fee is {{ fee }}.' } },
];
const values = { fee: '12,500 SAR' };
const sealed = contractCanonical('v1', blocks, values);

const plain = contractPrintHTML({
  title: 'T', blocks, values, dir: 'ltr',
  meta: { reference: 'AQ-2026-0001', status: 'issued' },
});
const marked = contractPrintHTML({
  title: 'T', blocks, values, dir: 'ltr',
  meta: { reference: 'AQ-2026-0001', status: 'issued', replacedBy: 'SUPERSEDED - replaced by AQ-2026-0009.' },
});
eq('the canonical is the same whatever the supersede lines say',
  contractCanonical('v1', blocks, values), sealed);
ok('the printed page does change', plain !== marked);
ok('and the words that changed are the notice, not the agreement',
  marked.includes('SUPERSEDED - replaced by AQ-2026-0009.')
  && marked.includes('The fee is <bdi>12,500 SAR</bdi>.')
  && plain.includes('The fee is <bdi>12,500 SAR</bdi>.'));

/* -- 2. a replaced copy cannot print looking current ---------------- */

ok('a replaced original is stamped', marked.includes('class="doc-replaced"'));
ok('in the same red as DRAFT, and boxed for a black-and-white printer',
  marked.includes('.doc-replaced') && marked.includes('#b3261e') && marked.includes('1.5pt solid'));
const corr = contractPrintHTML({
  title: 'T', blocks, values, dir: 'ltr',
  meta: { reference: 'AQ-2026-0009', status: 'issued', replaces: 'This agreement replaces AQ-2026-0001.' },
});
ok('a correction says what it replaces', corr.includes('This agreement replaces AQ-2026-0001.'));
ok('quietly - it is not the dead one', !corr.includes('class="doc-replaced"'));
ok('an ordinary contract says neither',
  !plain.includes('doc-replaced"') && !plain.includes('doc-replaces"'));

eq('the printed line names the number', printReplacesLine(ct({ id: 'a', no: 'AQ-2026-0001' })),
  'This agreement replaces AQ-2026-0001.');
eq('and the loud one too', printReplacedLine(ct({ id: 'b', no: 'AQ-2026-0009' })),
  'SUPERSEDED - replaced by AQ-2026-0009.');
// A draft has no number, so there is nothing truthful to print.
eq('a numberless correction prints no line', printReplacesLine(ct({ id: 'a', no: null })), null);
eq('and neither does nothing at all', printReplacedLine(null), null);
// The REASON never goes on the paper - it is an internal note.
ok('the reason is not printed',
  !corr.includes('the fee was wrong') && !marked.includes('the fee was wrong'));

/* -- 3. a draft correction replaces nothing ------------------------- */

const orig = ct({ id: 'a', no: 'AQ-2026-0001', status: 'issued' });
const draftCorr = ct({ id: 'b', of: 'a', status: 'draft', no: null });
const liveCorr = ct({ id: 'c', of: 'a', status: 'issued', no: 'AQ-2026-0009' });

ok('a draft correction is not live', !isLiveCorrection(draftCorr));
ok('an issued one is', isLiveCorrection(liveCorr));
ok('and so is a signed one', isLiveCorrection(ct({ id: 'x', status: 'signed' })));

{
  const links = supersedeLinks([orig, draftCorr]);
  eq('while the correction is a draft the original is not replaced',
    supersedeState(orig, links), 'correcting');
  eq('the pill says so', supersedeLabel(supersedeState(orig, links)), 'Correction in progress');
  eq('and warns rather than alarms', supersedeBadge('correcting'), 'aq-badge-warning');
}
{
  const links = supersedeLinks([orig, liveCorr]);
  eq('once it is issued the original is replaced', supersedeState(orig, links), 'replaced');
  eq('and that reads as an error', supersedeBadge('replaced'), 'aq-badge-error');
  eq('the correction knows what it is', supersedeState(liveCorr, links), 'correction');
  eq('an ordinary contract is nothing in particular',
    supersedeState(ct({ id: 'z' }), links), 'none');
  eq('and wears no pill', supersedeLabel('none'), '');
}

// A VOID correction replaced nothing and frees the slot - the same rule the
// partial unique index in 116 uses.
{
  const links = supersedeLinks([orig, ct({ id: 'v', of: 'a', status: 'void', no: 'AQ-2026-0002' })]);
  eq('a withdrawn correction leaves the original alone', supersedeState(orig, links), 'none');
  eq('and cannot block a new one', cannotSupersede(orig, links), null);
}

/* -- 4. what the screen says --------------------------------------- */

{
  const links = supersedeLinks([orig, liveCorr]);
  eq('the replaced one names its replacement and why',
    supersedeNote(orig, links), 'Replaced by AQ-2026-0009 - the fee was wrong');
  eq('the correction names what it corrects',
    supersedeNote(liveCorr, links), 'Corrects AQ-2026-0001 - the fee was wrong');
  eq('an ordinary contract has nothing to say', supersedeNote(ct({ id: 'z' }), links), null);
}
{
  const links = supersedeLinks([orig, draftCorr]);
  ok('an in-progress correction says it is still a draft',
    (supersedeNote(orig, links) ?? '').includes('draft'));
}
// A correction whose original is not on this page still reads sensibly.
eq('a correction with its original off-screen still reads',
  supersedeNote(ct({ id: 'b', of: 'zz' }), supersedeLinks([ct({ id: 'b', of: 'zz' })])),
  'Corrects an earlier contract - the fee was wrong');
eq('a numbered contract is named by its number', nameOf(orig), 'AQ-2026-0001');
eq('an unnumbered one by its title', nameOf(ct({ id: 'b', title: 'Rawad UGC', no: null })), 'Rawad UGC');

/* -- 5. never offer what the database will refuse ------------------- */
//
// Each of these is also enforced in migration 116. The point of having them
// here too is that a disabled button can say WHY.

const none = supersedeLinks([]);
ok('a draft cannot be corrected - it can just be edited',
  (cannotSupersede(ct({ id: 'a', status: 'draft' }), none) ?? '').includes('edit it'));
// Built by hand rather than through ct(), whose default would quietly turn a
// null status into 'issued' and test the opposite of what this line says.
ok('nor can a contract with no status yet',
  cannotSupersede({ id: 'a', status: null }, none) !== null);
ok('a withdrawn contract has nothing to correct',
  (cannotSupersede(ct({ id: 'a', status: 'void' }), none) ?? '').includes('withdrawn'));
eq('an issued one can', cannotSupersede(ct({ id: 'a', status: 'issued' }), none), null);
eq('and so can a signed one', cannotSupersede(ct({ id: 'a', status: 'signed' }), none), null);
{
  const links = supersedeLinks([orig, liveCorr]);
  ok('an already-replaced contract points at its replacement instead',
    (cannotSupersede(orig, links) ?? '').includes('AQ-2026-0009'));
}
{
  const links = supersedeLinks([orig, draftCorr]);
  ok('a correction already open must be finished or dropped first',
    (cannotSupersede(orig, links) ?? '').includes('Finish or delete'));
}

/* -- 6. the reason is required, and has to be one ------------------- */

ok('nothing is not a reason', validateSupersedeReason('') !== null);
ok('whitespace is not a reason', validateSupersedeReason('    ') !== null);
ok('"fix" is not a reason', validateSupersedeReason('fix') !== null);
eq('a sentence is', validateSupersedeReason('the fee was wrong'), null);
eq('exactly the minimum is enough', validateSupersedeReason('a'.repeat(REASON_MIN)), null);
ok('one short of it is not', validateSupersedeReason('a'.repeat(REASON_MIN - 1)) !== null);
eq('the maximum is allowed', validateSupersedeReason('a'.repeat(REASON_MAX)), null);
ok('an essay is not', validateSupersedeReason('a'.repeat(REASON_MAX + 1)) !== null);

/* -- 7. what the correction starts from ----------------------------- */

eq('the correction is named after the original', correctionTitle('Rawad UGC'), 'Rawad UGC (corrected)');
eq('correcting a correction does not stack the word',
  correctionTitle('Rawad UGC (corrected)'), 'Rawad UGC (corrected)');
eq('an untitled original still gets a title', correctionTitle(''), 'Contract (corrected)');

{
  const from = {
    fee: '12,500 SAR', influencer: 'Rawad',
    [OPT_OFF_KEY]: 'k2,k7', __aq_table_b9: '[["a","b"]]',
    id: 'AQ-2026-0001', [FINGERPRINT_KEY]: 'abc', [ISSUED_AT_KEY]: '2026-02-01T00:00:00Z',
  };
  const to = carriedValues(from);
  eq('the ordinary values carry', to.fee, '12,500 SAR');
  eq('the switched-off clauses carry, so nothing silently comes back', to[OPT_OFF_KEY], 'k2,k7');
  eq('the table rows carry', to.__aq_table_b9, '[["a","b"]]');
  ok('the original number does NOT', !('id' in to));
  ok('nor its fingerprint', !(FINGERPRINT_KEY in to));
  ok('nor when it was issued', !(ISSUED_AT_KEY in to));
  eq('and that is exactly three things dropped',
    Object.keys(from).length - Object.keys(to).length, SEAL_KEYS.length);
  eq('nothing in is nothing out', carriedValues({}), {});
}

/* -- 8. the chain --------------------------------------------------- */

{
  const a = ct({ id: 'a', no: 'AQ-0001' });
  const b = ct({ id: 'b', no: 'AQ-0002', of: 'a' });
  const c = ct({ id: 'c', no: 'AQ-0003', of: 'b' });
  const all = [c, a, b];
  eq('the chain reads oldest first, whatever order the rows arrived in',
    supersedeChain(all, 'b').map((x) => x.id), ['a', 'b', 'c']);
  eq('from the end it is the same chain', supersedeChain(all, 'c').map((x) => x.id), ['a', 'b', 'c']);
  eq('from the start too', supersedeChain(all, 'a').map((x) => x.id), ['a', 'b', 'c']);
  eq('a lone contract is a chain of one', supersedeChain([a], 'a').map((x) => x.id), ['a']);
  eq('an id that is not here is no chain', supersedeChain(all, 'zz'), []);
  // 116 makes a cycle unconstructible; the screen still must not hang on one.
  const x = ct({ id: 'x', of: 'y' }), y = ct({ id: 'y', of: 'x' });
  ok('a cycle in bad data terminates', supersedeChain([x, y], 'x').length <= 3);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
