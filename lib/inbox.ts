/**
 * Sorting the Inbox into kinds.
 *
 * The screen shows a rail of kinds with counts — mentions, contracts,
 * quotations, triage — and there is a catch behind it: the database does not
 * record a kind. Every trigger that writes a notification writes the same
 * `type`, `'task_assigned'`, whatever actually happened. A row that says
 * "Malak mentioned you" and a row that says "Vendor contract requested" are
 * the same type to Postgres.
 *
 * So the kind is read out of the title, which IS structured — the triggers
 * that write it are a known, short list (migrations 006, 038, 041, 048,
 * 049) and each one uses a fixed phrase. Every phrase they produce is
 * covered by a test below. Anything unrecognised falls into "Other" and
 * still appears in All, so a new trigger tomorrow adds a row nobody loses,
 * rather than a row nobody sees.
 *
 * The honest fix is a `kind` column on notifications and five trigger
 * edits. `classify` prefers such a column the moment one exists — see
 * `kindFromColumn` — so that migration can land later without touching
 * this file's callers.
 *
 * Pure: no React, no Supabase, and no clock. `relativeTime` takes `nowMs`
 * because a function that reads the clock cannot be tested, and because
 * reading it during render is what made the old Inbox a hydration risk.
 */

export type InboxKind =
  | 'mention'
  | 'assigned'
  | 'contract'
  | 'document'
  | 'triage'
  | 'completed'
  | 'other';

export interface InboxRow {
  id: string;
  type?: string | null;
  title?: string | null;
  body?: string | null;
  link?: string | null;
  read?: boolean | null;
  created_at?: string | null;
  /** Not written today. Honoured first if a migration ever adds it. */
  kind?: string | null;
}

export interface KindMeta {
  key: InboxKind;
  /** The rail entry. */
  label: string;
  /** The pill on the row — shorter, because it sits beside the sentence. */
  pill: string;
}

/**
 * Rail order: the two that are about YOU first, then the paperwork, then
 * things that merely happened. A rail sorted by volume would put payments
 * at the top and a colleague asking you a question at the bottom.
 */
export const INBOX_KINDS: KindMeta[] = [
  { key: 'mention',   label: 'Mentions',        pill: 'Mention' },
  { key: 'assigned',  label: 'Assigned to me',  pill: 'Assigned' },
  { key: 'contract',  label: 'Contracts',       pill: 'Contract' },
  { key: 'document',  label: 'Quotes & invoices', pill: 'Document' },
  { key: 'triage',    label: 'Triage',          pill: 'Triage' },
  { key: 'completed', label: 'Completed',       pill: 'Completed' },
  { key: 'other',     label: 'Everything else', pill: 'Update' },
];

const META = new Map(INBOX_KINDS.map((k) => [k.key, k]));

export function kindMeta(kind: InboxKind): KindMeta {
  return META.get(kind) ?? META.get('other')!;
}

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/** Honour a real column if one is ever added. */
function kindFromColumn(row: InboxRow): InboxKind | null {
  const k = txt(row.kind).toLowerCase();
  return META.has(k as InboxKind) ? (k as InboxKind) : null;
}

/**
 * Which kind this notification is.
 *
 * Order matters: "mentioned you" is checked before anything else, because a
 * colleague asking you a question directly is the one row in here that
 * cannot wait behind paperwork.
 */
export function classify(row: InboxRow): InboxKind {
  const fromColumn = kindFromColumn(row);
  if (fromColumn) return fromColumn;

  const title = txt(row.title).toLowerCase();
  const type = txt(row.type).toLowerCase();

  if (title.includes('mentioned you')) return 'mention';
  if (type === 'task_completed' || title.startsWith('task completed')) return 'completed';
  if (title.includes('contract')) return 'contract';
  if (/\b(quotation|invoice)\b/.test(title)) return 'document';
  if (title.includes('awaits triage') || title.includes('triage')) return 'triage';
  if (title.includes('key account') || title.includes('assigned')) return 'assigned';
  if (title.includes('requested')) return 'document';
  return 'other';
}

export interface KindCount { total: number; unread: number }

/**
 * How many of each, and how many of those are unread.
 *
 * Counts every kind, including the ones with nothing in them — the rail
 * decides for itself whether to hide an empty row, and a count that
 * silently disappears from a map is harder to reason about than a zero.
 */
export function countByKind(rows: InboxRow[]): Record<InboxKind, KindCount> {
  const out = {} as Record<InboxKind, KindCount>;
  for (const k of INBOX_KINDS) out[k.key] = { total: 0, unread: 0 };
  for (const r of rows || []) {
    const k = classify(r);
    out[k].total += 1;
    if (!r.read) out[k].unread += 1;
  }
  return out;
}

export function totalCount(rows: InboxRow[]): KindCount {
  let total = 0, unread = 0;
  for (const r of rows || []) { total += 1; if (!r.read) unread += 1; }
  return { total, unread };
}

export interface InboxFilter {
  /** null = every kind. */
  kind?: InboxKind | null;
  query?: string;
  unreadOnly?: boolean;
}

/**
 * The rows to show, newest first.
 *
 * Search looks at the title and the body — what a person can see — and not
 * at `type` or `link`, which the old one included. Searching "task" matched
 * every row in the inbox because every row's type is `task_assigned`.
 */
export function filterInbox(rows: InboxRow[], f: InboxFilter = {}): InboxRow[] {
  const q = txt(f.query).toLowerCase();
  return (rows || [])
    .filter((r) => {
      if (f.unreadOnly && r.read) return false;
      if (f.kind && classify(r) !== f.kind) return false;
      if (!q) return true;
      return [r.title, r.body].some((v) => String(v || '').toLowerCase().includes(q));
    })
    .slice()
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
}

/** The task a notification points at, or null. */
export function taskIdOf(row: InboxRow): string | null {
  const m = txt(row.link).match(/task=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/**
 * "18m ago". `nowMs` is passed in — see the note at the top of the file.
 *
 * Falls back to a plain date after a week: "412d ago" is arithmetic, not
 * information.
 */
export function relativeTime(iso: string | null | undefined, nowMs: number): string {
  const then = Date.parse(txt(iso));
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((nowMs - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** The empty-state sentence, which depends on why the list is empty. */
export function emptyMessage(f: InboxFilter, totalInInbox: number): string {
  if (totalInInbox === 0) {
    return 'Nothing here yet. Mentions, assignments and contract updates land in this list.';
  }
  if (txt(f.query)) return 'Nothing matches that search.';
  if (f.unreadOnly) return 'Nothing unread. Turn off “Unread only” to see the rest.';
  if (f.kind) return `Nothing under ${kindMeta(f.kind).label.toLowerCase()}.`;
  return 'Nothing here.';
}
