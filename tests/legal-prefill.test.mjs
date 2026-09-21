import {
  ugcPrefill, ugcPrefillGaps, moneyText, isEmptyTableRow, arabicWeekday,
  UGC_TABLE_COLUMN_KEYS, UGC_REQUIRED_KEYS, ARABIC_WEEKDAYS,
  UGC_BRAND_KEY, UGC_BANK_KEYS, bankAccountLabel, bankValuesFor, matchBankAccount,
  licenceParty, vendorPickerHint, CONTRACT_NO_KEY, stampContractNumber,
  firstLast, performerName, datedValues, UGC_DATE_KEY, UGC_DAY_KEY,
  normalizeHandle, handleBody, joinPlatformHandles, fieldGroup, FIELD_GROUPS,
  parsePlatforms, joinPlatforms, parsePlatformHandles, platformHandlePairs,
  MULTI_KEYS, UGC_PLATFORM_KEY, UGC_AD_TYPE_KEY,
} from '../.test-build/legal-prefill.js';
import { contractCanonical } from '../.test-build/legal.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };

// ---- moneyText: byte-for-byte the live contract app's formatter ----
eq('money groups thousands', moneyText(9000), '9,000.00');
eq('money keeps two decimals', moneyText(1500.5), '1,500.50');
eq('money handles millions', moneyText(1234567.89), '1,234,567.89');
eq('money under a thousand', moneyText(700), '700.00');
eq('money strips existing commas', moneyText('1,500'), '1,500.00');
eq('money negative', moneyText(-250), '-250.00');
eq('money empty -> empty', moneyText(null), '');
eq('money non-numeric -> empty', moneyText('abc'), '');
eq('money zero', moneyText(0), '0.00');

// ---- the full mapping ----
const SRC = {
  vendor_name: 'Talent Agency Ltd',
  license_number: '70123',
  brand_name: 'Brand X',
  contact_name: 'Sara',
  platform_handle: '@sara',
  platforms: 'Instagram',
  ad_type: '6 x Home Ad, 3 x Reminder',
  amount: 4200,
  bank_name: 'Alinma',
  account_name: 'Talent Agency Ltd',
  account_number: '68202707824000',
  iban: 'SA8505000068202707824000',
};
const OPTS = { today: '2026-09-20', durationDays: 30 };

{
  const p = ugcPrefill(SRC, OPTS);
  eq('date is the ISO day passed in', p.values.date, '2026-09-20');
  eq('licence party leads the contract', p.values.license_name, 'Talent Agency Ltd');
  eq('licence number carried', p.values.license_number, '70123');
  eq('brand carried', p.values.brand_name, 'Brand X');
  eq('amount is the number alone, no currency word', p.values.Amount_full, '4,200.00');
  eq('duration is a day count', p.values.duration, '30');
  eq('bank carried', p.values.bank_name, 'Alinma');
  eq('iban carried', p.values.iban, 'SA8505000068202707824000');
  eq('contract number is left for the database to reserve at issue', p.values.id, '');
  eq('weekday is derived from the date', p.values.day, ARABIC_WEEKDAYS[0]);
  eq('nothing missing', ugcPrefillGaps(p), []);

  // The four influencer columns are a TABLE ROW, not single fields.
  eq('table row is the performer, not the licence party', p.tableRow.name_2, 'Sara');
  eq('table row platform', p.tableRow.platform_smart, 'Instagram');
  eq('table row handle', p.tableRow.channel_name, '@sara');
  eq('table row ad types', p.tableRow.ad_types, '6 x Home Ad, 3 x Reminder');
  eq('table keys are the seeded column order', UGC_TABLE_COLUMN_KEYS,
    ['name_2', 'platform_smart', 'channel_name', 'ad_types']);
  ok('no table key leaked into the single fields',
    UGC_TABLE_COLUMN_KEYS.every((k) => !(k in p.values)));
}

// The amount is the VENDOR'S fee. Handing this the client price is the
// 9,000-instead-of-4,200 bug the request payload already fixed; this test
// only pins the formatting, so the guard is the doc comment plus the caller.
eq('a vendor fee of 4200 does not become 9000',
  ugcPrefill({ ...SRC, amount: 4200 }, OPTS).values.Amount_full, '4,200.00');

// ---- gaps ----
{
  const p = ugcPrefill({ brand_name: 'Brand X' }, OPTS);
  eq('an unpriced booking with no vendor reports every required gap',
    ugcPrefillGaps(p),
    ['license_name', 'license_number', 'Amount_full', 'bank_name', 'account_name', 'account_number', 'iban']);
  ok('brand is not a gap when it is set', !ugcPrefillGaps(p).includes('brand_name'));
  ok('duration is not a gap when days are known', !ugcPrefillGaps(p).includes('duration'));
  eq('required keys are the template\'s nine', UGC_REQUIRED_KEYS.length, 9);
}
{
  const p = ugcPrefill(SRC, { today: '2026-09-20' });
  eq('no duration known -> empty, and reported as a gap', p.values.duration, '');
  eq('duration is the only gap', ugcPrefillGaps(p), ['duration']);
}

// ---- edge cases ----
eq('a bad today is refused rather than written through',
  ugcPrefill(SRC, { today: '20/09/2026' }).values.date, '');
// Siraj: "the 500 then saudi riyal needs to be removed". It is also the fix
// for two paths printing DIFFERENT words into one sentence - the campaign
// button passed 'SAR', the Tasks screen appended the Arabic. No caller can
// put a word there now, because there is no option to pass one.
eq('a currency passed in is ignored, because there is nowhere to put it',
  ugcPrefill(SRC, { today: '2026-09-20', currency: 'SAR' }).values.Amount_full, '4,200.00');
eq('and the Arabic one likewise',
  ugcPrefill(SRC, { today: '2026-09-20', currency: '\u0631\u064a\u0627\u0644' }).values.Amount_full,
  '4,200.00');
eq('null amount -> empty, not "0.00"',
  ugcPrefill({ ...SRC, amount: null }, OPTS).values.Amount_full, '');
eq('zero is a real agreed fee and is kept',
  ugcPrefill({ ...SRC, amount: 0 }, OPTS).values.Amount_full, '0.00');
eq('whitespace is trimmed', ugcPrefill({ ...SRC, brand_name: '  Brand X  ' }, OPTS).values.brand_name, 'Brand X');
eq('a fractional duration is rounded', ugcPrefill(SRC, { ...OPTS, durationDays: 29.6 }).values.duration, '30');
eq('a zero duration is not a duration', ugcPrefill(SRC, { ...OPTS, durationDays: 0 }).values.duration, '');
eq('no performer name -> the licence party stands in',
  ugcPrefill({ ...SRC, contact_name: null }, OPTS).tableRow.name_2, 'Talent Agency Ltd');

ok('an all-empty row is detected', isEmptyTableRow(ugcPrefill({}, OPTS).tableRow));
ok('a row with only a platform is not empty',
  !isEmptyTableRow(ugcPrefill({ platforms: 'TikTok' }, OPTS).tableRow));

// Every key produced must be one the seeded template actually registers.
{
  const SEEDED = ['id', 'date', 'day', 'license_name', 'license_number', 'brand_name',
    'name_2', 'platform_smart', 'channel_name', 'ad_types', 'Amount_full', 'duration',
    'bank_name', 'account_name', 'account_number', 'iban'];
  const p = ugcPrefill(SRC, OPTS);
  const produced = [...Object.keys(p.values), ...Object.keys(p.tableRow)];
  eq('no key outside the seeded registry', produced.filter((k) => !SEEDED.includes(k)), []);
  eq('every seeded key is accounted for', SEEDED.filter((k) => !produced.includes(k)), []);
}

// ---- the Arabic weekday ----
// 2026-09-20 is a Sunday; the week runs Sunday-first to match getUTCDay().
{
  eq('seven weekday names', ARABIC_WEEKDAYS.length, 7);
  eq('all seven are distinct', new Set(ARABIC_WEEKDAYS).size, 7);
  eq('Sunday', arabicWeekday('2026-09-20'), ARABIC_WEEKDAYS[0]);
  eq('Monday', arabicWeekday('2026-09-21'), ARABIC_WEEKDAYS[1]);
  eq('Saturday', arabicWeekday('2026-09-26'), ARABIC_WEEKDAYS[6]);
  eq('the day before a Sunday is a Saturday', arabicWeekday('2026-09-19'), ARABIC_WEEKDAYS[6]);
  // A local Date would read midnight UTC as the previous day west of
  // Greenwich; this is built from the date's own numbers instead.
  eq('the first of a month is not the last of the one before',
    arabicWeekday('2026-10-01'), ARABIC_WEEKDAYS[4]);
  eq('a leap day is a real day', arabicWeekday('2028-02-29'), ARABIC_WEEKDAYS[2]);
  eq('31 February is not', arabicWeekday('2026-02-31'), '');
  eq('month 13 is not', arabicWeekday('2026-13-01'), '');
  eq('a slash date is refused', arabicWeekday('20/09/2026'), '');
  eq('empty is refused', arabicWeekday(''), '');
  eq('a bad today leaves the day empty too',
    ugcPrefill(SRC, { today: '20/09/2026' }).values.day, '');
}

// ---- the bank picker ----
{
  const A = { id: 1, bank_name: 'Alinma', account_name: 'Talent', account_number: '682027', iban: 'SA8505000068202707824000' };
  const B = { id: 2, bank_name: 'Alinma', account_name: 'Talent', account_number: '999', iban: 'SA1122000000000000009999' };

  eq('the four bank fields', UGC_BANK_KEYS, ['bank_name', 'account_name', 'account_number', 'iban']);
  eq('the brand field', UGC_BRAND_KEY, 'brand_name');

  // Two accounts at the same bank must not read identically in the dropdown.
  eq('label shows the bank and the tail of the iban', bankAccountLabel(A), 'Alinma - SA...4000');
  ok('two accounts at one bank are distinguishable', bankAccountLabel(A) !== bankAccountLabel(B));
  ok('the whole iban is never in the label', !bankAccountLabel(A).includes(A.iban));
  eq('no bank name falls back to the account name',
    bankAccountLabel({ id: 3, account_name: 'Sara', iban: 'SA0000000000000000001234' }), 'Sara - SA...1234');
  eq('a short iban is shown as it is', bankAccountLabel({ id: 4, bank_name: 'X', iban: 'SA12' }), 'X - SA12');
  eq('nothing at all still reads as something', bankAccountLabel({ id: 5 }), 'Account');

  // Choosing an account sets all four together - a bank name from one row
  // beside an iban from another is how money goes to the wrong place.
  eq('picking an account fills all four', bankValuesFor(A),
    { bank_name: 'Alinma', account_name: 'Talent', account_number: '682027', iban: 'SA8505000068202707824000' });
  eq('picking nothing clears all four', bankValuesFor(null),
    { bank_name: '', account_name: '', account_number: '', iban: '' });
  eq('bankValuesFor covers exactly the bank keys', Object.keys(bankValuesFor(A)).sort(), [...UGC_BANK_KEYS].sort());

  // Reopening a draft should show the account it already uses as selected.
  eq('matches the account already on the contract', matchBankAccount([A, B], A.iban).id, 1);
  eq('matching ignores spacing and case',
    matchBankAccount([A, B], 'sa85 0500 0068 2027 0782 4000').id, 1);
  eq('an iban from no account matches nothing', matchBankAccount([A, B], 'SA9999'), null);
  eq('an empty iban matches nothing', matchBankAccount([A, B], ''), null);
}

// ---- who the second party is ----
{
  const solo = { id: 1, name: 'Sara', contact_name: 'Sara', license_number: '70123', id_number: '1099' };
  const noLicence = { id: 2, name: 'Noura', id_number: '1055' };
  const underOrg = { id: 3, name: 'Sara', contact_name: 'Sara', license_number: '70123',
    org: { name: 'Talent Agency Ltd', license_number: '4030' } };

  eq('talent on their own licence are the party', licenceParty(solo), { name: 'Sara', number: '70123' });
  eq('no licence falls back to the ID', licenceParty(noLicence), { name: 'Noura', number: '1055' });
  // The agency holds the licence, so the agency is the party - the performer
  // is named further down the contract, not on the licence line.
  eq('an agency licence makes the agency the party', licenceParty(underOrg),
    { name: 'Talent Agency Ltd', number: '4030' });
  eq('an org with no number of its own borrows the talent\'s',
    licenceParty({ ...underOrg, org: { name: 'Talent Agency Ltd' } }),
    { name: 'Talent Agency Ltd', number: '70123' });
  eq('no vendor at all is empty, not a crash', licenceParty(null), { name: '', number: '' });

  eq('the hint disambiguates by licence number', vendorPickerHint(solo), '70123');
  ok('the hint names the agency when there is one', vendorPickerHint(underOrg).includes('Talent Agency Ltd'));
  ok('a solo vendor gets no agency in the hint', !vendorPickerHint(solo).includes(' - '));
}

// ---- the contract number the database hands back ----
{
  const base = { license_name: 'Sara', id: '' };

  eq('a reserved number is stamped onto the values',
    stampContractNumber(base, 'AQ-2026-0007').id, 'AQ-2026-0007');
  eq('the key the template prints is the one written', CONTRACT_NO_KEY, 'id');
  ok('stamping leaves the caller\'s object alone', base.id === '');
  ok('no number is a no-op, same object back', stampContractNumber(base, null) === base);
  ok('a blank number is a no-op too', stampContractNumber(base, '   ') === base);
  // Re-issuing a numbered contract must hash the same string it hashed the
  // first time, so the identity check on the card keeps saying Verified.
  const already = { ...base, id: 'AQ-2026-0007' };
  ok('re-stamping the same number returns the same object',
    stampContractNumber(already, 'AQ-2026-0007') === already);
  eq('a number arriving with spaces is trimmed',
    stampContractNumber(base, ' AQ-2026-0008 ').id, 'AQ-2026-0008');

  // The point of reserving before sealing: the fingerprint covers the number.
  // If these two hashed the same, a contract could be issued under one number
  // and printed under another with the stamp still reading Verified.
  const blocks = [{ block_type: 'p', content: { text: 'Contract {{ id }} for {{ license_name }}' } }];
  const before = contractCanonical('v1', blocks, base);
  const after = contractCanonical('v1', blocks, stampContractNumber(base, 'AQ-2026-0007'));
  ok('sealing after the number changes what is sealed', before !== after);
  ok('the sealed text carries the number', after.includes('AQ-2026-0007'));
}

// ---- who the outputs table names, and how short ----
{
  // Saudi names on a licence run given / father / grandfather / family. The
  // table names the influencer, not their lineage.
  eq('four parts become first and last',
    firstLast('Mohammed Abdullah Salem Alqahtani'), 'Mohammed Alqahtani');
  eq('two parts are left alone', firstLast('Sara Khaled'), 'Sara Khaled');
  eq('one part comes back whole', firstLast('Rawad'), 'Rawad');
  eq('runs of whitespace do not make empty parts',
    firstLast('  Mohammed   Abdullah    Alqahtani  '), 'Mohammed Alqahtani');
  eq('nothing in, nothing out', firstLast(''), '');
  eq('null does not crash', firstLast(null), '');

  const solo = { id: 1, name: 'Sara Khaled Alotaibi', license_number: '70123' };
  const underOrg = { id: 3, name: 'Sara Khaled Alotaibi', license_number: '70123',
    org: { name: 'Talent Agency Ltd', license_number: '4030' } };

  eq('the performer is the vendor, shortened', performerName(solo), 'Sara Alotaibi');
  // The agency signs (licenceParty), but the table is about who does the work.
  eq('an agency licence does not rename the performer',
    performerName(underOrg), 'Sara Alotaibi');
  eq('the licence party is still the agency',
    licenceParty(underOrg).name, 'Talent Agency Ltd');
  eq('no vendor is an empty name', performerName(null), '');
}

// ---- the date and the weekday move together ----
{
  const v = { license_name: 'Sara' };
  // 2026-09-20 is a Sunday.
  const d = datedValues(v, '2026-09-20');
  eq('the date is set', d[UGC_DATE_KEY], '2026-09-20');
  eq('and the weekday follows it', d[UGC_DAY_KEY], ARABIC_WEEKDAYS[0]);
  ok('the caller\'s object is untouched', v[UGC_DATE_KEY] === undefined);

  // The bug this exists to stop: a date edited by hand leaving last week's
  // weekday beside it, so line four of the contract contradicts itself.
  const moved = datedValues(d, '2026-09-21');
  eq('moving the date moves the weekday', moved[UGC_DAY_KEY], ARABIC_WEEKDAYS[1]);
  eq('a junk date clears the weekday rather than keeping a stale one',
    datedValues(d, 'not-a-date')[UGC_DAY_KEY], '');
  eq('clearing the date clears the weekday', datedValues(d, '')[UGC_DAY_KEY], '');
  ok('setting the same date again is the same object', datedValues(d, '2026-09-20') === d);
}

// ---- the handle standard: one @ on the left, always ----
{
  // normalizeHandle is byte-for-byte the contract app's (app.js:3569). The
  // point is that one account has one spelling in the register.
  eq('a bare name gains the @', normalizeHandle('sara'), '@sara');
  eq('an @ already there is not doubled', normalizeHandle('@sara'), '@sara');
  eq('a pile of @ collapses to one', normalizeHandle('@@@sara'), '@sara');
  eq('surrounding space goes', normalizeHandle('  @sara  '), '@sara');
  eq('empty stays empty', normalizeHandle(''), '');
  eq('a bare @ is not a handle', normalizeHandle('@'), '');
  eq('null does not crash', normalizeHandle(null), '');
  // An inner dot or underscore is part of the name, not decoration.
  eq('the rest of the name is untouched', normalizeHandle('sara.k_92'), '@sara.k_92');

  eq('the typed part drops the @', handleBody('@sara'), 'sara');
  eq('and is already bare when it has none', handleBody('sara'), 'sara');
  eq('handleBody of nothing is nothing', handleBody(''), '');

  // One platform prints the handle alone - which is what existing contracts
  // say. Two or more name the platform, the way the app joins them.
  eq('one platform is just the handle',
    joinPlatformHandles([['Instagram', 'sara']]), '@sara');
  eq('two are labelled and joined',
    joinPlatformHandles([['Instagram', 'sara'], ['TikTok', '@sara2']]),
    'Instagram: @sara TikTok: @sara2');
  eq('a platform with no handle is dropped, not left bare',
    joinPlatformHandles([['Instagram', 'sara'], ['TikTok', '']]), '@sara');
  eq('nothing at all is an empty line', joinPlatformHandles([]), '');
  eq('only empties is an empty line',
    joinPlatformHandles([['Instagram', ''], ['TikTok', '  ']]), '');
}

// ---- several platforms on one contract ----
//
// Siraj: "if you choose more than one platform it will put two drop downs based
// on the platforms chosen". One field still holds them, comma-joined, because
// that is what the document prints and what the contract app has always
// written (app.js:3616).
{
  eq('one platform is a list of one', parsePlatforms('Instagram'), ['Instagram']);
  eq('two come back as two', parsePlatforms('Instagram, TikTok'), ['Instagram', 'TikTok']);
  eq('sloppy spacing does not make a third',
    parsePlatforms(' Instagram ,TikTok ,, '), ['Instagram', 'TikTok']);
  eq('nothing is no platforms', parsePlatforms(''), []);
  eq('null is no platforms', parsePlatforms(null), []);

  eq('joining keeps the order chosen',
    joinPlatforms(['TikTok', 'Instagram']), 'TikTok, Instagram');
  eq('the same platform twice is once',
    joinPlatforms(['Instagram', 'Instagram']), 'Instagram');
  eq('blanks do not become commas', joinPlatforms(['Instagram', '', '  ']), 'Instagram');
  eq('nothing joins to nothing', joinPlatforms([]), '');
  // The pair must survive a round trip or a saved contract loses a platform.
  eq('parse and join are the same list back',
    parsePlatforms(joinPlatforms(['Instagram', 'TikTok', 'Snapchat'])),
    ['Instagram', 'TikTok', 'Snapchat']);

  // ---- and the handle that goes with each ----
  const two = ['Instagram', 'TikTok'];
  eq('each handle goes back in its own box',
    parsePlatformHandles('Instagram: @sara TikTok: @sara2', two),
    { Instagram: 'sara', TikTok: 'sara2' });
  eq('the order in the string does not matter',
    parsePlatformHandles('TikTok: @sara2 Instagram: @sara', two),
    { Instagram: 'sara', TikTok: 'sara2' });
  eq('a platform with no handle in the line comes back empty, not missing',
    parsePlatformHandles('Instagram: @sara', two), { Instagram: 'sara', TikTok: '' });
  eq('every chosen platform gets a box even with nothing saved',
    parsePlatformHandles('', two), { Instagram: '', TikTok: '' });
  // A handle typed with a space in it must not be cut at the space.
  eq('a spaced handle stays whole',
    parsePlatformHandles('Instagram: @sara k TikTok: @s2', two),
    { Instagram: 'sara k', TikTok: 's2' });
  // One platform has never carried a label, so the whole line is its handle.
  eq('a single platform takes the whole line',
    parsePlatformHandles('@sara', ['Instagram']), { Instagram: 'sara' });
  // The contract that already exists: one platform, a bare handle, and a
  // second platform added afterwards. The handle belongs to the first.
  eq('a bare handle from before belongs to the first platform',
    parsePlatformHandles('@sara', two), { Instagram: 'sara', TikTok: '' });
  eq('no platforms is an empty map', parsePlatformHandles('@sara', []), {});

  // THE ROUND TRIP. This is the one that matters: open a saved contract, touch
  // nothing, and the line it would write back is the line it read.
  const line = 'Instagram: @sara TikTok: @sara2';
  eq('reading and writing back changes nothing',
    joinPlatformHandles(platformHandlePairs(two, parsePlatformHandles(line, two))), line);
  eq('and one platform round-trips as a bare handle',
    joinPlatformHandles(platformHandlePairs(['Instagram'],
      parsePlatformHandles('@sara', ['Instagram']))), '@sara');

  eq('pairs follow the platform order, not the map order',
    platformHandlePairs(['TikTok', 'Instagram'], { Instagram: 'a', TikTok: 'b' }),
    [['TikTok', 'b'], ['Instagram', 'a']]);
  eq('a platform the map has never heard of is a pair with no handle',
    platformHandlePairs(['Snapchat'], {}), [['Snapchat', '']]);
}

// ---- the fields you may tick more than one of ----
//
// Siraj: "one vendor could do multiple ads so this needs to be a drop down and
// choosable list". Platforms were already multi; ad types are the second, and
// they share every function, so the set is named once and asserted here rather
// than written out in two screens.
{
  eq('two fields are multi-valued, and these two',
    MULTI_KEYS, [UGC_PLATFORM_KEY, UGC_AD_TYPE_KEY]);
  eq('and they are the keys the template actually uses',
    MULTI_KEYS, ['platform_smart', 'ad_types']);

  // Ad types join and split with the same functions platforms do; if that ever
  // stops being true, the screen renders one and stores the other.
  eq('several ad types are one value',
    joinPlatforms(['Reel', 'Story', 'Post']), 'Reel, Story, Post');
  eq('and come back as several',
    parsePlatforms('Reel, Story, Post'), ['Reel', 'Story', 'Post']);
  eq('ticking the same one twice does not double it',
    joinPlatforms(['Story', 'Story']), 'Story');
  // parsePlatformHandles is not itself platform-aware - it would key on
  // anything handed to it. What keeps ad types out of the handle boxes is the
  // fill screen passing the PLATFORM list and only that (ContractFill's
  // platformList reads UGC_PLATFORM_KEY). Asserted here so the claim is
  // written down rather than assumed.
  eq('the handle map keys on whatever list it is given, so the caller decides',
    parsePlatformHandles('Reel: @a Story: @b', ['Reel', 'Story']),
    { Reel: 'a', Story: 'b' });
}

// ---- which card a field sits on ----
{
  eq('the money and the bank are together',
    ['Amount_full', 'bank_name', 'account_name', 'account_number', 'iban'].map(fieldGroup),
    ['payment', 'payment', 'payment', 'payment', 'payment']);
  eq('the vendor and their account are together',
    ['license_name', 'license_number', 'name_2', 'platform_smart', 'channel_name', 'ad_types'].map(fieldGroup),
    ['vendor', 'vendor', 'vendor', 'vendor', 'vendor', 'vendor']);
  eq('the job carries the brand, the date and the duration',
    ['brand_name', 'date', 'duration'].map(fieldGroup),
    ['contract', 'contract', 'contract']);
  // A template naming a field nobody mapped must still show it.
  eq('an unknown key falls back rather than vanishing', fieldGroup('who_knows'), 'contract');
  eq('an empty key does not crash', fieldGroup(''), 'contract');
  eq('every group in the list is reachable',
    FIELD_GROUPS.map((g) => g.key), ['contract', 'vendor', 'payment']);
}

console.log(`legal-prefill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
