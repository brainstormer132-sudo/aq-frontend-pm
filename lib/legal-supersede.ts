/**
 * Correcting a contract that has already gone out.
 *
 * Siraj asked for "an edit after issued". This is the shape that answer took,
 * and the reasoning is worth keeping next to the code.
 *
 * -- WHY NOT AN EDIT ------------------------------------------------
 *
 * An issued contract's values freeze in the database (100_contracts.sql).
 * Three things rest on that: the contract NUMBER, reserved once and never
 * re-used; the SHA-256 FINGERPRINT, which is how anybody proves months later
 * that the copy in their hand is the copy that was issued; and the plain fact
 * that a document somebody signed still says what it said when they signed
 * it. Unlocking the contract so a value can be retyped destroys all three at
 * once and leaves no trace: our copy and the vendor's would disagree, and the
 * fingerprint - the only thing that could have caught it - would have been
 * recomputed to match the new text.
 *
 * -- WHAT A CORRECTION IS -------------------------------------------
 *
 * A NEW contract that records which one it replaces and why. The original
 * keeps its number and its fingerprint, stays issued, stays readable. The
 * correction takes its own number and its own fingerprint. Both say on their
 * face what happened - the correction says what it replaces, the original
 * says it was replaced - so neither can be handed over as the current
 * agreement by mistake.
 *
 * That is how it works on paper, and it is the only version that answers
 * honestly when somebody asks in a year which document was in force in March.
 *
 * -- WHAT IS DERIVED AND WHAT IS STORED -----------------------------
 *
 * Stored: one arrow on the CORRECTION (supersedes_id) and the reason. Set at
 * insert, immutable afterwards - migration 116 enforces both.
 *
 * Derived: everything else, here. Whether a contract has been replaced is not
 * a column, because it is a fact about a DIFFERENT row and would go stale the
 * moment that row moved. The same rule as legal-matters: money-ledger answers
 * what is owed, the matter answers what we are doing about it.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

import { contractStatusLabel } from './legal';

/** A contract as this layer needs it. The register row already has all of it. */
export interface SupersedeContract {
  id: string;
  title?: string | null;
  status?: string | null;
  contract_no?: string | null;
  supersedes_id?: string | null;
  supersede_reason?: string | null;
}

/**
 * A correction counts as LIVE once it has been issued.
 *
 * A correction still in draft has replaced nothing - it is a draft, it has no
 * number, and the original is still the agreement in force. Treating a draft
 * as a replacement would stamp "REPLACED BY" on a live contract because
 * somebody started typing a correction and went to lunch.
 */
export function isLiveCorrection(c: Pick<SupersedeContract, 'status'>): boolean {
  const s = String(c?.status ?? '').toLowerCase();
  return s === 'issued' || s === 'signed';
}

export interface SupersedeLinks {
  /** id of the original -> the correction aimed at it (live or still a draft). */
  correctionOf: Record<string, SupersedeContract>;
  /** id of a correction -> the contract it replaces. */
  replaces: Record<string, SupersedeContract>;
}

/**
 * The arrows in the register, both ways round, in one pass.
 *
 * A void correction is ignored entirely: it was withdrawn, it replaced
 * nothing, and the database frees the slot so another can be started (the
 * partial unique index in 116 excludes void for exactly this reason). If two
 * non-void corrections of the same contract ever appear here - which the
 * index makes unrepresentable - the first wins rather than the last, so the
 * screen is at least stable between renders.
 */
export function supersedeLinks(contracts: SupersedeContract[]): SupersedeLinks {
  const byId: Record<string, SupersedeContract> = {};
  for (const c of contracts ?? []) if (c?.id) byId[c.id] = c;

  const correctionOf: Record<string, SupersedeContract> = {};
  const replaces: Record<string, SupersedeContract> = {};
  for (const c of contracts ?? []) {
    const target = String(c?.supersedes_id ?? '');
    if (!target) continue;
    if (String(c?.status ?? '').toLowerCase() === 'void') continue;
    if (!correctionOf[target]) correctionOf[target] = c;
    if (byId[target]) replaces[c.id] = byId[target];
  }
  return { correctionOf, replaces };
}

export type SupersedeState =
  | 'none'        // an ordinary contract
  | 'correcting'  // a correction of another contract has been started on it
  | 'replaced'    // a correction of it has been issued
  | 'correction'; // it IS a correction of another contract

/**
 * What this contract is, in one word, for the pill and for what the screen
 * offers to do next.
 *
 * `replaced` beats `correction`: a contract that corrected something and was
 * then itself corrected is, to anybody looking at it, out of date - and that
 * is the more urgent thing to say.
 */
export function supersedeState(c: SupersedeContract, links: SupersedeLinks): SupersedeState {
  const mine = links.correctionOf?.[c?.id ?? ''];
  if (mine && isLiveCorrection(mine)) return 'replaced';
  if (mine) return 'correcting';
  if (c?.supersedes_id) return 'correction';
  return 'none';
}

/** The badge colour for that state. The screen holds no colour logic. */
export function supersedeBadge(s: SupersedeState): string {
  return s === 'replaced' ? 'aq-badge-error'
    : s === 'correcting' ? 'aq-badge-warning'
    : s === 'correction' ? 'aq-badge-info'
    : '';
}

/** What the pill says, or '' when there is nothing to say. */
export function supersedeLabel(s: SupersedeState): string {
  return s === 'replaced' ? 'Replaced'
    : s === 'correcting' ? 'Correction in progress'
    : s === 'correction' ? 'Correction'
    : '';
}

/** How a contract is named in a sentence: its number, or its title. */
export function nameOf(c: SupersedeContract | null | undefined): string {
  const no = String(c?.contract_no ?? '').trim();
  if (no) return no;
  const t = String(c?.title ?? '').trim();
  return t || 'a draft';
}

/**
 * The sentence under a contract's heading on screen.
 *
 * On screen the REASON is included, because that is the question anybody
 * opening a replaced contract is about to ask. It does not go on the printed
 * page - see printReplacesLine.
 */
export function supersedeNote(c: SupersedeContract, links: SupersedeLinks): string | null {
  const state = supersedeState(c, links);
  if (state === 'replaced') {
    const by = links.correctionOf[c.id];
    return `Replaced by ${nameOf(by)}${by.supersede_reason ? ` - ${by.supersede_reason}` : ''}`;
  }
  if (state === 'correcting') {
    const by = links.correctionOf[c.id];
    return `A correction of this is in progress (${contractStatusLabel(by.status).toLowerCase()})`
      + `${by.supersede_reason ? ` - ${by.supersede_reason}` : ''}`;
  }
  if (state === 'correction') {
    const of = links.replaces[c.id];
    const what = of ? nameOf(of) : 'an earlier contract';
    return `Corrects ${what}${c.supersede_reason ? ` - ${c.supersede_reason}` : ''}`;
  }
  return null;
}

/**
 * Why this contract cannot be corrected, or null when it can.
 *
 * Returns the sentence the button's tooltip shows, rather than a boolean, so
 * a disabled button can always say why it is disabled. Every one of these is
 * also enforced in the database (116) - this is so the screen does not offer
 * something that is about to be refused.
 */
export function cannotSupersede(c: SupersedeContract, links: SupersedeLinks): string | null {
  const s = String(c?.status ?? '').toLowerCase();
  if (s === 'draft' || s === '') {
    return 'This is still a draft - edit it rather than correcting it.';
  }
  if (s === 'void') {
    return 'This contract was withdrawn, so there is nothing to correct.';
  }
  const mine = links.correctionOf?.[c?.id ?? ''];
  if (mine) {
    return isLiveCorrection(mine)
      ? `This was already replaced by ${nameOf(mine)}. Correct that one instead.`
      : `A correction of this is already open (${nameOf(mine)}). Finish or delete it first.`;
  }
  return null;
}

/**
 * A reason is required, and it has to be a reason.
 *
 * The minimum is not bureaucracy. "fix" tells the next person nothing, and in
 * a year the reason is the ONLY record of why two numbered contracts exist
 * for one agreement. Long enough to be a sentence, short enough to stay on
 * one line of a screen.
 */
export const REASON_MIN = 10;
export const REASON_MAX = 300;

export function validateSupersedeReason(reason: string): string | null {
  const r = String(reason ?? '').trim();
  if (!r) return 'Say what is being corrected.';
  if (r.length < REASON_MIN) return `A few more words - what was wrong? (${r.length}/${REASON_MIN})`;
  if (r.length > REASON_MAX) return `Too long (${r.length}/${REASON_MAX}). The detail belongs in the matter log.`;
  return null;
}

/** What the correction is called before anybody renames it. */
export function correctionTitle(original: string | null | undefined): string {
  const t = String(original ?? '').trim() || 'Contract';
  return /\(corrected\)$/i.test(t) ? t : `${t} (corrected)`;
}

/**
 * The values the correction starts with.
 *
 * Everything the original held EXCEPT its seal and its number. The seal keys
 * belong to the original document and mean nothing on a different one; the
 * `id` field is the contract number the template prints, and the correction
 * reserves its own at issue. Carrying either across would produce a second
 * document claiming to be the first.
 *
 * The optional-clause choice and the table rows DO carry: a correction almost
 * always changes one field, and making somebody re-tick nine clauses to fix a
 * fee is how a correction ends up differing from the original in ways nobody
 * intended.
 */
export const SEAL_KEYS = ['__aq_fingerprint', '__aq_issued_at', 'id'];

export function carriedValues(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values ?? {})) {
    if (SEAL_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * What prints on the CORRECTION's page: the number it replaces, and nothing
 * else.
 *
 * The reason stays on screen. "This replaces AQ-2026-0001 because the fee was
 * wrong" is an internal note, and printing it on a document handed to the
 * other side volunteers an admission nobody asked for. The number is enough:
 * it says which document is dead, and anybody entitled to ask why can ask.
 */
export function printReplacesLine(replaced: SupersedeContract | null | undefined): string | null {
  const name = String(replaced?.contract_no ?? '').trim();
  return name ? `This agreement replaces ${name}.` : null;
}

/**
 * What prints on a REPLACED original if somebody prints it again.
 *
 * Loud on purpose, in the same red as DRAFT. An old copy coming out of the
 * printer looking exactly like the current agreement is the failure this
 * whole design exists to prevent, and the one moment it would happen is when
 * somebody reprints from the register without reading the screen.
 */
export function printReplacedLine(by: SupersedeContract | null | undefined): string | null {
  const name = String(by?.contract_no ?? '').trim();
  return name ? `SUPERSEDED - replaced by ${name}.` : null;
}

/**
 * The chain a contract belongs to, oldest first.
 *
 * Follows the arrows backwards to the original and then forwards through the
 * live corrections. Bounded rather than trusting: migration 116 makes a cycle
 * unconstructible (the arrow is written at insert and never moves, so a row
 * can only point at a row that already existed), but a screen that can hang
 * on bad data is a screen that hangs, and the guard costs one integer.
 */
export function supersedeChain(
  contracts: SupersedeContract[], id: string,
): SupersedeContract[] {
  const byId: Record<string, SupersedeContract> = {};
  for (const c of contracts ?? []) if (c?.id) byId[c.id] = c;
  const links = supersedeLinks(contracts);
  const start = byId[id];
  if (!start) return [];

  const back: SupersedeContract[] = [];
  let cur: SupersedeContract | undefined = start;
  const seen = new Set<string>([start.id]);
  for (let i = 0; i < 64 && cur?.supersedes_id; i += 1) {
    const prev: SupersedeContract | undefined = byId[cur.supersedes_id];
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    back.unshift(prev);
    cur = prev;
  }

  const fwd: SupersedeContract[] = [];
  cur = start;
  for (let i = 0; i < 64; i += 1) {
    const next: SupersedeContract | undefined = links.correctionOf[cur!.id];
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    fwd.push(next);
    cur = next;
  }

  return [...back, start, ...fwd];
}
