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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
