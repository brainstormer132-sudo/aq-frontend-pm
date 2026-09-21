/**
 * Reading a Word file into template blocks.
 *
 * The fixtures below are WordprocessingML written by hand, in ASCII, because
 * the real agreement is 86,000 characters of Arabic and could not live in a
 * test file this repo can paste. They are not simplified, though: every shape
 * here was taken from what the real file actually contains - a placeholder
 * split across five runs, a heading whose trailing space is not bold, a
 * standalone {{ id }} above the title, a signing line drawn with underscores.
 * Each of those is a bug this parser had before the fixture existed.
 */
import {
  zipEntries, entryBytes, paraText, boldShare, docxParagraphs, docxTables,
  docxToBlocks, usedPlaceholders, summarise, isSigningRule, splitSignatories,
} from '../.test-build/legal-docx.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const doc = (inner) => `<?xml version="1.0"?><w:document><w:body>${inner}</w:body></w:document>`;
const run = (t, bold) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t>${t}</w:t></w:r>`;
const para = (runs, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;

/* -- the zip ----------------------------------------------------------- */

// A real .docx, byte for byte, is the only honest fixture for the container.
// This is a minimal STORED (uncompressed) zip holding one file, so the reader
// is exercised without needing to deflate anything.
function storedZip(name, body) {
  const enc = new TextEncoder();
  const n = enc.encode(name), b = enc.encode(body);
  const put = (arr, at, ...bytes) => bytes.forEach((v, i) => { arr[at + i] = v; });
  const le16 = (v) => [v & 255, (v >> 8) & 255];
  const le32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  const local = [...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
    ...le32(0), ...le32(b.length), ...le32(b.length), ...le16(n.length), ...le16(0)];
  const dataAt = local.length + n.length;
  const cen = [...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(0),
    ...le16(0), ...le16(0), ...le32(0), ...le32(b.length), ...le32(b.length),
    ...le16(n.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(0)];
  const cenAt = dataAt + b.length;
  const eocd = [...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(1), ...le16(1),
    ...le32(cen.length + n.length), ...le32(cenAt), ...le16(0)];
  const total = cenAt + cen.length + n.length + eocd.length;
  const out = new Uint8Array(total);
  put(out, 0, ...local); out.set(n, local.length); out.set(b, dataAt);
  put(out, cenAt, ...cen); out.set(n, cenAt + cen.length);
  put(out, cenAt + cen.length + n.length, ...eocd);
  return out;
}
{
  const z = storedZip('word/document.xml', '<w:document/>');
  const es = zipEntries(z);
  eq('one entry found', es.length, 1);
  eq('and it is named', es[0].name, 'word/document.xml');
  eq('stored, not deflated', es[0].method, 0);
  eq('its bytes come back', new TextDecoder().decode(entryBytes(z, es[0])), '<w:document/>');
  // Not an error, an empty list: an upload that is not a zip at all must be
  // reported to the person, not thrown at them from inside a byte loop.
  eq('junk is no entries', zipEntries(new Uint8Array([1, 2, 3, 4, 5])).length, 0);
  eq('empty is no entries', zipEntries(new Uint8Array(0)).length, 0);
}

/* -- a paragraph's text ------------------------------------------------ */

// THE bug this parser had. Word splits a word wherever anything changes, so a
// merge field arrives in pieces; matching run by run finds nothing at all.
eq('a placeholder split across five runs is rejoined',
  paraText('<w:r><w:t>{{ </w:t></w:r><w:r><w:t>licen</w:t></w:r><w:r><w:t>se</w:t></w:r>'
    + '<w:r><w:t>_name</w:t></w:r><w:r><w:t> }}</w:t></w:r>'),
  '{{ license_name }}');
eq('a tab becomes a space', paraText('<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r>'), 'a b');
eq('a break becomes a newline', paraText('<w:r><w:t>a</w:t><w:br/><w:t>b</w:t></w:r>'), 'a\nb');
eq('xml entities are decoded',
  paraText('<w:r><w:t>a &amp; b &lt;c&gt; &quot;d&quot;</w:t></w:r>'), 'a & b <c> "d"');
// &amp;lt; is a literal "&lt;", not a less-than sign.
eq('an escaped ampersand does not resurrect an entity',
  paraText('<w:r><w:t>&amp;lt;</w:t></w:r>'), '&lt;');
eq('numeric entities are decoded', paraText('<w:r><w:t>&#65;&#x42;</w:t></w:r>'), 'AB');
eq('xml:space attributes do not break the match',
  paraText('<w:r><w:t xml:space="preserve"> a </w:t></w:r>'), ' a ');
eq('no runs is empty', paraText('<w:p></w:p>'), '');

/* -- how bold a paragraph is ------------------------------------------- */

// Measured in characters. "Every run bold" was the first rule and it was
// wrong: a heading in the real agreement ends with an unbold space, and came
// out as a paragraph because of it.
eq('all bold is 1', boldShare(run('Heading:', true)), 1);
eq('none bold is 0', boldShare(run('plain', false)), 0);
ok('a heading with one unbold space is still bold',
  boldShare(run('Third: Payment:', true) + run(' ', false)) >= 0.7);
ok('one bold word in a sentence is not a bold paragraph',
  boldShare(run('Note', true) + run(' the rest of a long ordinary sentence here', false)) < 0.7);
eq('empty runs do not count', boldShare(run('', false) + run('abc', true)), 1);
eq('no text at all is 0', boldShare('<w:p></w:p>'), 0);

/* -- paragraphs -------------------------------------------------------- */

{
  const ps = docxParagraphs(doc(
    para(run('Title', false), '<w:jc w:val="center"/>')
    + para(run('Body', false))
    + para(run('Item', false), '<w:numPr><w:ilvl w:val="0"/></w:numPr>')
    + para(run('Styled', false), '<w:pStyle w:val="Heading1"/>'),
  ));
  eq('four paragraphs', ps.length, 4);
  eq('alignment is read', ps[0].align, 'center');
  eq('a list is seen', ps[2].listed, true);
  eq('and a plain paragraph is not', ps[1].listed, false);
  eq('the style is lower-cased', ps[3].style, 'heading1');
  eq('no style is empty', ps[1].style, '');
  eq('runs of spaces survive in raw', docxParagraphs(doc(para(run('a   b', false))))[0].raw, 'a   b');
  eq('and are collapsed in text', docxParagraphs(doc(para(run('a   b', false))))[0].text, 'a b');
}
// A table's paragraphs must not also appear as loose paragraphs.
{
  const xml = doc(para(run('Before', false))
    + '<w:tbl><w:tr><w:tc>' + para(run('Cell', false)) + '</w:tc></w:tr></w:tbl>'
    + para(run('After', false)));
  eq('table paragraphs are not counted twice',
    docxParagraphs(xml).map((p) => p.text), ['Before', 'After']);
}

/* -- tables ------------------------------------------------------------ */

{
  const cell = (t) => `<w:tc>${para(run(t, false))}</w:tc>`;
  const xml = doc('<w:tbl>'
    + `<w:tr>${cell('Influencer')}${cell('Platform')}</w:tr>`
    + `<w:tr>${cell('{{ name_2 }}')}${cell('{{ platform }}')}</w:tr>`
    + '</w:tbl>');
  const ts = docxTables(xml);
  eq('one table', ts.length, 1);
  eq('the first row is the headers', ts[0].headers, ['Influencer', 'Platform']);
  eq('the rest are rows', ts[0].rows, [['{{ name_2 }}', '{{ platform }}']]);
  const b = docxToBlocks(xml).find((x) => x.block_type === 'table');
  eq('columns are keyed by position', b.content.columns.map((c) => c.key), ['col_1', 'col_2']);
  eq('and labelled from the header', b.content.columns.map((c) => c.label), ['Influencer', 'Platform']);
  eq('the row keeps its placeholders', b.content.rows, [{ col_1: '{{ name_2 }}', col_2: '{{ platform }}' }]);
}

/* -- signing lines ----------------------------------------------------- */

ok('a row of underscores is a signing rule', isSigningRule('________   ____________'));
ok('a short dash is not', !isSigningRule('- a'));
ok('a sentence is not', !isSigningRule('Signed by the first party'));
ok('an empty string is not', !isSigningRule(''));
eq('a signing line splits on the gap',
  splitSignatories('First party: Ahmed     Second party:'),
  { right: 'First party: Ahmed', left: 'Second party:' });
eq('two spaces are not a gap', splitSignatories('First party: Ahmed  Second party:'), null);
eq('one side only is not a signing line', splitSignatories('First party:'), null);
eq('three sides is not either', splitSignatories('a     b     c'), null);
eq('blank is not', splitSignatories('   '), null);

/* -- the whole mapping ------------------------------------------------- */

{
  const xml = doc(
    para(run('{{ id }}', false))
    + para(run('Marketing Agreement', false), '<w:jc w:val="center"/>')
    + para(run('This is made between {{ a }} and {{ b }}.', false))
    + para(run('First: the subject:', true))
    + para(run('A point', false), '<w:numPr><w:ilvl w:val="0"/></w:numPr>')
    + para(run('Party one: Ahmed     Party two:', false))
    + para(run('___________     ___________', false)),
  );
  const bs = docxToBlocks(xml);
  eq('the shape that comes out', bs.map((b) => b.block_type),
    ['title', 'p', 'h', 'li', 'sig']);
  eq('the title is the centred line', bs[0].content.text, 'Marketing Agreement');
  // The app stamps its own contract number; a second one on the page is the
  // sort of thing a vendor asks about.
  ok('a lone {{ id }} line is dropped', !bs.some((b) => String(b.content.text ?? '').includes('{{ id }}')));
  eq('the signing line became a sig block', bs[4].content, { right: 'Party one: Ahmed', left: 'Party two:' });
  ok('and the underscores did not survive',
    !bs.some((b) => String(b.content.text ?? '').includes('___')));
  eq('every block says what it was', bs.filter((b) => !b.note).length, 0);
}
{
  // A table between two paragraphs stays between them.
  const xml = doc(para(run('Before', false))
    + '<w:tbl><w:tr><w:tc>' + para(run('H', false)) + '</w:tc></w:tr></w:tbl>'
    + para(run('After', false)));
  eq('a table lands where it was in the document',
    docxToBlocks(xml).map((b) => b.block_type), ['p', 'table', 'p']);
}
{
  // Only a lone placeholder is dropped - one inside a sentence is the point.
  const bs = docxToBlocks(doc(para(run('Paid {{ amount }} on {{ date }}.', false))));
  eq('a placeholder inside a sentence is kept', bs.length, 1);
  eq('with its text', bs[0].content.text, 'Paid {{ amount }} on {{ date }}.');
}
eq('an empty document is no blocks', docxToBlocks(doc('')).length, 0);
eq('junk xml does not throw', docxToBlocks('not xml at all').length, 0);

/* -- the fields -------------------------------------------------------- */

{
  const bs = docxToBlocks(doc(
    para(run('{{ b }} then {{ a }} then {{ b }} again', false))
    + '<w:tbl><w:tr><w:tc>' + para(run('{{ c }}', false)) + '</w:tc></w:tr>'
    + '<w:tr><w:tc>' + para(run('{{ d }}', false)) + '</w:tc></w:tr></w:tbl>',
  ));
  // First-appearance order: the review screen is read alongside the document.
  eq('fields come back in the order they appear', usedPlaceholders(bs), ['b', 'a', 'c', 'd']);
  eq('no fields is an empty list', usedPlaceholders([]), []);
  eq('a field with a digit in it is found',
    usedPlaceholders(docxToBlocks(doc(para(run('{{ name_2 }}', false) + run(' x', false))))), ['name_2']);
  eq('a field cannot start with a digit',
    usedPlaceholders(docxToBlocks(doc(para(run('{{ 2bad }} x', false))))), []);
  eq('spacing inside the braces does not matter',
    usedPlaceholders(docxToBlocks(doc(para(run('{{x}} and {{  y  }} z', false))))), ['x', 'y']);
}

/* -- what the screen says ---------------------------------------------- */

{
  const s = summarise(docxToBlocks(doc(
    para(run('T', false), '<w:jc w:val="center"/>')
    + para(run('Body {{ a }}', false))
    + para(run('First:', true)),
  )));
  eq('it counts the blocks', s.blocks, 3);
  eq('and the headings', s.headings, 1);
  eq('and names the title', s.title, 'T');
  eq('and lists the fields', s.placeholders, ['a']);
  eq('nothing to warn about', s.warnings, []);
}
{
  const s = summarise([]);
  ok('an empty import says so', s.warnings.some((w) => w.includes('Nothing came out')));
}
{
  const s = summarise(docxToBlocks(doc(para(run('Just a line', false)))));
  ok('no title is called out', s.warnings.some((w) => w.includes('No title')));
  ok('no fields is called out', s.warnings.some((w) => w.includes('{{ fields }}')));
}
{
  const s = summarise(docxToBlocks(doc(
    para(run('T', false), '<w:jc w:val="center"/>')
    + para(run(`x {{ a }} ${'y '.repeat(900)}`, false)))));
  ok('a runaway paragraph is called out', s.warnings.some((w) => w.includes('very long')));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
