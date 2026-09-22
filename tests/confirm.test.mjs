/**
 * The app's own "are you sure?".
 *
 * Two guarantees, and the second is the one that matters:
 *
 *   1. The question becomes the heading, the rest becomes the body.
 *   2. NOTHING THE CALLER WROTE IS DROPPED. Asserted against every real
 *      message in the app, not against invented ones - a confirm box that
 *      loses half its warning is worse than the browser's.
 */
import {
  confirmView, confirmShownText, normaliseMessage, confirmAutoFocus,
  DEFAULT_TITLE, TITLE_MAX,
  promptView, promptError, promptCanSubmit, promptAnswer,
} from '../.test-build/confirm.js';
import { publishWarning, newDraftWarning, editTemplateWarning } from '../.test-build/legal-doc-view.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

/* -- the split --------------------------------------------------------- */

{
  const v = confirmView({ message: 'Publish version 6? Its 43 lines freeze and can never be edited again.' });
  eq('the question is the heading', v.title, 'Publish version 6?');
  eq('and the rest is the body', v.body, 'Its 43 lines freeze and can never be edited again.');
}
{
  // A whole message that is only a question has no body, and the dialog
  // must not invent one.
  const v = confirmView({ message: 'Delete this line?' });
  eq('a bare question is all heading', v.title, 'Delete this line?');
  eq('and no body', v.body, '');
}
{
  // The body begins at the character after the question mark, not one past
  // it. A space usually hides an off-by-one here; this message has none.
  const v = confirmView({ message: 'Ready?Go.' });
  eq('the body starts right after the question mark', v.body, 'Go.');
  eq('and the heading keeps its mark', v.title, 'Ready?');
}
{
  // No question mark at all: the message stays whole, in the body, under a
  // heading that asks the question for it.
  const v = confirmView({ message: 'This will replace the file on disk.' });
  eq('no question, a standard heading', v.title, DEFAULT_TITLE);
  eq('and the message is untouched', v.body, 'This will replace the file on disk.');
}
{
  // A question long enough to be a paragraph is NOT promoted - a heading of
  // a hundred characters is worse than no heading.
  const long = `${'x'.repeat(TITLE_MAX)}? and then some.`;
  const v = confirmView({ message: long });
  eq('an over-long question stays in the body', v.title, DEFAULT_TITLE);
  eq('whole', v.body, long);
  const just = `${'x'.repeat(TITLE_MAX - 1)}? tail.`;
  eq('one under the limit is still a heading', confirmView({ message: just }).title, `${'x'.repeat(TITLE_MAX - 1)}?`);
}

/* -- 2. nothing is dropped -------------------------------------------- */
//
// Every message the app actually passes, run through the split and put back
// together. This is the assertion that would catch a "clever" split later.
{
  const REAL = [
    publishWarning(6, 43),
    publishWarning(1, 1),
    newDraftWarning(3),
    editTemplateWarning(null),
    editTemplateWarning('Rawad altathir UGC'),
    'Delete this line?',
    'Delete the heading "Fourth: terms and conditions"? The lines under it stay.',
    'Remove the signed copy? The contract goes back to issued.',
    'Delete this deal? This cannot be undone.',
    'Delete this task?',
    'Delete "scan.pdf"? This cannot be undone.',
    'A campaign was already started from this deal.',
    '',
    '   ',
  ];
  let dropped = 0;
  for (const m of REAL) {
    const shown = confirmShownText(confirmView({ message: m }));
    if (shown !== normaliseMessage(m)) {
      dropped += 1;
      console.log(`  DROPPED\n    message: ${JSON.stringify(m)}\n    shown:   ${JSON.stringify(shown)}`);
    }
  }
  eq('every real message survives the split whole', dropped, 0);
}

/* -- the buttons ------------------------------------------------------- */

eq('a plain confirm continues', confirmView({ message: 'Go?' }).confirmLabel, 'Continue');
eq('a dangerous one deletes', confirmView({ message: 'Go?', tone: 'danger' }).confirmLabel, 'Delete');
eq('and the caller can say what the verb is',
  confirmView({ message: 'Go?', tone: 'danger', confirmLabel: 'Retire it' }).confirmLabel, 'Retire it');
eq('a blank label falls back rather than showing nothing',
  confirmView({ message: 'Go?', confirmLabel: '   ' }).confirmLabel, 'Continue');
eq('cancel is cancel', confirmView({ message: 'Go?' }).cancelLabel, 'Cancel');
eq('unless the caller renames it',
  confirmView({ message: 'Go?', cancelLabel: 'Keep it' }).cancelLabel, 'Keep it');

{
  // What alert() was: one button, and it is the one that closes it. Two
  // words for the same click is a decision the reader does not have.
  const v = confirmView({ message: 'Could not move that deal.', tell: true });
  eq('a message with nothing to decide has no cancel', v.cancelLabel, '');
  eq('and its button closes', v.confirmLabel, 'Close');
}

/* -- what Enter presses ------------------------------------------------ */
//
// The one that cannot be got wrong: a destructive dialog must not open with
// its destructive button armed. The ask exists to put a step between a stray
// keystroke and a deletion; focusing Delete removes the step again.
eq('a dangerous question opens on Cancel',
  confirmAutoFocus(confirmView({ message: 'Delete it?', tone: 'danger' })), 'cancel');
eq('an ordinary one opens on the verb',
  confirmAutoFocus(confirmView({ message: 'Publish version 6? It freezes.' })), 'confirm');
eq('and a message with one button focuses it whatever the tone',
  confirmAutoFocus(confirmView({ message: 'That failed.', tone: 'danger', tell: true })), 'confirm');

eq('the tone is primary unless it is danger', confirmView({ message: 'x' }).tone, 'primary');
eq('and an unknown tone is not danger', confirmView({ message: 'x', tone: 'scary' }).tone, 'primary');

/* -- nothing at all ---------------------------------------------------- */

{
  const v = confirmView(null);
  eq('nothing still asks something', v.title, DEFAULT_TITLE);
  eq('with an empty body', v.body, '');
  ok('and both buttons', !!v.confirmLabel && !!v.cancelLabel);
}
eq('and undefined is the same', confirmView(undefined).title, DEFAULT_TITLE);

/* -- asking for a word --------------------------------------------------- */
//
// window.prompt was the last native dialog. What it could not do is the
// point of replacing it: say what is wrong with the answer BEFORE the button
// is pressed, and name its own button.

{
  const req = { message: 'Rename this brand?', label: 'Brand name', initial: 'Rabea', maxLength: 60 };
  const v = promptView(req);
  eq('it splits like any other dialog', v.title, 'Rename this brand?');
  eq('the field is labelled', v.label, 'Brand name');
  eq('and starts with what is there', v.initial, 'Rabea');
  // "Continue" is a confirm's word. A prompt is doing something to a name.
  eq('the button says Save, not Continue', v.confirmLabel, 'Save');
  eq('unless the caller names the verb',
    promptView({ ...req, confirmLabel: 'Rename it' }).confirmLabel, 'Rename it');
  eq('with no label it falls back to the question', promptView({ message: 'New name?' }).label, 'New name?');
  eq('and a prompt always has a way out', v.cancelLabel, 'Cancel');
}
{
  // A prompt is never a `tell` - there is always something to cancel, even
  // if the caller passes the flag by mistake.
  eq('tell is ignored', promptView({ message: 'x?', tell: true }).cancelLabel, 'Cancel');
}

/* -- what is wrong with the answer, said before Save is pressed ---------- */

eq('empty is refused', promptError('', {}), 'Type something first.');
eq('and so is whitespace', promptError('   ', {}), 'Type something first.');
eq('unless the caller allows it', promptError('', { required: false }), '');
eq('a real answer is fine', promptError('Rabea', {}), '');
eq('length is counted after trimming', promptError('  abc  ', { maxLength: 3 }), '');
{
  const e = promptError('abcdef', { maxLength: 4 });
  ok('too long says the limit', e.includes('4 characters at most'));
  ok('and how far over it is', e.includes('2 too many'));
}
eq('no limit means no limit', promptError('x'.repeat(500), {}), '');
eq('and nor does zero', promptError('x'.repeat(500), { maxLength: 0 }), '');

// Save and the message cannot disagree: one is defined in terms of the other.
{
  const cases = [['', {}], ['ok', {}], ['   ', {}], ['abcdef', { maxLength: 4 }],
                 ['', { required: false }], ['x', { maxLength: 1 }]];
  let disagreed = 0;
  for (const [val, req] of cases) {
    if (promptCanSubmit(val, req) !== (promptError(val, req) === '')) disagreed += 1;
  }
  eq('the button and the message always agree', disagreed, 0);
}

/* -- the answer, and what counts as no answer ---------------------------- */

eq('a new name comes back trimmed', promptAnswer('  Rabea tea  ', 'Rabea'), 'Rabea tea');
// Renaming something to the name it already has is not a rename. The old
// call site knew this and returned early; every caller gets it now.
eq('the same name is not a change', promptAnswer('Rabea', 'Rabea'), null);
eq('and neither is the same name with spaces round it', promptAnswer(' Rabea ', 'Rabea'), null);
eq('nothing typed is not an answer', promptAnswer('   ', 'Rabea'), null);
eq('with no initial, anything real is a change', promptAnswer('New', null), 'New');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
