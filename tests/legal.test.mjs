import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
  EDITOR_BLOCK_TYPES, blockTypeLabel, isEditableBlockType, defaultBlockContent,
  blockText, blockKV, blockSig, moveItem, withPositions, nextPosition, canPublish,
  hasRTLChars, blockAllText, detectDir,
  parsePlaceholderKeys, usedPlaceholderKeys, unknownPlaceholders, validatePlaceholderKey, fillPlaceholders,
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
  optionalGroups, optionalGroupOn, toggleOptionalGroup,
} from '../.test-build/legal.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

// kinds
eq('four kinds, vendor first', DOC_KINDS.map((d) => d.key), ['vendor_contract', 'nda', 'client_contract', 'other']);
eq('kindLabel known', kindLabel('nda'), 'NDA');
eq('kindLabel unknown -> Other', kindLabel('zzz'), 'Other');

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
  ok('title in <title>', html.includes('<title>Rawad deal</title>'));
  ok('ltr lang en', html.includes('lang="en"') && html.includes('dir="ltr"'));
  ok('fills paragraph placeholder', html.includes('This agreement is with Rawad Media.'));
  ok('fills kv value', html.includes('12,500 SAR'));
  ok('fills bullet placeholder', html.includes('&bull; Term 12m'));
  ok('title block is centered h1', html.includes('<h1 class="doc-title">Vendor Agreement</h1>'));
  // The letterhead replaced the "AQ Creativity" text block. It is the company
  // strip now, on every page, and its own contents are asserted in
  // tests/legal-letterhead - this only checks the print path reaches it.
  ok('letterhead strip is on the sheet', html.includes('RAWAD ALTATHIR COMPANY'));
  ok('the sheet is wrapped in the repeating table', html.includes('<table class="page">')
    && html.includes('<thead>') && html.includes('<tfoot>'));
  // An ISSUED contract says nothing about its status on its face. Printing
  // "Status: Issued" on a document a vendor signs is not what the paper does.
  ok('an issued contract is not stamped with its status', !html.includes('Status: Issued'));
  ok('reference prints where the id sits on the paper', html.includes('Ref: abc12345')
    && html.includes('class="doc-ref"'));
}
{
  const html = contractPrintHTML({
    title: 'x', blocks: [{ block_type: 'p', content: { text: 'hi {{ n }}' } }],
    values: { n: '<script>alert(1)</script>' }, dir: 'rtl',
  });
  ok('rtl lang ar', html.includes('lang="ar"') && html.includes('dir="rtl"'));
  ok('escapes injected value', html.includes('&lt;script&gt;') && !html.includes('<script>alert'));
  ok('unfilled placeholder stays literal', contractPrintHTML({ title: 't', blocks: [{ block_type: 'p', content: { text: '{{ gap }}' } }], values: {}, dir: 'ltr' }).includes('{{ gap }}'));
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
  ok('the fingerprint prints once at the end', html.includes('SHA-256: ABCD 1234'));
  ok('no fingerprint line when absent', !contractPrintHTML({ title: 't', blocks: [{ block_type: 'p', content: { text: 'x' } }], values: {}, dir: 'ltr' }).includes('SHA-256:'));
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
  ok('print has the filled row', html.includes('<td>snapchat</td>') && html.includes('<td>5000</td>'));
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
  ok('sig fills its placeholders', html.includes('First party: Ahmed'));
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
  const blk = (id, opt, group, label, text) => ({
    id, version_id: 'v', workspace_id: 'w', position: 1, block_type: 'p',
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
}

console.log(`legal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
