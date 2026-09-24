import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
  EDITOR_BLOCK_TYPES, blockTypeLabel, isEditableBlockType, defaultBlockContent,
  blockText, blockKV, blockSig, moveItem, withPositions, nextPosition, canPublish,
  hasRTLChars, blockAllText, detectDir,
  parsePlaceholderKeys, usedPlaceholderKeys, unknownPlaceholders, validatePlaceholderKey, fillPlaceholders,
  fillPlaceholdersHtml, fingerprintCaption,
  printDocTitle,
  DEPTS, deptLabel, validateListValue, sortListValues,
  FIELD_TYPES, fieldTypeLabel, validateFieldDef, describeField,
  CONTRACT_STATUSES, contractStatusLabel, contractStatusBadge, contractEditable,
  fillFieldsForBlocks, validateFieldValue, contractReady, seedContractValues,
  escapeHtml, contractPrintHTML,
  contractCanonical, formatFingerprint, FINGERPRINT_KEY, ISSUED_AT_KEY,
  OPT_OFF_KEY, isOptionalBlock, parseOffIds, serializeOffIds, visibleBlocks,
  dateAlertState, contractDateAlerts, hasBlockingAlert, dateAlertLabel,
  TABLE_KEY_PREFIX, tableKey, tableColumns, tableColumnFields, parseTableRows, serializeTableRows, emptyTableRow,
  tableRowSource, tableFieldRow, tableRowsFor, fillSegments, batchProgress,
  tableHasInvalidCell,
  optionalGroups, optionalGroupOn, toggleOptionalGroup, clauseChoiceSummary,
  previewRows,
  isArchivedTemplate, splitTemplates, withoutArchived, archivedNote,
  archivedToggleLabel, archiveConfirm,
  bulletText, BULLET, shortContractId, printCss,
  recoveryLabel, recoveryUrgent, RECOVERY_URGENT_DAYS, taskReference,
  cappedList, LIST_SHOW_MAX,
  APPROVAL_EXEMPT_KEYS, changeClearsApproval, cannotIssue, canApprove, approvalNote,
  printApproval, approvalCaption,
} from '../.test-build/legal.js';
import { amountInWords } from '../.test-build/legal-amount.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

// kinds - the six the upload popup offers, in the order it offers them.
eq('six kinds, the influencer agreement first', DOC_KINDS.map((d) => d.key),
  ['vendor_contract', 'client_contract', 'nda', 'letter', 'model', 'other']);
eq('kindLabel known', kindLabel('nda'), 'NDA');
eq('kindLabel unknown -> Other', kindLabel('zzz'), 'Other');
// vendor_contract IS the influencer/UGC agreement. The key stayed - renaming
// it would rewrite every template, every stamped contract and the seeds - and
// only the label changed, which is the part anybody sees.
eq('the vendor key reads as what it actually is',
  kindLabel('vendor_contract'), 'Influencer / UGC agreement');
eq('the two kinds migration 115 added are here',
  DOC_KINDS.filter((d) => d.key === 'letter' || d.key === 'model').map((d) => d.label),
  ['Letter', 'Model release']);
eq('every kind has a label', DOC_KINDS.filter((d) => !d.label).length, 0);
eq('and every key is unique', new Set(DOC_KINDS.map((d) => d.key)).size, DOC_KINDS.length);

// status
eq('draft label', statusLabel('draft'), 'Draft');
eq('null status label', statusLabel(null), 'No version');
eq('published badge is success', statusBadge('published'), 'aq-badge-success');
eq('draft badge is warning', statusBadge('draft'), 'aq-badge-warning');
eq('archived badge muted', statusBadge('archived'), 'aq-badge-muted');

// grouping
const t = (id, kind, name) => ({ id, doc_kind: kind, name });
{
  const rows = [
    t('1', 'nda', 'Beta'), t('2', 'vendor_contract', 'Zeta'),
    t('3', 'nda', 'Alpha'), t('4', 'vendor_contract', 'Amir'),
  ];
  const g = groupTemplatesByKind(rows);
  eq('kinds in DOC_KINDS order, empties dropped', g.map((x) => x.key), ['vendor_contract', 'nda']);
  eq('sorted by name within a kind', g[0].items.map((x) => x.name), ['Amir', 'Zeta']);
  eq('nda sorted', g[1].items.map((x) => x.name), ['Alpha', 'Beta']);
}
eq('no rows -> no groups', groupTemplatesByKind([]), []);
{
  const rows = [t('1', 'nda', 'X')];
  const before = JSON.stringify(rows);
  groupTemplatesByKind(rows);
  ok('does not mutate input', JSON.stringify(rows) === before);
}

// validation
eq('blank name rejected', validateNewTemplate('   ', 'nda'), 'A template needs a name.');
eq('unknown kind rejected', validateNewTemplate('X', 'bogus'), 'Pick a document type.');
eq('valid -> null', validateNewTemplate('Standard NDA', 'nda'), null);

// ---- blocks ----
eq('seven editor block types', EDITOR_BLOCK_TYPES.map((b) => b.key), ['title', 'h', 'p', 'li', 'kv', 'table', 'sig']);
eq('block type label', blockTypeLabel('kv'), 'Field');
eq('table block type label', blockTypeLabel('table'), 'Table');
eq('unknown block type label is itself', blockTypeLabel('clause'), 'clause');
ok('kv is editable', isEditableBlockType('kv'));
ok('clause is not editable', !isEditableBlockType('clause'));
eq('default text content', defaultBlockContent('p'), { text: '' });
eq('default kv content', defaultBlockContent('kv'), { label: '', value: '' });
eq('default table content', defaultBlockContent('table'), { columns: [] });

eq('blockText reads text', blockText({ content: { text: 'hi' } }), 'hi');
eq('blockText missing -> empty', blockText({ content: {} }), '');
eq('blockText non-string -> empty', blockText({ content: { text: 5 } }), '');
eq('blockKV reads pair', blockKV({ content: { label: 'Term', value: '12m' } }), { label: 'Term', value: '12m' });
eq('blockKV missing -> empties', blockKV({ content: {} }), { label: '', value: '' });

// moveItem
{
  const a = ['x', 'y', 'z'];
  eq('move middle up', moveItem(a, 1, -1), ['y', 'x', 'z']);
  eq('move middle down', moveItem(a, 1, 1), ['x', 'z', 'y']);
  eq('first up is a no-op (same ref)', moveItem(a, 0, -1), a);
  eq('last down is a no-op (same ref)', moveItem(a, 2, 1), a);
  ok('moveItem does not mutate', JSON.stringify(a) === JSON.stringify(['x', 'y', 'z']));
}

// withPositions
{
  const blocks = [{ position: 5, id: 'a' }, { position: 2, id: 'b' }, { position: 9, id: 'c' }];
  eq('withPositions stamps index', withPositions(blocks).map((b) => b.position), [0, 1, 2]);
  const already = [{ position: 0 }, { position: 1 }];
  ok('withPositions keeps same-ref when unchanged', withPositions(already)[0] === already[0]);
}

// nextPosition
eq('nextPosition empty -> 0', nextPosition([]), 0);
eq('nextPosition -> max+1', nextPosition([{ position: 0 }, { position: 3 }, { position: 1 }]), 4);

// canPublish
ok('cannot publish empty', !canPublish([]));
ok('can publish with a block', canPublish([{}]));

// direction
ok('arabic is rtl', hasRTLChars('\u0645\u0631\u062d\u0628\u0627'));
ok('latin is not rtl', !hasRTLChars('hello world'));
ok('mixed with arabic is rtl', hasRTLChars('hello \u0645\u0631\u062d\u0628\u0627'));
ok('digits/punctuation not rtl', !hasRTLChars('12,500.00 - (SAR)'));
eq('blockAllText joins text', blockAllText({ content: { text: 'hi' } }), 'hi');
eq('blockAllText joins kv', blockAllText({ content: { label: 'Term', value: '12m' } }), 'Term 12m');
{
  const tb = (t) => ({ content: { text: t } });
  eq('empty -> ltr', detectDir([]), 'ltr');
  eq('all latin -> ltr', detectDir([tb('Agreement'), tb('Between the parties')]), 'ltr');
  eq('majority arabic -> rtl', detectDir([tb('\u0627\u0644\u0639\u0642\u062f'), tb('\u0627\u0644\u0637\u0631\u0641'), tb('note')]), 'rtl');
  eq('tie -> ltr', detectDir([tb('\u0627\u0644\u0639\u0642\u062f'), tb('note')]), 'ltr');
  eq('blanks ignored', detectDir([tb(''), tb('\u0627\u0644\u0639\u0642\u062f')]), 'rtl');
}

// placeholders
eq('parse none', parsePlaceholderKeys('plain text'), []);
eq('parse with spaces', parsePlaceholderKeys('Amount: {{ Amount_full }}'), ['Amount_full']);
eq('parse tight braces', parsePlaceholderKeys('{{id}} and {{ name_2 }}'), ['id', 'name_2']);
eq('parse repeats in order', parsePlaceholderKeys('{{ a }} {{ b }} {{ a }}'), ['a', 'b', 'a']);
{
  const B = (text) => ({ content: { text } });
  const kv = (label, value) => ({ content: { label, value } });
  eq('used keys distinct + sorted', usedPlaceholderKeys([B('{{ b }}'), B('{{ a }} {{ b }}'), kv('x', '{{ iban }}')]), ['a', 'b', 'iban']);
}
eq('unknown finds typos', unknownPlaceholders(['brand_name', 'Amount_ful'], ['brand_name', 'Amount_full']), ['Amount_ful']);
eq('unknown none when all registered', unknownPlaceholders(['a', 'b'], ['a', 'b', 'c']), []);
eq('key blank rejected', validatePlaceholderKey('  '), 'A field needs a key.');
eq('key with space rejected', validatePlaceholderKey('brand name'), 'Use letters, numbers and underscores only (no spaces).');
eq('key valid -> null', validatePlaceholderKey('Amount_full'), null);
eq('fill replaces known', fillPlaceholders('Owed {{ Amount_full }} to {{ name_2 }}', { Amount_full: '12,500', name_2: 'Rawad' }), 'Owed 12,500 to Rawad');
eq('fill keeps missing literal', fillPlaceholders('IBAN {{ iban }}', {}), 'IBAN {{ iban }}');
eq('fill empty string value', fillPlaceholders('x {{ a }} y', { a: '' }), 'x  y');

// managed lists
eq('four depts, legal first', DEPTS.map((d) => d.key), ['legal', 'finance', 'operations', 'admin']);
eq('deptLabel known', deptLabel('operations'), 'Operations');
eq('deptLabel unknown is itself', deptLabel('zzz'), 'zzz');
eq('empty value rejected', validateListValue('  '), 'A value cannot be empty.');
eq('value ok -> null', validateListValue('snapchat'), null);
{
  const v = (position, value) => ({ position, value });
  const rows = [v(2, 'b'), v(0, 'z'), v(0, 'a'), v(1, 'm')];
  eq('sorted by position then value', sortListValues(rows).map((x) => x.value), ['a', 'z', 'm', 'b']);
  const before = JSON.stringify(rows);
  sortListValues(rows);
  ok('sortListValues does not mutate', JSON.stringify(rows) === before);
}

// typed fields
eq('five field types', FIELD_TYPES.map((f) => f.key), ['text', 'number', 'date', 'list', 'auto']);
eq('fieldTypeLabel known', fieldTypeLabel('list'), 'List');
eq('fieldTypeLabel unknown is itself', fieldTypeLabel('zzz'), 'zzz');
eq('list without list_id rejected', validateFieldDef({ field_type: 'list', list_id: null }), 'Pick a list for a list field.');
eq('list with list_id ok', validateFieldDef({ field_type: 'list', list_id: 'abc' }), null);
eq('number min>max rejected', validateFieldDef({ field_type: 'number', num_min: 10, num_max: 5 }), 'The minimum cannot exceed the maximum.');
eq('number min<=max ok', validateFieldDef({ field_type: 'number', num_min: 0, num_max: 10 }), null);
eq('number open range ok', validateFieldDef({ field_type: 'number', num_min: null, num_max: null }), null);
eq('text always ok', validateFieldDef({ field_type: 'text' }), null);
{
  const lists = [{ id: 'l1', name: 'Platforms' }];
  eq('describe list with name', describeField({ field_type: 'list', list_id: 'l1' }, lists), 'List: Platforms');
  eq('describe list missing', describeField({ field_type: 'list', list_id: 'x' }, lists), 'List (none set)');
  eq('describe number range', describeField({ field_type: 'number', num_min: 0, num_max: 10 }, lists), 'Number 0-10');
  eq('describe number open', describeField({ field_type: 'number', num_min: null, num_max: null }, lists), 'Number');
  eq('describe required text', describeField({ field_type: 'text', required: true }, lists), 'Text \u00b7 required');
}

// ---- contracts ----
eq('four contract statuses', CONTRACT_STATUSES.map((s) => s.key), ['draft', 'issued', 'signed', 'void']);
eq('status label issued', contractStatusLabel('issued'), 'Issued');
eq('status label blank -> Draft', contractStatusLabel(null), 'Draft');
eq('status label unknown -> Draft', contractStatusLabel('zzz'), 'Draft');
eq('signed badge success', contractStatusBadge('signed'), 'aq-badge-success');
eq('issued badge info', contractStatusBadge('issued'), 'aq-badge-info');
eq('void badge muted', contractStatusBadge('void'), 'aq-badge-muted');
eq('draft badge warning', contractStatusBadge('draft'), 'aq-badge-warning');
ok('draft is editable', contractEditable('draft'));
ok('null is editable', contractEditable(null));
ok('issued not editable', !contractEditable('issued'));
ok('signed not editable', !contractEditable('signed'));

// fillFieldsForBlocks - used keys resolved in first-appearance order
{
  const B = (text) => ({ content: { text } });
  const kv = (label, value) => ({ content: { label, value } });
  const P = (key, extra = {}) => ({ id: key, key, label: key, field_type: 'text', required: false, default_value: '', num_min: null, num_max: null, list_id: null, owner_dept: 'legal', ...extra });
  const reg = [P('iban'), P('brand_name'), P('amount', { field_type: 'number' })];
  const blocks = [B('Party {{ brand_name }}'), kv('Amount', '{{ amount }}'), B('{{ brand_name }} again'), B('IBAN {{ iban }}')];
  eq('fill fields in first-appearance order', fillFieldsForBlocks(blocks, reg).map((f) => f.key), ['brand_name', 'amount', 'iban']);
  eq('unknown keys dropped', fillFieldsForBlocks([B('{{ ghost }} {{ iban }}')], reg).map((f) => f.key), ['iban']);
  eq('no placeholders -> empty', fillFieldsForBlocks([B('plain')], reg), []);
}

// validateFieldValue
{
  const f = (extra) => ({ field_type: 'text', required: false, num_min: null, num_max: null, ...extra });
  eq('optional empty ok', validateFieldValue(f({}), ''), null);
  eq('required empty rejected', validateFieldValue(f({ required: true }), '  '), 'This field is required.');
  eq('required filled ok', validateFieldValue(f({ required: true }), 'Rawad'), null);
  eq('number non-numeric', validateFieldValue(f({ field_type: 'number' }), 'abc'), 'Enter a number.');
  eq('number below min', validateFieldValue(f({ field_type: 'number', num_min: 10 }), '5'), 'Must be at least 10.');
  eq('number above max', validateFieldValue(f({ field_type: 'number', num_max: 100 }), '150'), 'Must be at most 100.');
  eq('number in range ok', validateFieldValue(f({ field_type: 'number', num_min: 0, num_max: 100 }), '50'), null);
  eq('date bad format', validateFieldValue(f({ field_type: 'date' }), '01/02/2026'), 'Pick a date.');
  eq('date ok', validateFieldValue(f({ field_type: 'date' }), '2026-02-01'), null);
  eq('list not a member', validateFieldValue(f({ field_type: 'list' }), 'tiktok', { values: ['snapchat', 'instagram'] }), 'Choose a value from the list.');
  eq('list member ok', validateFieldValue(f({ field_type: 'list' }), 'snapchat', { values: ['snapchat', 'instagram'] }), null);
  eq('list without allowed values skips membership', validateFieldValue(f({ field_type: 'list' }), 'anything'), null);
}

// contractReady + seedContractValues
{
  const P = (key, extra = {}) => ({ id: key, key, label: key, field_type: 'text', required: false, default_value: '', num_min: null, num_max: null, list_id: null, owner_dept: 'legal', ...extra });
  const fields = [P('name', { required: true }), P('amount', { field_type: 'number', num_min: 0, num_max: 100 }), P('platform', { field_type: 'list', required: true, list_id: 'l1' })];
  const lists = { platform: ['snapchat', 'instagram'] };
  ok('not ready when required missing', !contractReady(fields, { amount: '50' }, lists));
  ok('not ready when number out of range', !contractReady(fields, { name: 'X', amount: '200', platform: 'snapchat' }, lists));
  ok('not ready when list value invalid', !contractReady(fields, { name: 'X', platform: 'tiktok' }, lists));
  ok('ready when all valid', contractReady(fields, { name: 'X', amount: '50', platform: 'snapchat' }, lists));
  ok('ready with optional number left blank', contractReady(fields, { name: 'X', platform: 'instagram' }, lists));
  eq('seed pulls defaults only', seedContractValues([P('a', { default_value: 'x' }), P('b'), P('c', { default_value: 'y' })]), { a: 'x', c: 'y' });
}

// ---- printable contract ----
eq('escapeHtml angle + amp', escapeHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
eq('escapeHtml quotes', escapeHtml(`"x" 'y'`), '&quot;x&quot; &#39;y&#39;');
eq('escapeHtml null-safe', escapeHtml(undefined), '');
{
  const B = (block_type, text) => ({ block_type, content: { text } });
  const kv = (label, value) => ({ block_type: 'kv', content: { label, value } });
  const blocks = [
    B('title', 'Vendor Agreement'),
    B('h', 'Parties'),
    B('p', 'This agreement is with {{ brand_name }}.'),
    kv('Amount', '{{ amount }} SAR'),
    B('li', 'Term {{ term }}'),
  ];
  const html = contractPrintHTML({
    title: 'Rawad deal', blocks, values: { brand_name: 'Rawad Media', amount: '12,500', term: '12m' },
    dir: 'ltr', meta: { org: 'AQ Creativity', status: 'Issued', reference: 'Ref: abc12345', generatedOn: '2026-09-17' },
  });
  ok('is a full html doc', html.startsWith('<!doctype html>') && html.includes('</html>'));
  // That doc carries a reference, so the print document is named after it
  // rather than after the task - see printDocTitle below.
  ok('the reference is the document name', html.includes('<title>Ref: abc12345</title>'));
  ok('ltr lang en', html.includes('lang="en"') && html.includes('dir="ltr"'));
  // Every filled VALUE is wrapped in <bdi>. Siraj's first test printed the
  // handle "@test" as "test@": an at-sign is bidi-neutral, so it floated to
  // the end of the run inside Arabic wording. <bdi> isolates each value so it
  // keeps its own direction whatever surrounds it.
  ok('fills paragraph placeholder',
    html.includes('This agreement is with <bdi>Rawad Media</bdi>.'));
  // Only the SUBSTITUTED value is isolated - the literal " SAR" beside it is
  // the template's own wording and belongs to the line's direction.
  ok('fills kv value', html.includes('<bdi>12,500</bdi> SAR'));
  // CHANGED 22 Sep: the marker is a hyphen, because that is what every list
  // marker in the Word original is. See the bullet section below.
  ok('fills bullet placeholder', html.includes('- Term <bdi>12m</bdi>'));
  ok('a latin value inside the wording is isolated, so an @ leads',
    contractPrintHTML({ title: 't', dir: 'rtl', values: { h: '@test' },
      blocks: [{ block_type: 'p', content: { text: '\u0627\u0644\u062d\u0633\u0627\u0628 {{ h }}' } }],
    }).includes('<bdi>@test</bdi>'));
  ok('title block is centered h1', html.includes('<h1 class="doc-title">Vendor Agreement</h1>'));
  // The letterhead replaced the "AQ Creativity" text block. It is the company
  // strip now, on every page, and its own contents are asserted in
  // tests/legal-letterhead - this only checks the print path reaches it.
  ok('letterhead strip is on the sheet', html.includes('RAWAD ALTATHIR COMPANY'));
  // The table carries its own lang and dir now, not only <html>: a batch
  // print puts several of these in one document, and an Arabic contract
  // printed after an English one has to turn itself round.
  ok('the sheet is wrapped in the repeating table', html.includes('<table class="page" lang="en" dir="ltr">')
    && html.includes('<thead>') && html.includes('<tfoot>'));
  // An ISSUED contract says nothing about its status on its face. Printing
  // "Status: Issued" on a document a vendor signs is not what the paper does.
  ok('an issued contract is not stamped with its status', !html.includes('Status: Issued'));
  // Siraj: "I just need a status refrence number and contract id and i dont
  // want id to look like that just pasted in". One labelled strip, not a bare
  // token floating above the title.
  ok('the reference prints in the meta strip', html.includes('Ref: abc12345')
    && html.includes('class="doc-meta"'));
  ok('and it is labelled rather than bare', html.includes('Contract no'));
  {
    const m = contractPrintHTML({
      title: 't', dir: 'ltr', values: {}, blocks: [{ block_type: 'p', content: { text: 'x' } }],
      meta: { reference: 'AQ-2026-0009', contractId: '9ae8d2ba-1111', status: 'draft' },
    });
    ok('the contract id is labelled too', m.includes('Contract ID') && m.includes('9ae8d2ba-1111'));
    // The strip is OUR chrome, in English, sitting on an Arabic page. Without
    // its own direction "Contract no." printed as ".CONTRACT NO" with each
    // value ahead of its label. Found by rendering the page and looking.
    ok('the strip carries its own direction', m.includes('class="doc-meta" dir="ltr"'));
    ok('a draft says so in the strip', m.includes('Status') && m.includes('DRAFT'));
    ok('and each value is isolated', m.includes('<bdi class="doc-meta-v">AQ-2026-0009</bdi>'));
  }
  // A uuid is SHORTENED on the paper. Siraj: "i dont want id to look like that
  // just pasted in" - and thirty-six characters across the top of a contract is
  // a database column that escaped, not a reference anybody quotes. Found by
  // rendering the real template and looking at page one.
  {
    const u = '9ae8d2ba-4c11-42f7-9a30-1d5e6b2c8f01';
    const m = contractPrintHTML({
      title: 't', dir: 'rtl', values: {}, blocks: [{ block_type: 'p', content: { text: 'x' } }],
      meta: { reference: 'AQ-2026-0009', contractId: u },
    });
    ok('the long form does not reach the paper', !m.includes(u));
    ok('the short form does', m.includes('<bdi class="doc-meta-v">9AE8D2BA</bdi>'));
  }
  eq('eight hex, upper case', shortContractId('9ae8d2ba-4c11-42f7-9a30-1d5e6b2c8f01'), '9AE8D2BA');
  // Some other scheme is left exactly alone rather than sliced at eight.
  eq('a non-uuid id prints as it is', shortContractId('AQ/2026/0009'), 'AQ/2026/0009');
  eq('and nothing stays nothing', shortContractId(null), '');
  // Absent is left out, not printed blank: a draft has no number yet, and an
  // empty labelled row is worse than no row.
  ok('nothing known means no strip at all',
    !contractPrintHTML({ title: 't', dir: 'ltr', values: {},
      blocks: [{ block_type: 'p', content: { text: 'x' } }] }).includes('class="doc-meta"'));
}
{
  const html = contractPrintHTML({
    title: 'x', blocks: [{ block_type: 'p', content: { text: 'hi {{ n }}' } }],
    values: { n: '<script>alert(1)</script>' }, dir: 'rtl',
  });
  ok('rtl lang ar', html.includes('lang="ar"') && html.includes('dir="rtl"'));
  ok('escapes injected value', html.includes('&lt;script&gt;') && !html.includes('<script>alert'));
  // CHANGED 22 Sep. An unfilled field used to print its raw {{ braces }} so a
  // gap would be obvious - and Siraj's first real test printed `{{ id }}` in
  // the body of a contract, above the title. A gap still has to be obvious,
  // so it prints as a ruled blank carrying the field's name in its tooltip:
  // that reads as "nobody filled this in" rather than as a broken app.
  {
    // A gap INSIDE a sentence is a real blank somebody has to fill, so it
    // prints - as a ruled space naming the field, never as raw braces.
    const gap = contractPrintHTML({ title: 't', dir: 'ltr', values: {},
      blocks: [{ block_type: 'p', content: { text: 'Paid {{ amount }} on the day.' } }] });
    ok('an unfilled field never prints raw braces', !gap.includes('{{ amount }}'));
    ok('it prints a ruled blank instead', gap.includes('class="doc-gap"'));
    ok('and still names the field it is waiting for', gap.includes('title="amount"'));
    ok('the rest of the sentence survives', gap.includes('Paid ') && gap.includes(' on the day.'));
    ok('a field holding only spaces is still a gap',
      contractPrintHTML({ title: 't', dir: 'ltr', values: { amount: '   ' },
        blocks: [{ block_type: 'p', content: { text: 'Paid {{ amount }} on the day.' } }] })
        .includes('class="doc-gap"'));

    // But a line that is ONE unfilled field and nothing else prints nothing.
    // The UGC template opens with a bare {{ id }} block, and once the number
    // moved into the strip at the top, a lone ruled blank sat under the
    // letterhead reading as a mistake. Found by rendering the page.
    const alone = contractPrintHTML({ title: 't', dir: 'ltr', values: {},
      blocks: [{ block_type: 'p', content: { text: '{{ id }}' } }] });
    // Look at the SHEET, not the whole document: printCss() defines .doc-gap,
    // so a naive includes() on the html can never be false. Cost one failing
    // assertion to notice.
    const sheetOf = (h) => h.slice(h.indexOf('<div class="sheet">'), h.indexOf('</table>'));
    ok('a line that is only an empty field prints nothing',
      !sheetOf(alone).includes('doc-gap'));
    ok('and leaves no empty paragraph behind', !sheetOf(alone).includes('class="doc-p"'));
    ok('the guard is on the body, not the stylesheet', alone.includes('.doc-gap {'));
    // Filled, it is ordinary content and prints.
    ok('the same line prints once it has a value',
      contractPrintHTML({ title: 't', dir: 'ltr', values: { id: 'AQ-9' },
        blocks: [{ block_type: 'p', content: { text: '{{ id }}' } }] }).includes('<bdi>AQ-9</bdi>'));
  }
}
/* -- the numbers come off the Word original ---------------------------- */
// Not eyeballed. Read out of word/styles.xml and word/document.xml in
// `Rawad altathir UGC.docx`, 22 Sep: Normal is w:sz 24 (12pt), the title and
// the bank lines are w:szCs 28 (14pt), line spacing is w:line 360 (1.5), and
// the table is Word's "Grid Table 1 Light" - 0.5pt #999999 all round with a
// 1.5pt #666666 rule under the header and NO fill.
//
// These assertions exist because the previous values (12.5pt, 1.9, a 19pt
// title, a grey header band) were my own invention, and that is exactly what
// "make it look exactly like the word doc" was complaining about. If somebody
// changes one of these later it should be because they re-measured.
{
  const css = printCss();
  ok('body is 12pt', /body \{[^}]*font-size: 12pt/s.test(css));
  ok('and 1.5 line spacing', /body \{[^}]*line-height: 1\.5;/s.test(css));
  ok('the title is 14pt, not a masthead', css.includes('.doc-title { font-size: 14pt'));
  ok('a heading is the body size in bold', css.includes('.doc-h { font-size: 12pt; font-weight: 700'));
  ok('table borders are the document grey', css.includes('border: 0.5pt solid #999999'));
  ok('with a heavier rule under the header', css.includes('border-bottom: 1.5pt solid #666666'));
  // The header band was mine. The document has no fill anywhere in the table.
  ok('and no header fill at all', !/\.doc-table th \{[^}]*background/s.test(css));
}

/* -- one marker per bullet, and it is a hyphen ------------------------ */
// MEASURED: every list marker in the Word original is a HYPHEN. Some are
// typed into the text ("-\u0627\u0644\u0627\u0644\u062a\u0632\u0627\u0645"), some come from a Word list, and on
// the page the two are indistinguishable. There is no bullet glyph in the
// document at all - the round bullet was mine.
//
// So the author's own marker is kept and normalised, and one is added only to
// a line that has none. Found by rendering the real seeded template and
// looking at page three, where clauses printed with two markers.
{
  const li = (t) => contractPrintHTML({ title: 't', dir: 'rtl', values: {},
    blocks: [{ block_type: 'li', content: { text: t } }] });
  ok('the marker is the document\'s hyphen, not a bullet', !li('x').includes('&bull;'));
  ok('a line with no marker gets one', li('first').includes('- first'));
  ok('a hyphen the author typed is kept, not doubled', li('- first').includes('- first')
    && !li('- first').includes('- - first'));
  ok('and one with no space after it is normalised', li('-first').includes('- first'));
  ok('a bullet character becomes the document\'s hyphen', li('\u2022 first').includes('- first'));
  ok('so does an en dash', li('\u2013 first').includes('- first'));
  // ONE marker, and only from the front. A hyphen in the middle of a clause is
  // the author's - "24-hour" - and moving it would change the wording.
  ok('a hyphen inside the line is left alone', li('- a 24-hour window')
    .includes('- a 24-hour window'));
  ok('and only one leading marker is taken', li('-- twice').includes('- - twice'));
  eq('a plain line gains a marker', bulletText('plain'), '- plain');
  eq('a marked one keeps exactly one', bulletText('  -  plain'), '- plain');
  // An empty line stays empty rather than becoming a marker with nothing
  // after it - a lone hyphen on the page reads as a mistake.
  eq('an empty line stays empty', bulletText(''), '');
  eq('and so does a blank one', bulletText('   '), '   ');
  // The marker is added BEFORE the fields are filled, so a value that begins
  // with a hyphen is never mistaken for the line's marker.
  ok('a filled value keeps its own leading hyphen',
    contractPrintHTML({ title: 't', dir: 'ltr', values: { n: '-5' },
      blocks: [{ block_type: 'li', content: { text: '- delta {{ n }}' } }] })
      .includes('- delta <bdi>-5</bdi>'));
}

// ---- contract fingerprint ----
eq('reserved keys are double-underscored', [FINGERPRINT_KEY, ISSUED_AT_KEY], ['__aq_fingerprint', '__aq_issued_at']);
{
  const B = (block_type, text) => ({ block_type, content: { text } });
  const kv = (label, value) => ({ block_type: 'kv', content: { label, value } });
  const blocks = [B('p', 'Owed {{ amount }} to {{ name }}'), kv('Term', '{{ term }}')];
  const c1 = contractCanonical('ver-1', blocks, { amount: '100', name: 'Rawad', term: '12m' });
  ok('canonical starts with version', c1.startsWith('v:ver-1\n'));
  ok('canonical fills placeholders', c1.includes('Owed 100 to Rawad') && c1.includes('kv|Term=12m'));
  eq('canonical is deterministic', contractCanonical('ver-1', blocks, { amount: '100', name: 'Rawad', term: '12m' }), c1);
  ok('canonical differs when a value changes', contractCanonical('ver-1', blocks, { amount: '999', name: 'Rawad', term: '12m' }) !== c1);
  ok('canonical differs when version changes', contractCanonical('ver-2', blocks, { amount: '100', name: 'Rawad', term: '12m' }) !== c1);
  ok('reserved keys do not enter canonical', contractCanonical('ver-1', blocks, { amount: '100', name: 'Rawad', term: '12m', [FINGERPRINT_KEY]: 'x', [ISSUED_AT_KEY]: 'y' }) === c1);
}
eq('formatFingerprint groups in fours, upper', formatFingerprint('deadbeef0123'), 'DEAD BEEF 0123');
eq('formatFingerprint strips non-hex', formatFingerprint('ab:cd ef'), 'ABCD EF');
eq('formatFingerprint empty-safe', formatFingerprint(undefined), '');
{
  const html = contractPrintHTML({
    title: 't', blocks: [{ block_type: 'p', content: { text: 'x' } }], values: {}, dir: 'ltr',
    meta: { fingerprint: 'ABCD 1234' },
  });
  // Once, at the end of the document - not on every page. It is a check
  // somebody runs, not part of the agreement.
  /* -- what the print document calls itself ------------------------- */
  //
  // Two jobs, both on somebody else's screen: Chrome prints it in the page
  // margin beside the date, and "Save as PDF" suggests it as the filename.
  // The header itself is the browser's and no CSS removes it - but what it
  // SAYS is ours, and a contract's number beats "test final - 1" at both.
  eq('the contract number wins', printDocTitle('AQ-2026-0007', 'test final - 1'), 'AQ-2026-0007');
  eq('the title is the fallback, not the default', printDocTitle('', 'test final - 1'), 'test final - 1');
  eq('and blank space is not a number', printDocTitle('   ', 'test final - 1'), 'test final - 1');
  eq('with neither, it still has a name', printDocTitle('', ''), 'Contract');
  eq('and nothing at all is the same', printDocTitle(null, null), 'Contract');
  {
    // End to end: the <title> of a numbered contract is its number, and the
    // document body is untouched by any of this.
    const numbered = contractPrintHTML({
      title: 'test final - 1', dir: 'ltr',
      blocks: [{ block_type: 'p', content: { text: 'body text' } }],
      values: {}, meta: { reference: 'AQ-2026-0007' },
    });
    ok('the print document is titled by its number', numbered.includes('<title>AQ-2026-0007</title>'));
    ok('and the task name is not in the head', !numbered.includes('<title>test final - 1</title>'));
    ok('while the body is what it always was', numbered.includes('body text'));
    const unnumbered = contractPrintHTML({
      title: 'test final - 1', dir: 'ltr',
      blocks: [{ block_type: 'p', content: { text: 'body text' } }],
      values: {}, meta: {},
    });
    ok('a draft with no number keeps its title', unnumbered.includes('<title>test final - 1</title>'));
  }

  ok('the fingerprint prints once at the end', html.includes('>ABCD 1234<'));
  // Siraj, at the last page: "and what is this it looks so weird". A naked
  // 64-character hash on a signed agreement reads as a defect, so it now
  // carries a caption saying what it is, in the document's own language.
  ok('and says what it is', html.includes(fingerprintCaption('ltr')));
  ok('the caption is in both languages, the document\u2019s first',
    fingerprintCaption('rtl').indexOf('\u0628\u0635\u0645\u0629') === 0
    && fingerprintCaption('rtl').includes('SHA-256')
    && fingerprintCaption('ltr').indexOf('Document') === 0);
  ok('no fingerprint line when absent', !contractPrintHTML({ title: 't', blocks: [{ block_type: 'p', content: { text: 'x' } }], values: {}, dir: 'ltr' }).includes('class="doc-fp-hash"'));
  {
    // A draft says so. Nothing else does.
    const d = contractPrintHTML({ title: 't', blocks: [{ block_type: 'p', content: { text: 'x' } }],
      values: {}, dir: 'ltr', meta: { status: 'draft' } });
    ok('a draft is marked DRAFT', d.includes('>DRAFT<'));
    ok('an issued contract is not', !contractPrintHTML({ title: 't', blocks: [{ block_type: 'p', content: { text: 'x' } }],
      values: {}, dir: 'ltr', meta: { status: 'issued' } }).includes('>DRAFT<'));
  }
}

// ---- optional clauses ----
eq('opt-off reserved key', OPT_OFF_KEY, '__aq_opt_off');
ok('optional block detected', isOptionalBlock({ optional: true }));
ok('non-optional block', !isOptionalBlock({ optional: false }));
ok('missing optional is not optional', !isOptionalBlock({}));
eq('parse empty -> []', parseOffIds(''), []);
eq('parse null -> []', parseOffIds(null), []);
eq('parse trims + drops blanks', parseOffIds(' a , b ,, c '), ['a', 'b', 'c']);
eq('serialize dedupes', serializeOffIds(['a', 'b', 'a', '', 'c']), 'a,b,c');
eq('parse/serialize roundtrip', parseOffIds(serializeOffIds(['x', 'y'])), ['x', 'y']);
{
  const bl = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  eq('no offIds -> all (same ref)', visibleBlocks(bl, []), bl);
  ok('no offIds keeps same ref', visibleBlocks(bl, []) === bl);
  eq('excludes off ids', visibleBlocks(bl, ['b']).map((x) => x.id), ['a', 'c']);
  eq('excludes several, keeps order', visibleBlocks(bl, ['c', 'a']).map((x) => x.id), ['b']);
  const before = JSON.stringify(bl);
  visibleBlocks(bl, ['b']);
  ok('visibleBlocks does not mutate', JSON.stringify(bl) === before);
}
{
  // an excluded clause drops out of the fingerprint canonical
  const blocks = [{ id: '1', block_type: 'p', content: { text: 'keep' } }, { id: '2', block_type: 'p', content: { text: 'drop' } }];
  const full = contractCanonical('v', blocks, {});
  const trimmed = contractCanonical('v', visibleBlocks(blocks, ['2']), {});
  ok('canonical over visible omits excluded', trimmed.includes('keep') && !trimmed.includes('drop') && full.includes('drop'));
}

// ---- date alerts ----
eq('not tracked -> null', dateAlertState('2026-01-01', null, '2026-09-17'), null);
eq('empty value -> null', dateAlertState('', 0, '2026-09-17'), null);
eq('bad date -> null', dateAlertState('01/02/2026', 0, '2026-09-17'), null);
eq('past date -> expired (expiry)', dateAlertState('2026-09-16', 0, '2026-09-17'), 'expired');
eq('today -> ok (expiry, days 0)', dateAlertState('2026-09-17', 0, '2026-09-17'), 'ok');
eq('future -> ok (expiry, days 0)', dateAlertState('2026-12-01', 0, '2026-09-17'), 'ok');
eq('within window -> soon', dateAlertState('2026-09-20', 7, '2026-09-17'), 'soon');
eq('edge of window -> soon', dateAlertState('2026-09-24', 7, '2026-09-17'), 'soon');
eq('just past window -> ok', dateAlertState('2026-09-25', 7, '2026-09-17'), 'ok');
eq('past date with window -> expired', dateAlertState('2026-09-10', 7, '2026-09-17'), 'expired');
eq('window crossing month -> soon', dateAlertState('2026-10-02', 30, '2026-09-17'), 'soon');
{
  const F = (key, extra = {}) => ({ key, label: key.toUpperCase(), field_type: 'date', alert_days: null, ...extra });
  const fields = [
    F('permit', { alert_days: 0 }),
    F('deadline', { alert_days: 7 }),
    F('start'),              // date, not tracked
    { key: 'name', label: 'Name', field_type: 'text', alert_days: 0 }, // not a date
  ];
  const values = { permit: '2026-09-10', deadline: '2026-09-19', start: '2020-01-01', name: 'x' };
  const alerts = contractDateAlerts(fields, values, '2026-09-17');
  eq('only tracked date fields, actionable states', alerts.map((a) => [a.key, a.state]), [['permit', 'expired'], ['deadline', 'soon']]);
  ok('expired blocks', hasBlockingAlert(alerts));
  ok('soon-only does not block', !hasBlockingAlert([{ state: 'soon' }]));
  ok('empty does not block', !hasBlockingAlert([]));
  eq('no alerts when all fine', contractDateAlerts([F('p', { alert_days: 0 })], { p: '2026-12-01' }, '2026-09-17'), []);
}
eq('alert label expired', dateAlertLabel('expired'), 'Expired');
eq('alert label soon', dateAlertLabel('soon'), 'Expiring soon');

// ---- outputs table ----
eq('table key prefixes the block id', tableKey('blk-9'), '__aq_table_blk-9');
eq('table key prefix constant', TABLE_KEY_PREFIX, '__aq_table_');
{
  eq('columns from content', tableColumns({ content: { columns: [{ key: 'platform', label: 'Platform' }, { key: 'price', label: 'Price' }] } }).map((c) => c.key), ['platform', 'price']);
  eq('label falls back to key', tableColumns({ content: { columns: [{ key: 'x' }] } }), [{ key: 'x', label: 'x' }]);
  eq('drops malformed columns', tableColumns({ content: { columns: [{ key: 'ok', label: 'OK' }, { label: 'no key' }, null, 5] } }).map((c) => c.key), ['ok']);
  eq('no columns -> []', tableColumns({ content: {} }), []);
}
{
  const P = (key, extra = {}) => ({ id: key, key, label: key, field_type: 'text', required: false, default_value: '', num_min: null, num_max: null, list_id: null, owner_dept: 'legal', alert_days: null, ...extra });
  const reg = [P('platform', { field_type: 'list', list_id: 'l1' }), P('price', { field_type: 'number' })];
  const cols = [{ key: 'platform', label: 'Platform' }, { key: 'ghost', label: 'Ghost' }, { key: 'price', label: 'Price' }];
  const resolved = tableColumnFields(cols, reg);
  eq('resolves known columns, drops unknown', resolved.map((c) => c.key), ['platform', 'price']);
  eq('carries the field type', resolved.map((c) => c.field.field_type), ['list', 'number']);
}
eq('parse empty -> []', parseTableRows(''), []);
eq('parse null -> []', parseTableRows(null), []);
eq('parse bad json -> []', parseTableRows('{not json'), []);
eq('parse non-array -> []', parseTableRows('{"a":1}'), []);
eq('parse coerces values to strings', parseTableRows('[{"a":1,"b":null,"c":"x"}]'), [{ a: '1', b: '', c: 'x' }]);
{
  const rows = [{ platform: 'snapchat', price: '5000' }, { platform: 'instagram', price: '3000' }];
  eq('serialize/parse roundtrip', parseTableRows(serializeTableRows(rows)), rows);
}
eq('empty row has a blank cell per column', emptyTableRow([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]), { a: '', b: '' });
{
  // a table block's rows enter the fingerprint canonical
  const tbl = { id: 't1', block_type: 'table', content: { columns: [{ key: 'platform', label: 'Platform' }] } };
  const p = { block_type: 'p', content: { text: 'hi' } };
  const rowsJson = serializeTableRows([{ platform: 'snapchat' }]);
  const c1 = contractCanonical('v', [p, tbl], { [tableKey('t1')]: rowsJson });
  ok('canonical includes the table rows', c1.includes('table|platform|') && c1.includes('snapchat'));
  ok('canonical changes when a row changes', contractCanonical('v', [p, tbl], { [tableKey('t1')]: serializeTableRows([{ platform: 'tiktok' }]) }) !== c1);
}
{
  // the print renders a table with headers and filled rows
  const tbl = { id: 't1', block_type: 'table', content: { columns: [{ key: 'platform', label: 'Platform' }, { key: 'price', label: 'Price' }] } };
  const html = contractPrintHTML({
    title: 'c', blocks: [tbl], dir: 'ltr',
    values: { [tableKey('t1')]: serializeTableRows([{ platform: 'snapchat', price: '5000' }]) },
  });
  ok('print has the table headers', html.includes('<th>Platform</th>') && html.includes('<th>Price</th>'));
  ok('print has the filled row',
    html.includes('<td><bdi>snapchat</bdi></td>') && html.includes('<td><bdi>5000</bdi></td>'));
  ok('empty table prints a no-rows note', contractPrintHTML({ title: 'c', blocks: [tbl], dir: 'ltr', values: {} }).includes('(no rows)'));
}
{
  const col = (key, field) => ({ key, field });
  const cols = [
    col('price', { field_type: 'number', num_min: 0, num_max: 10000 }),
    col('platform', { field_type: 'list', num_min: null, num_max: null }),
    col('draft', { field_type: 'date', num_min: null, num_max: null }),
  ];
  const listsByKey = { platform: ['snapchat', 'instagram'] };
  ok('all valid -> no invalid cell', !tableHasInvalidCell(cols, [{ price: '500', platform: 'snapchat', draft: '2026-10-01' }], listsByKey));
  ok('empty cells are allowed', !tableHasInvalidCell(cols, [{ price: '', platform: '', draft: '' }], listsByKey));
  ok('number over max -> invalid', tableHasInvalidCell(cols, [{ price: '99999', platform: 'snapchat' }], listsByKey));
  ok('number non-numeric -> invalid', tableHasInvalidCell(cols, [{ price: 'abc' }], listsByKey));
  ok('list off-list -> invalid', tableHasInvalidCell(cols, [{ platform: 'tiktok' }], listsByKey));
  ok('bad date -> invalid', tableHasInvalidCell(cols, [{ draft: '10/01/2026' }], listsByKey));
  ok('one bad row among good -> invalid', tableHasInvalidCell(cols, [{ price: '5' }, { price: '-1' }], listsByKey));
  ok('no rows -> not invalid', !tableHasInvalidCell(cols, [], listsByKey));
}

// sig blocks: the two signing lines. Until 2026-09-20 a sig block was
// "not editable here yet" in the editor and rendered as NOTHING in print,
// so a ported contract lost its signature lines silently.
{
  const S = (right, left) => ({ block_type: 'sig', content: { right, left } });
  eq('blockSig reads both sides', blockSig(S('First', 'Second')), { right: 'First', left: 'Second' });
  eq('blockSig defaults to empty', blockSig({ content: {} }), { right: '', left: '' });
  eq('blockSig ignores non-strings', blockSig({ content: { right: 7, left: null } }), { right: '', left: '' });
  eq('blockAllText joins sig', blockAllText({ content: { right: 'Party A', left: 'Party B' } }), 'Party A Party B');
  ok('sig is an editable block type', isEditableBlockType('sig'));
  eq('sig has a label', blockTypeLabel('sig'), 'Signatures');

  const reg = [{ key: 'signatory', label: 'Signatory', field_type: 'text', required: false,
    num_min: null, num_max: null, list_id: null, default_value: '', alert_days: null }];
  eq('a merge field inside a signing line becomes a contract field',
    fillFieldsForBlocks([S('First party: {{ signatory }}', 'Second party:')], reg).map((f) => f.key),
    ['signatory']);

  const html = contractPrintHTML({
    title: 'T', dir: 'rtl', values: { signatory: 'Ahmed' },
    blocks: [S('First party: {{ signatory }}', 'Second party:')],
  });
  ok('sig renders in print', html.includes('class="sig-row"'));
  ok('sig fills its placeholders', html.includes('First party: <bdi>Ahmed</bdi>'));
  ok('sig renders both sides', html.includes('Second party:'));
  ok('sig draws a rule to sign on', html.includes('class="sig-rule"'));
  ok('an empty sig block renders nothing',
    !contractPrintHTML({ title: 'T', dir: 'ltr', values: {}, blocks: [S('', '')] }).includes('class="sig-row"'));

  // Deliberately excluded from the fingerprint: a published version is frozen,
  // so adding it now would make every already-issued contract read "differs".
  eq('sig stays out of the canonical string',
    contractCanonical('v1', [S('First', 'Second')], {}), 'v:v1\nsig|');
}

// ---- a table's rows: the operator's, or the contract's own fields ----
//
// The live UGC template (contract-template-ar.js block 11) is a header row and
// ONE row of merge fields, because a vendor contract covers one vendor. v1
// ported it as an add-rows grid; row_source 'fields' is the correction.
{
  const COLS = [
    { key: 'name_2', label: 'Influencer' },
    { key: 'platform_smart', label: 'Platform' },
  ];
  const ROWS = { id: 't1', block_type: 'table', content: { columns: COLS } };
  const ONE = { id: 't1', block_type: 'table', content: { columns: COLS, row_source: 'fields' } };
  const V = { name_2: 'Sara', platform_smart: 'TikTok', [tableKey('t1')]: '[{"name_2":"ignored"}]' };

  eq('a table defaults to operator rows', tableRowSource(ROWS), 'rows');
  eq('row_source fields is read', tableRowSource(ONE), 'fields');
  eq('an unknown row_source falls back to rows',
    tableRowSource({ content: { columns: COLS, row_source: 'magic' } }), 'rows');

  eq('the one row is read from the values', tableFieldRow(COLS, V),
    { name_2: 'Sara', platform_smart: 'TikTok' });
  eq('a missing value is an empty cell, not undefined', tableFieldRow(COLS, {}),
    { name_2: '', platform_smart: '' });

  eq('a fields table prints exactly one row', tableRowsFor(ONE, V).length, 1);
  eq('and it ignores any stored rows', tableRowsFor(ONE, V)[0].name_2, 'Sara');
  eq('a rows table still reads its stored rows', tableRowsFor(ROWS, V),
    [{ name_2: 'ignored' }]);
  eq('a rows table with nothing stored has no rows', tableRowsFor(ROWS, {}), []);

  // The column keys have to reach the fill form and Publish's unknown-field
  // check, or the four cells would be unfillable and unvalidated.
  ok('a fields table surfaces its columns as merge fields',
    parsePlaceholderKeys(blockAllText(ONE)).join(',') === 'name_2,platform_smart');
  eq('a rows table surfaces none of them', parsePlaceholderKeys(blockAllText(ROWS)), []);
  eq('the fill form offers a fields table\'s columns',
    fillFieldsForBlocks([ONE], [
      { key: 'name_2', label: 'Influencer', field_type: 'text' },
      { key: 'platform_smart', label: 'Platform', field_type: 'text' },
    ]).map((f) => f.key), ['name_2', 'platform_smart']);

  // The seal must cover the row as printed. Sealing a fields table over the
  // (empty) tableKey slot would let the influencer's name change with the
  // fingerprint still reading Verified.
  const c1 = contractCanonical('v1', [ONE], V);
  const c2 = contractCanonical('v1', [ONE], { ...V, name_2: 'Noura' });
  ok('changing a cell changes the sealed string', c1 !== c2);
  ok('the sealed string carries the cell', c1.includes('Sara'));
  // A rows table's canonical is untouched, so no already-issued contract moves.
  eq('a rows table hashes its stored rows as before',
    contractCanonical('v1', [ROWS], V), 'v:v1\ntable|name_2,platform_smart|[{"name_2":"ignored"}]');

  ok('print draws the one row', contractPrintHTML({
    title: 'T', dir: 'rtl', blocks: [ONE], values: V, meta: {},
  }).includes('Sara'));
  ok('print does not say (no rows) for a fields table', !contractPrintHTML({
    title: 'T', dir: 'rtl', blocks: [ONE], values: {}, meta: {},
  }).includes('(no rows)'));
}

// ---- the preview shows which words came from the form ----
{
  const T = 'Party {{ license_name }} under {{ id }} for {{ brand_name }}.';
  const segs = fillSegments(T, { license_name: 'Sara', brand_name: '' },
    { missingWord: 'MISSING', pendingWord: 'PENDING', pendingKeys: ['id'] });

  eq('literal wording and fields alternate', segs.map((s) => s.t),
    ['text', 'field', 'text', 'field', 'text', 'field', 'text']);
  eq('a filled field shows its value', segs[1].v, 'Sara');
  ok('and is neither missing nor pending', !segs[1].missing && !segs[1].pending);
  eq('a pending field shows the pending word', segs[3].v, 'PENDING');
  ok('pending is not missing - it is filled later, not forgotten',
    segs[3].pending === true && segs[3].missing === false);
  eq('an empty field shows the missing word', segs[5].v, 'MISSING');
  ok('and is marked missing', segs[5].missing === true);
  eq('the key rides along for each field', segs[5].key, 'brand_name');

  eq('text with no fields is one segment', fillSegments('plain', {}), [{ t: 'text', v: 'plain' }]);
  eq('empty text is no segments', fillSegments('', {}), []);
  eq('a field at the very start makes no empty leading text',
    fillSegments('{{ a }} tail', { a: 'x' }).length, 2);
  /* -- money reads the same on screen as on the paper --------------- */
  //
  // Siraj, at the preview: "show the full how it will look like not just the
  // number". It showed 500; the contract says "(500.00) (khamsumia) riyal".
  // fillPlaceholders (the PRINT) has applied the amount rule since it was
  // written and fillSegments (the PREVIEW) never did, so the one screen whose
  // job is to show what will print was the one screen showing something else.
  //
  // Asserted against fillPlaceholders, not against a hand-typed string: the
  // two must agree whatever the rule becomes.
  {
    const line = 'Fee {{ Amount_full }} only.';
    const vals = { Amount_full: '500' };
    const seg = fillSegments(line, vals).find((x) => x.t === 'field');
    eq('the preview spells the amount out', seg.v, amountInWords('500'));
    ok('which is not just the number', seg.v !== '500' && seg.v.includes('500'));
    // Both paths, side by side. The print wraps values in <bdi>; strip the
    // tags and the words must be identical.
    const printed = fillPlaceholdersHtml(line, vals).replace(/<[^>]*>/g, '');
    const preview = fillSegments(line, vals).map((x) => x.v).join('');
    eq('preview and print say the same thing', preview, printed);
  }
  {
    // Only money. An ordinary field is still printed exactly as typed - a
    // licence number is not an amount and must never grow brackets.
    const seg = fillSegments('No {{ license_number }}.', { license_number: '500' })
      .find((x) => x.t === 'field');
    eq('an ordinary field is untouched', seg.v, '500');
  }
  {
    // An empty amount is still a gap, not "(0)". The transform runs on the
    // value, and an empty value never reaches it.
    const seg = fillSegments('Fee {{ Amount_full }}.', { Amount_full: '' },
      { missingWord: 'MISSING' }).find((x) => x.t === 'field');
    eq('an empty amount is a gap', seg.v, 'MISSING');
    ok('and is marked missing', seg.missing === true);
  }
  {
    // Not a number: legal-amount returns it unchanged, and so must this.
    const seg = fillSegments('Fee {{ Amount_full }}.', { Amount_full: 'to be agreed' })
      .find((x) => x.t === 'field');
    eq('a non-numeric amount is left alone', seg.v, 'to be agreed');
  }

  // Re-reading the same line must not depend on a shared regex's lastIndex.
  eq('a second call over the same text is identical',
    JSON.stringify(fillSegments(T, { license_name: 'Sara' })),
    JSON.stringify(fillSegments(T, { license_name: 'Sara' })));
  // Nothing is dropped: the segments rejoin to what fillPlaceholders shows.
  eq('segments rejoin to the filled line',
    fillSegments(T, { license_name: 'Sara', id: 'AQ-1', brand_name: 'Rabea' })
      .map((s) => s.v).join(''),
    fillPlaceholders(T, { license_name: 'Sara', id: 'AQ-1', brand_name: 'Rabea' }));
}

// ---- a list that also takes a value of its own ----
{
  const closed = { field_type: 'list', required: false };
  const open = { field_type: 'list', required: false, allow_other: true };
  const LIST = { values: ['Reel', 'Story'] };

  eq('a closed list refuses an off-list value',
    validateFieldValue(closed, 'Podcast', LIST), 'Choose a value from the list.');
  eq('allow_other takes it', validateFieldValue(open, 'Podcast', LIST), null);
  eq('an in-list value is fine either way',
    [validateFieldValue(closed, 'Reel', LIST), validateFieldValue(open, 'Reel', LIST)], [null, null]);
  eq('allow_other does not make a required field optional',
    validateFieldValue({ ...open, required: true }, '', LIST), 'This field is required.');
  eq('and an empty optional one is still fine', validateFieldValue(open, '', LIST), null);
  // The flag is only about list membership - a number is still a number.
  eq('allow_other does not loosen a number field',
    validateFieldValue({ field_type: 'number', required: false, allow_other: true, num_min: 1, num_max: 5 }, '9'),
    'Must be at most 5.');
  // contractReady reads the same rule, so Issue is not blocked by an Other.
  ok('a contract with an Other value is ready',
    contractReady([{ key: 'ad_types', ...open }], { ad_types: 'Podcast' }, { ad_types: LIST.values }));
  ok('and one with an off-list value on a closed field is not',
    !contractReady([{ key: 'ad_types', ...closed }], { ad_types: 'Podcast' }, { ad_types: LIST.values }));

  // THE COUPLING THAT COULD BREAK SILENTLY. Several platforms are stored as one
  // comma-joined value, which is by definition not a member of the list. It
  // passes only because platform_smart carries allow_other. Turn that flag off
  // in the registry and every multi-platform contract stops being issuable -
  // so this is the test that says why the flag is there.
  const PLATFORMS = { values: ['Instagram', 'TikTok'] };
  eq('two platforms in one value are allowed by allow_other',
    validateFieldValue({ field_type: 'list', required: true, allow_other: true },
      'Instagram, TikTok', PLATFORMS), null);
  eq('and are rejected the moment the flag comes off',
    validateFieldValue({ field_type: 'list', required: true, allow_other: false },
      'Instagram, TikTok', PLATFORMS), 'Choose a value from the list.');
  ok('a two-platform contract is ready to issue',
    contractReady([{ key: 'platform_smart', field_type: 'list', required: true, allow_other: true }],
      { platform_smart: 'Instagram, TikTok' }, { platform_smart: PLATFORMS.values }));
}

// ---- how a task's line reads ----
//
// It says the work LEFT, not the work done: the reason to open a task is the
// part that is not finished.
{
  eq('an empty task says so', batchProgress({ total: 0, unassigned: 0, issued: 0 }),
    'no contracts yet');

  /* -- NOT COUNTED IS NOT COUNTED ZERO ------------------------------- */
  //
  // The three numbers come from one RPC (legal.batch_counts, migration 122).
  // When that call fails they are all zero - and zero is a NUMBER, so a task
  // holding ten contracts renders "no contracts yet" on the screen whose
  // entire job is to say how much work is left. That is the wrong number that
  // looks like a right one, which is the failure this whole screen has been
  // fixed for twice already.
  eq('a failed count says so instead of saying zero',
    batchProgress({ total: 0, unassigned: 0, issued: 0, counted: false }),
    'could not count the contracts - reload');
  // And it says so even when stale numbers are still in the row, because the
  // numbers are exactly what cannot be trusted.
  eq('and it does not report numbers it could not verify',
    batchProgress({ total: 12, unassigned: 5, issued: 3, counted: false }),
    'could not count the contracts - reload');
  // Only an explicit false. Absent means counted - every caller that has
  // never heard of this flag keeps working.
  eq('absent means counted', batchProgress({ total: 12, unassigned: 5, issued: 0 }),
    '12 contracts - 5 still need a vendor');
  eq('and true means counted', batchProgress({ total: 0, unassigned: 0, issued: 0, counted: true }),
    'no contracts yet');
  eq('the unfilled ones lead', batchProgress({ total: 12, unassigned: 5, issued: 0 }),
    '12 contracts - 5 still need a vendor');
  eq('even when some are issued', batchProgress({ total: 12, unassigned: 5, issued: 3 }),
    '12 contracts - 5 still need a vendor');
  eq('all assigned, none issued, is ready', batchProgress({ total: 12, unassigned: 0, issued: 0 }),
    '12 contracts - ready to issue');
  eq('part issued is counted both ways', batchProgress({ total: 12, unassigned: 0, issued: 3 }),
    '12 contracts - 3 issued, 9 still draft');
  eq('all issued is done', batchProgress({ total: 12, unassigned: 0, issued: 12 }),
    '12 contracts - all issued');
  eq('one contract is singular', batchProgress({ total: 1, unassigned: 0, issued: 1 }),
    '1 contract - all issued');
  // A count that has gone negative or fractional must not print as such.
  eq('nonsense counts do not reach the screen',
    batchProgress({ total: -3, unassigned: -1, issued: -1 }), 'no contracts yet');
  eq('more issued than there are still reads as done',
    batchProgress({ total: 2, unassigned: 0, issued: 9 }), '2 contracts - all issued');
}

// ---- an optional clause is a SECTION, not a block ----
//
// Siraj: "by default all legal requirement is recommended but they can choose
// the ones they want to remove or edit". Section five of the UGC contract is a
// heading, four paragraphs and four bank rows: nine blocks and ONE decision.
// Before 114 that was nine checkboxes, each labelled with ninety characters of
// its own text.
{
  const blk = (id, opt, group, label, text, type) => ({
    id, version_id: 'v', workspace_id: 'w', position: 1, block_type: type ?? 'p',
    content: { text: text ?? id }, optional: opt,
    optional_group: group ?? null, optional_label: label ?? null,
  });

  const doc = [
    blk('b1', false),                                   // structural
    blk('b15', true),                                   // a standalone switch
    blk('b21', true, 'terms', 'Fourth: terms'),         // a section...
    blk('b22', true, 'terms'),
    blk('b23', true, 'terms'),
    blk('b36', true, 'notices', 'Sixth: notices'),      // ...and another
    blk('b37', true, 'notices'),
    blk('b40', false),                                  // structural
  ];

  const gs = optionalGroups(doc);
  eq('three switches, not six', gs.map((g) => g.key), ['b15', 'terms', 'notices']);
  eq('the section carries all its blocks',
    gs[1].ids, ['b21', 'b22', 'b23']);
  eq('and is labelled by its heading', gs[1].label, 'Fourth: terms');
  eq('a lone block has no label, so the caller falls back to its text',
    gs[0].label, '');
  eq('and controls only itself', gs[0].ids, ['b15']);
  // The order is the document's, by the first block of each group - the
  // checkboxes read down the page in the order the clauses appear in it.
  eq('order follows the document', gs.map((g) => g.firstId), ['b15', 'b21', 'b36']);
  eq('structural blocks are not switches',
    gs.some((g) => g.ids.includes('b1') || g.ids.includes('b40')), false);

  // ---- switching one ----
  eq('everything starts on', gs.map((g) => optionalGroupOn(g, [])), [true, true, true]);
  const off1 = toggleOptionalGroup(gs[1], [], false);
  eq('switching the section off takes all three blocks',
    off1.slice().sort(), ['b21', 'b22', 'b23']);
  eq('and the switch reads off', optionalGroupOn(gs[1], off1), false);
  eq('while the others are untouched',
    [optionalGroupOn(gs[0], off1), optionalGroupOn(gs[2], off1)], [true, true]);
  const back = toggleOptionalGroup(gs[1], off1, true);
  eq('switching it back on empties the list', back, []);

  // A half-off group is only reachable by editing the stored value by hand.
  // It reads as ON so that one more click turns all of it off, rather than
  // one click turning the rest of it on behind your back.
  ok('a half-off group reads as on', optionalGroupOn(gs[1], ['b22']));
  eq('and one click finishes the job',
    toggleOptionalGroup(gs[1], ['b22'], false).slice().sort(), ['b21', 'b22', 'b23']);

  // A template with nothing optional - which is every version before v3 -
  // yields no switches at all, so the card does not render.
  eq('a template with no optional blocks has no switches',
    optionalGroups([blk('x', false), blk('y', false)]), []);
  eq('and an empty document does not crash', optionalGroups([]), []);

  // A group name that is only whitespace is not a group; the block is its own
  // switch. The 114 constraint refuses to store one, so this is belt and
  // braces for a row written before it existed.
  eq('a blank group name is not a group',
    optionalGroups([blk('z', true, '   ')]).map((g) => g.key), ['z']);

  // ---- only a CLAUSE gets its own switch ----------------------------
  //
  // Siraj, at the preview with a tick beside every line: "and only clauses
  // not bank and other info". An ungrouped optional block is its own switch
  // only when it is prose. "Account name: Rowad Al-Tatheer" is a row of DATA
  // inside a clause, and a tick beside it turns the document into a form.
  {
    const doc2 = [
      blk('p1', true),                          // a standalone paragraph
      blk('li1', true, null, null, null, 'li'), // a standalone bullet
      blk('kv1', true, null, null, null, 'kv'), // "Account name: ..."
      blk('tb1', true, null, null, null, 'table'),
      blk('sg1', true, null, null, null, 'sig'),
      blk('h1', true, null, null, null, 'h'),   // a bare optional heading
    ];
    eq('prose is a clause, a data row is not',
      optionalGroups(doc2).map((g) => g.key), ['p1', 'li1']);

    // A SECTION is untouched: blocks sharing a group are one switch whatever
    // they are made of, which is how the bank rows inside section five are
    // still covered - by their section, once, at its heading.
    const section = [
      blk('h5', true, 'bank', 'Fifth: payment', null, 'h'),
      blk('p5', true, 'bank'),
      blk('kv5', true, 'bank', null, null, 'kv'),
    ];
    const gs2 = optionalGroups(section);
    eq('a section is one switch', gs2.map((g) => g.key), ['bank']);
    eq('and it still carries every block, data rows included',
      gs2[0].ids, ['h5', 'p5', 'kv5']);
    eq('labelled by its heading', gs2[0].label, 'Fifth: payment');

    // THE WAY BACK. A data row that is already switched off keeps its switch,
    // or a release would have deleted a clause with no way to restore it.
    eq('a data row already switched off keeps its switch',
      optionalGroups(doc2, ['kv1']).map((g) => g.key), ['p1', 'li1', 'kv1']);
    eq('and its order is still the document\u2019s',
      optionalGroups(doc2, ['kv1', 'sg1']).map((g) => g.key),
      ['p1', 'li1', 'kv1', 'sg1']);
    // Off-ids naming blocks that are not optional change nothing.
    eq('a stale off-id conjures no switch',
      optionalGroups(doc2, ['ghost']).map((g) => g.key), ['p1', 'li1']);
  }

  // ---- reading the choice back --------------------------------------
  //
  // The choice is made on the task now and spent on every contract it makes,
  // so the two screens that only SHOW it need one line of prose. What is
  // worth protecting: the number after "of" and the names after the colon
  // can never disagree about how many clauses are off.
  eq('nothing optional, nothing to say', clauseChoiceSummary([], []), '');
  eq('all on says so, and counts', clauseChoiceSummary(gs, []),
    'All 3 optional clauses included.');
  eq('one switch is singular',
    clauseChoiceSummary(optionalGroups([blk('only', true, 'g', 'Bank details')]), []),
    'All 1 optional clause included.');
  eq('one off names it', clauseChoiceSummary(gs, off1),
    '1 of 3 excluded: Fourth: terms.');
  eq('two off name both',
    clauseChoiceSummary(gs, [...off1, 'b36', 'b37']),
    '2 of 3 excluded: Fourth: terms, Sixth: notices.');
  // A lone block has no heading. It still COUNTS - "1 of 3" with no name is
  // right, "nothing excluded" would be a lie.
  eq('an unlabelled switch counts without naming itself',
    clauseChoiceSummary(gs, ['b15']), '1 of 3 excluded.');
  eq('and rides in the count beside the ones that do have names',
    clauseChoiceSummary(gs, ['b15', ...off1]),
    '2 of 3 excluded: Fourth: terms and 1 more.');

  // ---- the switches, in the document --------------------------------
  //
  // Siraj: "put a check next to the clause". What is worth protecting is one
  // thing and it is not cosmetic: THE PREVIEW AND THE PRINT SHOW THE SAME
  // BLOCKS. A stub row is allowed to appear where a clause was switched off,
  // and nothing else may differ.
  {
    const rows = previewRows(doc, gs, off1);
    eq('the drawn blocks are exactly the printed ones',
      rows.filter((r) => r.block).map((r) => r.block.id),
      visibleBlocks(doc, off1).map((b) => b.id));
    // The switched-off section leaves one stub, not three.
    eq('an excluded clause is one row, not none and not three',
      rows.filter((r) => r.group && !r.on).map((r) => r.group.key), ['terms']);
    eq('and the stub carries no block to draw',
      rows.find((r) => r.group && !r.on).block, null);
    // A switch rides on the FIRST block of its clause; the rest are ordinary.
    eq('the tick sits on the first block of the clause',
      rows.filter((r) => r.group && r.on).map((r) => r.block.id), ['b15', 'b36']);
    eq('the other blocks of an included clause carry no tick',
      rows.filter((r) => !r.group).map((r) => r.block.id), ['b1', 'b37', 'b40']);
    eq('and the order is the document\u2019s',
      rows.map((r) => (r.block ? r.block.id : `stub:${r.group.key}`)),
      ['b1', 'b15', 'stub:terms', 'b36', 'b37', 'b40']);
  }
  {
    // Nothing off: every optional clause is drawn, each with a ticked box,
    // and the block list is the whole document.
    const rows = previewRows(doc, gs, []);
    eq('all on draws everything', rows.map((r) => r.block.id), doc.map((b) => b.id));
    eq('with three ticks', rows.filter((r) => r.group && r.on).length, 3);
    eq('and no stubs', rows.filter((r) => !r.block).length, 0);
  }
  {
    // A half-off group reads as ON, so its first block is drawn and its
    // switched-off members are not - which is what visibleBlocks does too.
    const rows = previewRows(doc, gs, ['b22']);
    eq('a half-off clause still agrees with the print',
      rows.filter((r) => r.block).map((r) => r.block.id),
      visibleBlocks(doc, ['b22']).map((b) => b.id));
    eq('and its switch reads on', rows.find((r) => r.group && r.group.key === 'terms').on, true);
  }
  {
    // A stale id - one naming a block that is not in this version at all, or
    // is not optional - drops the block, exactly as the print does. The two
    // must not part company over a value somebody edited by hand.
    const rows = previewRows(doc, gs, ['b40', 'ghost']);
    eq('a stale off-id is dropped by both',
      rows.filter((r) => r.block).map((r) => r.block.id),
      visibleBlocks(doc, ['b40', 'ghost']).map((b) => b.id));
  }
  eq('a document with no optional clauses is drawn straight through',
    previewRows(doc, [], []).map((r) => r.block.id), doc.map((b) => b.id));
  eq('and an empty document draws nothing', previewRows([], gs, []), []);

  {
    // Group before you cap: three names and a number, never a paragraph.
    const many = optionalGroups(['a', 'b', 'c', 'd', 'e'].map(
      (k) => blk(k, true, k, `Clause ${k.toUpperCase()}`)));
    eq('five off is three names and a count',
      clauseChoiceSummary(many, ['a', 'b', 'c', 'd', 'e']),
      '5 of 5 excluded: Clause A, Clause B, Clause C and 2 more.');
    eq('exactly three is three names and no tail',
      clauseChoiceSummary(many, ['a', 'b', 'c']),
      '3 of 5 excluded: Clause A, Clause B, Clause C.');
  }
}

/* -- retiring a template ---------------------------------------------- */
//
// Siraj: "also we cant delete any templates." A real delete cannot exist -
// legal.contract holds template_id and version_id ON DELETE RESTRICT, and
// 098's freeze refuses to delete a published version at all. So the verb is
// retire, and what is worth protecting is that retiring changes what is
// OFFERED and nothing else.

{
  const tpl = (o) => ({ id: o.id ?? 't1', name: o.name ?? 'UGC', archived_at: o.at ?? null });

  eq('a live template is not archived', isArchivedTemplate(tpl({})), false);
  eq('one with a date is', isArchivedTemplate(tpl({ at: '2026-09-22T10:00:00Z' })), true);
  // Half a write, which the 119 CHECK refuses to store - but a blank string
  // reaching the screen must not read as retired.
  eq('a blank date is not archived', isArchivedTemplate(tpl({ at: '   ' })), false);
  eq('nothing is not archived', isArchivedTemplate(null), false);

  const rows = [
    tpl({ id: 'a' }),
    tpl({ id: 'b', at: '2026-09-01T00:00:00Z' }),
    tpl({ id: 'c' }),
    tpl({ id: 'd', at: '2026-09-02T00:00:00Z' }),
  ];
  const sp = splitTemplates(rows);
  eq('the live ones keep their order', sp.active.map((t) => t.id), ['a', 'c']);
  eq('and so do the retired ones', sp.archived.map((t) => t.id), ['b', 'd']);
  eq('every template is in exactly one half', sp.active.length + sp.archived.length, rows.length);
  eq('splitting does not mutate the input', rows.map((t) => t.id), ['a', 'b', 'c', 'd']);
  eq('splitting nothing is two empty lists', splitTemplates([]), { active: [], archived: [] });
}

{
  // THE COMPLAINT ITSELF: the picker lists published VERSIONS and the flag is
  // on the TEMPLATE, so without this a retired template keeps being offered.
  const vs = [
    { version_id: 'v1', template_id: 'a' },
    { version_id: 'v2', template_id: 'b' },
    { version_id: 'v3', template_id: 'c' },
  ];
  eq('a retired template is not offered for a new contract',
    withoutArchived(vs, new Set(['b'])).map((v) => v.version_id), ['v1', 'v3']);
  eq('nothing retired changes nothing', withoutArchived(vs, new Set()).map((v) => v.version_id),
    ['v1', 'v2', 'v3']);
  eq('and neither does a missing set', withoutArchived(vs, null).length, 3);
  eq('retiring everything leaves an empty picker',
    withoutArchived(vs, new Set(['a', 'b', 'c'])), []);
  eq('filtering does not mutate the input', vs.length, 3);
}

{
  eq('a live template has no retired line', archivedNote({ id: 't', archived_at: null }), '');
  eq('a retired one says when',
    archivedNote({ id: 't', archived_at: '2026-09-22T10:00:00Z' }), 'Retired 22 Sep 2026');
  // A date nobody can parse still has to say the thing that matters.
  eq('an unreadable date still reads as retired',
    archivedNote({ id: 't', archived_at: 'not a date' }), 'Retired');
  eq('a nonsense month does not index off the end',
    archivedNote({ id: 't', archived_at: '2026-13-01T00:00:00Z' }), 'Retired');
  // Taken as written: a late-evening timestamp must not shift a day because
  // of where the browser is, and node and a browser must agree on "Sep".
  eq('a late-evening retirement is still that day',
    archivedNote({ id: 't', archived_at: '2026-09-22T23:30:00Z' }), 'Retired 22 Sep 2026');
  eq('a bare date works too', archivedNote({ id: 't', archived_at: '2026-01-05' }), 'Retired 5 Jan 2026');

  eq('no retired templates means no drawer', archivedToggleLabel(0, false), '');
  eq('one reads in the singular', archivedToggleLabel(1, false), 'Show 1 retired template');
  eq('several do not', archivedToggleLabel(3, false), 'Show 3 retired templates');
  eq('and the label flips when it is open', archivedToggleLabel(3, true), 'Hide 3 retired templates');
  eq('a negative count is no drawer', archivedToggleLabel(-2, false), '');

  // The confirm has to say the two things somebody needs before pressing it:
  // that this is not a delete, and that it is not a one-way door.
  const c = archiveConfirm({ id: 't', name: 'Rawad altathir UGC' });
  ok('the confirm names the template', c.includes('Rawad altathir UGC'));
  ok('it says nothing issued changes', c.includes('Nothing already issued'));
  ok('and that it can be undone', c.includes('restore'));
  ok('an unnamed template still gets a sentence',
    archiveConfirm({ id: 't', name: '  ' }).includes('this template'));
}


/* -- how long a binned task has left ----------------------------------- */
// Lifted out of SettingsView, where the PM bin formats the same thing inline
// in its JSX. A countdown is arithmetic with an off-by-one in it, and
// arithmetic in a template is arithmetic nobody tests.
{
  eq('the ordinary case', recoveryLabel(12), '12 days left');
  eq('one day is singular', recoveryLabel(1), '1 day left');
  // Zero days is not a quantity anybody acts on. "Today" is.
  eq('the last day says today', recoveryLabel(0), 'gone today');
  eq('and so does anything past it', recoveryLabel(-3), 'gone today');
  eq('a fraction does not leak into the words', recoveryLabel(2.7), '2 days left');
  eq('nonsense reads as today rather than NaN', recoveryLabel(null), 'gone today');

  // The red threshold is SEVEN, and the window is THIRTY. Worth pinning
  // both: Siraj asked for "deleted tasks stay for 7 days", which is the
  // threshold he was remembering, not the window.
  eq('the urgent threshold is seven', RECOVERY_URGENT_DAYS, 7);
  eq('a week out is urgent', recoveryUrgent(7), true);
  eq('eight days is not', recoveryUrgent(8), false);
  eq('and the last day certainly is', recoveryUrgent(0), true);
}

/* -- what identifies a task on screen ---------------------------------- */
// Siraj: "the task should have an id these all look terrible and thrown
// around". A batch has no number of its own, so this is the contract's own
// short form - an id quoted off a task and one quoted off a contract should
// look like the same kind of thing.
{
  eq('a task reads like a contract id',
    taskReference({ id: '9ae8d2ba-4c11-42f7-9a30-1d5e6b2c8f01' }), '9AE8D2BA');
  eq('and agrees with the printed one',
    taskReference({ id: '9ae8d2ba-4c11-42f7-9a30-1d5e6b2c8f01' }),
    shortContractId('9ae8d2ba-4c11-42f7-9a30-1d5e6b2c8f01'));
  eq('no id, nothing to render', taskReference({}), '');
}


/* -- a list stops at two hundred --------------------------------------- */
// Siraj's rule: "a table over ~200 rows pages or virtualises. No exceptions.
// Four thousand <tr>s in one render froze the ledger." The Register, the
// Signatures screen and Cases all already capped; the Tasks list rendered
// every batch in the workspace, which is fine with the twenty it was built
// against and is the shape of every performance bug this project has had.
{
  eq('the cap is the one the other screens use', LIST_SHOW_MAX, 200);
  const rows = Array.from({ length: 250 }, (_, i) => i);
  const c = cappedList(rows);
  eq('it draws the first two hundred', c.shown.length, 200);
  eq('and says how many are left', c.hidden, 50);
  eq('in order', c.shown[0], 0);
  // The slice and the remainder come from ONE call, so the rows on screen
  // and the sentence under them cannot disagree about what was left out.
  eq('the two halves always add up', c.shown.length + c.hidden, rows.length);
  // Under the cap nothing is hidden and nothing is copied for no reason.
  const small = [1, 2, 3];
  eq('a short list is untouched', cappedList(small).hidden, 0);
  eq('and is the same array', cappedList(small).shown, small);
  eq('exactly at the cap hides nothing',
    cappedList(Array.from({ length: 200 }, (_, i) => i)).hidden, 0);
  eq('one over hides one',
    cappedList(Array.from({ length: 201 }, (_, i) => i)).hidden, 1);
  eq('an empty list is empty', cappedList([]), { shown: [], hidden: 0 });
  eq('and nothing at all is too', cappedList(null), { shown: [], hidden: 0 });
  eq('a caller can ask for fewer', cappedList([1, 2, 3], 2), { shown: [1, 2], hidden: 1 });
}


/* -- a heading keeps its gap at the top of a page ---------------------- */
// Siraj: "move the third thing down its cut off" / "same thing for 5" -
// sections three and five, which are the two that happen to start at the top
// of a page.
//
// A block's MARGIN-TOP is discarded when it lands at the top of a page
// fragment. PADDING is not. So every other heading had its 7mm and those two
// sat jammed against the letterhead, which reads as cut off. Written as
// padding-top for that reason alone - anyone tidying it back into the margin
// shorthand reintroduces the bug, so the rule is asserted rather than
// commented.
{
  const css = printCss();
  const rule = /\.doc-h \{([^}]*)\}/s.exec(css);
  ok('there is a heading rule', !!rule);
  ok('the gap above a heading is padding', /padding-top:\s*7mm/.test(rule[1]));
  // The shorthand's FIRST value is the top one, and it has to be zero.
  // (Written as `margin:\\s*0` rather than "no non-zero margin": the obvious
  // negative form, /margin:\\s*[^0;]/, matches the SPACE after the colon,
  // because \\s* is happy to match nothing. It failed against correct code.)
  ok('and NOT a top margin, which a page break would drop',
    /margin:\s*0\b/.test(rule[1]) && !/margin-top:/.test(rule[1]));
  // Still asked to stay with its section - a heading alone at the foot of a
  // page is the other half of the same complaint.
  ok('a heading still refuses to be orphaned', /break-after: avoid/.test(rule[1]));
}


// -- an owner approves before issue (migration 128) ------------------
//
// The rules that matter:
//
//   1. THE EXEMPT LIST IS EXACTLY THREE KEYS, and they are the three the
//      issue path writes. It is duplicated in the migration's trigger - the
//      database has to hold the rule whether or not this screen is the
//      caller - so this asserts what the two lists must agree on. Wrong in
//      the permissive direction and an edit stops clearing the approval;
//      wrong in the strict direction and NOTHING CAN EVER BE ISSUED, because
//      pressing Issue would clear the approval one statement before the gate
//      checks it.
//   2. OWNER ONLY. Siraj: "contract needs to be signed by owners". Admin and
//      legal are not owners, and the screen must not offer what 128 refuses.
{
  eq('the exempt keys are exactly the three the issue path writes',
    [...APPROVAL_EXEMPT_KEYS].sort(), [FINGERPRINT_KEY, ISSUED_AT_KEY, 'id'].sort());
  eq('there are three of them', APPROVAL_EXEMPT_KEYS.length, 3);

  eq('the seal does not clear an approval', changeClearsApproval(FINGERPRINT_KEY), false);
  eq('nor the issued-at stamp', changeClearsApproval(ISSUED_AT_KEY), false);
  eq('nor the contract number', changeClearsApproval('id'), false);
  eq('but the fee does', changeClearsApproval('amount'), true);
  eq('and so does the optional-clause choice', changeClearsApproval(OPT_OFF_KEY), true);
  eq('and a table', changeClearsApproval(`${TABLE_KEY_PREFIX}abc`), true);
  eq('an unnamed key clears it - unknown means it counts', changeClearsApproval(''), true);
  eq('and null does too', changeClearsApproval(null), true);

  eq('an owner may approve', canApprove('owner'), true);
  eq('case and spacing do not matter', canApprove(' OWNER '), true);
  eq('an admin may not', canApprove('admin'), false);
  eq('nor legal', canApprove('legal'), false);
  eq('nor anybody else',
    ['marketing', 'sales', 'operations', 'finance', 'member', 'key_account'].map(canApprove),
    [false, false, false, false, false, false]);
  eq('no role is not an owner', canApprove(null), false);

  ok('an unapproved draft says an owner has to approve it',
    /approve/i.test(String(cannotIssue({ status: 'draft', approved_at: null }))));
  eq('an approved draft can be issued',
    cannotIssue({ status: 'draft', approved_at: '2026-09-23T10:00:00Z' }), null);
  ok('a blank approval is no approval', !!cannotIssue({ status: 'draft', approved_at: '   ' }));
  ok('an issued contract is already out',
    /already out/.test(String(cannotIssue({ status: 'issued', approved_at: 'x' }))));
  ok('so is a signed one', !!cannotIssue({ status: 'signed', approved_at: 'x' }));
  ok('nothing loaded says so', !!cannotIssue(null));

  eq('not approved', approvalNote({ status: 'draft', approved_at: null }, {}), 'Not approved yet.');
  // An issued contract from before 128 has no approval and never will. Saying
  // "not approved yet" about it would read as a defect in a document already
  // out in the world.
  eq('an older issued contract says why it has none',
    approvalNote({ status: 'issued', approved_at: null }, {}),
    'Issued before approvals were recorded.');
  eq('who and when',
    approvalNote({ status: 'draft', approved_at: 'x' }, { who: 'Siraj', at: '23 Sep' }),
    'Approved by Siraj on 23 Sep.');
  eq('when only', approvalNote({ status: 'draft', approved_at: 'x' }, { at: '23 Sep' }),
    'Approved on 23 Sep.');
  eq('who only', approvalNote({ status: 'draft', approved_at: 'x' }, { who: 'Siraj' }),
    'Approved by Siraj.');
  eq('neither, but approved', approvalNote({ status: 'draft', approved_at: 'x' }, {}), 'Approved.');
}

/* -- the owner's signing line on the paper (128, 129) ----------------
 *
 * The half of "signed by owners" that is made of ink. What is being pinned
 * here, in order of how much it would cost to get wrong:
 *
 *   1. AN UNAPPROVED CONTRACT PRINTS NO SIGNING LINE. A blank rule under the
 *      words "Approved for issue" is an invitation to sign a document nobody
 *      approved - the exact outcome the approval gate exists to prevent.
 *   2. The approval does not touch the fingerprint. It is meta, like the
 *      number and the supersede lines; folding it in would make every
 *      already-issued contract verify as "differs".
 *   3. The name is escaped and direction-isolated, because it is a person's
 *      name typed by a person into a profile.
 */
{
  eq('no approval, nothing to print', printApproval({ status: 'draft' }), undefined);
  eq('a blank timestamp is not an approval',
    printApproval({ approved_at: '   ', approved_name: 'Siraj' }), undefined);
  eq('nothing loaded prints nothing', printApproval(null), undefined);
  eq('undefined prints nothing', printApproval(undefined), undefined);
  eq('the date is the day, not the instant',
    printApproval({ approved_at: '2026-09-23T22:40:11.512Z', approved_name: 'Siraj Q' }),
    { name: 'Siraj Q', on: '2026-09-23' });
  eq('a space-separated timestamp gives the same day',
    printApproval({ approved_at: '2026-09-23 22:40:11+03', approved_name: 'Siraj Q' }).on,
    '2026-09-23');
  eq('the name is trimmed',
    printApproval({ approved_at: '2026-09-23T00:00:00Z', approved_name: '  Siraj Q  ' }).name,
    'Siraj Q');
  // 128: an approval with no named actor is a real state. It still prints -
  // the approval is the timestamp, and the line says so with the name blank.
  eq('an approval with nobody named still prints',
    printApproval({ approved_at: '2026-09-23T00:00:00Z' }),
    { name: '', on: '2026-09-23' });

  // The caption carries both languages whichever way the document runs, like
  // the fingerprint's. Arabic is checked by codepoint, not by eye.
  const ALEF_AIN = '\u0627\u0639';
  ok('the caption is bilingual in an English document',
    approvalCaption('ltr').includes('Approved for issue')
    && approvalCaption('ltr').includes(ALEF_AIN));
  ok('and in an Arabic one', approvalCaption('rtl').includes(ALEF_AIN)
    && approvalCaption('rtl').includes('Approved for issue'));
  ok("the document's own language leads", approvalCaption('rtl').indexOf(ALEF_AIN) === 0);
  ok('and in English the English does',
    approvalCaption('ltr').indexOf('Approved') === 0);

  const sheet = (meta) => contractPrintHTML({
    title: 'c', dir: 'ltr', values: {},
    blocks: [{ block_type: 'p', content: { text: 'body text' } }],
    meta,
  });

  const approved = sheet({
    reference: 'AQ-2026-0108', fingerprint: 'ABCD 1234',
    approval: printApproval({ approved_at: '2026-09-23T10:00:00Z', approved_name: 'Siraj Q' }),
  });
  // The DIV, not the class name: every class in this file also appears in
  // printCss, in the head, on every page - so `includes('doc-approval')` is
  // true of a document that prints no signing line at all, and a test written
  // that way passes whatever the renderer does.
  const LINE = '<div class="doc-approval">';
  ok('an approved contract prints the signing line', approved.includes(LINE));
  ok('with the approver on it', approved.includes('<bdi>Siraj Q</bdi>'));
  ok('a rule to sign on', approved.includes('doc-approval-r'));
  ok('and the date it was approved', approved.includes('2026-09-23'));
  // Before the seal, after the agreement. The seal is a footnote about the
  // document; the signature is part of what is being handed over.
  ok('the signing line comes before the seal',
    approved.indexOf(LINE) < approved.indexOf('<div class="doc-fp">'));
  ok('and after the body', approved.indexOf('body text') < approved.indexOf(LINE));

  const draft = sheet({ status: 'draft', approval: printApproval({ status: 'draft' }) });
  ok('AN UNAPPROVED DRAFT PRINTS NO SIGNING LINE', !draft.includes(LINE));
  ok('not even the caption', !draft.includes('Approved for issue'));
  // ...and it still prints everything else, so the check above is not passing
  // because the document came out empty.
  ok('while printing the contract itself', draft.includes('body text'));

  const nameless = sheet({
    approval: printApproval({ approved_at: '2026-09-23T10:00:00Z' }),
  });
  ok('an approval with no name still prints its line',
    nameless.includes('<div class="doc-approval-r"></div>'));
  ok('with a blank held above the rule', nameless.includes('&nbsp;'));

  const nasty = sheet({
    approval: printApproval({
      approved_at: '2026-09-23T10:00:00Z',
      approved_name: '<script>alert(1)</script>',
    }),
  });
  ok('a name is escaped', !nasty.includes('<script>'));
  ok('and still shown', nasty.includes('&lt;script&gt;'));

  // The guarantee that keeps every contract issued before today verifying:
  // the approval lives in meta, and meta is not in the canonical.
  {
    const blocks = [{ block_type: 'p', content: { text: 'Owed {{ amount }}' } }];
    const values = { amount: '100' };
    const withApproval = contractPrintHTML({
      title: 'c', dir: 'ltr', blocks, values,
      meta: { approval: { name: 'Siraj Q', on: '2026-09-23' } },
    });
    const without = contractPrintHTML({ title: 'c', dir: 'ltr', blocks, values, meta: {} });
    ok('the contract itself prints either way',
      withApproval.includes('Owed <bdi>100</bdi>') && without.includes('Owed <bdi>100</bdi>'));
    // Byte for byte: take the signing line out of the approved page and what
    // is left IS the unapproved page. Nothing else on the sheet moved, which
    // is what "the approval is meta, not content" has to mean for the seal to
    // keep verifying every contract issued before today.
    eq('and the approval changes NOTHING else on the page',
      withApproval.replace(/<div class="doc-approval">[\s\S]*?<\/div><\/div>/, ''),
      without);
  }
}

console.log(`legal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
