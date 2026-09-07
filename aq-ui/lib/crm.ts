/**
 * The CRM's activity maths.
 *
 * Pure. No React, no Supabase, no argless `new Date()`.
 *
 * The screen's layout is staying as it is — Siraj: *"just keep crm how it is"*
 * — so this file exists to fix two things behind it that were wrong.
 *
 * **1. "Dormant contacts" was upside down on a busy workspace.**
 *
 * The panel was built from `useCrmRecentActivities(workspaceId, 500)` — the
 * five hundred most recent activities in the whole workspace. Last contact per
 * person was read out of that window, so a contact whose most recent note is
 * the 501st gets nothing back, lands on `lastMs = 0`, and `0` sorts first in
 * `a.lastMs - b.lastMs`. The people you talk to most were arriving at the top
 * of a list headed *"No activity in the last 60 days. These need a check-in."*
 *
 * The window is the bug, so the window is gone: the index is built from the
 * whole table, paged. `lastContactIndex()` then means what it says, and
 * `'never'` is a fact rather than an artefact of where the page boundary fell.
 *
 * **2. The Dormant stat card could not count past six.**
 *
 * `totalDormant = dormant.length`, and `dormant` had already been through
 * `.slice(0, 6)` for the list beside it. A workspace with forty cold contacts
 * read "6". The count and the list are separate here.
 */

// ── Small shared helpers ────────────────────────────────────────────

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export const DAY_MS = 86_400_000;

export function stampMs(value: unknown): number {
  const s = txt(value);
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : 0;
}

// ── The activity index ──────────────────────────────────────────────

export interface ActivityStamp {
  target_type?: string | null;
  target_id?: string | null;
  kind?: string | null;
  occurred_at?: string | null;
}

export type ContactType = 'client' | 'vendor';

export interface ContactLike {
  type: ContactType;
  id: string;
  name: string;
  meta: string;
}

export function contactKey(type: unknown, id: unknown): string {
  return `${txt(type)}:${txt(id)}`;
}

/** A row missing either half cannot be attributed to anybody. */
function keyed(a: ActivityStamp): string | null {
  const type = txt(a.target_type);
  const id = txt(a.target_id);
  return type && id ? `${type}:${id}` : null;
}

/**
 * Newest activity per contact, in milliseconds.
 *
 * Built from every activity in the workspace, not a recent window — which is
 * the whole point. A contact absent from this map has genuinely never been
 * contacted.
 */
export function lastContactIndex(activities: ActivityStamp[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of activities ?? []) {
    const key = keyed(a);
    if (!key) continue;
    const t = stampMs(a.occurred_at);
    if (!t) continue;
    const seen = out.get(key);
    if (seen === undefined || seen < t) out.set(key, t);
  }
  return out;
}

/** How many activities each contact has since `sinceMs`. */
export function countsSince(activities: ActivityStamp[], sinceMs: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of activities ?? []) {
    if (stampMs(a.occurred_at) < sinceMs) continue;
    const key = keyed(a);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Activities by kind since `sinceMs`. Known kinds are always present at 0. */
export function kindCountsSince(
  activities: ActivityStamp[],
  sinceMs: number,
  known: readonly string[] = ['note', 'call', 'meeting', 'email', 'status_change'],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of known) out[k] = 0;
  for (const a of activities ?? []) {
    if (stampMs(a.occurred_at) < sinceMs) continue;
    const k = txt(a.kind) || 'note';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Oldest bin first, ending with the week we are in. */
export function weeklyBins(activities: ActivityStamp[], nowMs: number, weeks: number): number[] {
  const bins = new Array(Math.max(1, weeks)).fill(0);
  const span = 7 * DAY_MS;
  for (const a of activities ?? []) {
    const t = stampMs(a.occurred_at);
    if (!t || t > nowMs) continue;
    const back = Math.floor((nowMs - t) / span);
    if (back >= bins.length) continue;
    bins[bins.length - 1 - back] += 1;
  }
  return bins;
}

export function countSince(activities: ActivityStamp[], sinceMs: number): number {
  let n = 0;
  for (const a of activities ?? []) if (stampMs(a.occurred_at) >= sinceMs) n += 1;
  return n;
}

// ── Dormancy ────────────────────────────────────────────────────────

export type DormantState = 'never' | 'quiet';

export interface DormantRow {
  contact: ContactLike;
  /** 0 when never contacted — and now that means it. */
  lastMs: number;
  state: DormantState;
  days: number;
  /** "63 days quiet" / "never contacted" */
  label: string;
}

/**
 * Everyone who needs a check-in, longest-silent first.
 *
 * Returns the WHOLE list. The caller slices it for display and counts it for
 * the stat card — doing both from one sliced array is how the card came to
 * read "6" on a workspace with forty cold contacts.
 */
export function dormantContacts(input: {
  contacts: ContactLike[];
  last: Map<string, number>;
  nowMs: number;
  afterDays: number;
}): DormantRow[] {
  const cutoff = input.nowMs - input.afterDays * DAY_MS;
  const rows: DormantRow[] = [];

  for (const contact of input.contacts ?? []) {
    const lastMs = input.last.get(contactKey(contact.type, contact.id)) ?? 0;
    if (lastMs !== 0 && lastMs >= cutoff) continue;
    const state: DormantState = lastMs === 0 ? 'never' : 'quiet';
    const days = lastMs === 0 ? Infinity : Math.floor((input.nowMs - lastMs) / DAY_MS);
    rows.push({
      contact,
      lastMs,
      state,
      days: Number.isFinite(days) ? days : 0,
      label: state === 'never' ? 'never contacted' : `${days} ${days === 1 ? 'day' : 'days'} quiet`,
    });
  }

  // Longest-quiet first, then never-contacted, then name.
  //
  // Never-contacted used to sort first — it is "infinitely quiet", so that
  // looked right. On a real vendor book it is not: hundreds of vendors are
  // registered and never spoken to, and they crowd every client who was warm
  // and went cold off the list entirely. Somebody who went quiet is the one
  // you can act on; the never-contacted are a number in the header.
  rows.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'quiet' ? -1 : 1;
    if (a.lastMs !== b.lastMs) return a.lastMs - b.lastMs;
    return a.contact.name.localeCompare(b.contact.name);
  });
  return rows;
}

export interface DormantSummary {
  total: number;
  never: number;
  quiet: number;
  label: string;
}

export function dormantSummary(rows: DormantRow[], afterDays: number): DormantSummary {
  const list = rows ?? [];
  const never = list.filter((r) => r.state === 'never').length;
  const quiet = list.length - never;
  const parts: string[] = [];
  if (quiet) parts.push(`${quiet} quiet for ${afterDays}+ days`);
  if (never) parts.push(`${never} never contacted`);
  return {
    total: list.length,
    never,
    quiet,
    label: parts.join(' · ') || 'Everyone has been contacted recently.',
  };
}

// ── Most active ─────────────────────────────────────────────────────

export interface ActiveRow { contact: ContactLike; count: number }

export function mostActive(
  contacts: ContactLike[],
  counts: Map<string, number>,
  top: number,
): ActiveRow[] {
  return (contacts ?? [])
    .map((contact) => ({ contact, count: counts.get(contactKey(contact.type, contact.id)) ?? 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => (b.count - a.count) || a.contact.name.localeCompare(b.contact.name))
    .slice(0, Math.max(0, top));
}

// ── Scoping to the search box ───────────────────────────────────────

export function matchesQuery(contact: ContactLike, query: unknown): boolean {
  const q = txt(query).toLowerCase();
  if (!q) return true;
  return [contact.name, contact.meta, contact.id]
    .some((v) => String(v ?? '').toLowerCase().includes(q));
}

export function scopeContacts(contacts: ContactLike[], query: unknown): ContactLike[] {
  const q = txt(query);
  if (!q) return contacts ?? [];
  return (contacts ?? []).filter((c) => matchesQuery(c, q));
}

export function scopeActivities<T extends ActivityStamp>(
  activities: T[],
  scoped: ContactLike[],
  query: unknown,
): T[] {
  if (!txt(query)) return activities ?? [];
  const keys = new Set((scoped ?? []).map((c) => contactKey(c.type, c.id)));
  return (activities ?? []).filter((a) => keys.has(contactKey(a.target_type, a.target_id)));
}

// ── The feed's timestamps ───────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "just now" / "12m ago" / "3d ago" / "25 May 2026".
 *
 * `nowMs` is handed in, and the fallback past a week is built by hand: the old
 * one called `Date.now()` and `toLocaleDateString()` inside the render, so the
 * feed printed 5/25/2026 or 25/05/2026 depending on the machine — and the
 * server's answer and the browser's could disagree.
 */
export function timeAgo(iso: unknown, nowMs: number): string {
  const t = stampMs(iso);
  if (!t) return 'unknown';
  const ms = nowMs - t;
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const day = new Date(t);
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]} ${day.getUTCFullYear()}`;
}
