import {
  vendorContractNeeds, contractPlan, contractCoverage, lineLabel, planSentence,
} from '../.test-build/vendor-contracts.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const labels = (m) => m.map((x) => x.label);

/* ── A complete influencer booking ───────────────────────────────── */
const good = () => ({
  booking: {
    platform: 'TikTok', ad_type: 'Home Ad', brand_name: null,
    payment_terms: 'split', payment_split_pct: 50,
  },
  campaign: { brand_name: 'Nice Brand' },
  vendor: { name: 'Reem Trading Est.', contact_name: 'Reem Al Otaibi', platforms: '@reem' },
  identifier: { kind: 'license', value: '1010101010' },
  bank: { iban: 'SA0000000000000000000000' },
  amount: 24000,
  posts: true,
  adTypes: ['Home Ad', 'Store Visit'],
  platformList: ['TikTok', 'Instagram'],
});
eq('a complete booking needs nothing', vendorContractNeeds(good()), []);

/* ── Signatory name is gone ──────────────────────────────────────── */
// The whole point of the change: a vendor with no signatory is still ready.
{
  const i = good();
  i.vendor.signatory_name = null;
  eq('no signatory is asked for', labels(vendorContractNeeds(i)), []);
}

/* ── Each of the eight, missing on its own ───────────────────────── */
{
  const i = good(); i.vendor.name = '';
  eq('name on the licence', labels(vendorContractNeeds(i)), ['Name on the licence or ID']);
}
{
  const i = good(); i.identifier = { kind: 'license', value: null };
  eq('licence number', labels(vendorContractNeeds(i)), ['Licence number']);
}
{
  const i = good(); i.identifier = { kind: 'id', value: null };
  eq('an ID vendor is asked for an ID', labels(vendorContractNeeds(i)), ['ID number']);
}
{
  const i = good(); i.vendor.contact_name = '  ';
  eq('the person', labels(vendorContractNeeds(i)), ['First and last name']);
}
{
  const i = good(); i.campaign = { brand_name: '' };
  eq('the brand', labels(vendorContractNeeds(i)), ['Brand name']);
}
// A booking may carry its own brand, and that is enough.
{
  const i = good(); i.campaign = null; i.booking.brand_name = 'Other Brand';
  eq('the booking can name the brand', labels(vendorContractNeeds(i)), []);
}
{
  const i = good(); i.adTypes = []; i.booking.ad_type = null;
  eq('ad type', labels(vendorContractNeeds(i)), ['Ad type']);
}
{
  const i = good(); i.platformList = []; i.booking.platform = null;
  eq('platform', labels(vendorContractNeeds(i)), ['Platform']);
}
{
  const i = good(); i.vendor.platforms = null;
  eq('their handle', labels(vendorContractNeeds(i)), ['Their name on the platform']);
}
{
  const i = good(); i.bank = null;
  eq('bank', labels(vendorContractNeeds(i)), ['Bank account']);
}
{
  const i = good(); i.bank = { iban: '' };
  eq('iban', labels(vendorContractNeeds(i)), ['IBAN']);
}
{
  const i = good(); i.amount = null;
  eq('price', labels(vendorContractNeeds(i)), ['Price, or at least one ad line']);
}
{
  const i = good(); i.amount = 0;
  eq('zero is not a price', labels(vendorContractNeeds(i)), ['Price, or at least one ad line']);
}
{
  const i = good(); i.booking.payment_terms = null;
  eq('terms', labels(vendorContractNeeds(i)), ['Payment terms']);
}

/* ── Terms that are half-answered ────────────────────────────────── */
{
  const i = good(); i.booking.payment_split_pct = null;
  eq('a split with no split', labels(vendorContractNeeds(i)), ['How much is paid up front']);
}
{
  const i = good(); i.booking.payment_terms = 'net_days'; i.booking.payment_split_pct = null;
  eq('net days with no days', labels(vendorContractNeeds(i)), ['How many days after delivery']);
}
{
  const i = good(); i.booking.payment_terms = 'net_days'; i.booking.payment_net_days = 30;
  eq('net 30 is complete', labels(vendorContractNeeds(i)), []);
}
{
  const i = good(); i.booking.payment_terms = 'on_delivery';
  eq('on delivery needs no number', labels(vendorContractNeeds(i)), []);
}
{
  const i = good(); i.booking.payment_terms = 'in_advance';
  eq('in advance needs no number', labels(vendorContractNeeds(i)), []);
}

/* ── A vendor who does not post ──────────────────────────────────── */
// A van rental has no Instagram handle. Asking for one blocks a contract
// that never needed it.
{
  const i = good();
  i.posts = false;
  i.vendor.platforms = null;
  i.platformList = []; i.booking.platform = null;
  i.identifier = { kind: 'id', value: '1122334455' };
  eq('no platform is asked of a vendor who does not post',
    labels(vendorContractNeeds(i)), []);
  // The ad type is still asked: a contract has to say what is being bought.
  i.adTypes = []; i.booking.ad_type = null;
  eq('but the ad type still is', labels(vendorContractNeeds(i)), ['Ad type']);
}

/* ── Nothing at all ──────────────────────────────────────────────── */
eq('no booking', labels(vendorContractNeeds({ ...good(), booking: null })), ['A vendor booking']);
eq('no vendor', labels(vendorContractNeeds({ ...good(), vendor: null })), ['Vendor']);
// Several at once, in the order somebody would fix them.
{
  const i = good();
  i.vendor = { name: 'Reem', contact_name: null, platforms: null };
  i.bank = null; i.amount = null; i.booking.payment_terms = null;
  eq('all of them, vendor first', labels(vendorContractNeeds(i)), [
    'First and last name', 'Their name on the platform', 'Bank account',
    'Price, or at least one ad line', 'Payment terms',
  ]);
}

/* ── One contract, or several ────────────────────────────────────── */
const LINES = [
  { id: 'l1', ad_type: 'Home Ad', platform: 'TikTok', quantity: 6, unit_price: 1000 },
  { id: 'l2', ad_type: 'Store Visit', platform: 'Instagram', quantity: 6, unit_price: 1500 },
  { id: 'l3', ad_type: 'Reminder', platform: 'TikTok', quantity: 3, unit_price: 0 },
];

eq('a line reads as a line', lineLabel(LINES[0]), '6 × Home Ad on TikTok');
eq('one of something drops the count', lineLabel({ ad_type: 'Reel', platform: 'TikTok', quantity: 1 }), 'Reel on TikTok');
eq('no platform, no "on"', lineLabel({ ad_type: 'Reel', quantity: 2 }), '2 × Reel');
eq('an unnamed line is still an ad', lineLabel({ quantity: 1 }), 'Ad');

{
  const p = contractPlan(LINES, 'combined');
  eq('combined is one contract', p.length, 1);
  eq('covering every line', p[0].lineIds, ['l1', 'l2', 'l3']);
  eq('for the whole amount', p[0].amount, 6000 + 9000);
  eq('and every ad', p[0].ads, 15);
  eq('sentence', planSentence(p), 'One contract, covering everything booked.');
}
{
  const p = contractPlan(LINES, 'per-line');
  eq('per line is three', p.length, 3);
  eq('each covers one', p.map((g) => g.lineIds), [['l1'], ['l2'], ['l3']]);
  eq('named for the line', p.map((g) => g.label), [
    '6 × Home Ad on TikTok', '6 × Store Visit on Instagram', '3 × Reminder on TikTok',
  ]);
  eq('each with its own money', p.map((g) => g.amount), [6000, 9000, 0]);
  eq('a free line is still a contract', p[2].ads, 3);
  eq('and the total is unchanged', p.reduce((s, g) => s + g.amount, 0), 15000);
  eq('sentence', planSentence(p), '3 separate contracts, one per line.');
}
// A booking with one line cannot be split, and a booking with none is still
// one contract — otherwise choosing "split" would quietly send nothing.
{
  eq('one line splits into one', contractPlan([LINES[0]], 'per-line').length, 1);
  const none = contractPlan([], 'per-line');
  eq('no lines is still one contract', none.length, 1);
  eq('named for the booking', none[0].label, 'The whole booking');
  eq('covering no lines', none[0].lineIds, []);
  eq('and no money', none[0].amount, 0);
}
// A stored line_total wins over the multiplication — the database computes it.
{
  const p = contractPlan([{ id: 'x', ad_type: 'Reel', quantity: 4, unit_price: 1000, line_total: 3600 }], 'combined');
  eq('the stored total is the total', p[0].amount, 3600);
}

/* ── How much of a booking is under contract ─────────────────────── */
{
  const c = contractCoverage([
    { id: 'l1', quantity: 6, contract_request_id: 'r1' },
    { id: 'l2', quantity: 6, contract_request_id: 'r1' },
  ]);
  eq('all covered', c.complete, true);
  eq('not partial', c.partial, false);
  eq('by one contract', c.contracts, 1);
  eq('twelve ads', c.covered, 12);
}
{
  // The state the old one-per-booking link could not express.
  const c = contractCoverage([
    { id: 'l1', quantity: 6, contract_request_id: 'r1' },
    { id: 'l2', quantity: 6, contract_request_id: null },
  ]);
  eq('partly covered', c.partial, true);
  eq('not complete', c.complete, false);
  eq('six uncovered', c.uncovered, 6);
}
{
  const c = contractCoverage([
    { id: 'l1', quantity: 6, contract_request_id: 'r1' },
    { id: 'l2', quantity: 6, contract_request_id: 'r2' },
  ]);
  eq('two contracts, both covering', c.contracts, 2);
  eq('still complete', c.complete, true);
}
{
  const c = contractCoverage([]);
  eq('nothing booked is not "covered"', c.complete, false);
  eq('nor partial', c.partial, false);
  eq('no contracts', c.contracts, 0);
}
{
  const c = contractCoverage([{ id: 'l1', quantity: 3 }]);
  eq('an uncontracted booking', c.complete, false);
  eq('three ads waiting', c.uncovered, 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
