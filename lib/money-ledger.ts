/**
 * Who owes us, and who do we owe.
 *
 * The Data view could show the *shape* of that — a donut of paid / partly
 * paid / unpaid — but not the rows. You could see that SAR 712,000 was
 * outstanding and had no way to find out from whom. Siraj, Aug 2026:
 * *"client owe and vendors owe — you need to be able to search by unpaid or
 * paid or partial."*
 *
 * So this file turns the two money relationships into two ledgers of real
 * rows, filterable by payment state and by text, and exportable as they
 * stand. Both sides share one shape so the screen only has to learn one.
 *
 * Pure: no React, no Supabase, no argless `new Date()`. The payment-state
 * rules themselves are not re-implemented here — they live in
 * `lib/dashboard-data.ts` and are already tested; this builds on them.
 */

import {
  clientPaymentState, vendorPaymentState, isOpen,
  type DashTask, type PaymentState, type Tone,
} from './dashboard-data';

export type PayKey = 'paid' | 'partial' | 'unpaid';

/** Which relationship you are looking at. */
export type Side = 'clients' | 'vendors';

export const SIDES: { key: Side; label: string; blurb: string }[] = [
  { key: 'clients', label: 'Receivables', blurb: 'Campaigns we have billed.' },
  { key: 'vendors', label: 'Payables', blurb: 'Bookings we have to pay.' },
];

export const PAY_KEYS: PayKey[] = ['paid', 'partial', 'unpaid'];

/**
 * The words differ by side on purpose. A client who has not paid is
 * *outstanding* — money we are chasing. A vendor who has not been paid is
 * *unpaid* — money somebody is chasing us for. Same key, different sentence,
 * because they are not the same problem.
 */
export function payLabel(key: PayKey, side: Side): string {
  if (key === 'paid') return 'Paid';
  if (key === 'partial') return 'Partly paid';
  return side === 'clients' ? 'Outstanding' : 'Unpaid';
}

export function payTone(key: PayKey): Tone {
  return key === 'paid' ? 'ok' : key === 'partial' ? 'wait' : 'bad';
}

/* ── A row ──────────────────────────────────────────────────────── */

export interface LedgerRow {
  /** The task to open when the row is clicked — campaign or booking. */
  id: string;
  /** Who the money is with: the client, or the vendor. */
  party: string;
  /** What it is for. On the vendor side this is the campaign, not the booking. */
  campaign: string;
  /** Billed (clients) or booked (vendors). */
  total: number;
  paid: number;
  outstanding: number;
  state: PayKey;
  stateLabel: string;
  tone: Tone;
  /** Still running, so an unpaid balance may just be early. */
  open: boolean;
  /**
   * The recorded amount and the recorded status disagree. Not an error —
   * somebody ticked one and not the other — but the sort of thing that turns
   * into an argument with a client six weeks later, so it is said out loud.
   */
  mismatch: string | null;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function nameOf(t: DashTask | undefined): string {
  if (!t) return '';
  return (t.task_name || t.title || '').trim();
}

/** Round to the nearest halala before comparing, so 0.004 is not a debt. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── Clients owe us ─────────────────────────────────────────────── */

/**
 * One row per campaign that has been billed something.
 *
 * The state comes from `client_payment_status`, which is what a person set.
 * The outstanding figure comes from `client_payment_amount`, which is what
 * was recorded. When those two disagree the row says so rather than picking
 * a winner — the status is somebody's judgement and the amount is somebody's
 * arithmetic, and this screen is not the place to overrule either.
 */
export function clientLedger(input: {
  parents: DashTask[];
  subtasks: DashTask[];
  clientName?: Map<string, string>;
}): LedgerRow[] {
  const byParent = new Map<string, DashTask[]>();
  for (const s of input.subtasks) {
    if (!s.parent_task_id) continue;
    const list = byParent.get(s.parent_task_id) ?? [];
    list.push(s);
    byParent.set(s.parent_task_id, list);
  }

  const out: LedgerRow[] = [];
  for (const p of input.parents) {
    const subs = byParent.get(p.id) ?? [];
    const total = r2(subs.reduce((a, s) => a + num(s.price), 0));
    // A campaign nobody has priced is not a debt. It is an unfinished
    // campaign, and putting it in a ledger of money owed is how a total
    // stops meaning anything.
    if (total <= 0) continue;

    const state: PaymentState = clientPaymentState(p);
    const recorded = num(p.client_payment_amount);
    const paid = clampPaid(recorded, total, state.key);
    const party = (p.client_id && input.clientName?.get(p.client_id))
      || (p.brand_name || '').trim()
      || 'Unknown client';

    out.push({
      id: p.id,
      party,
      campaign: nameOf(p) || 'Untitled campaign',
      total,
      paid,
      outstanding: r2(Math.max(0, total - paid)),
      state: state.key,
      stateLabel: payLabel(state.key, 'clients'),
      tone: payTone(state.key),
      open: isOpen(p),
      // The RECORDED amount, not the clamped one — the whole point of this
      // line is to notice when the two disagree.
      mismatch: disagreement(state.key, recorded, total, 'clients'),
    });
  }
  return out;
}

/* ── We owe vendors ─────────────────────────────────────────────── */

/**
 * One row per vendor booking with a net on it.
 *
 * Named for the **campaign**, not the booking. A vendor booking is named
 * after the vendor, so a row reading "Bright Studios · Bright Studios
 * booking" tells you nothing you did not already know from the first column.
 */
export function vendorLedger(input: {
  subtasks: DashTask[];
  parents: DashTask[];
  vendorName?: Map<string, string>;
}): LedgerRow[] {
  const parentById = new Map(input.parents.map((p) => [p.id, p]));

  const out: LedgerRow[] = [];
  for (const s of input.subtasks) {
    const total = r2(num(s.net_amount));
    if (total <= 0) continue;

    const state = vendorPaymentState(s);
    const recorded = num(s.vendor_payment_amount);
    const paid = clampPaid(recorded, total, state.key);
    const party = (s.vendor_id != null && input.vendorName?.get(String(s.vendor_id)))
      || nameOf(s)
      || 'Unnamed vendor';

    out.push({
      id: s.id,
      party,
      campaign: nameOf(parentById.get(s.parent_task_id ?? '')) || '—',
      total,
      paid,
      outstanding: r2(Math.max(0, total - paid)),
      state: state.key,
      stateLabel: payLabel(state.key, 'vendors'),
      tone: payTone(state.key),
      open: isOpen(s),
      mismatch: disagreement(state.key, recorded, total, 'vendors'),
    });
  }
  return out;
}

/**
 * A recorded payment bigger than the bill is somebody's typo, not a credit
 * note. Capping it stops one fat-fingered row from making the workspace
 * total say we are owed less than nothing.
 */
function clampPaid(paid: number, total: number, key: PayKey): number {
  if (key === 'paid') return total;
  return r2(Math.min(Math.max(0, paid), total));
}

/**
 * `recorded` is what is actually in the amount column — NOT the clamped
 * figure used for the arithmetic. Comparing the clamped one would be
 * comparing a number against itself, and this line would never fire.
 */
function disagreement(key: PayKey, recorded: number, total: number, side: Side): string | null {
  const who = side === 'clients' ? 'client' : 'vendor';
  if (key === 'paid' && recorded + 0.5 < total) {
    return recorded <= 0
      ? `Marked paid, but no ${who} payment amount was recorded.`
      : `Marked paid, but only SAR ${money(recorded)} of SAR ${money(total)} was recorded.`;
  }
  if (key !== 'paid' && recorded + 0.5 >= total && total > 0) {
    return `The full amount is recorded as paid, but the status still says ${payLabel(key, side).toLowerCase()}.`;
  }
  return null;
}

/* ── Totals ─────────────────────────────────────────────────────── */

export interface StateTotal { key: PayKey; label: string; tone: Tone; count: number; amount: number }

export interface LedgerTotals {
  /** Everything billed / booked. */
  total: number;
  paid: number;
  outstanding: number;
  rows: number;
  /** One entry per state that exists, in paid → partial → unpaid order. */
  states: StateTotal[];
}

/**
 * The bar across the top.
 *
 * Each state is weighted by the **whole** bill, not by what is outstanding on
 * it — the bar answers "how much of what we billed is in each state", and a
 * partly-paid campaign belongs in the partial band at its full size. What is
 * still owed is the separate figure beside it.
 */
export function ledgerTotals(rows: LedgerRow[], side: Side): LedgerTotals {
  const acc = new Map<PayKey, StateTotal>();
  let total = 0, paid = 0, outstanding = 0;

  for (const r of rows) {
    total += r.total;
    paid += r.paid;
    outstanding += r.outstanding;
    const cur = acc.get(r.state)
      ?? { key: r.state, label: payLabel(r.state, side), tone: payTone(r.state), count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += r.total;
    acc.set(r.state, cur);
  }

  return {
    total: r2(total),
    paid: r2(paid),
    outstanding: r2(outstanding),
    rows: rows.length,
    states: PAY_KEYS.filter((k) => acc.has(k)).map((k) => {
      const s = acc.get(k)!;
      return { ...s, amount: r2(s.amount) };
    }),
  };
}

/** Each state's share of the bar, as a percentage that always sums to 100. */
export function shares(totals: LedgerTotals): { key: PayKey; pct: number }[] {
  if (totals.total <= 0) return [];
  const raw = totals.states.map((s) => ({ key: s.key, pct: (s.amount / totals.total) * 100 }));
  // A band worth 0.2% still has to be visible, or a real balance looks like
  // no balance at all.
  return raw.map((r) => ({ ...r, pct: r.pct > 0 && r.pct < 1.2 ? 1.2 : r.pct }));
}

/* ── Filtering ──────────────────────────────────────────────────── */

export interface LedgerFilter {
  /** null = every state. */
  state: PayKey | null;
  query: string;
  /** Hide rows that are fully settled — the default when chasing. */
  outstandingOnly: boolean;
}

export const EMPTY_LEDGER_FILTER: LedgerFilter = { state: null, query: '', outstandingOnly: false };

export function filterLedger(rows: LedgerRow[], f: LedgerFilter): LedgerRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.state && r.state !== f.state) return false;
    if (f.outstandingOnly && r.outstanding <= 0) return false;
    if (!q) return true;
    return [r.party, r.campaign, r.stateLabel].join(' ').toLowerCase().includes(q);
  });
}

export function isLedgerFiltered(f: LedgerFilter): boolean {
  return Boolean(f.state || f.query.trim() || f.outstandingOnly);
}

/* ── Sorting ────────────────────────────────────────────────────── */

export type LedgerSortKey = 'party' | 'campaign' | 'total' | 'paid' | 'outstanding' | 'state';
export interface LedgerSort { key: LedgerSortKey; dir: 'asc' | 'desc' }

/** Biggest debt first. It is the row somebody has to do something about. */
export const DEFAULT_LEDGER_SORT: LedgerSort = { key: 'outstanding', dir: 'desc' };

export function firstLedgerDir(key: LedgerSortKey): 'asc' | 'desc' {
  // Names read A→Z. Money reads biggest-first. And Status is not a magnitude
  // at all — clicking it means "show me the ones somebody has to deal with",
  // so it opens at the outstanding end rather than the settled one.
  if (key === 'party' || key === 'campaign') return 'asc';
  return 'desc';
}

export function nextLedgerSort(cur: LedgerSort, key: LedgerSortKey): LedgerSort {
  if (cur.key !== key) return { key, dir: firstLedgerDir(key) };
  return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
}

export function sortLedger(rows: LedgerRow[], sort: LedgerSort): LedgerRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const text = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return [...rows].sort((a, b) => {
    let c = 0;
    switch (sort.key) {
      case 'party':       c = text(a.party, b.party); break;
      case 'campaign':    c = text(a.campaign, b.campaign); break;
      case 'total':       c = a.total - b.total; break;
      case 'paid':        c = a.paid - b.paid; break;
      case 'outstanding': c = a.outstanding - b.outstanding; break;
      case 'state':       c = PAY_KEYS.indexOf(a.state) - PAY_KEYS.indexOf(b.state); break;
    }
    if (c !== 0) return c * dir;
    // Stable between refreshes.
    return text(a.party, b.party) || text(a.campaign, b.campaign);
  });
}

/* ── Words ──────────────────────────────────────────────────────── */

export function money(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(2))}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function trim(s: string): string {
  return s.replace(/\.?0+$/, '');
}

/**
 * The margin rate — the number the Data view never had.
 *
 * `Est AQ gross` was only ever an absolute, and an absolute goes up whenever
 * we do more work. The rate says whether the work was worth doing.
 *
 * Null rather than zero when nothing was billed: a rate on no revenue is not
 * 0%, it is a question with no answer, and printing "0.0%" makes an empty
 * workspace look like a disaster.
 */
export function marginRate(price: number, net: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  return ((price - net) / price) * 100;
}

export function ratePct(v: number | null, dp = 1): string {
  if (v == null) return '—';
  return `${v.toFixed(dp)}%`;
}

/** The line under the ledger's title: what it holds and what is still owed. */
export function ledgerLine(totals: LedgerTotals, side: Side): string {
  if (totals.rows === 0) {
    return side === 'clients'
      ? 'Nothing billed in this period.'
      : 'No vendor bookings with a recorded cost in this period.';
  }
  const of = side === 'clients' ? 'billed' : 'booked';
  if (totals.outstanding <= 0) {
    return `SAR ${money(totals.total)} ${of}, all settled.`;
  }
  const verb = side === 'clients' ? 'receivable' : 'payable';
  return `SAR ${money(totals.total)} ${of} · SAR ${money(totals.outstanding)} ${verb}.`;
}

export function emptyLedgerMessage(f: LedgerFilter, side: Side, total: number): string {
  if (total === 0) {
    return side === 'clients'
      ? 'No campaigns with a price in this window.'
      : 'No vendor bookings with a recorded cost in this period.';
  }
  if (f.query.trim()) return `Nothing matches “${f.query.trim()}”.`;
  if (f.state === 'paid') return side === 'clients' ? 'Nothing is fully paid yet.' : 'No vendor has been paid in full yet.';
  if (f.state === 'partial') return 'Nothing is partly paid.';
  if (f.state === 'unpaid') {
    return side === 'clients'
      ? 'Every client here has paid something. '
      : 'Every vendor here has been paid something.';
  }
  if (f.outstandingOnly) return 'Every balance here is settled.';
  return 'Nothing matches these filters.';
}

/* ── As a file ──────────────────────────────────────────────────── */

export const LEDGER_COLUMNS: { key: LedgerSortKey; label: (s: Side) => string; align: 'left' | 'right' }[] = [
  { key: 'party',       label: (s) => (s === 'clients' ? 'Client' : 'Vendor'), align: 'left' },
  { key: 'campaign',    label: () => 'Campaign', align: 'left' },
  { key: 'state',       label: () => 'Status', align: 'left' },
  { key: 'total',       label: (s) => (s === 'clients' ? 'Billed (SAR)' : 'Booked (SAR)'), align: 'right' },
  { key: 'paid',        label: () => 'Paid (SAR)', align: 'right' },
  { key: 'outstanding', label: () => 'Balance due (SAR)', align: 'right' },
];

/**
 * Whatever is on screen is what downloads — same rows, same filter, same
 * order. A download that quietly ignored the filters would be worse than no
 * download, because the numbers would look authoritative and be wrong.
 */
export function ledgerCsv(rows: LedgerRow[], side: Side): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = LEDGER_COLUMNS.map((c) => esc(c.label(side)));
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      esc(r.party), esc(r.campaign), esc(r.stateLabel),
      // Unformatted, so Excel reads them as numbers rather than as text.
      String(r.total), String(r.paid), String(r.outstanding),
    ].join(','));
  }
  return lines.join('\r\n');
}
