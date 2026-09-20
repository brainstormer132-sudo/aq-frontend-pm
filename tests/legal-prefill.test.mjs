import {
  ugcPrefill, ugcPrefillGaps, moneyText, isEmptyTableRow, arabicWeekday,
  UGC_TABLE_COLUMN_KEYS, UGC_REQUIRED_KEYS, ARABIC_WEEKDAYS,
} from '../.test-build/legal-prefill.js';

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
const OPTS = { today: '2026-09-20', currency: 'SAR', durationDays: 30 };

{
  const p = ugcPrefill(SRC, OPTS);
  eq('date is the ISO day passed in', p.values.date, '2026-09-20');
  eq('licence party leads the contract', p.values.license_name, 'Talent Agency Ltd');
  eq('licence number carried', p.values.license_number, '70123');
  eq('brand carried', p.values.brand_name, 'Brand X');
  eq('amount is formatted with the currency word', p.values.Amount_full, '4,200.00 SAR');
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
  ugcPrefill({ ...SRC, amount: 4200 }, OPTS).values.Amount_full, '4,200.00 SAR');

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
  const p = ugcPrefill(SRC, { today: '2026-09-20', currency: 'SAR' });
  eq('no duration known -> empty, and reported as a gap', p.values.duration, '');
  eq('duration is the only gap', ugcPrefillGaps(p), ['duration']);
}

// ---- edge cases ----
eq('a bad today is refused rather than written through',
  ugcPrefill(SRC, { today: '20/09/2026' }).values.date, '');
eq('no currency word -> bare amount',
  ugcPrefill(SRC, { today: '2026-09-20' }).values.Amount_full, '4,200.00');
eq('null amount -> empty, not "0.00"',
  ugcPrefill({ ...SRC, amount: null }, OPTS).values.Amount_full, '');
eq('zero is a real agreed fee and is kept',
  ugcPrefill({ ...SRC, amount: 0 }, OPTS).values.Amount_full, '0.00 SAR');
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

console.log(`legal-prefill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
