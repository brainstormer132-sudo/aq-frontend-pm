/**
 * The signed copy that comes back on paper.
 *
 * Siraj: "add an upload signed contract to each task in case its external and
 * not within the app."
 *
 * Nothing here signs anything. A contract is issued, printed, handed over,
 * and it comes back as a scan or a photo taken on a phone. Uploading that IS
 * the act of signing as far as this app is concerned, because the file is the
 * evidence and a status with nothing behind it is a checkbox somebody ticked.
 *
 * Migration 117 holds the invariant: a contract is `signed` IF AND ONLY IF it
 * has a signed file. Both directions. Removing the file puts it back to
 * issued, which is not a loophole - it is the only honest thing to do when
 * the wrong file went up.
 *
 * SIGNING DOES NOT UNFREEZE ANYTHING. The values froze at issue, the
 * fingerprint still covers what was issued, the number is unchanged. A signed
 * contract is an issued contract with its counterpart attached. If the
 * content is wrong that is a correction (116) - and a correction can be
 * signed in its turn.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

/** Where the counterparts live. Private bucket; reads go through a signed URL. */
export const SIGNED_BUCKET = 'legal-signed';

export interface SignedContract {
  id: string;
  status?: string | null;
  contract_no?: string | null;
  signed_path?: string | null;
  signed_name?: string | null;
  signed_bytes?: number | null;
  signed_on?: string | null;
  signed_recorded_at?: string | null;
}

/** True when the counterpart is on file. The status follows the file (117). */
export function hasSignedCopy(c: SignedContract): boolean {
  return !!String(c?.signed_path ?? '').trim();
}

/**
 * Why the signed copy cannot be filed against this contract, or null when it
 * can. The sentence, not a boolean, so a disabled button can say why.
 *
 * Every one of these is also refused by the database (117). This exists so
 * the screen does not offer something that is about to be rejected.
 */
export function cannotFileSigned(c: SignedContract): string | null {
  const s = String(c?.status ?? '').toLowerCase();
  if (s === 'signed') return 'The signed copy is already on file.';
  if (s === 'draft' || s === '') {
    return 'This is still a draft - issue it first, then file what comes back.';
  }
  if (s === 'void') return 'This contract was withdrawn, so there is nothing to sign.';
  if (!String(c?.contract_no ?? '').trim()) {
    return 'This contract has no number, so it was never properly issued.';
  }
  return null;
}

/**
 * What a scan of a signed contract can be.
 *
 * A PDF, or a photograph - because what actually happens is somebody signs
 * the paper and takes a picture of it on their phone, and a system that only
 * accepts PDFs makes that person find a scanner or give up. HEIC is on the
 * list for the same reason: it is what an iPhone produces by default.
 *
 * Nothing executable, nothing that is a document only by its extension. The
 * check is on the extension rather than the browser's MIME guess, because the
 * guess is empty often enough on mobile to be useless as a gate.
 */
export const SIGNED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'tif', 'tiff'];

/** 25 MB. A phone photo of four pages is about 12; a flatbed scan of twenty
 *  at 300dpi is about 20. Past this something is wrong - usually somebody
 *  attached a video by mistake. */
export const SIGNED_MAX_BYTES = 25 * 1024 * 1024;

export function fileExtension(name: string): string {
  const n = String(name ?? '');
  const i = n.lastIndexOf('.');
  return i > 0 ? n.slice(i + 1).toLowerCase() : '';
}

export function validateSignedFile(file: { name?: string; size?: number }): string | null {
  const name = String(file?.name ?? '').trim();
  if (!name) return 'Pick a file.';
  const ext = fileExtension(name);
  if (!ext) return 'That file has no extension, so there is no telling what it is.';
  if (!SIGNED_EXTENSIONS.includes(ext)) {
    return `A signed copy should be a PDF or a photo (${SIGNED_EXTENSIONS.join(', ')}) - this is .${ext}.`;
  }
  const size = Number(file?.size ?? 0);
  if (!(size > 0)) return 'That file is empty.';
  if (size > SIGNED_MAX_BYTES) {
    return `That file is ${humanBytes(size)}. The limit is ${humanBytes(SIGNED_MAX_BYTES)} -`
      + ' a scan that big is usually a video by mistake.';
  }
  return null;
}

/** Bytes as somebody would say them. */
export function humanBytes(n: number): string {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * Where the file goes in the bucket.
 *
 * Keyed by workspace and contract so a listing is navigable by hand in
 * Supabase Studio when something has gone wrong, and carrying a random
 * segment so re-filing after a mistake never collides with what it replaces.
 *
 * The name is stripped to ASCII: storage keys reject Arabic outright, and the
 * real name is kept in signed_name so the download is called what she sent.
 * `rand` is passed in rather than generated, so this stays pure and testable.
 */
export function signedStoragePath(
  workspaceId: string, contractId: string, fileName: string, rand: string,
): string {
  let safe = String(fileName ?? 'signed').replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 100);
  if (!/[A-Za-z0-9]/.test(safe)) safe = `signed.${fileExtension(fileName) || 'pdf'}`;
  const r = String(rand ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || 'x';
  return `${workspaceId}/${contractId}/${r}-${safe}`;
}

/**
 * What the screen says about the copy on file.
 *
 * Names the date ON THE DOCUMENT when there is one, because that is the date
 * that matters in a dispute and is frequently not the day it was scanned.
 * Dates are passed in already formatted - this file has no locale and no
 * clock.
 */
export function signedNote(
  c: SignedContract, fmt: { on?: string; recorded?: string },
): string | null {
  if (!hasSignedCopy(c)) return null;
  const parts: string[] = [];
  if (fmt.on) parts.push(`Signed ${fmt.on}`);
  if (fmt.recorded) parts.push(parts.length ? `filed ${fmt.recorded}` : `Filed ${fmt.recorded}`);
  const size = Number(c.signed_bytes ?? 0);
  const name = String(c.signed_name ?? '').trim();
  const file = name ? `${name}${size ? ` (${humanBytes(size)})` : ''}` : '';
  if (!parts.length) return file || 'On file';
  return file ? `${parts.join(', ')} - ${file}` : parts.join(', ');
}

/**
 * The signed-contracts checklist, as counts.
 *
 * `awaiting` is the working number: contracts that went out and have not come
 * back. It is what the job actually is - "issued" on its own says how much
 * was sent, not how much is outstanding.
 *
 * A VOID contract is in none of these. It was withdrawn; nobody is waiting
 * for it, and counting it as outstanding would put a permanent number on the
 * checklist that no amount of chasing can clear.
 */
export interface SignedTally {
  issued: number;
  signed: number;
  awaiting: number;
}

export function signedTally(contracts: SignedContract[]): SignedTally {
  let issued = 0;
  let signed = 0;
  for (const c of contracts ?? []) {
    const s = String(c?.status ?? '').toLowerCase();
    if (s === 'signed') { signed += 1; issued += 1; continue; }
    if (s === 'issued') issued += 1;
  }
  return { issued, signed, awaiting: Math.max(0, issued - signed) };
}

/**
 * The checklist itself: what went out and has not come back, oldest first.
 *
 * Oldest first because the oldest one outstanding is the one to chase. A
 * register sorted newest-first - which is how it is read everywhere else -
 * puts the thing that needs doing at the bottom of the page.
 */
export function awaitingSignature<T extends SignedContract & { created_at?: string | null }>(
  contracts: T[],
): T[] {
  return (contracts ?? [])
    .filter((c) => String(c?.status ?? '').toLowerCase() === 'issued')
    .slice()
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
      || String(a.id).localeCompare(String(b.id)));
}
