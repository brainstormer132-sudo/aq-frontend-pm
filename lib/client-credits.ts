/**
 * Client credits.
 *
 * The money ledger caps a recorded payment bigger than the bill, because a
 * per-row overpayment is usually a typo (money-ledger `clampPaid`). But a real
 * overpayment is money the client has with AQ. Siraj: surface it, let a person
 * confirm it into a credit, and log every change.
 *
 * This file is the pure half: add a client's logged entries into a balance,
 * and find the completed campaigns whose recorded payment is more than what
 * was billed, as SUGGESTIONS somebody confirms into a logged credit. Nothing
 * here writes, and nothing here turns an overpayment into a credit on its own.
 */
import { isComplete, isCancelled, type DashTask } from './dashboard-data';

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Round to the halala before comparing, so 0.004 is not a balance. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CreditEntry {
  client_id: string;
  /** Signed: positive is a grant, negative is the credit being used. */
  amount: unknown;
}

/** A client's current credit balance: the signed sum of their logged entries. */
export function creditBalance(entries: { amount: unknown }[]): number {
  return r2((entries ?? []).reduce((a, e) => a + num(e.amount), 0));
}

/** Balance per client id, from a flat list of entries. */
export function creditBalancesByClient(entries: CreditEntry[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries ?? []) {
    const k = String(e.client_id ?? '');
    if (!k) continue;
    out.set(k, r2((out.get(k) ?? 0) + num(e.amount)));
  }
  return out;
}

export interface OverpaymentCandidate {
  taskId: string;
  clientId: string | null;
  campaign: string;
  billed: number;
  recorded: number;
  /** recorded - billed, less any credit already logged against this campaign. */
  excess: number;
}

/**
 * Completed campaigns where the client's recorded payment is more than what
 * was billed.
 *
 * Same "billed" rule as the collection ledger: completed campaigns only,
 * cancelled bookings excluded, summed on price. The excess is netted against
 * any credit already logged with that campaign as its source, so the same
 * overpayment is never offered twice. Biggest first.
 */
export function overpaymentCandidates(input: {
  parents: DashTask[];
  subtasks: DashTask[];
  /** Credit already logged per source campaign: source_task_id -> sum of amounts. */
  creditedByTask?: Map<string, number>;
}): OverpaymentCandidate[] {
  const byParent = new Map<string, DashTask[]>();
  for (const s of input.subtasks ?? []) {
    if (!s.parent_task_id) continue;
    const list = byParent.get(s.parent_task_id) ?? [];
    list.push(s);
    byParent.set(s.parent_task_id, list);
  }

  const out: OverpaymentCandidate[] = [];
  for (const p of input.parents ?? []) {
    if (!isComplete(p)) continue;
    // Cancelled bookings billed nothing, so they must not inflate the bill and
    // make a normal payment look like an overpayment.
    const subs = (byParent.get(p.id) ?? []).filter((s) => !isCancelled(s));
    const billed = r2(subs.reduce((a, s) => a + num(s.price), 0));
    if (billed <= 0) continue;
    const recorded = r2(num(p.client_payment_amount));
    const raw = r2(recorded - billed);
    if (raw <= 0) continue;
    // Already captured as credit against this campaign? Do not offer it again.
    const already = Math.max(0, r2(input.creditedByTask?.get(p.id) ?? 0));
    const excess = r2(raw - already);
    if (excess <= 0) continue;
    out.push({
      taskId: p.id,
      clientId: p.client_id ?? null,
      campaign: (p.task_name || p.title || '').trim() || 'Untitled campaign',
      billed,
      recorded,
      excess,
    });
  }
  return out.sort((a, b) => b.excess - a.excess);
}
