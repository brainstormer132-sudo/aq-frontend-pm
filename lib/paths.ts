/**
 * Path helpers — now no-ops.
 *
 * basePath was removed from next.config.js because the folder structure
 * already encodes the URL paths (/dashboard/workflow, /vendor/auth, etc.).
 * Earlier these helpers prefixed /dashboard, which caused the visible
 * /dashboard/dashboard/workflow bug.
 *
 * Kept as pass-throughs so existing callers don't have to change.
 */

export const BASE_PATH = '';

export function withBase(path: string): string {
  return path;
}

export function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (/^https?:\/\//i.test(path)) return path;
  return window.location.origin + path;
}
