/**
 * What the CRM should be told when something happens in the PM app.
 *
 * The CRM's three tables (crm_activities, crm_deals, crm_tasks) used to be
 * written to by exactly one thing: a person typing into the CRM screen. So a
 * client's timeline showed the calls somebody remembered to log and nothing
 * about the eleven campaigns we actually ran for them. This file is the
 * bridge — it decides whether an event is worth logging and what it should
 * say; `use-workflow` does the writing.
 *
 * Everything here is pure: no React, no Supabase, no `new Date()` without an
 * argument. That is what makes the wording and, more importantly, the
 * "should this log at all?" rules testable, which matters because the
 * failure mode of a chatty logger is a timeline nobody reads.
 *
 * Two rules run through all of it:
 *
 *   1. No client, no entry. An activity is attached to a client or vendor;
 *      a campaign with no `client_id` has nowhere to hang one, and inventing
 *      a target would put a stranger's campaign on somebody's timeline.
 *   2. Nothing unchanged gets logged. Saving a form re-sends every field, so
 *      without a from/to comparison a timeline fills with "contract status:
 *      signed" ten times over — which is how a log becomes noise and then
 *      becomes ignored.
 */

export type ActivityKind = 'note' | 'call' | 'meeting' | 'email' | 'status_change';

export interface LoggedActivity {
  kind: ActivityKind;
  body: string;
}

/** The bits of a campaign row this file needs. PMTask satisfies it. */
export interface CampaignRef {
  id: string;
  task_name: string | null;
  title: string | null;
  brand_name: string | null;
  client_id: string | null;
}

export interface DealRef {
  name: string;
  value: number | null;
  currency_code?: string | null;
}

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function norm(v: string | null | undefined): string {
  return txt(v).toLowerCase();
}

/** "Ramadan 2026" — with the brand only when it adds something. */
export function campaignLabel(c: CampaignRef): string {
  const name = txt(c.task_name) || txt(c.title) || 'Untitled campaign';
  const brand = txt(c.brand_name);
  return brand && norm(brand) !== norm(name) ? `${name} (${brand})` : name;
}

/** snake_case → Sentence case, for statuses that have no friendlier label. */
function pretty(value: string): string {
  const s = txt(value).replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const CONTRACT_LABELS: Record<string, string> = {
  no_contract: 'No contract',
  po: 'PO',
  pending: 'Pending',
  on_process: 'On process',
  done: 'Done',
  signed_attached: 'Signed & attached',
};

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Pending',
  partial: 'Partial',
  paid: 'Paid',
};

export function contractLabel(value: string | null | undefined): string {
  const key = norm(value);
  return CONTRACT_LABELS[key] ?? pretty(value ?? '');
}

export function paymentLabel(value: string | null | undefined): string {
  const key = norm(value);
  return PAYMENT_LABELS[key] ?? pretty(value ?? '');
}

/** SAR 184,500 — grouped, no decimals, because these are whole riyals. */
export function money(amount: number | null | undefined, currency = 'SAR'): string | null {
  if (amount == null) return null;
  const n = Number(amount);
  if (!Number.isFinite(n) || n === 0) return null;
  return `${currency} ${Math.round(n).toLocaleString('en-US')}`;
}

/* ────────────────────────────────────────────────────────────────
   The events
   ──────────────────────────────────────────────────────────────── */

export function onCampaignCreated(c: CampaignRef): LoggedActivity | null {
  if (!txt(c.client_id)) return null;
  return { kind: 'status_change', body: `Campaign created — ${campaignLabel(c)}` };
}

export function onCampaignCompleted(c: CampaignRef): LoggedActivity | null {
  if (!txt(c.client_id)) return null;
  return { kind: 'status_change', body: `Campaign completed — ${campaignLabel(c)}` };
}

/**
 * Contract status moved.
 *
 * Reaching signed is the event people care about, so it gets its own
 * sentence. Every other real move is still logged, plainly, because "it went
 * back to pending" is exactly the kind of thing somebody later swears never
 * happened.
 */
export function onContractStatusChanged(
  c: CampaignRef,
  from: string | null | undefined,
  to: string | null | undefined,
): LoggedActivity | null {
  if (!txt(c.client_id)) return null;
  if (!txt(to)) return null;
  if (norm(from) === norm(to)) return null;

  const signed = norm(to) === 'signed_attached' || norm(to) === 'done';
  const body = signed
    ? `Contract signed — ${campaignLabel(c)}`
    : `Contract status → ${contractLabel(to)} — ${campaignLabel(c)}`;
  return { kind: 'status_change', body };
}

/**
 * Client payment status moved.
 *
 * The amount is included when we have one, because "paid" without a figure
 * sends whoever reads it back to the campaign to find out how much.
 */
export function onClientPaymentChanged(
  c: CampaignRef,
  from: string | null | undefined,
  to: string | null | undefined,
  amount?: number | null,
): LoggedActivity | null {
  if (!txt(c.client_id)) return null;
  if (!txt(to)) return null;
  if (norm(from) === norm(to)) return null;

  const sum = money(amount);
  const head = `Client payment → ${paymentLabel(to)}`;
  const body = sum
    ? `${head} (${sum}) — ${campaignLabel(c)}`
    : `${head} — ${campaignLabel(c)}`;
  return { kind: 'status_change', body };
}

export function onDealWon(deal: DealRef): LoggedActivity {
  const sum = money(deal.value, txt(deal.currency_code) || 'SAR');
  const name = txt(deal.name) || 'Untitled deal';
  return {
    kind: 'status_change',
    body: sum ? `Deal won — ${name} (${sum})` : `Deal won — ${name}`,
  };
}

export function onDealLost(deal: DealRef): LoggedActivity {
  const name = txt(deal.name) || 'Untitled deal';
  return { kind: 'status_change', body: `Deal lost — ${name}` };
}

/* ────────────────────────────────────────────────────────────────
   Won deal → campaign

   Winning a deal does NOT write a campaign by itself. It fills the New
   Task form in and hands it to a person: a deal is dragged with a mouse,
   and a mis-drag that silently creates a real campaign for a real client
   is a worse failure than one extra click.
   ──────────────────────────────────────────────────────────────── */

export interface CampaignPrefill {
  task_name: string;
  client_id: string | null;
  budget: number | null;
  details: string;
}

export function prefillFromDeal(deal: {
  name: string;
  value: number | null;
  target_type: string | null;
  target_id: string | null;
  notes?: string | null;
}): CampaignPrefill {
  const isClient = norm(deal.target_type) === 'client' && txt(deal.target_id);
  const notes = txt(deal.notes);
  return {
    task_name: txt(deal.name),
    client_id: isClient ? txt(deal.target_id) : null,
    budget: deal.value != null && Number.isFinite(Number(deal.value)) && Number(deal.value) > 0
      ? Number(deal.value)
      : null,
    details: notes ? `From won deal “${txt(deal.name)}”.\n\n${notes}` : `From won deal “${txt(deal.name)}”.`,
  };
}

/* ────────────────────────────────────────────────────────────────
   Follow-ups

   CRM tasks were invisible outside the CRM screen, which made them a
   promise to yourself that nothing ever reminded you of.
   ──────────────────────────────────────────────────────────────── */

export type Urgency = 'overdue' | 'today' | 'later' | 'none';

/** `todayISO` is passed in — this file never asks what day it is. */
export function followUpUrgency(
  dueAt: string | null | undefined,
  todayISO: string,
  completedAt?: string | null,
): Urgency {
  if (txt(completedAt)) return 'none';
  const day = txt(dueAt).slice(0, 10);
  if (!day) return 'none';
  if (day < todayISO) return 'overdue';
  if (day === todayISO) return 'today';
  return 'later';
}

export function countFollowUps(
  items: { due_at: string | null; completed_at: string | null }[],
  todayISO: string,
): { overdue: number; today: number; open: number } {
  let overdue = 0, today = 0, open = 0;
  for (const t of items) {
    if (txt(t.completed_at)) continue;
    open += 1;
    const u = followUpUrgency(t.due_at, todayISO, t.completed_at);
    if (u === 'overdue') overdue += 1;
    else if (u === 'today') today += 1;
  }
  return { overdue, today, open };
}
