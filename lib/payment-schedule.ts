/**
 * When the money is actually due.
 *
 * 067 gave every booking payment terms — "50/50", "on delivery", "net 30" —
 * and then nothing read them. The terms sat on the record as a note to
 * whoever remembered to look, which means collections has been running on
 * memory: a vendor chases us, or a client doesn't pay, and the first anyone
 * knows is the phone call.
 *
 * This turns the terms into dates. Pure, so the arithmetic that decides
 * whether something is overdue can be tested rather than trusted.
 *
 * ── The one thing to keep straight ────────────────────────────────
 *
 * Every date here is either a FACT or a PROJECTION, and they must never
 * look the same.
 *
 * "Net 30" means thirty days after delivery. If the work is delivered, that
 * is a real due date and a vendor can be paid against it. If it is not
 * delivered yet, thirty days after the *planned* finish is a guess — and a
 * guess printed in the same ink as a fact is how somebody pays early, or
 * chases a client for money that was never owed on that date.
 *
 * So every instalment carries a `basis`, and anything drawing these is
 * expected to say "projected" when it is not `actual`.
 */

export type Terms = 'split' | 'on_delivery' | 'in_advance' | 'net_days';

/** Where a due date came from. Never dropped on the way to the screen. */
export type Basis =
  /** The work is done and this date is real. */
  | 'actual'
  /** Counted from a plan. It will move when the plan does. */
  | 'planned'
  /** Nothing to count from — the terms are known, the date is not. */
  | 'unknown';

export type InstalmentState =
  | 'paid'
  /** Due today or in the past, and not paid. */
  | 'overdue'
  /** Due within the warning window. */
  | 'due-soon'
  | 'upcoming'
  /** No date to judge against. */
  | 'unknown';

export interface Instalment {
  key: string;
  /** What this payment is, in the words somebody would use out loud. */
  label: string;
  amount: number | null;
  due: string | null;
  basis: Basis;
  state: InstalmentState;
  /** Positive when late, negative when still ahead. Null without a date. */
  daysLate: number | null;
}

export interface ScheduleInput {
  terms?: unknown;
  splitPct?: unknown;
  netDays?: unknown;
  /** The whole bill. Null when nobody has priced it. */
  amount?: unknown;
  /** When the work actually finished. The only source of an `actual` date. */
  deliveredOn?: unknown;
  /** When it is planned to finish. */
  dueDate?: unknown;
  /** When the campaign starts — what "in advance" is ahead of. */
  startDate?: unknown;
  /** Recorded as paid so far. Applied to the instalments in order. */
  paid?: unknown;
  /** Today, passed in. Nothing here calls `new Date()`. */
  today: string;
  /** How many days ahead counts as "due soon". */
  warnDays?: number;
}

export interface Schedule {
  instalments: Instalment[];
  /** The terms in a sentence, whether or not a date could be worked out. */
  summary: string;
  /** Still owed across every instalment. */
  outstanding: number | null;
  /** The soonest unpaid due date, which is what a chase list sorts by. */
  nextDue: string | null;
  nextBasis: Basis;
  /** True when anything is past its date and unpaid. */
  overdue: boolean;
  /** Days late on the worst instalment. Null when nothing is late. */
  worstDaysLate: number | null;
}

/* ── Small pure helpers ──────────────────────────────────────────── */

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Round to the halala. Money compared at full float precision lies. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A date only if it really is one. Anything else is "no date", not today. */
export function isoOrNull(v: unknown): string | null {
  const s = txt(v).slice(0, 10);
  if (!ISO.test(s)) return null;
  // Reject 2026-02-31 and friends: Date normalises them into March, and a
  // due date that silently moves is worse than one that never appears.
  const [y, m, d] = s.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1
      || probe.getUTCDate() !== d) return null;
  return s;
}

/** `iso` plus n days, in UTC so a timezone cannot shift a due date. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. Negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/* ── The schedule ────────────────────────────────────────────────── */

/**
 * What "delivered" means, and how sure we are.
 *
 * The actual finish beats the planned one — a booking delivered a week
 * early is due a week early, and saying otherwise would have us paying a
 * vendor to the wrong calendar.
 */
function delivery(input: ScheduleInput): { on: string | null; basis: Basis } {
  const actual = isoOrNull(input.deliveredOn);
  if (actual) return { on: actual, basis: 'actual' };
  const planned = isoOrNull(input.dueDate);
  if (planned) return { on: planned, basis: 'planned' };
  return { on: null, basis: 'unknown' };
}

/**
 * Split an amount into parts that add back up to it.
 *
 * 50% of 1,001 is 500.50 twice, which is fine — but 30% of 1,001 is 300.30
 * and 700.70, and a naive round of each leaves a halala on the floor. The
 * remainder goes on the LAST instalment, so the parts always sum to the
 * total and the final payment is the one that settles the account.
 */
export function splitAmount(total: number, firstPct: number): [number, number] {
  const first = r2((total * firstPct) / 100);
  return [first, r2(total - first)];
}

export function paymentSchedule(input: ScheduleInput): Schedule {
  const terms = txt(input.terms) as Terms | '';
  const amount = num(input.amount);
  const total = amount != null && amount > 0 ? r2(amount) : null;
  const paid = Math.max(0, num(input.paid) ?? 0);
  const today = isoOrNull(input.today);
  const warn = input.warnDays ?? 7;

  const parts: { key: string; label: string; amount: number | null; due: string | null; basis: Basis }[] = [];
  const { on: delivered, basis } = delivery(input);
  const netDays = num(input.netDays);
  const pct = num(input.splitPct);

  // "In advance" counts from the start of the work, not its end — it is the
  // money that has to arrive before anything is posted.
  const start = isoOrNull(input.startDate);
  const advanceDue = start;
  const advanceBasis: Basis = start ? 'planned' : 'unknown';

  switch (terms) {
    case 'in_advance':
      parts.push({
        key: 'advance', label: 'In full, before anything is posted',
        amount: total, due: advanceDue, basis: advanceBasis,
      });
      break;

    case 'on_delivery':
      parts.push({
        key: 'delivery', label: 'On delivery',
        amount: total, due: delivered, basis,
      });
      break;

    case 'net_days': {
      const n = netDays ?? 30;
      parts.push({
        key: 'net', label: `${n} days after delivery`,
        amount: total,
        due: delivered ? addDays(delivered, n) : null,
        basis: delivered ? basis : 'unknown',
      });
      break;
    }

    case 'split': {
      const p = pct ?? 50;
      const [first, rest] = total != null ? splitAmount(total, p) : [null, null];
      parts.push({
        key: 'split-up-front', label: `${p}% up front`,
        amount: first, due: advanceDue, basis: advanceBasis,
      });
      parts.push({
        key: 'split-on-delivery', label: `${100 - p}% on delivery`,
        amount: rest, due: delivered, basis,
      });
      break;
    }

    default:
      return {
        instalments: [],
        summary: 'No payment terms agreed.',
        outstanding: total,
        nextDue: null,
        nextBasis: 'unknown',
        overdue: false,
        worstDaysLate: null,
      };
  }

  // Money already paid settles the instalments in order. A vendor who has
  // had their 50% up front is not also owed it on delivery, and a chase
  // list that says otherwise gets ignored within a week.
  let left = paid;
  const instalments: Instalment[] = parts.map((p) => {
    const amt = p.amount;
    let settled = false;
    if (amt != null) {
      if (left >= amt - 0.005) { settled = true; left = r2(left - amt); }
      else { left = 0; }
    }

    const daysLate = p.due && today ? daysBetween(p.due, today) : null;
    let state: InstalmentState;
    if (settled) state = 'paid';
    else if (daysLate == null) state = 'unknown';
    else if (daysLate > 0) state = 'overdue';
    else if (daysLate >= -warn) state = 'due-soon';
    else state = 'upcoming';

    return { ...p, state, daysLate };
  });

  const unpaid = instalments.filter((i) => i.state !== 'paid');
  const dated = unpaid.filter((i) => i.due).sort((a, b) => (a.due! < b.due! ? -1 : 1));
  const late = unpaid.filter((i) => i.state === 'overdue');

  const owed = total == null ? null : r2(Math.max(0, total - paid));

  return {
    instalments,
    summary: summarise(terms, pct, netDays, basis),
    outstanding: owed,
    nextDue: dated[0]?.due ?? null,
    nextBasis: dated[0]?.basis ?? 'unknown',
    overdue: late.length > 0,
    worstDaysLate: late.length
      ? Math.max(...late.map((i) => i.daysLate ?? 0))
      : null,
  };
}

/**
 * The terms as a sentence, said even when no date could be worked out.
 *
 * "Net 30, but nothing has been delivered" is useful. A blank is not — it
 * reads as "no terms", which is a different and much worse fact.
 */
function summarise(
  terms: Terms | '',
  pct: number | null,
  netDays: number | null,
  basis: Basis,
): string {
  const tail = basis === 'actual' ? ''
    : basis === 'planned' ? ' · projected from the planned finish'
    : ' · no delivery date yet';

  switch (terms) {
    case 'in_advance': return `Paid in full before anything is posted${tail}`;
    case 'on_delivery': return `Paid on delivery${tail}`;
    case 'net_days': return `Paid ${netDays ?? 30} days after delivery${tail}`;
    case 'split': {
      const p = pct ?? 50;
      return `${p}% up front, ${100 - p}% on delivery${tail}`;
    }
    default: return 'No payment terms agreed.';
  }
}

/* ── When a booking counts as delivered ──────────────────────────── */

export interface DeliveryLine {
  status?: unknown;
  posted_on?: unknown;
  quantity?: unknown;
}

/**
 * A booking is delivered when EVERY ad on it is posted — and then it is
 * delivered on the day the last one went up.
 *
 * Not the first, and not "some of them". A vendor booked for twelve pieces
 * who has posted eleven has not delivered, and starting a net-30 clock on
 * the eleventh would have us paying in full for work still outstanding.
 * Erring the other way costs a few days; erring this way costs the money.
 *
 * Cancelled ads do not count against delivery. A booking of twelve where
 * one was cancelled is delivered when the other eleven are up — otherwise a
 * cancellation would freeze the payment clock permanently.
 */
export function deliveredOn(lines: DeliveryLine[]): string | null {
  const live = (lines ?? []).filter((l) => txt(l.status) !== 'Cancelled');
  if (!live.length) return null;

  let last: string | null = null;
  for (const l of live) {
    if (txt(l.status) !== 'Posted') return null;
    const on = isoOrNull(l.posted_on);
    // Posted, but nobody recorded when. The booking may well be delivered;
    // we cannot say on what date, and a guess here is a wrong due date.
    if (!on) return null;
    if (!last || on > last) last = on;
  }
  return last;
}

/* ── What a chase list needs ─────────────────────────────────────── */

/** How a due date should read on a row. */
export function dueLabel(inst: Instalment): string {
  if (inst.state === 'paid') return 'paid';
  if (!inst.due) return 'no date yet';
  const projected = inst.basis === 'actual' ? '' : ' (projected)';
  if (inst.daysLate == null) return `due ${inst.due}${projected}`;
  if (inst.daysLate > 0) {
    return `${inst.daysLate} ${inst.daysLate === 1 ? 'day' : 'days'} overdue${projected}`;
  }
  if (inst.daysLate === 0) return `due today${projected}`;
  const inDays = -inst.daysLate;
  return `due in ${inDays} ${inDays === 1 ? 'day' : 'days'}${projected}`;
}

/**
 * The tone a payment wears, in the page's six-colour vocabulary.
 *
 * Note what is deliberately NOT red: an unknown date. Nobody is late — the
 * work simply has not been delivered, and colouring that as a failure would
 * paint half a healthy campaign red in its first week.
 */
export function scheduleTone(
  s: Schedule,
): 'grey' | 'blue' | 'amber' | 'green' | 'red' {
  if (!s.instalments.length) return 'grey';
  if (s.overdue) return 'red';
  if (s.instalments.every((i) => i.state === 'paid')) return 'green';
  if (s.instalments.some((i) => i.state === 'due-soon')) return 'amber';
  if (s.instalments.some((i) => i.state === 'unknown')) return 'grey';
  return 'blue';
}

/* ── One definition of a booking's schedule ──────────────────────── */

/**
 * How a BOOKING's payment schedule is derived, in one place.
 *
 * Two screens need this — the vendor contracts card, which shows it, and
 * the campaign's gap list, which chases it. Deriving it twice would work
 * right up until somebody changed one of them, and a page that disagrees
 * with itself about whether a vendor is overdue is worse than one that
 * never mentioned it.
 */
export function bookingSchedule(input: {
  booking: {
    payment_terms?: unknown;
    payment_split_pct?: unknown;
    payment_net_days?: unknown;
    due_date?: unknown;
    vendor_payment_amount?: unknown;
  } | null;
  /** The campaign, for when the work starts. */
  campaign?: { package_start_date?: unknown } | null;
  /** What the vendor is owed. */
  amount: number | null;
  /** The booking's ads — the only source of a real delivery date. */
  lines: DeliveryLine[];
  today: string;
}): Schedule {
  const b = input.booking ?? {};
  return paymentSchedule({
    terms: (b as any).payment_terms,
    splitPct: (b as any).payment_split_pct,
    netDays: (b as any).payment_net_days,
    amount: input.amount,
    deliveredOn: deliveredOn(input.lines ?? []),
    dueDate: (b as any).due_date,
    startDate: (input.campaign as any)?.package_start_date,
    paid: (b as any).vendor_payment_amount,
    today: input.today,
  });
}
