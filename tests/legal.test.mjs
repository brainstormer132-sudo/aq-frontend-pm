import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
  EDITOR_BLOCK_TYPES, blockTypeLabel, isEditableBlockType, defaultBlockContent,
  blockText, blockKV, moveItem, withPositions, nextPosition, canPublish,
  hasRTLChars, blockAllText, detectDir,
  parsePlaceholderKeys, usedPlaceholderKeys, unknownPlaceholders, validatePlaceholderKey, fillPlaceholders,
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
eq('five editor block types', EDITOR_BLOCK_TYPES.map((b) => b.key), ['title', 'h', 'p', 'li', 'kv']);
eq('block type label', blockTypeLabel('kv'), 'Field');
eq('unknown block type label is itself', blockTypeLabel('table'), 'table');
ok('kv is editable', isEditableBlockType('kv'));
ok('clause is not editable', !isEditableBlockType('clause'));
eq('default text content', defaultBlockContent('p'), { text: '' });
eq('default kv content', defaultBlockContent('kv'), { label: '', value: '' });

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

console.log(`legal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
