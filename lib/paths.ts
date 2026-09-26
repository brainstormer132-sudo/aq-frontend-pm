/**
 * One path helper.
 *
 * There used to be three. basePath was removed from next.config.js - the
 * folder structure already encodes the URL paths (/dashboard/workflow,
 * /vendor/auth) and prefixing them again produced the visible
 * /dashboard/dashboard/workflow bug. What was left was BASE_PATH = '' and
 * withBase(p) => p, kept "so existing callers don't have to change".
 *
 * They stayed for months, and every reader of a call site had to go and
 * find out that it did nothing. A no-op with a name is not free.
 */

export function absoluteUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (/^https?:\/\//i.test(path)) return path;
  return window.location.origin + path;
}
