/**
 * A status change that changed nothing must not report success.
 *
 * PostgREST answers an UPDATE that matched no rows with 200 and an empty
 * body. Row-level security refuses by matching nothing. So "you may not
 * touch this row" and "done" arrive at the browser identically, and a
 * handler that only checks `error` tells the user it worked.
 *
 * That is not a hypothetical. It happened four times in one week:
 *
 *   * the two registration queues had no staff policy at all (migration
 *     130), so Approve reported approved and left the row in the queue;
 *   * a client contract request said it had gone to Legal, to a queue with
 *     no reader;
 *   * a seed reported it had written 46 blocks and wrote none, because its
 *     guard recognised the wrong line;
 *   * an Ask button moved onto a function whose guard refused it.
 *
 * Every one of them was found by counting rows, never by being told.
 *
 * So: any write that sets a STATUS - the column a screen reads back to the
 * user as "issued", "signed", "approved", "complete" - must ask for the row
 * back and must say so when nothing came. Ordinary field edits are out of
 * scope on purpose; the cost of a silent no-op there is a lost keystroke,
 * not a contract everyone believes is issued.
 *
 * This reads source, like tests/paging.test.mjs and for the same reason:
 * the mistake lives in a chain of method calls, and there is no runtime to
 * inspect. The scanner is exercised against known-bad snippets below so a
 * regex that quietly stops matching cannot pass this suite vacuously.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const ROOTS = ['hooks', 'lib', 'components', 'app'];

/** Columns whose value the interface repeats back to the user as a state. */
const STATUS = /\{\s*(?:status|stage)\s*\}|\b(?:status|stage|archived_at|published_at|completed_at|reviewed_at|signed_path|issued_at|approved_at)\s*:/;

/** The row came back (or was asked for as one row). */
const ASKS = /\.select\(|\.maybeSingle\(|\.single\(/;

/** Something tests it for emptiness and throws. */
const GUARD = /if \(\s*![^)]*\)|\|\|\s*![^)]*\)/;

function closeParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}

function endOfStatement(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth <= 0) return i;
  }
  return src.length - 1;
}

/** Every status-setting update in one file, with a verdict on each. */
function scan(src, file = '?') {
  const lines = src.split('\n');
  const out = [];
  const re = /\.update\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + '.update'.length;
    const close = closeParen(src, open);
    if (close < 0) continue;
    if (!STATUS.test(src.slice(open + 1, close))) continue;
    const end = endOfStatement(src, close);
    const statement = src.slice(m.index, end + 1);
    const endLine = src.slice(0, end).split('\n').length;
    const after = lines.slice(endLine - 1, endLine + 11).join('\n');
    out.push({
      where: `${file}:${src.slice(0, m.index).split('\n').length}`,
      guarded: ASKS.test(statement) && GUARD.test(after) && /throw /.test(after),
    });
  }
  return out;
}

/* -- the scanner itself ------------------------------------------------ */

const BAD = `
  const { error } = await supabase.from('contract')
    .update({ status: 'issued' }).eq('id', id);
  if (error) throw error;
`;
const HALF = `
  const { data, error } = await supabase.from('contract')
    .update({ status: 'issued' }).eq('id', id).select('id');
  if (error) throw error;
  return data;
`;
const GOOD = `
  const { data, error } = await supabase.from('contract')
    .update({ status: 'issued' }).eq('id', id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(refusedMessage('Issuing this contract'));
`;
const SHORTHAND = `
  const { data, error } = await supabase.from('crm_deals').update({ stage }).eq('id', id);
  if (error) throw error;
`;
const NOT_A_STATUS = `
  const { error } = await supabase.from('contract').update({ title: t }).eq('id', id);
  if (error) throw error;
`;

eq('an unchecked status write is one finding', scan(BAD).length, 1);
ok('and it is a failing one', scan(BAD)[0].guarded === false);
ok('asking for the row back is not enough on its own', scan(HALF)[0].guarded === false);
ok('asking and testing what came back passes', scan(GOOD)[0].guarded === true);
ok('shorthand { stage } is a status write too', scan(SHORTHAND)[0].guarded === false);
eq('an ordinary field edit is not in scope', scan(NOT_A_STATUS).length, 0);

/* -- the repository ---------------------------------------------------- */

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next') sources(p, out);
    } else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const found = ROOTS.flatMap((r) => sources(r)).flatMap((f) => scan(readFileSync(f, 'utf8'), f));
const unguarded = found.filter((s) => !s.guarded).map((s) => s.where);

eq('every status write checks that a row changed', unguarded, []);

// A floor, so a scanner that stopped matching anything cannot pass here in
// silence. Raise it when the count genuinely grows; never lower it to go green.
ok(`the scanner still finds the status writes (${found.length})`, found.length >= 14);

console.log(`silent-refusal: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
