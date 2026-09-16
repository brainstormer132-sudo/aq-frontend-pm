import {
  DOC_KINDS, kindLabel, statusLabel, statusBadge, groupTemplatesByKind, validateNewTemplate,
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

console.log(`legal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
