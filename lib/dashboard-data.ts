/**
 * The Data view's brain.
 *
 * Everything here is a pure function over rows the app has already loaded.
 * No React, no Supabase, no `new Date()` without an argument — which means
 * the whole thing can be compiled and exercised in a test, and it is: the
 * component below it only draws what these functions return.
 *
 * The model is deliberately small. There is ONE page with TWO states:
 *
 *   scope === null  → the whole workspace
 *   scope !== null  → the same panels, narrowed to one client or one vendor
 *
 * A "report" is therefore not a separate screen with its own query that can
 * drift out of step — it is this page with a scope set.
 *
 * Money lives on subtasks (migration 028: price / net_amount / aq_gross per
 * vendor line). A campaign's money is the sum of its subtasks', exactly as
 * rollupCampaignMoney does it in use-workflow — the same rule, so the two
 * surfaces can never disagree.
 */

/* ────────────────────────────────────────────────────────────────
   Row shapes

   Declared structurally rather than imported from use-workflow so
   this file has no dependencies at all. PMTask, ClientRow and
   LegacyVendor satisfy them; if a column is ever renamed, the
   compiler says so at the call site.
   ──────────────────────────────────────────────────────────────── */

export interface DashTask {
  id: string;
  parent_task_id: string | null;
  title: string;
  task_name: string | null;
  brand_name: string | null;
  client_id: string | null;
  vendor_id: number | null;
  assignee_id: string | null;
  created_at: string;
  stage: string;
  status: string;
  subtask_kind: string | null;
  price: number | null;
  net_amount: number | null;
  client_payment_status: string | null;
  client_payment_amount: number | null;
  contract_status: string | null;
  vendor_payment_amount: number | null;
  vendor_payment_date: string | null;

  // ── the vendor report's columns (all optional: older callers, and the
  //    dashboard panels above, do not need them) ─────────────────
  due_date?: string | null;
  approval_stage?: string | null;
  /** Per-ad platform, on a subtask. Campaigns carry `platforms` instead. */
  platform?: string | null;
  platforms?: string[] | null;
  ad_type?: string | null;
  service_type_id?: string | null;
  source_id?: string | null;
  client_category_id?: string | null;
}

/** id → name for the three campaign lookups the report prints by name. */
export interface DashLookups {
  sources?: { id: string; name: string }[];
  clientCategories?: { id: string; name: string }[];
  serviceTypes?: { id: string; name: string }[];
}

export interface DashClient {
  id: string;
  company_name: string;
  cr_number: string | null;
  vat_number: string | null;
}

export interface DashVendor {
  id: number;
  name: string;
  license_number?: string | null;
  id_number?: string | null;
  vat_number?: string | null;
  vendor_category?: string | null;
}

export interface DashPerson { id: string; full_name: string | null }

/* ────────────────────────────────────────────────────────────────
   Scope and search
   ──────────────────────────────────────────────────────────────── */

export type ScopeKind = 'client' | 'vendor';

export interface Scope {
  kind: ScopeKind;
  /** Client UUID, or the vendor's numeric id as a string. */
  id: string;
  name: string;
  /** The identifying line under the name — CR, VAT, licence, ID. */
  meta: string;
}

export type MatchField = 'name' | 'CR' | 'VAT' | 'ID' | 'licence';

export interface SearchHit {
  kind: ScopeKind;
  id: string;
  name: string;
  matched: MatchField;
  meta: string;
}

/** Digits only, so "1010-234 567" finds 1010234567. */
function digits(v: string): string {
  return v.replace(/\D+/g, '');
}

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * How good a match is, so the row somebody meant comes first:
 * 3 = exact, 2 = starts with, 1 = contains, 0 = no match.
 */
function score(haystack: string | null | undefined, needle: string): number {
  const h = norm(haystack);
  if (!h || !needle) return 0;
  if (h === needle) return 3;
  if (h.startsWith(needle)) return 2;
  return h.includes(needle) ? 1 : 0;
}

/** Same, for an identifier: compared on digits as well as literally. */
function scoreId(haystack: string | null | undefined, needle: string, needleDigits: string): number {
  const direct = score(haystack, needle);
  if (direct) return direct;
  if (!needleDigits) return 0;
  return score(digits(haystack ?? ''), needleDigits);
}

export function clientMeta(c: DashClient): string {
  const bits = [
    c.cr_number ? `CR ${c.cr_number}` : null,
    c.vat_number ? `VAT ${c.vat_number}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Client';
}

export function vendorMeta(v: DashVendor): string {
  const bits = [
    v.vendor_category ? String(v.vendor_category).replace(/_/g, ' ') : null,
    v.id_number ? `ID ${v.id_number}` : null,
    v.license_number ? `licence ${v.license_number}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Vendor';
}

/**
 * One box, five fields. Whichever identifier somebody happens to have
 * pasted — name, CR, VAT, ID or licence — finds the row, and the hit says
 * which field it matched so a bare number is never mysterious.
 */
export function searchEntities(
  query: string,
  clients: DashClient[],
  vendors: DashVendor[],
  limit = 8,
): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const qd = digits(q);

  const scored: { hit: SearchHit; rank: number }[] = [];

  for (const c of clients) {
    const candidates: [MatchField, number][] = [
      ['name', score(c.company_name, q)],
      ['CR', scoreId(c.cr_number, q, qd)],
      ['VAT', scoreId(c.vat_number, q, qd)],
    ];
    const best = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (!best[1]) continue;
    scored.push({
      rank: best[1],
      hit: { kind: 'client', id: c.id, name: c.company_name, matched: best[0], meta: clientMeta(c) },
    });
  }

  for (const v of vendors) {
    const candidates: [MatchField, number][] = [
      ['name', score(v.name, q)],
      ['licence', scoreId(v.license_number, q, qd)],
      ['ID', scoreId(v.id_number, q, qd)],
      ['VAT', scoreId(v.vat_number, q, qd)],
    ];
    const best = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (!best[1]) continue;
    scored.push({
      rank: best[1],
      hit: { kind: 'vendor', id: String(v.id), name: v.name, matched: best[0], meta: vendorMeta(v) },
    });
  }

  return scored
    .sort((a, b) => (b.rank - a.rank) || a.hit.name.localeCompare(b.hit.name))
    .slice(0, limit)
    .map((s) => s.hit);
}

/* ────────────────────────────────────────────────────────────────
   Dates — always the task creation date, never a second field
   ──────────────────────────────────────────────────────────────── */

export interface DateRange { from: string | null; to: string | null }

export const ALL_TIME: DateRange = { from: null, to: null };

/** `2026-08-17T09:12:00Z` → `2026-08-17`, without constructing a Date. */
export function dayOf(iso: string | null | undefined): string {
  return (iso ?? '').slice(0, 10);
}

export function monthOf(iso: string | null | undefined): string {
  return (iso ?? '').slice(0, 7);
}

export function inRange(iso: string | null | undefined, range: DateRange): boolean {
  const day = dayOf(iso);
  if (!day) return false;
  if (range.from && day < range.from) return false;
  if (range.to && day > range.to) return false;
  return true;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] ?? m} ${y}`;
}

/** The month key n months before `key`. Pure string arithmetic. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const yy = Math.floor(total / 12);
  const mm = (total % 12) + 1;
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/* ────────────────────────────────────────────────────────────────
   Money
   ──────────────────────────────────────────────────────────────── */

export interface Money { price: number; net: number; gross: number }

function num(v: number | null | undefined): number {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : 0;
}

/** Sum the vendor lines. Same rule as rollupCampaignMoney. */
export function sumMoney(rows: DashTask[]): Money {
  let price = 0, net = 0;
  for (const r of rows) { price += num(r.price); net += num(r.net_amount); }
  return { price, net, gross: price - net };
}

/** 1_240_000 → "1.24M"; 186_000 → "186K"; 940 → "940". */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim((n / 1_000_000).toFixed(2))}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

function trim(s: string): string {
  return s.replace(/\.?0+$/, '');
}

export function full(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/* ────────────────────────────────────────────────────────────────
   Status — the only place colour is allowed
   ──────────────────────────────────────────────────────────────── */

export type Tone = 'ok' | 'wait' | 'bad' | 'none';

export interface PaymentState { key: 'paid' | 'partial' | 'unpaid'; label: string; tone: Tone }

/** What we still owe a vendor on one subtask. */
export function vendorPaymentState(row: DashTask): PaymentState {
  const owed = num(row.net_amount);
  const paid = num(row.vendor_payment_amount);
  if (owed <= 0 && paid <= 0) return { key: 'unpaid', label: 'Unpaid', tone: 'bad' };
  if (paid <= 0) return { key: 'unpaid', label: 'Unpaid', tone: 'bad' };
  if (paid + 0.5 >= owed) return { key: 'paid', label: 'Paid', tone: 'ok' };
  return { key: 'partial', label: 'Partial', tone: 'wait' };
}

/**
 * What a client still owes us on one campaign.
 *
 * `client_payment_status` is free-ish text ("pending" / "paid" / "partial"),
 * so it is read tolerantly and anything unrecognised counts as outstanding —
 * the safe direction, because a campaign wrongly marked paid disappears from
 * the list of things to chase.
 */
export function clientPaymentState(row: DashTask): PaymentState {
  const s = norm(row.client_payment_status);
  if (s.includes('partial')) return { key: 'partial', label: 'Partial', tone: 'wait' };
  if (s === 'paid' || s.includes('paid') || s === 'done' || s === 'settled') {
    return { key: 'paid', label: 'Paid', tone: 'ok' };
  }
  return { key: 'unpaid', label: 'Outstanding', tone: 'bad' };
}

export interface ContractState { key: 'signed' | 'pending' | 'none'; label: string; tone: Tone }

export function contractState(row: DashTask): ContractState {
  const s = norm(row.contract_status);
  if (s === 'signed_attached' || s === 'done' || s.includes('signed')) {
    return { key: 'signed', label: 'Signed', tone: 'ok' };
  }
  if (!s || s === 'no_contract') return { key: 'none', label: 'No contract', tone: 'none' };
  if (s === 'po') return { key: 'signed', label: 'PO', tone: 'ok' };
  return { key: 'pending', label: 'Not signed', tone: 'bad' };
}

export function isOpen(row: DashTask): boolean {
  return row.status !== 'done' && row.status !== 'cancelled' && row.stage !== 'completed';
}

/* ────────────────────────────────────────────────────────────────
   Scoping
   ──────────────────────────────────────────────────────────────── */

export interface Scoped {
  /** Campaigns in scope. */
  parents: DashTask[];
  /** Subtasks in scope — for a vendor scope, only that vendor's. */
  subtasks: DashTask[];
  /** Every subtask of every campaign in `parents`, vendor filter or not. */
  allSubtasks: DashTask[];
}

/**
 * Narrow the workspace to a scope and a date window.
 *
 * The date filter is applied to whichever row the scope is really about —
 * campaigns for the workspace and for a client, the vendor's own subtasks
 * for a vendor. Filtering a vendor's subtasks by their parent's creation
 * date would quietly drop work booked months after the campaign opened.
 */
export function scopeRows(all: DashTask[], scope: Scope | null, range: DateRange): Scoped {
  const parentsAll = all.filter((t) => !t.parent_task_id);
  const subsAll = all.filter((t) => !!t.parent_task_id);
  const subsByParent = new Map<string, DashTask[]>();
  for (const s of subsAll) {
    const list = subsByParent.get(s.parent_task_id!) ?? [];
    list.push(s);
    subsByParent.set(s.parent_task_id!, list);
  }

  if (scope?.kind === 'vendor') {
    const vid = Number(scope.id);
    const mine = subsAll.filter((s) => s.vendor_id === vid && inRange(s.created_at, range));
    const parentIds = new Set(mine.map((s) => s.parent_task_id!));
    const parents = parentsAll.filter((p) => parentIds.has(p.id));
    const allSubtasks = parents.flatMap((p) => subsByParent.get(p.id) ?? []);
    return { parents, subtasks: mine, allSubtasks };
  }

  const parents = parentsAll.filter((p) =>
    inRange(p.created_at, range) && (!scope || p.client_id === scope.id));
  const allSubtasks = parents.flatMap((p) => subsByParent.get(p.id) ?? []);
  return { parents, subtasks: allSubtasks, allSubtasks };
}

/* ────────────────────────────────────────────────────────────────
   The model the view draws
   ──────────────────────────────────────────────────────────────── */

export interface Kpi { key: string; value: string; note: string }
export interface MonthBar { key: string; label: string; short: string; price: number; net: number; gross: number }
export interface Slice { key: string; label: string; value: number; tone: Tone }
export interface BarRow { key: string; label: string; value: number; display: string }
export interface BarPanel { title: string; caption: string; rows: BarRow[] }
export type Cell =
  | { kind: 'text'; text: string }
  | { kind: 'num'; text: string }
  | { kind: 'pill'; text: string; tone: Tone };
/** `id` is the task the row is about, so clicking it can open that task. */
export interface TableRow { id: string; cells: Cell[] }
export interface TableModel { title: string; caption: string; columns: string[]; rows: TableRow[] }

export interface DashboardModel {
  kpis: Kpi[];
  months: MonthBar[];
  /**
   * Payment split, as three weighted slices.
   *
   * No longer rendered: the Data view's ledger (Aug 2026) shows the same
   * split as a bar you can click to filter the rows behind it, which a
   * donut cannot do. Kept because it is the tested home of the paid /
   * partial / unpaid weighting, and because it is cheap — but if you are
   * adding a panel, use the ledger, not this.
   */
  donut: { title: string; caption: string; centre: [string, string]; slices: Slice[] };
  bars1: BarPanel;
  bars2: BarPanel;
  table: TableModel;
  note: string;
  /** How many campaigns / subtasks the numbers were built from. */
  counted: { parents: number; subtasks: number };
}

function nameOf(t: DashTask): string {
  return (t.task_name || t.title || 'Untitled').trim();
}

/** Top n by value, with the rest folded into one honest "N others" row. */
function topN(
  entries: { key: string; label: string; value: number }[],
  n: number,
  fmt: (v: number) => string,
): BarRow[] {
  const sorted = entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, n);
  const tail = sorted.slice(n);
  const rows: BarRow[] = head.map((e) => ({ ...e, display: fmt(e.value) }));
  if (tail.length) {
    const sum = tail.reduce((a, b) => a + b.value, 0);
    rows.push({ key: '__other', label: `${tail.length} others`, value: sum, display: fmt(sum) });
  }
  return rows;
}

/** Anything with a date and an amount can be bucketed into a month. */
export interface MoneyRow { created_at: string; price: number | null; net_amount: number | null }

/**
 * Campaign money, dated by the campaign.
 *
 * A parent row carries no price of its own — since migration 028 the money
 * is per vendor line on the subtasks. Bucketing parents directly gives a
 * chart of zeroes, which is exactly what the first render of this page
 * showed. So each campaign is rolled up from its subtasks and then dated by
 * the campaign's own created_at, which is the date the whole page uses.
 */
export function campaignMoneyRows(parents: DashTask[], subtasks: DashTask[]): MoneyRow[] {
  const byParent = new Map<string, Money>();
  for (const s of subtasks) {
    if (!s.parent_task_id) continue;
    const cur = byParent.get(s.parent_task_id) ?? { price: 0, net: 0, gross: 0 };
    cur.price += num(s.price);
    cur.net += num(s.net_amount);
    byParent.set(s.parent_task_id, cur);
  }
  return parents.map((p) => {
    const m = byParent.get(p.id);
    return { created_at: p.created_at, price: m?.price ?? 0, net_amount: m?.net ?? 0 };
  });
}

/**
 * Six months ending at the most recent month that has anything in it, so an
 * agency looking at a quiet client doesn't get an empty chart of the current
 * quarter. Months with no work stay in, at zero — the gap is information.
 */
export function moneyByMonth(rows: MoneyRow[], months = 6): MonthBar[] {
  const buckets = new Map<string, Money>();
  for (const r of rows) {
    const key = monthOf(r.created_at);
    if (!key) continue;
    const b = buckets.get(key) ?? { price: 0, net: 0, gross: 0 };
    b.price += num(r.price);
    b.net += num(r.net_amount);
    b.gross = b.price - b.net;
    buckets.set(key, b);
  }
  if (!buckets.size) return [];
  const last = [...buckets.keys()].sort().pop()!;
  const out: MonthBar[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = shiftMonth(last, -i);
    const b = buckets.get(key) ?? { price: 0, net: 0, gross: 0 };
    const label = monthLabel(key);
    out.push({ key, label, short: label.slice(0, 3), ...b });
  }
  return out;
}

function paymentSlices(states: PaymentState[], amounts: number[]): Slice[] {
  const acc = new Map<string, { label: string; tone: Tone; value: number }>();
  states.forEach((s, i) => {
    const cur = acc.get(s.key) ?? { label: s.label, tone: s.tone, value: 0 };
    cur.value += amounts[i];
    acc.set(s.key, cur);
  });
  return ['paid', 'partial', 'unpaid']
    .filter((k) => acc.has(k))
    .map((k) => ({ key: k, ...acc.get(k)! }));
}

/* ────────────────────────────────────────────────────────────────
   The vendor report

   AQ's own format, one row per ad, in this exact column order. It is a
   reconciliation sheet as much as a report: columns 14–17 are what the ad
   was worth to the talent, what they have already been paid, what is still
   owed, and whether that is settled — which is the sequence somebody reads
   when a vendor asks "what do you still owe me".

   "Month of quotation" is the month the campaign was raised. There is no
   separate quotation date in the schema and inventing one would mean a
   field somebody has to maintain; the campaign's creation date is the date
   the whole page already uses.
   ──────────────────────────────────────────────────────────────── */

export const VENDOR_REPORT_COLUMNS = [
  'Month of quotation',
  'Name of task',
  'Brand name',
  'Client ctg',
  'Source',
  'Ctg',
  'Due date',
  'Platform',
  'Ad type',
  'Approval stage',
  'Price',
  'Status',
  'Client payment',
  'Total net of the ad',
  'Previous payment to the talent',
  'Net',
  'Payment status to the talent',
];

function pretty(value: string | null | undefined): string {
  const s = (value ?? '').trim().replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function nameFrom(list: { id: string; name: string }[] | undefined, id: string | null | undefined): string {
  if (!id) return '—';
  const hit = (list ?? []).find((x) => x.id === id);
  return hit ? hit.name : '—';
}

/** The per-ad platform, falling back to the campaign's list. */
function platformOf(ad: DashTask, campaign: DashTask | undefined): string {
  const own = (ad.platform ?? '').trim();
  if (own) return own;
  const list = campaign?.platforms;
  if (Array.isArray(list) && list.length) return list.join(', ');
  return '—';
}

export function vendorReportTable(
  ads: DashTask[],
  campaignById: Map<string, DashTask>,
  lookups: DashLookups,
): TableModel {
  const rows: TableRow[] = ads.map((ad) => {
    const c = ad.parent_task_id ? campaignById.get(ad.parent_task_id) : undefined;
    const owed = num(ad.net_amount);
    const already = num(ad.vendor_payment_amount);
    const balance = Math.max(0, owed - already);
    const pay = vendorPaymentState(ad);
    const clientPay = c ? clientPaymentState(c) : { label: '—', tone: 'none' as Tone };

    return {
      id: ad.id,
      cells: [
        { kind: 'text', text: c ? monthLabel(monthOf(c.created_at)) : monthLabel(monthOf(ad.created_at)) },
        { kind: 'text', text: c ? nameOf(c) : nameOf(ad) },
        { kind: 'text', text: (c?.brand_name ?? '').trim() || '—' },
        { kind: 'text', text: nameFrom(lookups.clientCategories, c?.client_category_id) },
        { kind: 'text', text: nameFrom(lookups.sources, c?.source_id) },
        { kind: 'text', text: nameFrom(lookups.serviceTypes, c?.service_type_id) },
        { kind: 'text', text: dayOf(c?.due_date) || '—' },
        { kind: 'text', text: platformOf(ad, c) },
        { kind: 'text', text: (ad.ad_type ?? c?.ad_type ?? '').trim() || '—' },
        { kind: 'text', text: pretty(c?.approval_stage) || '—' },
        { kind: 'num', text: full(num(ad.price)) },
        { kind: 'text', text: pretty(ad.status) || '—' },
        { kind: 'pill', text: clientPay.label, tone: clientPay.tone },
        { kind: 'num', text: full(owed) },
        { kind: 'num', text: full(already) },
        { kind: 'num', text: full(balance) },
        { kind: 'pill', text: pay.label, tone: pay.tone },
      ] as Cell[],
    };
  });

  return {
    title: 'Every ad, in the report format',
    caption: 'One row per ad. Month of quotation is the month the campaign was raised; Net is what is still owed after previous payments.',
    columns: VENDOR_REPORT_COLUMNS,
    rows,
  };
}

/**
 * The same table as a CSV, for Excel.
 *
 * Quoting is not optional here: a task called `Ramadan, 2026` or a platform
 * list of `Instagram, TikTok` would otherwise split into two columns and
 * shift every number after it into the wrong header.
 */
export function toCsv(table: TableModel): string {
  const esc = (v: string) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [table.columns.map(esc).join(',')];
  for (const r of table.rows) {
    lines.push(r.cells.map((c) => esc(
      // Numbers go out unformatted so Excel reads them as numbers, not text.
      c.kind === 'num' ? c.text.replace(/,/g, '') : c.text,
    )).join(','));
  }
  return lines.join('\r\n');
}

export interface DashboardInput {
  tasks: DashTask[];
  clients: DashClient[];
  vendors: DashVendor[];
  people: DashPerson[];
  scope: Scope | null;
  range: DateRange;
  /** Source / client category / service type names for the vendor report. */
  lookups?: DashLookups;
}

export function buildDashboard(input: DashboardInput): DashboardModel {
  const { scope, range } = input;
  const scoped = scopeRows(input.tasks, scope, range);
  const clientName = new Map(input.clients.map((c) => [c.id, c.company_name]));
  const vendorName = new Map(input.vendors.map((v) => [String(v.id), v.name]));
  const personName = new Map(input.people.map((p) => [p.id, (p.full_name || '').trim() || 'Unassigned']));

  if (scope?.kind === 'vendor') return vendorModel(input, scoped, clientName);
  if (scope?.kind === 'client') return clientModel(input, scoped, vendorName);
  return workspaceModel(input, scoped, clientName, personName);
}

/* ── the whole workspace ─────────────────────────────────────── */

function workspaceModel(
  input: DashboardInput,
  s: Scoped,
  clientName: Map<string, string>,
  personName: Map<string, string>,
): DashboardModel {
  const money = sumMoney(s.subtasks);
  const vendorIds = new Set(s.subtasks.map((r) => r.vendor_id).filter((v): v is number => !!v));
  const clientIds = new Set(s.parents.map((p) => p.client_id).filter(Boolean));

  const vendorRows = s.subtasks.filter((r) => r.vendor_id);
  const slices = paymentSlices(
    vendorRows.map(vendorPaymentState),
    vendorRows.map((r) => num(r.net_amount)),
  );
  const owed = slices.reduce((a, b) => a + b.value, 0);

  const byAssignee = new Map<string, number>();
  for (const t of [...s.parents, ...s.subtasks]) {
    if (!isOpen(t)) continue;
    const key = t.assignee_id ?? '__none';
    byAssignee.set(key, (byAssignee.get(key) ?? 0) + 1);
  }

  const byClient = new Map<string, number>();
  for (const p of s.parents) {
    if (!p.client_id) continue;
    const subs = s.allSubtasks.filter((x) => x.parent_task_id === p.id);
    byClient.set(p.client_id, (byClient.get(p.client_id) ?? 0) + sumMoney(subs).price);
  }

  // Needs attention: a campaign nobody can close — money outstanding or a
  // contract still unsigned. Sorted by how much money is sitting in it.
  const attention = s.parents
    .map((p) => {
      const subs = s.allSubtasks.filter((x) => x.parent_task_id === p.id);
      const m = sumMoney(subs);
      return { p, m, pay: clientPaymentState(p), con: contractState(p) };
    })
    .filter((r) => r.m.price > 0 && (r.pay.key !== 'paid' || r.con.key === 'pending'))
    .sort((a, b) => b.m.price - a.m.price)
    .slice(0, 8);

  return {
    kpis: [
      { key: 'Billed', value: compact(money.price), note: 'SAR · all campaigns' },
      { key: 'Vendors cost', value: compact(money.net), note: 'SAR paid to vendors' },
      { key: 'AQ net', value: compact(money.gross), note: 'SAR · billed less vendor cost' },
      { key: 'Campaigns', value: full(s.parents.length), note: `${full(clientIds.size)} clients` },
      { key: 'Vendors engaged', value: full(vendorIds.size), note: `across ${full(vendorRows.length)} bookings` },
    ],
    months: moneyByMonth(campaignMoneyRows(s.parents, s.allSubtasks)),
    donut: {
      title: 'Vendor payments',
      caption: `Of SAR ${full(owed)} owed to vendors. Colour here is status, not decoration.`,
      centre: [compact(owed), 'SAR owed'],
      slices,
    },
    bars1: {
      title: 'Open work by assignee',
      caption: 'Anything not done or cancelled. One series, so no legend — the title names it.',
      rows: topN(
        [...byAssignee.entries()].map(([id, v]) => ({
          key: id, label: id === '__none' ? 'Unassigned' : (personName.get(id) ?? 'Unknown'), value: v,
        })),
        6,
        (v) => full(v),
      ),
    },
    bars2: {
      title: 'Top clients by value',
      caption: 'By amount billed. Everything past the top six folds into one row.',
      rows: topN(
        [...byClient.entries()].map(([id, v]) => ({
          key: id, label: clientName.get(id) ?? 'Unknown client', value: v,
        })),
        6,
        compact,
      ),
    },
    table: {
      title: 'Needs attention',
      caption: "Campaigns with money outstanding or a contract unsigned. Everything else is in the charts above.",
      columns: ['Campaign', 'Client', 'Created', 'Contract', 'Client payment', 'Price'],
      rows: attention.map((r) => ({
        id: r.p.id,
        cells: [
          { kind: 'text', text: nameOf(r.p) },
          { kind: 'text', text: r.p.client_id ? (clientName.get(r.p.client_id) ?? '—') : '—' },
          { kind: 'text', text: dayOf(r.p.created_at) },
          { kind: 'pill', text: r.con.label, tone: r.con.tone },
          { kind: 'pill', text: r.pay.label, tone: r.pay.tone },
          { kind: 'num', text: full(r.m.price) },
        ] as Cell[],
      })),
    },
    note: 'Search a client or vendor above and every panel on this page narrows to them — the same numbers, scoped.',
    counted: { parents: s.parents.length, subtasks: s.subtasks.length },
  };
}

/* ── one client ──────────────────────────────────────────────── */

function clientModel(input: DashboardInput, s: Scoped, vendorName: Map<string, string>): DashboardModel {
  const scope = input.scope!;
  const money = sumMoney(s.subtasks);
  const vendorIds = new Set(s.subtasks.map((r) => r.vendor_id).filter((v): v is number => !!v));
  const done = s.parents.filter((p) => !isOpen(p)).length;

  const perCampaign = s.parents.map((p) => {
    const subs = s.allSubtasks.filter((x) => x.parent_task_id === p.id);
    return { p, subs, m: sumMoney(subs) };
  });

  // What they owe US — one state per campaign, weighted by its price.
  const slices = paymentSlices(
    perCampaign.map((r) => clientPaymentState(r.p)),
    perCampaign.map((r) => r.m.price),
  );
  const invoiced = slices.reduce((a, b) => a + b.value, 0);

  const byVendor = new Map<string, number>();
  for (const r of s.subtasks) {
    if (!r.vendor_id) continue;
    const k = String(r.vendor_id);
    byVendor.set(k, (byVendor.get(k) ?? 0) + num(r.net_amount));
  }

  const recent = [...perCampaign].sort((a, b) => (a.p.created_at < b.p.created_at ? 1 : -1)).slice(0, 10);

  return {
    kpis: [
      { key: 'Billed', value: compact(money.price), note: `SAR · ${full(s.parents.length)} campaigns` },
      { key: 'Vendors cost', value: compact(money.net), note: 'SAR paid to vendors' },
      { key: 'AQ net', value: compact(money.gross), note: 'SAR · billed less vendor cost' },
      { key: 'Campaigns', value: full(s.parents.length), note: `${full(done)} done · ${full(s.parents.length - done)} running` },
      { key: 'Vendors engaged', value: full(vendorIds.size), note: `across ${full(s.subtasks.length)} bookings` },
    ],
    months: moneyByMonth(campaignMoneyRows(s.parents, s.allSubtasks)),
    donut: {
      title: 'Payments received',
      caption: `Of SAR ${full(invoiced)} billed to ${scope.name}. Of the amount billed to them.`,
      centre: [compact(invoiced), 'SAR billed'],
      slices,
    },
    bars1: {
      title: 'Campaigns by value',
      caption: 'Every campaign run for them, by amount billed.',
      rows: topN(perCampaign.map((r) => ({ key: r.p.id, label: nameOf(r.p), value: r.m.price })), 6, compact),
    },
    bars2: {
      title: 'Vendors their money went to',
      caption: 'Vendor cost by vendor, across their campaigns.',
      rows: topN(
        [...byVendor.entries()].map(([id, v]) => ({ key: id, label: vendorName.get(id) ?? `Vendor ${id}`, value: v })),
        6,
        compact,
      ),
    },
    table: {
      title: 'Their campaigns',
      caption: 'Created is the task creation date — no second field to keep up to date.',
      columns: ['Campaign', 'Created', 'Subtasks', 'Contract', 'Client payment', 'Price'],
      rows: recent.map((r) => ({
        id: r.p.id,
        cells: [
          { kind: 'text', text: nameOf(r.p) },
          { kind: 'text', text: dayOf(r.p.created_at) },
          { kind: 'text', text: full(r.subs.length) },
          { kind: 'pill', text: contractState(r.p).label, tone: contractState(r.p).tone },
          { kind: 'pill', text: clientPaymentState(r.p).label, tone: clientPaymentState(r.p).tone },
          { kind: 'num', text: full(r.m.price) },
        ] as Cell[],
      })),
    },
    note: `Everything on this page is ${scope.name} only. Net and AQ gross are internal — a client-facing version of this is the next thing to build, and it will not carry those two fields at all.`,
    counted: { parents: s.parents.length, subtasks: s.subtasks.length },
  };
}

/* ── one vendor ──────────────────────────────────────────────── */

function vendorModel(input: DashboardInput, s: Scoped, clientName: Map<string, string>): DashboardModel {
  const scope = input.scope!;
  const money = sumMoney(s.subtasks);
  const parentById = new Map(s.parents.map((p) => [p.id, p]));

  const states = s.subtasks.map(vendorPaymentState);
  const slices = paymentSlices(states, s.subtasks.map((r) => num(r.net_amount)));
  const owedNow = s.subtasks
    .filter((r, i) => states[i].key !== 'paid')
    .reduce((a, r) => a + Math.max(0, num(r.net_amount) - num(r.vendor_payment_amount)), 0);

  const clientsSeen = new Set<string>();
  const countByClient = new Map<string, number>();
  const netByClient = new Map<string, number>();
  for (const r of s.subtasks) {
    const p = r.parent_task_id ? parentById.get(r.parent_task_id) : undefined;
    const cid = p?.client_id ?? '__none';
    if (cid !== '__none') clientsSeen.add(cid);
    countByClient.set(cid, (countByClient.get(cid) ?? 0) + 1);
    netByClient.set(cid, (netByClient.get(cid) ?? 0) + num(r.net_amount));
  }
  const label = (id: string) => (id === '__none' ? 'No client on file' : (clientName.get(id) ?? 'Unknown client'));

  const signed = s.subtasks.filter((r) => {
    const p = r.parent_task_id ? parentById.get(r.parent_task_id) : undefined;
    return p ? contractState(p).key === 'signed' : false;
  }).length;

  // Every ad in scope, newest first — deliberately NOT a top ten. The
  // report is reconciled against, so a table that quietly stopped at ten
  // rows would disagree with the totals printed above it.
  const recent = [...s.subtasks].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    kpis: [
      { key: 'Times worked', value: full(s.subtasks.length), note: `across ${full(s.parents.length)} campaigns` },
      { key: 'Vendors cost', value: compact(money.net), note: 'SAR · earned' },
      { key: 'Liability now', value: compact(owedNow), note: `SAR · ${full(states.filter((x) => x.key !== 'paid').length)} bookings` },
      { key: 'Clients', value: full(clientsSeen.size), note: 'they have worked for' },
      { key: 'Contracts', value: `${full(signed)} / ${full(s.subtasks.length)}`, note: 'campaigns with a signed contract' },
    ],
    months: moneyByMonth(s.subtasks),
    donut: {
      title: 'Liability',
      caption: `Of SAR ${full(money.net)} earned. Of the amount they have earned.`,
      centre: [compact(money.net), 'SAR earned'],
      slices,
    },
    bars1: {
      title: 'Times worked by client',
      caption: 'How often we have booked them, and for whom.',
      rows: topN(
        [...countByClient.entries()].map(([id, v]) => ({ key: id, label: label(id), value: v })),
        6,
        (v) => full(v),
      ),
    },
    bars2: {
      title: 'Earnings by client',
      caption: 'Σ Net. The same subtasks as on the left, in money instead of count.',
      rows: topN(
        [...netByClient.entries()].map(([id, v]) => ({ key: id, label: label(id), value: v })),
        6,
        compact,
      ),
    },
    // AQ's own seventeen-column format, newest first, EVERY ad in scope —
    // not a top ten. A report that quietly stops at ten rows is worse than
    // no report: the totals above it would not match the rows below it.
    table: vendorReportTable(recent, parentById, input.lookups ?? {}),
    note: `Everything on this page is ${scope.name} only. Price and AQ gross are internal — a vendor-facing version will carry neither.`,
    counted: { parents: s.parents.length, subtasks: s.subtasks.length },
  };
}
