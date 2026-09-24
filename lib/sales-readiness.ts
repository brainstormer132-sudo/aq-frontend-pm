/**
 * What a campaign needs before marketing is asked to run it.
 *
 * Siraj, asked whether the override code should cover more than the contract
 * rule: *"it should also go for all rules like sales sending to marketing
 * without all info every rule can be bypassed but will be documented"*. This
 * is that rule. Asked where the bar should be, he named THE CLIENT AND BRAND,
 * THE BUDGET, and THE BRIEF IN WORDS - and not the due date, which is often a
 * date nobody has agreed yet.
 *
 * -- TWO LISTS, NOT ONE ---------------------------------------------
 *
 * `campaignBlockers` is what cannot be passed by anybody: the client, the
 * brand, and a findable name. Those are not judgement calls that a manager
 * might reasonably overrule - they are the foreign keys everything
 * downstream hangs off. A campaign with no client_id is not "a campaign with
 * a gap"; it is a row that cannot appear on a client's page, cannot be
 * invoiced, and cannot be found again. The new-campaign form has always
 * required them, and this keeps that true for any other caller.
 *
 * `campaignBriefNeeds` is the passable rule: the budget and the brief. Both
 * are things a person can have a real reason to skip, and stopping somebody
 * dead over either is how a campaign ends up being sent by WhatsApp instead -
 * which lib/new-task wrote down as the reason NOT to require them at all.
 *
 * That reasoning was right when a refusal was the only option. It is not a
 * refusal any more: passing this leaves the campaign in marketing's hands
 * with the gap visible and the person's name and reason in the log. The
 * override is what makes a bar affordable.
 *
 * -- WHY A DECK COUNTS AS A BRIEF -----------------------------------
 *
 * Sales attach the client's own deck. Making them retype it into the box to
 * satisfy a word count would be the rule producing worse information than it
 * found - a paraphrase instead of the source. So one or more attached brief
 * files answers the brief, and the words are only needed when there is
 * nothing attached.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

import type { Missing } from './vendor-contracts';

/**
 * How many words make a brief.
 *
 * Six. It is a floor against "asap", "see deal" and "as discussed", not an
 * essay requirement: "One reel and two stories, Ramadan, live mid-March" is
 * nine and passes. Counted in WORDS rather than characters because a
 * character floor is met by holding a key down, and because the form already
 * reads a brief back to the person as a word count.
 */
export const BRIEF_MIN_WORDS = 6;

export interface CampaignInput {
  /** FK to public.clients. */
  client_id?: unknown;
  /** FK to public.client_brands. */
  brand_id?: unknown;
  /** What the campaign is called. */
  task_name?: unknown;
  budget?: unknown;
  /** The brief, typed. */
  details?: unknown;
  /** How many brief files are going up with it. A deck IS a brief. */
  briefFiles?: unknown;
}

const txt = (v: unknown): string => String(v ?? '').trim();

/** The words in a brief. Whitespace of any kind separates them. */
export function briefWordCount(details: unknown): number {
  const s = txt(details);
  return s ? s.split(/\s+/).filter(Boolean).length : 0;
}

/** A budget that is a real figure. Null, empty, zero and negative are not. */
export function budgetGiven(budget: unknown): boolean {
  if (budget == null || txt(budget) === '') return false;
  const n = Number(budget);
  return Number.isFinite(n) && n > 0;
}

/** Whether the brief is answered, by words or by an attachment. */
export function briefGiven(input: CampaignInput): boolean {
  const files = Number(input?.briefFiles ?? 0);
  if (Number.isFinite(files) && files > 0) return true;
  return briefWordCount(input?.details) >= BRIEF_MIN_WORDS;
}

/**
 * What NOBODY can send a campaign without. Never passable.
 *
 * Kept separate from the rule below so that the override cannot reach these.
 * The same shape as `sendVendorContractRequest`, where a booking with no
 * vendor is its own refusal ahead of the readiness check: there is nothing to
 * take responsibility FOR, so there is nothing for a reason and a code to buy.
 */
export function campaignBlockers(input: CampaignInput | null | undefined): Missing[] {
  const out: Missing[] = [];
  if (!input) return [{ label: 'A campaign', where: '' }];
  if (!txt(input.client_id)) out.push({ label: 'The client', where: 'the Client step' });
  if (!txt(input.brand_id)) out.push({ label: 'The brand', where: 'the Client step' });
  const name = txt(input.task_name);
  if (!name) out.push({ label: 'A name for the campaign', where: 'the Data step' });
  else if (name.length < 3) {
    out.push({ label: 'A name long enough to find later', where: 'the Data step' });
  }
  return out;
}

/**
 * The gaps the rule stops on, and that the code can open.
 *
 * Empty means marketing is being handed everything it was promised.
 */
export function campaignBriefNeeds(input: CampaignInput | null | undefined): Missing[] {
  const out: Missing[] = [];
  if (!input) return out;
  if (!budgetGiven(input.budget)) {
    out.push({ label: 'The budget', where: 'the Data step' });
  }
  if (!briefGiven(input)) {
    out.push({
      label: briefWordCount(input.details) > 0
        // Said differently when there IS a brief, because "The brief" over a
        // box somebody has already typed in reads as though it was not saved.
        ? `A brief of at least ${BRIEF_MIN_WORDS} words, or the deck attached`
        : 'The brief, in words or as a file',
      where: 'the Brief step',
    });
  }
  return out;
}

/** Nothing in the way and nothing to pass. */
export function campaignReadyForMarketing(input: CampaignInput | null | undefined): boolean {
  return campaignBlockers(input).length === 0 && campaignBriefNeeds(input).length === 0;
}

/**
 * The gaps as one line, for a refusal message or the gate's headline.
 *
 * Deliberately lists them all rather than the first. Somebody who fixes the
 * budget, presses the button and is then told about the brief has been made
 * to do the form twice - and the second refusal reads as the app moving the
 * goalposts.
 */
export function campaignGapLine(missing: Missing[]): string {
  const bits = (missing ?? []).map((m) => m.label).filter(Boolean);
  if (!bits.length) return '';
  if (bits.length === 1) return bits[0];
  return `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}`;
}

/**
 * What the person reads when the rule stops them, in their own terms.
 *
 * The campaign's own name leads, because a sales person submitting three in a
 * row needs to know WHICH one this is about.
 */
export function campaignBlockedLine(
  input: CampaignInput | null | undefined,
  missing: Missing[],
): string {
  const gaps = campaignGapLine(missing);
  if (!gaps) return '';
  const name = txt(input?.task_name);
  const what = name ? `"${name}"` : 'This campaign';
  return `${what} is missing ${gaps}, so marketing would be triaging it blind.`;
}
