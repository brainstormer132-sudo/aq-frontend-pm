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
import { signedTally } from './legal-signed';

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

/* -- collection, and everything else ----------------------------------- */

/**
 * Which kinds are COLLECTION: money somebody owes us and has not paid.
 *
 * Siraj's job description gives legal three things to count, and two of them
 * are answered out of this one table:
 *
 *   2. how much clients Im handling their collection case
 *   3. how many legal cases Im handling
 *
 * If a matter could be both, those two numbers would add up to more work than
 * exists, and the sheet they go on would be wrong in the direction that
 * flatters. So a matter is one or the other, never both, and collection plus
 * cases equals the number of open matters exactly - which is a property the
 * suite checks rather than a claim in a comment.
 *
 * `client_unpaid` only. A VENDOR we have not paid is money going out, so it
 * is not collection by any reading of the word - it is a dispute somebody
 * has with us, which is a case she manages. Collection is what comes in.
 */
export const COLLECTION_KINDS: string[] = ['client_unpaid'];

export function isCollectionMatter(m: { kind?: string | null }): boolean {
  return COLLECTION_KINDS.includes(String(m?.kind ?? ''));
}

export interface MatterSplit<T> {
  collection: T[];
  cases: T[];
}

/**
 * The two checklists, from one pass. Order inside each is whatever order came
 * in, so the caller sorts once and splits after. Pure.
 */
export function splitMatters<T extends MatterLite>(ms: T[]): MatterSplit<T> {
  const collection: T[] = [];
  const cases: T[] = [];
  for (const m of ms ?? []) {
    if (isCollectionMatter(m)) collection.push(m); else cases.push(m);
  }
  return { collection, cases };
}

/**
 * How many different people these matters are against.
 *
 * Siraj asked for the collection number "both, side by side" - four clients,
 * nine cases - because one client can owe on five campaigns and five rows is
 * not five clients.
 *
 * Keyed on the party's ID where the matter carries one, and on the NAME where
 * it does not, because a matter whose client record was deleted still names
 * them (113 snapshots party_name for exactly this reason). A name that an
 * id-carrying matter already covers is folded into it, so one linked and one
 * typed matter against the same client count as one client rather than two.
 *
 * The one case it gets wrong is a client renamed between two matters with no
 * id on either, which reads as two. That is the safe direction for a number
 * somebody is about to chase. Pure.
 */
export function distinctParties(ms: MatterLite[]): number {
  const byId = new Map<string, string>();
  const byName = new Set<string>();
  for (const m of ms ?? []) {
    const name = String(m?.party_name ?? '').trim().toLowerCase();
    const id = String(m?.party_type ?? '') === 'vendor'
      ? (m?.vendor_id === null || m?.vendor_id === undefined ? '' : `v:${m.vendor_id}`)
      : (m?.client_id ? `c:${m.client_id}` : '');
    if (id) byId.set(id, name);
    else if (name) byName.add(name);
  }
  for (const n of byId.values()) byName.delete(n);
  return byId.size + byName.size;
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
  // Both nullable and both optional: 113 sets them ON DELETE SET NULL so a
  // matter outlives the record it was against, and party_name still names
  // them. distinctParties reads these first and falls back to the name.
  client_id?: string | null;
  vendor_id?: number | null;
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
 * owed and what is being chased; these are the numbers that were missing
 * beside them. They are HIS list, written out with the job description:
 *
 *   1. how many legal documents issued   -> issued, and signed beside it
 *   2. how much clients Im handling their collection case -> collection
 *   3. how many legal cases Im handling  -> cases
 *
 * plus the one that says what to do next: overdue money nobody has raised a
 * matter for.
 *
 * -- TWO THINGS THAT WERE WRONG BEFORE -------------------------------
 *
 * ONE NUMBER FOR TWO QUESTIONS. There used to be a single "Open disputes"
 * counting every open matter. His 2 and 3 both come out of that table, so
 * every unpaid client was in both answers and the two KPIs summed to more
 * work than exists. They are split on the kind now, and the suite checks that
 * the two counts add back up to the open matters exactly.
 *
 * "ISSUED" WENT DOWN WHEN A CONTRACT CAME BACK. It counted status='issued'
 * only, which was a fine proxy right up until 117 made `signed` a status the
 * app actually writes - after which filing the counterpart moved a contract
 * out of the issued count. Three contracts out, all three signed, and the
 * answer to "how many documents issued" read ZERO. It now uses signedTally,
 * the same definition the Signatures screen counts with, so the two screens
 * cannot disagree.
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
  /** What the value counts, when the label does not already say. */
  unit?: string;
  /**
   * A second number beside the first - "4 clients / 9 cases". Siraj, asked
   * whether collection should count clients or cases: "Both, side by side."
   * One of them alone is a half-answer, and which half depends on whether
   * you are asking how much work it is or how many people to call.
   */
  second?: { value: number; label: string };
  /** A line under the number, when the number alone would mislead. */
  note: string;
  tone: 'plain' | 'good' | 'warn' | 'bad';
}

/** One contract, as the KPI count reads it. */
export interface ContractLite { status: string }

/**
 * The strip across the top of Cases.
 *
 * Counted over EVERYTHING, never over the tab that happens to be showing: a
 * number that changes when you press a tab is a number nobody trusts.
 *
 * A VOID contract is in no count. It was issued and then pulled, and adding
 * it back to "documents issued" would make the number go up when a document
 * is cancelled. Pure.
 */
export function legalKpis(input: {
  contracts: ContractLite[];
  matters: MatterLite[];
  /** Unhandled warnings across both sides - what nobody has acted on. */
  unhandled: number;
}): LegalKpi[] {
  const draft = (input.contracts ?? []).filter(
    (c) => String(c?.status ?? '').toLowerCase() === 'draft').length;
  // ONE definition, shared with the Signatures screen. `issued` counts the
  // signed ones too, because a signed contract was issued - see the header.
  const { issued, signed, awaiting } = signedTally(input.contracts ?? []);

  const open = (input.matters ?? []).filter((m) => !matterClosed(m.status));
  const { collection, cases } = splitMatters(open);
  const filed = cases.filter((m) => m.status === 'filed').length;
  const clients = distinctParties(collection);

  return [
    {
      key: 'issued', label: 'Documents issued', value: issued, tone: 'plain',
      note: draft ? `${draft} still a draft` : 'none waiting as a draft',
    },
    {
      key: 'signed', label: 'Signed', value: signed, tone: signed ? 'good' : 'plain',
      note: awaiting ? `${awaiting} still out`
        : issued ? 'all of them came back' : 'nothing issued yet',
    },
    {
      key: 'collection', label: 'Collection', value: clients,
      unit: clients === 1 ? 'client' : 'clients',
      second: {
        value: collection.length,
        label: collection.length === 1 ? 'case' : 'cases',
      },
      tone: collection.length ? 'warn' : 'good',
      // Named with the slice, per his own rule. "Collection: 4" invites the
      // question this answers - four of what, on which side of the money.
      note: collection.length ? 'clients who have not paid' : 'nobody owes us on an open matter',
    },
    {
      key: 'cases', label: 'Legal cases', value: cases.length,
      tone: filed ? 'bad' : cases.length ? 'warn' : 'good',
      // Everything that is not somebody owing us: a breach, a rights
      // dispute, a vendor chasing US. Said here because "cases" on its own
      // sounds like it should include the collection ones.
      note: filed ? `${filed} in court` : cases.length ? 'none in court' : 'nothing open',
    },
    {
      key: 'unchased', label: 'Overdue, nobody on it', value: Math.max(0, input.unhandled),
      tone: input.unhandled ? 'warn' : 'good',
      // Not a subset of Collection and not an overlap with it: these are
      // overdue campaigns with NO matter raised. The moment one is raised it
      // leaves this number and joins that one.
      note: input.unhandled ? 'overdue with no matter raised' : 'all overdue money is being chased',
    },
  ];
}

/** The badge class for a KPI's tone, so the screen holds no colour logic. */
export function kpiBadge(tone: LegalKpi['tone']): string {
  return tone === 'bad' ? 'aq-badge-error'
    : tone === 'warn' ? 'aq-badge-warning'
      : tone === 'good' ? 'aq-badge-success' : 'aq-badge-muted';
}

/**
 * What the screen says before it deletes a matter.
 *
 * Siraj, on the native dialogs: "fix it". `confirm('Delete this matter and
 * its whole log?')` names nothing - on a screen with four matters that is not
 * a question anybody can answer - and a dialog asked the same way every time
 * trains people to click through it.
 *
 * So: the matter's own title, who it is against, and the one consequence that
 * is not obvious - the event log goes with it. A matter's log is the record of
 * what was said and when, which is the part somebody would actually miss.
 *
 * Pure. Returns a sentence, never an empty string, because a confirmation
 * with no words in it is worse than the dialog it replaces.
 */
export function matterDeleteWarning(
  m: { title?: string | null; party_name?: string | null } | null | undefined,
  events?: number | null,
): string {
  const title = String(m?.title ?? '').trim();
  const party = String(m?.party_name ?? '').trim();
  const named = title ? `"${title}"` : 'this matter';
  const against = party ? ` against ${party}` : '';
  const n = Math.max(0, Math.trunc(Number(events ?? 0)));
  const log = n > 0
    ? ` Its ${n} log entr${n === 1 ? 'y' : 'ies'} go with it.`
    : ' Its whole log goes with it.';
  return `Delete ${named}${against}?${log} This cannot be undone.`;
}
