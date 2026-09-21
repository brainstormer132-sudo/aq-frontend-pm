/**
 * Every paged read must end on a TOTAL order.
 *
 * This is the only suite in tests/ that reads source rather than a compiled
 * library, and it is deliberate. The bug it guards is invisible to every other
 * kind of test: selectAllRows and selectAllRowsParallel page with OFFSET, and
 * offset paging is only coherent when the ORDER BY is unique. With a
 * non-unique order - `created_at` on pm_tasks, which the Asana import writes
 * as a DATE so thousands of rows tie, or a vendor `name`, which duplicates by
 * design - two pages overlap and a row falls between them. The screen then
 * shows one campaign twice and silently loses another, DIFFERENTLY ON EVERY
 * LOAD. Nothing throws. The helper's own header has always said this and 22
 * of the 39 call sites ignored it anyway, which is why the rule is now
 * enforced rather than documented. The 2026-09-20 audit found 7 of the 22 by
 * reading; this test found the other 15 in a second.
 *
 * There is no runtime check to write instead: PostgREST builds the query and
 * the order lives in a chain of method calls, so the only place the mistake is
 * visible is the source. Hence a grep with a parser behind it.
 *
 * Adding a paged read? End the chain with .order('id', ...). If the table's
 * primary key is genuinely not `id`, widen ID_ORDER below rather than adding
 * an exception - an exception here is a screen that loses rows.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/** Every .ts/.tsx under these, recursively. */
const ROOTS = ['hooks', 'lib', 'components', 'app'];
const CALL = /\bselectAllRows(?:Parallel)?\s*(?:<[^>]*>)?\s*\(/g;
const ID_ORDER = /\.order\(\s*['"]id['"]/;

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * The text of one call's arguments, found by balancing parens from the open
 * one. A regex cannot do this: the argument is an arrow function full of its
 * own parens, and stopping at the first ')' would read three characters.
 * Strings are skipped so a ')' inside a select list cannot close the call.
 */
function callArgs(src, openIdx) {
  let depth = 0, i = openIdx, quote = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return null;
}

function lineOf(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

/**
 * The one paged read that is total WITHOUT an id, and why.
 *
 * pm_task_campaign_rollup is a VIEW with one row per campaign, keyed on
 * parent_task_id - so ordering by that column already gives a total order.
 * It has no `id` output column at all, so adding .order('id') would not
 * tighten anything; PostgREST would reject the query with a 400 and the
 * Dashboard and Finance would both go blank.
 *
 * This is the only exception, and it is checked rather than trusted: if the
 * rollup ever stops being ordered by parent_task_id, the assertion below
 * fails and the exception has to be re-argued.
 */
const ALLOWED = new Map([
  ['usePmTaskCampaignRollup', /\.order\(\s*['"]parent_task_id['"]/],
]);

const found = [];
for (const root of ROOTS) {
  for (const file of sources(root)) {
    const src = readFileSync(file, 'utf8');
    // The definitions themselves, not calls.
    CALL.lastIndex = 0;
    let m;
    while ((m = CALL.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 30), m.index);
      if (/function\s+$/.test(before)) continue;
      const args = callArgs(src, m.index + m[0].length - 1);
      if (args == null) continue;
      found.push({ file, line: lineOf(src, m.index), args });
    }
  }
}

// If this drops to zero the suite has stopped testing anything - most likely
// the helper was renamed and every call site went unchecked.
ok(`found paged reads to check (${found.length})`, found.length >= 8);

/** The label a call was given, which is how an exception is named. */
function labelOf(args) {
  const m = /^\s*['"]([^'"]+)['"]/.exec(args) || /['"]([^'"]+)['"]/.exec(args);
  return m ? m[1] : '';
}

const bad = [];
let exempted = 0;
for (const f of found) {
  if (ID_ORDER.test(f.args)) continue;
  const rule = ALLOWED.get(labelOf(f.args));
  if (rule) {
    // An exception still has to earn it, every run.
    ok(`${labelOf(f.args)} is still total without an id`, rule.test(f.args));
    exempted++;
    continue;
  }
  console.log(`  no .order('id') : ${f.file}:${f.line}  (${labelOf(f.args) || 'unlabelled'})`);
  bad.push(`${f.file}:${f.line}`);
}
eq('every paged read ends on a total order', bad, []);
eq('and only the rollup is exempt', exempted, ALLOWED.size);

// The helper's header is the thing a reader is sent to when this fails, so it
// has to still say the rule.
{
  const src = readFileSync('hooks/use-workflow.ts', 'utf8');
  ok('selectAllRowsParallel still documents why the order must be total',
    /Offset paging only lines up when the order is total/.test(src));
}

// And the call sites the 2026-09-20 audit named by name, so a rename that
// dodges the scan above still trips something.
{
  const src = readFileSync('hooks/use-workflow.ts', 'utf8');
  for (const label of ['useTrackingCampaigns', 'useWorkflowTasks', 'useClients',
    'useLegacyVendors vendors', 'useWorkspaceStats']) {
    const at = src.indexOf(`'${label}'`);
    ok(`${label} is still a paged read`, at > 0);
    if (at > 0) {
      const open = src.indexOf('(', src.lastIndexOf('selectAllRows', at));
      const args = callArgs(src, open);
      ok(`${label} orders by id`, !!args && ID_ORDER.test(args));
    }
  }
}

console.log(`paging: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
