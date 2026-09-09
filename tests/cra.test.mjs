/**
 * The contract app's rules - public/contracts/contract-rules.js
 *
 * Requires the shipped file itself; the contract app has no build step.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  pageOf, isSafeToAutoRetry, isTransientError, vendorIdentifier,
  findVendorByIdentifier, categoryLabel,
} = require('../public/contracts/contract-rules.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/* -- Which requests may be sent again -------------------------------- */
eq('a read with no method is a GET', isSafeToAutoRetry({}), true);
eq('and an explicit GET', isSafeToAutoRetry({ method: 'GET' }), true);
eq('lowercase counts', isSafeToAutoRetry({ method: 'get' }), true);
eq('HEAD is safe too', isSafeToAutoRetry({ method: 'HEAD' }), true);
eq('a POST is never re-sent', isSafeToAutoRetry({ method: 'POST' }), false);
eq('nor a PATCH', isSafeToAutoRetry({ method: 'PATCH' }), false);
eq('nor a PUT', isSafeToAutoRetry({ method: 'PUT' }), false);
eq('nor a DELETE - it may have deleted', isSafeToAutoRetry({ method: 'DELETE' }), false);
eq('called with nothing at all', isSafeToAutoRetry(), true);
eq('a body on a GET does not change the answer',
  isSafeToAutoRetry({ method: 'GET', body: '{}' }), true);

/* -- Which failures are worth waiting out ---------------------------- */
eq('a dropped connection', isTransientError('Failed to fetch'), true);
eq('firefox says it differently', isTransientError('NetworkError when attempting to fetch'), true);
eq('a gateway timeout', isTransientError('Request failed with 504'), true);
eq('a sleeping service', isTransientError('502 Bad Gateway'), true);
eq('an overloaded one', isTransientError('503 Service Unavailable'), true);
eq('the word timeout on its own', isTransientError('upstream timed out'), true);
eq('a validation message is not transient', isTransientError('iban: field required'), false);
eq('nor a permission one', isTransientError('Admin access required'), false);
eq('nor a 404', isTransientError('Request failed with 404'), false);
eq('nothing at all is not transient', isTransientError(''), false);
eq('and neither is undefined', isTransientError(undefined), false);

/* -- The number a vendor is known by --------------------------------- */
const licensed = { name: 'Reem Trading Est.', license_number: '1010101010', id_number: '' };
const idOnly = { name: 'Mohammed A', license_number: '', id_number: '2233445566' };
const both = { name: 'Both', license_number: 'L-1', id_number: 'I-1' };

eq('a licensed vendor is known by the licence', vendorIdentifier(licensed), '1010101010');
eq('a model or a van is known by the ID', vendorIdentifier(idOnly), '2233445566');
eq('the licence wins when there are both', vendorIdentifier(both), 'L-1');
eq('no vendor, no number', vendorIdentifier(null), '');
eq('a vendor with neither', vendorIdentifier({ name: 'Nobody' }), '');
eq('whitespace is not a number', vendorIdentifier({ license_number: '   ' }), '');

/* -- Finding one ------------------------------------------------------ */
const list = [licensed, idOnly, both];
eq('by licence', findVendorByIdentifier(list, '1010101010'), licensed);
eq('by ID - the case that used to be unselectable',
  findVendorByIdentifier(list, '2233445566'), idOnly);
eq('case and padding do not matter', findVendorByIdentifier(list, '  l-1  '), both);
eq('an unknown number finds nobody', findVendorByIdentifier(list, '9999'), null);
eq('a blank never matches the vendor with a blank licence',
  findVendorByIdentifier(list, ''), null);
eq('nor does whitespace', findVendorByIdentifier(list, '   '), null);
eq('no list, no vendor', findVendorByIdentifier(null, '1010101010'), null);

// A licence is the stronger claim: if someone's ID happens to equal
// another vendor's licence, the contract belongs to the licence holder.
const collide = [{ name: 'ID holder', id_number: 'X-9' }, { name: 'Licence holder', license_number: 'X-9' }];
eq('a licence beats an ID on a collision',
  findVendorByIdentifier(collide, 'X-9').name, 'Licence holder');

/* -- Category labels -------------------------------------------------- */
eq('the lookup column is label', categoryLabel({ label: 'Influencer' }), 'Influencer');
eq('a row that only has name still reads', categoryLabel({ name: 'Influencer' }), 'Influencer');
eq('label wins over name', categoryLabel({ label: 'Influencer', name: 'old' }), 'Influencer');
eq('the key is the last resort', categoryLabel({ key: 'influencer' }), 'influencer');
eq('an empty row is an empty label, not undefined', categoryLabel({}), '');
eq('and so is no row at all', categoryLabel(null), '');

/* -- Paging ----------------------------------------------------------- */
const nums = (n) => Array.from({ length: n }, (_, i) => i + 1);

const first = pageOf(nums(495), 1, 200);
eq('a full first page', [first.rows.length, first.from, first.to], [200, 1, 200]);
eq('and it knows how many there are', [first.page, first.pages, first.total], [1, 3, 495]);
const last = pageOf(nums(495), 3, 200);
eq('the last page is the remainder', [last.rows.length, last.from, last.to], [95, 401, 495]);
eq('and the rows are the right ones', [last.rows[0], last.rows[94]], [401, 495]);

eq('a page past the end clamps to the last one', pageOf(nums(495), 99, 200).page, 3);
eq('page zero clamps to the first', pageOf(nums(495), 0, 200).page, 1);
eq('so does a negative page', pageOf(nums(495), -4, 200).page, 1);
eq('and nonsense', pageOf(nums(495), 'abc', 200).page, 1);
eq('a fractional page is floored', pageOf(nums(495), 2.7, 200).page, 2);

// The case that matters after a filter: five pages become one, and the
// view must not sit on an empty page 4.
const filtered = pageOf(nums(12), 4, 200);
eq('a shrunken list clamps the page', [filtered.page, filtered.pages, filtered.rows.length], [1, 1, 12]);

eq('an empty list is one empty page', pageOf([], 1, 200),
  { rows: [], page: 1, pages: 1, total: 0, from: 0, to: 0 });
eq('and so is a missing one', pageOf(null, 1, 200).total, 0);

eq('size 0 means all of it', pageOf(nums(495), 1, 0).rows.length, 495);
eq('and reports one page', pageOf(nums(495), 1, 0).pages, 1);
eq('a negative size means all of it too', pageOf(nums(30), 1, -5).rows.length, 30);
eq('exactly one page when the list fits', pageOf(nums(200), 1, 200).pages, 1);
eq('201 rows is two pages', pageOf(nums(201), 1, 200).pages, 2);
eq('the second of those holds one row',
  [pageOf(nums(201), 2, 200).rows, pageOf(nums(201), 2, 200).from], [[201], 201]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
