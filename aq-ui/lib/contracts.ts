/**
 * Contracts — the register.
 *
 * The screen this replaces was four stacked cards of equal size — Pending,
 * Approved, Generated, Rejected — all always open, three of them usually
 * reading "None." Every pending row carried the same three buttons at the
 * same weight (Approve, Generate now, Reject), and an approved row carried
 * them again, Approve included. Nothing on the screen said what the next
 * move was, and nothing said how long anybody had been waiting.
 *
 * Two things it did that were worse than untidy:
 *
 *   • A **cancelled** request appeared nowhere. The status column has five
 *     values and the view rendered four, so a cancelled request read as a
 *     deleted one.
 *   • A generated contract's ID was printed as grey text with nothing to
 *     click. The file exists; the internal app has no route to it.
 *
 * All the deciding lives here — what a row says, what its next move is,
 * where it sorts, what a filter keeps — pure, with no React, no Supabase,
 * and no argless `new Date()`.
 */

/* ── Shapes ─────────────────────────────────────────────────────── */

export type ContractStatus = 'pending' | 'approved' | 'generated' | 'rejected' | 'cancelled';
export type ContractKind = 'client' | 'vendor';

/** A `contract_requests` row, as much of it as this screen reads. */
export interface RequestRow {
  id: string;
  pm_task_id?: string | null;
  request_kind?: string | null;
  status?: string | null;
  brand_name?: string | null;
  amount?: number | string | null;
  client_name?: string | null;
  vendor_name?: string | null;
  vendor_category?: string | null;
  template_key?: string | null;
  notes?: string | null;
  cr_number?: string | null;
  generated_contract_id?: string | null;
  generated_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  requested_by?: string | null;
  created_at?: string | null;
}

/** A `generated_contracts` row — the legacy table that holds the files. */
export interface GeneratedRow {
  contract_id: string;
  pdf_path?: string | null;
  docx_path?: string | null;
  pdf_error?: string | null;
}

export interface TaskLike {
  id: string;
  task_name?: string | null;
  title?: string | null;
  /** Set on a vendor booking. A contract request made from one points at the
   *  booking, not at the campaign — so the campaign is one hop up. */
  parent_task_id?: string | null;
}
export interface PersonLike { id: string; full_name?: string | null }

/** What the file behind a generated contract actually is. */
export type FileState = 'both' | 'docx_only' | 'missing' | 'unknown';

export interface ContractRow {
  id: string;
  /** Who the contract is with — the vendor, or the client. */
  party: string;
  kind: ContractKind;
  kindLabel: string;
  /** Videographer, Influencer… vendor rows only. */
  category: string | null;
  campaign: string | null;
  /** The campaign name came from a real task. False means it is the brand
   *  off the request, which is not the same thing and is not a link. */
  campaignKnown: boolean;
  status: ContractStatus;
  statusLabel: string;
  amount: number | null;
  /** Days since it was requested. Used for sorting, always present. */
  ageDays: number;
  /** "waiting 6 days" while it is waiting; "generated 4 Aug" once it is not. */
  ageLabel: string;
  /** Nobody has moved on it and somebody should. */
  waiting: boolean;
  /** Waiting longer than anybody should be waiting. */
  stale: boolean;
  contractId: string | null;
  file: FileState;
  /** The PDF conversion failed and the row should say so. */
  pdfError: string | null;
  taskId: string | null;
  raw: RequestRow;
}

/* ── Statuses ───────────────────────────────────────────────────── */

/**
 * In the order a request moves through. `cancelled` is last because it is
 * an ending, not a step — but it IS in the list, which is the whole point:
 * the old screen had five statuses in the database and four on the screen.
 */
export const STATUS_ORDER: ContractStatus[] = [
  'pending', 'approved', 'generated', 'rejected', 'cancelled',
];

const STATUS_LABELS: Record<ContractStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  generated: 'Generated',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function statusOf(raw: string | null | undefined): ContractStatus {
  const v = (raw ?? '').trim().toLowerCase();
  return (STATUS_ORDER as string[]).includes(v) ? (v as ContractStatus) : 'pending';
}

export function statusLabel(s: ContractStatus): string {
  return STATUS_LABELS[s];
}

/** Waiting on a person: nobody has approved, rejected or generated it. */
export function isWaiting(s: ContractStatus): boolean {
  return s === 'pending' || s === 'approved';
}

/**
 * Waiting long enough to be a problem.
 *
 * A vendor waiting on a contract is a vendor who has not been paid, and
 * nothing on the old screen said how long that had been going on. Four
 * working days is where it stops being "we're getting to it".
 */
export const STALE_DAYS = 4;

/* ── Dates ──────────────────────────────────────────────────────── */

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms / 86_400_000);
}

function isoDay(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const day = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 12 Aug · 18 Jul 2025. Built by hand — `toLocaleDateString()` gives the
 *  server and the browser different answers, which is a hydration error. */
export function shortDate(day: string | null, today: string): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const thisYear = Number(today.slice(0, 4));
  return `${d} ${MONTHS[(m || 1) - 1] ?? ''}${y === thisYear ? '' : ` ${y}`}`;
}

export function waitingLabel(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'waiting 1 day';
  return `waiting ${days} days`;
}

/* ── Building the rows ──────────────────────────────────────────── */

function txt(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** What the files behind a generated contract are. */
export function fileState(g: GeneratedRow | undefined): FileState {
  if (!g) return 'unknown';
  if (g.pdf_path) return 'both';
  if (g.docx_path) return 'docx_only';
  return 'missing';
}

export function buildRows(input: {
  requests: RequestRow[];
  generated?: GeneratedRow[];
  tasks?: TaskLike[];
  profiles?: PersonLike[];
}, today: string): ContractRow[] {
  const byContract = new Map<string, GeneratedRow>();
  for (const g of input.generated || []) byContract.set(g.contract_id, g);
  /**
   * The campaign a request belongs to.
   *
   * A vendor contract is requested from the vendor booking, so `pm_task_id`
   * is the booking's id and the campaign is its parent. Naming the row after
   * the booking would give a register full of vendor names twice over.
   */
  const tasks = input.tasks || [];
  const find = (id: string | null | undefined) => (id ? tasks.find((x) => x.id === id) : undefined);
  const label = (t: TaskLike | undefined) => (t ? (txt(t.task_name) || txt(t.title) || null) : null);
  const campaignName = (id: string | null | undefined): string | null => {
    const t = find(id);
    if (!t) return null;
    // A booking whose parent we cannot see is NOT its own campaign. Falling
    // back to the booking's own name would print the vendor twice over —
    // "Bright Studios · Bright Studios booking" — which reads like the
    // campaign is called that. Unknown is the honest answer; the caller
    // shows the brand instead, and does not pretend it is a link.
    if (t.parent_task_id) return label(find(t.parent_task_id));
    return label(t);
  };

  return (input.requests || []).map((r) => {
    const status = statusOf(r.status);
    const kind: ContractKind = txt(r.request_kind).toLowerCase() === 'vendor' ? 'vendor' : 'client';
    const created = isoDay(r.created_at);
    const ageDays = created ? Math.max(0, daysBetween(created, today)) : 0;
    const waiting = isWaiting(status);
    const contractId = txt(r.generated_contract_id) || null;
    const g = contractId ? byContract.get(contractId) : undefined;

    // The party the contract is actually with. Falling back to the brand
    // rather than to a dash: a row that says "—" is a row nobody can find.
    const party = kind === 'vendor'
      ? (txt(r.vendor_name) || txt(r.brand_name) || 'Unnamed vendor')
      : (txt(r.client_name) || txt(r.brand_name) || 'Unnamed client');

    const campaign = campaignName(r.pm_task_id);

    return {
      id: r.id,
      party,
      kind,
      kindLabel: kind === 'vendor' ? 'Vendor' : 'Client',
      category: kind === 'vendor' ? (txt(r.vendor_category) || null) : null,
      campaign: campaign ?? (txt(r.brand_name) || null),
      campaignKnown: campaign != null,
      status,
      statusLabel: statusLabel(status),
      amount: num(r.amount),
      ageDays,
      ageLabel: settledLabel(r, status, ageDays, today),
      waiting,
      stale: waiting && ageDays >= STALE_DAYS,
      contractId,
      file: status === 'generated' ? fileState(g) : 'unknown',
      pdfError: txt(g?.pdf_error) || null,
      taskId: txt(r.pm_task_id) || null,
      raw: r,
    };
  });
}

/**
 * The age column.
 *
 * While a request is waiting, the useful number is how long — that is the
 * problem. Once it has been dealt with, the useful number is when, and it
 * comes from the column that actually recorded it rather than from the
 * request date.
 */
function settledLabel(
  r: RequestRow, status: ContractStatus, ageDays: number, today: string,
): string {
  if (isWaiting(status)) return waitingLabel(ageDays);
  const when = isoDay(status === 'generated' ? r.generated_at : r.reviewed_at);
  const verb = status === 'generated' ? 'generated' : status === 'rejected' ? 'rejected' : 'cancelled';
  return when ? `${verb} ${shortDate(when, today)}` : verb;
}

/* ── What happens next ──────────────────────────────────────────── */

export type ActionKind = 'approve' | 'generate' | 'open' | 'none';

export interface NextAction {
  kind: ActionKind;
  label: string;
  /** Primary actions are the ones that move the request along. */
  primary: boolean;
  disabled: boolean;
  /** Said out loud when the action is disabled. Never a silent dead button. */
  reason: string | null;
  /** Whether the quiet Reject control belongs beside it. */
  canReject: boolean;
}

/**
 * The one thing this row is asking for.
 *
 * Never three buttons at equal weight. A pending request wants approving; an
 * approved one wants generating; a generated one wants opening. Anything
 * finished wants nothing, and gets nothing rather than a row of dead buttons.
 *
 * `canDownload` is false until somebody adds a download route to the backend.
 * The button is drawn and disabled with the reason showing, because an absent
 * control is indistinguishable from a missing feature — and a contract you
 * cannot open is the single most confusing thing on this screen.
 */
export function nextAction(
  row: ContractRow,
  opts: { canManage: boolean; canDownload?: boolean } = { canManage: false },
): NextAction {
  const none: NextAction = {
    kind: 'none', label: '', primary: false, disabled: true, reason: null, canReject: false,
  };

  if (row.status === 'generated') {
    if (row.file === 'missing') {
      return { kind: 'open', label: 'Open', primary: false, disabled: true,
        reason: 'The backend has no file for this contract.', canReject: false };
    }
    return {
      kind: 'open',
      label: row.file === 'docx_only' ? 'Open DOCX' : 'Open',
      primary: false,
      disabled: !opts.canDownload,
      reason: opts.canDownload ? null : 'Downloading needs a route on the contract backend.',
      canReject: false,
    };
  }

  if (row.status === 'rejected' || row.status === 'cancelled') return none;

  if (!opts.canManage) {
    return { kind: 'none', label: '', primary: false, disabled: true,
      reason: 'Only owners, admins, marketing and key accounts act on contracts.',
      canReject: false };
  }

  if (row.status === 'pending') {
    return { kind: 'approve', label: 'Approve', primary: true, disabled: false,
      reason: null, canReject: true };
  }
  return { kind: 'generate', label: 'Generate', primary: true, disabled: false,
    reason: null, canReject: true };
}

/** What the file line under a generated row says, or nothing. */
export function fileNote(row: ContractRow): string | null {
  if (row.status !== 'generated') return null;
  if (row.file === 'both') return 'PDF and DOCX';
  if (row.file === 'docx_only') {
    return row.pdfError ? `DOCX only — PDF failed: ${row.pdfError}` : 'DOCX only — PDF conversion failed';
  }
  if (row.file === 'missing') return 'No file on the backend';
  return null;
}

/* ── Sorting ────────────────────────────────────────────────────── */

export type SortKey = 'party' | 'kind' | 'campaign' | 'status' | 'age' | 'amount';
export type SortDir = 'asc' | 'desc';
export interface Sort { key: SortKey; dir: SortDir }

/** Oldest first. The longest-waiting request is the one that matters. */
export const DEFAULT_SORT: Sort = { key: 'age', dir: 'desc' };

export function firstDir(key: SortKey): SortDir {
  // Age and amount both mean "show me the worst" on the first click.
  return key === 'age' || key === 'amount' ? 'desc' : 'asc';
}

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: firstDir(key) };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

function cmpText(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

function cmpNum(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/** Sorted, blanks pinned to the bottom either way, ties broken on the party. */
export function sortRows(rows: ContractRow[], sort: Sort): ContractRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const blank = (r: ContractRow): boolean => {
    if (sort.key === 'amount') return r.amount == null;
    if (sort.key === 'campaign') return !r.campaign;
    return false;
  };

  return [...rows].sort((a, b) => {
    const ba = blank(a), bb = blank(b);
    if (ba !== bb) return ba ? 1 : -1;

    // The Age column holds two different quantities: how long a request has
    // been WAITING, and when a settled one was dealt with. Sorting them on
    // one number puts last winter's signed contracts above today's queue.
    // Waiting always ranks first; the direction orders within each group.
    if (sort.key === 'age' && a.waiting !== b.waiting) return a.waiting ? -1 : 1;

    let c = 0;
    switch (sort.key) {
      case 'party':    c = cmpText(a.party, b.party); break;
      case 'kind':     c = cmpText(a.kindLabel, b.kindLabel); break;
      case 'campaign': c = cmpText(a.campaign, b.campaign); break;
      case 'status':   c = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status); break;
      case 'age':      c = a.ageDays - b.ageDays; break;
      case 'amount':   c = cmpNum(a.amount, b.amount); break;
    }
    if (c !== 0) return c * dir;
    return cmpText(a.party, b.party);
  });
}

/* ── Filtering ──────────────────────────────────────────────────── */

export interface Filter {
  query: string;
  /** Only what somebody still has to act on. On by default. */
  waitingOnly: boolean;
  /** null = both kinds. */
  kind: ContractKind | null;
  /** null = every status. Beats `waitingOnly` when set. */
  status: ContractStatus | null;
}

export const EMPTY_FILTER: Filter = {
  query: '', waitingOnly: true, kind: null, status: null,
};

/** Nothing narrowing it at all — used to decide whether Clear is offered. */
export const NO_FILTER: Filter = {
  query: '', waitingOnly: false, kind: null, status: null,
};

function haystack(r: ContractRow, profiles: PersonLike[]): string {
  const q = r.raw;
  const person = (id: string | null | undefined) =>
    id ? profiles.find((p) => p.id === id)?.full_name ?? '' : '';
  return [
    r.party, r.campaign, r.category, r.statusLabel, r.kindLabel, r.contractId,
    q.brand_name, q.cr_number, q.template_key, q.notes, q.id,
    person(q.requested_by), person(q.reviewed_by),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function filterRows(
  rows: ContractRow[], filter: Filter, profiles: PersonLike[] = [],
): ContractRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((r) => {
    // An explicitly picked status beats the waiting toggle. Choosing
    // "Cancelled" and being shown nothing is a bug that looks like an
    // empty database — and cancelled is exactly what used to be missing.
    if (filter.status) { if (r.status !== filter.status) return false; }
    else if (filter.waitingOnly && !r.waiting) return false;

    if (filter.kind && r.kind !== filter.kind) return false;
    if (!q) return true;
    return haystack(r, profiles).includes(q);
  });
}

export function isFiltered(f: Filter): boolean {
  return Boolean(f.query.trim() || f.waitingOnly || f.kind || f.status);
}

/* ── What the header says ───────────────────────────────────────── */

export interface Summary {
  shown: number;
  total: number;
  waiting: number;
  stale: number;
  /** Money on requests nobody has finished with — the live exposure. */
  waitingValue: number;
}

export function summarise(all: ContractRow[], shown: ContractRow[]): Summary {
  let waiting = 0, stale = 0, waitingValue = 0;
  for (const r of all) {
    if (!r.waiting) continue;
    waiting += 1;
    if (r.stale) stale += 1;
    if (r.amount != null) waitingValue += r.amount;
  }
  return { shown: shown.length, total: all.length, waiting, stale, waitingValue };
}

export function money(v: number | null): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function summaryLine(s: Summary): string {
  const parts: string[] = [];
  parts.push(s.shown === s.total
    ? `${s.total} request${s.total === 1 ? '' : 's'}`
    : `${s.shown} of ${s.total} requests`);
  parts.push(s.waiting === 0 ? 'nothing waiting' : `${s.waiting} waiting`);
  if (s.stale > 0) parts.push(`${s.stale} over ${STALE_DAYS} days`);
  if (s.waitingValue > 0) parts.push(`SAR ${money(s.waitingValue)} unsigned`);
  return parts.join(' · ');
}

export function emptyMessage(filter: Filter, total: number): string {
  if (total === 0) return 'No contract requests yet. They arrive from the campaign panel.';
  if (filter.query.trim()) return `Nothing matches “${filter.query.trim()}”.`;
  if (filter.status) return `No ${statusLabel(filter.status).toLowerCase()} requests.`;
  if (filter.waitingOnly) return 'Nothing is waiting on anybody. Every request has been dealt with.';
  if (filter.kind) return `No ${filter.kind} contracts.`;
  return 'No requests match these filters.';
}

/* ── The columns ────────────────────────────────────────────────── */

export interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
}

export const COLUMNS: Column[] = [
  { key: 'party',    label: 'For',           align: 'left' },
  { key: 'kind',     label: 'Kind',          align: 'left' },
  { key: 'campaign', label: 'Campaign',      align: 'left' },
  { key: 'status',   label: 'Status',        align: 'left' },
  { key: 'age',      label: 'Age',           align: 'left' },
  { key: 'amount',   label: 'Amount (SAR)',  align: 'right' },
];

export function sortHint(col: Column, sort: Sort): string {
  if (sort.key !== col.key) return `Sort by ${col.label.toLowerCase()}`;
  return sort.dir === 'asc' ? 'Sorted ascending' : 'Sorted descending';
}

/* ── Saying what happened ───────────────────────────────────────── */

/**
 * What to say after Generate comes back.
 *
 * The old message was `DOCX generated (AQ-2026-0412); PDF failed: <stack>`,
 * which is a log line. It also vanished the moment anything else was
 * clicked — so the one place the PDF failure was ever mentioned was a
 * message with a lifetime of a few seconds. The row says it now too.
 */
export function generatedMessage(result: {
  contract_id?: string | null;
  pdf_error?: string | null;
}): string {
  const id = txt(result.contract_id);
  if (result.pdf_error) {
    return `Generated ${id || 'the contract'} as DOCX. The PDF conversion failed — the row says so, and it can be regenerated.`;
  }
  return `Generated ${id || 'the contract'}.`;
}
