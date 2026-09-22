/**
 * The template editor as a document.
 *
 * What is worth protecting:
 *
 *   1. SECTIONS ARE THE CONTRACT'S OWN STRUCTURE. A heading owns everything
 *      under it. Get that wrong and a clause appears under the wrong section
 *      heading, which on a contract means it says something else.
 *   2. MOVING A SECTION MOVES ALL OF IT. The whole point is that nine blocks
 *      and one decision stop being nine decisions.
 *   3. THE OPENING IS ANCHORED. The title and the parties cannot end up in
 *      the middle of the document.
 *   4. A LINE DOES NOT DRIFT OUT FROM UNDER ITS HEADING.
 *   5. NOTHING IS LOST. Every reorder returns exactly the blocks it was given.
 */
import {
  documentSections, sectionSummary, moveSection, moveLine, OPENING_TITLE,
  inlineParts, INSERT_KINDS, lineKindLabel,
  publishWarning, newDraftWarning, editTemplateWarning, unknownFieldsNote, cannotPublish,
} from '../.test-build/legal-doc-view.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

let n = 0;
const blk = (type, text, id) => ({
  id: id ?? `b${++n}`, version_id: 'v', workspace_id: 'w', position: n,
  block_type: type, content: { text }, optional: false,
});
const ids = (bs) => bs.map((b) => b.id);

/* -- 1. sections ---------------------------------------------------- */

{
  // The shape of the real UGC contract: a title, a date line and the parties,
  // then numbered sections.
  const doc = [
    blk('title', 'Marketing agreement', 't'),
    blk('p', 'On this date...', 'p1'),
    blk('p', 'First party...', 'p2'),
    blk('h', 'First: the preamble', 'h1'),
    blk('p', 'The preamble is part of this agreement.', 'p3'),
    blk('h', 'Second: the subject', 'h2'),
    blk('p', 'The parties agree...', 'p4'),
    blk('li', 'One bullet', 'l1'),
  ];
  const secs = documentSections(doc);
  eq('three sections: the opening and two headings', secs.length, 3);
  eq('the opening has no heading of its own', secs[0].headingId, '');
  eq('and says so', secs[0].title, OPENING_TITLE);
  eq('the opening holds everything before the first heading',
    ids(secs[0].blocks), ['t', 'p1', 'p2']);
  eq('a section is named by its heading', secs[1].title, 'First: the preamble');
  eq('and owns the heading plus what follows', ids(secs[1].blocks), ['h1', 'p3']);
  eq('up to the next heading, not past it', ids(secs[2].blocks), ['h2', 'p4', 'l1']);
  // The count that matters: 42 rows became 7 sections on the real contract.
  eq('every block is in exactly one section',
    secs.reduce((a, s) => a + s.blocks.length, 0), doc.length);

  eq('the collapsed row counts lines, not the heading', sectionSummary(secs[1]), '1 line');
  eq('and pluralises', sectionSummary(secs[2]), '2 lines');
  eq('the opening counts all of its own', sectionSummary(secs[0]), '3 lines');
}

eq('a document with no headings is one opening section',
  documentSections([blk('p', 'x', 'a'), blk('p', 'y', 'b')]).map((s) => s.headingId), ['']);
eq('a document that starts with a heading has no opening section',
  documentSections([blk('h', 'One', 'h'), blk('p', 'x', 'a')]).map((s) => s.title), ['One']);
eq('an empty document has no sections', documentSections([]), []);
eq('a heading with no words still gets a name',
  documentSections([blk('h', '   ', 'h')])[0].title, 'Untitled section');

/* -- 2 and 3. moving a whole section -------------------------------- */

{
  const doc = [
    blk('p', 'parties', 'open'),
    blk('h', 'A', 'ha'), blk('p', 'a1', 'a1'), blk('p', 'a2', 'a2'),
    blk('h', 'B', 'hb'), blk('p', 'b1', 'b1'),
    blk('h', 'C', 'hc'), blk('p', 'c1', 'c1'),
  ];
  // Sections are [opening, A, B, C]. Moving B up puts it before A - and takes
  // its whole body with it, which is the entire point.
  eq('a section moves with everything under it',
    ids(moveSection(doc, 2, -1)),
    ['open', 'hb', 'b1', 'ha', 'a1', 'a2', 'hc', 'c1']);
  eq('and downward too',
    ids(moveSection(doc, 1, 1)),
    ['open', 'hb', 'b1', 'ha', 'a1', 'a2', 'hc', 'c1']);
  eq('nothing is lost', moveSection(doc, 2, -1).length, doc.length);
  eq('moving does not mutate the input', ids(doc)[1], 'ha');

  // THE ANCHOR: the title and the parties stay at the top.
  ok('the opening cannot be moved down', moveSection(doc, 0, 1) === doc);
  ok('and nothing can be moved above it', moveSection(doc, 1, -1) === doc);
  ok('the last section cannot move down', moveSection(doc, 3, 1) === doc);
  ok('an index off the end is refused', moveSection(doc, 9, -1) === doc);
  ok('and a negative one', moveSection(doc, -1, 1) === doc);
}

/* -- 4. moving one line --------------------------------------------- */

{
  const doc = [
    blk('h', 'A', 'ha'), blk('p', 'a1', 'a1'), blk('p', 'a2', 'a2'), blk('p', 'a3', 'a3'),
    blk('h', 'B', 'hb'), blk('p', 'b1', 'b1'),
  ];
  eq('a line moves within its section',
    ids(moveLine(doc, 'a3', -1)), ['ha', 'a1', 'a3', 'a2', 'hb', 'b1']);
  eq('and back', ids(moveLine(doc, 'a1', 1)), ['ha', 'a2', 'a1', 'a3', 'hb', 'b1']);
  eq('nothing is lost', moveLine(doc, 'a3', -1).length, doc.length);

  // A paragraph that drifts out from under its heading has silently changed
  // which clause it belongs to. That is a section move, not a line move.
  ok('the first line cannot climb above its heading', moveLine(doc, 'a1', -1) === doc);
  ok('the last line cannot fall into the next section', moveLine(doc, 'a3', 1) === doc);
  ok('the first line of the next section cannot climb back', moveLine(doc, 'b1', -1) === doc);
  // Moving a heading IS moving its section, so this does nothing.
  ok('a heading does not move as a line', moveLine(doc, 'ha', 1) === doc);
  ok('an id nobody has is refused', moveLine(doc, 'nope', 1) === doc);
}
{
  // The opening run has no heading, so all of it is movable.
  const doc = [blk('p', 'x', 'o1'), blk('p', 'y', 'o2'), blk('h', 'A', 'ha')];
  eq('the opening lines move among themselves',
    ids(moveLine(doc, 'o1', 1)), ['o2', 'o1', 'ha']);
  ok('and not into the first section', moveLine(doc, 'o2', 1) === doc);
}

/* -- fields with a human label -------------------------------------- */

{
  const labels = new Map([
    ['license_number', 'Media licence number'],
    ['Amount_full', 'Amount'],
  ]);
  const ps = inlineParts('Licence ( {{ license_number }} ) for {{ Amount_full }}.', labels);
  eq('the literal runs survive', ps.filter((p) => !p.field).map((p) => p.text),
    ['Licence ( ', ' ) for ', '.']);
  eq('a field carries its key', ps[1].field, 'license_number');
  eq('and its human label', ps[1].label, 'Media licence number');
  eq('and the raw text it stands for', ps[1].text, '{{ license_number }}');
  eq('rejoining the parts gives back exactly the line',
    ps.map((p) => p.text).join(''), 'Licence ( {{ license_number }} ) for {{ Amount_full }}.');
  ok('a known field is not flagged', !ps[1].unknown);
}
{
  // The typo case, which is the one that blocks Publish.
  const ps = inlineParts('Hello {{ notafield }}', new Map());
  eq('an unregistered key falls back to the key itself', ps[1].label, 'notafield');
  ok('and is flagged', ps[1].unknown === true);
}
eq('a line with no fields is one literal run',
  inlineParts('Just words.', new Map()).map((p) => p.text), ['Just words.']);
eq('a line that is only a field has no literal runs',
  inlineParts('{{ id }}', new Map()).length, 1);
eq('an empty line is no runs', inlineParts('', new Map()), []);
eq('nothing at all does not crash', inlineParts(null, null), []);
eq('loose spacing inside the braces still reads',
  inlineParts('{{id}}', new Map([['id', 'Number']]))[0].label, 'Number');
// Two fields in a row, with nothing between them - the run-joining edge.
eq('adjacent fields both parse',
  inlineParts('{{ a }}{{ b }}', new Map()).map((p) => p.field), ['a', 'b']);

/* -- plain words ----------------------------------------------------- */

eq('four things to insert, not seven', INSERT_KINDS.length, 4);
eq('and they are the ones a person would name',
  INSERT_KINDS.map((k) => k.key), ['h', 'p', 'li', 'kv']);
ok('the document title is not offered again',
  !INSERT_KINDS.some((k) => k.key === 'title'));
eq('kv is called what it is', lineKindLabel('kv'), 'Detail line');
eq('sig too', lineKindLabel('sig'), 'Signatures');
eq('and a type nobody recognises still gets a word', lineKindLabel('zzz'), 'Line');
eq('and so does nothing at all', lineKindLabel(null), 'Line');

/* -- the two irreversible moments ------------------------------------ */

{
  const w = publishWarning(3, 42);
  ok('publish names the version', w.includes('version 3'));
  ok('and counts what freezes', w.includes('42 lines'));
  ok('and says it is permanent', w.includes('never be edited again'));
  ok('one line reads in the singular', publishWarning(1, 1).includes('1 line freeze'));
}
{
  // The one that already bit: a quiet click took version 3 and turned a
  // written-for-v3 seed into a permanent no-op.
  const w = newDraftWarning(3);
  ok('it names the version it will create', w.includes('version 4'));
  ok('and promises the old one is untouched', w.includes('stays exactly as it is'));
  ok('and that issued contracts are safe', w.includes('untouched'));
}
{
  // The Edit button on a contract's preview goes somewhere else and changes
  // something else. Three facts, and all three have to be in the sentence -
  // "it does not change this contract" is the one people assume backwards.
  const w = editTemplateWarning('UGC vendor contract');
  ok('it names the template', w.includes('UGC vendor contract'));
  ok('and says this contract is untouched', w.includes('keeps the version it was made from'));
  ok('and that the ones already raised are too', w.includes('already raised'));
  ok('and that editing means a new version', w.includes('starts a new version'));
  ok('and that only later contracts get it', w.includes('after you publish'));
  ok('no name still asks a whole question', editTemplateWarning('').startsWith('Open the template'));
  ok('and so does no name at all', editTemplateWarning(null).includes('the template'));
}

eq('nothing missing says nothing', unknownFieldsNote([]), '');
eq('and neither does nothing at all', unknownFieldsNote(null), '');
{
  const s = unknownFieldsNote(['foo']);
  ok('one missing field reads in the singular', s.includes('1 field') && s.includes('is not defined'));
  ok('and names it', s.includes('foo'));
  ok('and says where to fix it', s.includes('Fields'));
}
{
  // Group before you cap, per the standing rule: a template with thirty typos
  // is not thirty lines on the screen.
  const s = unknownFieldsNote(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  ok('seven missing fields say seven', s.includes('7 fields'));
  ok('and list the first five', s.includes('a, b, c, d, e'));
  ok('and count the rest', s.includes('and 2 more'));
  ok('without listing them', !s.includes('f,'));
}

eq('a publishable draft says nothing', cannotPublish(42, [], true), '');
eq('a published version says so', cannotPublish(42, [], false), 'This version is already published.');
ok('an empty draft asks for content', cannotPublish(0, [], true).includes('Add something'));
ok('a missing field blocks it with a reason',
  cannotPublish(42, ['x'], true).includes('1 missing field'));
ok('and pluralises', cannotPublish(42, ['x', 'y'], true).includes('2 missing fields'));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
