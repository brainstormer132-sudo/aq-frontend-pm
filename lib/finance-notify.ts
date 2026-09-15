/**
 * Telling finance a payment is due.
 *
 * Finance has had the payment sections screen (All / Partial paid / Advanced)
 * since phase 2, but nothing reached OUT: a client payment fell due, or a
 * campaign was delivered and nobody had invoiced for it, and the first anyone
 * knew was when they happened to open the screen. This is the same idea the
 * contract register got with `chaseCandidates` - turn the silence into an
 * inbox notification - applied to money the client owes.
 *
 * Two things put a campaign on the list, and they are different facts:
 *
 *   - overdue:   a client instalment is past its due date and not paid.
 *   - delivered: the campaign is done and there is still money to collect,
 *                even if nothing is technically late yet (net-30 not elapsed).
 *
 * "Supposed to be paid" is the first; "ready to invoice" is the second. A
 * campaign that is overdue is reported as overdue - the stronger, more urgent
 * fact wins - so each campaign yields at most one candidate per run.
 *
 * All the deciding lives here. Pure: no React, no Supabase, no argless
 * `new Date()`. The route owns who is told and whether a notice already went
 * out. The due-date arithmetic is not re-implemented - it delegates to
 * `paymentSchedule`, the one place that knows what terms mean in dates.
 */
import { paymentSchedule } from './payment-schedule';

/** Why finance is being told about a campaign. */
export type DueReason = 'overdue' | 'delivered';

/**
 * A campaign as this decision needs it. `billed` is what the CLIENT is billed
 * (the rollup's sum_prices), `paid` what the client has paid so far. The
 * terms/dates are the campaign's own columns.
 */
export interface CampaignForNotify {
  id: string;
  workspace_id?: string | null;
  title?: string | null;
  brand?: string | null;
  /** What the client is billed. Null or <= 0 means nothing to collect. */
  billed?: number | null;
  /** Recorded paid so far. */
  paid?: number | null;
  /** task_status. 'done' is what counts as delivered. */
  status?: string | null;
  /** When it was marked done - the only source of an actual delivery date. */
  completedAt?: string | null;
  paymentTerms?: string | null;
  paymentSplitPct?: number | null;
  paymentNetDays?: number | null;
  /** The planned finish, for projecting a date before delivery. */
  dueDate?: string | null;
  /** When the work starts - what "in advance" is ahead of. */
  startDate?: string | null;
}

/** One campaign that finance should be told about, and why. */
export interface PaymentDueCandidate {
  id: string;
  workspace_id: string;
  title: string;
  reason: DueReason;
  /** Still owed. */
  amount: number;
  /** Days late on the worst instalment. Null unless overdue. */
  daysLate: number | null;
  /** The instalment date that put it here, when there is one. */
  due: string | null;
}

/* -- Small pure helpers ------------------------------------------- */

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A campaign counts as delivered once it is marked done. */
export function isDelivered(status: unknown): boolean {
  return txt(status).toLowerCase() === 'done';
}

/**
 * Which campaigns finance should be told about, and why.
 *
 * A campaign is skipped when there is nothing to collect: no bill, or paid in
 * full. Otherwise its client schedule is worked out from the terms; if any
 * instalment is overdue it is reported overdue, else if the campaign is
 * delivered it is reported as ready to invoice. A campaign that is neither
 * (in flight, nothing late yet) is not on the list - there is nothing to
 * chase yet.
 */
export function paymentsDue(
  campaigns: CampaignForNotify[],
  today: string,
): PaymentDueCandidate[] {
  const out: PaymentDueCandidate[] = [];

  for (const c of campaigns ?? []) {
    if (!c.id || !c.workspace_id) continue;

    const billed = num(c.billed);
    if (billed == null || billed <= 0) continue;

    const paid = Math.max(0, num(c.paid) ?? 0);
    const outstanding = r2(Math.max(0, billed - paid));
    if (outstanding <= 0) continue;

    const delivered = isDelivered(c.status);

    const sched = paymentSchedule({
      terms: c.paymentTerms,
      splitPct: c.paymentSplitPct,
      netDays: c.paymentNetDays,
      amount: billed,
      deliveredOn: delivered ? (c.completedAt ?? null) : null,
      dueDate: c.dueDate,
      startDate: c.startDate,
      paid,
      today,
    });

    const title = txt(c.title) || txt(c.brand) || 'a campaign';
    const base = { id: c.id, workspace_id: c.workspace_id, title, amount: outstanding };

    if (sched.overdue) {
      out.push({ ...base, reason: 'overdue', daysLate: sched.worstDaysLate, due: sched.nextDue });
      continue;
    }
    if (delivered) {
      out.push({ ...base, reason: 'delivered', daysLate: null, due: sched.nextDue });
    }
  }

  return out;
}

/* -- The words a notification wears ------------------------------- */

/** SAR 60,000 - grouped, no decimals. Kept ASCII. */
export function fmtSar(n: number): string {
  const whole = Math.round(n);
  return `SAR ${whole.toLocaleString('en-US')}`;
}

/** The title + body for a candidate, said the way finance would say it. */
export function paymentDueMessage(c: PaymentDueCandidate): { title: string; body: string } {
  const money = fmtSar(c.amount);
  if (c.reason === 'overdue') {
    const late = c.daysLate && c.daysLate > 0
      ? `${c.daysLate} ${c.daysLate === 1 ? 'day' : 'days'} overdue`
      : 'overdue';
    return { title: 'Client payment overdue', body: `${c.title} - ${money} ${late}.` };
  }
  return { title: 'Delivered, ready to invoice', body: `${c.title} - delivered, ${money} to collect.` };
}

/**
 * The de-dup / deep link for a candidate. Per campaign AND per reason, so an
 * overdue notice is not silenced by a "ready to invoice" one sent days
 * earlier: when a delivered campaign tips into overdue, that is a different
 * link and fires at once.
 */
export function paymentDueLink(c: PaymentDueCandidate): string {
  return `/dashboard?finance=payments&task=${c.id}&due=${c.reason}`;
}

/**
 * How often the same fact may re-notify. A payment that stays overdue should
 * nudge again after a few quiet days, not every single morning. Matches the
 * contract chaser's cadence.
 */
export const NOTIFY_EVERY_DAYS = 3;

/** Roles told about money due, besides nobody in particular. */
export const RECIPIENT_ROLES = ['owner', 'admin', 'finance'];
