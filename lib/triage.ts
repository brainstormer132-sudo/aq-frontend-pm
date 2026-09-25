/**
 * Marketing triage, as a queue you work down.
 *
 * The screen this replaces was a list beside a panel, and the panel only
 * existed once you clicked something — so the grid went from one column to
 * two under the cursor at the exact moment you were aiming at a row. The
 * list arrived newest-first, so the campaign that had waited longest was at
 * the bottom, and nothing on the screen said how long anything had waited at
 * all — even though the Dashboard calls three days in triage *urgent*.
 *
 * It also carried the most dangerous control in the app: a ✕ at
 * `top:10 right:10` on a card whose whole surface opens the task, wired
 * straight to `deleteTask` with no confirmation and no undo.
 *
 * Siraj picked "one at a time" (Aug 2026): one campaign, full width,
 * everything needed to decide, and a Next that brings the following one.
 *
 * Everything that decides the order, what is missing, and what a subtask
 * list looks like lives here — pure, no React, no Supabase, and no argless
 * `new Date()`.
 */

/* ── Shapes ─────────────────────────────────────────────────────── */

export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

export interface TaskRow {
  id: string;
  task_name?: string | null;
  title?: string | null;
  brand_name?: string | null;
  legacy_client_id?: string | null;
  description?: string | null;
  budget?: number | string | null;
  created_at?: string | null;
  [k: string]: unknown;
}

export interface StepRow {
  id: string;
  service_type_id: string;
  title: string;
  position: number;
}

export interface ServiceTypeRow {
  id: string;
  name?: string | null;
  icon?: string | null;
  position?: number | null;
}

/* ── Priority ───────────────────────────────────────────────────── */

/**
 * Four choices, in the order they mean something, and **no default**.
 *
 * The old form pre-picked `medium`, which is an opinion nobody expressed and
 * is how everything ends up medium. `none` is still a legal value in the
 * database — it is just not something a triage screen should offer, because
 * "no priority" is what you get by not triaging.
 */
export const PRIORITIES: { key: Priority; label: string }[] = [
  { key: 'urgent', label: 'Urgent' },
  { key: 'high',   label: 'High' },
  { key: 'medium', label: 'Normal' },
  { key: 'low',    label: 'Low' },
];

/* ── Dates and age ──────────────────────────────────────────────── */

/** The Dashboard's threshold, so the two screens agree about "urgent". */
export const STALE_DAYS = 3;

export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.round(ms / 86_400_000);
}

function isoDay(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const day = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Built by hand: `toLocaleDateString()` gives server and browser different
 *  answers, which is a hydration mismatch. */
export function shortDate(day: string | null, today: string): string {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  const thisYear = Number(today.slice(0, 4));
  return `${d} ${MONTHS[(m || 1) - 1] ?? ''}${y === thisYear ? '' : ` ${y}`}`;
}

export function waitedLabel(days: number): string {
  if (days <= 0) return 'arrived today';
  if (days === 1) return 'waiting 1 day';
  return `waiting ${days} days`;
}

/* ── A queue item ───────────────────────────────────────────────── */

export interface QueueItem {
  id: string;
  name: string;
  /** Brand, never the raw CR number. */
  brand: string | null;
  /** The brief sales wrote, whole — this screen has the width for it. */
  brief: string | null;
  /** Formatted money, or the sentence that says there is not any yet. */
  budgetLabel: string;
  hasBudget: boolean;
  waitedDays: number;
  waitedLabel: string;
  /** Waiting longer than the Dashboard is willing to call fine. */
  stale: boolean;
  arrived: string | null;
  raw: TaskRow;
}

function txt(v: unknown): string {
  return String(v ?? '').trim();
}

function money(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export interface QueuePosition { index: number; total: number; stale: number }

/* ── The decision ───────────────────────────────────────────────── */

export interface Draft {
  /** null until somebody actually chooses. There is no default. */
  priority: Priority | null;
  serviceTypeIds: string[];
  keyAccountId: string;
  stepIds: string[];
}

export const EMPTY_DRAFT: Draft = {
  priority: null, serviceTypeIds: [], keyAccountId: '', stepIds: [],
};

/**
 * What is still missing, in the order the form asks for it.
 *
 * Subtasks are deliberately not on this list: triaging with none is a
 * supported outcome, and the campaign is created bare.
 */
export function submitProblems(draft: Draft): string[] {
  const out: string[] = [];
  if (!draft.priority) out.push('Pick a priority.');
  if (draft.serviceTypeIds.length === 0) out.push('Pick at least one service type.');
  if (!txt(draft.keyAccountId)) out.push('Assign a key account manager.');
  return out;
}

export function canSubmit(draft: Draft): boolean {
  return submitProblems(draft).length === 0;
}

/* ── Subtasks ───────────────────────────────────────────────────── */

/** Common subtasks live at position > 100 in the seed. */
export const COMMON_STEP_THRESHOLD = 100;

export interface StepGroup {
  key: string;
  /** "🎬 Video", or "Common to all of these". */
  label: string;
  /** Each entry toggles together — a common step exists once per type. */
  rows: { key: string; title: string; stepIds: string[] }[];
}

/**
 * The steps on offer, grouped by service type with the common ones
 * deduplicated to the bottom.
 *
 * "Tracking sheet" exists once per service type in the seed, so picking
 * three types offered it three times. It is shown once and all three ids
 * toggle together.
 */
export function stepGroups(
  serviceTypeIds: string[], steps: StepRow[], serviceTypes: ServiceTypeRow[],
): StepGroup[] {
  const chosen = serviceTypeIds.filter(Boolean);
  if (chosen.length === 0) return [];

  const posOf = (id: string) => serviceTypes.find((s) => s.id === id)?.position ?? 0;
  const mine = (steps || [])
    .filter((s) => chosen.includes(s.service_type_id))
    .sort((a, b) => (posOf(a.service_type_id) - posOf(b.service_type_id)) || (a.position - b.position));

  const groups: StepGroup[] = [];
  const common = new Map<string, string[]>();

  for (const id of chosen) {
    const st = serviceTypes.find((x) => x.id === id);
    const rows = mine
      .filter((s) => s.service_type_id === id && s.position <= COMMON_STEP_THRESHOLD)
      .map((s) => ({ key: s.id, title: s.title, stepIds: [s.id] }));
    if (rows.length) {
      groups.push({
        key: id,
        label: `${st?.icon ? `${st.icon} ` : ''}${txt(st?.name) || 'Service type'}`,
        rows,
      });
    }
  }

  for (const s of mine) {
    if (s.position <= COMMON_STEP_THRESHOLD) continue;
    common.set(s.title, [...(common.get(s.title) ?? []), s.id]);
  }
  if (common.size) {
    groups.push({
      key: '__common',
      label: chosen.length > 1 ? 'Common to all of these' : 'Common',
      rows: [...common.entries()].map(([title, stepIds]) => ({ key: title, title, stepIds })),
    });
  }
  return groups;
}

/** Every step id currently on offer — what "All" selects. */
export function allStepIds(groups: StepGroup[]): string[] {
  return groups.flatMap((g) => g.rows.flatMap((r) => r.stepIds));
}

/**
 * The count for the screen, in **rows** rather than ids.
 *
 * A common step exists once per service type, so "Tracking sheet" is one
 * tick-box holding two ids. Counting ids means ticking one box makes the
 * counter jump by two and say "2 of 8" — which reads as a bug, because from
 * where the person is sitting it is one thing out of seven.
 */
export function stepCounts(
  groups: StepGroup[], chosen: Set<string>,
): { chosen: number; offered: number } {
  const rows = groups.flatMap((g) => g.rows);
  return { chosen: rows.filter((r) => rowChecked(r, chosen)).length, offered: rows.length };
}

/** A row is ticked when every id behind it is. */
export function rowChecked(row: { stepIds: string[] }, chosen: Set<string>): boolean {
  return row.stepIds.length > 0 && row.stepIds.every((id) => chosen.has(id));
}

export function toggleRow(row: { stepIds: string[] }, chosen: string[]): string[] {
  const set = new Set(chosen);
  const on = row.stepIds.every((id) => set.has(id));
  for (const id of row.stepIds) { if (on) set.delete(id); else set.add(id); }
  return [...set];
}

/** Drop anything that no longer belongs to the chosen service types. Never adds. */
export function pruneSteps(chosen: string[], groups: StepGroup[]): string[] {
  const valid = new Set(allStepIds(groups));
  const kept = chosen.filter((id) => valid.has(id));
  // Same array when nothing changed, so an effect keyed on it cannot loop.
  return kept.length === chosen.length ? chosen : kept;
}

export function stepsLine(chosenCount: number, offered: number): string {
  if (offered === 0) return '';
  if (chosenCount === 0) {
    return `none of ${offered} — the campaign is created bare, and subtasks can be added any time`;
  }
  return `${chosenCount} of ${offered} chosen`;
}

/* ── Deleting ───────────────────────────────────────────────────── */

/**
 * What the confirmation says.
 *
 * It names the campaign, because "Are you sure?" on a screen with four
 * campaigns on it is not a question anybody can answer. It says the deletion
 * is permanent, because it is — `deleteTask` cascades to the subtasks and
 * clears their notifications, and nothing brings any of that back.
 */
export function deleteWarning(item: QueueItem | null): string {
  if (!item) return '';
  return `Delete “${item.name}” permanently? This removes the campaign, anything under it, and its notifications. It cannot be undone.`;
}

/** Said after the campaign is gone, so the screen is not silently emptier. */
export function deletedMessage(name: string): string {
  return `Deleted “${name}”.`;
}
