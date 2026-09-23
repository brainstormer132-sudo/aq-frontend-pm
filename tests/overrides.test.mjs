/**
 * Passing a rule, on purpose, with your name on it.
 *
 * The rules that matter, in order:
 *
 *   1. A REFUSED ATTEMPT IS LOGGED LIKE A PASSED ONE. A log with only the
 *      successes in it cannot tell you somebody spent ten minutes guessing
 *      the code, which is the one thing it exists to be able to tell you.
 *   2. THE CODE IS NEVER COMPARED HERE. codeShapeError says whether
 *      something is worth sending and nothing else; a client-side check of a
 *      shared secret is a check the client can skip.
 *   3. AN UNKNOWN RULE RENDERS AS ITS KEY. The log outlives the registry, and
 *      a row reading "-" in the rule column is a row nobody can account for.
 *   4. COUNTED PER PERSON, MOST PASSES FIRST. Somebody who passes a rule
 *      twice a week is the signal; sorting by date buries them under
 *      somebody who did it once.
 */
import {
  RULES, passableRules, ruleByKey, ruleLabel,
  REASON_MIN, REASON_MAX, reasonError, normaliseReason,
  CODE_MIN, CODE_MAX, codeShapeError,
  actorLabel, overrideTally, byPerson, byRule,
  sortOverrides, filterOverrides, overrideSummary, bookingContractGap,
} from '../.test-build/overrides.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

// `in`, not `??`. Half these assertions pass NULL on purpose - an actor with
// no name on file is the case being tested - and `??` would quietly hand back
// the default for exactly those, so the suite would assert nothing.
const row = (o = {}) => {
  const d = (k, fallback) => (k in o ? o[k] : fallback);
  return {
    id: d('id', 'r1'),
    rule_key: d('rule_key', 'booking_complete_without_contract'),
    entity_kind: d('entity_kind', 'pm_task'),
    entity_id: d('entity_id', 't1'),
    entity_name: d('entity_name', 'Rabea tea - Rawad Media'),
    actor: d('actor', 'u1'),
    actor_name: d('actor_name', 'Sara'),
    reason: d('reason', 'Vendor is a relative of the owner, agreed verbally.'),
    passed: d('passed', true),
    created_at: d('created_at', '2026-09-10T10:00:00Z'),
  };
};

// -- 1. the registry ------------------------------------------------
{
  ok('there are rules', RULES.length >= 2);
  ok('every rule has a key, a label, what it says when it blocks, and why',
    RULES.every((r) => r.key && r.label && r.blocked && r.why));
  // Stated, not left to default. `undefined` would read as not-passable by
  // accident, and a rule that is wired but reads as unwired is a rule people
  // are told they cannot pass when they can.
  ok('every rule says outright whether the code opens it',
    RULES.every((r) => typeof r.passable === 'boolean'));
  ok('at least one rule IS passable - otherwise the code opens nothing',
    passableRules().length >= 1);
  ok('passableRules is a subset of RULES',
    passableRules().every((r) => RULES.includes(r)));
  ok('and it is exactly the ones marked passable',
    passableRules().length === RULES.filter((r) => r.passable).length);
  ok('the keys are unique', new Set(RULES.map((r) => r.key)).size === RULES.length);
  // Keys go in the database and into URLs; a key with a space or a capital
  // in it is a key somebody will mistype once and never find again.
  ok('the keys are lower snake case', RULES.every((r) => /^[a-z][a-z0-9_]*$/.test(r.key)));
  // The blocked line is read at the moment somebody is stopped, so it has to
  // be a sentence, not a label.
  ok('every blocked line is a sentence', RULES.every((r) => /[.!]$/.test(r.blocked)));

  eq('a known rule resolves', ruleByKey('booking_complete_without_contract')?.key,
    'booking_complete_without_contract');
  eq('whitespace does not stop it resolving',
    ruleByKey('  booking_complete_without_contract  ')?.key, 'booking_complete_without_contract');
  eq('an unknown rule resolves to nothing', ruleByKey('nope'), null);
  eq('so does nothing', ruleByKey(null), null);

  // Rule 3.
  eq('a known rule has its label', ruleLabel('booking_complete_without_contract'),
    'A finished booking needs a contract');
  eq('an unknown rule renders as its key', ruleLabel('retired_rule_from_2025'),
    'retired_rule_from_2025');
  eq('no rule at all still says something', ruleLabel(''), '(no rule named)');
  eq('null too', ruleLabel(null), '(no rule named)');
}

// -- 2. the reason --------------------------------------------------
{
  eq('nothing is refused', typeof reasonError(''), 'string');
  eq('whitespace is nothing', typeof reasonError('  \n '), 'string');
  ok('"urgent" is refused', !!reasonError('urgent'));
  ok('"Siraj said" is refused', !!reasonError('Siraj said'));
  eq('a real reason passes', reasonError('Vendor is a relative, agreed verbally.'), null);
  eq('exactly the floor passes', reasonError('a'.repeat(REASON_MIN)), null);
  ok('one under the floor is refused', !!reasonError('a'.repeat(REASON_MIN - 1)));
  eq('exactly the ceiling passes', reasonError('a'.repeat(REASON_MAX)), null);
  ok('one over the ceiling is refused', !!reasonError('a'.repeat(REASON_MAX + 1)));
  ok('padding does not buy a pass', !!reasonError(`   ${'a'.repeat(REASON_MIN - 1)}   `));
  eq('a pasted reason collapses', normaliseReason(' two\n\nlines '), 'two lines');
}

// -- 3. the code, which is not checked here -------------------------
{
  eq('nothing typed', typeof codeShapeError(''), 'string');
  eq('whitespace only', typeof codeShapeError('   '), 'string');
  ok('too short', !!codeShapeError('a'.repeat(CODE_MIN - 1)));
  eq('exactly the minimum is the right shape', codeShapeError('a'.repeat(CODE_MIN)), null);
  eq('exactly the maximum is the right shape', codeShapeError('a'.repeat(CODE_MAX)), null);
  ok('too long', !!codeShapeError('a'.repeat(CODE_MAX + 1)));

  // Rule 2, stated as the thing that would be noticed: this module has no
  // opinion about WHICH code is right. Two different well-shaped codes are
  // equally acceptable to it, because the comparison is the database's.
  eq('one well-shaped code', codeShapeError('letmein123'), null);
  eq('another well-shaped code', codeShapeError('totally-wrong-code'), null);
  // And nothing exported from here takes a code and a hash, or two codes.
  ok('nothing here compares a code',
    !Object.keys({ codeShapeError }).some((k) => /verify|check|match|compare/i.test(k)));
}

// -- 4. who did it --------------------------------------------------
{
  eq('a name', actorLabel(row({ actor_name: 'Sara' })), 'Sara');
  eq('an id and no name', actorLabel(row({ actor_name: null })),
    'somebody without a name on file');
  eq('neither', actorLabel(row({ actor: null, actor_name: null })), 'nobody we can name');
  eq('a blank name is no name', actorLabel(row({ actor_name: '   ' })),
    'somebody without a name on file');
}

// -- 5. the counts. Rule 1 lives here. ------------------------------
{
  const rows = [
    row({ id: 'a', actor: 'u1', actor_name: 'Sara', created_at: '2026-09-10T10:00:00Z' }),
    row({ id: 'b', actor: 'u1', actor_name: 'Sara', created_at: '2026-09-12T10:00:00Z' }),
    row({ id: 'c', actor: 'u2', actor_name: 'Omar', created_at: '2026-09-11T10:00:00Z' }),
    row({ id: 'd', actor: 'u2', actor_name: 'Omar', passed: false, created_at: '2026-09-13T10:00:00Z',
      reason: 'Trying to close the campaign before the weekend.' }),
  ];

  eq('the totals', overrideTally(rows), { passed: 3, refused: 1, people: 2 });
  eq('nothing at all', overrideTally([]), { passed: 0, refused: 0, people: 0 });

  // Rule 1: a refused attempt is counted, not dropped.
  eq('a refusal on its own still counts',
    overrideTally([row({ passed: false })]), { passed: 0, refused: 1, people: 0 });
  // ...and `people` counts who actually PASSED one, not who tried.
  eq('a refusal does not make somebody an overrider',
    overrideTally([row({ actor: 'u9', passed: false })]).people, 0);

  // Rule 4.
  eq('counted per person, most passes first',
    byPerson(rows).map((p) => [p.name, p.passed, p.refused]),
    [['Sara', 2, 0], ['Omar', 1, 1]]);
  eq('and each carries their most recent',
    byPerson(rows).map((p) => p.last),
    ['2026-09-12T10:00:00Z', '2026-09-13T10:00:00Z']);

  // Somebody with one recent pass must NOT outrank somebody with three old
  // ones. This is the assertion that fails if the sort goes back to by-date.
  eq('three old passes outrank one new one',
    byPerson([
      row({ id: '1', actor: 'old', actor_name: 'Old', created_at: '2026-01-01T00:00:00Z' }),
      row({ id: '2', actor: 'old', actor_name: 'Old', created_at: '2026-01-02T00:00:00Z' }),
      row({ id: '3', actor: 'old', actor_name: 'Old', created_at: '2026-01-03T00:00:00Z' }),
      row({ id: '4', actor: 'new', actor_name: 'New', created_at: '2026-09-20T00:00:00Z' }),
    ]).map((p) => p.name), ['Old', 'New']);

  // An unnamed actor is folded into one line, not dropped: the totals on
  // this screen must agree with the totals above it.
  const withGhost = [...rows, row({ id: 'e', actor: null, actor_name: null })];
  eq('unnamed passes are one line, not none',
    byPerson(withGhost).length, 3);
  eq('and the per-person passes add up to the total',
    byPerson(withGhost).reduce((n, p) => n + p.passed, 0), overrideTally(withGhost).passed);
  eq('refusals add up too',
    byPerson(withGhost).reduce((n, p) => n + p.refused, 0), overrideTally(withGhost).refused);

  // A later row can supply a name an earlier one lacked.
  eq('a name found later is used',
    byPerson([
      row({ id: '1', actor: 'u5', actor_name: null }),
      row({ id: '2', actor: 'u5', actor_name: 'Laila' }),
    ])[0].name, 'Laila');
}

// -- 6. grouped by rule ---------------------------------------------
{
  const rows = [
    row({ id: 'a', rule_key: 'booking_complete_without_contract' }),
    row({ id: 'b', rule_key: 'booking_complete_without_contract' }),
    row({ id: 'c', rule_key: 'contract_request_incomplete' }),
    row({ id: 'd', rule_key: 'retired_rule', passed: false }),
  ];
  eq('most passed first, and a retired rule keeps its key',
    byRule(rows).map((r) => [r.label, r.passed, r.refused]),
    [['A finished booking needs a contract', 2, 0],
      ['A contract request needs its details', 1, 0],
      ['retired_rule', 0, 1]]);
  eq('the grouped passes add up',
    byRule(rows).reduce((n, r) => n + r.passed, 0), overrideTally(rows).passed);
}

// -- 7. order and search --------------------------------------------
{
  const rows = [
    row({ id: 'a', created_at: '2026-09-01T00:00:00Z' }),
    row({ id: 'b', created_at: '2026-09-20T00:00:00Z' }),
  ];
  eq('newest first', sortOverrides(rows).map((r) => r.id), ['b', 'a']);
  eq('ties break on id',
    sortOverrides([row({ id: 'z' }), row({ id: 'y' })]).map((r) => r.id), ['y', 'z']);

  const many = [
    row({ id: 'a', entity_name: 'Rabea tea - Rawad Media', reason: 'Relative of the owner, verbal deal.' }),
    row({ id: 'b', entity_name: 'Almarai', actor_name: 'Omar', reason: 'Client signed their own paper.' }),
    row({ id: 'c', entity_name: 'Zain', rule_key: 'contract_request_incomplete',
      reason: 'IBAN arrives on Sunday, campaign starts Saturday.' }),
  ];
  eq('everything by default', filterOverrides(many, '').length, 3);
  eq('by the thing', filterOverrides(many, 'rabea').map((r) => r.id), ['a']);
  eq('by the person', filterOverrides(many, 'omar').map((r) => r.id), ['b']);
  eq('by a word in the reason', filterOverrides(many, 'iban').map((r) => r.id), ['c']);
  // By what the rule is CALLED, not only by its key - nobody remembers a key.
  eq('by the rule label', filterOverrides(many, 'needs its details').map((r) => r.id), ['c']);
  eq('nothing matches', filterOverrides(many, 'zzzz'), []);
}

// -- 8. the heading -------------------------------------------------
{
  eq('nothing yet', overrideSummary([]), 'No rule has been passed.');
  eq('only refusals', overrideSummary([row({ passed: false })]),
    'One attempt was refused, and no rule has been passed.');
  eq('several refusals',
    overrideSummary([row({ id: '1', passed: false }), row({ id: '2', passed: false })]),
    '2 attempts were refused, and no rule has been passed.');
  eq('one pass', overrideSummary([row()]), '1 rule passed by 1 person.');
  eq('passes and refusals',
    overrideSummary([
      row({ id: '1', actor: 'u1' }),
      row({ id: '2', actor: 'u2' }),
      row({ id: '3', actor: 'u2', passed: false }),
    ]),
    '2 rules passed by 2 people, and 1 attempt refused.');
}


// -- 9. the contract rule itself ------------------------------------
{
  const gap = (o) => bookingContractGap(o);

  // The rule is about COMPLETING, not about existing. Everything else is
  // fine with no contract, and a rule that fired on every status change is a
  // rule people learn to click through.
  eq('done with no contract is blocked',
    gap({ nextStatus: 'done', vendorName: 'Rawad Media' }),
    'Rawad Media has no contract on this booking.');
  eq('no vendor name still says something',
    gap({ nextStatus: 'done' }), 'This booking has no contract.');
  eq('pending is not blocked', gap({ nextStatus: 'pending' }), null);
  eq('on hold is not blocked', gap({ nextStatus: 'on_hold' }), null);
  // A booking that never happened owes nobody a contract, and blocking the
  // tidy-up is how a campaign ends with six live bookings nobody did.
  eq('cancelled is not blocked', gap({ nextStatus: 'cancelled' }), null);
  eq('no status at all is not blocked', gap({}), null);
  eq('case does not matter', typeof gap({ nextStatus: ' DONE ' }), 'string');

  // Either kind of contract counts.
  eq('a contract request clears it',
    gap({ nextStatus: 'done', contractRequestId: 'cr1' }), null);
  eq('a legal contract clears it',
    gap({ nextStatus: 'done', contractId: 'c1' }), null);
  // ...but an empty string is not an id.
  ok('a blank contract id does not clear it',
    !!gap({ nextStatus: 'done', contractRequestId: '   ' }));

  // The exemption.
  eq('an excused category is not blocked',
    gap({ nextStatus: 'done', categoryRequiresContract: false }), null);
  ok('a required category is blocked',
    !!gap({ nextStatus: 'done', categoryRequiresContract: true }));

  // THE ONE THAT MATTERS. A row read before migration 125 ran carries no
  // such field, and reading its absence as "excused" would switch the rule
  // off everywhere at exactly the moment nobody would notice.
  ok('an ABSENT exemption means the rule still applies',
    !!gap({ nextStatus: 'done', categoryRequiresContract: undefined }));
  ok('and so does a null one',
    !!gap({ nextStatus: 'done', categoryRequiresContract: null }));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
