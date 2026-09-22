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
 * The four influencer columns describe THE ONE vendor this contract is for.
 * The live template's table is a header and a single row of merge fields
 * (contract-template-ar.js block 11), so three influencers are three
 * contracts, not three rows - only a CLIENT contract lists several vendors in
 * one document. They still come back as `tableRow` for the caller that fills
 * the row directly; on the fill screen they are ordinary fields, because the
 * seeded block carries row_source 'fields'.
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
    // THE NUMBER ONLY - no currency word. Siraj, reading a filled contract:
    // "the 500 then saudi riyal needs to be removed."
    //
    // It also removes a real inconsistency. Two paths fill this field and they
    // appended DIFFERENT words: the campaign's Draft contract button passed
    // 'SAR' and the Tasks screen appended the Arabic for Saudi riyal, so one
    // clause of one template version read two ways depending only on which
    // button raised it - and each was fingerprinted and frozen that way. The
    // clause already says what the number is ("the advertising amount, being
    // X, exclusive of tax"), so the word carried no meaning, only the
    // inconsistency.
    //
    // The fix is the OPTION, not the two call sites: UgcPrefillOptions has no
    // currency field any more, so no caller can put a word there again.
    Amount_full: amount,
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

  // THE OUTPUTS TABLE IS READ FROM `values`, NOT FROM `tableRow`.
  //
  // Siraj: "ad type isnt automatic for some reason". It was worse than that -
  // all four columns were blank on any contract drafted from a booking: the
  // influencer, the platform, the handle and the ad type.
  //
  // The template's table block carries `row_source: 'fields'`, and for that
  // source `tableRowsFor` builds its one row out of the contract's ordinary
  // field values, keyed `name_2` / `platform_smart` / `channel_name` /
  // `ad_types`. But this function returned them in `tableRow`, the caller
  // passed that as `p_table_row`, and migration 107 stores it under the
  // reserved key `__aq_table_<block id>` - which a `fields` table never reads.
  //
  // A STALE-MIGRATION MISMATCH, not a typo: 107 was written against seed 105,
  // whose table block had no `row_source` and so defaulted to 'rows'. Seed 109
  // flipped it to 'fields' and 107 was never revisited. Nothing failed, because
  // both halves kept working perfectly on their own key.
  //
  // So the same four values go in BOTH places: `values` is what the seeded
  // template reads today, and `tableRow` stays for a template that really does
  // collect rows. Writing one and not the other is what caused this.
  for (const k of UGC_TABLE_COLUMN_KEYS) {
    if (tableRow[k]) values[k] = tableRow[k];
  }

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

/** The keys that are not typed by hand: the date drives the weekday, the
 *  licence drives the performer's name, and both lists come from the registry. */
export const UGC_DATE_KEY = 'date';
export const UGC_DAY_KEY = 'day';
export const UGC_PERFORMER_KEY = 'name_2';
export const UGC_PLATFORM_KEY = 'platform_smart';
export const UGC_AD_TYPE_KEY = 'ad_types';

/**
 * A person's first and last name, with anything in between dropped.
 *
 * Saudi names on a licence are commonly four parts - given, father,
 * grandfather, family - and the contract's outputs table names the performer,
 * not their lineage. Siraj: "name_2 auto takes first and last name from
 * license". A single-word name comes back whole; a name that is already two
 * words is unchanged. Latin and Arabic alike, because this only splits on
 * whitespace. Pure.
 */
export function firstLast(name: unknown): string {
  const parts = txt(name).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/**
 * Who the outputs table names: the vendor themselves, shortened to first and
 * last.
 *
 * NOT licenceParty(). When a talent is licensed under an agency the agency is
 * the contracting party (license_name), but the influencer doing the work is
 * still this person - the live contract app takes name_2 from vendor.name
 * either way (contract-preview.js:263). For a vendor on their own licence the
 * two are the same name, which is the case Siraj described. Pure.
 */
export function performerName(v: ContractVendor | null | undefined): string {
  return v ? firstLast(v.name) : '';
}

/**
 * The date and the weekday it implies, as one change.
 *
 * The contract's opening sentence names both ("on <day> <date>"), so they must
 * never be set apart from each other - a date edited by hand with a stale
 * weekday beside it is a contract that contradicts itself on line four. Pure;
 * returns the same object when nothing moves. Pass '' to clear both.
 */
export function datedValues(
  values: Record<string, string>,
  iso: string,
): Record<string, string> {
  const d = txt(iso);
  const day = arabicWeekday(d);
  if (values[UGC_DATE_KEY] === d && values[UGC_DAY_KEY] === day) return values;
  return { ...values, [UGC_DATE_KEY]: d, [UGC_DAY_KEY]: day };
}

export const UGC_CHANNEL_KEY = 'channel_name';

/**
 * A social handle in the one shape the contract app has always written:
 * exactly one leading `@`, and nothing else touched.
 *
 * Ported byte-for-byte from normalizeHandle in public/contracts/app.js:3569.
 * `@@sara`, `sara` and ` @sara ` are all the same account, and a register that
 * spells them three ways cannot be grouped or searched. Empty stays empty -
 * a bare `@` is not a handle. Pure.
 */
export function normalizeHandle(value: unknown): string {
  const cleaned = txt(value).replace(/^@+/, '');
  return cleaned ? `@${cleaned}` : '';
}

/**
 * The handle as it is typed: no `@`, because the screen draws a fixed one to
 * its left (the contract app renders `<span>@</span>` beside an input whose
 * placeholder is just "name"). Pure.
 */
export function handleBody(value: unknown): string {
  return txt(value).replace(/^@+/, '');
}

/**
 * Several platforms on one contract become one line, the way the contract app
 * joins them: `Instagram: @a TikTok: @b`. One platform is just its handle, with
 * no label - which is what the existing contracts say. Pure.
 *
 * Takes [platform, handle] pairs in the order the operator chose them; a pair
 * with no handle is dropped rather than printing a bare platform name.
 */
export function joinPlatformHandles(pairs: [string, string][]): string {
  const one = pairs.filter(([, h]) => handleBody(h));
  if (one.length === 0) return '';
  if (one.length === 1) return normalizeHandle(one[0][1]);
  return one.map(([p, h]) => `${txt(p)}: ${normalizeHandle(h)}`).join(' ');
}

/**
 * The list fields a contract may name more than one of.
 *
 * Kept here rather than in the screen so a test can assert the set, and so the
 * two places that render them (the fill screen and the task form) cannot come
 * to disagree about which fields are multi-valued. Both carry allow_other in
 * the registry (111); without it a joined value would fail validation, since
 * it is not a member of the list by definition.
 */
export const MULTI_KEYS = [UGC_PLATFORM_KEY, UGC_AD_TYPE_KEY];

/**
 * The platforms a contract names, as a list. Ad types are joined and split the
 * same way - see MULTI_KEYS - so these four functions serve both.
 *
 * `platform_smart` is one field holding one string, because that is what the
 * document prints and what legal.contract_field stores. The contract app has
 * always written several as a comma list (`keys.join(",")`, app.js:3616) and
 * read them back by splitting on the comma (displayPlatforms, app.js:644), so
 * this is that rule and not a new one. Pure.
 */
export function parsePlatforms(value: unknown): string[] {
  return txt(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * The same list back as one value, in the order they were chosen, with
 * duplicates dropped - two of the same platform would print twice in the
 * contract and ask for the same handle twice on the screen. Pure.
 */
export function joinPlatforms(list: string[]): string {
  const seen: string[] = [];
  for (const p of list) {
    const v = txt(p);
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen.join(', ');
}

/**
 * The reverse of joinPlatformHandles: which handle belongs to which platform.
 *
 * Needed because the screen has to REOPEN a saved contract with each handle
 * back in its own box. Without this, a contract saved with two platforms comes
 * back with one joined string in the first box and the second handle lost the
 * moment anything is typed.
 *
 * Parsed by finding each platform's `<name>:` marker and taking everything up
 * to the next one, rather than splitting on whitespace - a handle typed with a
 * space in it then stays whole instead of being cut in half.
 *
 * Two kindnesses, both for values that already exist:
 *  - one platform: the whole string is its handle, since that is how a
 *    single-platform contract has always been written (no label at all).
 *  - several platforms but no markers: the string is a bare handle from back
 *    when the contract had one platform, so it belongs to the first. Dropping
 *    it would silently empty a field somebody filled.
 *
 * Every platform passed in gets a key, empty when it has no handle, so the
 * caller can render a box per platform without checking. Pure.
 */
export function parsePlatformHandles(
  channel: unknown, platforms: string[],
): Record<string, string> {
  const keys: string[] = [];
  for (const p of platforms) {
    const v = txt(p);
    if (v && !keys.includes(v)) keys.push(v);
  }
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = '';

  const s = txt(channel);
  if (!s || keys.length === 0) return out;
  if (keys.length === 1) { out[keys[0]] = handleBody(s); return out; }

  const marks: { key: string; at: number; len: number }[] = [];
  for (const k of keys) {
    const needle = `${k}:`;
    const at = s.indexOf(needle);
    if (at >= 0) marks.push({ key: k, at, len: needle.length });
  }
  if (marks.length === 0) { out[keys[0]] = handleBody(s); return out; }
  marks.sort((a, b) => a.at - b.at);
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].at : s.length;
    out[marks[i].key] = handleBody(s.slice(marks[i].at + marks[i].len, end).trim());
  }
  return out;
}

/**
 * The [platform, handle] pairs for joinPlatformHandles, in the order the
 * platforms are named on the contract - so the printed line follows the
 * dropdowns rather than whatever order a map happened to have. Pure.
 */
export function platformHandlePairs(
  platforms: string[], byPlatform: Record<string, string>,
): [string, string][] {
  const seen: string[] = [];
  for (const p of platforms) {
    const v = txt(p);
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen.map((p) => [p, txt(byPlatform[p])] as [string, string]);
}

// ---- how the fill screen is grouped ------------------------------------
//
// Siraj: "separate it so its easier to work with so price and bank info are in
// one place and vendor data and account are in one place". Sixteen fields in
// one column is a list to be got through; three short cards are three
// questions with answers.

export type FieldGroup = 'contract' | 'vendor' | 'payment';

export const FIELD_GROUPS: { key: FieldGroup; label: string; hint: string }[] = [
  { key: 'contract', label: 'The job', hint: 'What is being bought, for whom, and for how long.' },
  { key: 'vendor', label: 'The vendor and their account', hint: 'Who is doing it, where, and as what.' },
  { key: 'payment', label: 'Price and bank', hint: 'What they are paid and where it goes.' },
];

const GROUP_BY_KEY: Record<string, FieldGroup> = {
  brand_name: 'contract',
  date: 'contract',
  duration: 'contract',
  license_name: 'vendor',
  license_number: 'vendor',
  name_2: 'vendor',
  platform_smart: 'vendor',
  channel_name: 'vendor',
  ad_types: 'vendor',
  Amount_full: 'payment',
  bank_name: 'payment',
  account_name: 'payment',
  account_number: 'payment',
  iban: 'payment',
};

/**
 * Which card a field belongs on. Unknown keys go to `contract`, so a template
 * that names a field this map has never heard of still shows it rather than
 * dropping it off the screen. Pure.
 */
export function fieldGroup(key: string): FieldGroup {
  return GROUP_BY_KEY[txt(key)] ?? 'contract';
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

/**
 * An IBAN the way it should be stored: no spaces, no dashes, upper case.
 *
 * People paste these in fours ("SA85 0500 0068 ...") because that is how a
 * bank prints them. matchBankAccount already normalises before comparing, so
 * an un-normalised one does not break the picker - it just means the same
 * account can be stored two ways and only one of them will ever match.
 */
export function normaliseIban(raw: string): string {
  return String(raw ?? '').replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Why a new bank account cannot be saved yet, or null when it can.
 *
 * Siraj: "if a vendor doesnt have an iban you can save an iban from inside
 * the task for example no iban added you can type the data and it will save".
 *
 * All four are required, not just the IBAN, and that is a kindness rather
 * than strictness: all four PRINT on the contract and all four are required
 * in the field registry, so an account saved with two of them fills two boxes
 * and then blocks Issue with no explanation. Better to say so while the form
 * is open.
 *
 * The IBAN check is deliberately loose - two letters then digits, a plausible
 * length. It is not a mod-97 checksum: this has to accept whatever a vendor
 * actually banks with, and a validator that rejects a real account is worse
 * than one that accepts a typo somebody can see.
 *
 * Pure.
 */
export function newBankAccountError(input: {
  bank_name?: string; account_name?: string; account_number?: string; iban?: string;
}): string | null {
  const missing: string[] = [];
  if (!txt(input?.bank_name)) missing.push('the bank name');
  if (!txt(input?.account_name)) missing.push('the account name');
  if (!txt(input?.account_number)) missing.push('the account number');
  const iban = normaliseIban(input?.iban ?? '');
  if (!iban) missing.push('the IBAN');
  if (missing.length) {
    const list = missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
    return `Still needs ${list}. All four print on the contract.`;
  }
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]{10,30}$/.test(iban)) {
    return 'That IBAN does not look right - two letters, two digits, then the account.';
  }
  return null;
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

/* ===================================================================
   HOW MANY OF EACH AD TYPE
   -------------------------------------------------------------------
   Siraj: "I need a quantity with the ad type."

   The format is not new. `adTypeSummary` in lib/ad-lines has always
   produced "6 \u00d7 Home Ad, 6 \u00d7 Store Visit, 3 \u00d7 Reminder" and
   fetchBookingPrefill has always written it into the contract's ad_types
   field, so a contract raised from a booking with ad lines already prints
   the counts. Two things were missing and one was broken:

     * a contract raised in the REGISTER, or from a booking with no ad
       lines, had no way to say "three reels" - the picker offered a tick
       box per type and nothing else;
     * and the picker could not READ the quantified form back. It splits on
       the comma and matches each piece against the list of ad types, so
       "6 \u00d7 Home Ad" matched nothing: every quantified value fell into the
       "Other" free-text box with NO BOX TICKED.

   That second one is a live bug, not a missing feature. Reproduced against
   the real functions before any of this was written:

     stored          "6 \u00d7 Home Ad, 3 \u00d7 Reminder"
     ticked boxes    none
     in "Other"      the whole string

   So the screen tells her nothing is selected. If she then ticks Home Ad -
   which looks unticked - she gets "Home Ad, 6 \u00d7 Home Ad, 3 \u00d7 Reminder",
   the same ad type twice, once with no count. If instead she clears the
   Other box because it looks like junk, the field empties completely. Both
   are one click away on the main path into this screen.

   -- WHY ONE IS WRITTEN BARE ------------------------------------------

   joinQuantified writes a count of one as just the name: "Reel", not
   "1 \u00d7 Reel". That is not cosmetic. Every contract already issued holds
   an unquantified value, and the SHA-256 fingerprint is taken over the
   filled text. If reopening one rewrote "Reel" as "1 \u00d7 Reel", every one
   of those contracts would verify as "content differs" the first time
   anybody touched the screen. One is bare, so the round trip is exact and
   the seal holds.

   -- PLATFORMS DO NOT GET COUNTS --------------------------------------

   "3 \u00d7 Instagram" means nothing. MULTI_KEYS is still both fields; only
   the ones in QTY_KEYS carry a number.
   =================================================================== */

/** The multi-value fields that carry a count per item. */
export const QTY_KEYS = [UGC_AD_TYPE_KEY];

export interface QuantifiedItem {
  /** How many. Always >= 1. */
  qty: number;
  /** The ad type exactly as it prints. */
  name: string;
}

/**
 * Split one item: "6 x Home Ad" -> { qty: 6, name: 'Home Ad' }.
 *
 * The separator is the multiplication sign or a plain x, because both get
 * typed - but they are NOT accepted on the same terms, and the difference is
 * deliberate.
 *
 * The multiplication sign never appears inside an ad type's name, so it is
 * read as a separator with or without a space before it.
 *
 * `x` DOES appear inside names, so it counts only with a space before it.
 * That is what tells "3 x Reel" (three reels) from "2x Speed Edit" (an ad
 * type whose name begins with 2x). The first version of this allowed
 * optional space on both sides and read "2x Speed Edit" as two Speed Edits -
 * the suite caught it, and the rule is now narrow enough to say out loud.
 *
 * Either way a space is required AFTER the separator, and anything that does
 * not match is a NAME, untouched.
 */
export function parseQuantifiedItem(piece: string): QuantifiedItem {
  const s = txt(piece);
  const m = /^(\d{1,4})(?:\s*\u00d7|\s+[xX])\s+(.+)$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    const name = txt(m[2]);
    if (name && n >= 1) return { qty: n, name };
  }
  return { qty: 1, name: s };
}

/** The whole field as a list. Empty pieces are dropped, as in parsePlatforms. */
export function parseQuantified(value: unknown): QuantifiedItem[] {
  return parsePlatforms(value).map(parseQuantifiedItem).filter((i) => !!i.name);
}

/**
 * The list back as one value, in order, with duplicates MERGED rather than
 * dropped.
 *
 * Merged, not dropped, because two entries of the same ad type are two
 * quantities of one thing - "2 x Reel" and "1 x Reel" is three reels, and
 * silently keeping the first would understate what was booked. joinPlatforms
 * drops the later duplicate, which is right for a platform and wrong here.
 *
 * A count of one is written bare. See the header.
 */
export function joinQuantified(items: QuantifiedItem[]): string {
  const order: string[] = [];
  const by = new Map<string, number>();
  for (const it of items ?? []) {
    const name = txt(it?.name);
    if (!name) continue;
    const q = Math.max(1, Math.floor(Number(it?.qty) || 1));
    if (!by.has(name)) order.push(name);
    by.set(name, (by.get(name) ?? 0) + q);
  }
  return order.map((n) => {
    const q = by.get(n) ?? 1;
    return q > 1 ? `${q} \u00d7 ${n}` : n;
  }).join(', ');
}

/** How many of one named type the field currently says. 0 when it is absent. */
export function quantityOf(value: unknown, name: string): number {
  const want = txt(name);
  for (const it of parseQuantified(value)) if (it.name === want) return it.qty;
  return 0;
}

/**
 * Set the count for one type, keeping everything else where it was.
 *
 * A count of zero REMOVES it, which is what a number box being cleared to
 * nothing means, and saves having a separate tick box fight with the number
 * over which one is in charge.
 */
export function setQuantity(value: unknown, name: string, qty: number): string {
  const want = txt(name);
  if (!want) return txt(value);
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const items = parseQuantified(value);
  const found = items.some((i) => i.name === want);
  if (!found) return n > 0 ? joinQuantified([...items, { qty: n, name: want }]) : joinQuantified(items);
  return joinQuantified(
    items.map((i) => (i.name === want ? { ...i, qty: n } : i)).filter((i) => i.qty > 0),
  );
}

/**
 * Everything booked, added up: "12 in total" under the picker.
 *
 * Worth showing because the number that matters to whoever reads the contract
 * is how many pieces of content they are getting, and three types of four is
 * not obviously twelve at a glance.
 */
export function totalQuantity(value: unknown): number {
  return parseQuantified(value).reduce((n, i) => n + i.qty, 0);
}

/**
 * A campaign's recorded contract length, as the number of DAYS the legal
 * template asks for - or null when it cannot be said exactly.
 *
 * -- THE GAP THIS CLOSES ------------------------------------------------
 *
 * The Vendor Contracts card records a term per vendor (pm_tasks
 * contract_length + contract_length_unit, migration 066). The UGC template
 * has its own `duration` field, labelled "Duration (days)". ugcPrefill has
 * accepted `durationDays` since it was written - and the one caller that
 * raises a contract FROM A BOOKING never passed it.
 *
 * So a contract raised off a campaign arrived with Duration blank, and legal
 * typed again a number operations had already recorded. Two fields, one fact,
 * free to disagree - and the one on the contract is the one somebody signs.
 *
 * -- WHY MONTHS ARE NOT CONVERTED ---------------------------------------
 *
 * A week is seven days by definition, so weeks convert exactly. A MONTH IS
 * NOT A FIXED NUMBER OF DAYS. Turning "2 months" into "60 days" would put a
 * number on a signed contract that nobody chose - 60, 61 and 62 are all
 * defensible readings of two months, and the difference is a real difference
 * in what the vendor owes.
 *
 * So months return null: the field is left blank and legal types the term
 * they mean. A blank a person fills is better than a number a program
 * guessed, on a document that binds somebody. Pure.
 */
export function durationDays(n: unknown, unit: unknown): number | null {
  const num = typeof n === 'number' ? n : Number(txt(n));
  if (!Number.isFinite(num) || num <= 0) return null;
  // Same default as lengthLabel: no unit recorded means days.
  const u = (txt(unit) || 'days').toLowerCase();
  if (u === 'days') return Math.round(num);
  if (u === 'weeks') return Math.round(num * 7);
  // 'months', or anything unrecognised. Not guessed.
  return null;
}
