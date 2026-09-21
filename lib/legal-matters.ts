/**
 * The Legal Registry's rules, kept pure.
 *
 * Siraj: "I need the legal registry to keep law suits and cases and problems
 * that could arise and become law suits from the app in one place and statuses
 * and a log", and "any cases or law suits need to be logged and followed
 * through until won or loss".
 *
 * -- THE PROBLEMS ARE DERIVED, NOT STORED ----------------------------
 *
 * Who owes what is already answered by lib/money-ledger.ts, including the rule
 * that only COMPLETED campaigns are money owed. Materialising that into rows
 * would need a cron, a second definition of "overdue", and would give two
 * numbers that disagree by Tuesday. So the screen derives its warnings from
 * the ledger on every load, and a legal.matter row exists only once somebody
 * acts on one - see supabase/migrations/113_legal_matters.sql.
 *
 * This file is the join between the two: it turns ledger rows into warnings,
 * hides the ones a matter already covers, and says how a matter reads.
 */
// Relative, not '@/lib/...': scripts/run-tests.mjs compiles lib/*.ts with
// bare tsc and no tsconfig, so the path alias does not exist there.
import type { LedgerRow } from './money-ledger';

/** Which side of the money a matter is about. */
export type MatterSide = 'client' | 'vendor';

/* -- statuses ---------------------------------------------------------- */

export type MatterStatus =
  | 'open' | 'warned' | 'escalated' | 'filed'
  | 'won' | 'lost' | 'settled' | 'dropped';

/**
 * The ladder, in the order a matter climbs it. `closed` is what decides
 * whether it leaves the working list, and it is a property of the status
 * rather than a second column, because two columns drift (see the audit's B10
 * on `status` and `stage`).
 */
export const MATTER_STATUSES: {
  key: MatterStatus; label: string; badge: string; closed: boolean;
}[] = [
  { key: 'open', label: 'Open', badge: 'aq-badge-warning', closed: false },
  { key: 'warned', label: 'Warned', badge: 'aq-badge-warning', closed: false },
  { key: 'escalated', label: 'Escalated', badge: 'aq-badge-error', closed: false },
  { key: 'filed', label: 'Lawsuit filed', badge: 'aq-badge-error', closed: false },
  { key: 'won', label: 'Won', badge: 'aq-badge-success', closed: true },
  { key: 'settled', label: 'Settled', badge: 'aq-badge-success', closed: true },
  { key: 'lost', label: 'Lost', badge: 'aq-badge-muted', closed: true },
  { key: 'dropped', label: 'Dropped', badge: 'aq-badge-muted', closed: true },
];

const BY_STATUS = new Map(MATTER_STATUSES.map((s) => [s.key, s]));

export function matterStatusLabel(s: string | null | undefined): string {
  return BY_STATUS.get(String(s) as MatterStatus)?.label ?? 'Open';
}
export function matterStatusBadge(s: string | null | undefined): string {
  return BY_STATUS.get(String(s) as MatterStatus)?.badge ?? 'aq-badge-warning';
}
/** True once it is won, lost, settled or dropped. */
export function matterClosed(s: string | null | undefined): boolean {
  return BY_STATUS.get(String(s) as MatterStatus)?.closed ?? false;
}
/** The statuses a matter can still move to. A closed one can be reopened. */
export function nextStatuses(s: string | null | undefined): MatterStatus[] {
  return MATTER_STATUSES.filter((x) => x.key !== s).map((x) => x.key);
}

/* -- what a matter is about -------------------------------------------- */

export const MATTER_KINDS: { key: string; label: string }[] = [
  { key: 'client_unpaid', label: 'Client has not paid' },
  { key: 'vendor_unpaid', label: 'Vendor not paid' },
  { key: 'breach', label: 'Breach of contract' },
  { key: 'content', label: 'Content or rights' },
  { key: 'other', label: 'Other' },
];

export function matterKindLabel(k: string | null | undefined): string {
  return MATTER_KINDS.find((x) => x.key === k)?.label ?? 'Other';
}

/** The log entry kinds a person can write. `status` is the trigger's, not theirs. */
export const EVENT_KINDS: { key: string; label: string }[] = [
  { key: 'note', label: 'Note' },
  { key: 'warning', label: 'Warning sent' },
  { key: 'call', label: 'Call' },
  { key: 'email', label: 'Email' },
  { key: 'letter', label: 'Letter' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'filed', label: 'Filed' },
  { key: 'hearing', label: 'Hearing' },
  { key: 'payment', label: 'Payment received' },
];

export function eventKindLabel(k: string | null | undefined): string {
  if (k === 'status') return 'Status';
  return EVENT_KINDS.find((x) => x.key === k)?.label ?? 'Note';
}

/* -- the problems, derived from the ledger ----------------------------- */

/**
 * A problem the app noticed. NOT a row in any table - see the header.
 */
export interface MatterWarning {
  /** Stable per task per side; what stops the same problem being raised twice. */
  sourceKey: string;
  side: MatterSide;
  /** The client or the vendor, as the ledger names them. */
  party: string;
  campaign: string;
  /** The task to open, and what a matter raised from this links to. */
  taskId: string;
  /** The party's own record, when the task names one. */
  clientId: string | null;
  vendorId: number | null;
  /** What is outstanding on completed work. */
  amount: number;
  daysLate: number;
  due: string | null;
  /** A matter already covers this, so it is shown as handled rather than offered. */
  handled: boolean;
}

/**
 * The key a matter carries when it was raised from a warning.
 *
 * Deliberately NOT including the amount or the date: the same dispute is the
 * same dispute next week when another 5,000 has aged into it, and a key that
 * moved would offer the problem again beside the matter already handling it.
 */
export function warningSourceKey(side: MatterSide, taskId: string): string {
  return `${side}:${String(taskId ?? '').trim()}`;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Overdue money on completed work, worst first.
 *
 * Only rows the ledger already calls overdue, and only with something actually
 * outstanding: a campaign that is late but paid is not a problem, and one that
 * is unpaid but not yet due is not either. Both of those rules live in
 * money-ledger and are read here rather than restated.
 *
 * `handled` keys mark warnings a matter already covers. They are kept in the
 * list rather than dropped, because "we are dealing with that one" is the
 * thing legal most wants to see beside the ones nobody has touched. Pure.
 */
export function matterWarnings(input: {
  rows: LedgerRow[];
  side: MatterSide;
  /** Task id -> the party ids on that task, so a matter links to the record. */
  party?: Map<string, { clientId?: string | null; vendorId?: number | null }>;
  /** Source keys that already have a matter. */
  handled?: Set<string>;
}): MatterWarning[] {
  const out: MatterWarning[] = [];
  for (const r of input.rows ?? []) {
    if (!r?.overdue) continue;
    const amount = num(r.outstanding);
    if (amount <= 0) continue;
    const taskId = String(r.id ?? '');
    if (!taskId) continue;
    const p = input.party?.get(taskId);
    const key = warningSourceKey(input.side, taskId);
    out.push({
      sourceKey: key,
      side: input.side,
      party: String(r.party ?? '').trim(),
      campaign: String(r.campaign ?? '').trim(),
      taskId,
      clientId: p?.clientId ?? null,
      vendorId: p?.vendorId ?? null,
      amount,
      daysLate: Math.max(0, Math.round(num(r.daysLate))),
      due: r.due ?? null,
      handled: input.handled?.has(key) ?? false,
    });
  }
  // Worst first: longest overdue, then largest. A stable tiebreak on the key
  // so two identical rows do not swap places between renders.
  out.sort((a, b) => (b.daysLate - a.daysLate)
    || (b.amount - a.amount)
    || a.sourceKey.localeCompare(b.sourceKey));
  return out;
}

/** How many still need somebody to act. */
export function unhandledCount(ws: MatterWarning[]): number {
  return ws.filter((w) => !w.handled).length;
}

/**
 * One line for the warnings strip.
 *
 * Siraj's rule: name the slice with the number. "Overdue" alone invites the
 * question this answers - overdue on what, by whose count.
 */
export function warningsLine(ws: MatterWarning[], side: MatterSide): string {
  const open = ws.filter((w) => !w.handled);
  if (ws.length === 0) {
    return side === 'client'
      ? 'Nothing overdue on completed campaigns.'
      : 'No unpaid vendors on completed campaigns.';
  }
  const total = open.reduce((s, w) => s + w.amount, 0);
  const who = side === 'client' ? 'client' : 'vendor';
  const n = open.length;
  if (n === 0) return `${ws.length} overdue, all with a matter open.`;
  const money = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n} ${who}${n === 1 ? '' : 's'} overdue on completed campaigns, ${money} outstanding`
    + (ws.length > n ? ` (${ws.length - n} already a matter)` : '');
}

/* -- how a matter reads ------------------------------------------------ */

export interface MatterLite {
  id: string;
  title: string;
  party_type: string;
  party_name: string;
  kind: string;
  status: string;
  amount?: number | string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  source_key?: string | null;
}

/**
 * Open matters first and worst-first within them; closed ones after, most
 * recently closed first. A closed matter is history and history goes last, but
 * it does not go away - "followed through until won or loss" means the ones
 * that finished are still on the screen that proves it. Pure.
 */
export function sortMatters(ms: MatterLite[]): MatterLite[] {
  return [...ms].sort((a, b) => {
    const ca = matterClosed(a.status), cb = matterClosed(b.status);
    if (ca !== cb) return ca ? 1 : -1;
    if (!ca) {
      const d = num(b.amount) - num(a.amount);
      if (d) return d;
      return String(a.opened_at ?? '').localeCompare(String(b.opened_at ?? ''));
    }
    return String(b.closed_at ?? '').localeCompare(String(a.closed_at ?? ''));
  });
}

/** "3 open, 1 filed - 2 closed" for the section header. Pure. */
export function mattersLine(ms: MatterLite[]): string {
  if (ms.length === 0) return 'No matters yet.';
  const open = ms.filter((m) => !matterClosed(m.status));
  const filed = open.filter((m) => m.status === 'filed').length;
  const closed = ms.length - open.length;
  const parts: string[] = [];
  parts.push(`${open.length} open`);
  if (filed) parts.push(`${filed} in court`);
  const head = parts.join(', ');
  return closed ? `${head} - ${closed} closed` : head;
}

/* -- raising one by hand ----------------------------------------------- */

/**
 * Siraj: "i need a manual also entry like a legal crm."
 *
 * Everything above starts from something the ledger noticed, which only covers
 * money. A content dispute, a breach, a threat from somebody's lawyer - none
 * of those are a row in any ledger, and until there is a way to type one in,
 * the screen is a debt chaser rather than a registry.
 *
 * A hand-raised matter carries NO source key. That is the whole difference:
 * it was not derived from a warning, so it must never suppress one.
 */

export interface PartyOption {
  /** The client's uuid or the vendor's numeric id, as a string. */
  id: string;
  name: string;
}

/**
 * The parties worth offering for what has been typed so far.
 *
 * Capped, and the cap is the point: there are four thousand vendors after the
 * Asana import, and a select with four thousand options is a frozen tab. A
 * blank query offers the first few rather than nothing, so the box is useful
 * before anybody types.
 *
 * A name that STARTS with the query comes first: searching "sara" should find
 * Sara before Alsara Media. Pure.
 */
export function partySearch(
  query: string,
  options: PartyOption[],
  limit = 8,
): PartyOption[] {
  const q = String(query ?? '').trim().toLowerCase();
  const list = options ?? [];
  if (!q) return list.slice(0, Math.max(0, limit));
  const hits: { o: PartyOption; rank: number }[] = [];
  for (const o of list) {
    const n = String(o?.name ?? '').toLowerCase();
    if (!n) continue;
    const at = n.indexOf(q);
    if (at < 0) continue;
    hits.push({ o, rank: at === 0 ? 0 : 1 });
  }
  hits.sort((a, b) => (a.rank - b.rank)
    || a.o.name.localeCompare(b.o.name)
    || String(a.o.id).localeCompare(String(b.o.id)));
  return hits.slice(0, Math.max(0, limit)).map((h) => h.o);
}

export interface NewMatterDraft {
  partyName: string;
  /** Null when the party is typed rather than picked - which is allowed. */
  partyId: string | null;
  title: string;
  kind: string;
  /** As typed. Blank means "not about a specific amount", which is fine. */
  amount: string;
}

/**
 * What is stopping this being saved, in the order somebody would fix it.
 *
 * Returned as a list rather than a boolean so the form can say what is wrong
 * instead of just refusing, and so the rules are testable without a browser.
 * An empty list means it can be saved. Pure.
 */
export function newMatterProblems(d: NewMatterDraft): string[] {
  const out: string[] = [];
  if (!String(d?.partyName ?? '').trim()) out.push('Name the other side.');
  if (!String(d?.title ?? '').trim()) out.push('Give the matter a title.');
  if (!MATTER_KINDS.some((k) => k.key === d?.kind)) out.push('Pick what it is about.');
  const raw = String(d?.amount ?? '').trim();
  if (raw) {
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) out.push('The amount is not a number.');
    else if (n < 0) out.push('The amount cannot be negative.');
  }
  return out;
}

/** The typed amount as a number, or null when it was left blank. Pure. */
export function parseMatterAmount(amount: string): number | null {
  const raw = String(amount ?? '').trim().replace(/,/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A title that is already right most of the time, so the field starts filled
 * rather than empty. Still editable - it is a suggestion, not a format. Pure.
 */
export function defaultMatterTitle(partyName: string, kind: string): string {
  const who = String(partyName ?? '').trim();
  const what = matterKindLabel(kind);
  if (!who) return what;
  return `${who} - ${what}`;
}

/**
 * The matters matching a search box, over every field somebody would type:
 * the title, the party, and what it is about by its LABEL rather than its key,
 * because nobody searches for "client_unpaid". Order is not changed - the
 * caller has already sorted, and re-ranking search results would move a matter
 * away from where it was a moment ago. Pure.
 */
export function searchMatters<T extends MatterLite>(query: string, ms: T[]): T[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return ms ?? [];
  return (ms ?? []).filter((m) => {
    const hay = `${m.title ?? ''} ${m.party_name ?? ''} `
      + `${matterKindLabel(m.kind)} ${matterStatusLabel(m.status)}`;
    return hay.toLowerCase().includes(q);
  });
}

/* -- what legal is asked at a glance ------------------------------------ */

/**
 * Siraj: "you need a dashboard to understand the kpi", and, asked where it
 * belongs: "no it should be within the cases log."
 *
 * So there is no second dashboard. The Cases screen already knows what is
 * owed and what is being chased; these are the four numbers that were missing
 * beside them - how many contracts went out, how many came back, what is
 * still a draft, and what got cancelled.
 *
 * A KPI here is a COUNT OF ROWS, not a rate or a trend. A rate needs a period
 * and a denominator, and every one of those is an argument waiting to happen
 * ("issued this month" - by issue date or by campaign date?). A count of
 * contracts by status is the same number however you ask it.
 */
export interface LegalKpi {
  key: string;
  label: string;
  value: number;
  /** A line under the number, when the number alone would mislead. */
  note: string;
  tone: 'plain' | 'good' | 'warn' | 'bad';
}

/** One contract, as the KPI count reads it. */
export interface ContractLite { status: string }

/**
 * The strip across the top of Cases.
 *
 * `signed` is shown even while it is always zero, and says so. Nothing in the
 * app sets legal.contract.status to 'signed' yet - the column has allowed it
 * since migration 100 and no code has ever written it. A KPI that is missing
 * from the screen looks like a number nobody needs; a KPI that reads "0, not
 * tracked yet" is a piece of work somebody can see is outstanding. Pure.
 */
export function legalKpis(input: {
  contracts: ContractLite[];
  matters: MatterLite[];
  /** Unhandled warnings across both sides - what nobody has acted on. */
  unhandled: number;
}): LegalKpi[] {
  const by = (s: string) => (input.contracts ?? []).filter(
    (c) => String(c?.status ?? '').toLowerCase() === s).length;
  const issued = by('issued');
  const signed = by('signed');
  const draft = by('draft');
  const open = (input.matters ?? []).filter((m) => !matterClosed(m.status));
  const filed = open.filter((m) => m.status === 'filed').length;

  return [
    {
      key: 'issued', label: 'Contracts issued', value: issued, tone: 'plain',
      note: draft ? `${draft} still a draft` : 'none waiting as a draft',
    },
    {
      key: 'signed', label: 'Signed', value: signed, tone: signed ? 'good' : 'plain',
      // Said out loud rather than hidden: the number is right, the tracking is
      // what is missing.
      note: signed === 0 && issued > 0 ? 'not tracked yet - signing is not built' : 'returned and recorded',
    },
    {
      key: 'disputes', label: 'Open disputes', value: open.length,
      tone: filed ? 'bad' : open.length ? 'warn' : 'good',
      note: filed ? `${filed} in court` : open.length ? 'none in court' : 'nothing open',
    },
    {
      key: 'unchased', label: 'Overdue, nobody on it', value: Math.max(0, input.unhandled),
      tone: input.unhandled ? 'warn' : 'good',
      note: input.unhandled ? 'no matter raised yet' : 'all overdue money is being chased',
    },
  ];
}

/** The badge class for a KPI's tone, so the screen holds no colour logic. */
export function kpiBadge(tone: LegalKpi['tone']): string {
  return tone === 'bad' ? 'aq-badge-error'
    : tone === 'warn' ? 'aq-badge-warning'
      : tone === 'good' ? 'aq-badge-success' : 'aq-badge-muted';
}
