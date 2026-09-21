/**
 * Agreements that were never made in this app.
 *
 * Siraj, asked whether legal also needs to file paperwork the app did not
 * generate, chose yes: an office lease, an NDA somebody else drafted, a
 * client MSA signed before any of this existed. Her job is "everything
 * relating to legal", and a register holding only what we typed here is one
 * she cannot trust as complete.
 *
 * -- WHAT IT IS NOT ---------------------------------------------------
 *
 * Not a contract. It has no number, no fingerprint, no template version and
 * no freeze, because none of those mean anything for a document we did not
 * draft - see the header of migration 118 for why it could not share the
 * contract table even if we wanted it to.
 *
 * What it HAS is the file, and that is mandatory. An external agreement with
 * no document attached is a note, and there is a matter log for notes.
 *
 * Pure: no React, no Supabase, no argless `new Date()` - every date comparison
 * takes today as an argument.
 */

import { fileExtension, humanBytes, SIGNED_EXTENSIONS, SIGNED_MAX_BYTES } from './legal-signed';
import { kindLabel, DOC_KINDS } from './legal';

/** Filed beside the signed counterparts (117), under their own prefix. */
export const EXTERNAL_PREFIX = 'external';

export interface ExternalDoc {
  id: string;
  title?: string | null;
  doc_kind?: string | null;
  party_name?: string | null;
  reference?: string | null;
  signed_on?: string | null;
  expires_on?: string | null;
  notes?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  file_bytes?: number | null;
  created_at?: string | null;
}

/**
 * What an outside agreement is allowed to be.
 *
 * Everything a signed contract can be (117 - a PDF or a photograph), PLUS
 * Word. A signed counterpart is a scan of something somebody put a pen to, so
 * a .docx there is a mistake by definition. An outside agreement is often the
 * file the other side emailed, and that is frequently still a Word document -
 * refusing it would send her to find a printer to make a worse copy of
 * something she already has.
 */
export const EXTERNAL_EXTENSIONS = [...SIGNED_EXTENSIONS, 'doc', 'docx'];
export const EXTERNAL_MAX_BYTES = SIGNED_MAX_BYTES;

export function validateExternalFile(file: { name?: string; size?: number }): string | null {
  const name = String(file?.name ?? '').trim();
  if (!name) return 'Pick a file.';
  const ext = fileExtension(name);
  if (!ext) return 'That file has no extension, so there is no telling what it is.';
  if (!EXTERNAL_EXTENSIONS.includes(ext)) {
    return `That is a .${ext}. A filed agreement should be a PDF, a Word file or a photo.`;
  }
  const size = Number(file?.size ?? 0);
  if (!(size > 0)) return 'That file is empty.';
  if (size > EXTERNAL_MAX_BYTES) {
    return `That file is ${humanBytes(size)}; the limit is ${humanBytes(EXTERNAL_MAX_BYTES)}.`;
  }
  return null;
}

/**
 * Everything wrong with the form, or null when it is ready to file.
 *
 * Returns the FIRST problem rather than a list, because the form has one
 * message line and a list of three things to fix that appears all at once is
 * read as a wall and fixed one at a time anyway.
 */
export function validateExternalDoc(d: {
  title?: string | null; doc_kind?: string | null;
  // Nullable as well as optional: the form hands over null for a date box
  // left empty, and a signature that only accepts undefined makes every
  // caller write `?? undefined` at the call site to say the same thing.
  signed_on?: string | null; expires_on?: string | null;
}): string | null {
  if (!String(d?.title ?? '').trim()) return 'Give it a name you would search for.';
  if (!DOC_KINDS.some((k) => k.key === String(d?.doc_kind ?? ''))) return 'Pick what kind of document it is.';
  const signed = String(d?.signed_on ?? '');
  const expires = String(d?.expires_on ?? '');
  // The same rule the database holds (118). Caught here so it is caught while
  // she is still looking at the two boxes rather than after a failed save.
  if (signed && expires && expires < signed) {
    return 'It cannot expire before it was signed - check the two dates.';
  }
  return null;
}

/** Where the file goes. See signedStoragePath in legal-signed; same rules,
 *  same reasons - ASCII only, and a random segment so re-filing never
 *  collides with what it replaces. */
export function externalStoragePath(
  workspaceId: string, docId: string, fileName: string, rand: string,
): string {
  let safe = String(fileName ?? 'document').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 100);
  if (!/[A-Za-z0-9]/.test(safe)) safe = `document.${fileExtension(fileName) || 'pdf'}`;
  const r = String(rand ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'x';
  return `${EXTERNAL_PREFIX}/${workspaceId}/${docId}/${r}-${safe}`;
}

export type ExternalState = 'signed' | 'unsigned' | 'expiring' | 'expired';

/**
 * What state this filing is in, for the pill.
 *
 * EXPIRY BEATS SIGNED, because an expired agreement is the one that needs
 * doing something about and "Signed" on a lease that ran out in March is a
 * green badge on a problem.
 *
 * Unsigned is a real state, not a missing value: a draft the other side sent
 * over is on file and not yet agreed, and that is worth seeing.
 */
export function externalState(d: ExternalDoc, todayStr: string, soonDays = 30): ExternalState {
  const today = String(todayStr ?? '');
  const exp = String(d?.expires_on ?? '');
  if (exp && today) {
    if (exp < today) return 'expired';
    if (soonDays > 0 && exp <= addDays(today, soonDays)) return 'expiring';
  }
  return String(d?.signed_on ?? '').trim() ? 'signed' : 'unsigned';
}

/** ISO date plus n days, in UTC. Pure, and no Date arithmetic surprises
 *  across a daylight-saving boundary because it never leaves UTC. */
export function addDays(iso: string, n: number): string {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t)) return String(iso);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

export function externalBadge(s: ExternalState): string {
  return s === 'expired' ? 'aq-badge-error'
    : s === 'expiring' ? 'aq-badge-warning'
    : s === 'signed' ? 'aq-badge-success'
    : 'aq-badge-muted';
}

export function externalLabel(s: ExternalState): string {
  return s === 'expired' ? 'Expired'
    : s === 'expiring' ? 'Expiring'
    : s === 'signed' ? 'Signed'
    : 'Not signed';
}

/** The line under the title: who it is with, its own reference, its size. */
export function externalNote(d: ExternalDoc): string {
  const bits: string[] = [];
  const party = String(d?.party_name ?? '').trim();
  if (party) bits.push(party);
  bits.push(kindLabel(String(d?.doc_kind ?? '')));
  const ref = String(d?.reference ?? '').trim();
  if (ref) bits.push(ref);
  const name = String(d?.file_name ?? '').trim();
  const size = Number(d?.file_bytes ?? 0);
  if (name) bits.push(size ? `${name} (${humanBytes(size)})` : name);
  return bits.join(' \u00b7 ');
}

/**
 * Narrow the list to what was typed and the kind that was chosen.
 *
 * Searches the KIND AS LABELLED, the same rule as the register and the matter
 * log: typing "influencer" finds what the screen calls influencer, not the
 * key `vendor_contract` that nobody has ever seen.
 */
export function filterExternal<T extends ExternalDoc>(rows: T[], query: string, kind: string): T[] {
  const q = String(query ?? '').trim().toLowerCase();
  const k = String(kind ?? '').trim();
  return (rows ?? []).filter((r) => {
    if (k && String(r?.doc_kind ?? '') !== k) return false;
    if (!q) return true;
    return [
      r?.title ?? '', r?.party_name ?? '', r?.reference ?? '', r?.notes ?? '',
      kindLabel(String(r?.doc_kind ?? '')),
    ].join(' ').toLowerCase().includes(q);
  });
}

/**
 * The order the list reads in: whatever needs attention, then the rest.
 *
 * Expired first, then expiring, then everything else newest first. A filing
 * cabinet sorted purely by date buries the lease that ran out last month
 * under nine things filed since.
 */
export function sortExternal<T extends ExternalDoc>(rows: T[], todayStr: string): T[] {
  const rank = (d: T) => {
    const s = externalState(d, todayStr);
    return s === 'expired' ? 0 : s === 'expiring' ? 1 : 2;
  };
  return (rows ?? []).slice().sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    // Within the two attention groups, the soonest deadline leads.
    if (rank(a) < 2) return String(a.expires_on ?? '').localeCompare(String(b.expires_on ?? ''));
    return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
      || String(a.id).localeCompare(String(b.id));
  });
}

export interface ExternalTally {
  filed: number;
  signed: number;
  expiring: number;
  expired: number;
}

export function externalTally(rows: ExternalDoc[], todayStr: string): ExternalTally {
  const t: ExternalTally = { filed: 0, signed: 0, expiring: 0, expired: 0 };
  for (const d of rows ?? []) {
    t.filed += 1;
    const s = externalState(d, todayStr);
    if (s === 'expired') t.expired += 1;
    else if (s === 'expiring') t.expiring += 1;
    if (String(d?.signed_on ?? '').trim()) t.signed += 1;
  }
  return t;
}
