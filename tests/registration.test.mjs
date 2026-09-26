/**
 * The public registration form, checked against the database it writes to.
 *
 * WHAT THIS PROTECTS. This is the one screen in the app that a stranger
 * can reach, and the one write that nobody watches happen. Three things
 * can go wrong quietly here and each of them costs somebody a day:
 *
 *   1. A FIELD THAT IS NOT A COLUMN. PostgREST refuses the whole insert
 *      with "column X does not exist" - so one typo does not lose one
 *      field, it loses the entire registration, and the person who typed
 *      it is a stranger who will not try twice. So every field key is
 *      checked against the migration files, not against memory.
 *
 *   2. A ROW THE POLICY REFUSES. Migration 144 is the only reason anon
 *      can write here at all, and its check is
 *      `status = 'pending' and reviewed_at is null`. submission() must set
 *      both, every time, whatever it is handed.
 *
 *   3. A REQUIRED SET THAT DRIFTS FROM THE REGISTRY. The form exists to
 *      stop approved records arriving incomplete. lib/registry.ts decides
 *      what incomplete means; this asserts the two agree, field by field,
 *      so that adding a gap there without adding it here shows up as a
 *      failing test rather than as a queue of chasing.
 *
 * And the IBAN, separately: a public form has nobody standing beside it,
 * so the check digits are arithmetic here, not a shape.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  REG_TABLE, PICK_ONE, fieldsFor, sectionsFor, fieldsInSection,
  label, sectionLabel, isRtl, dirFor, otherLang,
  ibanIsValid, validate, problemText, submission, UI, t,
} from '../.test-build/registration.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'supabase', 'migrations');

/* -- 1. every field is a real column ---------------------------------
 *
 * Read the schema rather than trust it. The baseline declares the table;
 * later migrations add to it. Both are parsed, because 145's three columns
 * are exactly the ones this form was built to use and a form checked only
 * against the baseline would have said they do not exist.
 */

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

for (const kind of ['vendor', 'client']) {
  const cols = columnsOf(REG_TABLE[kind]);
  ok(`${kind}: the table was found and has columns`, cols.size > 5);
  const missing = fieldsFor(kind).map((f) => f.key).filter((k) => !cols.has(k));
  eq(`${kind}: every field is a column of ${REG_TABLE[kind]}`, missing, []);
  for (const k of ['status', 'submitted_at', 'reviewed_at']) {
    ok(`${kind}: ${k} is a column too`, cols.has(k));
  }
  ok(`${kind}: no field is the primary key`, !fieldsFor(kind).some((f) => f.key === 'id'));
}

/* -- 2. the row the policy will accept -------------------------------- */

{
  const row = submission('vendor', {
    full_name: '  Lina Haddad  ',
    signatory_name: 'Lina Haddad',
    id_number: '1098765432',
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
  ok('an undeclared key is dropped', !('nonsense' in submission('vendor', { nonsense: 'x' }, '')));
  ok('every key of the row is a field, status, submitted_at or reviewed_at', (() => {
    const known = new Set([...fieldsFor('vendor').map((f) => f.key),
      'status', 'submitted_at', 'reviewed_at']);
    return Object.keys(row).every((k) => known.has(k));
  })());
}

{
  const row = submission('client', { company_name: 'Acme', signatory_name: 'A', cr_number: '1',
    vat_number: '2', email: 'a@b.co', street: 'S', city: 'C' }, 'now');
  eq('the client row is pending too', row.status, 'pending');
  eq('and unreviewed', row.reviewed_at, null);
  ok('it carries signatory_title even when blank', 'signatory_title' in row);
}

/* -- 3. required matches what registry.ts calls a gap ------------------
 *
 * vendorGaps:  bank details / IBAN, signatory, ID or licence
 * clientGaps:  signatory, VAT number, CR number, address
 *
 * plus the NOT NULL columns and an email to reach them on.
 */

{
  const req = (k) => fieldsFor(k).filter((f) => f.required).map((f) => f.key).sort();
  eq('the vendor form requires exactly the registry gaps, the name and an email', req('vendor'),
    ['account_name', 'account_number', 'bank_name', 'email', 'full_name', 'iban',
      'signatory_name'].sort());
  eq('the client form requires exactly the registry gaps, the name and an email', req('client'),
    ['city', 'company_name', 'cr_number', 'email', 'signatory_name', 'street',
      'vat_number'].sort());
  eq('ID or licence is a choice, not two requirements', PICK_ONE.vendor, [['id_number', 'license_number']]);
  ok('neither member of the choice is required on its own',
    !fieldsFor('vendor').some((f) => f.required && ['id_number', 'license_number'].includes(f.key)));

  const registry = readFileSync(join(root, 'lib', 'registry.ts'), 'utf8');
  ok('registry.ts still asks for an IBAN, so the form still must',
    /out\.push\('IBAN'\)/.test(registry));
  ok('registry.ts still asks a client for a VAT number',
    /out\.push\('VAT number'\)/.test(registry));
  ok('registry.ts still accepts either an ID or a licence',
    /id_number[\s\S]{0,40}license_number/.test(registry));
}

/* -- 4. validation ---------------------------------------------------- */

{
  const problems = validate('vendor', {});
  for (const f of fieldsFor('vendor').filter((x) => x.required)) {
    ok(`empty form: ${f.key} is reported missing`, problems[f.key] === 'required');
  }
  eq('empty form: both halves of the choice are offered',
    [problems.id_number, problems.license_number], ['pick_one', 'pick_one']);
  eq('empty form: an optional field is not reported', problems.phone, undefined);
}

{
  const base = {
    full_name: 'A', signatory_name: 'B', email: 'a@b.co', bank_name: 'C',
    account_name: 'D', account_number: 'E', iban: 'SA0380000000608010167519',
  };
  eq('an ID alone clears the choice',
    validate('vendor', { ...base, id_number: '1098765432' }), {});
  eq('a licence alone clears it too',
    validate('vendor', { ...base, license_number: '4030000000' }), {});
  ok('a whitespace-only answer does not count',
    validate('vendor', { ...base, id_number: '   ' }).id_number === 'pick_one');

  const full = { ...base, id_number: '1098765432' };
  eq('a bad email is caught', validate('vendor', { ...full, email: 'lina@' }).email, 'email');
  eq('so is a missing dot', validate('vendor', { ...full, email: 'lina@example' }).email, 'email');
  eq('a plausible phone passes',
    validate('vendor', { ...full, phone: '+966 50 123 4567' }).phone, undefined);
  eq('letters in a phone are caught',
    validate('vendor', { ...full, phone: 'call me' }).phone, 'phone');
  eq('four digits are not a phone number',
    validate('vendor', { ...full, phone: '1234' }).phone, 'phone');
  eq('a real date passes',
    validate('vendor', { ...full, license_expiry: '2027-02-28' }).license_expiry, undefined);
  eq('the 30th of February is not a date',
    validate('vendor', { ...full, license_expiry: '2027-02-30' }).license_expiry, 'date');
  eq('nor is 26/09/2026',
    validate('vendor', { ...full, license_expiry: '26/09/2026' }).license_expiry, 'date');
  eq('missing beats malformed on an empty required box',
    validate('vendor', { ...full, email: '' }).email, 'required');
}

{
  const need = { company_name: 'Acme', signatory_name: 'A', cr_number: '1',
    vat_number: '2', email: 'a@b.co', street: 'S', city: 'C' };
  eq('a complete client form passes', validate('client', need), {});
  eq('a client with no city is stopped',
    validate('client', { ...need, city: '' }).city, 'required');
  eq('the client form has no choices to make', PICK_ONE.client, []);
}

/* -- 5. the IBAN check digits ----------------------------------------- */

{
  ok('a real Saudi IBAN passes', ibanIsValid('SA03 8000 0000 6080 1016 7519'));
  ok('spaces and hyphens and lower case are fine',
    ibanIsValid('sa03-8000 0000-6080 1016 7519'));
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
  ok('an IBAN that does not add up is reported as an IBAN problem',
    validate('vendor', { iban: 'SA0380000000608010167591' }).iban === 'iban');
}

/* -- 6. both languages, everywhere ------------------------------------ */

{
  for (const kind of ['vendor', 'client']) {
    for (const f of fieldsFor(kind)) {
      ok(`${kind}.${f.key} has an English label`, label(f, 'en').length > 0);
      ok(`${kind}.${f.key} has an Arabic label`, label(f, 'ar').length > 0);
      ok(`${kind}.${f.key}'s Arabic label is Arabic`, /[؀-ۿ]/.test(label(f, 'ar')));
    }
    for (const s of sectionsFor(kind)) {
      ok(`${kind} section ${s.key} is labelled in both`,
        sectionLabel(s, 'en').length > 0 && /[؀-ۿ]/.test(sectionLabel(s, 'ar')));
    }
    eq(`${kind}: no field key appears twice`,
      new Set(fieldsFor(kind).map((f) => f.key)).size, fieldsFor(kind).length);
    eq(`${kind}: every field belongs to a declared section`,
      fieldsFor(kind).filter((f) => !sectionsFor(kind).some((s) => s.key === f.section)), []);
    eq(`${kind}: no section is empty`,
      sectionsFor(kind).filter((s) => fieldsInSection(kind, s.key).length === 0), []);
    eq(`${kind}: the sections account for every field`,
      sectionsFor(kind).reduce((n, s) => n + fieldsInSection(kind, s.key).length, 0),
      fieldsFor(kind).length);
  }

  for (const key of Object.keys(UI)) {
    ok(`UI.${key} is there in English`, t(key, 'en').length > 0);
    ok(`UI.${key} is there in Arabic`, t(key, 'ar').length > 0);
  }
  ok('the page title is translated, not copied', t('pageTitle', 'ar') !== t('pageTitle', 'en'));
  eq('an unknown key is empty rather than a crash', t('nope', 'en'), '');

  for (const p of ['required', 'email', 'phone', 'iban', 'date', 'pick_one']) {
    ok(`the ${p} message is in English`, /[a-z]/.test(problemText(p, 'en')));
    ok(`the ${p} message is in Arabic`, /[؀-ۿ]/.test(problemText(p, 'ar')));
  }
  eq('an unknown problem is empty rather than a crash', problemText('nope', 'en'), '');
}

/* -- 7. the toggle ---------------------------------------------------- */

{
  ok('Arabic is right to left', isRtl('ar'));
  ok('English is not', !isRtl('en'));
  eq('the page direction follows', [dirFor('ar'), dirFor('en')], ['rtl', 'ltr']);
  eq('the toggle goes the other way', [otherLang('en'), otherLang('ar')], ['ar', 'en']);
  ok('the toggle offers Arabic in Arabic', /[؀-ۿ]/.test(t('toArabic', 'en')));
  eq('and English in English', t('toEnglish', 'ar'), 'English');
}

/* -- 8. nothing mutates the specs ------------------------------------- */

{
  const a = fieldsFor('vendor');
  a.push({ key: 'nonsense' });
  eq('the caller cannot grow the field list', fieldsFor('vendor').length, a.length - 1);
  const s = sectionsFor('client');
  s.length = 0;
  ok('nor empty the sections', sectionsFor('client').length > 0);
}

console.log(`registration: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
