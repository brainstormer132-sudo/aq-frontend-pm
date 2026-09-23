/**
 * One register, with everything in it.
 *
 * Siraj, looking at the review screen: *"you cant check the contract /
 * contract details and id rather it be in the register rather than its own
 * place"*.
 *
 * -- WHY THIS IS THE RIGHT SHAPE ------------------------------------
 *
 * Migration 118 said it first, in the sentence that created
 * legal.external_doc: "an agreement this app did not generate - filed SO THE
 * REGISTER IS COMPLETE." It was then built onto the Signatures screen, so the
 * register was never complete and the documents lived somewhere else.
 *
 * That is also why the review could not work. Deciding whether a signed copy
 * is good means looking at the contract it is a copy OF - and the contract
 * was on a different screen, in a different list, with none of its details in
 * reach. A decision screen that cannot show you the thing you are deciding
 * about is a screen that collects clicks.
 *
 * So: one list. Contracts this app generated, and documents filed from
 * outside, in one place, with the review sitting on the row it belongs to.
 *
 * -- THE ONE THING THAT MUST NOT MERGE ------------------------------
 *
 * BULK PRINT. A generated contract is printed by rebuilding it from its
 * template version's blocks (lib/legal-bulk); a filed document is a PDF or a
 * photograph somebody else made, and there is nothing to rebuild. So a filed
 * row is not selectable, and `printableOnly` is the guarantee that a
 * selection can never contain one - including after "Select all", which is
 * where it would otherwise happen silently and come out as a blank page in
 * the middle of a stack of forty.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

import type { ReviewStatus } from './legal-review';
import { reviewState } from './legal-review';

/** Where a row came from. */
export type RegisterSource = 'generated' | 'filed';

export interface RegisterRow {
  id: string;
  source: RegisterSource;
  title: string;
  /** The contract number, or the source system's own reference. */
  reference: string;
  /** The other side, when the row knows it. */
  party: string;
  /** doc_kind - 'vendor_contract', 'nda', and so on. */
  kind: string;
  /** For a generated contract: draft / issued / signed / void. Empty for a
   *  filed one, which has no lifecycle here - it arrived finished. */
  status: string;
  created_at: string;
  /** Whether a signed copy sent back from outside is waiting, accepted or
   *  rejected. Null when nobody has ever uploaded one against this row. */
  review: ReviewStatus | null;
  /** The upload to act on, when there is one. */
  uploadId: string | null;
  /** That upload's own row - the screen needs its storage path and filename
   *  to open the scan, and looking it up a second time from the id would mean
   *  the row and the file could disagree about which upload is live. */
  upload: any | null;
  /** True only when a filed row has a signed copy nobody has decided on. */
  needsReview: boolean;
  /** The row this was built from, for the screen to open. */
  row: any;
}

const txt = (v: unknown): string => String(v ?? '').trim();

/**
 * The register.
 *
 * `uploads` are matched to filed documents BY REFERENCE, because that is the
 * only key the two systems share: contract_signatures.contract_id is
 * generated_contracts.contract_id, and migration 123 filed those documents
 * under exactly that value in external_doc.reference. A row with no reference
 * can never be matched, which is correct - there would be nothing to match on
 * and guessing by title would attach a decision to the wrong document.
 */
export function registerRows(
  contracts: any[],
  docs: any[],
  uploads: { id?: string; contract_id?: string | null; status?: string | null }[] = [],
): RegisterRow[] {
  // The LIVE upload per reference. A rejected attempt is history: 084 allows
  // a corrected re-upload after one, so a reference can carry several rejected
  // rows and at most one pending-or-accepted. Showing the newest regardless
  // would make a re-uploaded document read as "rejected" forever.
  const live = new Map<string, { id: string; state: ReviewStatus; row: any }>();
  const anyOne = new Map<string, { id: string; state: ReviewStatus; row: any }>();
  for (const u of uploads ?? []) {
    const key = txt(u?.contract_id);
    if (!key) continue;
    const state = reviewState(u as any);
    const entry = { id: txt(u?.id), state, row: u };
    if (state !== 'rejected') live.set(key, entry);
    if (!anyOne.has(key)) anyOne.set(key, entry);
  }

  const out: RegisterRow[] = [];

  for (const c of contracts ?? []) {
    out.push({
      id: txt(c?.id),
      source: 'generated',
      title: txt(c?.title) || '(untitled)',
      reference: txt(c?.contract_no),
      party: '',
      kind: txt(c?.doc_kind),
      status: txt(c?.status),
      created_at: txt(c?.created_at),
      review: null,
      uploadId: null,
      upload: null,
      needsReview: false,
      row: c,
    });
  }

  for (const d of docs ?? []) {
    const ref = txt(d?.reference);
    const hit = ref ? (live.get(ref) ?? anyOne.get(ref)) : undefined;
    const state = hit?.state ?? null;
    out.push({
      id: txt(d?.id),
      source: 'filed',
      title: txt(d?.title) || '(untitled)',
      reference: ref,
      party: txt(d?.party_name),
      kind: txt(d?.doc_kind),
      status: '',
      created_at: txt(d?.created_at),
      review: state,
      uploadId: hit?.id ?? null,
      upload: hit?.row ?? null,
      needsReview: state === 'pending',
      row: d,
    });
  }

  return out;
}

/**
 * Only the rows that can be printed as a stack.
 *
 * The guarantee the bulk-print button rests on. A filed document is somebody
 * else's PDF; there is no template version to rebuild it from, and putting one
 * in the selection produces a blank page in the middle of a stack of forty
 * that nobody notices until it is handed to somebody.
 */
export function printableOnly(rows: RegisterRow[]): RegisterRow[] {
  return (rows ?? []).filter((r) => r.source === 'generated');
}

/** The ids of everything printable, for Select all. */
export function printableIds(rows: RegisterRow[]): string[] {
  return printableOnly(rows).map((r) => r.id);
}

export interface RegisterTally {
  total: number;
  generated: number;
  filed: number;
  /** The working number: signed copies sent back that nobody has decided on. */
  awaitingReview: number;
}

export function registerTally(rows: RegisterRow[]): RegisterTally {
  const t: RegisterTally = { total: 0, generated: 0, filed: 0, awaitingReview: 0 };
  for (const r of rows ?? []) {
    t.total += 1;
    if (r.source === 'generated') t.generated += 1; else t.filed += 1;
    if (r.needsReview) t.awaitingReview += 1;
  }
  return t;
}

/**
 * Newest first. This is a REGISTER, and a register is chronological.
 *
 * Deliberately NOT "things needing attention at the top". A list that
 * reorders itself around today's work is a list you cannot find last April's
 * contract in, and the work is reachable in one click through the filter
 * instead - which leaves the order meaning one thing.
 */
export function sortRegister(rows: RegisterRow[]): RegisterRow[] {
  return (rows ?? []).slice().sort((a, b) =>
    txt(b.created_at).localeCompare(txt(a.created_at))
    || txt(a.id).localeCompare(txt(b.id)));
}

/** What the source filter can be set to. */
export type SourceFilter = '' | 'generated' | 'filed' | 'review';

/**
 * Search, source and status in one pass.
 *
 * `review` is a SOURCE filter value rather than a fourth control, because
 * "show me what is waiting" and "show me the filed ones" are the same kind of
 * question and two dropdowns to answer them is one too many.
 */
export function filterRegister(
  rows: RegisterRow[],
  query: string,
  source: SourceFilter,
  status: string,
): RegisterRow[] {
  const needle = txt(query).toLowerCase();
  const st = txt(status).toLowerCase();
  return (rows ?? []).filter((r) => {
    if (source === 'generated' && r.source !== 'generated') return false;
    if (source === 'filed' && r.source !== 'filed') return false;
    if (source === 'review' && !r.needsReview) return false;
    // A status filter is about a contract's lifecycle, which a filed document
    // does not have - so picking one hides them rather than showing every
    // filed row under every status.
    if (st && r.status.toLowerCase() !== st) return false;
    if (!needle) return true;
    return [r.title, r.reference, r.party, r.kind]
      .some((v) => txt(v).toLowerCase().includes(needle));
  });
}

/** Whether a row can be opened for a decision by this person. Owner, admin
 *  and legal only - the same three migration 127 lets through, so the screen
 *  never offers what the database will refuse. */
export function canReview(role: unknown): boolean {
  const r = txt(role).toLowerCase();
  return r === 'owner' || r === 'admin' || r === 'legal';
}

/** Why this row cannot be reviewed, or null when it can. The sentence, so a
 *  disabled control says why. */
export function cannotReviewHere(row: RegisterRow, role: unknown): string | null {
  if (row.source !== 'filed') {
    return 'This contract was generated here, so there is no uploaded copy to review.';
  }
  if (!row.uploadId) return 'Nobody has sent a signed copy back for this one.';
  if (!canReview(role)) {
    return 'Only legal, an admin or an owner can accept or reject a signed copy.';
  }
  return null;
}

/**
 * The line under the title.
 *
 * Dates arrive already formatted - this file has no locale and no clock.
 */
export function registerNote(r: RegisterRow, fmt: { created?: string }): string {
  const parts: string[] = [];
  if (r.reference) parts.push(r.reference);
  if (r.source === 'filed') {
    parts.push('filed from outside');
    if (r.party) parts.push(r.party);
  }
  if (fmt.created) parts.push(fmt.created);
  return parts.join(' \u00b7 ');
}

/**
 * The heading. Says what is in the register and what is waiting, in one line,
 * so the screen has said something before anybody scrolls.
 */
export function registerSummary(rows: RegisterRow[]): string {
  const t = registerTally(rows);
  if (!t.total) return 'Nothing in the register yet.';
  const bits: string[] = [];
  bits.push(t.generated === 1 ? '1 contract generated here' : `${t.generated} contracts generated here`);
  if (t.filed) bits.push(t.filed === 1 ? '1 filed from outside' : `${t.filed} filed from outside`);
  const head = bits.join(', ');
  if (!t.awaitingReview) return `${head}.`;
  return `${head}. ${t.awaitingReview === 1
    ? '1 signed copy is waiting to be looked at'
    : `${t.awaitingReview} signed copies are waiting to be looked at`}.`;
}
