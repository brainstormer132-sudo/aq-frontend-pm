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
 * -- Why THESE fields are required ---------------------------------
 *
 * Not invented here. The app has said for months what it considers an
 * incomplete record, in lib/registry.ts:
 *
 *   vendorGaps:  bank details / IBAN, signatory, ID or licence
 *   clientGaps:  signatory, VAT number, CR number, address
 *
 * Every one of those is required below, because a registration that does
 * not carry them creates a row that shows up in the registry as incomplete
 * on the day it is approved - which is the manual chasing this form exists
 * to stop. Added to that: the NOT NULL columns (full_name, company_name),
 * and an email address, because the portal invite has nowhere to go
 * without one.
 *
 * Nothing else is required. A public form that asks for more than it needs
 * is a form people abandon halfway.
 *
 * "ID or licence" is a pair: either one satisfies the registry, so the
 * form refuses only when BOTH are empty. See PICK_ONE.
 *
 * -- Why there are no document uploads -----------------------------
 *
 * pending_clients has permit_doc, vat_doc and national_address_doc, and
 * they are not on this form. Migrations 140 and 141 shut the anonymous key
 * out of every storage bucket - deliberately, because client-files had
 * been readable by anyone holding the public key. A stranger on a public
 * link therefore cannot upload anything, and a field that cannot work is
 * worse than a field that is not there. The documents are collected after
 * approval, by staff, the way they already are.
 *
 * -- Why submission() is so careful about status -------------------
 *
 * Migration 144 is what lets a stranger write to these tables at all, and
 * its policy is `with check (status = 'pending' and reviewed_at is null)`.
 * A row that sets anything else is refused by the database, not by this
 * file. submission() sets both explicitly so the guarantee is visible and
 * testable rather than resting on a column default.
 *
 * The same migration revokes SELECT from anon, which is why the caller
 * must insert with `.insert(row)` and NOT `.insert(row).select()` - the
 * read-back would fail on a row that was written perfectly well.
 */

import { normaliseIban } from './legal-prefill';

export type Lang = 'en' | 'ar';
export type RegKind = 'vendor' | 'client';

/** What a field can be wrong about. The form shows one per field. */
export type Problem = 'required' | 'email' | 'phone' | 'iban' | 'date' | 'pick_one';

export type FieldType = 'text' | 'email' | 'tel' | 'date' | 'iban';

export interface FieldSpec {
  /** The column in pending_vendors / pending_clients. Not a made-up name. */
  key: string;
  type: FieldType;
  required: boolean;
  section: string;
  en: string;
  ar: string;
}

export interface SectionSpec {
  key: string;
  en: string;
  ar: string;
}

/** The table each kind of registration lands in. */
export const REG_TABLE: Readonly<Record<RegKind, string>> = {
  vendor: 'pending_vendors',
  client: 'pending_clients',
};

const VENDOR_SECTIONS: SectionSpec[] = [
  { key: 'who', en: 'Who you are', ar: 'من أنت' },
  { key: 'identity', en: 'Identity and licence', ar: 'الهوية والسجل' },
  { key: 'contact', en: 'How to reach you', ar: 'بيانات التواصل' },
  { key: 'bank', en: 'Where we pay you', ar: 'الحساب البنكي' },
  { key: 'work', en: 'Your work', ar: 'طبيعة عملك' },
];

const CLIENT_SECTIONS: SectionSpec[] = [
  { key: 'who', en: 'The company', ar: 'الشركة' },
  { key: 'identity', en: 'Registration numbers', ar: 'الأرقام النظامية' },
  { key: 'contact', en: 'How to reach you', ar: 'بيانات التواصل' },
  { key: 'address', en: 'Address', ar: 'العنوان' },
];

const VENDOR_FIELDS: FieldSpec[] = [
  { key: 'full_name', type: 'text', required: true, section: 'who',
    en: 'Full name or company name', ar: 'الاسم الكامل أو اسم الشركة' },
  { key: 'signatory_name', type: 'text', required: true, section: 'who',
    en: 'Who signs on your behalf', ar: 'اسم المفوض بالتوقيع' },

  { key: 'id_number', type: 'text', required: false, section: 'identity',
    en: 'National ID number', ar: 'رقم الهوية الوطنية' },
  { key: 'license_number', type: 'text', required: false, section: 'identity',
    en: 'Commercial registration number', ar: 'رقم السجل التجاري' },
  { key: 'license_expiry', type: 'date', required: false, section: 'identity',
    en: 'Registration expiry date', ar: 'تاريخ انتهاء السجل' },

  { key: 'email', type: 'email', required: true, section: 'contact',
    en: 'Email', ar: 'البريد الإلكتروني' },
  { key: 'phone', type: 'tel', required: false, section: 'contact',
    en: 'Phone', ar: 'رقم الجوال' },
  { key: 'address_1', type: 'text', required: false, section: 'contact',
    en: 'Address', ar: 'العنوان' },
  { key: 'address_2', type: 'text', required: false, section: 'contact',
    en: 'Address line 2', ar: 'العنوان - سطر ثانٍ' },
  { key: 'address_3', type: 'text', required: false, section: 'contact',
    en: 'Address line 3', ar: 'العنوان - سطر ثالث' },

  { key: 'bank_name', type: 'text', required: true, section: 'bank',
    en: 'Bank', ar: 'اسم البنك' },
  { key: 'account_name', type: 'text', required: true, section: 'bank',
    en: 'Account holder name', ar: 'اسم صاحب الحساب' },
  { key: 'account_number', type: 'text', required: true, section: 'bank',
    en: 'Account number', ar: 'رقم الحساب' },
  { key: 'iban', type: 'iban', required: true, section: 'bank',
    en: 'IBAN', ar: 'رقم الآيبان' },
  { key: 'swift_code', type: 'text', required: false, section: 'bank',
    en: 'SWIFT / BIC code', ar: 'رمز السويفت' },

  { key: 'vendor_category', type: 'text', required: false, section: 'work',
    en: 'What you do', ar: 'مجال عملك' },
  { key: 'platforms', type: 'text', required: false, section: 'work',
    en: 'Platforms you work on', ar: 'المنصات التي تعمل عليها' },
  { key: 'dropoff_locations', type: 'text', required: false, section: 'work',
    en: 'Drop-off locations', ar: 'مواقع الاستلام' },
];

const CLIENT_FIELDS: FieldSpec[] = [
  { key: 'company_name', type: 'text', required: true, section: 'who',
    en: 'Company name', ar: 'اسم الشركة' },
  { key: 'signatory_name', type: 'text', required: true, section: 'who',
    en: 'Who signs on the company’s behalf', ar: 'اسم المفوض بالتوقيع' },
  { key: 'signatory_title', type: 'text', required: false, section: 'who',
    en: 'Their job title', ar: 'المسمى الوظيفي للمفوض' },

  { key: 'cr_number', type: 'text', required: true, section: 'identity',
    en: 'Commercial registration (CR) number', ar: 'رقم السجل التجاري' },
  { key: 'vat_number', type: 'text', required: true, section: 'identity',
    en: 'VAT number', ar: 'الرقم الضريبي' },

  { key: 'email', type: 'email', required: true, section: 'contact',
    en: 'Email', ar: 'البريد الإلكتروني' },
  { key: 'company_email', type: 'email', required: false, section: 'contact',
    en: 'Company email', ar: 'البريد الإلكتروني للشركة' },
  { key: 'phone', type: 'tel', required: false, section: 'contact',
    en: 'Phone', ar: 'رقم الجوال' },

  { key: 'street', type: 'text', required: true, section: 'address',
    en: 'Street', ar: 'الشارع' },
  { key: 'city', type: 'text', required: true, section: 'address',
    en: 'City', ar: 'المدينة' },
  { key: 'postcode', type: 'text', required: false, section: 'address',
    en: 'Postcode', ar: 'الرمز البريدي' },
  { key: 'country', type: 'text', required: false, section: 'address',
    en: 'Country', ar: 'الدولة' },
  { key: 'national_address', type: 'text', required: false, section: 'address',
    en: 'National address', ar: 'العنوان الوطني' },
];

/**
 * Groups where at least one member must be filled in, though none of them
 * is required on its own. vendorGaps() accepts an ID number OR a licence
 * number, so the form does too.
 */
export const PICK_ONE: Readonly<Record<RegKind, ReadonlyArray<ReadonlyArray<string>>>> = {
  vendor: [['id_number', 'license_number']],
  client: [],
};

export function fieldsFor(kind: RegKind): FieldSpec[] {
  return kind === 'vendor' ? VENDOR_FIELDS.slice() : CLIENT_FIELDS.slice();
}

export function sectionsFor(kind: RegKind): SectionSpec[] {
  return kind === 'vendor' ? VENDOR_SECTIONS.slice() : CLIENT_SECTIONS.slice();
}

/** Every field of one section, in the order it is declared. */
export function fieldsInSection(kind: RegKind, section: string): FieldSpec[] {
  return fieldsFor(kind).filter((f) => f.section === section);
}

export function label(f: FieldSpec, lang: Lang): string {
  return lang === 'ar' ? f.ar : f.en;
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

/**
 * The IBAN check digits, the way the standard defines them: move the first
 * four characters to the end, turn every letter into two digits, and the
 * whole thing mod 97 must be 1.
 *
 * lib/legal-prefill's newBankAccountError does a shape check only, and
 * deliberately - it runs beside somebody who can see the account and fix a
 * typo. Nobody is standing beside a public form. A transposed pair of
 * digits here becomes a payment that bounces weeks later, so this one does
 * the arithmetic.
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
export function validate(kind: RegKind, values: Record<string, unknown>): Record<string, Problem> {
  const out: Record<string, Problem> = {};
  const v = values ?? {};

  for (const f of fieldsFor(kind)) {
    const raw = txt(v[f.key]);
    if (!raw) {
      if (f.required) out[f.key] = 'required';
      continue;
    }
    if (f.type === 'email' && !emailLooksReal(raw)) out[f.key] = 'email';
    else if (f.type === 'tel' && !phoneLooksReal(raw)) out[f.key] = 'phone';
    else if (f.type === 'date' && !isIsoDate(raw)) out[f.key] = 'date';
    else if (f.type === 'iban' && !ibanIsValid(raw)) out[f.key] = 'iban';
  }

  for (const group of PICK_ONE[kind]) {
    if (group.some((k) => txt(v[k]))) continue;
    // Every member is flagged, because the person has to be shown a choice
    // rather than one arbitrary box turning red.
    for (const k of group) if (!out[k]) out[k] = 'pick_one';
  }

  return out;
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
  pick_one: {
    en: 'Fill in at least one of these two.',
    ar: 'يرجى تعبئة أحد هذين الحقلين على الأقل.',
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
  back: {
    en: 'Back',
    ar: 'رجوع',
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

/** The language the toggle switches to from here. */
export function otherLang(lang: Lang): Lang {
  return lang === 'ar' ? 'en' : 'ar';
}

/**
 * The row to insert, and nothing else.
 *
 * Every key is a column of REG_TABLE[kind]. `id` is never set - the
 * sequence owns it. `status` and `reviewed_at` are set explicitly because
 * migration 144's policy checks them; a caller cannot override them,
 * because anything in `values` that is not a declared field is dropped.
 *
 * Blanks become null rather than '': a question nobody answered is not an
 * empty answer, and registry.ts's txt() treats the two the same anyway.
 */
export function submission(
  kind: RegKind,
  values: Record<string, unknown>,
  submittedAtIso: string,
): Record<string, unknown> {
  const v = values ?? {};
  const row: Record<string, unknown> = {};
  for (const f of fieldsFor(kind)) {
    const raw = txt(v[f.key]);
    row[f.key] = raw ? (f.type === 'iban' ? normaliseIban(raw) : raw) : null;
  }
  row.status = 'pending';
  row.submitted_at = String(submittedAtIso ?? '');
  row.reviewed_at = null;
  return row;
}
