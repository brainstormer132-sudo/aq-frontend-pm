/**
 * Contract preview model - public/contracts/contract-preview.js
 *
 * The contract app is a plain <script> app with no build step, so this
 * suite requires the shipped file itself rather than a compiled copy.
 * Nothing between the test and what the browser loads.
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  contractPreviewModel, contractFieldValues, contractDocument,
  missingSentence, moneyText, dateText, slashDate,
} = require('../public/contracts/contract-preview.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const rowsOf = (model) => {
  const out = {};
  for (const section of model.sections) {
    for (const row of section.rows) out[row.label] = row.value;
  }
  return out;
};

/* -- A complete vendor booking --------------------------------------- */
const complete = () => ({
  task: { id: 'T-1001', brand: 'Nice Brand', duration: '30', end_date: '2026-09-30', contract_type: 'after_pay' },
  template: { key: 'after_pay', name: 'After Pay' },
  vendor: { name: 'Reem Trading Est.', license_number: '1010101010', contact_name: 'Reem Al Otaibi' },
  bank: { bank_name: 'Al Rajhi', account_name: 'Reem Trading Est.', iban: 'SA0380000000608010167519', account_number: '608010167519', swift_code: 'RJHISARI' },
  line: { platforms: 'TikTok', handles: '@reem', ad_type: 'Home Ad', qty: '2', price: '12000', details: 'Two reels' },
});

const full = contractPreviewModel(complete());
eq('a complete booking is missing nothing', full.missing, []);
eq('and says so', full.missingSentence, 'Every field the contract needs is filled in.');
eq('subtitle names the template', full.subtitle, 'After Pay template');
eq('four sections', full.sections.map((s) => s.title),
  ['Parties', 'Campaign', 'What is being bought', 'Payment']);

const r = rowsOf(full);
eq('first party is us', r['First party'], 'AQ Creativity');
eq('second party is the vendor', r['Second party'], 'Reem Trading Est.');
eq('licence number', r['Licence number'], '1010101010');
eq('amount carries the currency', r['Amount for this vendor'], 'SAR 12,000.00');
eq('end date is readable', r['End date'], '30 Sep 2026');
eq('contract length in days', r['Contract length'], '30 days');
eq('terms point at the template', r['Payment terms'], 'As per the After Pay template');

/* -- The blank brand, which is a real bug that shipped --------------- */
const noBrand = contractPreviewModel({ ...complete(), task: { ...complete().task, brand: '   ' } });
eq('a blank brand is flagged', noBrand.missing, ['Brand']);
eq('one missing field reads as one', noBrand.missingSentence, '1 field will print blank: Brand.');

/* -- No vendor picked yet -------------------------------------------- */
const noVendor = contractPreviewModel({ ...complete(), vendor: null, bank: null });
eq('no vendor does not throw, it reports', noVendor.missing,
  ['Second party', 'ID number', 'Bank', 'IBAN']);
eq('the identifier row falls back to ID number',
  rowsOf(noVendor)['ID number'], '');

/* -- Identifier: licence, else ID ------------------------------------ */
const idOnly = contractPreviewModel({
  ...complete(),
  vendor: { name: 'Mohammed A', license_number: '', id_number: '2233445566' },
});
eq('an influencer with no licence shows the ID number',
  rowsOf(idOnly)['ID number'], '2233445566');
eq('and is not flagged for it', idOnly.missing, []);

/* -- Money ----------------------------------------------------------- */
eq('money adds separators and two decimals', moneyText('12000'), '12,000.00');
eq('money accepts a number', moneyText(9000000), '9,000,000.00');
eq('money accepts what the form gives it', moneyText('12,000.5'), '12,000.50');
eq('money keeps small numbers whole', moneyText('7'), '7.00');
eq('money on nothing is nothing', moneyText(''), '');
eq('money on junk is nothing, not NaN', moneyText('twelve thousand'), '');
eq('negative money keeps its sign', moneyText('-250'), '-250.00');

const junkPrice = contractPreviewModel({ ...complete(), line: { ...complete().line, price: 'twelve' } });
eq('an unparseable price is a missing amount', junkPrice.missing, ['Amount for this vendor']);

const zeroPrice = contractPreviewModel({ ...complete(), line: { ...complete().line, price: '0' } });
eq('zero is filled in but called out', zeroPrice.missing, ['Amount for this vendor is 0.00']);
eq('zero still prints as an amount',
  rowsOf(zeroPrice)['Amount for this vendor'], 'SAR 0.00');

/* -- Multi service needs its text ------------------------------------ */
const multi = contractPreviewModel({
  ...complete(),
  line: { ...complete().line, ad_type: 'Multi Service', ad_type_custom: '' },
});
eq('multi service with no text is flagged', multi.missing, ['Multi-service text']);
const multiFilled = contractPreviewModel({
  ...complete(),
  line: { ...complete().line, ad_type: 'Multi Service', ad_type_custom: 'Reel plus story plus store visit' },
});
eq('multi service text joins the ad type',
  rowsOf(multiFilled)['Ad type'], 'Multi Service - Reel plus story plus store visit');
eq('and nothing is missing', multiFilled.missing, []);

/* -- Contract length prints blank, so it is a gap -------------------- */
const noDuration = contractPreviewModel({ ...complete(), task: { ...complete().task, duration: '' } });
eq('a blank length is empty, not a default', rowsOf(noDuration)['Contract length'], '');
eq('and it is flagged - the template has no fallback', noDuration.missing, ['Contract length']);

/* -- Dates ----------------------------------------------------------- */
eq('an ISO timestamp still formats', dateText('2026-01-05T10:00:00Z'), '5 Jan 2026');
eq('a blank date is blank', dateText(''), '');
eq('a date we cannot read is shown as typed', dateText('next Ramadan'), 'next Ramadan');
eq('a nonsense month is shown as typed', dateText('2026-13-01'), '2026-13-01');

/* -- No template on the task ----------------------------------------- */
const noTemplate = contractPreviewModel({ ...complete(), template: {} });
eq('no contract type is flagged', noTemplate.missing, ['Contract type']);
eq('and the header says so', noTemplate.subtitle, 'No contract type set on the task');
eq('terms with no template are blank, not half a sentence',
  rowsOf(noTemplate)['Payment terms'], '');

const keyOnly = contractPreviewModel({ ...complete(), template: { key: 'savola' } });
eq('an unnamed template falls back to its key',
  rowsOf(keyOnly)['Contract type'], 'savola');

/* -- Platform and handle --------------------------------------------- */
const noHandle = contractPreviewModel({
  ...complete(),
  line: { ...complete().line, platforms: '', handles: '' },
});
eq('platform and handle are both required', noHandle.missing, ['Platform', 'Name on the platform']);

/* -- Values are passed through raw, never escaped here --------------- */
const risky = contractPreviewModel({
  ...complete(),
  vendor: { name: '<script>x</script>', license_number: '1' },
});
eq('escaping is the renderer job, not this one',
  rowsOf(risky)['Second party'], '<script>x</script>');

/* -- Folding, so the banner never becomes a wall --------------------- */
eq('nothing missing', missingSentence([]), 'Every field the contract needs is filled in.');
eq('two are listed', missingSentence(['A', 'B']), '2 fields will print blank: A, B.');
eq('six fold after five',
  missingSentence(['A', 'B', 'C', 'D', 'E', 'F']),
  '6 fields will print blank: A, B, C, D, E, and 1 more.');

/* -- Called with nothing at all -------------------------------------- */
const empty = contractPreviewModel();
eq('an empty call still returns a model', empty.sections.length, 4);
eq('and reports every required field', empty.missing, [
  'Second party', 'ID number', 'Brand', 'Contract type', 'Contract length',
  'Ad type', 'Platform', 'Name on the platform', 'Amount for this vendor',
  'Bank', 'IBAN',
]);

/* -- The template file itself ---------------------------------------- */
const templateModule = require('../public/contracts/contract-template-ar.js');
const template = templateModule.template;

eq('the base64 decodes to the template it was built from',
  createHash('sha256').update(templateModule.json, 'utf8').digest('hex'),
  templateModule.sha256);
eq('it is the after pay template', template.key, 'after_pay');
eq('42 blocks', template.blocks.length, 42);
eq('the first block is the contract number', template.blocks[0].t, 'id');
eq('one signature row, at the end',
  template.blocks.map((b, i) => [b.t, i]).filter(([t]) => t === 'sig'),
  [['sig', 41]]);
eq('the typed underscore rules are dropped, not printed',
  template.blocks.filter((b) => /_{6,}/.test(b.v || '')).length, 0);
eq('the services table has a header row and one row',
  template.blocks.filter((b) => b.t === 'table').map((b) => b.rows.map((r) => r.length)),
  [[4, 4]]);

const placeholders = () => {
  const found = new Set();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  for (const m of JSON.stringify(template.blocks).matchAll(re)) found.add(m[1]);
  return [...found].sort();
};
eq('every placeholder the DOCX uses', placeholders(), [
  'Amount_full', 'account_name', 'account_number', 'ad_types', 'bank_name',
  'brand_name', 'channel_name', 'date', 'day', 'duration', 'iban', 'id',
  'license_name', 'license_number', 'name_2', 'platform_smart',
].sort());

/* -- Filling the document -------------------------------------------- */
const values = contractFieldValues(complete(), { today: '2026-09-08', strings: template.strings });
eq('the date reads the way the document writes dates', values.date.value, '08/09/2026');
eq('the contract number waits for generation', values.id.pending, true);
eq('so does the hijri date', values.day.pending, true);
eq('the amount carries the template currency word',
  values.Amount_full.value, '12,000.00 ' + template.strings.riyal);
eq('slashDate leaves an unparseable date alone', slashDate('soon'), 'soon');

const doc = contractDocument(template, values);
eq('the document keeps every block', doc.blocks.length, template.blocks.length);
eq('and knows which template it is', [doc.key, doc.label], ['after_pay', '60/90']);

const segsOf = (d) => d.blocks.flatMap((b) => b.segs
  || (b.rows ? b.rows.flat().flat() : [])
  || []).concat(d.blocks.flatMap((b) => (b.right || []).concat(b.left || [])));
const fieldSegs = (d) => segsOf(d).filter((s) => s.t === 'field');

eq('no placeholder survives into the rendered document',
  segsOf(doc).filter((s) => s.t === 'text' && s.v.includes('{{')).length, 0);
eq('one segment per placeholder occurrence', fieldSegs(doc).length, 16);
eq('nothing is missing on a complete booking',
  fieldSegs(doc).filter((s) => s.missing).map((s) => s.key), []);
eq('the two server-stamped fields are pending, not missing',
  fieldSegs(doc).filter((s) => s.pending).map((s) => s.key).sort(), ['day', 'id']);
eq('a pending field shows the template wording for it',
  fieldSegs(doc).find((s) => s.key === 'id').v, template.strings.pending);

const gapDoc = contractDocument(
  template,
  contractFieldValues({ ...complete(), bank: null, task: { ...complete().task, brand: '' } },
    { today: '2026-09-08', strings: template.strings }),
);
eq('a missing brand and bank show up in the body, by key',
  fieldSegs(gapDoc).filter((s) => s.missing).map((s) => s.key).sort(),
  ['account_name', 'account_number', 'bank_name', 'brand_name', 'iban']);
eq('and they read as not-entered rather than blank',
  fieldSegs(gapDoc).find((s) => s.key === 'brand_name').v, template.strings.missing);

/* -- The table cells are filled too ---------------------------------- */
const tableBlock = doc.blocks.find((b) => b.t === 'table');
eq('the header row is plain text', tableBlock.rows[0].every((c) => c.every((s) => s.t === 'text')), true);
eq('the data row is four fields',
  tableBlock.rows[1].map((cell) => cell[0].key),
  ['name_2', 'platform_smart', 'channel_name', 'ad_types']);
eq('the vendor name lands in the influencer cell',
  tableBlock.rows[1][0][0].v, 'Reem Trading Est.');

/* -- A template with no blocks does not explode ---------------------- */
eq('an empty template gives an empty document', contractDocument({}, {}).blocks, []);
eq('and a null one too', contractDocument(null, null).blocks, []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
