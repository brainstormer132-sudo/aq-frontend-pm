import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
  EDITOR_BLOCK_TYPES, blockTypeLabel, isEditableBlockType, defaultBlockContent,
  blockText, blockKV, moveItem, withPositions, nextPosition, canPublish,
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

console.log(`legal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
