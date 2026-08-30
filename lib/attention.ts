/**
 * What is wrong right now, ranked.
 *
 * The dashboard's job, in Siraj's words: "show what you need to do and if
 * any of the tasks have problems." The first half was already there in a
 * list of task names. The second half was not anywhere — a campaign with a
 * vendor booked, no price on it and no contract requested looked exactly
 * like a campaign that was fine, and stayed that way until somebody opened
 * it.
 *
 * Everything here is derived from rows the dashboard already loads. No new
 * queries: a landing screen that has to run three more scans before it can
 * tell you anything is a slower landing screen, and slow was the last
 * complaint but one.
 *
 * Pure — no React, no Supabase, and no `new Date()`. Today is passed in,
 * because a function that reads the clock cannot be tested and this one
 * decides what the whole team is told to worry about.
 */

export type AttentionKind =
  | 'overdue'
  | 'due_today'
  | 'triage_stalled'
  | 'vendor_missing'
  | 'price_missing'
  | 'contract_missing'
  | 'contract_stuck'
  | 'money_mismatch'
  | 'no_vendors'
  | 'no_due_date'
  | 'followup_overdue';

/**
 * urgent — a date has passed, or money is wrong. Somebody is waiting.
 * soon   — today's work, and things that will become urgent if left.
 * tidy   — real gaps that hurt nobody today. Last, and quiet.
 */
export type Severity = 'urgent' | 'soon' | 'tidy';

export interface AttentionItem {
  /** Stable across reloads, so React keys and "dismissed" could hang off it. */
  key: string;
  kind: AttentionKind;
  severity: Severity;
  /** What to open when it is clicked. A subtask opens its own panel. */
  taskId: string;
  title: string;
  /** The campaign it sits under, or the brand. Blank when it IS the campaign. */
  context: string;
  /** One line, in words, saying what is wrong. */
  message: string;
  /** Days late, or days waiting. Used for ordering; 0 when it does not apply. */
  days: number;
}

export interface TaskRow {
  id: string;
  parent_task_id?: string | null;
  task_name?: string | null;
  title?: string | null;
  brand_name?: string | null;
  stage?: string | null;
  status?: string | null;
  due_date?: string | null;
  created_at?: string | null;
  subtask_kind?: string | null;
  vendor_id?: number | null;
  price?: number | null;
  contract_request_id?: string | null;
  assignee_id?: string | null;
  key_account_id?: string | null;
  creator_id?: string | null;
}

export interface RollupRow {
  parent_task_id: string;
  title?: string | null;
  brand_name?: string | null;
  vendor_count?: number | null;
  price_vs_total_variance?: number | null;
}

export interface FollowUpRow {
  id: string;
  title?: string | null;
  due_date?: string | null;
  status?: string | null;
}

const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, soon: 1, tidy: 2 };

/** Stages where a campaign is live work rather than an idea or a memory. */
const ACTIVE_STAGES = ['in_progress', 'pending_marketing', 'approved', 'active'];

/** How long a task can sit unclaimed in triage before it is a problem. */
export const TRIAGE_PATIENCE_DAYS = 3;

/**
 * How long a contract can sit with Legal before somebody should ask.
 *
 * Kept in step with CONTRACT_PATIENCE_DAYS in lib/campaign-page — the
 * campaign page and this list must not disagree about whether a contract is
 * late, or the dashboard sends you to a campaign that says everything is
 * fine.
 */
export const CONTRACT_PATIENCE_DAYS = 7;

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function nameOf(t: TaskRow | RollupRow | null | undefined): string {
  const anyT = t as any;
  return txt(anyT?.task_name) || txt(anyT?.title) || 'Untitled';
}

function isDone(t: TaskRow): boolean {
  return t.status === 'done' || t.stage === 'completed' || t.stage === 'cancelled';
}

/** Whole days between two YYYY-MM-DD strings. Negative means `a` is earlier. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export interface AttentionInput {
  /** Every pm_task row in the workspace, parents and subtasks alike. */
  tasks: TaskRow[];
  /**
   * When each booking's contract was requested, by pm_task id.
   *
   * Passed in from `contract_requests` rather than read off the task,
   * because pm_tasks has no column recording it — an age derived from the
   * task's own `updated_at` resets every time somebody edits an unrelated
   * field, which is exactly the number a chase would be built on.
   */
  requestSentAt?: Map<string, string>;
  /** Each booking's contract status, by pm_task id. */
  contractStatus?: Map<string, string>;
  /** The rollup view, one row per campaign. */
  rollup?: RollupRow[];
  /** This person's CRM follow-ups. */
  followUps?: FollowUpRow[];
}

export interface AttentionOptions {
  /** Only count things belonging to this person. Omit for the whole workspace. */
  userId?: string | null;
  /** Cap the returned list. The count of what was cut is in `hiddenCount`. */
  limit?: number;
}

export interface AttentionResult {
  items: AttentionItem[];
  /** How many more there were beyond the limit. */
  hiddenCount: number;
  /** Everything, by severity, for the summary line. */
  counts: Record<Severity, number>;
}

/**
 * The whole list, ranked: severity first, then the longest-waiting.
 *
 * `userId` narrows it to your own work. It deliberately does NOT narrow the
 * data-entry problems on a campaign you are the key account for — those are
 * yours whether or not the subtask happens to be assigned to you.
 */
export function attentionItems(
  input: AttentionInput,
  today: string,
  opts: AttentionOptions = {},
): AttentionResult {
  const tasks = input.tasks || [];
  const requestSentAt = input.requestSentAt;
  const contractStatus = input.contractStatus;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: AttentionItem[] = [];

  const mine = (t: TaskRow): boolean => {
    if (!opts.userId) return true;
    if (t.assignee_id === opts.userId || t.key_account_id === opts.userId || t.creator_id === opts.userId) {
      return true;
    }
    // A subtask belongs to whoever owns the campaign above it.
    const parent = t.parent_task_id ? byId.get(t.parent_task_id) : null;
    return !!parent && (
      parent.assignee_id === opts.userId
      || parent.key_account_id === opts.userId
      || parent.creator_id === opts.userId
    );
  };

  const contextOf = (t: TaskRow): string => {
    if (!t.parent_task_id) return txt(t.brand_name);
    const parent = byId.get(t.parent_task_id);
    return parent ? nameOf(parent) : '';
  };

  for (const t of tasks) {
    if (isDone(t) || !mine(t)) continue;

    const due = txt(t.due_date);
    if (due && due < today) {
      const late = daysBetween(due, today);
      out.push({
        key: `overdue:${t.id}`,
        kind: 'overdue',
        severity: 'urgent',
        taskId: t.id,
        title: nameOf(t),
        context: contextOf(t),
        message: late === 1 ? 'A day late.' : `${plural(late, 'day')} late.`,
        days: late,
      });
      // One task, one line. Something already late does not also need to be
      // told it has no contract — fix the date first, or it never ends.
      continue;
    }

    if (due && due === today) {
      out.push({
        key: `today:${t.id}`,
        kind: 'due_today',
        severity: 'soon',
        taskId: t.id,
        title: nameOf(t),
        context: contextOf(t),
        message: 'Due today.',
        days: 0,
      });
      continue;
    }

    // ── Data-entry gaps on a vendor booking ──────────────────────
    // In the order they get filled in, and only the FIRST one missing:
    // telling somebody a booking has no price and no contract when it does
    // not even have a vendor yet is three lines for one action.
    if (isVendorish(t)) {
      if (t.vendor_id == null) {
        out.push(gap(t, 'vendor_missing', 'soon', 'No vendor selected.', contextOf(t)));
        continue;
      }
      if (t.price == null || Number(t.price) === 0) {
        out.push(gap(t, 'price_missing', 'soon', 'Vendor booked, but no price set.', contextOf(t)));
        continue;
      }
      if (!txt(t.contract_request_id)) {
        out.push(gap(t, 'contract_missing', 'tidy', 'Priced, but no contract has been requested.', contextOf(t)));
        continue;
      }
      // Asked for, and never came back.
      //
      // Nothing in the app has ever chased one of these: a request went out
      // and whether it returned was something people noticed or did not.
      // 'soon' rather than 'urgent' — the work is agreed and usually
      // running; what is missing is the paper, and the cost of that shows
      // up later rather than today.
      const sent = requestSentAt?.get(t.id);
      if (sent && !isContractDone(t, contractStatus?.get(t.id))) {
        const waiting = daysBetween(txt(sent).slice(0, 10), today);
        if (waiting >= CONTRACT_PATIENCE_DAYS) {
          out.push({
            key: `contract_stuck:${t.id}`,
            kind: 'contract_stuck',
            severity: 'soon',
            taskId: t.id,
            title: nameOf(t),
            context: contextOf(t),
            message: `Contract has been with Legal ${plural(waiting, 'day')}.`,
            days: waiting,
          });
          continue;
        }
      }
    }

    // ── Campaign-level tidiness ──────────────────────────────────
    if (!t.parent_task_id && ACTIVE_STAGES.includes(txt(t.stage))) {
      if (t.stage === 'pending_marketing') {
        const waiting = t.created_at ? daysBetween(txt(t.created_at).slice(0, 10), today) : 0;
        if (waiting >= TRIAGE_PATIENCE_DAYS) {
          out.push({
            key: `triage:${t.id}`,
            kind: 'triage_stalled',
            severity: 'urgent',
            taskId: t.id,
            title: nameOf(t),
            context: txt(t.brand_name),
            message: `Awaiting marketing assignment for ${plural(waiting, 'day')}.`,
            days: waiting,
          });
          continue;
        }
      }
      if (!due) {
        out.push(gap(t, 'no_due_date', 'tidy', 'No due date, so it appears on no calendar.', txt(t.brand_name)));
        continue;
      }
    }
  }

  // ── From the rollup view ───────────────────────────────────────
  for (const r of input.rollup || []) {
    const parent = byId.get(r.parent_task_id);
    if (!parent || isDone(parent) || !mine(parent)) continue;

    const variance = Number(r.price_vs_total_variance ?? 0);
    if (Math.abs(variance) >= 1) {
      out.push({
        key: `money:${r.parent_task_id}`,
        kind: 'money_mismatch',
        severity: 'urgent',
        taskId: r.parent_task_id,
        title: nameOf(r) || nameOf(parent),
        context: txt(r.brand_name),
        message: variance > 0
          ? `Vendors cost SAR ${money(variance)} more than the campaign total.`
          : `SAR ${money(-variance)} of the campaign total is not booked to any vendor.`,
        days: 0,
      });
      continue;
    }

    if (Number(r.vendor_count ?? 0) === 0 && ACTIVE_STAGES.includes(txt(parent.stage))) {
      out.push({
        key: `novendors:${r.parent_task_id}`,
        kind: 'no_vendors',
        severity: 'soon',
        taskId: r.parent_task_id,
        title: nameOf(r) || nameOf(parent),
        context: txt(r.brand_name),
        message: 'Active, with no vendors booked.',
        days: 0,
      });
    }
  }

  // ── CRM follow-ups ─────────────────────────────────────────────
  // They are work too. Left out, "Overdue 0" could be true of campaigns and
  // wrong about the person reading it.
  for (const f of input.followUps || []) {
    if (f.status === 'done' || f.status === 'cancelled') continue;
    const due = txt(f.due_date);
    if (!due || due >= today) continue;
    const late = daysBetween(due, today);
    out.push({
      key: `followup:${f.id}`,
      kind: 'followup_overdue',
      severity: 'urgent',
      taskId: f.id,
      title: txt(f.title) || 'Follow-up',
      context: 'CRM follow-up',
      message: late === 1 ? 'A day late.' : `${plural(late, 'day')} late.`,
      days: late,
    });
  }

  out.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    if (b.days !== a.days) return b.days - a.days;      // longest wait first
    return a.title.localeCompare(b.title);              // then stable
  });

  const counts: Record<Severity, number> = { urgent: 0, soon: 0, tidy: 0 };
  for (const i of out) counts[i.severity] += 1;

  const limit = opts.limit ?? out.length;
  return { items: out.slice(0, limit), hiddenCount: Math.max(0, out.length - limit), counts };
}

function gap(
  t: TaskRow, kind: AttentionKind, severity: Severity, message: string, context: string,
): AttentionItem {
  return { key: `${kind}:${t.id}`, kind, severity, taskId: t.id, title: nameOf(t), context, message, days: 0 };
}

/**
 * A row that is booking a vendor.
 *
 * Kept as a list of kinds rather than "anything with a parent", because an
 * analysis report has no vendor and no price and is not missing anything.
 */
function isVendorish(t: TaskRow): boolean {
  return !!t.parent_task_id && ['vendor', 'ad'].includes(txt(t.subtask_kind));
}

/** A contract that came back, one way or another, is not stuck. */
function isContractDone(t: TaskRow, status: string | undefined): boolean {
  const s = txt(status) || txt((t as any).contract_status);
  return s === 'generated' || s === 'rejected' || s === 'cancelled';
}

function money(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString('en-US');
}

/** The one-line summary above the list. */
export function attentionSummary(counts: Record<Severity, number>): string {
  const total = counts.urgent + counts.soon + counts.tidy;
  if (total === 0) return 'Nothing outstanding.';
  const parts: string[] = [];
  if (counts.urgent) parts.push(`${counts.urgent} urgent`);
  if (counts.soon) parts.push(`${counts.soon} soon`);
  if (counts.tidy) parts.push(`${counts.tidy} for housekeeping`);
  return parts.join(' · ');
}
