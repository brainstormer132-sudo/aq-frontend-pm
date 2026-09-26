/**
 * The public registration form, checked against the database it writes to
 * and against the vendor editor it has to agree with.
 *
 * WHAT THIS PROTECTS. This is the one screen in the app a stranger can
 * reach, and the one write nobody watches happen.
 *
 *   1. A FIELD THAT IS NOT A COLUMN. PostgREST refuses the whole insert
 *      with "column X does not exist" - so one typo does not lose one
 *      field, it loses the entire registration, and the person who typed
 *      it is a stranger who will not try twice. Every field key of every
 *      category is checked against the migration files.
 *
 *   2. A ROW THE POLICY REFUSES. Migration 144 is the only reason anon
 *      can write here at all, and its check is
 *      `status = 'pending' and reviewed_at is null`.
 *
 *   3. A REQUIRED SET THAT DRIFTS FROM THE REGISTRY. lib/registry.ts
 *      decides what incomplete means; this asserts the two agree.
 *
 *   4. A FORM THAT ASKS THE WRONG VENDOR THE WRONG THING. Siraj: "each
 *      vendor has different requirements". requires_license chooses the
 *      identifier and the trackable categories are the only ones asked
 *      for platforms - both decided in VendorEditorModal long before this
 *      form existed. The two must not drift, so the seed and the
 *      component are both read here rather than copied.
 *
 * And the IBAN, separately: a public form has nobody standing beside it,
 * so the check digits are arithmetic rather than a shape.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  REG_TABLE, TRACKABLE_CATEGORY_KEYS, categoryIsTrackable,
  regForm, fieldsInSection, label, sectionLabel, hint, choiceLabel,
  isRtl, dirFor, otherLang, ibanIsValid, validate, problemText,
  sectionProblems, firstBadSection, submission, stepText,
  LTR_VALUE_KEYS, isLatinValue, UI, t,
} from '../.test-build/registration.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'supabase', 'migrations');

/* -- the 11 categories, read from the seed rather than copied ---------
 *
 * Migration 029 is where the list lives. Reading it means a category
 * added or reclassified there is exercised here on the next run instead
 * of quietly never being tested.
 */

function seededCategories() {
  const sql = readFileSync(join(migrations, 'archive', '029_vendor_categories.sql'), 'utf8');
  const start = sql.indexOf('insert into public.vendor_categories (key, label, requires_license, sort_order) values');
  if (start < 0) throw new Error('029 no longer seeds vendor_categories the same way');
  const body = sql.slice(start, sql.indexOf('on conflict', start));
  const out = [];
  const re = /\(\s*'([a-z_]+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*\d+\s*\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    out.push({ id: `uuid-${m[1]}`, key: m[1], label: m[2], requires_license: m[3] === 'true' });
  }
  return out;
}

const CATEGORIES = seededCategories();
eq('029 still seeds eleven categories', CATEGORIES.length, 11);
eq('and influencer is one that needs a licence',
  CATEGORIES.find((c) => c.key === 'influencer')?.requires_license, true);
eq('and a photographer is not',
  CATEGORIES.find((c) => c.key === 'photographer')?.requires_license, false);

/** Every form this file can produce: the client, and a vendor per category. */
const ALL_FORMS = [regForm('client'), regForm('vendor', null),
  ...CATEGORIES.map((c) => regForm('vendor', c))];

/* -- 1. every field is a real column ---------------------------------- */

function columnsOf(table) {
  const out = new Set();

  const baseline = readFileSync(join(migrations, '000_baseline.sql'), 'utf8');
  const start = baseline.indexOf(`CREATE TABLE public.${table} (`);
  if (start < 0) throw new Error(`no CREATE TABLE for ${table} in the baseline`);
  const body = baseline.slice(start, baseline.indexOf('\n);', start));
  for (const line of body.split('\n').slice(1)) {
    const m = /^\s{4}([a-z_][a-z0-9_]*)\s/.exec(line);
    if (m) out.add(m[1]);
  }

  // `alter table public.<t> add column if not exists a text, b text;`
  for (const name of readdirSync(migrations).sort()) {
    if (!name.endsWith('.sql') || name.startsWith('000_')) continue;
    const sql = readFileSync(join(migrations, name), 'utf8');
    const re = new RegExp(`alter\\s+table\\s+(?:only\\s+)?public\\.${table}\\b([^;]*);`, 'gi');
    let m;
    while ((m = re.exec(sql)) !== null) {
      const add = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
      let a;
      while ((a = add.exec(m[1])) !== null) out.add(a[1].toLowerCase());
    }
  }
  return out;
}

{
  const cols = { vendor: columnsOf('pending_vendors'), client: columnsOf('pending_clients') };
  ok('pending_vendors was found and has columns', cols.vendor.size > 20);
  ok('pending_clients too', cols.client.size > 15);

  for (const form of ALL_FORMS) {
    const where = form.category ? `${form.kind}/${form.category.key}` : form.kind;
    const missing = form.fields.map((f) => f.key).filter((k) => !cols[form.kind].has(k));
    eq(`${where}: every field is a column of ${REG_TABLE[form.kind]}`, missing, []);
    ok(`${where}: no field is the primary key`, !form.fields.some((f) => f.key === 'id'));
  }
  for (const k of ['status', 'submitted_at', 'reviewed_at']) {
    ok(`pending_vendors.${k} exists`, cols.vendor.has(k));
    ok(`pending_clients.${k} exists`, cols.client.has(k));
  }
  ok('category_id exists, so submission() can write it', cols.vendor.has('category_id'));

  // The dead column stays dead: nothing reads it and approval drops it.
  ok('dropoff_locations is not on the form',
    !ALL_FORMS.some((f) => f.fields.some((x) => x.key === 'dropoff_locations')));
}

/* -- 2. the row the policy will accept -------------------------------- */

{
  const cat = CATEGORIES.find((c) => c.key === 'model');
  const form = regForm('vendor', cat);
  const row = submission(form, {
    vendor_category: 'model',
    full_name: '  Lina Haddad  ',
    signatory_name: 'Lina Haddad',
    id_number: '1098765432',
    age: '27',
    gender: 'female',
    email: 'lina@example.com',
    bank_name: 'Al Rajhi',
    account_name: 'Lina Haddad',
    account_number: '608010167519',
    iban: 'sa03 8000-0000 6080 1016 7519',
    status: 'approved',            // a caller trying to smuggle one in
    reviewed_at: '2026-09-26',
    id: 7,
  }, '2026-09-26T09:00:00.000Z');

  eq('status is pending whatever the caller passed', row.status, 'pending');
  eq('reviewed_at is null whatever the caller passed', row.reviewed_at, null);
  ok('the id is not in the row at all', !('id' in row));
  eq('submitted_at is what it was given', row.submitted_at, '2026-09-26T09:00:00.000Z');
  eq('values are trimmed', row.full_name, 'Lina Haddad');
  eq('the IBAN is stored the way the rest of the app stores it',
    row.iban, 'SA0380000000608010167519');
  eq('a blank is null, not an empty string', row.phone, null);
  eq('the category key rides in vendor_category', row.vendor_category, 'model');
  eq('and the lookup id in category_id', row.category_id, 'uuid-model');
  eq('AGE IS A NUMBER, because the column is an integer', row.age, 27);
  ok('and it really is a number, not a numeric string', typeof row.age === 'number');
  eq('a nonsense age is dropped rather than posted',
    submission(form, { age: 'twenty' }, '').age, null);
  ok('an undeclared key is dropped', !('nonsense' in submission(form, { nonsense: 'x' }, '')));
  ok('every key of the row is a field, the category id, or the three the policy reads', (() => {
    const known = new Set([...form.fields.map((f) => f.key),
      'category_id', 'status', 'submitted_at', 'reviewed_at']);
    return Object.keys(row).every((k) => known.has(k));
  })());
  ok('a photographer is never asked for an age, so never sends one',
    !('age' in submission(regForm('vendor', CATEGORIES.find((c) => c.key === 'photographer')),
      { age: '27' }, '')));
}

{
  const form = regForm('client');
  const row = submission(form, { company_name: 'Acme', signatory_name: 'A', cr_number: '1',
    vat_number: '2', email: 'a@b.co', street: 'S', city: 'C' }, 'now');
  eq('the client row is pending too', row.status, 'pending');
  eq('and unreviewed', row.reviewed_at, null);
  ok('it carries signatory_title even when blank', 'signatory_title' in row);
  ok('and no category_id, which is not a column of pending_clients', !('category_id' in row));
}

/* -- 2b. approval carries every answer across --------------------------
 *
 * THE BUG THIS FREEZES, twice over. approvePendingVendor used to write
 * the name and the licence number and nothing else, so approving a
 * registration threw away the email, the phone, the category, the
 * platforms and the licence expiry the vendor had already typed - and the
 * registry then listed the result as incomplete, for somebody to chase.
 * fbd0dd1 fixed that by hand. Migration 146 then added ten more columns,
 * every one of which could be forgotten the same way.
 *
 * A dropped answer is invisible: the insert succeeds, the queue row is
 * marked approved, and the only trace is a field the vendor filled in and
 * nobody ever sees. So the form's field list and the approval are read
 * from the source and compared, rather than trusted to stay in step.
 */

{
  const workflow = readFileSync(join(root, 'hooks', 'use-workflow.ts'), 'utf8');
  const at = workflow.indexOf('export async function approvePendingVendor');
  ok('approvePendingVendor is still there to check', at > 0);
  const body = workflow.slice(at, workflow.indexOf('\nexport ', at + 10));
  const carried = new Set([...body.matchAll(/pending\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]));

  // Every field any vendor form can send, plus the category id the row
  // carries beside it.
  const sent = new Set(['category_id']);
  for (const c of CATEGORIES) for (const f of regForm('vendor', c).fields) sent.add(f.key);

  eq('EVERY ANSWER A VENDOR CAN GIVE IS CARRIED ACROSS ON APPROVAL',
    [...sent].filter((k) => !carried.has(k)).sort(), []);
  ok('including the bank details, which go to bank_accounts', carried.has('iban'));
  ok('and the category id, which was never written before 146', carried.has('category_id'));
  ok("and a model's age", carried.has('age'));
  ok("and a location's link", carried.has('location_link'));

  // The other direction: the form must not ask for something with nowhere
  // to land. address_1..3 and dropoff_locations are columns of the queue
  // that public.vendors has no home for, so they are not on the form.
  for (const dead of ['address_1', 'address_2', 'address_3', 'dropoff_locations']) {
    ok(`${dead} is asked for by nobody`, !sent.has(dead));
  }
}

/* -- 3. required matches what registry.ts calls a gap ------------------
 *
 * vendorGaps:  bank details / IBAN, signatory, ID or licence
 * clientGaps:  signatory, VAT number, CR number, address
 *
 * plus the NOT NULL columns and an email to reach them on.
 */

{
  const req = (form) => form.fields.filter((f) => f.required).map((f) => f.key).sort();

  eq('the client form requires exactly the registry gaps, the name and an email',
    req(regForm('client')),
    ['city', 'company_name', 'cr_number', 'email', 'signatory_name', 'street',
      'vat_number'].sort());

  const common = ['account_name', 'account_number', 'bank_name', 'email',
    'full_name', 'iban', 'signatory_name', 'vendor_category'];

  for (const c of CATEGORIES) {
    const want = [...common, c.requires_license ? 'license_number' : 'id_number'];
    if (categoryIsTrackable(c.key)) want.push('platforms');
    eq(`vendor/${c.key} requires exactly what it should`, req(regForm('vendor', c)), want.sort());
  }

  eq('before a category is picked, only the category is asked for',
    req(regForm('vendor', null)), ['vendor_category']);

  const registry = readFileSync(join(root, 'lib', 'registry.ts'), 'utf8');
  ok('registry.ts still asks for an IBAN, so the form still must',
    /out\.push\('IBAN'\)/.test(registry));
  ok('registry.ts still asks a client for a VAT number',
    /out\.push\('VAT number'\)/.test(registry));
  ok('registry.ts still accepts either an ID or a licence',
    /id_number[\s\S]{0,40}license_number/.test(registry));
}

/* -- 4. the category decides the questions -----------------------------
 *
 * Read from components/workflow/VendorEditorModal.tsx, which has asked
 * these questions since migration 029. If the two ever disagree, the
 * public form and the internal editor are collecting different vendors.
 */

{
  const modal = readFileSync(join(root, 'components', 'workflow', 'VendorEditorModal.tsx'), 'utf8');

  ok('the editor still switches the identifier on requires_license',
    /requires_license\s*\?\s*'license'\s*:\s*'id'/.test(modal));

  // Its CategorySpecificFields block, category by category.
  const block = modal.slice(modal.indexOf('function CategorySpecificFields'));
  const editorAsks = (key) => {
    const at = block.indexOf(`key === '${key}'`);
    if (at < 0) return [];
    const chunk = block.slice(at, at + 900);
    const end = chunk.indexOf("if (key === '");
    const body = end > 0 ? chunk.slice(0, end) : chunk;
    return [...body.matchAll(/setField\('([a-z_]+)'\)/g)].map((m) => m[1]);
  };

  for (const c of CATEGORIES) {
    const form = regForm('vendor', c);
    const detail = fieldsInSection(form, 'details').map((f) => f.key);
    const editor = editorAsks(c.key);

    if (c.key === 'influencer' || c.key === 'ugc') {
      eq(`${c.key}: the editor asks only for platforms`, editor, ['platforms']);
    }
    eq(`${c.key}: the form asks exactly what the editor asks`,
      detail.slice().sort(), editor.slice().sort());

    // The identifier: one, never two, and never the wrong one.
    const ids = form.fields.map((f) => f.key)
      .filter((k) => k === 'id_number' || k === 'license_number');
    eq(`${c.key}: exactly one identifier is asked for`, ids.length, 1);
    eq(`${c.key}: and it is the one the category says`,
      ids[0], c.requires_license ? 'license_number' : 'id_number');

    // No step at all when the category has nothing extra to ask.
    const hasDetails = form.sections.some((s) => s.key === 'details');
    eq(`${c.key}: a details step exists only when there is something in it`,
      hasDetails, detail.length > 0);
  }

  const photographer = regForm('vendor', CATEGORIES.find((c) => c.key === 'photographer'));
  ok('A PRINTING VENDOR IS NEVER ASKED FOR A PROFILE LINK',
    !photographer.fields.some((f) => f.key === 'platforms'));
  eq('and has no work step to put one on',
    photographer.sections.filter((s) => s.key === 'details'), []);
  eq('a photographer has five steps', photographer.sections.length, 5);
  eq('a model has six', regForm('vendor', CATEGORIES.find((c) => c.key === 'model')).sections.length, 6);

  // The trackable list is the app's, not a second copy of it.
  const workflow = readFileSync(join(root, 'hooks', 'use-workflow.ts'), 'utf8');
  const listed = /TRACKABLE_VENDOR_CATEGORIES\s*=\s*\[([^\]]*)\]/.exec(workflow);
  ok('use-workflow still declares the trackable list', !!listed);
  eq('and this file agrees with it character for character',
    [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
    TRACKABLE_CATEGORY_KEYS.slice());
  ok('influencer is trackable', categoryIsTrackable('Influencer'));
  ok('logistics is not', !categoryIsTrackable('logistics'));
  ok('and neither is nothing at all', !categoryIsTrackable(null));
}

/* -- 5. validation ---------------------------------------------------- */

{
  const cat = CATEGORIES.find((c) => c.key === 'influencer');
  const form = regForm('vendor', cat);
  const problems = validate(form, {});
  for (const f of form.fields.filter((x) => x.required)) {
    ok(`empty form: ${f.key} is reported missing`, problems[f.key] === 'required');
  }
  eq('empty form: an optional field is not reported', problems.phone, undefined);

  const base = {
    vendor_category: 'influencer', full_name: 'A', signatory_name: 'B',
    license_number: '4030229184', platforms: 'Instagram', email: 'a@b.co',
    bank_name: 'C', account_name: 'D', account_number: 'E',
    iban: 'SA0380000000608010167519',
  };
  eq('a complete influencer form passes', validate(form, base), {});
  eq('a bad email is caught', validate(form, { ...base, email: 'lina@' }).email, 'email');
  eq('so is a missing dot', validate(form, { ...base, email: 'lina@example' }).email, 'email');
  eq('a plausible phone passes', validate(form, { ...base, phone: '+966 50 123 4567' }).phone, undefined);
  eq('letters in a phone are caught', validate(form, { ...base, phone: 'call me' }).phone, 'phone');
  eq('four digits are not a phone number', validate(form, { ...base, phone: '1234' }).phone, 'phone');
  eq('a real date passes', validate(form, { ...base, license_expiry: '2027-02-28' }).license_expiry, undefined);
  eq('the 30th of February is not a date',
    validate(form, { ...base, license_expiry: '2027-02-30' }).license_expiry, 'date');
  eq('nor is 26/09/2026', validate(form, { ...base, license_expiry: '26/09/2026' }).license_expiry, 'date');
  eq('missing beats malformed on an empty required box',
    validate(form, { ...base, email: '' }).email, 'required');
  eq('an influencer with no platforms is stopped',
    validate(form, { ...base, platforms: '' }).platforms, 'required');
}

{
  const model = regForm('vendor', CATEGORIES.find((c) => c.key === 'model'));
  const base = { vendor_category: 'model', full_name: 'A', signatory_name: 'B',
    id_number: '1', email: 'a@b.co', bank_name: 'C', account_name: 'D',
    account_number: 'E', iban: 'SA0380000000608010167519' };
  eq('a model form with no age passes - it is optional', validate(model, base), {});
  eq('an age of twenty-seven passes', validate(model, { ...base, age: '27' }).age, undefined);
  eq('an age of "twenty" is caught', validate(model, { ...base, age: 'twenty' }).age, 'number');
  eq('an age of 27.5 is caught', validate(model, { ...base, age: '27.5' }).age, 'number');
  eq('an age of 0 is caught', validate(model, { ...base, age: '0' }).age, 'number');

  const logistics = regForm('vendor', CATEGORIES.find((c) => c.key === 'logistics'));
  const lbase = { ...base, vendor_category: 'logistics' };
  eq('a maps link passes',
    validate(logistics, { ...lbase, location_link: 'https://maps.app.goo.gl/x9Qz' }).location_link,
    undefined);
  eq('a bare address pasted into the link box is caught',
    validate(logistics, { ...lbase, location_link: 'near the mall' }).location_link, 'link');
}

{
  const form = regForm('client');
  const need = { company_name: 'Acme', signatory_name: 'A', cr_number: '1',
    vat_number: '2', email: 'a@b.co', street: 'S', city: 'C' };
  eq('a complete client form passes', validate(form, need), {});
  eq('a client with no city is stopped', validate(form, { ...need, city: '' }).city, 'required');
}

/* -- 6. the IBAN check digits ----------------------------------------- */

{
  ok('a real Saudi IBAN passes', ibanIsValid('SA03 8000 0000 6080 1016 7519'));
  ok('spaces and hyphens and lower case are fine', ibanIsValid('sa03-8000 0000-6080 1016 7519'));
  ok('a real British IBAN passes', ibanIsValid('GB82 WEST 1234 5698 7654 32'));
  ok('TWO TRANSPOSED DIGITS ARE CAUGHT - this is the whole point',
    !ibanIsValid('SA0380000000608010167591'));
  ok('a wrong last digit is caught', !ibanIsValid('GB82WEST12345698765433'));
  ok('a shape-only check would have passed both of those', (() => {
    const shape = /^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$/;
    return shape.test('SA0380000000608010167591') && shape.test('GB82WEST12345698765433');
  })());
  ok('no country code is rejected', !ibanIsValid('0380000000608010167519'));
  ok('too short is rejected', !ibanIsValid('SA0380'));
  ok('empty is rejected', !ibanIsValid(''));
}

/* -- 7. one section at a time ------------------------------------------ */

{
  for (const form of ALL_FORMS) {
    const where = form.category ? `${form.kind}/${form.category.key}` : form.kind;
    const empty = validate(form, {});
    const covered = form.sections.flatMap((s) => Object.keys(sectionProblems(form, s.key, {})));
    eq(`${where}: every problem on an empty form is shown on some screen`,
      covered.slice().sort(), Object.keys(empty).sort());
    eq(`${where}: and none of them on two screens`, new Set(covered).size, covered.length);
    eq(`${where}: every field belongs to a declared section`,
      form.fields.filter((f) => !form.sections.some((s) => s.key === f.section)), []);
    eq(`${where}: no section is empty`,
      form.sections.filter((s) => fieldsInSection(form, s.key).length === 0), []);
    eq(`${where}: no field key appears twice`,
      new Set(form.fields.map((f) => f.key)).size, form.fields.length);
  }

  const form = regForm('vendor', CATEGORIES.find((c) => c.key === 'props'));
  eq('an untouched first screen has the category on it',
    sectionProblems(form, 'work', {}).vendor_category, 'required');
  eq('a later screen\'s problems are not shown on an earlier one',
    sectionProblems(form, 'work', {}).iban, undefined);
  eq('the empty form sends you to the first screen', firstBadSection(form, {}), 'work');

  const good = {
    vendor_category: 'props', full_name: 'A', signatory_name: 'B', id_number: '1',
    email: 'a@b.co', bank_name: 'C', account_name: 'D', account_number: 'E',
    iban: 'SA0380000000608010167519',
  };
  eq('a complete vendor form sends you nowhere', firstBadSection(form, good), null);
  eq('a bad IBAN sends you to the bank screen',
    firstBadSection(form, { ...good, iban: 'SA0380000000608010167591' }), 'bank');
  eq('a missing name beats a bad IBAN, because it comes first',
    firstBadSection(form, { ...good, full_name: '', iban: 'nope' }), 'who');
  eq('and the client form behaves the same', firstBadSection(regForm('client'), {}), 'who');
}

/* -- 8. Latin values inside an RTL page -------------------------------- */

{
  const keys = new Set(ALL_FORMS.flatMap((f) => f.fields.map((x) => x.key)));
  eq('every left-to-right key is a real field', LTR_VALUE_KEYS.filter((k) => !keys.has(k)), []);
  ok('the phone number is one', isLatinValue('phone'));
  ok('so is the IBAN', isLatinValue('iban'));
  ok('so is the expiry date', isLatinValue('license_expiry'));
  ok('so is a maps link', isLatinValue('location_link'));
  ok('a name is not', !isLatinValue('full_name'));
  ok('nor is the city', !isLatinValue('city'));
  ok('every field typed as something other than free text is one', (() => {
    const typed = ALL_FORMS.flatMap((f) => f.fields)
      .filter((f) => !['text', 'category', 'choice'].includes(f.type));
    return typed.every((f) => isLatinValue(f.key));
  })());
}

/* -- 9. both languages, everywhere ------------------------------------- */

{
  for (const form of ALL_FORMS) {
    const where = form.category ? `${form.kind}/${form.category.key}` : form.kind;
    for (const f of form.fields) {
      ok(`${where}.${f.key} has an English label`, label(f, 'en').length > 0);
      ok(`${where}.${f.key}'s Arabic label is Arabic`, /[؀-ۿ]/.test(label(f, 'ar')));
      if (f.hintEn) ok(`${where}.${f.key} has a hint in both`, hint(f, 'ar').length > 0);
      for (const c of f.choices ?? []) {
        ok(`${where}.${f.key}/${c.value} is labelled in English`, choiceLabel(c, 'en').length > 0);
        ok(`${where}.${f.key}/${c.value} is labelled in Arabic`, /[؀-ۿ]/.test(choiceLabel(c, 'ar')));
      }
    }
    for (const s of form.sections) {
      ok(`${where} section ${s.key} is labelled in both`,
        sectionLabel(s, 'en').length > 0 && /[؀-ۿ]/.test(sectionLabel(s, 'ar')));
    }
  }

  for (const key of Object.keys(UI)) {
    ok(`UI.${key} is there in English`, t(key, 'en').length > 0);
    ok(`UI.${key} is there in Arabic`, t(key, 'ar').length > 0);
  }
  ok('the page title is translated, not copied', t('pageTitle', 'ar') !== t('pageTitle', 'en'));
  eq('an unknown key is empty rather than a crash', t('nope', 'en'), '');

  for (const p of ['required', 'email', 'phone', 'iban', 'date', 'number', 'link']) {
    ok(`the ${p} message is in English`, /[a-z]/.test(problemText(p, 'en')));
    ok(`the ${p} message is in Arabic`, /[؀-ۿ]/.test(problemText(p, 'ar')));
  }
  eq('an unknown problem is empty rather than a crash', problemText('nope', 'en'), '');

  eq('the step counter fills in both numbers', stepText('en', 3, 5), 'Step 3 of 5');
  ok('and does the same in Arabic', /3/.test(stepText('ar', 3, 5)) && /5/.test(stepText('ar', 3, 5)));
  ok('the Arabic counter is Arabic', /[؀-ۿ]/.test(stepText('ar', 1, 6)));
}

/* -- 10. the toggle ---------------------------------------------------- */

{
  ok('Arabic is right to left', isRtl('ar'));
  ok('English is not', !isRtl('en'));
  eq('the page direction follows', [dirFor('ar'), dirFor('en')], ['rtl', 'ltr']);
  eq('the toggle goes the other way', [otherLang('en'), otherLang('ar')], ['ar', 'en']);
  ok('the toggle offers Arabic in Arabic', /[؀-ۿ]/.test(t('toArabic', 'en')));
  eq('and English in English', t('toEnglish', 'ar'), 'English');
}

/* -- 11. nothing mutates the specs ------------------------------------- */

{
  const a = regForm('vendor', CATEGORIES[0]);
  a.fields.push({ key: 'nonsense' });
  a.sections.length = 0;
  const b = regForm('vendor', CATEGORIES[0]);
  eq('the caller cannot grow the next form\'s field list', b.fields.length, a.fields.length - 1);
  ok('nor empty its sections', b.sections.length > 0);
}

console.log(`registration: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
