/**
 * Prefilling a UGC contract from the booking it came out of.
 *
 * The old contract app never asked anyone to type these. `contractFieldValues`
 * in public/contracts/contract-preview.js derives all sixteen from the vendor,
 * their bank, the campaign and the booking, and the operator only ever reads
 * them back. The legal system has no such link, so porting the template
 * without this would turn sixteen free fields into sixteen retyped ones,
 * IBAN included - slower than the flow it replaces.
 *
 * This module is the mapping, kept pure so it can be exercised without
 * clicking: the caller resolves the booking into the same shape the vendor
 * contract request already uses (buildVendorContractPayload in
 * hooks/use-workflow.ts), and this turns that into legal.contract_field rows.
 *
 * -- Two things it deliberately does NOT copy from the old preview --
 *
 * 1. **The amount is the vendor's fee, never the client's price.** The old
 *    preview used the ad line's `price`, which is what the CLIENT is billed;
 *    six ads at 1,500 costing 700 each went to the influencer as SAR 9,000
 *    against a real 4,200. The request payload already fixed this by sending
 *    the net, and the comment in use-workflow.ts records why. `amount` here
 *    is that net. Passing a client price in would re-open the same hole.
 *
 * 2. **`id` is left for the database and `day` is derived.** The old preview
 *    marked both "pending" and filled neither. The contract number is now
 *    reserved by legal.reserve_contract_number (migration 108) just before
 *    issue, so an abandoned draft does not burn one; the weekday comes off
 *    the date here, because the opening sentence names both and they have to
 *    agree.
 *
 * The four influencer columns are NOT single fields. The live template's
 * one-row table became typed columns in the port, so a campaign with three
 * influencers is three rows rather than three contracts. They come back as
 * `tableRow`, which the caller stores under the table block's key.
 */

/** The resolved booking, in the shape the vendor contract request already uses. */
export interface UgcContractSource {
  /** The licence party: the org when the talent performs under one, else the vendor. */
  vendor_name?: string | null;
  /** That party's licence number, or their ID when they have no licence. */
  license_number?: string | null;
  /** The brand, campaign first and booking second. */
  brand_name?: string | null;
  /** The performer's name, when it differs from the licence party. */
  contact_name?: string | null;
  /** The vendor's handle - "the name in the platform" (vendors.platforms). */
  platform_handle?: string | null;
  /** Booking platform first, campaign second. */
  platforms?: string | null;
  /** The ad types, summarised from the ad lines when there are any. */
  ad_type?: string | null;
  /** THE VENDOR'S FEE. Null when nobody has agreed one - see above. */
  amount?: number | null;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  iban?: string | null;
}

export interface UgcPrefillOptions {
  /** Today as YYYY-MM-DD. Passed in, never read from the clock, so this stays pure. */
  today: string;
  /**
   * The currency word appended to the amount, e.g. the template's own
   * `strings.riyal`. Passed in so this file needs no non-ASCII literal.
   */
  currency?: string;
  /** Campaign length in days, when the caller knows it. Nothing stores it. */
  durationDays?: number | null;
}

export interface UgcPrefill {
  /** Single-field values, keyed by placeholder key. */
  values: Record<string, string>;
  /** One row for the outputs table: the influencer, their platform and account. */
  tableRow: Record<string, string>;
}

/** The outputs table's columns, in the order the seeded template has them. */
export const UGC_TABLE_COLUMN_KEYS = ['name_2', 'platform_smart', 'channel_name', 'ad_types'];

/** The fields the template marks required, so a caller can report real gaps. */
export const UGC_REQUIRED_KEYS = [
  'license_name', 'license_number', 'brand_name', 'Amount_full', 'duration',
  'bank_name', 'account_name', 'account_number', 'iban',
];

function txt(v: unknown): string {
  if (v == null) return '';
  return typeof v === 'string' ? v.trim() : String(v).trim();
}

/**
 * Group a number to two decimals with thousands separators, exactly as the
 * live contract app's moneyText does, so a ported contract reads identically.
 * Returns '' for anything that is not a finite number.
 */
export function moneyText(value: unknown): string {
  const raw = txt(value).replace(/,/g, '');
  if (raw === '') return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  const negative = n < 0;
  const [whole, frac] = Math.abs(n).toFixed(2).split('.');
  let out = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ',';
    out += whole.charAt(i);
  }
  return `${negative ? '-' : ''}${out}.${frac}`;
}

/**
 * The Arabic weekday names, Sunday first, matching getUTCDay()'s order. Written
 * as \u escapes so this file stays ASCII and survives a console paste.
 */
export const ARABIC_WEEKDAYS = [
  '\u0627\u0644\u0623\u062d\u062f',
  '\u0627\u0644\u0625\u062b\u0646\u064a\u0646',
  '\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621',
  '\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621',
  '\u0627\u0644\u062e\u0645\u064a\u0633',
  '\u0627\u0644\u062c\u0645\u0639\u0629',
  '\u0627\u0644\u0633\u0628\u062a',
];

/**
 * The Arabic weekday for a YYYY-MM-DD date, or '' if it is not one.
 *
 * Built from the date's own numbers through Date.UTC, never from a local
 * Date: `new Date('2026-09-20')` is midnight UTC, which is the day before in
 * any timezone west of Greenwich and reads as the wrong weekday. The contract
 * says "the agreement was concluded on <day> <date>", so the two have to be
 * the same day.
 */
export function arabicWeekday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt(iso));
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects 31 February and friends: the roll-over lands on another date.
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return '';
  return ARABIC_WEEKDAYS[back.getUTCDay()] ?? '';
}

/** True for a YYYY-MM-DD string, which is what the `date` field type accepts. */
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * The contract_field values for a new UGC contract off this booking.
 *
 * Every value is a string, because that is what legal.contract_field stores.
 * A source that is missing yields '' rather than a placeholder word: the field
 * then reads as empty in the fill screen, which is the honest state and is
 * what `contractReady` checks against.
 */
export function ugcPrefill(src: UgcContractSource, opts: UgcPrefillOptions): UgcPrefill {
  const currency = txt(opts.currency);
  const amount = moneyText(src.amount);
  const days = opts.durationDays;

  const values: Record<string, string> = {
    // Stamped at generation in the old flow; left for the operator here.
    // Assigned by legal.reserve_contract_number (migration 108) as the last
    // step before issue, so an abandoned draft does not burn a number.
    id: '',
    date: isIsoDate(txt(opts.today)) ? txt(opts.today) : '',
    // The weekday the contract's own opening sentence names, derived from
    // that date rather than left for somebody to work out.
    day: arabicWeekday(txt(opts.today)),
    license_name: txt(src.vendor_name),
    license_number: txt(src.license_number),
    brand_name: txt(src.brand_name),
    // The vendor's fee, with the currency word the template itself carries.
    Amount_full: amount ? (currency ? `${amount} ${currency}` : amount) : '',
    duration: typeof days === 'number' && Number.isFinite(days) && days > 0 ? String(Math.round(days)) : '',
    bank_name: txt(src.bank_name),
    account_name: txt(src.account_name),
    account_number: txt(src.account_number),
    iban: txt(src.iban),
  };

  const tableRow: Record<string, string> = {
    // The performer, not the licence party: an influencer under an agency
    // licence signs as themselves in the outputs table.
    name_2: txt(src.contact_name) || txt(src.vendor_name),
    platform_smart: txt(src.platforms),
    channel_name: txt(src.platform_handle),
    ad_types: txt(src.ad_type),
  };

  return { values, tableRow };
}

/**
 * The fields the UGC template fills from a picker rather than by typing.
 *
 * Keyed by name here rather than by a `source` column on legal.placeholder,
 * which is where this belongs eventually - the column exists and is empty.
 * Keys are honest about the coupling: change the template's field names and
 * these move with them, and the pickers simply stop appearing rather than
 * writing to the wrong field.
 */
export const UGC_BRAND_KEY = 'brand_name';
export const UGC_BANK_KEYS = ['bank_name', 'account_name', 'account_number', 'iban'];

/**
 * The field the template prints as the contract number. Nobody types it:
 * legal.reserve_contract_number (migration 108) writes both this field and
 * legal.contract.contract_no in one statement, as the last act of the draft.
 */
export const CONTRACT_NO_KEY = 'id';

/**
 * The values a contract is sealed over, with the reserved number stamped in.
 *
 * Returns the same object when there is nothing to stamp, so a caller can tell
 * a no-op apart and a re-issue of an already numbered contract hashes the same
 * string it hashed the first time. Pure - the number comes from the database,
 * this only decides what the fingerprint covers.
 */
export function stampContractNumber(
  values: Record<string, string>,
  contractNo: string | null | undefined,
): Record<string, string> {
  const no = txt(contractNo);
  if (!no || values[CONTRACT_NO_KEY] === no) return values;
  return { ...values, [CONTRACT_NO_KEY]: no };
}

/** A vendor as the contract needs to see them, with their licence org attached. */
export interface ContractVendor {
  id: number | string;
  name?: string | null;
  contact_name?: string | null;
  license_number?: string | null;
  id_number?: string | null;
  /** The licence-holding organization, when this talent performs under one. */
  org?: { name?: string | null; license_number?: string | null; id_number?: string | null } | null;
}

/**
 * Who the contract's second party actually is, and the number that proves it.
 *
 * When talent performs under an agency's commercial licence the ORG is the
 * party - its name leads the contract and its licence number is the licence -
 * while the talent's own name still names the performer further down. Talent
 * on their own licence are the party themselves. An influencer with no licence
 * falls back to their ID number, because that is what the contract needs and
 * requiring a licence blocked every vendor contract that had none.
 *
 * The same rule as buildVendorContractPayload in hooks/use-workflow.ts, here
 * so the picker and the booking path cannot drift apart.
 */
export function licenceParty(v: ContractVendor | null | undefined): { name: string; number: string } {
  if (!v) return { name: '', number: '' };
  const orgName = txt(v.org?.name);
  const own = [txt(v.license_number), txt(v.id_number)].find(Boolean) ?? '';
  if (orgName) {
    const orgNum = [txt(v.org?.license_number), txt(v.org?.id_number), own].find(Boolean) ?? '';
    return { name: orgName, number: orgNum };
  }
  return { name: txt(v.name), number: own };
}

/**
 * How a vendor reads in the picker. The number is the disambiguator: two
 * talents called the same thing are told apart by their licence, and an
 * agency's people all show the agency beneath their own name.
 */
export function vendorPickerHint(v: ContractVendor): string {
  const p = licenceParty(v);
  const parts = [p.number];
  if (txt(v.org?.name) && txt(v.org?.name) !== txt(v.name)) parts.push(txt(v.org?.name));
  return parts.filter(Boolean).join(' - ');
}

/** One of a vendor's bank accounts, as much of it as a contract needs. */
export interface VendorBankAccount {
  id: number | string;
  bank_name?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  iban?: string | null;
}

/**
 * How one account reads in the picker: the bank, then enough of the IBAN to
 * tell two accounts at the same bank apart, and never the whole thing - a
 * dropdown is a screen-sharing hazard and the full number is on the field
 * below anyway.
 */
export function bankAccountLabel(a: VendorBankAccount): string {
  const bank = txt(a.bank_name);
  const iban = txt(a.iban).replace(/\s+/g, '');
  const tail = iban.length > 4 ? `${iban.slice(0, 2)}...${iban.slice(-4)}` : iban;
  const name = txt(a.account_name);
  return [bank || name || 'Account', tail].filter(Boolean).join(' - ');
}

/**
 * The four field values one chosen account sets. Picking an account fills all
 * of them together, the way the contract app does: a bank name from one
 * account beside an IBAN from another is how money goes to the wrong place.
 */
export function bankValuesFor(a: VendorBankAccount | null | undefined): Record<string, string> {
  return {
    bank_name: txt(a?.bank_name),
    account_name: txt(a?.account_name),
    account_number: txt(a?.account_number),
    iban: txt(a?.iban),
  };
}

/** The account whose IBAN matches what the contract currently holds, if any. */
export function matchBankAccount(
  accounts: VendorBankAccount[], iban: string,
): VendorBankAccount | null {
  const want = txt(iban).replace(/\s+/g, '').toUpperCase();
  if (!want) return null;
  return accounts.find((a) => txt(a.iban).replace(/\s+/g, '').toUpperCase() === want) ?? null;
}

/**
 * Which required fields the booking could not supply, so the caller can say
 * "this will open with three gaps" instead of the operator finding out at the
 * Issue button. Keys, in template order; empty means nothing to fill by hand.
 */
export function ugcPrefillGaps(p: UgcPrefill): string[] {
  return UGC_REQUIRED_KEYS.filter((k) => !txt(p.values[k]));
}

/**
 * True when the row has nothing in it - a booking with no vendor resolved.
 * The caller should then write no table row at all rather than an empty one,
 * since an empty row prints as a blank line in the contract.
 */
export function isEmptyTableRow(row: Record<string, string>): boolean {
  return UGC_TABLE_COLUMN_KEYS.every((k) => !txt(row[k]));
}
