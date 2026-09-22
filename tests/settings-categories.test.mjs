/**
 * Vendor categories, as the Settings screen reads them.
 *
 * The rule that matters:
 *
 *   AN ABSENT `requires_contract` MEANS THE RULE APPLIES. The column has
 *   `default true` (migration 125), so a row fetched before that migration
 *   ran carries no such field - and reading its absence as "excused" would
 *   show every category as exempt and switch the contract rule off
 *   everywhere, in the permissive direction, at the moment nobody would
 *   notice.
 */
import {
  buildVendorCategories, trackingMatchWarning,
} from '../.test-build/settings.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

const TRACKABLE = ['influencer', 'ugc'];

{
  const rows = buildVendorCategories([
    { id: '1', key: 'influencer', label: 'Influencer', requires_license: true,
      sort_order: 1, is_active: true, requires_contract: true },
    { id: '2', key: 'rentals', label: 'Rentals', requires_license: false,
      sort_order: 2, is_active: true, requires_contract: false },
    // No requires_contract at all - the pre-migration read.
    { id: '3', key: 'ugc', label: 'UGC', requires_license: false,
      sort_order: 3, is_active: true },
  ], TRACKABLE);

  eq('order is kept', rows.map((r) => r.key), ['influencer', 'rentals', 'ugc']);
  eq('the identifier still follows the licence flag',
    rows.map((r) => r.identifier), ['Licence number', 'ID number', 'ID number']);
  eq('tracking still matches on key', rows.map((r) => r.tracked), [true, false, true]);

  eq('true is required', rows[0].requiresContract, true);
  eq('false is excused', rows[1].requiresContract, false);
  // THE ONE THAT MATTERS.
  eq('absent is required', rows[2].requiresContract, true);

  eq('null is required too', buildVendorCategories(
    [{ id: '4', key: 'x', label: 'X', requires_contract: null }], TRACKABLE)[0].requiresContract,
    true);
  // Only an actual `false` excuses a category. A string, a zero or an empty
  // value arriving from a loosely typed read must not turn the rule off.
  eq('the string "false" does not excuse it', buildVendorCategories(
    [{ id: '5', key: 'x', label: 'X', requires_contract: 'false' }], TRACKABLE)[0].requiresContract,
    true);
  eq('zero does not excuse it', buildVendorCategories(
    [{ id: '6', key: 'x', label: 'X', requires_contract: 0 }], TRACKABLE)[0].requiresContract,
    true);

  eq('nothing at all is no rows', buildVendorCategories([], TRACKABLE), []);
  ok('and no warning to give about tracking', trackingMatchWarning([]) === null);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
