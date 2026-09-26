/**
 * The public registration form: what it asks, in which language, and what
 * it is allowed to write.
 *
 * -- Why this exists -----------------------------------------------
 *
 * The old registration form is gone - the service it was hosted on was
 * closed down - so vendors and clients arrive by email and somebody types
 * them in. This replaces it with one public link where the person picks
 * "vendor" or "client" and fills the form themselves, in Arabic or in
 * English.
 *
 * -- Why the form is a value, not a list ---------------------------
 *
 * Siraj: "remember that each vendor has different requirements".
 *
 * He is right and the app already knew it. A vendor's CATEGORY decides
 * what they are asked:
 *
 *   * requires_license (migration 029) chooses the identifier. Influencer
 *     and UGC give a licence number; the other nine give a national ID.
 *     components/workflow/VendorEditorModal has switched on this flag
 *     since 029 - `category?.requires_license ? license_number :
 *     id_number` - so the form shows ONE of them, never a choice between
 *     two, because the answer is already known.
 *   * TRACKABLE_CATEGORY_KEYS (influencer, UGC) are the only ones whose
 *     work reaches the tracking sheet, and vendorDataRequirements asks
 *     only those for platforms. Your comment there: "a printing vendor is
 *     never asked for a profile link".
 *   * Five categories carry extra columns of their own - a model's age, a
 *     location's type, an events vendor's opening and ceremony. 146 put
 *     them on pending_vendors so a registration can carry them.
 *
 * So the shape of the form is computed from the answer to its first
 * question, by regForm(). Every other function in this file takes that
 * RegForm rather than a `kind`, which makes it impossible to validate one
 * shape and submit a different one - the failure that would put a model's
 * age through a photographer's validator and drop it on the floor.
 *
 * -- Why THESE fields are required ---------------------------------
 *
 * Not invented here. lib/registry.ts has said for months what an
 * incomplete record is:
 *
 *   vendorGaps:  bank details / IBAN, signatory, ID or licence
 *   clientGaps:  signatory, VAT number, CR number, address
 *
 * Every one of those is required below, because a registration that does
 * not carry them creates a row that shows up in the registry as
 * incomplete on the day it is approved - which is the manual chasing this
 * form exists to stop. Added to that: the NOT NULL columns (full_name,
 * company_name), an email address, because the portal invite has nowhere
 * to go without one, and - for an influencer or a UGC creator only - the
 * platforms, which vendorDataRequirements already calls missing.
 *
 * Nothing else is required. A public form that asks for more than it
 * needs is a form people abandon halfway.
 *
 * -- Why there are no document uploads -----------------------------
 *
 * pending_clients has permit_doc, vat_doc and national_address_doc, and
 * they are not on this form. Migrations 140 and 141 shut the anonymous
 * key out of every storage bucket - deliberately, because client-files
 * had been readable by anyone holding the public key. A stranger on a
 * public link therefore cannot upload anything, and a field that cannot
 * work is worse than a field that is not there. The documents are
 * collected after approval, by staff, the way they already are.
 *
 * pending_vendors.dropoff_locations, address_1, address_2 and address_3
 * are not here either, for a different reason: nothing in the app reads
 * any of them, public.vendors has no address columns at all, and
 * approvePendingVendor carries none of them across. They are dead columns
 * from the old form, and a question whose answer is thrown away the
 * moment it is approved is worse than no question - it costs the person
 * filling it in real time and returns nothing.
 *
 * -- Why submission() is so careful about status -------------------
 *
 * Migration 144 is what lets a stranger write to these tables at all, and
 * its policy is `with check (status = 'pending' and reviewed_at is
 * null)`. A row that sets anything else is refused by the database, not
 * by this file. submission() sets both explicitly so the guarantee is
 * visible and testable rather than resting on a column default.
 *
 * The same migration revokes SELECT from anon, which is why the caller
 * must insert with `.insert(row)` and NOT `.insert(row).select()` - the
 * read-back would fail on a row that was written perfectly well.
 */

import { normaliseIban } from './legal-prefill';

export type Lang = 'en' | 'ar';
export type RegKind = 'vendor' | 'client';

/** What a field can be wrong about. The form shows one per field. */
export type Problem = 'required' | 'email' | 'phone' | 'iban' | 'date' | 'number' | 'link';

export type FieldType =
  | 'text' | 'email' | 'tel' | 'date' | 'iban' | 'number' | 'link' | 'category' | 'choice';

export interface FieldChoice {
  value: string;
  en: string;
  ar: string;
}

export interface FieldSpec {
  /** The column in pending_vendors / pending_clients. Not a made-up name. */
  key: string;
  type: FieldType;
  required: boolean;
  section: string;
  en: string;
  ar: string;
  /** Placeholder text, where the app's own editor has one. */
  hintEn?: string;
  hintAr?: string;
  /** For `choice` fields only. */
  choices?: FieldChoice[];
}

export interface SectionSpec {
  key: string;
  en: string;
  ar: string;
}

/**
 * One row of public.vendor_categories, as the form needs it. `id` is the
 * uuid that lands in pending_vendors.category_id; `key` is the same
 * category as free text, which is what vendorCategoryKey() reads first.
 */
export interface VendorCategory {
  id?: string | null;
  key: string;
  label: string;
  requires_license: boolean;
}

/** The table each kind of registration lands in. */
export const REG_TABLE: Readonly<Record<RegKind, string>> = {
  vendor: 'pending_vendors',
  client: 'pending_clients',
};

/**
 * Categories whose work reaches the client's tracking sheet, and so the
 * only ones asked for platforms. Mirrors TRACKABLE_VENDOR_CATEGORIES in
 * hooks/use-workflow.ts, which mirrors vendor_is_trackable() in 045.
 */
export const TRACKABLE_CATEGORY_KEYS: ReadonlyArray<string> =
  ['influencer', 'ugc', 'ugc creator', 'user generated content'];

export function categoryIsTrackable(key: string | null | undefined): boolean {
  return TRACKABLE_CATEGORY_KEYS.includes(String(key ?? '').trim().toLowerCase());
}

/* ==================================================================== */
/* Labels                                                               */
/* ==================================================================== */

const AR = {
  category: 'التصنيف',
  fullName: 'الاسم الكامل أو اسم الشركة',
  signatory: 'اسم المفوض بالتوقيع',
  signatoryCo: 'اسم المفوض بالتوقيع',
  signatoryTitle: 'المسمى الوظيفي للمفوض',
  idNumber: 'رقم الهوية الوطنية',
  licenceNumber: 'رقم السجل التجاري',
  licenceExpiry: 'تاريخ انتهاء السجل',
  vat: 'الرقم الضريبي',
  cr: 'رقم السجل التجاري',
  email: 'البريد الإلكتروني',
  companyEmail: 'البريد الإلكتروني للشركة',
  phone: 'رقم الجوال',
  bank: 'اسم البنك',
  accountName: 'اسم صاحب الحساب',
  accountNumber: 'رقم الحساب',
  iban: 'رقم الآيبان',
  swift: 'رمز السويفت',
  platforms: 'المنصات التي تعمل عليها',
  locationLink: 'رابط الموقع',
  shortAddress: 'العنوان المختصر',
  age: 'العمر',
  gender: 'الجنس',
  male: 'ذكر',
  female: 'أنثى',
  rentalType: 'نوع التأجير',
  eventOpening: 'الافتتاح',
  eventCeremony: 'الحفل',
  locationType: 'نوع الموقع',
  companyName: 'اسم الشركة',
  street: 'الشارع',
  city: 'المدينة',
  postcode: 'الرمز البريدي',
  country: 'الدولة',
  nationalAddress: 'العنوان الوطني',
};

const SECTION: Readonly<Record<string, SectionSpec>> = {
  work: { key: 'work', en: 'What you do', ar: 'مجال عملك' },
  who: { key: 'who', en: 'Who you are', ar: 'من أنت' },
  company: { key: 'who', en: 'The company', ar: 'الشركة' },
  identity: { key: 'identity', en: 'Identity', ar: 'الهوية والسجل' },
  registration: { key: 'identity', en: 'Registration numbers', ar: 'الأرقام النظامية' },
  details: { key: 'details', en: 'Your work', ar: 'تفاصيل العمل' },
  contact: { key: 'contact', en: 'How to reach you', ar: 'بيانات التواصل' },
  bank: { key: 'bank', en: 'Where we pay you', ar: 'الحساب البنكي' },
  address: { key: 'address', en: 'Address', ar: 'العنوان' },
};

/* ==================================================================== */
/* The form                                                             */
/* ==================================================================== */

export interface RegForm {
  kind: RegKind;
  /** null until the vendor has answered the first question. */
  category: VendorCategory | null;
  sections: SectionSpec[];
  fields: FieldSpec[];
}

/**
 * The extra questions a category carries, mirroring
 * VendorEditorModal.CategorySpecificFields one for one. A category that
 * is not listed asks nothing extra, and then the form has no "Your work"
 * step at all - which is the point.
 */
const CATEGORY_EXTRAS: Readonly<Record<string, FieldSpec[]>> = {
  logistics: [
    { key: 'location_link', type: 'link', required: false, section: 'details',
      en: 'Location link', ar: AR.locationLink, hintEn: 'Google Maps URL', hintAr: 'Google Maps' },
    { key: 'short_address', type: 'text', required: false, section: 'details',
      en: 'Short address', ar: AR.shortAddress },
  ],
  model: [
    { key: 'age', type: 'number', required: false, section: 'details',
      en: 'Age', ar: AR.age },
    { key: 'gender', type: 'choice', required: false, section: 'details',
      en: 'Gender', ar: AR.gender,
      choices: [
        { value: 'male', en: 'Male', ar: AR.male },
        { value: 'female', en: 'Female', ar: AR.female },
      ] },
  ],
  rentals: [
    { key: 'rental_type', type: 'text', required: false, section: 'details',
      en: 'What you rent out', ar: AR.rentalType,
      hintEn: 'Camera, lighting, props', hintAr: 'كاميرا، إضاءة، إكسسوار' },
  ],
  events: [
    { key: 'event_opening', type: 'text', required: false, section: 'details',
      en: 'Opening', ar: AR.eventOpening },
    { key: 'event_ceremony', type: 'text', required: false, section: 'details',
      en: 'Ceremony', ar: AR.eventCeremony },
  ],
  location: [
    { key: 'location_type', type: 'text', required: false, section: 'details',
      en: 'Type of location', ar: AR.locationType,
      hintEn: 'Studio, outdoor', hintAr: 'استديو، خارجي' },
    { key: 'location_link', type: 'link', required: false, section: 'details',
      en: 'Location link', ar: AR.locationLink, hintEn: 'Google Maps URL', hintAr: 'Google Maps' },
  ],
};

function vendorForm(category: VendorCategory | null): RegForm {
  const key = String(category?.key ?? '').trim().toLowerCase();
  const trackable = categoryIsTrackable(key);

  const fields: FieldSpec[] = [
    { key: 'vendor_category', type: 'category', required: true, section: 'work',
      en: 'What do you do?', ar: AR.category },
  ];

  // Until the question above is answered, that is the whole form. Nothing
  // below it can be decided yet, and guessing would mean showing somebody
  // a licence field and then taking it away.
  if (!category) {
    return { kind: 'vendor', category: null, sections: [SECTION.work], fields };
  }

  fields.push(
    { key: 'full_name', type: 'text', required: true, section: 'who',
      en: 'Full name or company name', ar: AR.fullName },
    { key: 'signatory_name', type: 'text', required: true, section: 'who',
      en: 'Who signs on your behalf', ar: AR.signatory },
  );

  // One identifier, chosen by the category - never a choice between two.
  if (category.requires_license) {
    fields.push(
      { key: 'license_number', type: 'text', required: true, section: 'identity',
        en: 'Commercial registration number', ar: AR.licenceNumber },
      { key: 'license_expiry', type: 'date', required: false, section: 'identity',
        en: 'Registration expiry date', ar: AR.licenceExpiry },
    );
  } else {
    fields.push(
      { key: 'id_number', type: 'text', required: true, section: 'identity',
        en: 'National ID number', ar: AR.idNumber },
    );
  }
  fields.push(
    { key: 'vat_number', type: 'text', required: false, section: 'identity',
      en: 'VAT number', ar: AR.vat },
  );

  // Platforms for the two categories whose work reaches the tracking
  // sheet, and the per-category extras. Everything else has no step here.
  const details: FieldSpec[] = [];
  if (trackable) {
    details.push({
      key: 'platforms', type: 'text', required: true, section: 'details',
      en: 'Platforms you work on', ar: AR.platforms,
      hintEn: 'Instagram, TikTok', hintAr: 'Instagram, TikTok',
    });
  }
  for (const extra of CATEGORY_EXTRAS[key] ?? []) details.push(extra);
  fields.push(...details);

  fields.push(
    { key: 'email', type: 'email', required: true, section: 'contact',
      en: 'Email', ar: AR.email },
    { key: 'phone', type: 'tel', required: false, section: 'contact',
      en: 'Phone', ar: AR.phone },

    { key: 'bank_name', type: 'text', required: true, section: 'bank',
      en: 'Bank', ar: AR.bank },
    { key: 'account_name', type: 'text', required: true, section: 'bank',
      en: 'Account holder name', ar: AR.accountName },
    { key: 'account_number', type: 'text', required: true, section: 'bank',
      en: 'Account number', ar: AR.accountNumber },
    { key: 'iban', type: 'iban', required: true, section: 'bank',
      en: 'IBAN', ar: AR.iban },
    { key: 'swift_code', type: 'text', required: false, section: 'bank',
      en: 'SWIFT / BIC code', ar: AR.swift },
  );

  const sections = [SECTION.work, SECTION.who, SECTION.identity];
  if (details.length > 0) sections.push(SECTION.details);
  sections.push(SECTION.contact, SECTION.bank);

  return { kind: 'vendor', category, sections, fields };
}

function clientForm(): RegForm {
  return {
    kind: 'client',
    category: null,
    sections: [SECTION.company, SECTION.registration, SECTION.contact, SECTION.address],
    fields: [
      { key: 'company_name', type: 'text', required: true, section: 'who',
        en: 'Company name', ar: AR.companyName },
      { key: 'signatory_name', type: 'text', required: true, section: 'who',
        en: 'Who signs on the company’s behalf', ar: AR.signatoryCo },
      { key: 'signatory_title', type: 'text', required: false, section: 'who',
        en: 'Their job title', ar: AR.signatoryTitle },

      { key: 'cr_number', type: 'text', required: true, section: 'identity',
        en: 'Commercial registration (CR) number', ar: AR.cr },
      { key: 'vat_number', type: 'text', required: true, section: 'identity',
        en: 'VAT number', ar: AR.vat },

      { key: 'email', type: 'email', required: true, section: 'contact',
        en: 'Email', ar: AR.email },
      { key: 'company_email', type: 'email', required: false, section: 'contact',
        en: 'Company email', ar: AR.companyEmail },
      { key: 'phone', type: 'tel', required: false, section: 'contact',
        en: 'Phone', ar: AR.phone },

      { key: 'street', type: 'text', required: true, section: 'address',
        en: 'Street', ar: AR.street },
      { key: 'city', type: 'text', required: true, section: 'address',
        en: 'City', ar: AR.city },
      { key: 'postcode', type: 'text', required: false, section: 'address',
        en: 'Postcode', ar: AR.postcode },
      { key: 'country', type: 'text', required: false, section: 'address',
        en: 'Country', ar: AR.country },
      { key: 'national_address', type: 'text', required: false, section: 'address',
        en: 'National address', ar: AR.nationalAddress },
    ],
  };
}

/**
 * The form to show, given what has been answered so far. Build it once
 * and pass it to everything else in this file, so the thing being
 * validated and the thing being submitted cannot be different shapes.
 */
export function regForm(kind: RegKind, category?: VendorCategory | null): RegForm {
  return kind === 'vendor' ? vendorForm(category ?? null) : clientForm();
}

/** Every field of one section, in the order it is declared. */
export function fieldsInSection(form: RegForm, section: string): FieldSpec[] {
  return form.fields.filter((f) => f.section === section);
}

export function label(f: FieldSpec, lang: Lang): string {
  return lang === 'ar' ? f.ar : f.en;
}

export function hint(f: FieldSpec, lang: Lang): string {
  return (lang === 'ar' ? f.hintAr : f.hintEn) ?? '';
}

export function choiceLabel(c: FieldChoice, lang: Lang): string {
  return lang === 'ar' ? c.ar : c.en;
}

export function sectionLabel(s: SectionSpec, lang: Lang): string {
  return lang === 'ar' ? s.ar : s.en;
}

export function isRtl(lang: Lang): boolean {
  return lang === 'ar';
}

/** The `dir` attribute the page should carry. */
export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return isRtl(lang) ? 'rtl' : 'ltr';
}

/** The language the toggle switches to from here. */
export function otherLang(lang: Lang): Lang {
  return lang === 'ar' ? 'en' : 'ar';
}

/* ==================================================================== */
/* Validation                                                           */
/* ==================================================================== */

function txt(v: unknown): string {
  return String(v ?? '').trim();
}

function emailLooksReal(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function phoneLooksReal(v: string): boolean {
  const digits = v.replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15 && /^[+0-9()\-.\s]+$/.test(v);
}

function isIsoDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** vendors.age and pending_vendors.age are integer, so this has to be one. */
function isWholeNumber(v: string): boolean {
  if (!/^\d{1,3}$/.test(v)) return false;
  const n = Number(v);
  return n > 0 && n < 150;
}

function linkLooksReal(v: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(v);
}

/**
 * The IBAN check digits, the way the standard defines them: move the
 * first four characters to the end, turn every letter into two digits,
 * and the whole thing mod 97 must be 1.
 *
 * lib/legal-prefill's newBankAccountError does a shape check only, and
 * deliberately - it runs beside somebody who can see the account and fix
 * a typo. Nobody is standing beside a public form. A transposed pair of
 * digits here becomes a payment that bounces weeks later, so this one
 * does the arithmetic.
 */
function mod97(s: string): number {
  let rem = 0;
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    const part = code >= 65 && code <= 90 ? String(code - 55) : s[i];
    for (let j = 0; j < part.length; j += 1) {
      rem = (rem * 10 + (part.charCodeAt(j) - 48)) % 97;
    }
  }
  return rem;
}

export function ibanIsValid(raw: string): boolean {
  const iban = normaliseIban(raw ?? '');
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$/.test(iban)) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

/**
 * Everything wrong with what has been typed so far, keyed by field.
 *
 * An empty object means the form may be submitted. A field is reported
 * once: missing beats malformed, because "this is required" is the more
 * useful thing to read on an empty box.
 */
export function validate(form: RegForm, values: Record<string, unknown>): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  const v = values ?? {};

  for (const f of form.fields) {
    const raw = txt(v[f.key]);
    if (!raw) {
      if (f.required) out[f.key] = 'required';
      continue;
    }
    if (f.type === 'email' && !emailLooksReal(raw)) out[f.key] = 'email';
    else if (f.type === 'tel' && !phoneLooksReal(raw)) out[f.key] = 'phone';
    else if (f.type === 'date' && !isIsoDate(raw)) out[f.key] = 'date';
    else if (f.type === 'iban' && !ibanIsValid(raw)) out[f.key] = 'iban';
    else if (f.type === 'number' && !isWholeNumber(raw)) out[f.key] = 'number';
    else if (f.type === 'link' && !linkLooksReal(raw)) out[f.key] = 'link';
  }

  return out;
}

/**
 * The problems belonging to one section, for a form filled in one section
 * at a time. Nobody may be shown a problem they cannot fix on the screen
 * they are looking at, and nothing may be invisible on every screen and
 * still block the end - the test asserts both.
 */
export function sectionProblems(
  form: RegForm,
  section: string,
  values: Record<string, unknown>,
): Record<string, Problem> {
  const all = validate(form, values);
  const mine = new Set(fieldsInSection(form, section).map((f) => f.key));
  const out: Record<string, Problem> = {};
  for (const k of Object.keys(all)) if (mine.has(k)) out[k] = all[k];
  return out;
}

/**
 * The first section with something wrong in it, or null when the whole
 * form is good. What the last step jumps back to rather than refusing to
 * submit and leaving the person to hunt.
 */
export function firstBadSection(
  form: RegForm,
  values: Record<string, unknown>,
): string | null {
  const all = validate(form, values);
  if (Object.keys(all).length === 0) return null;
  for (const s of form.sections) {
    if (fieldsInSection(form, s.key).some((f) => all[f.key])) return s.key;
  }
  return null;
}

/**
 * Fields whose value is read left to right whatever the page direction.
 *
 * Without `dir="ltr"` on the input, the Arabic form renders
 * +966 50 123 4567 as 4567 123 50 966+ - the bidirectional algorithm
 * doing exactly what it is supposed to, to a string that is not Arabic.
 * The same goes for an IBAN, an account number, a date and a URL.
 */
export const LTR_VALUE_KEYS: ReadonlyArray<string> = [
  'email', 'company_email', 'phone', 'iban', 'account_number', 'license_number',
  'id_number', 'license_expiry', 'swift_code', 'vat_number', 'cr_number',
  'postcode', 'age', 'location_link',
];

export function isLatinValue(key: string): boolean {
  return LTR_VALUE_KEYS.includes(key);
}

const PROBLEM_TEXT: Readonly<Record<Problem, { en: string; ar: string }>> = {
  required: {
    en: 'This is required.',
    ar: 'هذا الحقل مطلوب.',
  },
  email: {
    en: 'That does not look like an email address.',
    ar: 'البريد الإلكتروني غير صحيح.',
  },
  phone: {
    en: 'That does not look like a phone number.',
    ar: 'رقم الجوال غير صحيح.',
  },
  iban: {
    en: 'That IBAN is not valid. Please check it character by character.',
    ar: 'رقم الآيبان غير صحيح، يرجى التحقق منه.',
  },
  date: {
    en: 'Write the date as YYYY-MM-DD.',
    ar: 'اكتب التاريخ بصيغة سنة-شهر-يوم.',
  },
  number: {
    en: 'Please write a whole number.',
    ar: 'يرجى كتابة رقم صحيح.',
  },
  link: {
    en: 'Please paste the full link, starting with https://',
    ar: 'يرجى لصق الرابط كاملاً بدءاً بـ https://',
  },
};

export function problemText(p: Problem, lang: Lang): string {
  const pair = PROBLEM_TEXT[p];
  if (!pair) return '';
  return lang === 'ar' ? pair.ar : pair.en;
}

/** Every string on the page that is not a field label. */
export const UI: Readonly<Record<string, { en: string; ar: string }>> = {
  pageTitle: {
    en: 'Registration',
    ar: 'التسجيل',
  },
  chooseTitle: {
    en: 'Are you registering as a vendor or as a client?',
    ar: 'هل تسجّل كمورد أم كعميل؟',
  },
  vendor: {
    en: 'Vendor',
    ar: 'مورد',
  },
  vendorHint: {
    en: 'You provide a service to us and we pay you.',
    ar: 'تقدّم لنا خدمة وندفع لك.',
  },
  client: {
    en: 'Client',
    ar: 'عميل',
  },
  clientHint: {
    en: 'We run campaigns for you and invoice you.',
    ar: 'ندير لك حملات ونصدر لك الفواتير.',
  },
  categoryPrompt: {
    en: 'Pick the closest one. It decides what we ask you for next.',
    ar: 'اختر الأقرب. هذا يحدد ما سنسألك عنه بعد ذلك.',
  },
  categoryEmpty: {
    en: 'The list could not be loaded. Please refresh the page.',
    ar: 'تعذر تحميل القائمة. يرجى تحديث الصفحة.',
  },
  back: {
    en: 'Back',
    ar: 'رجوع',
  },
  next: {
    en: 'Next',
    ar: 'التالي',
  },
  requiredNote: {
    en: 'Fields marked * are required.',
    ar: 'الحقول المعلمة بـ * مطلوبة.',
  },
  submit: {
    en: 'Send registration',
    ar: 'إرسال التسجيل',
  },
  sending: {
    en: 'Sending...',
    ar: 'جارٍ الإرسال...',
  },
  fixFirst: {
    en: 'Please check the highlighted fields.',
    ar: 'يرجى مراجعة الحقول المظللة.',
  },
  doneTitle: {
    en: 'Thank you. Your registration has been received.',
    ar: 'شكراً لك. تم استلام تسجيلك.',
  },
  doneBody: {
    en: 'Somebody will review it and get in touch with you.',
    ar: 'سيتم مراجعته والتواصل معك.',
  },
  failed: {
    en: 'Your registration could not be sent. Please check your connection and try again.',
    ar: 'تعذر إرسال التسجيل. يرجى التحقق من الاتصال والمحاولة مرة أخرى.',
  },
  stepOf: {
    en: 'Step {n} of {total}',
    ar: 'الخطوة {n} من {total}',
  },
  toArabic: {
    en: 'العربية',
    ar: 'العربية',
  },
  toEnglish: {
    en: 'English',
    ar: 'English',
  },
};

export function t(key: string, lang: Lang): string {
  const pair = UI[key];
  if (!pair) return '';
  return lang === 'ar' ? pair.ar : pair.en;
}

/** "Step 3 of 5", in either language. */
export function stepText(lang: Lang, n: number, total: number): string {
  return t('stepOf', lang).replace('{n}', String(n)).replace('{total}', String(total));
}

/* ==================================================================== */
/* The row                                                              */
/* ==================================================================== */

/**
 * The row to insert, and nothing else.
 *
 * Every key is a column of REG_TABLE[form.kind]. `id` is never set - the
 * sequence owns it. `status` and `reviewed_at` are set explicitly because
 * migration 144's policy checks them; a caller cannot override them,
 * because anything in `values` that is not a declared field is dropped.
 *
 * category_id rides along beside vendor_category rather than replacing
 * it: vendorCategoryKey() reads the free text first and falls back to the
 * lookup, and approvePendingVendor has never written category_id at all,
 * which is why every vendor born from a registration arrived with no
 * lookup category.
 *
 * Blanks become null rather than '': a question nobody answered is not an
 * empty answer, and registry.ts's txt() treats the two the same anyway.
 */
export function submission(
  form: RegForm,
  values: Record<string, unknown>,
  submittedAtIso: string,
): Record<string, unknown> {
  const v = values ?? {};
  const row: Record<string, unknown> = {};
  for (const f of form.fields) {
    const raw = txt(v[f.key]);
    if (!raw) { row[f.key] = null; continue; }
    if (f.type === 'iban') row[f.key] = normaliseIban(raw);
    // age is integer on both tables (146). A string here is a refused
    // insert, which loses the whole registration rather than one field.
    else if (f.type === 'number') row[f.key] = isWholeNumber(raw) ? Number(raw) : null;
    else row[f.key] = raw;
  }
  if (form.kind === 'vendor') row.category_id = form.category?.id ?? null;
  row.status = 'pending';
  row.submitted_at = String(submittedAtIso ?? '');
  row.reviewed_at = null;
  return row;
}
