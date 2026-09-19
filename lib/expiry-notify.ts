/**
 * Which papers are lapsing, and what to say about them.
 *
 * The Clients and Vendors registers now flag a CR or licence that is expired
 * or within thirty days, and let you filter to them — but only if someone
 * opens the screen. This module is the other half: the pure decision behind a
 * daily cron that turns that silence into an inbox notice, the same way the
 * contract chaser does for a request stuck with Legal and the payments check
 * does for money that is due.
 *
 * Pure on purpose. It decides *which* records are worth a notice and *what
 * the notice says* — never *who* is told or whether one already went out.
 * The cron route (`app/api/registry/expiry-check`) owns the recipients, the
 * per-workspace fan-out and the de-duplication.
 *
 * The thirty-day window is `EXPIRY_SOON_DAYS` from the register, imported so
 * the badge, the filter and the chaser can never disagree about what "soon"
 * means.
 */
import { EXPIRY_SOON_DAYS } from './registry';

/** A CR or licence within this many days of lapsing is worth a notice. */
export const EXPIRY_WITHIN_DAYS = EXPIRY_SOON_DAYS;

/** At most one notice per record per state per this many days. */
export const NOTIFY_EVERY_DAYS = 7;

/** Who hears about lapsing papers. There is no "legal"/"ops" role here. */
export const RECIPIENT_ROLES = ['owner', 'admin'];

export type PapersKind = 'client' | 'vendor';

/** The little a client or vendor row needs for the expiry decision. */
export interface PapersRow {
  id: string;
  kind: PapersKind;
  name: string;
  /** ISO `YYYY-MM-DD`, or null/blank when nothing is on file. */
  expiry?: string | null;
  /**
   * The client's workspace. Vendors are a shared, workspace-less table, so
   * this is null for them and the route fans a vendor notice to every
   * workspace's owners and admins.
   */
  workspaceId?: string | null;
}

export interface ExpiryCandidate {
  id: string;
  kind: PapersKind;
  name: string;
  workspaceId: string | null;
  /** The date on file, echoed so the message need not re-derive it. */
  expiry: string;
  /** Whole days until it lapses; negative once it already has. */
  daysLeft: number;
  state: 'expired' | 'soon';
}

/** An ISO calendar day (`YYYY-MM-DD`) or null if it cannot be read as a date. */
function isoDay(v?: string | null): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Whole days from `fromDay` to `toDay` (both ISO); positive when `toDay` is later. */
function dayDiff(fromDay: string, toDay: string): number {
  const a = new Date(`${fromDay}T00:00:00`).getTime();
  const b = new Date(`${toDay}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * The records lapsing soon enough to say something about. Expired counts
 * (days negative); so does anything within `withinDays`. Rows with no date, a
 * junk date, or a date comfortably in the future are left alone.
 */
export function expiryDue(
  rows: PapersRow[],
  today: string,
  withinDays: number = EXPIRY_WITHIN_DAYS,
): ExpiryCandidate[] {
  const out: ExpiryCandidate[] = [];
  for (const r of rows) {
    const day = isoDay(r.expiry);
    if (!day) continue;
    const daysLeft = dayDiff(today, day);
    if (daysLeft > withinDays) continue;
    out.push({
      id: r.id,
      kind: r.kind,
      name: r.name,
      workspaceId: r.workspaceId ?? null,
      expiry: day,
      daysLeft,
      state: daysLeft < 0 ? 'expired' : 'soon',
    });
  }
  return out;
}

/** "CR" for a client, "licence" for a vendor — what the papers are called. */
export function papersNoun(kind: PapersKind): string {
  return kind === 'client' ? 'CR' : 'licence';
}

/** The notice's title and body. */
export function expiryMessage(c: ExpiryCandidate): { title: string; body: string } {
  const noun = papersNoun(c.kind);
  const name = c.name || (c.kind === 'client' ? 'A client' : 'A vendor');
  if (c.state === 'expired') {
    const ago = Math.abs(c.daysLeft);
    return {
      title: `${noun.toUpperCase() === noun ? noun : noun[0].toUpperCase() + noun.slice(1)} expired`,
      body: `${name}'s ${noun} expired ${ago} day${ago === 1 ? '' : 's'} ago (${c.expiry}).`,
    };
  }
  const left = c.daysLeft;
  return {
    title: `${noun[0].toUpperCase() + noun.slice(1)} expiring soon`,
    body: left === 0
      ? `${name}'s ${noun} expires today (${c.expiry}).`
      : `${name}'s ${noun} expires in ${left} day${left === 1 ? '' : 's'} (${c.expiry}).`,
  };
}

/**
 * The notice's link, and the de-duplication key with it. Unique per
 * (workspace, kind, record, state): the workspace so a shared vendor notice
 * reaches every workspace once, and the state so an "expired" notice is never
 * silenced by the "soon" one that preceded it.
 */
export function expiryLink(c: ExpiryCandidate, workspaceId: string): string {
  const params = new URLSearchParams({
    view: `${c.kind}s`,
    expiry: c.id,
    state: c.state,
    ws: workspaceId,
  });
  return `/dashboard/workflow?${params.toString()}`;
}
