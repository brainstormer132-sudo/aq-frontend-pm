/**
 * Vendor performance, pure. No React, no Supabase, no argless `new Date()`.
 *
 * One picture of a vendor from the ad lines they were booked on: do they post
 * on time, is the proof attached, and what is still waiting to be chased. The
 * question Siraj asked of the data the app already keeps — "who delivers, who
 * needs chasing, who is worth rebooking" — with nothing invented.
 *
 * An ad line carries no vendor of its own; it belongs to a booking subtask,
 * and the booking carries the `vendor_id`. The caller resolves that join and
 * hands us flat `PerfLine`s already tagged with a vendor. This module only
 * decides what each line's delivery says and rolls the lines up per vendor.
 *
 * Dates here are ISO calendar days (`YYYY-MM-DD`) and are compared as strings,
 * which for that format is the same as comparing the days and needs no `Date`
 * and no timezone. `today` is passed in, judged the same way the rest of the
 * app judges "today": the UTC calendar day.
 */

/** An ad line that a vendor is Posted / on the hook for. */
export const AD_POSTED = 'Posted';
export const AD_CANCELLED = 'Cancelled';

/** Reliability bands, for one colour vocabulary across the screen. */
export const RELIABLE_PCT = 90; // on-time this often or more reads as reliable
export const SHAKY_PCT = 70;    // below this reads as a problem

export type LineDelivery =
  /** Posted on or before its due date. */
  | 'on-time'
  /** Posted, but after its due date. */
  | 'late'
  /** Posted, but with no due date and/or no posted date to judge against. */
  | 'posted'
  /** Not posted, not cancelled, and its due date is in the past — chase it. */
  | 'overdue'
  /** Not posted, not cancelled, and not yet past due (or no due date). */
  | 'pending'
  /** Cancelled — nothing was owed, exempt from every count. */
  | 'cancelled';

/** The little of an ad line a performance read needs, already tagged with its vendor. */
export interface PerfLine {
  vendorId: number | string | null;
  status?: string | null;
  /** The planned post date (`vendor_ad_lines.due_date`). */
  dueDate?: string | null;
  /** When it actually went up (`vendor_ad_lines.posted_on`). */
  postedOn?: string | null;
  /** Proof on file — the caller passes `hasProof(line)` from lib/ad-lines. */
  hasProof?: boolean;
}

export interface VendorPerf {
  vendorId: string;
  /** Ad lines that were ever owed (everything but cancelled). */
  ads: number;
  /** Delivered: posted on-time, late, or posted-but-unjudged. */
  delivered: number;
  onTime: number;
  late: number;
  /** Not posted and past due — the chase list. */
  overdue: number;
  /** Not posted, not yet past due. */
  pending: number;
  /** Delivered but the proof of posting is not attached. */
  missingProof: number;
  /** on-time / (on-time + late), as a whole percent. Null when nothing is judgeable. */
  reliabilityPct: number | null;
  /** overdue + missingProof: the count of things a person should act on. */
  needsChasing: number;
  /** The most recent post date on file — recency, for "worth rebooking". */
  lastPostedOn: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/** An ISO calendar day, or '' when the value is not one. */
function day(v: unknown): string {
  const s = txt(v).slice(0, 10);
  return ISO.test(s) ? s : '';
}

/**
 * What one ad line's delivery says, judged against `today`. Pure, and the one
 * place the on-time / overdue rules live.
 */
export function lineDelivery(line: PerfLine, today: string): LineDelivery {
  if (txt(line?.status) === AD_CANCELLED) return 'cancelled';
  const posted = day(line?.postedOn);
  const due = day(line?.dueDate);
  const delivered = txt(line?.status) === AD_POSTED || posted !== '';
  if (delivered) {
    if (posted && due) return posted <= due ? 'on-time' : 'late';
    return 'posted';
  }
  const t = day(today);
  if (due && t && due < t) return 'overdue';
  return 'pending';
}

/**
 * Roll the lines up per vendor. Lines with no vendor are dropped (nothing to
 * attribute them to). The result is sorted with the vendors who need action
 * first: most to chase, then least reliable, then most work — so the top of
 * the list is where a person should look.
 */
export function vendorPerformance(lines: PerfLine[], today: string): VendorPerf[] {
  const byVendor = new Map<string, VendorPerf>();

  const blank = (id: string): VendorPerf => ({
    vendorId: id,
    ads: 0, delivered: 0, onTime: 0, late: 0, overdue: 0, pending: 0,
    missingProof: 0, reliabilityPct: null, needsChasing: 0, lastPostedOn: null,
  });

  for (const line of lines ?? []) {
    const id = txt(line?.vendorId);
    if (!id) continue;
    const v = byVendor.get(id) ?? blank(id);

    const state = lineDelivery(line, today);
    if (state !== 'cancelled') v.ads += 1;

    if (state === 'on-time' || state === 'late' || state === 'posted') {
      v.delivered += 1;
      if (state === 'on-time') v.onTime += 1;
      if (state === 'late') v.late += 1;
      if (!line?.hasProof) v.missingProof += 1;
      const p = day(line?.postedOn);
      if (p && (!v.lastPostedOn || p > v.lastPostedOn)) v.lastPostedOn = p;
    } else if (state === 'overdue') {
      v.overdue += 1;
    } else if (state === 'pending') {
      v.pending += 1;
    }

    byVendor.set(id, v);
  }

  const rows = [...byVendor.values()].map((v) => {
    const judged = v.onTime + v.late;
    return {
      ...v,
      reliabilityPct: judged > 0 ? Math.round((v.onTime / judged) * 100) : null,
      needsChasing: v.overdue + v.missingProof,
    };
  });

  return rows.sort((a, b) => {
    if (b.needsChasing !== a.needsChasing) return b.needsChasing - a.needsChasing;
    // Least reliable next; a vendor with no judgeable line sinks below one that has.
    const ra = a.reliabilityPct, rb = b.reliabilityPct;
    if (ra != null && rb != null && ra !== rb) return ra - rb;
    if (ra == null && rb != null) return 1;
    if (ra != null && rb == null) return -1;
    if (b.ads !== a.ads) return b.ads - a.ads;
    return a.vendorId < b.vendorId ? -1 : a.vendorId > b.vendorId ? 1 : 0;
  });
}

/** Reliability in three bands, for one colour rule on the screen. Null → 'none'. */
export function reliabilityBand(pct: number | null): 'reliable' | 'ok' | 'shaky' | 'none' {
  if (pct == null) return 'none';
  if (pct >= RELIABLE_PCT) return 'reliable';
  if (pct >= SHAKY_PCT) return 'ok';
  return 'shaky';
}
