/**
 * What the app knows about a client campaign contract before legal opens it.
 *
 * The guarantee this suite exists for: A FIELD NOBODY HAS AN ANSWER FOR IS
 * LEFT EMPTY, never guessed. A guess on a contract is indistinguishable from
 * a fact once it is printed, and the fill screen can only show legal what is
 * missing if "missing" and "blank" are the same thing.
 */
import {
  clientAddress, clientDuration, clientAmount,
  clientContractValues, clientOutputRows, clientContractTitle,
  rowPlatform, rowAds,
} from '../.test-build/client-prefill.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

const CLIENT = {
  company_name: 'Acme Trading', cr_number: '4030123456', vat_number: '3001234567890003',
  signatory_name: 'Layla Hassan', city: 'Jeddah', country: 'Saudi Arabia',
};
const CAMPAIGN = { brand_name: 'Acme Coffee', budget: 45000, contract_length: 3, contract_length_unit: 'months' };
const TODAY = '2026-09-24';

/* -- the pieces -------------------------------------------------- */

eq('address is city and country', clientAddress(CLIENT), 'Jeddah, Saudi Arabia');
eq('one of them alone still reads', clientAddress({ city: 'Jeddah' }), 'Jeddah');
eq('neither is empty, not a stray comma', clientAddress({}), '');
eq('nothing at all is empty', clientAddress(null), '');

eq('a term in months', clientDuration(CAMPAIGN), '3 months');
eq('one month is singular', clientDuration({ contract_length: 1, contract_length_unit: 'months' }), '1 month');
eq('days is the default unit', clientDuration({ contract_length: 10 }), '10 days');
eq('no term is empty', clientDuration({}), '');
eq('zero is not a term', clientDuration({ contract_length: 0, contract_length_unit: 'months' }), '');
eq('a negative one is not either', clientDuration({ contract_length: -3 }), '');
eq('nothing at all is empty', clientDuration(null), '');

eq('a budget', clientAmount(CAMPAIGN), '45000');
eq('a typed budget', clientAmount({ budget: '45000' }), '45000');
eq('ZERO is not a budget', clientAmount({ budget: 0 }), '');
eq('nor a negative one', clientAmount({ budget: -5 }), '');
eq('nor a word', clientAmount({ budget: 'tbc' }), '');
eq('nor nothing', clientAmount({}), '');

/* -- the values -------------------------------------------------- */
{
  const v = clientContractValues({ campaign: CAMPAIGN, client: CLIENT, today: TODAY });
  eq('the client', v.CL_NAME, 'Acme Trading');
  eq('the CR', v.CL_CR, '4030123456');
  eq('the VAT', v.CL_VAT, '3001234567890003');
  eq('who signs', v.CL_SIGNATORY, 'Layla Hassan');
  eq('and who represents them is the same person', v.CL_REP, 'Layla Hassan');
  eq('the address', v.CL_ADDR, 'Jeddah, Saudi Arabia');
  eq('the amount', v.CL_AMOUNT, '45000');
  eq('the date', v.C_DATE, TODAY);
  ok('and its Arabic weekday', typeof v.C_DAY === 'string' && v.C_DAY.length > 0);

  // The figure and the words come from ONE number, so they cannot disagree.
  ok('the words are the same figure', v.CL_AMOUNT_WORDS.length > 0);
  eq('and there are no words without a figure',
    clientContractValues({ campaign: { budget: 0 }, client: CLIENT, today: TODAY }).CL_AMOUNT_WORDS,
    undefined);

  // THE GUARANTEE. Nothing records these, so they must not be invented.
  for (const k of ['CL_UNI', 'CL_ZIP', 'CL_TITLE', 'CL_ACTIVITY', 'CL_PRODUCTS']) {
    eq(`${k} is left for legal to type`, v[k], undefined);
  }
}
{
  // An empty value is LEFT OUT, not written as ''. An absent row and a row
  // holding '' mean the same thing to the fill screen, and skipping is what
  // keeps a half-known client from looking filled in.
  const v = clientContractValues({ campaign: {}, client: { company_name: 'Acme' }, today: TODAY });
  eq('only what is known', Object.keys(v).sort(), ['CL_NAME', 'C_DATE', 'C_DAY'].sort());
  ok('and no empty strings at all', Object.values(v).every((x) => x !== ''));
}
{
  const v = clientContractValues({ campaign: null, client: null, today: '' });
  eq('nothing known is nothing written', v, {});
}

/* -- the outputs table ------------------------------------------- */
{
  const L = (ad_type, quantity, platform) => ({ ad_type, quantity, platform });
  const rows = clientOutputRows([
    { vendorName: 'Sara', platform: 'TikTok', handle: '@sara', lines: [L('Home Ad', 3)] },
    { vendorName: '', platform: 'Instagram', handle: '@nobody', lines: [L('Story', 2)] },
    { vendorName: 'Rawad', platform: 'Snapchat', handle: '', lines: [] },
  ]);
  eq('a booking with no vendor is left out', rows.length, 2);
  eq('the first row', rows[0],
    { CLT_INF: 'Sara', CLT_PLAT: 'TikTok', CLT_ACC: '@sara', CLT_QTY: '3 \u00d7 Home Ad' });
  // Empty, not "0": an empty cell reads as "not agreed yet", and a printed 0
  // reads as an agreement to deliver nothing.
  eq('no ads booked prints blank', rows[1].CLT_QTY, '');
  eq('and a missing handle is blank', rows[1].CLT_ACC, '');
  eq('nothing at all is no rows', clientOutputRows(null), []);
}

/* -- the ad type WITH its quantity ----------------------------------
 *
 * Siraj: "the ad amount is ad type with quantity". One cell answering two
 * questions, in the app's own quantified form - the same one the vendor
 * contract writes, so one reader serves both.
 */
{
  const L = (ad_type, quantity, platform) => ({ ad_type, quantity, platform });
  eq('one ad type, one of them, reads as itself',
    rowAds({ lines: [L('Home Ad', 1)] }), 'Home Ad');
  eq('several of one type carry the count',
    rowAds({ lines: [L('Home Ad', 3)] }), '3 \u00d7 Home Ad');
  eq('two types are listed', rowAds({ lines: [L('Home Ad', 3), L('Story', 2)] }),
    '3 \u00d7 Home Ad, 2 \u00d7 Story');
  // MERGED, not repeated: two Home Ad lines of 2 and 1 is three Home Ads,
  // which is what the client is buying.
  eq('the same type booked twice merges',
    rowAds({ lines: [L('Home Ad', 2), L('Home Ad', 1)] }), '3 \u00d7 Home Ad');
  eq('a line with no quantity counts as one', rowAds({ lines: [L('Home Ad', null)] }), 'Home Ad');
  eq('a line with no type is left out', rowAds({ lines: [L('', 5)] }), '');
  eq('no lines is empty', rowAds({ lines: [] }), '');
  eq('nothing at all is empty', rowAds(null), '');
}
{
  // The column takes ONE platform. A booking whose ads run on two cannot
  // answer it, and picking the first would tell a client the work is on one
  // channel when two were agreed.
  const L = (ad_type, quantity, platform) => ({ ad_type, quantity, platform });
  eq('the booking says so', rowPlatform({ platform: 'TikTok', lines: [L('a', 1, 'Snapchat')] }), 'TikTok');
  eq('otherwise its ads agree', rowPlatform({ lines: [L('a', 1, 'TikTok'), L('b', 1, 'TikTok')] }), 'TikTok');
  eq('and when they disagree it is left for legal',
    rowPlatform({ lines: [L('a', 1, 'TikTok'), L('b', 1, 'Instagram')] }), '');
  eq('no platform anywhere is empty', rowPlatform({ lines: [L('a', 1)] }), '');
  eq('nothing at all is empty', rowPlatform(null), '');
}

/* -- the title --------------------------------------------------- */

eq('client and brand', clientContractTitle(CAMPAIGN, CLIENT), 'Acme Trading - Acme Coffee');
eq('client alone', clientContractTitle({}, CLIENT), 'Acme Trading');
eq('brand alone', clientContractTitle(CAMPAIGN, null), 'Acme Coffee');
// Never empty: a contract with no title cannot be found in the register.
eq('neither still has a name', clientContractTitle(null, null), '(untitled client contract)');

console.log(`client-prefill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
