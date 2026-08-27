/**
 * All Tasks — the register, as a table.
 *
 * The screen this replaces was one flat list in `created_at DESC` order,
 * with no due date on any row and a grey run-on subtitle carrying six
 * unlabelled facts. Sales and ops use this screen to *look things up* —
 * which campaigns has nobody booked a vendor for, which is the biggest, what
 * is late — and a feed is the wrong shape for looking things up. A table
 * with sortable columns is the right one.
 *
 * Everything that decides what a row says, where it sorts, and whether a
 * filter keeps it lives here: pure, no React, no Supabase, and no argless
 * `new Date()` — today is always passed in, because the server does not know
 * what day it is where you are.
 */

/* ── Shapes ─────────────────────────────────────────────────────── */

/** A parent pm_task row, as much of it as this screen reads. */
export interface TaskRow {
  id: string;
  task_name?: string | null;
  title?: string | null;
  brand_name?: string | null;
  legacy_client_id?: string | null;
  stage?: string | null;
  due_date?: string | null;
  priority?: number | string | null;
  assignee_id?: string | null;
  key_account_id?: string | null;
  sales_closer_id?: string | null;
  creator_id?: string | null;
  service_type_id?: string | null;
  description?: string | null;
  contract_request_id?: string | null;
  created_at?: string | null;
  budget?: number | string | null;
}

/** One row of `pm_task_campaign_rollup` — Σ of the children. */
export interface RollupRow {
  parent_task_id: string;
  vendor_count?: number | null;
  vendors_done?: number | null;
  sum_prices?: number | null;
  parent_total_amount?: number | null;
}

export interface PersonLike { id: string; full_name?: string | null; role?: string | null }
export interface ServiceTypeLike { id: string; name?: string | null; icon?: string | null }

/** A finished table row: everything the screen prints, already resolved. */
export interface TableRow {
  id: string;
  name: string;
  client: string;
  stage: StageKey;
  stageLabel: string;
  /** ISO yyyy-mm-dd, or null. */
  due: string | null;
  /** Days from today. Negative = late. null when there is no date. */
  dueInDays: number | null;
  dueLabel: string;
  dueTone: DueTone;
  /** Whether this row is still being chased. Finished work is not. */
  chased: boolean;
  keyAccount: string | null;
  vendors: number;
  vendorsDone: number;
  /** Σ of the vendor prices, falling back to the campaign's own total. */
  value: number | null;
  /** Days since it was created — the only age a triage row has. */
  waitingDays: number | null;
  raw: TaskRow;
}

/* ── Stages ─────────────────────────────────────────────────────── */

export type StageKey =
  | 'draft' | 'pending_marketing' | 'in_progress' | 'awaiting_review' | 'completed' | 'other';

/**
 * The order a campaign actually moves through, which is also the order the
 * stage filter is offered in. `other` catches a stage somebody adds to the
 * database later: an unknown value gets shown, not swallowed.
 */
export const STAGE_ORDER: StageKey[] = [
  'draft', 'pending_marketing', 'in_progress', 'awaiting_review', 'completed', 'other',
];

const STAGE_LABELS: Record<StageKey, string> = {
  draft: 'Draft',
  pending_marketing: 'Needs triage',
  in_progress: 'In progress',
  awaiting_review: 'Awaiting review',
  completed: 'Completed',
  other: 'Other',
};

export function stageKey(raw: string | null | undefined): StageKey {
  const v = (raw ?? '').trim();
  return (STAGE_ORDER as string[]).includes(v) && v !== 'other' ? (v as StageKey) : 'other';
}

/**
 * The stage in English.
 *
 * The old list printed `t.stage.replace('_', ' ')`, which is machine text
 * with one underscore knocked out — and "pending marketing" is not what
 * anybody calls it. They call it triage.
 */
export function stageLabel(raw: string | null | undefined): string {
  const k = stageKey(raw);
  if (k !== 'other') return STAGE_LABELS[k];
  const v = (raw ?? '').trim();
  if (!v) return 'No stage';
  // Something new in the database: make it readable rather than hide it.
  return v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Live work — what you see when completed is filtered out. */
export function isLive(stage: string | null | undefined): boolean {
  const k = stageKey(stage);
  return k !== 'completed' && k !== 'draft';
}

/* ── Dates ──────────────────────────────────────────────────────── */

/** Whole days between two yyyy-mm-dd dates. Positive = b is later. */
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

/**
 * The due date as a person would say it.
 *
 * Words, not a date stamp: nobody reads "2026-08-12" and thinks "that is
 * eleven days ago". The date itself is still shown beside it — one is for
 * deciding, the other is for checking.
 */
export function dueLabel(due: string | null, today: string): string {
  if (!due) return 'No date';
  const d = daysBetween(today, due);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return '1 day late';
  if (d < 0) return `${-d} days late`;
  return `in ${d} days`;
}

export type DueTone = 'late' | 'today' | 'soon' | 'later' | 'none';

export function dueTone(due: string | null, today: string): DueTone {
  if (!due) return 'none';
  const d = daysBetween(today, due);
  if (d < 0) return 'late';
  if (d === 0) return 'today';
  if (d <= 7) return 'soon';
  return 'later';
}

/**
 * The due date as this particular row should show it.
 *
 * A campaign that shipped last month is not eleven days late — it is
 * finished, and its date is a fact rather than a warning. Chasing finished
 * work is how a "late" count becomes a number nobody trusts, and once
 * nobody trusts it they stop reading the column.
 */
export function dueDisplay(
  due: string | null, today: string, stage: string | null | undefined,
): { label: string; tone: DueTone; chased: boolean } {
  const chased = isLive(stage);
  if (!chased) {
    return { label: due ? shortDate(due, today) : 'No date', tone: 'none', chased };
  }
  return { label: dueLabel(due, today), tone: dueTone(due, today), chased };
}

/** 12 Aug · 3 Sep · 18 Jul 2025 — the year only when it is not this one. */
export function shortDate(due: string | null, today: string): string {
  if (!due) return '';
  const [y, m, d] = due.split('-').map(Number);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = MONTHS[(m || 1) - 1] ?? '';
  const thisYear = Number(today.slice(0, 4));
  return `${d} ${month}${y === thisYear ? '' : ` ${y}`}`;
}

/* ── Building the rows ──────────────────────────────────────────── */

export function taskName(t: TaskRow): string {
  return (t.task_name || t.title || '').trim() || 'Untitled campaign';
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A money figure, where zero means "not priced" rather than "free". */
function pos(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

/**
 * Turn the rows the screen already loads into what the table prints.
 *
 * The money is Σ of the vendor prices where there are vendors, and the
 * campaign's own Total Amount where there are none — so a campaign that has
 * been sold but not yet booked still shows what it is worth instead of a
 * zero that reads like "free".
 */
export function buildRows(input: {
  tasks: TaskRow[];
  rollup?: RollupRow[];
  profiles?: PersonLike[];
}, today: string): TableRow[] {
  const byParent = new Map<string, RollupRow>();
  for (const r of input.rollup || []) byParent.set(r.parent_task_id, r);
  const nameOf = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return (input.profiles || []).find((p) => p.id === id)?.full_name?.trim() || null;
  };

  return (input.tasks || []).map((t) => {
    const roll = byParent.get(t.id);
    const due = isoDay(t.due_date);
    const created = isoDay(t.created_at);
    // A zero is not a price. The rollup view writes 0 into both columns for
    // a campaign nobody has costed yet, and printing that as "0" in a money
    // column says the campaign is free — a different fact from "we have not
    // put a number on this one", and one that quietly drags the workspace
    // total down for anybody adding the column up.
    const sum = pos(roll?.sum_prices);
    const total = pos(roll?.parent_total_amount) ?? pos(t.budget);
    const vendors = Number(roll?.vendor_count ?? 0) || 0;
    const shown = dueDisplay(due, today, t.stage);

    return {
      id: t.id,
      name: taskName(t),
      client: (t.brand_name || '').trim(),
      stage: stageKey(t.stage),
      stageLabel: stageLabel(t.stage),
      due,
      dueInDays: due ? daysBetween(today, due) : null,
      dueLabel: shown.label,
      dueTone: shown.tone,
      chased: shown.chased,
      keyAccount: nameOf(t.key_account_id),
      vendors,
      vendorsDone: Number(roll?.vendors_done ?? 0) || 0,
      value: vendors > 0 && sum != null ? sum : total,
      waitingDays: created ? daysBetween(created, today) : null,
      raw: t,
    };
  });
}

/* ── Sorting ────────────────────────────────────────────────────── */

export type SortKey = 'name' | 'client' | 'stage' | 'due' | 'keyAccount' | 'vendors' | 'value';
export type SortDir = 'asc' | 'desc';

export interface Sort { key: SortKey; dir: SortDir }

/** The order the table arrives in: soonest due first, late at the top. */
export const DEFAULT_SORT: Sort = { key: 'due', dir: 'asc' };

/**
 * Which way a column should go the first time you click it.
 *
 * Clicking "Value" to see the smallest campaigns is not what anybody means;
 * clicking "Due" to see the furthest-away one is not either. Text sorts A→Z,
 * numbers sort biggest-first, dates sort soonest-first.
 */
export function firstDir(key: SortKey): SortDir {
  return key === 'vendors' || key === 'value' ? 'desc' : 'asc';
}

export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: firstDir(key) };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

function cmpText(a: string | null, b: string | null): number {
  // An empty cell always sinks, whichever way the column is pointing —
  // a screen of blanks at the top is nobody's idea of a sort.
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

/**
 * Sorted, with the blanks pinned to the bottom either way.
 *
 * Ties break on name, so the order is stable between renders — a table that
 * reshuffles its equal rows every time the data refreshes is a table people
 * lose their place in.
 */
export function sortRows(rows: TableRow[], sort: Sort): TableRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const blank = (r: TableRow): boolean => {
    if (sort.key === 'due') return r.due == null;
    if (sort.key === 'keyAccount') return !r.keyAccount;
    if (sort.key === 'value') return r.value == null;
    if (sort.key === 'client') return !r.client;
    return false;
  };

  return [...rows].sort((a, b) => {
    // Pinned first, before direction is applied: blanks sink either way.
    const ba = blank(a), bb = blank(b);
    if (ba !== bb) return ba ? 1 : -1;

    let c = 0;
    switch (sort.key) {
      case 'name':       c = cmpText(a.name, b.name); break;
      case 'client':     c = cmpText(a.client, b.client); break;
      case 'keyAccount': c = cmpText(a.keyAccount, b.keyAccount); break;
      case 'stage':      c = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage); break;
      case 'due':        c = cmpNum(a.dueInDays, b.dueInDays); break;
      case 'vendors':    c = a.vendors - b.vendors; break;
      case 'value':      c = cmpNum(a.value, b.value); break;
    }
    if (c !== 0) return c * dir;
    return cmpText(a.name, b.name);
  });
}

/* ── Filtering ──────────────────────────────────────────────────── */

export interface Filter {
  query: string;
  /** null = every stage. */
  stage: StageKey | null;
  /** null = everyone. */
  personId: string | null;
  /** Only rows nobody has booked a vendor on. */
  noVendors: boolean;
  /** Only rows past their due date. */
  lateOnly: boolean;
  /**
   * Completed campaigns.
   *
   * On by default. They were hidden, and a finished campaign silently
   * disappearing from a list called "All Tasks" is the list lying about its
   * own name — you finish something and it is gone, with nothing to say
   * where. Hiding them is now a choice somebody makes, not the default.
   */
  showCompleted: boolean;
}

export const EMPTY_FILTER: Filter = {
  query: '', stage: null, personId: null,
  noVendors: false, lateOnly: false, showCompleted: true,
};

/**
 * Everything a row can be found by.
 *
 * Deliberately wide: people search this screen with whatever they have —
 * half a brand name, a CR number off an invoice, the id out of a URL, or
 * the name of whoever mentioned it to them.
 */
function haystack(r: TableRow, profiles: PersonLike[]): string {
  const t = r.raw;
  const person = (id: string | null | undefined) =>
    id ? profiles.find((p) => p.id === id)?.full_name ?? '' : '';
  return [
    r.name, r.client, r.stageLabel,
    t.legacy_client_id, t.id, t.description, t.contract_request_id,
    r.keyAccount,
    person(t.assignee_id), person(t.sales_closer_id), person(t.creator_id),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function filterRows(
  rows: TableRow[],
  filter: Filter,
  profiles: PersonLike[] = [],
): TableRow[] {
  const q = filter.query.trim().toLowerCase();
  return rows.filter((r) => {
    // An explicitly chosen stage beats the completed toggle: picking
    // "Completed" from the stage filter and being shown nothing is a bug
    // that looks like an empty database.
    if (filter.stage) { if (r.stage !== filter.stage) return false; }
    else if (!filter.showCompleted && r.stage === 'completed') return false;

    if (filter.lateOnly && r.dueTone !== 'late') return false;
    if (filter.noVendors && r.vendors > 0) return false;

    if (filter.personId) {
      const t = r.raw;
      const mine = t.assignee_id === filter.personId
        || t.key_account_id === filter.personId
        || t.sales_closer_id === filter.personId
        || t.creator_id === filter.personId;
      if (!mine) return false;
    }

    if (!q) return true;
    return haystack(r, profiles).includes(q);
  });
}

/** Whether anything is narrowing the table — decides if "Clear" is offered. */
export function isFiltered(f: Filter): boolean {
  return Boolean(
    f.query.trim() || f.stage || f.personId || f.noVendors || f.lateOnly || f.showCompleted,
  );
}

/* ── What the header says ───────────────────────────────────────── */

export interface Summary {
  shown: number;
  total: number;
  late: number;
  value: number;
  /** How many of the shown rows have no value to add up. */
  unpriced: number;
}

export function summarise(shown: TableRow[], total: number): Summary {
  let value = 0, unpriced = 0, late = 0;
  for (const r of shown) {
    if (r.dueTone === 'late') late += 1;
    if (r.value == null) unpriced += 1; else value += r.value;
  }
  return { shown: shown.length, total, late, value, unpriced };
}

export function money(v: number | null): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/**
 * The line under the title.
 *
 * It says how much of the table you are looking at, and it never quotes a
 * total as if it were complete when some rows have no price — a money figure
 * that silently omits rows is worse than no money figure.
 */
export function summaryLine(s: Summary): string {
  const parts: string[] = [];
  parts.push(s.shown === s.total
    ? `${s.total} campaign${s.total === 1 ? '' : 's'}`
    : `${s.shown} of ${s.total} campaigns`);
  if (s.late > 0) parts.push(`${s.late} late`);
  if (s.value > 0) {
    parts.push(s.unpriced > 0
      ? `SAR ${money(s.value)} across ${s.shown - s.unpriced}`
      : `SAR ${money(s.value)}`);
  }
  return parts.join(' · ');
}

/** What to say when the table is empty, which is never "no tasks". */
export function emptyMessage(filter: Filter, total: number): string {
  if (total === 0) return 'No campaigns in this workspace yet. Start one on the New Task screen.';
  if (filter.noVendors) return 'Every campaign here has at least one vendor booked.';
  if (filter.lateOnly) return 'Nothing is past its due date.';
  if (filter.query.trim()) return `Nothing matches “${filter.query.trim()}”.`;
  if (filter.stage) return `No campaigns at ${stageLabel(filter.stage).toLowerCase()}.`;
  if (filter.personId) return 'Nothing is assigned to them.';
  return 'No campaigns match these filters.';
}

/* ── The columns ────────────────────────────────────────────────── */

export interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right';
  /** Dropped first when the table runs out of room. */
  priority: 1 | 2 | 3;
}

export const COLUMNS: Column[] = [
  { key: 'name',       label: 'Campaign',    align: 'left',  priority: 1 },
  { key: 'client',     label: 'Client',      align: 'left',  priority: 2 },
  { key: 'stage',      label: 'Stage',       align: 'left',  priority: 1 },
  { key: 'due',        label: 'Due',         align: 'left',  priority: 1 },
  { key: 'keyAccount', label: 'Key account', align: 'left',  priority: 3 },
  { key: 'vendors',    label: 'Vendors',     align: 'right', priority: 2 },
  { key: 'value',      label: 'Value (SAR)', align: 'right', priority: 2 },
];

/** Screen-reader text for a sortable header, so it is not a bare arrow. */
export function sortHint(col: Column, sort: Sort): string {
  if (sort.key !== col.key) {
    return `Sort by ${col.label.toLowerCase()}`;
  }
  return sort.dir === 'asc' ? 'Sorted ascending' : 'Sorted descending';
}
