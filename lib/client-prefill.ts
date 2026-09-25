/**
 * What the app already knows about a client campaign contract.
 *
 * The vendor side has had this since 107: raising a contract from a booking
 * fills sixteen fields from the vendor, the booking and its ads, and legal
 * types what is genuinely not recorded anywhere. The client side has had
 * nothing - `sendClientContractRequest` wrote a row into a queue read by an
 * application that has since been deleted, and told the operator "The client
 * contract has gone to Legal."
 *
 * -- WHAT IT FILLS, AND WHAT IT DELIBERATELY DOES NOT ----------------
 *
 * Filled, because the campaign or the client record holds it:
 *
 *   CL_NAME, CL_CR, CL_VAT     the client's registration
 *   CL_SIGNATORY, CL_REP       who signs for them
 *   CL_ADDR                    city and country, the two parts we keep
 *   CL_AMOUNT, CL_AMOUNT_WORDS the campaign budget, and the same figure in
 *                              Arabic words - the contract prints both, and
 *                              two people typing them separately is how they
 *                              come to disagree
 *   CL_DURATION                the term the campaign recorded
 *   C_DATE, C_DAY              today, and its Arabic weekday
 *
 * NOT filled, because nothing in this system records it:
 *
 *   CL_UNI       the unified national number
 *   CL_ZIP       the postcode
 *   CL_TITLE     the signatory's position
 *   CL_ACTIVITY  what the client's business does, for the preamble
 *   CL_PRODUCTS  the products being promoted
 *
 * Those arrive blank, for legal to type on the fill screen. That is the same
 * choice lib/legal-prefill makes about a term in months: a field nobody has
 * an answer for is left empty, never guessed, because a guess on a contract
 * is indistinguishable from a fact once it is printed.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

import { arabicWeekday } from './legal-prefill';
import { amountInWords } from './legal-amount';

const txt = (v: unknown): string => String(v ?? '').trim();

export interface ClientLike {
  company_name?: unknown;
  cr_number?: unknown;
  vat_number?: unknown;
  signatory_name?: unknown;
  city?: unknown;
  country?: unknown;
}

export interface CampaignLike {
  brand_name?: unknown;
  budget?: unknown;
  contract_length?: unknown;
  contract_length_unit?: unknown;
}

/** One line of the outputs table: a vendor booked onto this campaign. */
export interface OutputRow {
  vendorName?: unknown;
  platform?: unknown;
  handle?: unknown;
  /** The ads booked with this vendor, as they were booked. */
  lines?: { ad_type?: unknown; platform?: unknown; quantity?: unknown }[];
}

/**
 * The one platform a row can name, or ''.
 *
 * The column takes a single value from the platforms list, so a booking whose
 * ads run on TikTok AND Instagram cannot answer it - and picking the first
 * would put a contract in front of a client saying the work is on one channel
 * when it was agreed on two. Disagreement leaves it blank for legal, which is
 * the same rule every other unknown follows here.
 */
export function rowPlatform(r: OutputRow | null | undefined): string {
  const onRow = txt(r?.platform);
  if (onRow) return onRow;
  const seen: string[] = [];
  for (const l of r?.lines ?? []) {
    const p = txt(l?.platform);
    if (p && !seen.includes(p)) seen.push(p);
  }
  return seen.length === 1 ? seen[0] : '';
}

/**
 * What was booked, and how many: "3 x Home Ad, 2 x Story".
 *
 * Siraj: "the ad amount is ad type with quantity". Built with the app's own
 * quantified form - the same one the vendor contract has always written - so
 * one reader and one writer serve both. Duplicates merge rather than repeat:
 * two separate Home Ad lines of 2 and 1 read as "3 x Home Ad", because that
 * is what the client is buying.
 */
export function rowAds(r: OutputRow | null | undefined): string {
  const order: string[] = [];
  const by = new Map<string, number>();
  for (const l of r?.lines ?? []) {
    const name = txt(l?.ad_type);
    if (!name) continue;
    const n = Number(l?.quantity);
    const q = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    if (!by.has(name)) order.push(name);
    by.set(name, (by.get(name) ?? 0) + q);
  }
  return order
    .map((n) => (by.get(n)! > 1 ? `${by.get(n)} \u00d7 ${n}` : n))
    .join(', ');
}

/** The two parts of an address the client record keeps, in one line. */
export function clientAddress(client: ClientLike | null | undefined): string {
  return [txt(client?.city), txt(client?.country)].filter(Boolean).join(', ');
}

/**
 * The term, as the contract says it.
 *
 * Not `lengthLabel`: that prints "3 months" for a screen. The contract's
 * sentence already reads "within ..." and takes the span on its own.
 */
export function clientDuration(campaign: CampaignLike | null | undefined): string {
  const n = Number(campaign?.contract_length);
  if (!Number.isFinite(n) || n <= 0) return '';
  const unit = txt(campaign?.contract_length_unit) || 'days';
  return `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
}

/** The figure, as digits, or '' when the campaign has no budget worth printing. */
export function clientAmount(campaign: CampaignLike | null | undefined): string {
  const n = Number(campaign?.budget);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(n);
}

/**
 * The values to prefill a client contract with.
 *
 * EMPTY VALUES ARE LEFT OUT rather than written as ''. The fill screen treats
 * an absent row and a row holding '' the same way, and skipping keeps a
 * half-known client from looking filled in - the same rule 107 wrote down for
 * the vendor side.
 */
export function clientContractValues(input: {
  campaign: CampaignLike | null | undefined;
  client: ClientLike | null | undefined;
  /** YYYY-MM-DD, in the workspace's own day. */
  today: string;
}): Record<string, string> {
  const { campaign, client } = input;
  const amount = clientAmount(campaign);
  const out: Record<string, string> = {
    CL_NAME: txt(client?.company_name),
    CL_CR: txt(client?.cr_number),
    CL_VAT: txt(client?.vat_number),
    CL_REP: txt(client?.signatory_name),
    CL_SIGNATORY: txt(client?.signatory_name),
    CL_ADDR: clientAddress(client),
    CL_AMOUNT: amount,
    // Both, from ONE number. The contract prints the figure and the words side
    // by side, and the one way they come to disagree is two people typing them.
    CL_AMOUNT_WORDS: amount ? amountInWords(amount) : '',
    CL_DURATION: clientDuration(campaign),
    C_DATE: txt(input.today),
    C_DAY: txt(input.today) ? arabicWeekday(txt(input.today)) : '',
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

/**
 * The outputs table: who is booked, where, and how many ads.
 *
 * Keyed to the template's own column keys. A booking with no vendor is left
 * out - a row naming nobody is a row somebody has to ask about - and the ad
 * count prints only when it is a real count, so an empty cell means "not
 * agreed yet" rather than "zero ads".
 */
export function clientOutputRows(rows: OutputRow[] | null | undefined): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const r of rows ?? []) {
    const name = txt(r?.vendorName);
    if (!name) continue;
    out.push({
      CLT_INF: name,
      CLT_PLAT: rowPlatform(r),
      CLT_ACC: txt(r?.handle),
      CLT_QTY: rowAds(r),
    });
  }
  return out;
}

/**
 * What the contract is called in the register.
 *
 * The client and the brand, because that is how somebody looks for it. Never
 * empty: a contract with no title cannot be found, and "(untitled)" at least
 * says so out loud.
 */
export function clientContractTitle(
  campaign: CampaignLike | null | undefined,
  client: ClientLike | null | undefined,
): string {
  const parts = [txt(client?.company_name), txt(campaign?.brand_name)].filter(Boolean);
  return parts.length ? parts.join(' - ') : '(untitled client contract)';
}
