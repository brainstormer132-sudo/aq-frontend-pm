/**
 * The signed copy somebody OUTSIDE this company sent back, and the decision
 * on it.
 *
 * Siraj: "add to the signiture a reject and accept based if a vendor or
 * client uploaded a contract signed and if rejected states why".
 *
 * -- WHY THIS IS NOT lib/legal-signed.ts ----------------------------
 *
 * legal-signed is a STAFF upload: somebody here has the signed paper in
 * their hand, scans it, and files it. There is nothing to review, because
 * the person filing it is the person who would review it. Migration 117 is
 * built on exactly that - the contract is `signed` the moment the file
 * lands.
 *
 * This is the other direction. A vendor or a client signs at their end and
 * sends it back through the portal, and NOBODY HERE HAS SEEN IT. It might be
 * the wrong contract, an unsigned copy of the same PDF, a photograph of a
 * desk, or page 1 of 4. So it does not become the signed contract on
 * arrival: it waits, somebody looks at it, and it is accepted or rejected
 * with a reason the sender can read.
 *
 * The reason is the whole point of the rejection. "Rejected" on its own
 * sends somebody back to the beginning with no idea what to change, and they
 * upload the same file again.
 *
 * -- ONE LIVE UPLOAD PER CONTRACT -----------------------------------
 *
 * Enforced in the database (084's partial unique index, and 124's for the
 * legal-side table): at most one upload per contract in `pending` or
 * `accepted`. Rejected attempts are KEPT - they are the record of what was
 * sent and why it came back - and a corrected upload is allowed because a
 * rejected row is not live.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

/** What a decision can be. `pending` is the queue. */
export type ReviewStatus = 'pending' | 'accepted' | 'rejected';

/** Who sent it. Never 'staff': a staff upload is filed, not reviewed. */
export type UploaderRole = 'vendor' | 'client';

export interface ReviewUpload {
  id: string;
  /** The contract this is a signed copy OF. Text on the contract-app side
   *  (generated_contracts.contract_id), a uuid on the legal side. */
  contract_id?: string | null;
  status?: string | null;
  uploader_role?: string | null;
  /** Filled in by the screen from external_users when it can. Frequently
   *  absent - the row only stores an auth user id. */
  uploader_email?: string | null;
  original_filename?: string | null;
  byte_size?: number | null;
  rejection_reason?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
  /** Whatever the register knows this contract as. Absent when the upload
   *  points at something no longer on file. */
  contract_title?: string | null;
}

/**
 * The status, narrowed and defaulted.
 *
 * An unrecognised value reads as `pending`, NOT as accepted. A row this code
 * does not understand is a row nobody has decided on, and putting it in the
 * queue makes a person look at it. Defaulting the other way would quietly
 * treat it as done.
 */
export function reviewState(u: ReviewUpload): ReviewStatus {
  const s = String(u?.status ?? '').trim().toLowerCase();
  if (s === 'accepted') return 'accepted';
  if (s === 'rejected') return 'rejected';
  return 'pending';
}

export function reviewLabel(s: ReviewStatus): string {
  if (s === 'accepted') return 'Accepted';
  if (s === 'rejected') return 'Rejected';
  return 'Needs a look';
}

export function reviewBadge(s: ReviewStatus): string {
  if (s === 'accepted') return 'aq-badge-success';
  if (s === 'rejected') return 'aq-badge-error';
  return 'aq-badge-warning';
}

/** 'the vendor' / 'the client', for a sentence. Unknown roles say so rather
 *  than guessing, because which of the two sent it changes who to chase. */
export function uploaderLabel(role: unknown): string {
  const r = String(role ?? '').trim().toLowerCase();
  if (r === 'vendor') return 'the vendor';
  if (r === 'client') return 'the client';
  return 'someone outside';
}

/**
 * Why this upload cannot be accepted, or null when it can.
 *
 * The sentence rather than a boolean, so a disabled button says why - the
 * same shape cannotFileSigned uses, for the same reason.
 *
 * Every one of these is also refused by the database. This exists so the
 * screen does not offer something that is about to be rejected.
 */
export function cannotAccept(u: ReviewUpload): string | null {
  const s = reviewState(u);
  if (s === 'accepted') return 'This one is already accepted.';
  if (s === 'rejected') {
    return 'This was rejected, so it cannot be accepted now -'
      + ' ' + uploaderLabel(u.uploader_role) + ' has to send a corrected copy.';
  }
  return null;
}

/**
 * Why this upload cannot be rejected, or null when it can.
 *
 * An ACCEPTED upload CAN be rejected, which is a deliberate difference from
 * the contract app's version of this (084 refuses it).
 *
 * There, accepting changed nothing outside its own row. Here, accepting is
 * what marks the contract signed - so "we accepted the wrong scan" is a state
 * that has to have a way out, and the way out has to carry a reason, because
 * somebody outside is about to be asked to send another one. Migration 124
 * unfiles the copy from the contract when that happens, which puts it back to
 * `issued`; that is the same move 117 already calls the only honest thing to
 * do when the wrong file went up.
 */
export function cannotReject(u: ReviewUpload): string | null {
  if (reviewState(u) === 'rejected') return 'This one is already rejected.';
  return null;
}

/** The floor on a rejection reason. "no" and "bad" are not reasons; they
 *  send somebody back to the start with nothing to change. */
export const REASON_MIN = 10;
/** The uploader reads this in a table cell. Past this it is a letter. */
export const REASON_MAX = 500;

/**
 * What people actually mean when they reject one, as one tap.
 *
 * The floor above is only painless because these exist. Without them it is a
 * rule that makes somebody type a sentence they have typed forty times; with
 * them, the common case is a click and the floor only ever bites on a reason
 * nobody has a word for.
 */
export const REJECT_REASONS = [
  'The scan is unreadable - please send a clearer copy.',
  'It is not signed on every page.',
  'The signature is missing.',
  'This is the wrong contract.',
  'This is not the final version.',
  'Some pages are missing.',
];

/** Why this reason will not do, or null when it will. */
export function reasonError(reason: unknown): string | null {
  const r = String(reason ?? '').trim();
  if (!r) return 'Say why, so they know what to fix.';
  if (r.length < REASON_MIN) {
    return `Give them a little more to go on - ${REASON_MIN} characters at least.`;
  }
  if (r.length > REASON_MAX) {
    return `That is ${r.length} characters. Keep it under ${REASON_MAX}.`;
  }
  return null;
}

/** The reason as it should be stored: trimmed, inner runs of whitespace
 *  collapsed, so a pasted reason does not arrive with a paragraph of blank
 *  lines in the middle of a table cell. */
export function normaliseReason(reason: unknown): string {
  return String(reason ?? '').replace(/\s+/g, ' ').trim();
}

/** Bytes as somebody would say them. Same shape as legal-signed's, kept here
 *  so this file has no dependency on it. */
export function humanBytes(n: number): string {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * The line under the title: who sent it, when, and what.
 *
 * Dates arrive already formatted - this file has no locale and no clock.
 */
export function reviewNote(u: ReviewUpload, fmt: { sent?: string; decided?: string }): string {
  const parts: string[] = [];
  const who = uploaderLabel(u.uploader_role);
  parts.push(fmt.sent ? `Sent by ${who} on ${fmt.sent}` : `Sent by ${who}`);

  const email = String(u.uploader_email ?? '').trim();
  if (email) parts.push(email);

  const name = String(u.original_filename ?? '').trim();
  const size = Number(u.byte_size ?? 0);
  if (name) parts.push(size ? `${name} (${humanBytes(size)})` : name);
  else if (size) parts.push(humanBytes(size));

  if (fmt.decided) parts.push(`decided ${fmt.decided}`);
  return parts.join(' \u00b7 ');
}

/** The counts. `pending` is the working number: the queue. */
export interface ReviewTally {
  pending: number;
  accepted: number;
  rejected: number;
}

export function reviewTally(uploads: ReviewUpload[]): ReviewTally {
  const t: ReviewTally = { pending: 0, accepted: 0, rejected: 0 };
  for (const u of uploads ?? []) t[reviewState(u)] += 1;
  return t;
}

/** Just the queue, oldest first - the one that has been waiting longest is
 *  the one to look at. Same reasoning as awaitingSignature. */
export function pendingReview<T extends ReviewUpload>(uploads: T[]): T[] {
  return (uploads ?? [])
    .filter((u) => reviewState(u) === 'pending')
    .slice()
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      || String(a.id).localeCompare(String(b.id)));
}

/** Everything already decided, newest first - this is history, and history
 *  is read from the top. */
export function decidedReview<T extends ReviewUpload>(uploads: T[]): T[] {
  return (uploads ?? [])
    .filter((u) => reviewState(u) !== 'pending')
    .slice()
    .sort((a, b) => String(b.reviewed_at ?? b.created_at ?? '')
      .localeCompare(String(a.reviewed_at ?? a.created_at ?? ''))
      || String(a.id).localeCompare(String(b.id)));
}

/**
 * Search, over everything a person would type: the contract's name, its
 * reference, the sender's email, the file name, and the rejection reason -
 * because "which ones did we send back for a blurry scan" is a real question
 * and the reason is where that word is.
 */
export function filterReview<T extends ReviewUpload>(uploads: T[], q: string): T[] {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return (uploads ?? []).slice();
  return (uploads ?? []).filter((u) => [
    u.contract_title, u.contract_id, u.uploader_email,
    u.original_filename, u.rejection_reason,
  ].some((v) => String(v ?? '').toLowerCase().includes(needle)));
}

/**
 * What the queue heading says.
 *
 * Group before you cap: a number, and who it is waiting on, rather than a
 * list the reader has to count. When both sides have sent something the split
 * is worth saying, because chasing a vendor and chasing a client are two
 * different conversations.
 */
export function queueSummary(uploads: ReviewUpload[]): string {
  const q = pendingReview(uploads);
  if (!q.length) return 'Nothing is waiting to be looked at.';
  let vendor = 0;
  let client = 0;
  for (const u of q) {
    const r = String(u.uploader_role ?? '').trim().toLowerCase();
    if (r === 'vendor') vendor += 1;
    else if (r === 'client') client += 1;
  }
  const head = q.length === 1 ? '1 signed copy is waiting' : `${q.length} signed copies are waiting`;
  const sides: string[] = [];
  if (vendor) sides.push(`${vendor} from vendors`);
  if (client) sides.push(`${client} from clients`);
  return sides.length > 1 ? `${head} - ${sides.join(', ')}.` : `${head}.`;
}
