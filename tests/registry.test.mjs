/** lib/registry.ts - the register's pure helpers. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  pageSlice, PAGE_SIZES, DEFAULT_PAGE_SIZE,
  expiryStatus, isExpiring, EXPIRY_SOON_DAYS,
  buildClients, buildVendors, filterRows, summarise, EMPTY_FILTER,
} = require('../.test-build/registry.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);

eq('default is 10, and it is the first choice', [DEFAULT_PAGE_SIZE, PAGE_SIZES[0]], [10, 10]);
eq('the sizes on offer', [...PAGE_SIZES], [10, 50, 100]);

const first = pageSlice(nums(1815), 1, 10);
eq('a full first page of ten', [first.rows.length, first.from, first.to], [10, 1, 10]);
eq('and it knows the whole', [first.page, first.pages, first.total], [1, 182, 1815]);
eq('the tenth page starts at 91', pageSlice(nums(1815), 10, 10).from, 91);
const last = pageSlice(nums(1815), 182, 10);
eq('the last page is the remainder', [last.rows.length, last.from, last.to], [5, 1811, 1815]);

eq('a page past the end clamps', pageSlice(nums(1815), 999, 10).page, 182);
eq('page zero clamps to one', pageSlice(nums(1815), 0, 10).page, 1);
eq('a negative page clamps to one', pageSlice(nums(1815), -3, 10).page, 1);
eq('nonsense clamps to one', pageSlice(nums(1815), 'x', 10).page, 1);

// the case that matters after a filter: many pages become one.
const shrunk = pageSlice(nums(7), 12, 10);
eq('a shrunken list clamps the page', [shrunk.page, shrunk.pages, shrunk.rows.length], [1, 1, 7]);

eq('an empty list is one empty page', pageSlice([], 1, 10), { rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
eq('and a missing one', pageSlice(null, 1, 10).total, 0);
eq('size 0 means all of it', pageSlice(nums(1815), 1, 0).rows.length, 1815);
eq('size 100 gives a hundred', pageSlice(nums(1815), 1, 100).rows.length, 100);
eq('exactly one page when it fits', pageSlice(nums(50), 1, 50).pages, 1);
eq('51 rows is two pages of fifty', pageSlice(nums(51), 1, 50).pages, 2);

/* ── Expiry: the CR / licence lapse status, filter and count ─────── */

// A fixed "today" so the day arithmetic is deterministic.
const NOW = new Date('2026-09-19T12:00:00');

eq('the soon window is 30 days', EXPIRY_SOON_DAYS, 30);

eq('a past date is expired', expiryStatus('2026-09-10', NOW), 'expired');
eq('today counts as expiring soon', expiryStatus('2026-09-19', NOW), 'soon');
eq('inside the window is soon', expiryStatus('2026-10-05', NOW), 'soon');
eq('the 30th day is still soon', expiryStatus('2026-10-19', NOW), 'soon');
eq('the 31st day is ok', expiryStatus('2026-10-20', NOW), 'ok');
eq('far off is ok', expiryStatus('2026-12-31', NOW), 'ok');
eq('no date is none', expiryStatus(null, NOW), 'none');
eq('empty is none', expiryStatus('', NOW), 'none');
eq('garbage is none', expiryStatus('not-a-date', NOW), 'none');

// The row builders carry the date through: CR for a client, licence for a vendor.
const cli = buildClients({ clients: [
  { id: 'a', company_name: 'Alpha', cr_expiry: '2026-09-10' },   // expired
  { id: 'b', company_name: 'Beta',  cr_expiry: '2026-10-05' },   // soon
  { id: 'c', company_name: 'Gamma', cr_expiry: '2027-01-01' },   // ok
  { id: 'd', company_name: 'Delta' },                             // none
] });
eq('client expiry is carried onto the row', cli.map((r) => r.expiry),
  ['2026-09-10', '2026-10-05', '2027-01-01', null]);
eq('isExpiring keeps expired and soon only', cli.map((r) => isExpiring(r, NOW)),
  [true, true, false, false]);

const ven = buildVendors({ vendors: [
  { id: 1, name: 'Vend', license_expiry: '2026-10-01' },
  { id: 2, name: 'Nope' },
] });
eq('vendor licence expiry is carried onto the row', ven.map((r) => r.expiry),
  ['2026-10-01', null]);

// The filter keeps exactly the expiring rows...
const onlyExpiring = filterRows(cli, { ...EMPTY_FILTER, expiring: true }, () => [], NOW);
eq('the expiring filter keeps expired + soon', onlyExpiring.map((r) => r.name), ['Alpha', 'Beta']);
// ...and off, it keeps everything.
eq('no expiring filter keeps all', filterRows(cli, EMPTY_FILTER, () => [], NOW).length, 4);

// ...and the count that feeds the chip matches.
eq('summarise counts the expiring rows', summarise(cli, cli, NOW).expiring, 2);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
