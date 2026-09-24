/**
 * What a campaign needs before marketing is asked to run it.
 *
 * The two guarantees this suite exists for:
 *
 *   1. THE TWO LISTS ARE DISJOINT. campaignBlockers is what nobody can pass;
 *      campaignBriefNeeds is what the override code opens. A field that
 *      appeared in both would be passable through one door and refused
 *      through the other, and which one a person met would depend on the
 *      order the caller checked them in.
 *   2. AN ATTACHED DECK ANSWERS THE BRIEF. Sales attach the client's own
 *      deck; making them retype it to satisfy a word count would have the
 *      rule produce worse information than it found.
 */
import {
  BRIEF_MIN_WORDS, briefWordCount, budgetGiven, briefGiven,
  campaignBlockers, campaignBriefNeeds, campaignReadyForMarketing,
  campaignGapLine, campaignBlockedLine,
} from '../.test-build/sales-readiness.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

const full = {
  client_id: 'c-1', brand_id: 'b-1', task_name: 'Ramadan reels',
  budget: 45000, details: 'One reel and two stories, Ramadan, live mid-March',
  briefFiles: 0,
};
const labels = (m) => m.map((x) => x.label);

/* -- what nobody can pass -------------------------------------------- */

eq('a complete campaign has no blockers', campaignBlockers(full), []);
eq('no client', labels(campaignBlockers({ ...full, client_id: '' })), ['The client']);
eq('no brand', labels(campaignBlockers({ ...full, brand_id: null })), ['The brand']);
eq('no name', labels(campaignBlockers({ ...full, task_name: '' })),
  ['A name for the campaign']);
eq('a name too short to find later',
  labels(campaignBlockers({ ...full, task_name: 'ab' })),
  ['A name long enough to find later']);
eq('whitespace is not a name', labels(campaignBlockers({ ...full, task_name: '   ' })),
  ['A name for the campaign']);
eq('all three at once', labels(campaignBlockers({})).length, 3);
eq('nothing at all', labels(campaignBlockers(null)), ['A campaign']);
eq('undefined too', labels(campaignBlockers(undefined)), ['A campaign']);

// The one that matters: the money and the brief are NOT refusals. Putting
// them here would make them unpassable, which is the opposite of the rule.
eq('a campaign with no budget and no brief is still not BLOCKED',
  campaignBlockers({ client_id: 'c', brand_id: 'b', task_name: 'Ramadan reels' }), []);

/* -- the budget ------------------------------------------------------- */

ok('a figure is a budget', budgetGiven(45000));
ok('a typed figure is too', budgetGiven('45000'));
ok('null is not', !budgetGiven(null));
ok('undefined is not', !budgetGiven(undefined));
ok('empty is not', !budgetGiven(''));
ok('whitespace is not', !budgetGiven('   '));
// Zero is the interesting one: it is a number, it is not a budget, and a
// check written as `!= null` would let it through.
ok('ZERO is not a budget', !budgetGiven(0));
ok('nor "0"', !budgetGiven('0'));
ok('nor a negative one', !budgetGiven(-500));
ok('nor a word', !budgetGiven('tbc'));

/* -- the brief -------------------------------------------------------- */

eq('no words', briefWordCount(''), 0);
eq('null is no words', briefWordCount(null), 0);
eq('whitespace is no words', briefWordCount('   \n  '), 0);
eq('words are counted across any whitespace', briefWordCount('one two\tthree\nfour'), 4);
eq('the floor is six', BRIEF_MIN_WORDS, 6);

ok('"asap" is not a brief', !briefGiven({ details: 'asap' }));
ok('"see the deal" is not a brief', !briefGiven({ details: 'see the deal' }));
ok('five words is one short', !briefGiven({ details: 'one two three four five' }));
ok('six words is a brief', briefGiven({ details: 'one two three four five six' }));
// The guarantee: a deck answers it, with no words at all.
ok('an attached deck IS a brief', briefGiven({ details: '', briefFiles: 1 }));
ok('and so are three of them', briefGiven({ details: '', briefFiles: 3 }));
ok('zero files is not', !briefGiven({ details: '', briefFiles: 0 }));
ok('a nonsense file count is not', !briefGiven({ details: '', briefFiles: 'lots' }));

/* -- the passable gaps ------------------------------------------------ */

eq('a complete campaign has no gaps', campaignBriefNeeds(full), []);
eq('no budget', labels(campaignBriefNeeds({ ...full, budget: null })), ['The budget']);
eq('no brief at all',
  labels(campaignBriefNeeds({ ...full, details: '' })),
  ['The brief, in words or as a file']);
// Said differently when there IS something typed, because "The brief" over a
// box somebody has already written in reads as though it was not saved.
eq('a brief that is too short says so',
  labels(campaignBriefNeeds({ ...full, details: 'too short' })),
  [`A brief of at least ${BRIEF_MIN_WORDS} words, or the deck attached`]);
eq('both gaps come back together, not one at a time',
  labels(campaignBriefNeeds({ ...full, budget: 0, details: '' })).length, 2);
eq('a deck closes the brief gap',
  campaignBriefNeeds({ ...full, details: '', briefFiles: 2 }), []);
eq('nothing at all has no gaps to report', campaignBriefNeeds(null), []);

/* -- THE DISJOINTNESS GUARANTEE --------------------------------------- */
{
  const empty = {};
  const blocked = new Set(labels(campaignBlockers(empty)));
  const passable = new Set(labels(campaignBriefNeeds(empty)));
  const both = [...blocked].filter((l) => passable.has(l));
  eq('nothing is both refused and passable', both, []);
  ok('and both lists actually have something in them',
    blocked.size > 0 && passable.size > 0);
}

/* -- ready ------------------------------------------------------------ */

ok('a complete campaign is ready', campaignReadyForMarketing(full));
ok('a missing budget is not ready', !campaignReadyForMarketing({ ...full, budget: null }));
ok('a missing client is not ready', !campaignReadyForMarketing({ ...full, client_id: '' }));
ok('nothing is not ready', !campaignReadyForMarketing(null));

/* -- what it reads like ----------------------------------------------- */

eq('one gap', campaignGapLine([{ label: 'The budget', where: '' }]), 'The budget');
eq('two gaps join with and', campaignGapLine([
  { label: 'The budget', where: '' }, { label: 'The brief', where: '' },
]), 'The budget and The brief');
eq('three gaps use commas then and', campaignGapLine([
  { label: 'A', where: '' }, { label: 'B', where: '' }, { label: 'C', where: '' },
]), 'A, B and C');
eq('no gaps is no line', campaignGapLine([]), '');
eq('nothing at all is no line', campaignGapLine(null), '');

{
  const gaps = campaignBriefNeeds({ ...full, budget: null, details: '' });
  const line = campaignBlockedLine({ task_name: 'Ramadan reels' }, gaps);
  ok('the campaign names itself', line.includes('"Ramadan reels"'));
  ok('and says what is short', line.includes('The budget'));
  ok('an unnamed one still reads',
    campaignBlockedLine({}, gaps).startsWith('This campaign is missing'));
  eq('and with nothing missing it says nothing',
    campaignBlockedLine({ task_name: 'x' }, []), '');
}

console.log(`sales-readiness: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
