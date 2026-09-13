/**
 * lib/asana-import.ts - splitTags, and tags flowing onto the campaign plan.
 *
 * The Finance menu filters campaigns by their Asana tags, so the import has to
 * turn Asana's comma-separated Tags cell into pm_tasks.tags. splitTags is that
 * parse; planImport must carry the result onto the campaign.
 */
import assert from 'node:assert/strict';
import { splitTags, readRows, planImport } from '../.test-build/asana-import.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`  x ${name}\n    ${e.message}`); process.exitCode = 1; }
}

test('splitTags splits, trims, drops blanks', () => {
  assert.deepEqual(splitTags('#Transaction, Q3'), ['#Transaction', 'Q3']);
  assert.deepEqual(splitTags(' #quotation ,, #invoice '), ['#quotation', '#invoice']);
  assert.deepEqual(splitTags(''), []);
  assert.deepEqual(splitTags(undefined), []);
});

test('planImport carries the campaign tags', () => {
  const HEADER = 'Task ID,Name,Parent task,Tags,Client Account Name';
  const csv = [
    HEADER,
    '1000000000000001,Coffee Co - AQ,,"#quotation, #transaction",Coffee Company LLC',
  ].join('\n');
  const { rows } = readRows(csv);
  const plan = planImport(rows, 'Jed Deals 26');
  assert.equal(plan.campaigns.length, 1);
  assert.deepEqual(plan.campaigns[0].tags, ['#quotation', '#transaction']);
});

console.log(`\n  asana-tags: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);