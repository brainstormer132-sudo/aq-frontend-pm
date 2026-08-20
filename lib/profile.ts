/**
 * Your own profile: the name colleagues see, the face beside it, and what
 * you do here.
 *
 * All of it is checked before it is saved, and all of it is checked here —
 * pure, no React, no Supabase — because "why did my name not save" is a
 * question nobody should have to ask twice.
 *
 * The rules are about what people READ, not what a column will accept.
 * `full_name` is `text not null default ''`, so the database is perfectly
 * happy with a single space; every screen then shows a nameless gap where a
 * colleague should be.
 */

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;      // matches the bucket
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * What is wrong with a display name. Empty array means it can be saved.
 *
 * An email address is refused on purpose. Several people ended up shown to
 * their colleagues as `someone@aqcreativity.com`, because signup fell back
 * to the address when no name was given and every view rendered it
 * faithfully. An address is not a name.
 */
export function nameProblems(name: string): string[] {
  const n = txt(name);
  const out: string[] = [];
  if (!n) out.push('Your name cannot be blank.');
  else if (n.length < 2) out.push('That is too short to be a name.');
  else if (n.length > 80) out.push('Keep it under 80 characters.');
  else if (EMAILISH.test(n)) out.push('That is an email address, not a name. Type the name people should see.');
  return out;
}

export function jobTitleProblems(title: string): string[] {
  const t = txt(title);
  // Optional. Blank is a legitimate answer and clears the field.
  if (t.length > 60) return ['Keep the job title under 60 characters.'];
  return [];
}

export interface PickedFile {
  name: string;
  type: string;
  size: number;
}

/**
 * Whether this file can be a profile picture.
 *
 * Checked here as well as in the bucket, because a rejection that arrives
 * from storage reads as "upload failed" with no reason, and a 6MB photo
 * straight off a phone is the normal case, not the exception.
 */
export function avatarProblems(file: PickedFile | null | undefined): string[] {
  if (!file) return ['Pick an image first.'];
  const out: string[] = [];
  if (!AVATAR_TYPES.includes((file.type || '').toLowerCase())) {
    out.push('Pictures only — PNG, JPEG, WEBP or GIF.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    out.push(`That image is ${mb(file.size)}MB. The limit is ${mb(MAX_AVATAR_BYTES)}MB — most phone photos need shrinking first.`);
  }
  if (file.size === 0) out.push('That file is empty.');
  return out;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '');
}

/**
 * Where the picture goes: `{user_id}/{token}.{ext}`.
 *
 * The user id first, because that is what the storage policy keys on — you
 * can only write inside your own folder. The token makes the name unique so
 * a new picture never has to overwrite the old one in place, which browsers
 * and CDNs happily keep showing from cache.
 *
 * The token is passed in rather than generated here: this file has to stay
 * pure so it can be tested, and a random name is not testable.
 */
export function avatarPath(userId: string, fileName: string, token: string): string {
  const ext = extensionOf(fileName);
  return `${txt(userId)}/${txt(token) || 'avatar'}${ext}`;
}

function extensionOf(fileName: string): string {
  const clean = txt(fileName).toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  const ext = clean.slice(dot).replace(/[^a-z0-9.]/g, '');
  return ext.length <= 6 ? ext : '';
}

/**
 * The storage path inside a public avatar URL, or null.
 *
 * Used to delete the old picture after a new one is uploaded. Returns null
 * for anything that is not one of ours — an avatar_url pointing at some
 * other host is somebody's Gravatar or a link they pasted, and deleting
 * "the old file" would mean deleting a file that is not there.
 */
export function avatarStoragePath(url: string | null | undefined): string | null {
  const u = txt(url);
  const marker = '/storage/v1/object/public/avatars/';
  const at = u.indexOf(marker);
  if (at < 0) return null;
  const path = u.slice(at + marker.length).split('?')[0];
  return path || null;
}

/** What is wrong with a new password. Empty array means it can be set. */
export function passwordProblems(next: string, confirm: string): string[] {
  const out: string[] = [];
  const p = next ?? '';
  // Not trimmed: a space is a legitimate character in a password, and
  // silently stripping one would lock somebody out of their own account.
  if (p.length < 8) out.push('Use at least 8 characters.');
  if (p.length > 72) out.push('Passwords are capped at 72 characters.');
  if (p && p === p.toLowerCase() && p === p.toUpperCase() && !/\d/.test(p)) {
    out.push('Mix in a letter or a number — that is all symbols.');
  }
  if (p !== (confirm ?? '')) out.push('The two passwords do not match.');
  return out;
}

/** True when nothing on the form differs from what is already saved. */
export function profileUnchanged(
  saved: { full_name?: string | null; job_title?: string | null },
  draft: { full_name: string; job_title: string },
): boolean {
  return txt(saved.full_name) === txt(draft.full_name)
    && txt(saved.job_title) === txt(draft.job_title);
}
