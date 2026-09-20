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
 * 2. **`id` and `day` stay empty.** The old preview marked both "pending" and
 *    filled neither - the contract number is stamped at generation and the
 *    weekday was never wired. Leaving them blank matches today exactly; the
 *    operator can type them, because they are `text` fields rather than the
 *    `auto` type nothing in the app can fill.
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
    id: '',
    day: '',
    date: isIsoDate(txt(opts.today)) ? txt(opts.today) : '',
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
