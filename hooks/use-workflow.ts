'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import {
  onCampaignCreated, onCampaignCompleted, onContractStatusChanged,
  onClientPaymentChanged, onDealWon, onDealLost,
} from '@/lib/crm-sync';
import {
  totalsOf, adTypeSummary, contractDetails,
  adsExpectingProof, adsMissingProof, type AdLine,
} from '@/lib/ad-lines';

const supabase = createClient();

/** Pretty-print a Supabase / PostgrestError so it doesn't show up as `{}`. */
function logSbError(label: string, err: any, ctx?: Record<string, unknown>) {
  if (!err) return;
  const detail = {
    message: err.message ?? null,
    code:    err.code ?? null,
    details: err.details ?? null,
    hint:    err.hint ?? null,
    status:  err.status ?? null,
  };
  // Console gets the structured object; alert gets the gist.
  // eslint-disable-next-line no-console
  console.error(label, detail, ctx ?? {});
}

// ============================================================
// Types matching the Phase 1 schema (006_role_workflow.sql)
// ============================================================

export type TaskStage = 'draft' | 'pending_marketing' | 'in_progress' | 'awaiting_review' | 'completed';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type WorkspaceRole = 'owner' | 'admin' | 'operations' | 'sales' | 'marketing' | 'key_account' | 'member';

export interface ServiceType {
  id: string;
  workspace_id: string | null;
  name: string;
  icon: string | null;
  description: string | null;
  is_template: boolean;
  position: number;
}

export interface ServiceTypeStep {
  id: string;
  service_type_id: string;
  position: number;
  title: string;
  description: string | null;
}

export interface PMTask {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  parent_task_id: string | null;
  /** Sort order among siblings. Set on subtasks; null on parents. */
  position: number | null;
  task_name: string | null;
  brand_name: string | null;
  legacy_client_id: string | null;
  // FK to public.clients (set by NewTaskForm picker, may be null on legacy rows).
  client_id: string | null;
  // FK to public.client_brands (set by NewTaskForm picker).
  brand_id: string | null;
  sales_closer_id: string | null;
  /**
   * An influencer who closed the deal (vendors.id), migration 054.
   * Mutually exclusive with sales_closer_id — a CHECK constraint enforces
   * it, and lib/sales-closer.ts is what keeps the UI from ever setting both.
   */
  sales_closer_vendor_id: number | null;
  /**
   * An influencer closed it, unnamed (061). The picker stopped listing the
   * register's hundreds of influencers one by one; this is what it writes.
   */
  sales_closer_influencer: boolean | null;
  key_account_id: string | null;
  service_type_id: string | null;
  budget: number | null;
  stage: TaskStage;
  status: string;
  priority: TaskPriority;
  title: string;
  description: string | null;
  assignee_id: string | null;
  creator_id: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Per-subtask vendor (added in migration 011). FK to public.vendors.
  vendor_id: number | null;
  // Auto-set when the subtask spawns a contract request (migration 011).
  contract_request_id: string | null;

  // ── Operations workflow columns (migration 028) ──────────────────
  // Per-vendor (child rows). Parent rows usually leave these null and read
  // the rollup view instead.
  price: number | null;
  net_amount: number | null;
  /** Generated column: price - net_amount. Read-only in the app. */
  aq_gross: number | null;
  platform: string | null;
  ad_type: string | null;
  vendor_payment_date: string | null;
  vendor_payment_amount: number | null;

  // Per-campaign (parent rows).
  source_id: string | null;
  client_category_id: string | null;
  quotation_no: string | null;
  /** "With Breakdown" / "Without Breakdown" — text for forward compat. */
  quotation_breakdown: string | null;
  invoice_no: string | null;
  /** "pending" / "paid" / "partial" — rendered as chip in the UI. */
  client_payment_status: string | null;
  client_payment_date: string | null;
  client_payment_amount: number | null;
  /** Manual override. Common values: "Pending", "On Process", "No Contract", "Signed". */
  contract_status: string | null;

  // ── Tracking sheet (migration 036) ───────────────────────────────
  /** Opt-in per campaign, toggled by a button on the parent (044). */
  has_tracking: boolean;
  /** When the client-facing copy of the sheet was last published (045). */
  tracking_published_at: string | null;
  tracking_published_by: string | null;

  // ── Parent task redesign (migration 042) — parent rows only ──────
  /** Platforms the campaign runs on. Names, matching task_platforms. */
  platforms: string[];
  /** Free text required when ad_type is 'Multi Service'. */
  ad_type_custom: string | null;
  /** 'ready_for_review' | 'changes_needed' | 'approved' | 'hold' | 'cancelled' */
  approval_stage: string | null;
  /** Repeatable text boxes. At least one of each in the UI. */
  quotation_numbers: string[];
  invoice_numbers: string[];
  net_payment_date: string | null;

  // ── Package Ad (migration 040) — parent rows only ─────────────────
  /** Run window for the whole package. Per-ad dates live on tracking rows. */
  package_start_date: string | null;
  package_end_date: string | null;
  /** How many ads the package is sold as. Setting it spawns that many vendor subtasks. */
  ad_quantity: number | null;

  // ── Per-kind subtask fields (migration 048) ──────────────────────
  /** Analysis report: 'low' | 'medium' | 'high'. */
  complexity: string | null;
  /** Analysis report: one of MEDIA_TYPES. */
  media_type: string | null;
  brand_logo_attached: boolean;
  keyword_excel_attached: boolean;
  /** Analysis report: "missing data or adjustment needed". */
  data_issue_note: string | null;
  /** Insight rides on the vendor subtask rather than being its own subtask. */
  insight_link: string | null;
  insight_attached: boolean;
  /** Campaign design / marketing strategy / visuals / blueprint 3D. */
  deliverable_attached: boolean;
  /** Proof of posting — parent rows only. */
  proof_of_posting_attached: boolean;
  proof_of_posting_link: string | null;

  // ── Typed subtasks + request tracking (migration 038) ─────────────
  /** Identifies a subtask's purpose so it can show its own fields.
   *  'vendor' | null (generic) on anything created now. Rows made before the
   *  redesign may still read 'quotation' | 'invoice' | 'contract' | 'payment'
   *  | 'tracking' | 'ad'. Null on parents. */
  subtask_kind: string | null;
  /** 'not_requested' | 'requested' | 'fulfilled' */
  request_status: string | null;
  requested_at: string | null;
  requested_by: string | null;
  request_note: string | null;
}

// ── Shared reference-data cache ─────────────────────────────────────
//
// Clients and vendors are workspace-wide reference lists — hundreds of rows
// that change rarely. Every hook mount used to refetch the whole table, so
// opening a task panel that renders a client picker, a brand picker and a
// vendor picker pulled the same rows three times.
//
// This is a module-level cache with in-flight de-duplication: concurrent
// mounts share one request, and a result is reused for TTL milliseconds.
// refetch() always bypasses it, so a save-then-refresh still shows the change.

interface CacheEntry<T> { at: number; data: T; inflight: Promise<T> | null }
const REF_CACHE = new Map<string, CacheEntry<any>>();
/** Reference data is stale-tolerant; 60s is far longer than a click-through. */
const REF_CACHE_TTL_MS = 60_000;

/**
 * What the app is actually asking the database for.
 *
 * `queries` counts requests that went to the network — a cache hit does not
 * count, which is the point. In development a request slower than `slowMs`
 * says so in the console with its label, so the next time somebody says a
 * screen is slow there is something to look at other than a stopwatch.
 */
export const perf = {
  queries: 0,
  cacheHits: 0,
  slowMs: 800,
};

async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  perf.queries += 1;
  const started = Date.now();
  try {
    return await run();
  } finally {
    const took = Date.now() - started;
    if (took > perf.slowMs && process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[aq] slow query ${label}: ${took}ms`);
    }
  }
}

async function cachedFetch<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
  const now = Date.now();
  const hit = REF_CACHE.get(key) as CacheEntry<T> | undefined;
  if (!force && hit) {
    // A request already in flight: join it rather than starting a second.
    if (hit.inflight) { perf.cacheHits += 1; return hit.inflight; }
    if (now - hit.at < REF_CACHE_TTL_MS) { perf.cacheHits += 1; return hit.data; }
  }
  const inflight = timed(key, loader).then(
    (data) => { REF_CACHE.set(key, { at: Date.now(), data, inflight: null }); return data; },
    (err) => { REF_CACHE.delete(key); throw err; },
  );
  REF_CACHE.set(key, { at: hit?.at ?? 0, data: hit?.data as T, inflight });
  return inflight;
}

// ── Reading a whole table when it is bigger than one page ───────────
//
// PostgREST caps a response at `db-max-rows`, which Supabase ships as 1000.
// It does not error and it does not tell you it truncated — you just get
// 1000 rows and no hint that there are more.
//
// That is how the Clients stat card came to read exactly "1,000". It wasn't
// a limit anybody chose; it was the whole client list quietly stopping at the
// page boundary, which also meant every client after the 1000th alphabetically
// was invisible to the picker and to the contract readiness check.
//
// Anything that reads a table which can grow past a thousand rows goes
// through here.

const PAGE_SIZE = 1000;
/** Runaway guard. Well past any table this app legitimately reads whole. */
const MAX_ROWS = 50_000;

/**
 * Page through a select until the table runs out.
 *
 * `build` must return a fresh query builder each call — a PostgREST builder
 * is single-use, so reusing one silently returns the first page every time.
 */
export async function selectAllRows<T>(
  label: string,
  build: () => any,
  /** Surface the failure in the UI as well as the console, where a view has
   *  somewhere to put it. */
  onError?: (message: string) => void,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await timed<any>(label, () => build().range(from, from + PAGE_SIZE - 1));
    if (error) {
      // Keep what we have and stop. Returning rather than breaking, so this
      // doesn't fall through to the runaway warning below and claim the table
      // is enormous when the real problem was one failed request.
      logSbError(label, error, { from });
      onError?.(error.message ?? String(error));
      return out;
    }
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;   // short page = last page
  }
  // eslint-disable-next-line no-console
  console.warn(`${label}: stopped at ${MAX_ROWS} rows. The table is bigger than this screen should be loading.`);
  return out;
}

/** Drop cached reference data — call after creating a client or vendor. */
export function invalidateRefCache(key?: string) {
  if (key) REF_CACHE.delete(key); else REF_CACHE.clear();
}

// ── Parent task vocabularies (migration 042) ────────────────────────
// Kept as const arrays so the UI dropdowns and the DB can't drift apart.

/** Task status. 'todo' was renamed to 'pending' in migration 042. */
export const TASK_STATUSES = ['pending', 'on_hold', 'done', 'cancelled'] as const;
export type TaskStatus = typeof TASK_STATUSES[number];

export const APPROVAL_STAGES = ['ready_for_review', 'changes_needed', 'approved', 'hold', 'cancelled'] as const;
export type ApprovalStage = typeof APPROVAL_STAGES[number];

/** Multi Service additionally requires ad_type_custom. */
/**
 * The campaign's ad type. Was Home Ad / Store Visit / Multi Service; now
 * the full list (see AD_TYPE_OPTIONS, declared below), so the parent and
 * the vendor subtask stop offering different vocabularies for the same
 * question. 'Multi Service' is kept on the end for rows that already
 * carry it, and still asks for its free-text detail.
 */
export const AD_TYPE_NEEDS_DETAIL = 'Multi Service';

export const CONTRACT_STATUSES = ['no_contract', 'po', 'pending', 'on_process', 'done', 'signed_attached'] as const;
export type ContractStatus = typeof CONTRACT_STATUSES[number];

/** Human labels for the snake_case values stored in the database. */
export const LABELS: Record<string, string> = {
  pending: 'Pending', on_hold: 'On hold', done: 'Done', cancelled: 'Cancelled',
  ready_for_review: 'Ready for review', changes_needed: 'Changes needed', approved: 'Approved', hold: 'Hold',
  no_contract: 'No contract', po: 'PO', on_process: 'On process', signed_attached: 'Signed & attached',
};
export function labelFor(value: string | null | undefined): string {
  if (!value) return '—';
  return LABELS[value] ?? value;
}

// ── Typed subtasks (migration 038) ──────────────────────────────────

/**
 * The kinds a subtask can be CREATED as. `null` = a generic template-spawned step.
 *
 * There is exactly one. Quotation, invoice, contracts/vendoring and payment
 * confirmation all moved onto the parent task (migrations 042/044), and the
 * tracking sheet became a button on the parent rather than a step. What is
 * left is the thing a subtask is actually for: one vendor on the campaign.
 *
 * Legacy rows still carry the retired values — see LEGACY_SUBTASK_KIND_LABELS.
 */
export const SUBTASK_KINDS = [
  'vendor',
  'analysis_report',
  'campaign_design',
  'marketing_strategy',
  'visuals',
  'blueprint_3d',
] as const;
export type SubtaskKind = typeof SUBTASK_KINDS[number];

/** Default title used when a subtask of this kind is added by hand. */
export const SUBTASK_KIND_LABELS: Record<SubtaskKind, string> = {
  vendor: 'Vendor',
  analysis_report: 'Analysis Report',
  campaign_design: 'Campaign Design',
  marketing_strategy: 'Marketing Strategy',
  visuals: 'Visuals',
  blueprint_3d: 'Blueprint Mapping / 3D',
};

/**
 * A colour per subtask kind, and per contract state.
 *
 * Siraj: "lets add some color to the app". A campaign with fourteen subtasks
 * was fourteen identical grey rows, so finding the vendor you wanted meant
 * reading every title. Colour here is doing a job — kind and contract state
 * are the two things you scan a list for — rather than decorating.
 *
 * Literal hex, not CSS variables: these are new hues that don't exist in the
 * token set, and a `var()` that resolves to nothing renders as transparent,
 * which is a silent failure rather than a visible one.
 */
export interface AccentColor {
  /** Strong enough for a left border or icon. */
  solid: string;
  /** Tinted background for a chip. Pairs with `solid` as the text colour. */
  soft: string;
}

export const SUBTASK_KIND_COLORS: Record<SubtaskKind, AccentColor> = {
  vendor:             { solid: '#0f766e', soft: '#ccfbf1' }, // teal — the house colour
  analysis_report:    { solid: '#6d28d9', soft: '#ede9fe' }, // violet
  campaign_design:    { solid: '#be185d', soft: '#fce7f3' }, // pink
  marketing_strategy: { solid: '#b45309', soft: '#fef3c7' }, // amber
  visuals:            { solid: '#1d4ed8', soft: '#dbeafe' }, // blue
  blueprint_3d:       { solid: '#4d7c0f', soft: '#ecfccb' }, // olive
};

/** Fallback for legacy kinds ('ad', 'tracking', …) and null. */
export const NEUTRAL_ACCENT: AccentColor = { solid: '#475569', soft: '#e2e8f0' };

export function subtaskKindColor(kind: string | null | undefined): AccentColor {
  if (kind === 'ad') return SUBTASK_KIND_COLORS.vendor;   // pre-047 name
  if (kind && kind in SUBTASK_KIND_COLORS) {
    return SUBTASK_KIND_COLORS[kind as SubtaskKind];
  }
  return NEUTRAL_ACCENT;
}

/**
 * Priority, as a colour. Used where a row has no subtask kind to colour by —
 * a parent campaign in a task list — so every row in the app carries some
 * signal on its left edge rather than none.
 */
export const TASK_PRIORITY_COLORS: Record<TaskPriority, AccentColor> = {
  urgent: { solid: '#b91c1c', soft: '#fee2e2' },
  high:   { solid: '#c2410c', soft: '#ffedd5' },
  medium: { solid: '#0f766e', soft: '#ccfbf1' },
  low:    { solid: '#0369a1', soft: '#e0f2fe' },
  none:   NEUTRAL_ACCENT,
};

/**
 * The colour for any task row: its subtask kind if it has one, otherwise its
 * priority. One call so lists and the detail panel can't drift apart.
 */
export function taskRowColor(task: {
  subtask_kind?: string | null;
  priority?: TaskPriority | string | null;
}): AccentColor {
  if (task.subtask_kind) return subtaskKindColor(task.subtask_kind);
  const p = task.priority as TaskPriority | null | undefined;
  return (p && p in TASK_PRIORITY_COLORS) ? TASK_PRIORITY_COLORS[p] : NEUTRAL_ACCENT;
}

/** Green sent, amber ready-but-unsent, red blocked. Matches the tally. */
export const CONTRACT_STATE_COLORS: Record<'requested' | 'ready' | 'missing', AccentColor> = {
  requested: { solid: '#15803d', soft: '#dcfce7' },
  ready:     { solid: '#b45309', soft: '#fef3c7' },
  missing:   { solid: '#b91c1c', soft: '#fee2e2' },
};

export const CONTRACT_STATE_LABELS: Record<'requested' | 'ready' | 'missing', string> = {
  requested: 'contract requested',
  ready:     'ready to request',
  missing:   'missing data',
};

/**
 * Kinds offered on every campaign, whatever its service type.
 *
 * Vendor because that is what a subtask fundamentally is here, and
 * Analysis Report because it is one of the things Siraj marked "always
 * required" — the completeness panel nags every campaign that hasn't got
 * one, so every campaign has to be able to add one. Nagging someone for
 * something the picker won't offer them is the worst of both.
 *
 * Everything else is earned from the service type's catalogue.
 */
export const ALWAYS_OFFERED_SUBTASK_KINDS: SubtaskKind[] = ['vendor', 'analysis_report'];

/**
 * What the "+ Add subtask" picker should offer for one campaign.
 *
 * The always-offered pair, plus whatever this campaign's service types
 * define in `service_type_steps`. Previously it offered all six on every
 * campaign, so an Ad Hook was invited to add a Blueprint Mapping / 3D
 * subtask — the same over-reach 050 fixed in the triage list, in a second
 * place nobody had looked.
 *
 * Returned in SUBTASK_KINDS order so the list doesn't reshuffle itself
 * between campaigns.
 */
export function offeredSubtaskKinds(
  serviceTypeIds: string[],
  steps: { service_type_id: string; title: string }[],
): SubtaskKind[] {
  const allowed = new Set<string>(ALWAYS_OFFERED_SUBTASK_KINDS);
  for (const k of catalogKinds(serviceTypeIds, steps)) allowed.add(k);
  return SUBTASK_KINDS.filter((k) => allowed.has(k));
}

/** The kinds this task's service types actually define in the catalogue. */
export function catalogKinds(
  serviceTypeIds: string[],
  steps: { service_type_id: string; title: string }[],
): SubtaskKind[] {
  const ids = new Set(serviceTypeIds);
  const found = new Set<SubtaskKind>();
  for (const s of steps) {
    if (!ids.has(s.service_type_id)) continue;
    const kind = subtaskKindFromStepTitle(s.title);
    if (kind) found.add(kind);
  }
  return SUBTASK_KINDS.filter((k) => found.has(k));
}

/**
 * Does the catalogue say this task's service types EXPECT this kind?
 *
 * The difference from offeredSubtaskKinds matters: that one answers "may I
 * add this?", this one answers "should I be nagged for not having it?".
 * A Package Ad may add an analysis report; it is not expected to have one.
 */
export function catalogExpectsKind(
  serviceTypeIds: string[],
  steps: { service_type_id: string; title: string }[],
  kind: SubtaskKind,
): boolean {
  return catalogKinds(serviceTypeIds, steps).includes(kind);
}

/**
 * Kinds that carry nothing but status, due date and attached-or-not.
 * Siraj was explicit: "we don't need anything for them except status
 * due date and a attached or not". Resist adding fields here.
 */
export const SIMPLE_DELIVERABLE_KINDS = [
  'campaign_design', 'marketing_strategy', 'visuals', 'blueprint_3d',
] as const;

export function isSimpleDeliverableKind(kind: string | null | undefined): boolean {
  return !!kind && (SIMPLE_DELIVERABLE_KINDS as readonly string[]).includes(kind);
}

/** Vendor is the only kind you can have several of on one campaign. */
export function isSingletonSubtaskKind(kind: string | null | undefined): boolean {
  return !!kind && !isVendorSubtaskKind(kind);
}

/**
 * Map a catalog step's title onto a subtask kind.
 *
 * Triage bulk-inserts rows from `service_type_steps`, which stores a title
 * and nothing else — so without this, a triage-spawned "Analysis Report"
 * would render the plain generic form while a hand-added one rendered the
 * real thing. Matching on the title is the only signal the catalog gives us.
 *
 * Returns null for anything unrecognised, which is the correct outcome: an
 * unknown step is a generic subtask.
 */
export function subtaskKindFromStepTitle(title: string | null | undefined): SubtaskKind | null {
  const t = (title ?? '').trim().toLowerCase();
  if (!t) return null;
  // Triage prefixes titles with "{icon} {service type} — ", so match the tail.
  const tail = t.includes('—') ? t.slice(t.lastIndexOf('—') + 1).trim() : t;
  switch (tail) {
    case 'analysis report':          return 'analysis_report';
    case 'campaign design':          return 'campaign_design';
    case 'marketing strategy':       return 'marketing_strategy';
    case 'visuals':                  return 'visuals';
    case 'blueprint mapping / 3d':
    case 'blueprint mapping/3d':
    case 'blueprint mapping':
    case '3d':                       return 'blueprint_3d';
    case 'vendor':                   return 'vendor';
    default:                         return null;
  }
}

/**
 * "Runs from / Runs to" as a readable duration.
 *
 * Computed, never stored — a stored duration and its own dates drift apart
 * the first time someone edits one of them. Inclusive of both days, because
 * a campaign that runs the 1st to the 1st is one day, not zero.
 */
export function runDurationLabel(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return 'No dates set';
  if (!start) return 'No start date';
  if (!end) return 'No end date';
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  if (b < a) return 'Ends before it starts';
  const days = Math.round((b - a) / 86_400_000) + 1;
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  const w = `${weeks} week${weeks === 1 ? '' : 's'}`;
  return rest === 0 ? `${days} days · ${w}` : `${days} days · ${w} ${rest}d`;
}

/** Analysis report: how hard the work is. Not the same as priority. */
export const COMPLEXITIES = ['low', 'medium', 'high'] as const;
export type Complexity = typeof COMPLEXITIES[number];

/**
 * The real ad types, from Siraj's chip lists. One combined vocabulary —
 * an ad is one of these, not a pair of type-plus-format.
 *
 * Order follows the two screenshots: the placement/engagement kinds first,
 * then the produced formats. `-Silent-` variants are distinct types, not a
 * flag, because that is how they are tracked today.
 *
 * Used for both the vendor subtask's ad type and the analysis report's
 * media type — they were always the same question asked twice.
 */
export const AD_TYPE_OPTIONS = [
  'Store Visit',
  'Store Visit -Silent-',
  'Home Ad',
  'Home Ad -Silent-',
  'Billboards',
  'Sponsorship',
  'Usage Rights',
  'Event Attending',
  'Paid promotion',
  'Logistics',
  'PhotoShot',
  'VideoShot',
  'Post',
  'Carousel Post',
  'Reel',
  'Story',
  'Video',
  'Live',
  'Media Production',
  'Quote Tweet',
] as const;
export type AdTypeOption = typeof AD_TYPE_OPTIONS[number];

/**
 * Kept as an alias so existing call sites keep working. The analysis
 * report's "media type" and a vendor's "ad type" are the same list.
 */
export const MEDIA_TYPES = AD_TYPE_OPTIONS;
export type MediaType = AdTypeOption;

/**
 * What the campaign's Ad type dropdown offers. Same list, plus the legacy
 * 'Multi Service' which triggers the free-text detail box.
 */
export const AD_TYPES = [...AD_TYPE_OPTIONS, AD_TYPE_NEEDS_DETAIL] as const;
export type AdType = typeof AD_TYPES[number];

/**
 * Kinds retired from the picker. Migration 047 renames 'ad' → 'vendor', but
 * the rest may still sit on rows created before the redesign, so the UI has
 * to be able to name them. Nothing new is ever created with these.
 */
export const LEGACY_SUBTASK_KIND_LABELS: Record<string, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  contract: 'Contracts / Vendoring',
  payment: 'Payment Confirmation',
  tracking: 'Tracking Sheet',
  ad: 'Vendor',
};

/** Display name for any subtask_kind, current or retired. */
export function subtaskKindLabel(kind: string | null | undefined): string {
  if (!kind) return '';
  return (SUBTASK_KIND_LABELS as Record<string, string>)[kind]
    ?? LEGACY_SUBTASK_KIND_LABELS[kind]
    ?? kind;
}

/**
 * Values that mean "this subtask is a vendor". 'ad' is the pre-047 spelling;
 * it is matched everywhere so a database that has not been migrated yet still
 * renames, rolls up and counts its vendors correctly.
 */
export const VENDOR_SUBTASK_KINDS = ['vendor', 'ad'] as const;

export function isVendorSubtaskKind(kind: string | null | undefined): boolean {
  return !!kind && (VENDOR_SUBTASK_KINDS as readonly string[]).includes(kind);
}

/**
 * Kinds that render the lean RequestCard instead of the generic details form.
 * Retired from the picker, but old rows must still render properly.
 */
export const REQUEST_SUBTASK_KINDS: string[] = ['quotation', 'invoice', 'contract'];

export function isRequestSubtaskKind(kind: string | null | undefined): boolean {
  return !!kind && REQUEST_SUBTASK_KINDS.includes(kind);
}

// ── Tracking sheet types (migration 036) ────────────────────────────

export type AdStatus = 'Not started' | 'Scheduled' | 'Shot' | 'Posted' | 'Cancelled';
export const AD_STATUSES: AdStatus[] = ['Not started', 'Scheduled', 'Shot', 'Posted', 'Cancelled'];

/** One row per ad / vendor deliverable in a campaign's tracking sheet. */
export interface TrackingRow {
  id: string;
  task_id: string;
  position: number;

  // Vendor / influencer
  influencer_name: string;
  profile_link: string;

  // Always-needed ad fields
  platform: string;
  type_of_ad: string;
  content: string;
  product: string;
  shooting_date: string | null;
  posting_date: string | null;
  ad_status: AdStatus;
  ad_link: string;

  // Pricing
  price_excl: number;
  price_incl: number;

  // Situational — Store Visit
  is_event: boolean;
  guest: string;
  location: string;
  visit_time: string;
  license_plate_url: string;

  // Situational — Home Ad
  contact_number: string;

  notes: string;

  created_at: string;
  updated_at: string;
}

// ── Operations lookup types (migration 028) ─────────────────────────

export interface TaskSource {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  created_at: string;
}

export interface ClientCategory {
  id: string;
  workspace_id: string;
  name: string;
  position: number;
  created_at: string;
}

/** One row per PARENT pm_task. Sum of children's price/net/gross. */
export interface PmTaskCampaignRollup {
  parent_task_id: string;
  workspace_id: string | null;
  title: string;
  brand_name: string | null;
  parent_total_amount: number | null;
  client_payment_status: string | null;
  contract_status: string | null;
  vendor_count: number;
  vendors_done: number;
  sum_prices: number;
  sum_nets: number;
  sum_aq_gross: number;
  /** sum_prices - parent_total_amount. Non-zero = data-entry mismatch. */
  price_vs_total_variance: number;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

// ============================================================
// Hooks
// ============================================================

/** Current user's role in the active workspace. Null while loading. */
export function useMyRole(workspaceId: string | null) {
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (force = false) => {
    if (!workspaceId) { setRole(null); setLoading(false); return; }
    const mine = await cachedFetch<WorkspaceRole | null>(`myRole:${workspaceId}`, async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) { logSbError('useMyRole', error, { workspaceId }); }
      return (data?.role as WorkspaceRole) ?? null;
    }, force);
    setRole(mine);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { role, loading, refetch };
}

/** Service-type templates and any workspace-custom ones, with their steps. */
export function useServiceTypes(workspaceId: string | null) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [steps, setSteps] = useState<ServiceTypeStep[]>([]);
  const [loading, setLoading] = useState(true);

  // Two queries, cached as one unit: the catalogue and its steps are only
  // meaningful together, and caching them apart would let a panel render
  // service types whose steps had not arrived.
  const fetch = useCallback(async (force = false) => {
    const { types: filtered, steps: stepRows } = await cachedFetch<{
      types: ServiceType[]; steps: ServiceTypeStep[];
    }>(`serviceTypes:${workspaceId ?? 'none'}`, async () => {
      // Templates (workspace_id NULL) + this workspace's customs
      let query = supabase.from('service_types').select('*').order('position', { ascending: true });
      const { data: types, error } = await query;
      if (error) logSbError('useServiceTypes types', error, { workspaceId });
      const list = (types || []).filter(
        (t: any) => t.workspace_id === null || t.workspace_id === workspaceId,
      ) as ServiceType[];
      if (!list.length) return { types: list, steps: [] };
      const { data: rows, error: stepErr } = await supabase
        .from('service_type_steps')
        .select('*')
        .in('service_type_id', list.map((t: any) => t.id))
        .order('position', { ascending: true });
      if (stepErr) logSbError('useServiceTypes steps', stepErr, { workspaceId });
      return { types: list, steps: (rows || []) as ServiceTypeStep[] };
    }, force);
    setServiceTypes(filtered);
    setSteps(stepRows);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { serviceTypes, steps, loading, refetch };
}

// ============================================================
// Tracking sheet (migration 036)
// ============================================================

const VAT_RATE = 0.15;

/** price incl 15% VAT, rounded to 2 dp. */
export function withVat(priceExcl: number): number {
  return Math.round(priceExcl * (1 + VAT_RATE) * 100) / 100;
}

/** A tracking-enabled campaign enriched with its sheet's row count + value. */
export type TrackingCampaign = PMTask & { row_count: number; total_incl: number };

/** Every campaign (top-level pm_task) flagged with a tracking sheet. */
export function useTrackingCampaigns(workspaceId: string | null) {
  const [items, setItems] = useState<TrackingCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('pm_tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('has_tracking', true)
      .is('parent_task_id', null)
      .order('created_at', { ascending: false });
    if (error) logSbError('useTrackingCampaigns', error, { workspaceId });

    const campaigns = (data || []) as PMTask[];

    // Roll up each campaign's tracking rows (count + total incl. VAT) in one query.
    const counts: Record<string, { row_count: number; total_incl: number }> = {};
    if (campaigns.length) {
      const ids = campaigns.map((c) => c.id);
      const { data: rowData, error: rowErr } = await supabase
        .from('tracking_rows')
        .select('task_id, price_incl')
        .in('task_id', ids);
      if (rowErr) logSbError('useTrackingCampaigns rows', rowErr, { workspaceId });
      for (const r of (rowData || []) as any[]) {
        const b = counts[r.task_id] ?? (counts[r.task_id] = { row_count: 0, total_incl: 0 });
        b.row_count += 1;
        b.total_incl += Number(r.price_incl || 0);
      }
    }

    setItems(campaigns.map((c) => ({
      ...c,
      row_count: counts[c.id]?.row_count ?? 0,
      total_incl: counts[c.id]?.total_incl ?? 0,
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/** All tracking rows for one campaign (parent pm_task), ordered. */
export function useTrackingRows(taskId: string | null) {
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('tracking_rows')
      .select('*')
      .eq('task_id', taskId)
      .order('position', { ascending: true });
    if (error) logSbError('useTrackingRows', error, { taskId });
    setRows((data || []) as TrackingRow[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { rows, loading, refetch: fetch };
}

/** Fields a caller may set on a tracking row (everything except server-managed keys). */
export type TrackingRowInput = Partial<Omit<TrackingRow, 'id' | 'task_id' | 'created_at' | 'updated_at' | 'price_incl'>>;

/** Insert a new tracking row at the end of the sheet. price_incl is derived. */
export async function createTrackingRow(taskId: string, input: TrackingRowInput) {
  // Next position = current max + 1.
  const { data: existing } = await supabase
    .from('tracking_rows')
    .select('position')
    .eq('task_id', taskId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = existing && existing.length ? (existing[0].position ?? 0) + 1 : 0;

  const priceExcl = Number(input.price_excl ?? 0);
  const payload = {
    ...input,
    task_id: taskId,
    position: input.position ?? nextPos,
    price_excl: priceExcl,
    price_incl: withVat(priceExcl),
  };
  const { data, error } = await supabase.from('tracking_rows').insert(payload).select().single();
  if (error) { logSbError('createTrackingRow', error, { taskId }); throw error; }
  return data as TrackingRow;
}

/** Patch a tracking row. If price_excl changes, price_incl is recomputed. */
export async function updateTrackingRow(rowId: string, input: TrackingRowInput) {
  const payload: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
  if (input.price_excl !== undefined) {
    payload.price_excl = Number(input.price_excl);
    payload.price_incl = withVat(Number(input.price_excl));
  }
  const { error } = await supabase.from('tracking_rows').update(payload).eq('id', rowId);
  if (error) { logSbError('updateTrackingRow', error, { rowId }); throw error; }
}

export async function deleteTrackingRow(rowId: string) {
  const { error } = await supabase.from('tracking_rows').delete().eq('id', rowId);
  if (error) { logSbError('deleteTrackingRow', error, { rowId }); throw error; }
}

/**
 * Operations workflow lookups (migration 028). Source + client category
 * are workspace-scoped admin-editable dropdowns used on parent campaigns.
 */
export function useTaskSources(workspaceId: string | null) {
  const [items, setItems] = useState<TaskSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Cached: this is a handful of rows that changes when an admin edits the
  // list, and it was being re-queried every time any panel opened.
  const fetch = useCallback(async (force = false) => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const rows = await cachedFetch<TaskSource[]>(`task_sources:${workspaceId}`, async () => {
      const { data, error } = await supabase
        .from('task_sources')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('position', { ascending: true });
      if (error) logSbError('useTaskSources', error, { workspaceId });
      return (data || []) as TaskSource[];
    }, force);
    setItems(rows);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { items, loading, refetch };
}

/** Platform options for the campaign multi-select (migration 042). */
export function useTaskPlatforms(workspaceId: string | null) {
  const [items, setItems] = useState<TaskSource[]>([]);
  const [loading, setLoading] = useState(true);

  // Cached: this is a handful of rows that changes when an admin edits the
  // list, and it was being re-queried every time any panel opened.
  const fetch = useCallback(async (force = false) => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const rows = await cachedFetch<TaskSource[]>(`task_platforms:${workspaceId}`, async () => {
      const { data, error } = await supabase
        .from('task_platforms')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('position', { ascending: true });
      if (error) logSbError('useTaskPlatforms', error, { workspaceId });
      return (data || []) as TaskSource[];
    }, force);
    setItems(rows);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { items, loading, refetch };
}

export function useClientCategories(workspaceId: string | null) {
  const [items, setItems] = useState<ClientCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Cached: this is a handful of rows that changes when an admin edits the
  // list, and it was being re-queried every time any panel opened.
  const fetch = useCallback(async (force = false) => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const rows = await cachedFetch<ClientCategory[]>(`client_categories:${workspaceId}`, async () => {
      const { data, error } = await supabase
        .from('client_categories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('position', { ascending: true });
      if (error) logSbError('useClientCategories', error, { workspaceId });
      return (data || []) as ClientCategory[];
    }, force);
    setItems(rows);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { items, loading, refetch };
}

/**
 * Per-parent campaign rollup view (migration 028). Returns one row per
 * top-level campaign with Σ price / net / aq_gross + vendor counts +
 * the variance between Σ prices and the manually-entered Total Amount
 * (`budget`). Non-zero variance is a data-entry sanity flag for ops.
 */
export function usePmTaskCampaignRollup(workspaceId: string | null) {
  const [rows, setRows] = useState<PmTaskCampaignRollup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pm_task_campaign_rollup')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('parent_task_id', { ascending: false });
    if (error) logSbError('usePmTaskCampaignRollup', error, { workspaceId });
    setRows((data || []) as PmTaskCampaignRollup[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { rows, loading, refetch: fetch };
}

/** CRUD for the task_sources lookup (admin-only via RLS). */
export async function createTaskSource(workspaceId: string, name: string, position: number) {
  const { data, error } = await supabase
    .from('task_sources')
    .insert({ workspace_id: workspaceId, name, position })
    .select('*').single();
  if (error) throw error;
  return data as TaskSource;
}
export async function updateTaskSource(id: string, fields: Partial<Pick<TaskSource, 'name' | 'position'>>) {
  const { error } = await supabase.from('task_sources').update(fields).eq('id', id);
  if (error) throw error;
}
export async function deleteTaskSource(id: string) {
  const { error } = await supabase.from('task_sources').delete().eq('id', id);
  if (error) throw error;
}

/** CRUD for the client_categories lookup (admin-only via RLS). */
export async function createClientCategory(workspaceId: string, name: string, position: number) {
  const { data, error } = await supabase
    .from('client_categories')
    .insert({ workspace_id: workspaceId, name, position })
    .select('*').single();
  if (error) throw error;
  return data as ClientCategory;
}
export async function updateClientCategory(id: string, fields: Partial<Pick<ClientCategory, 'name' | 'position'>>) {
  const { error } = await supabase.from('client_categories').update(fields).eq('id', id);
  if (error) throw error;
}
export async function deleteClientCategory(id: string) {
  const { error } = await supabase.from('client_categories').delete().eq('id', id);
  if (error) throw error;
}

/** Workspace members (for sales closer / key account / assignee dropdowns). */
export function useWorkspaceProfiles(workspaceId: string | null) {
  const [profiles, setProfiles] = useState<(Profile & { role: WorkspaceRole })[]>([]);
  const [loading, setLoading] = useState(true);

  // Cached. Every list that shows an assignee's name asks for this, so a
  // page with four such lists used to make four identical requests.
  const fetch = useCallback(async (force = false) => {
    if (!workspaceId) { setProfiles([]); setLoading(false); return; }
    const out = await cachedFetch<(Profile & { role: WorkspaceRole })[]>(
      `profiles:${workspaceId}`,
      async () => {
        const { data, error } = await supabase
          .from('workspace_members')
          .select('role, profile:profiles(id, full_name, avatar_url)')
          .eq('workspace_id', workspaceId);
        if (error) logSbError('useWorkspaceProfiles', error, { workspaceId });
        return (data || [])
          .filter((m: any) => m.profile)
          .map((m: any) => ({ ...m.profile, role: m.role as WorkspaceRole }));
      },
      force,
    );
    setProfiles(out);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  const refetch = useCallback(() => fetch(true), [fetch]);
  return { profiles, loading, refetch };
}

/** Workflow tasks in a workspace, optionally filtered by stage. */
export function useWorkflowTasks(workspaceId: string | null, stage?: TaskStage | 'all') {
  const [tasks, setTasks] = useState<PMTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setTasks([]); setLoading(false); return; }
    // Paged for the same reason the client list is: past 1000 campaigns this
    // silently stopped listing them, and a campaign missing from All Tasks
    // looks like a deleted campaign.
    const rows = await selectAllRows<PMTask>('useWorkflowTasks', () => {
      let query = supabase.from('pm_tasks').select('*')
        .eq('workspace_id', workspaceId).is('parent_task_id', null);
      if (stage && stage !== 'all') query = query.eq('stage', stage);
      return query.order('created_at', { ascending: false });
    });
    setTasks(rows);
    setLoading(false);
  }, [workspaceId, stage]);

  useEffect(() => { fetch(); }, [fetch]);
  return { tasks, loading, refetch: fetch };
}

/** Subtasks (child rows) for a parent task. */
export function useTaskSubtasks(parentTaskId: string | null) {
  const [subtasks, setSubtasks] = useState<PMTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!parentTaskId) { setSubtasks([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pm_tasks')
      .select('*')
      .eq('parent_task_id', parentTaskId)
      .order('position', { ascending: true });
    if (error) logSbError('useTaskSubtasks', error, { parentTaskId });
    setSubtasks((data || []) as PMTask[]);
    setLoading(false);
  }, [parentTaskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { subtasks, loading, refetch: fetch };
}

// ============================================================
// Mutations
// ============================================================

/** Sales: create a new task. Sets stage = pending_marketing — triggers
 * the on_pm_task_stage_change DB trigger which notifies marketing. */
export async function createSalesTask(input: {
  workspace_id: string;
  task_name: string;
  brand_name: string;
  /** Legacy text identifier kept for compat with the contract maker. */
  legacy_client_id?: string | null;
  /** FK to public.clients.id — set by the new dropdown picker. */
  client_id?: string | null;
  /** FK to public.client_brands.id — set by the new dropdown picker. */
  brand_id?: string | null;
  sales_closer_id?: string | null;
  /** Set instead of sales_closer_id when a NAMED influencer closed it (054). */
  sales_closer_vendor_id?: number | null;
  /** Set instead of both when an influencer closed it, unnamed (061). */
  sales_closer_influencer?: boolean | null;
  budget?: number | null;
  details?: string | null;
  creator_id: string;
}) {
  const { data, error } = await supabase
    .from('pm_tasks')
    .insert({
      workspace_id: input.workspace_id,
      title: input.task_name,
      task_name: input.task_name,
      brand_name: input.brand_name,
      legacy_client_id: input.legacy_client_id ?? null,
      client_id: input.client_id ?? null,
      brand_id: input.brand_id ?? null,
      sales_closer_id: input.sales_closer_id ?? null,
      sales_closer_vendor_id: input.sales_closer_vendor_id ?? null,
      sales_closer_influencer: input.sales_closer_influencer ?? false,
      budget: input.budget ?? null,
      description: input.details ?? null,
      creator_id: input.creator_id,
      stage: 'pending_marketing',
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;

  // The client's CRM timeline learns about this campaign without anybody
  // having to remember to write it down. Fire-and-forget: a timeline entry
  // must never be able to fail a campaign that is already saved.
  const created = data as PMTask;
  void logToClientTimeline(created.workspace_id, created.client_id, onCampaignCreated(created));

  return created;
}

/** Marketing: triage. Set priority + service types + key_account, advance stage,
 * and auto-spawn one child task per service-type step (across ALL chosen services).
 * If `selected_step_ids` is provided, only those steps are spawned. Otherwise all steps. */
export async function triageMarketingTask(input: {
  task_id: string;
  workspace_id: string;
  priority: TaskPriority;
  service_type_ids: string[];
  key_account_id: string;
  creator_id: string;
  selected_step_ids?: string[] | null;
}) {
  if (!input.service_type_ids.length) {
    throw new Error('Pick at least one service type.');
  }

  // 1. Update the parent task. Keep service_type_id pointing at the first one
  //    for backward compat with anything still reading the single column.
  const { error: updateErr } = await supabase
    .from('pm_tasks')
    .update({
      priority: input.priority,
      service_type_id: input.service_type_ids[0],
      key_account_id: input.key_account_id,
      stage: 'in_progress',
    })
    .eq('id', input.task_id);
  if (updateErr) throw updateErr;

  // 2. Replace junction rows.
  await supabase.from('task_service_types').delete().eq('task_id', input.task_id);
  const junctionRows = input.service_type_ids.map((id, idx) => ({
    task_id: input.task_id,
    service_type_id: id,
    position: idx,
  }));
  const { error: jErr } = await supabase.from('task_service_types').insert(junctionRows);
  if (jErr) throw jErr;

  // 3. For each service type, fetch its steps and spawn child tasks. Prefix each
  //    title with the service-type label so the inbox shows "Campaign — Visuals".
  //    If selected_step_ids is provided, only spawn those specific steps.
  //
  //    An EMPTY array means "spawn nothing", and is not the same as the key
  //    being absent. This used to be `length > 0`, so deselecting every
  //    subtask in triage fell through to the else branch and spawned the
  //    entire catalog — the exact opposite of what the user asked for.
  //    Only null/undefined now means "all steps".
  const selectedSet = input.selected_step_ids != null
    ? new Set(input.selected_step_ids)
    : null;

  for (const stId of input.service_type_ids) {
    const { data: steps, error: stepsErr } = await supabase
      .from('service_type_steps')
      .select('*')
      .eq('service_type_id', stId)
      .order('position', { ascending: true });
    if (stepsErr) throw stepsErr;
    if (!steps || !steps.length) continue;

    // Filter steps if the caller specified which ones to include.
    const filteredSteps = selectedSet
      ? steps.filter((s: any) => selectedSet.has(s.id))
      : steps;
    if (!filteredSteps.length) continue;

    const { data: stMeta } = await supabase
      .from('service_types')
      .select('name, icon')
      .eq('id', stId)
      .maybeSingle();
    const prefix = stMeta ? `${stMeta.icon ?? ''} ${stMeta.name} — ` : '';

    const rows = filteredSteps.map((s: any) => ({
      workspace_id: input.workspace_id,
      parent_task_id: input.task_id,
      title: `${prefix}${s.title}`,
      description: s.description ?? null,
      position: s.position,
      stage: 'in_progress' as TaskStage,
      status: 'pending',
      priority: input.priority,
      creator_id: input.creator_id,
      // Match the step to a typed form. Inferred from the UNPREFIXED title,
      // because `prefix` is cosmetic and varies per service type.
      subtask_kind: subtaskKindFromStepTitle(s.title),
      request_status: 'not_requested',
    }));
    const { error: insertErr } = await supabase.from('pm_tasks').insert(rows);
    if (insertErr) throw insertErr;
  }

  // has_tracking is deliberately NOT touched here. It used to be derived from
  // whether the "Tracking Sheet" common step was picked at triage, but that
  // step was removed in migration 044 — the sheet is now switched on with a
  // button on the parent. Writing it here would clear the flag on every
  // re-triage and silently switch off a sheet someone had turned on.
}

/**
 * Add a single subtask to a parent, outside the triage template flow.
 *
 * Triage bulk-inserts every step of the chosen service types; this is the
 * per-campaign escape hatch (Phase 2) so a parent can gain or lose one
 * subtask without re-triaging. Appends at the end of the sibling order.
 */
export async function createSubtask(input: {
  parent_task_id: string;
  workspace_id: string;
  creator_id: string;
  /** null = a plain subtask with no special rendering. */
  kind: SubtaskKind | null;
  title: string;
  priority?: TaskPriority;
  description?: string | null;
}) {
  const title = input.title.trim();
  if (!title) throw new Error('Give the subtask a name.');

  // Next position = current max among siblings + 1. Matches createTrackingRow.
  const { data: existing } = await supabase
    .from('pm_tasks')
    .select('position')
    .eq('parent_task_id', input.parent_task_id)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = existing && existing.length ? ((existing[0] as any).position ?? 0) + 1 : 0;

  const { data, error } = await supabase
    .from('pm_tasks')
    .insert({
      workspace_id: input.workspace_id,
      parent_task_id: input.parent_task_id,
      title,
      description: input.description ?? null,
      position: nextPos,
      stage: 'in_progress' as TaskStage,
      status: 'pending',
      priority: input.priority ?? 'medium',
      creator_id: input.creator_id,
      subtask_kind: input.kind,
      // Column is NOT NULL DEFAULT 'not_requested' (migration 038) — set it
      // explicitly so the row reads the same whether or not the default fires.
      request_status: 'not_requested',
    })
    .select()
    .single();
  if (error) { logSbError('createSubtask', error, { parent: input.parent_task_id }); throw error; }

  // has_tracking is deliberately NOT touched here any more. The tracking
  // sheet is a toggle on the parent task now, not a subtask kind, so a
  // subtask must never switch it on or off behind the user's back.

  return data as PMTask;
}

// ── Tracking sheet publishing (migration 045) ───────────────────────
//
// Two sheets: the working one in tracking_rows, and a published snapshot in
// tracking_rows_published that the client sees through the external portal.
// Both mutators go through SECURITY DEFINER functions so the replace-all
// happens in one transaction — a client can never catch a half-written sheet.

/** Copy the working sheet to the client-facing one. Returns rows published. */
export async function publishTrackingSheet(taskId: string): Promise<number> {
  const { data, error } = await supabase.rpc('publish_tracking_sheet', { p_task_id: taskId });
  if (error) { logSbError('publishTrackingSheet', error, { taskId }); throw error; }
  return Number(data ?? 0);
}

/** Withdraw the client-facing copy entirely. */
export async function unpublishTrackingSheet(taskId: string): Promise<void> {
  const { error } = await supabase.rpc('unpublish_tracking_sheet', { p_task_id: taskId });
  if (error) { logSbError('unpublishTrackingSheet', error, { taskId }); throw error; }
}

/** The published snapshot for a campaign — what the client currently sees. */
export function usePublishedTrackingRows(taskId: string | null) {
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setRows([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('tracking_rows_published')
      .select('*')
      .eq('task_id', taskId)
      .order('position', { ascending: true });
    if (error) logSbError('usePublishedTrackingRows', error, { taskId });
    setRows((data || []) as TrackingRow[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { rows, loading, refetch: fetch };
}

/**
 * Give an influencer/UGC vendor a row on the campaign's tracking sheet.
 *
 * Called when a vendor is picked on a subtask. Idempotent by vendor name —
 * re-picking the same vendor, or changing an unrelated field, will not add a
 * second row. Returns true only when a row was actually created.
 *
 * Deliberately quiet: a tracking sheet is a nicety, and a failure here must
 * never block the vendor assignment or the contract request that follows it.
 */
export async function ensureTrackingRowForVendor(input: {
  parent_task_id: string;
  vendor_name: string;
  platform?: string | null;
  price_excl?: number | null;
  /** The vendor's registered profile / handle, if they have one on file. */
  profile_link?: string | null;
  /** The subtask's ad type — or the campaign's, if the subtask inherits it. */
  type_of_ad?: string | null;
  /** What the campaign is selling, for the Product column. */
  product?: string | null;
}): Promise<boolean> {
  const name = (input.vendor_name ?? '').trim();
  if (!name) return false;
  try {
    const { data: existing } = await supabase
      .from('tracking_rows')
      .select('id, position, influencer_name')
      .eq('task_id', input.parent_task_id);

    const already = (existing ?? []).some(
      (r: any) => (r.influencer_name ?? '').trim().toLowerCase() === name.toLowerCase(),
    );
    if (already) return false;

    const nextPos = (existing ?? []).reduce(
      (max: number, r: any) => Math.max(max, Number(r.position) || 0), -1) + 1;

    // Fill in what we already know; leave the rest genuinely blank.
    //
    // Siraj: "filled out with the data that we have and the ones we dont
    // have dont fill any data". So no placeholder text — an empty cell has
    // to mean "nobody has entered this", otherwise the sheet stops being a
    // to-do list.
    //
    // price_excl is the exception and stays as it was: createTrackingRow
    // coerces it to 0, and tracking_rows.price_excl may be NOT NULL (036
    // isn't in this working copy, so I haven't confirmed it can take null).
    // A vendor with no price therefore still shows 0 rather than empty.
    // Worth fixing once the column's nullability is known.
    const price = Number(input.price_excl);
    const clean = (v: string | null | undefined) => {
      const s = (v ?? '').trim();
      return s || undefined;
    };

    await createTrackingRow(input.parent_task_id, {
      position: nextPos,
      influencer_name: name,
      platform: clean(input.platform),
      profile_link: clean(input.profile_link),
      type_of_ad: clean(input.type_of_ad),
      product: clean(input.product),
      price_excl: Number.isFinite(price) && input.price_excl != null ? price : undefined,
    } as any);
    return true;
  } catch (e) {
    logSbError('ensureTrackingRowForVendor', e as any, { parent: input.parent_task_id, name });
    return false;
  }
}

/** Categories whose work the client tracks. Mirrors vendor_is_trackable() in 045. */
const TRACKABLE_VENDOR_CATEGORIES = ['influencer', 'ugc', 'ugc creator', 'user generated content'];
export function isTrackableVendorCategory(category: string | null | undefined): boolean {
  return TRACKABLE_VENDOR_CATEGORIES.includes((category ?? '').trim().toLowerCase());
}

/**
 * A vendor's category, from wherever it actually lives.
 *
 * Two columns hold this. `vendor_category` is legacy free text; `category_id`
 * is the FK added in 029 and is what the registration form writes now. Most
 * of the vendor book has one or the other, and plenty have neither — of 495
 * vendors in production, only some carry a category at all.
 *
 * Reading only `vendor_category`, as everything here used to, silently read
 * "no category" for every vendor registered since 029.
 */
export function vendorCategoryKey(
  vendor: { vendor_category?: string | null; category_id?: string | null } | null,
  categories: { id: string; key: string }[] = [],
): string | null {
  if (!vendor) return null;
  const legacy = (vendor.vendor_category ?? '').trim();
  if (legacy) return legacy;
  if (vendor.category_id) {
    const found = categories.find((c) => c.id === vendor.category_id);
    if (found) return found.key;
  }
  return null;
}

/**
 * Categories that do NOT belong on a client-facing tracking sheet. Printing,
 * logistics, rentals and the rest are how the work gets made; the sheet is
 * what the client sees running.
 */
const UNTRACKED_VENDOR_CATEGORIES = [
  'props', 'makeup_artist', 'makeup artist', 'logistics', 'rentals', 'rental',
  'events', 'location', 'printing', 'media production', 'production',
];

/**
 * Should assigning this vendor put a row on the campaign's tracking sheet?
 *
 * **Unknown means yes.** This is deliberately not `isTrackableVendorCategory`.
 * That one answers "does this vendor owe an insight / a licence", where
 * guessing wrong nags somebody for data they don't have, so silence is the
 * safe default. Here the cost is reversed: guessing wrong means the vendor
 * quietly never reaches the sheet, which is exactly the bug Siraj hit —
 * "I added a vendor in the sub task why didnt it get added in the tracking
 * sheet". A row nobody wanted can be deleted in a second; a row that never
 * appeared is invisible.
 *
 * So only a category we positively recognise as off-sheet is skipped.
 */
export function shouldTrackVendorOnSheet(category: string | null | undefined): boolean {
  const key = (category ?? '').trim().toLowerCase();
  if (!key) return true;                                  // uncategorised → track it
  if (TRACKABLE_VENDOR_CATEGORIES.includes(key)) return true;
  return !UNTRACKED_VENDOR_CATEGORIES.includes(key);
}

// ── Finding a vendor ────────────────────────────────────────────────
//
// Siraj: "if influencer or ugc it will be license if other it will be id
// or name ... only change is ugc or influencer we use name or license".
//
// So the searchable identifier depends on the vendor's OWN category, not
// on a mode the user picks. An influencer is found by name or licence; a
// printer or a logistics company by name or ID. One search box, and each
// row carries the right key — nobody has to know which field to try.

/** Which identifier identifies this vendor, given their category. */
export function vendorIdentifierKind(category: string | null | undefined): 'license' | 'id' {
  return isTrackableVendorCategory(category) ? 'license' : 'id';
}

/** The identifier itself, or null when it hasn't been registered yet. */
export function vendorIdentifier(v: {
  license_number?: string | null;
  id_number?: string | null;
  vendor_category?: string | null;
}): { kind: 'license' | 'id'; value: string | null } {
  const kind = vendorIdentifierKind(v.vendor_category);
  const raw = kind === 'license' ? v.license_number : v.id_number;
  return { kind, value: (raw ?? '').trim() || null };
}

/** Influencer and UGC work produces an insight; nothing else does. */
export function vendorNeedsInsight(category: string | null | undefined): boolean {
  return isTrackableVendorCategory(category);
}

/**
 * What picking THIS vendor means you now need to fill in.
 *
 * Siraj: "it will ask for the relevant data for example influencer we need
 * the insight and their data for the contracts and tracking sheet". So the
 * ask follows the vendor's category rather than showing every field to
 * everyone — a printing vendor is never asked for a profile link.
 *
 * Returns what is still OUTSTANDING, so an empty list means done.
 */
export function vendorDataRequirements(
  subtask: PMTask | null,
  vendor: LegacyVendor | null,
): MissingRequirement[] {
  if (!subtask || !vendor) return [];
  const out: MissingRequirement[] = [];
  const has = (v: unknown) => typeof v === 'string' ? v.trim().length > 0 : v != null;
  const onVendor = `Vendors → ${vendor.name}`;

  // Everyone: the money, because it drives the contract and the rollup.
  if (!Number.isFinite(Number(subtask.price)) || subtask.price == null) {
    out.push({ label: 'Price', where: 'this subtask' });
  }
  if (!Number.isFinite(Number(subtask.net_amount)) || subtask.net_amount == null) {
    out.push({ label: 'Net amount', where: 'this subtask' });
  }

  if (vendorNeedsInsight(vendor.vendor_category)) {
    // Influencer / UGC: the tracking sheet and the insight are the point.
    if (!has(subtask.platform)) out.push({ label: 'Platform', where: 'this subtask' });
    if (!has(subtask.ad_type))  out.push({ label: 'Ad type', where: 'this subtask' });
    if (!subtask.insight_attached && !has(subtask.insight_link)) {
      out.push({ label: 'Insight', where: 'this subtask' });
    }
    if (!has((vendor as any).platforms)) {
      out.push({ label: 'Their profile / platforms', where: onVendor });
    }
  }

  return out;
}

/**
 * Enter it once.
 *
 * Siraj: "all data relevent for both sub task and parent task should be
 * inputed once". Platform and ad type are asked on the campaign AND on
 * every vendor under it; typing them twice is how they end up disagreeing.
 *
 * A vendor subtask with nothing of its own reads through to the campaign.
 * Setting a value on the subtask overrides it for that vendor only — which
 * is what you want when one influencer runs a Story and the rest run Reels.
 */
export function inheritedFromCampaign(
  own: string | null | undefined,
  fromParent: string | null | undefined,
): { value: string | null; inherited: boolean } {
  const mine = (own ?? '').trim();
  if (mine) return { value: mine, inherited: false };
  const theirs = (fromParent ?? '').trim();
  return { value: theirs || null, inherited: Boolean(theirs) };
}

/** The campaign's platform list as one string, for a subtask's text field. */
export function campaignPlatformText(parent: PMTask | null): string | null {
  const list = parent?.platforms ?? [];
  return list.length ? list.join(', ') : null;
}

/**
 * A vendor as the picker should show and match it.
 *
 * `hint` is the visible second line — it's what tells two vendors with the
 * same name apart. `keywords` is matched but not shown: BOTH identifiers go
 * in, so a licence typed against a vendor filed under the wrong category
 * still finds them. Being strict about which field you may search would
 * only punish whoever mis-filed the vendor.
 */
export function vendorPickerOption(v: LegacyVendor): {
  value: string; label: string; hint: string | null; keywords: string;
} {
  const { kind, value } = vendorIdentifier(v as any);
  const category = (v.vendor_category ?? '').trim();
  const idLabel = kind === 'license' ? 'Licence' : 'ID';
  const hint = [
    category || null,
    value ? `${idLabel} ${value}` : `No ${idLabel.toLowerCase()} on file`,
  ].filter(Boolean).join(' · ');
  return {
    value: String(v.id),
    label: v.name,
    hint,
    keywords: [v.license_number, v.id_number, v.vat_number, category]
      .filter(Boolean).join(' '),
  };
}


// ── Ad lines inside a vendor subtask (migration 056) ────────────────
//
// A Package Ad is one booking with several ads in it. The subtask holds the
// vendor, the money and the contract; the lines hold what was actually
// booked — six home ads, six store visits, three free reminders — and the
// contract is written from them.

export type { AdLine } from '@/lib/ad-lines';

export function useVendorAdLines(subtaskId: string | null) {
  const [lines, setLines] = useState<AdLine[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!subtaskId) { setLines([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('vendor_ad_lines')
      .select('*')
      .eq('subtask_id', subtaskId)
      .order('position', { ascending: true });
    if (error) logSbError('useVendorAdLines', error, { subtaskId });
    setLines((data || []) as AdLine[]);
    setLoading(false);
  }, [subtaskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { lines, loading, refetch: fetch };
}

/** Read the lines outside React — used when building a contract request. */
export async function fetchVendorAdLines(subtaskId: string): Promise<AdLine[]> {
  const { data, error } = await supabase
    .from('vendor_ad_lines')
    .select('*')
    .eq('subtask_id', subtaskId)
    .order('position', { ascending: true });
  if (error) { logSbError('fetchVendorAdLines', error, { subtaskId }); return []; }
  return (data || []) as AdLine[];
}

/**
 * The columns an insert may set. Written once so createAdLine and the bulk
 * insert cannot drift: the first version of this listed six fields and
 * silently dropped the due date and brief that 057 had just added, which
 * looks exactly like the save failing to stick.
 */
function adLineInsertRow(input: AdLine) {
  return {
    subtask_id: input.subtask_id,
    position: input.position ?? 0,
    ad_type: (input.ad_type ?? '').trim(),
    platform: input.platform ?? null,
    quantity: input.quantity ?? 1,
    unit_price: input.unit_price ?? 0,
    notes: input.notes ?? null,
    due_date: input.due_date ?? null,
    description: input.description ?? null,
    status: input.status ?? 'Not started',
  };
}

export async function createAdLine(input: AdLine): Promise<AdLine> {
  const { data, error } = await supabase
    .from('vendor_ad_lines')
    .insert(adLineInsertRow(input))
    .select()
    .single();
  if (error) { logSbError('createAdLine', error, { subtask: input.subtask_id }); throw error; }
  return data as AdLine;
}

/**
 * Several ads in one insert.
 *
 * One statement, not a loop: six round trips can fail on the fourth and
 * leave a half-made booking that nobody asked for. Here the batch either
 * lands or it does not.
 */
export async function createAdLines(inputs: AdLine[]): Promise<AdLine[]> {
  if (!inputs.length) return [];
  const { data, error } = await supabase
    .from('vendor_ad_lines')
    .insert(inputs.map(adLineInsertRow))
    .select();
  if (error) {
    logSbError('createAdLines', error, { subtask: inputs[0]?.subtask_id, count: inputs.length });
    throw error;
  }
  return (data || []) as AdLine[];
}

/**
 * Every ad under a set of vendor bookings, grouped by booking.
 *
 * The campaign panel needs this to know what to chase: proof now lives on
 * the ad, so "is this campaign finished" cannot be answered from the
 * subtask rows alone. Empty list in, empty map out — no query.
 */
export async function fetchAdLinesForSubtasks(
  subtaskIds: string[],
): Promise<Map<string, AdLine[]>> {
  const out = new Map<string, AdLine[]>();
  const ids = (subtaskIds || []).filter(Boolean);
  if (!ids.length) return out;
  const rows = await selectAllRows<AdLine>(
    'fetchAdLinesForSubtasks',
    () => supabase
      .from('vendor_ad_lines')
      .select('*')
      .in('subtask_id', ids)
      .order('position', { ascending: true }),
  );
  for (const r of rows) {
    const key = (r as any).subtask_id as string;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(r);
  }
  return out;
}

/** The same, as a hook. Re-runs when the set of bookings changes. */
export function useAdLinesForSubtasks(subtaskIds: string[]) {
  const key = subtaskIds.slice().sort().join(',');
  const [bySubtask, setBySubtask] = useState<Map<string, AdLine[]>>(new Map());

  const fetch = useCallback(async () => {
    setBySubtask(await fetchAdLinesForSubtasks(key ? key.split(',') : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { fetch(); }, [fetch]);
  return { bySubtask, refetch: fetch };
}

export async function updateAdLine(id: string, fields: Partial<AdLine>): Promise<void> {
  // line_total is generated — sending it back would be rejected by Postgres.
  const { line_total, id: _id, subtask_id, ...rest } = fields as any;
  const { error } = await supabase.from('vendor_ad_lines').update(rest).eq('id', id);
  if (error) { logSbError('updateAdLine', error, { id }); throw error; }
}

/**
 * Fill the booking's Price in from its ads — without locking it.
 *
 * The booking's `price` is what everything else already reads: the campaign
 * money roll-up, the vendor report, the dashboards. Adding up the ads by
 * hand and retyping the answer is a step nobody should have to take, and the
 * one time it gets skipped the booking is worth less than the work inside it.
 *
 * So it is written, and it stays a normal typed field. Siraj's rule: the
 * breakdown goes to the total automatically, but the total is still editable.
 * Type over it and it stands — until the next time an ad's price changes,
 * which writes again. That is the trade: automatic means automatic.
 *
 * With no ads, nothing is written. A booking priced by hand keeps its price;
 * zeroing it because somebody deleted a trial ad would wipe a real number.
 */
export async function syncBookingPriceFromAds(subtaskId: string): Promise<number | null> {
  const lines = await fetchVendorAdLines(subtaskId);
  if (!lines.length) return null;
  const { amount } = totalsOf(lines);
  await updateTaskFields(subtaskId, { price: amount } as any);
  return amount;
}

export async function deleteAdLine(id: string): Promise<void> {
  const { error } = await supabase.from('vendor_ad_lines').delete().eq('id', id);
  if (error) { logSbError('deleteAdLine', error, { id }); throw error; }
}

// ── Campaign money rollup (migration 042) ───────────────────────────

export interface CampaignMoney {
  /** Sum of every subtask's price — the "with breakdown" total. */
  breakdown: number;
  /** Sum of every subtask's net_amount — what the vendors actually take. */
  net: number;
  /** breakdown - net. Matches what aq_gross means per subtask. */
  aqGross: number;
  /** How many subtasks carried a price or a net, so the UI can say "from N vendors". */
  vendorCount: number;
}

/**
 * Roll the per-vendor figures up to the campaign. Pure function over the
 * subtasks already loaded by useTaskSubtasks — no extra query, and it
 * recomputes the moment a vendor line changes.
 */
export function rollupCampaignMoney(subtasks: PMTask[]): CampaignMoney {
  let breakdown = 0, net = 0, vendorCount = 0;
  for (const s of subtasks) {
    const p = Number(s.price);
    const n = Number(s.net_amount);
    const hasP = Number.isFinite(p) && s.price != null;
    const hasN = Number.isFinite(n) && s.net_amount != null;
    if (hasP) breakdown += p;
    if (hasN) net += n;
    if (hasP || hasN) vendorCount += 1;
  }
  return { breakdown, net, aqGross: breakdown - net, vendorCount };
}

// ── Package Ad naming (Phase 5) ─────────────────────────────────────

/** The name a vendor subtask gets once its vendor is known: "{brand} — {vendor}". */
export function vendorSubtaskTitle(brandName: string | null, vendorName: string | null): string {
  const brand = (brandName ?? '').trim();
  const vendor = (vendorName ?? '').trim();
  if (brand && vendor) return `${brand} — ${vendor}`;
  if (vendor) return vendor;
  if (brand) return `${brand} — ${SUBTASK_KIND_LABELS.vendor}`;
  return SUBTASK_KIND_LABELS.vendor;
}

/**
 * Whether a vendor subtask's title is still machine-generated and therefore
 * safe to overwrite. A name somebody typed by hand is left alone.
 *
 * Auto titles are: "Vendor", "Vendor 3", or anything previously auto-named
 * for this brand ("{brand} — …"). The pre-047 spellings "Ad" / "Ad 3" /
 * "{brand} — Ad" count too, so renaming still works on rows created before
 * the rename and on a database where migration 047 has not run yet.
 */
export function isAutoVendorTitle(title: string | null, brandName: string | null): boolean {
  const t = (title ?? '').trim();
  if (!t) return true;
  if (t === SUBTASK_KIND_LABELS.vendor || t === 'Ad') return true;
  if (/^(?:Vendor|Ad) \d+$/i.test(t)) return true;
  const brand = (brandName ?? '').trim();
  if (brand && t.startsWith(`${brand} —`)) return true;
  return false;
}

// ── Bulk vendor creation (the "add 50 vendors" popup) ───────────────
//
// A Package Ad sold as 50 or 100 ads used to mean 50 trips through a form.
// This creates the whole batch in ONE insert with shared ad type, platform
// and price, leaving the vendor itself blank — 50 ads usually means 50
// different influencers, and they get picked one at a time afterwards.

/** Whether the batch is influencer/UGC work, which changes what gets prefilled. */
export const VENDOR_FORMATS = ['influencer', 'ugc', 'other'] as const;
export type VendorFormat = typeof VENDOR_FORMATS[number];

export const VENDOR_FORMAT_LABELS: Record<VendorFormat, string> = {
  influencer: 'Influencer',
  ugc: 'UGC',
  other: 'Other (printing, billboard, production…)',
};

/** Influencer and UGC work is what the tracking sheet exists to track. */
export function formatIsTrackable(format: VendorFormat): boolean {
  return format === 'influencer' || format === 'ugc';
}

/**
 * The default name for the nth vendor row of a batch.
 *
 * No vendor is known yet, so it numbers instead: "{brand} — Vendor 7", or
 * "Vendor 7" with no brand. Both shapes are recognised by isAutoVendorTitle,
 * so assigning a real vendor later still renames the row to
 * "{brand} — {vendor}". That round trip is the whole point of the format.
 */
export function batchVendorTitle(brandName: string | null, n: number): string {
  const brand = (brandName ?? '').trim();
  const label = `${SUBTASK_KIND_LABELS.vendor} ${n}`;
  return brand ? `${brand} — ${label}` : label;
}

export interface VendorBatchRow {
  /** Editable in the popup. Blank falls back to the generated name. */
  title: string;
}

/**
 * Create a batch of vendor subtasks in one insert.
 *
 * Returns the number created. One round trip regardless of size — 100 rows
 * is one request, not 100, which is the difference between instant and a
 * minute of spinner.
 */
export async function createVendorBatch(input: {
  parent_task_id: string;
  workspace_id: string;
  creator_id: string;
  rows: VendorBatchRow[];
  brand_name?: string | null;
  priority?: TaskPriority;
  /** Written to both ad_type (free text) and media_type (constrained). */
  ad_type?: string | null;
  /** Joined into the subtask's free-text platform field. */
  platforms?: string[];
  /** Price per vendor, not a total to divide. */
  price_per_vendor?: number | null;
  format?: VendorFormat;
}): Promise<number> {
  const rows = input.rows.filter((r) => r != null);
  if (!rows.length) return 0;
  if (rows.length > 200) {
    throw new Error('That is more than 200 vendors in one go — split it into batches.');
  }

  // Continue the existing numbering rather than restarting at 1.
  const { data: existing, error: exErr } = await supabase
    .from('pm_tasks')
    .select('id')
    .eq('parent_task_id', input.parent_task_id)
    .in('subtask_kind', VENDOR_SUBTASK_KINDS as unknown as string[]);
  if (exErr) { logSbError('createVendorBatch:count', exErr, { parent: input.parent_task_id }); throw exErr; }
  const have = existing?.length ?? 0;

  const { data: last } = await supabase
    .from('pm_tasks')
    .select('position')
    .eq('parent_task_id', input.parent_task_id)
    .order('position', { ascending: false })
    .limit(1);
  let nextPos = last && last.length ? ((last[0] as any).position ?? 0) + 1 : 0;

  const platformText = (input.platforms ?? []).join(', ').trim() || null;
  const adType = (input.ad_type ?? '').trim() || null;
  const price = Number.isFinite(Number(input.price_per_vendor)) && input.price_per_vendor != null
    ? Number(input.price_per_vendor)
    : null;

  // media_type carries a CHECK constraint (048); ad_type is free text. Only
  // write media_type when the choice is actually one of the allowed values,
  // otherwise a custom ad type would be rejected by the database.
  const mediaType = adType && (MEDIA_TYPES as readonly string[]).includes(adType) ? adType : null;

  const payload = rows.map((r, i) => ({
    workspace_id: input.workspace_id,
    parent_task_id: input.parent_task_id,
    title: r.title.trim() || batchVendorTitle(input.brand_name ?? null, have + i + 1),
    position: nextPos++,
    stage: 'in_progress' as TaskStage,
    status: 'pending',
    priority: input.priority ?? 'medium',
    creator_id: input.creator_id,
    subtask_kind: 'vendor',
    request_status: 'not_requested',
    ad_type: adType,
    media_type: mediaType,
    platform: platformText,
    price,
  }));

  const { error } = await supabase.from('pm_tasks').insert(payload);
  if (error) { logSbError('createVendorBatch:insert', error, { parent: input.parent_task_id }); throw error; }
  return payload.length;
}

/**
 * Top the parent up to `targetCount` vendor subtasks, appending at the end of
 * the sibling order. Never deletes: lowering the quantity leaves existing ones
 * alone, because they may already carry a vendor, a budget and a contract
 * request. Returns how many were created.
 */
export async function ensureVendorSubtasks(input: {
  parent_task_id: string;
  workspace_id: string;
  creator_id: string;
  target_count: number;
  brand_name?: string | null;
  priority?: TaskPriority;
}): Promise<number> {
  const target = Math.floor(Number(input.target_count));
  if (!Number.isFinite(target) || target <= 0) return 0;

  const { data: existing, error: exErr } = await supabase
    .from('pm_tasks')
    .select('id, position')
    .eq('parent_task_id', input.parent_task_id)
    // Both spellings: a workspace that has not run 047 yet still counts right.
    .in('subtask_kind', VENDOR_SUBTASK_KINDS as unknown as string[]);
  if (exErr) { logSbError('ensureVendorSubtasks:count', exErr, { parent: input.parent_task_id }); throw exErr; }

  const have = existing?.length ?? 0;
  const missing = target - have;
  if (missing <= 0) return 0;

  const { data: last } = await supabase
    .from('pm_tasks')
    .select('position')
    .eq('parent_task_id', input.parent_task_id)
    .order('position', { ascending: false })
    .limit(1);
  let nextPos = last && last.length ? ((last[0] as any).position ?? 0) + 1 : 0;

  const rows = Array.from({ length: missing }, (_, i) => ({
    workspace_id: input.workspace_id,
    parent_task_id: input.parent_task_id,
    // Numbered from the existing count so re-topping-up doesn't reuse labels.
    title: `${SUBTASK_KIND_LABELS.vendor} ${have + i + 1}`,
    position: nextPos++,
    stage: 'in_progress' as TaskStage,
    status: 'pending',
    priority: input.priority ?? 'medium',
    creator_id: input.creator_id,
    subtask_kind: 'vendor',
    request_status: 'not_requested',
  }));

  const { error } = await supabase.from('pm_tasks').insert(rows);
  if (error) { logSbError('ensureVendorSubtasks:insert', error, { parent: input.parent_task_id }); throw error; }
  return missing;
}

// ── Analysis report: what's inherited vs. what's typed ──────────────
//
// Brand, campaign name and platforms are NOT stored on the subtask. They
// are read through to the parent, so renaming the campaign renames it
// everywhere and there is never a stale copy to reconcile.
//
// Priority is the exception Siraj called out explicitly — "priority not
// auto added from parent task" — so it stays whatever the subtask says.

export interface AnalysisReportInherited {
  brandName: string | null;
  campaignName: string | null;
  platforms: string[];
}

export function analysisReportInherited(parent: PMTask | null): AnalysisReportInherited {
  return {
    brandName: parent?.brand_name ?? null,
    campaignName: parent?.task_name ?? parent?.title ?? null,
    platforms: parent?.platforms ?? [],
  };
}

/**
 * The platforms an analysis report actually covers.
 *
 * Starts as the parent's list, but the subtask may narrow or extend it —
 * `platforms` on the child row is the override. A child row that has
 * never been touched has an empty array, which reads as "same as parent"
 * rather than "no platforms", because an empty override is indistinguishable
 * from an untouched one and defaulting to nothing would silently blank the
 * inherited list the first time somebody opened the form.
 */
export function effectiveAnalysisPlatforms(subtask: PMTask | null, parent: PMTask | null): string[] {
  const own = subtask?.platforms ?? [];
  if (own.length > 0) return own;
  return parent?.platforms ?? [];
}

// ── Completeness: warn, never block ─────────────────────────────────
//
// Proof of posting, the analysis report and the insight are "always
// required" — but required as in "somebody should chase this", not as in
// "the database refuses the row". Siraj chose warn-don't-block, so this
// returns strings for the UI and nothing enforces anything.

export interface CompletenessWarning {
  key: 'proof_of_posting' | 'analysis_report' | 'insight';
  message: string;
}

export function campaignCompletenessWarnings(
  parent: PMTask | null,
  subtasks: PMTask[],
  opts: {
    /**
     * Does this task's service type actually expect an analysis report?
     *
     * Derived from the catalogue via catalogExpectsKind(). Without this the
     * panel nagged EVERY parent — a Package Ad was told off for having no
     * analysis report, which was only ever specified for Campaign.
     *
     * Note this is separate from whether one can be ADDED: the picker offers
     * analysis reports everywhere, because "you may" and "you must" are
     * different questions and conflating them is what caused the bug.
     */
    expectsAnalysisReport?: boolean;
    /**
     * Vendor ids whose category actually produces an insight (influencer,
     * UGC). Omit to expect one from every vendor, which is only right if
     * you know they're all influencer work.
     */
    insightVendorIds?: Set<number>;
    /**
     * The ads inside each vendor booking, keyed by subtask id.
     *
     * Proof of posting is per ad (migration 058). A booking with ads is
     * chased ad by ad; a booking without them is chased as one thing, which
     * is right for a vendor hired to do a single piece of work.
     *
     * Omit it and every booking is treated as a single piece — the old
     * behaviour, and correct for anyone who never uses ad lines.
     */
    adLinesBySubtask?: Map<string, AdLine[]>;
  } = {},
): CompletenessWarning[] {
  if (!parent) return [];
  const out: CompletenessWarning[] = [];

  // Proof of posting moved off the campaign and onto each influencer / UGC
  // vendor (Aug 2026). One campaign has many influencers and each posts their
  // own thing, so a single campaign-level tick could be true of one of them
  // and false of the other five while the campaign read "done".
  //
  // Same set as the insight rule: a printer or a logistics company posts
  // nothing and has nothing to prove.
  const vendorSubtasks = subtasks.filter((s) => isVendorSubtaskKind(s.subtask_kind));
  const posting = opts.insightVendorIds
    ? vendorSubtasks.filter((s) => s.vendor_id != null && opts.insightVendorIds!.has(s.vendor_id))
    : vendorSubtasks;
  //
  // Counted per POST, not per booking (migration 058). An influencer booked
  // for twelve pieces owes twelve proofs; "1 of 1 vendors" would call that
  // finished the moment the first one landed. A booking with no ad lines is
  // still one unit, which is right for a vendor hired to do one thing.
  if (posting.length > 0) {
    let expected = 0;
    let missing = 0;
    for (const s of posting) {
      const lines = opts.adLinesBySubtask?.get(s.id) ?? [];
      if (lines.length > 0) {
        expected += adsExpectingProof(lines).length;
        missing += adsMissingProof(lines).length;
      } else {
        expected += 1;
        if (!s.proof_of_posting_attached && !(s.proof_of_posting_link ?? '').trim()) missing += 1;
      }
    }
    if (missing > 0) {
      const noun = `post${expected === 1 ? '' : 's'}`;
      out.push({
        key: 'proof_of_posting',
        message: missing === expected
          ? `No proof of posting yet on any of the ${expected} influencer/UGC ${noun}.`
          : `Proof of posting missing on ${missing} of ${expected} influencer/UGC ${noun}.`,
      });
    }
  }

  if (opts.expectsAnalysisReport) {
    const analysis = subtasks.filter((s) => s.subtask_kind === 'analysis_report');
    if (analysis.length === 0) {
      out.push({ key: 'analysis_report', message: 'No analysis report yet.' });
    } else if (!analysis.some((s) => s.status === 'done')) {
      out.push({ key: 'analysis_report', message: 'The analysis report is not finished.' });
    }
  }

  // Insight lives on the vendor subtask, and only INFLUENCER/UGC vendors
  // produce one — a printer or a logistics company has no insight to give.
  // Which vendors those are is decided by opts.insightVendorIds, because
  // the category lives on the vendor record, not on the subtask.
  //
  // Without that filter this nagged for an insight from every vendor on the
  // campaign, the same over-reach as the analysis report warning.
  // The same vendors the proof rule looked at, for the same reason.
  const expectInsight = posting;
  if (expectInsight.length > 0) {
    const without = expectInsight.filter(
      (s) => !s.insight_attached && !(s.insight_link ?? '').trim(),
    );
    if (without.length > 0) {
      out.push({
        key: 'insight',
        message: without.length === expectInsight.length
          ? 'No insight added on any influencer or UGC vendor yet.'
          : `Insight missing on ${without.length} of ${expectInsight.length} influencer/UGC vendors.`,
      });
    }
  }

  return out;
}

// ── Quotation / invoice requests (migration 048) ────────────────────

export type DocumentRequestKind = 'quotation' | 'invoice';
export type DocumentRequestStatus = 'pending' | 'issued' | 'cancelled';

export interface DocumentRequest {
  id: string;
  workspace_id: string;
  pm_task_id: string;
  doc_kind: DocumentRequestKind;
  status: DocumentRequestStatus;
  note: string | null;
  document_number: string | null;
  requested_by: string | null;
  requested_at: string;
  issued_by: string | null;
  issued_at: string | null;
}

export function useDocumentRequests(taskId: string | null) {
  const [items, setItems] = useState<DocumentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('document_requests')
      .select('*')
      .eq('pm_task_id', taskId)
      .order('requested_at', { ascending: false });
    if (error) logSbError('useDocumentRequests', error, { taskId });
    setItems((data || []) as DocumentRequest[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/**
 * Ask Finance for a quotation or an invoice on this campaign.
 *
 * Carries no copy of the client, brand or amount — Ops reads those live
 * off the parent when they open the link, so the request can never go
 * stale against a campaign that was edited after it was raised.
 *
 * Refuses to raise a second open request of the same kind: two identical
 * "please issue a quotation" notifications a minute apart is how Ops
 * learns to ignore them.
 */
export async function requestCampaignDocument(input: {
  parent: PMTask;
  kind: DocumentRequestKind;
  requestedBy: string;
  note?: string | null;
}): Promise<DocumentRequest> {
  const { parent, kind, requestedBy } = input;
  if (parent.parent_task_id) {
    throw new Error('Quotations and invoices are requested on the campaign, not a subtask.');
  }
  if (!parent.workspace_id) {
    throw new Error('This campaign has no workspace; cannot raise a request.');
  }

  const { data: open, error: openErr } = await supabase
    .from('document_requests')
    .select('id')
    .eq('pm_task_id', parent.id)
    .eq('doc_kind', kind)
    .eq('status', 'pending')
    .limit(1);
  if (openErr) { logSbError('requestCampaignDocument:check', openErr, { task: parent.id }); throw openErr; }
  if (open && open.length) {
    throw new Error(`There is already an open ${kind} request on this campaign.`);
  }

  const { data, error } = await supabase
    .from('document_requests')
    .insert({
      workspace_id: parent.workspace_id,
      pm_task_id: parent.id,
      doc_kind: kind,
      status: 'pending',
      note: input.note?.trim() || null,
      requested_by: requestedBy,
    })
    .select()
    .single();
  if (error) { logSbError('requestCampaignDocument', error, { task: parent.id, kind }); throw error; }
  return data as DocumentRequest;
}

/**
 * Mark a request issued and record the number. Also appends that number to
 * the parent's quotation_numbers / invoice_numbers so the campaign form and
 * the request queue can't disagree about what was issued.
 */
export async function markDocumentRequestIssued(
  request: DocumentRequest,
  documentNumber: string,
  issuedBy: string,
) {
  const num = documentNumber.trim();
  if (!num) throw new Error('Give the document a number.');

  const { error } = await supabase
    .from('document_requests')
    .update({
      status: 'issued',
      document_number: num,
      issued_by: issuedBy,
      issued_at: new Date().toISOString(),
    })
    .eq('id', request.id);
  if (error) { logSbError('markDocumentRequestIssued', error, { id: request.id }); throw error; }

  const column = request.doc_kind === 'quotation' ? 'quotation_numbers' : 'invoice_numbers';
  const { data: task } = await supabase
    .from('pm_tasks')
    .select(column)
    .eq('id', request.pm_task_id)
    .maybeSingle();

  const existing = ((task as any)?.[column] ?? []) as string[];
  if (!existing.some((v) => v.trim().toLowerCase() === num.toLowerCase())) {
    await supabase
      .from('pm_tasks')
      .update({ [column]: [...existing, num] })
      .eq('id', request.pm_task_id);
  }
}

export async function cancelDocumentRequest(id: string) {
  const { error } = await supabase
    .from('document_requests')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Remove one subtask.
 *
 * This used to clear the parent's has_tracking flag when the last subtask of
 * kind 'tracking' was deleted. That is now actively wrong: the tracking sheet
 * is enabled by a button on the parent, so deleting a leftover pre-redesign
 * "Tracking Sheet" subtask would silently switch off a sheet that may already
 * be published to the client. Deleting a subtask deletes a subtask, nothing more.
 */
export async function removeSubtask(subtaskId: string) {
  await deleteTask(subtaskId);
}

/** Member / key account: update a task (status / completed / etc). */
export async function updateTaskFields(taskId: string, fields: Partial<PMTask>) {
  // Contract and client-payment status are the two fields the client's
  // timeline cares about. Read the row FIRST so we know what actually
  // changed: a form save re-sends every field, and without the comparison a
  // timeline fills up with "contract signed" ten times over.
  const watched = 'contract_status' in fields || 'client_payment_status' in fields;
  let before: PMTask | null = null;
  if (watched) {
    const { data } = await supabase
      .from('pm_tasks')
      .select('id, workspace_id, client_id, task_name, title, brand_name, contract_status, client_payment_status')
      .eq('id', taskId)
      .maybeSingle();
    before = (data as PMTask) ?? null;
  }

  // Ask for the row back in the same round trip. The caller used to write,
  // then immediately re-read the same row to find out what it now says —
  // two requests for one edit, and the field showed the old value until the
  // second one landed.
  const { data: updated, error } = await timed<any>('pm_tasks.update', async () =>
    supabase.from('pm_tasks').update(fields).eq('id', taskId).select('*').maybeSingle());
  if (error) throw error;

  if (watched && before) {
    const after = { ...before, ...fields } as PMTask;
    if ('contract_status' in fields) {
      void logToClientTimeline(before.workspace_id, before.client_id,
        onContractStatusChanged(after, before.contract_status, fields.contract_status));
    }
    if ('client_payment_status' in fields) {
      void logToClientTimeline(before.workspace_id, before.client_id,
        onClientPaymentChanged(after, before.client_payment_status, fields.client_payment_status,
          fields.client_payment_amount ?? null));
    }
  }

  return (updated as PMTask | null) ?? null;
}

/** Hard-delete a task. Cascades to subtasks via the FK. */
export async function deleteTask(taskId: string) {
  // Capture child subtask ids before the cascade delete removes them, so we
  // can also clear their inbox notifications.
  const { data: children } = await supabase
    .from('pm_tasks')
    .select('id')
    .eq('parent_task_id', taskId);
  const ids = [taskId, ...((children || []).map((c: any) => c.id as string))];

  // Delete FIRST, and check that it actually happened.
  //
  // This is the "sometimes delete glitches" bug. It used to be:
  //
  //     const { error } = await supabase.from('pm_tasks').delete().eq('id', taskId);
  //     if (error) throw error;
  //
  // PostgREST does not report an error when RLS simply matches no rows — the
  // request succeeds having deleted nothing. The panel closed, the caller
  // refetched, and the task came straight back. Asking for the deleted rows
  // back turns that silence into something we can act on.
  const { data: deleted, error } = await supabase
    .from('pm_tasks')
    .delete()
    .eq('id', taskId)
    .select('id');
  if (error) { logSbError('deleteTask', error, { taskId }); throw error; }
  if (!deleted || deleted.length === 0) {
    throw new Error(
      'That task was not deleted — it may already be gone, or your role may not be allowed to delete it. Refresh and try again.',
    );
  }

  // Best effort, and only once the row is genuinely gone. A DB trigger
  // (migration 037) clears these server-side anyway; this just makes the
  // deleter's own inbox update without waiting for a poll. It must never
  // fail the delete — the task IS deleted by this point.
  try {
    for (const id of ids) {
      await supabase.from('notifications').delete().ilike('link', `%task=${id}%`);
    }
  } catch (e) {
    logSbError('deleteTask:notifications', e as any, { taskId });
  }
}

/** Key account / admin: mark a task complete. Stage flips to `completed`,
 *  which fires the DB trigger that notifies marketing. */
export async function markTaskCompleted(taskId: string) {
  const { data, error } = await supabase
    .from('pm_tasks')
    .update({
      status: 'done',
      stage: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId)
    .select('id, workspace_id, client_id, parent_task_id, task_name, title, brand_name')
    .maybeSingle();
  if (error) throw error;

  // Only campaigns reach the timeline. A finished subtask is internal
  // detail; a finished campaign is a thing the client experienced.
  const row = data as PMTask | null;
  if (row && !row.parent_task_id) {
    void logToClientTimeline(row.workspace_id, row.client_id, onCampaignCompleted(row));
  }
}

// ============================================================
// Single-task + relations
// ============================================================

export function useTask(taskId: string | null) {
  const [task, setTask] = useState<PMTask | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setTask(null); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pm_tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) logSbError('useTask', error, { taskId });
    setTask((data as PMTask | null) ?? null);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);

  /**
   * Take a row we already have rather than going back for it.
   *
   * Every save wrote the field, then re-read the same row to display it.
   * The write already knows the answer — `updateTaskFields` returns it — so
   * this puts it straight on screen. Ignores a row for a different task, in
   * case a save lands after the user has clicked into another one.
   */
  const apply = useCallback((row: PMTask | null) => {
    if (!row || !taskId || row.id !== taskId) return;
    setTask(row);
  }, [taskId]);

  return { task, loading, refetch: fetch, apply };
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: Profile;
}

export function useTaskComments(taskId: string | null) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setComments([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles(id, full_name, avatar_url)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) logSbError('useTaskComments', error, { taskId });
    setComments((data || []) as TaskComment[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { comments, loading, refetch: fetch };
}

export async function addComment(taskId: string, authorId: string, content: string) {
  const { error } = await supabase
    .from('comments')
    .insert({ task_id: taskId, author_id: authorId, content });
  if (error) throw error;
  // Mention notifications are fired by a database trigger (migration 049),
  // not from here — a comment that saves must never notify nobody because
  // the tab was closed a moment later.
}

// ── Names and @mentions (migration 049) ─────────────────────────────

/** What a profile with no real name reads as. Matches unnamed_member_label(). */
export const UNNAMED_MEMBER = 'Unnamed member';

/**
 * An email address is not a name.
 *
 * Signup wrote `full_name: metadata.full_name || email`, so profiles that
 * never supplied a name carry an address. 049 cleans the stored data; this
 * is the belt-and-braces so a row that predates the migration, or arrives
 * from a cached response, still never renders an address to the screen.
 */
export function looksLikeEmail(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

/** The name to show for a person. Never an email, never blank. */
export function displayName(profile: { full_name?: string | null } | null | undefined): string {
  const v = (profile?.full_name ?? '').trim();
  if (!v || looksLikeEmail(v)) return UNNAMED_MEMBER;
  return v;
}

/** Whether this profile still needs its owner to set a real name. */
export function needsRealName(profile: { full_name?: string | null } | null | undefined): boolean {
  const v = (profile?.full_name ?? '').trim();
  return !v || looksLikeEmail(v) || v === UNNAMED_MEMBER;
}

/** Set your own display name. Trimmed; an email is refused outright. */
export async function updateMyName(userId: string, fullName: string) {
  const name = fullName.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Give your name.');
  if (looksLikeEmail(name)) throw new Error('That is an email address, not a name.');
  if (name.length > 80) throw new Error('That name is too long.');
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: name })
    .eq('id', userId);
  if (error) { logSbError('updateMyName', error, { userId }); throw error; }
}

/**
 * How a mention is stored: `@[[<uuid>]]`.
 *
 * The id, not the name — rename someone and every comment they were ever
 * mentioned in shows the new name, instead of freezing whatever they were
 * called that day. Same rule as client and brand elsewhere in this app.
 */
export const MENTION_RE =
  /@\[\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]\]/g;

export function mentionToken(userId: string): string {
  return `@[[${userId}]]`;
}

/** Every distinct user id mentioned in a body of text. */
export function extractMentionIds(text: string | null | undefined): string[] {
  const out = new Set<string>();
  const re = new RegExp(MENTION_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text ?? '')) !== null) out.add(m[1]);
  return Array.from(out);
}

export type CommentSegment =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; userId: string; name: string };

/**
 * Split comment text into plain runs and mentions, resolving each id to the
 * name that person has RIGHT NOW. An id nobody recognises renders as
 * "@Unknown member" rather than leaking a raw uuid at the reader.
 */
export function parseCommentSegments(
  text: string | null | undefined,
  nameById: Map<string, string>,
): CommentSegment[] {
  const src = text ?? '';
  const out: CommentSegment[] = [];
  const re = new RegExp(MENTION_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: src.slice(last, m.index) });
    out.push({ kind: 'mention', userId: m[1], name: nameById.get(m[1]) ?? 'Unknown member' });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: 'text', value: src.slice(last) });
  return out;
}

/**
 * Find the @query the caret is currently inside, if any.
 *
 * Returns null unless the @ starts at the beginning or follows whitespace —
 * otherwise an email typed into a comment would open the picker on every
 * keystroke after the @.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const before = at === 0 ? '' : upto[at - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upto.slice(at + 1);
  // A mention is a name fragment, not a paragraph.
  if (/[\n\r]/.test(query) || query.length > 40) return null;
  return { query, start: at };
}

/** Replace the in-progress @query with a finished mention token. */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  userId: string,
  /**
   * The person's name. When given, the composer shows "@Sara K" instead of
   * "@[[66e2ab23-…]]" — Siraj, seeing the raw id in the box: "when mentioning
   * someone it should show their name not their id". The id still goes to the
   * database; see encodeMentions, which swaps the names back at send time.
   *
   * Optional so the old call signature keeps working.
   */
  displayNameForUser?: string,
): { text: string; caret: number } {
  const token = displayNameForUser
    ? `@${displayNameForUser} `
    : `${mentionToken(userId)} `;
  const next = text.slice(0, start) + token + text.slice(caret);
  return { text: next, caret: start + token.length };
}

/** A mention the user actually picked from the list, in the order they picked it. */
export interface MentionPick { id: string; name: string }

/**
 * Turn the "@Sara K" the composer displays back into the "@[[id]]" the
 * database stores. Call it once, on send.
 *
 * Only names the user genuinely chose from the picker are converted, so
 * typing "@" and a name by hand does not silently mention somebody.
 *
 * Longest names are matched first: with both "Sara" and "Sara K" picked,
 * replacing "Sara" first would leave a stray " K" behind. Within the same
 * name, picks are consumed in the order they were made, so mentioning two
 * different people who share a name still resolves left to right.
 *
 * Known limit: edit the name text after picking it and the mention stops
 * resolving — it becomes ordinary text rather than mentioning the wrong
 * person, which is the safe direction to fail in.
 */
export function encodeMentions(text: string, picks: MentionPick[]): string {
  const ordered = picks
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => (b.name.length - a.name.length) || (a.i - b.i));

  let out = text;
  for (const pick of ordered) {
    const needle = `@${pick.name}`;
    const at = out.indexOf(needle);
    if (at === -1) continue;                 // user edited or deleted it
    // The replacement contains no "@Name", so the next search can't re-find it.
    out = out.slice(0, at) + mentionToken(pick.id) + out.slice(at + needle.length);
  }
  return out;
}

export async function deleteComment(commentId: string) {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) throw error;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploader_id: string | null;
  filename: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export function useTaskAttachments(taskId: string | null) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setAttachments([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) logSbError('useTaskAttachments', error, { taskId });
    setAttachments((data || []) as TaskAttachment[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { attachments, loading, refetch: fetch };
}

/** Add an attachment by URL (Drive, Dropbox, paste, etc). */
export async function addAttachmentLink(input: {
  task_id: string;
  uploader_id: string;
  filename: string;
  file_url: string;
  mime_type?: string | null;
}) {
  const { error } = await supabase.from('task_attachments').insert({
    task_id: input.task_id,
    uploader_id: input.uploader_id,
    filename: input.filename,
    file_url: input.file_url,
    mime_type: input.mime_type ?? null,
  });
  if (error) throw error;
}

/**
 * Upload a real file to Supabase Storage (bucket `task-files`) and create
 * the matching `task_attachments` row.
 *
 * Path convention: `{workspace_id}/{task_id}/{uuid}-{originalFilename}` —
 * the leading workspace_id is what the storage RLS policies key on, so a
 * member of one workspace can never read/write another workspace's files.
 */
export async function uploadTaskAttachment(input: {
  file: File;
  task_id: string;
  uploader_id: string;
  workspace_id: string;
}) {
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const uid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const path = `${input.workspace_id}/${input.task_id}/${uid}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from('task-files')
    .upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type || undefined,
    });
  if (upErr) throw upErr;

  // Store the storage path in `file_url`. We sign download URLs at click time.
  const { error: insErr } = await supabase.from('task_attachments').insert({
    task_id: input.task_id,
    uploader_id: input.uploader_id,
    filename: input.file.name,
    file_url: path,
    file_size: input.file.size,
    mime_type: input.file.type || null,
  });
  if (insErr) {
    // Best-effort cleanup if metadata insert fails after upload succeeded.
    await supabase.storage.from('task-files').remove([path]).catch(() => {});
    throw insErr;
  }
}

/**
 * Get a temporary download URL for a stored file. Storage rows store the
 * `file_url` column as either:
 *   - a Supabase Storage path (no leading slash, no http) — sign on demand
 *   - or an external http(s) URL (legacy `addAttachmentLink` rows) — return as-is
 */
export async function getAttachmentDownloadUrl(
  fileUrl: string,
  expiresInSeconds = 60 * 5,
): Promise<string> {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const { data, error } = await supabase.storage
    .from('task-files')
    .createSignedUrl(fileUrl, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteAttachment(id: string) {
  // Look up the row first so we know what to remove from Storage too.
  const { data: row, error: fetchErr } = await supabase
    .from('task_attachments')
    .select('file_url')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase.from('task_attachments').delete().eq('id', id);
  if (error) throw error;

  // Best-effort: if the file_url is a storage path (not an external URL),
  // also remove the bytes. Failure here is non-fatal — RLS/cleanup policies
  // will catch any orphans.
  if (row?.file_url && !/^https?:\/\//i.test(row.file_url)) {
    await supabase.storage.from('task-files').remove([row.file_url]).catch(() => {});
  }
}

// ============================================================
// Notifications
// ============================================================

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export function useNotifications(opts: { pollMs?: number } = {}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) logSbError('useNotifications', error);
    setItems((data || []) as AppNotification[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    if (opts.pollMs && opts.pollMs > 0) {
      const id = setInterval(fetch, opts.pollMs);
      return () => clearInterval(id);
    }
  }, [fetch, opts.pollMs]);

  const unreadCount = items.filter((n) => !n.read).length;
  return { items, unreadCount, loading, refetch: fetch };
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}
export async function markAllNotificationsRead() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('read', false);
  if (error) throw error;
}

// ============================================================
// Stats / activity / member assignment / role mutations
// ============================================================

export interface WorkspaceStats {
  total: number;
  completed: number;
  pendingMarketing: number;
  inProgress: number;
  overdue: number;
  dueToday: number;
  mine: number;
}

export function useWorkspaceStats(workspaceId: string | null, userId: string | null) {
  const [stats, setStats] = useState<WorkspaceStats>({
    total: 0, completed: 0, pendingMarketing: 0, inProgress: 0,
    overdue: 0, dueToday: 0, mine: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    // One round-trip — pull all parent tasks + a count subset, derive client-side.
    const { data, error } = await supabase
      .from('pm_tasks')
      .select('id, stage, status, due_date, completed_at, assignee_id, key_account_id, creator_id, parent_task_id')
      .eq('workspace_id', workspaceId);
    if (error) { logSbError('useWorkspaceStats', error, { workspaceId }); setLoading(false); return; }
    const rows = (data || []) as any[];
    const today = new Date().toISOString().slice(0, 10);
    const parents = rows.filter((r) => !r.parent_task_id);
    const isMine = (r: any) => userId && (r.assignee_id === userId || r.key_account_id === userId || r.creator_id === userId);
    const next: WorkspaceStats = {
      total: parents.length,
      completed: parents.filter((r) => r.stage === 'completed').length,
      pendingMarketing: parents.filter((r) => r.stage === 'pending_marketing').length,
      inProgress: parents.filter((r) => r.stage === 'in_progress').length,
      overdue: rows.filter((r) => r.due_date && r.due_date < today && r.status !== 'done').length,
      dueToday: rows.filter((r) => r.due_date === today && r.status !== 'done').length,
      mine: rows.filter(isMine).length,
    };
    setStats(next);
    setLoading(false);
  }, [workspaceId, userId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { stats, loading, refetch: fetch };
}

export interface ActivityRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  user_id: string;
  action: string;
  details: any;
  created_at: string;
}

export function useRecentActivity(workspaceId: string | null, limit = 10) {
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) logSbError('useRecentActivity', error);
    setItems((data || []) as ActivityRow[]);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/** Counts of tasks assigned per member in a workspace (parent + child both count). */
export function useTaskCountsByMember(workspaceId: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setCounts({}); setLoading(false); return; }
    const { data: a } = await supabase
      .from('pm_tasks').select('assignee_id').eq('workspace_id', workspaceId).neq('status', 'done');
    const { data: tm } = await supabase
      .from('task_members')
      .select('user_id, task:pm_tasks!inner(workspace_id, status)')
      .eq('task.workspace_id', workspaceId);
    const c: Record<string, number> = {};
    for (const r of (a || []) as any[]) if (r.assignee_id) c[r.assignee_id] = (c[r.assignee_id] ?? 0) + 1;
    for (const r of (tm || []) as any[]) {
      if (r.task?.status !== 'done' && r.user_id) c[r.user_id] = (c[r.user_id] ?? 0) + 1;
    }
    setCounts(c);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { counts, loading, refetch: fetch };
}

/** Members on a single task. */
export interface TaskMember {
  id: string;
  task_id: string;
  user_id: string;
  added_by: string | null;
  role: string;
  added_at: string;
  user?: Profile;
}
export function useTaskMembers(taskId: string | null) {
  const [members, setMembers] = useState<TaskMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setMembers([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_members')
      .select('*, user:profiles!task_members_user_id_fkey(id, full_name, avatar_url)')
      .eq('task_id', taskId);
    if (error) logSbError('useTaskMembers', error, { taskId });
    setMembers((data || []) as TaskMember[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { members, loading, refetch: fetch };
}

export async function addTaskMember(taskId: string, userId: string, addedBy: string, role = 'collaborator') {
  const { error } = await supabase
    .from('task_members')
    .insert({ task_id: taskId, user_id: userId, added_by: addedBy, role });
  if (error) throw error;
}
export async function removeTaskMember(membershipId: string) {
  const { error } = await supabase.from('task_members').delete().eq('id', membershipId);
  if (error) throw error;
}

/** Admin: change someone's role in the workspace. */
export async function setWorkspaceMemberRole(membershipId: string, role: WorkspaceRole) {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('id', membershipId);
  if (error) throw error;
}

/** All workspace_members rows with profile info (used by Settings team panel). */
export interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  profile?: Profile;
}
export function useWorkspaceMembers(workspaceId: string | null) {
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setMembers([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId);
    if (error) logSbError('useWorkspaceMembers', error, { workspaceId });
    setMembers((data || []) as WorkspaceMemberRow[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { members, loading, refetch: fetch };
}

export interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  resend_count: number;
  last_resent_at: string | null;
  inviter?: Profile | null;
}

export function useWorkspaceInvites(workspaceId: string | null) {
  const [invites, setInvites] = useState<WorkspaceInviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setInvites([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_invites')
      .select('*, inviter:profiles!workspace_invites_invited_by_fkey(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) logSbError('useWorkspaceInvites', error, { workspaceId });
    setInvites((data || []) as WorkspaceInviteRow[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { invites, loading, refetch: fetch };
}

export interface InviteEventRow {
  id: string;
  invite_id: string | null;
  workspace_id: string;
  invite_email: string;
  invite_role: WorkspaceRole;
  action:
    | 'created'
    | 'resent'
    | 'accepted'
    | 'revoked'
    | 'expired'
    | 'role_changed'
    | 'resend_failed';
  actor_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor?: Profile | null;
}

export function useInviteEvents(workspaceId: string | null, limit = 25) {
  const [events, setEvents] = useState<InviteEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setEvents([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('invite_events')
      .select('*, actor:profiles!invite_events_actor_id_fkey(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) logSbError('useInviteEvents', error, { workspaceId });
    setEvents((data || []) as InviteEventRow[]);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { events, loading, refetch: fetch };
}

export async function createWorkspaceInvite(
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
  expiresHours: 1 | 12 | 24,
) {
  const { data, error } = await supabase
    .rpc('create_workspace_invite', {
      ws_id: workspaceId,
      invite_email: email,
      invite_role: role,
      expires_hours: expiresHours,
    });
  if (error) throw error;
  return (data?.[0] || data) as {
    id: string;
    token: string;
    email: string;
    role: WorkspaceRole;
    expires_at: string;
  };
}

export async function deleteWorkspaceInvite(inviteId: string) {
  const { error } = await supabase
    .from('workspace_invites')
    .delete()
    .eq('id', inviteId);
  if (error) throw error;
}

export async function deleteExpiredWorkspaceInvites(workspaceId: string) {
  const { error } = await supabase
    .from('workspace_invites')
    .delete()
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

/**
 * Records that we are about to resend an invite. The DB enforces a 60-second
 * cooldown per invite and increments resend_count. Throws if cooldown is
 * still active, the invite is accepted, or the invite is expired.
 */
export async function recordInviteResend(inviteId: string) {
  const { data, error } = await supabase.rpc('record_invite_resend', {
    invite_id: inviteId,
  });
  if (error) throw error;
  return (data?.[0] || data) as {
    resend_count: number;
    last_resent_at: string;
    cooldown_remaining_seconds: number;
  };
}

/**
 * Logs that a resend attempt failed (e.g., the email provider rejected it).
 * The cooldown window has already been consumed by recordInviteResend, so
 * the admin can fix the issue and try again after 60 seconds.
 */
export async function recordInviteResendFailure(inviteId: string, reason: string) {
  const { error } = await supabase.rpc('record_invite_resend_failure', {
    invite_id: inviteId,
    reason,
  });
  if (error) throw error;
}

// ============================================================
// Contract requests + clients + vendors
// ============================================================

export type ContractKind = 'client' | 'vendor';
export type ContractRequestStatus = 'pending' | 'approved' | 'generated' | 'rejected' | 'cancelled';

export interface ContractRequest {
  id: string;
  pm_task_id: string | null;
  workspace_id: string;
  requested_by: string;
  request_kind: ContractKind;
  template_key: string | null;
  brand_name: string | null;
  amount: number | null;
  notes: string | null;
  client_name: string | null;
  client_id_legacy: string | null;
  pending_client_id: number | null;
  cr_number: string | null;
  vat_number: string | null;
  signatory_name: string | null;
  street: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  pending_vendor_id: number | null;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_category: string | null;
  vendor_email: string | null;
  vendor_phone: string | null;
  bank_account_id: number | null;
  bank_name: string | null;
  account_name: string | null;
  iban: string | null;
  account_number: string | null;
  swift_code: string | null;
  license_number: string | null;
  is_influencer: boolean | null;
  platforms: string | null;
  ad_type: string | null;
  qty: string | null;
  channel: string | null;
  details: string | null;
  status: ContractRequestStatus;
  generated_contract_id: string | null;
  generated_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export function useContractRequests(workspaceId: string | null, taskId?: string | null) {
  const [items, setItems] = useState<ContractRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    let q = supabase.from('contract_requests').select('*').eq('workspace_id', workspaceId);
    if (taskId) q = q.eq('pm_task_id', taskId);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) logSbError('useContractRequests', error, { workspaceId, taskId });
    setItems((data || []) as ContractRequest[]);
    setLoading(false);
  }, [workspaceId, taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function createContractRequest(input: Omit<ContractRequest,
  'id' | 'created_at' | 'status' | 'generated_contract_id' | 'generated_at' | 'reviewed_at' | 'reviewed_by'
> & { status?: ContractRequestStatus }) {
  const { data, error } = await supabase
    .from('contract_requests')
    .insert({ ...input, status: input.status ?? 'pending' })
    .select().single();
  if (error) throw error;
  return data as ContractRequest;
}
export async function updateContractRequestStatus(id: string, status: ContractRequestStatus) {
  const fields: any = { status };
  if (status === 'approved' || status === 'rejected' || status === 'cancelled') {
    fields.reviewed_at = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) fields.reviewed_by = user.id;
  }
  const { error } = await supabase.from('contract_requests').update(fields).eq('id', id);
  if (error) throw error;
}

export async function generateContractRequest(id: string, templateKey?: string | null) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You need to sign in again before generating contracts.');
  }

  const apiBase = process.env.NEXT_PUBLIC_CONTRACT_API_URL || 'http://127.0.0.1:8000';
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/contract-requests/${id}/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(templateKey ? { template_key: templateKey } : {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string'
      ? payload.detail
      : `Contract generation failed (${response.status})`;
    throw new Error(detail);
  }
  return payload as {
    request_id: string;
    template_key: string;
    contract_id: string;
    legacy_task_id: string;
    docx_path: string | null;
    pdf_path: string | null;
    pdf_error: string | null;
  };
}

// Vendors + bank accounts (legacy contract app tables)
//
// Schema notes: migration 029 added `category_id` (FK → vendor_categories)
// plus the base fields (id_number, signatory_name, contact_name, vat_number,
// details) and per-category optional fields. Old `license_number` was
// relaxed to nullable — Influencer + UGC still use it, the other 9
// categories use id_number instead.
export interface LegacyVendor {
  id: number;
  name: string;
  license_number: string | null;
  created_at: string | null;
  // 029 additions
  category_id?: string | null;
  id_number?: string | null;
  signatory_name?: string | null;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  vat_number?: string | null;
  details?: string | null;
  vendor_category?: string | null; // legacy free-text — read-only now
  platforms?: string | null;
  // per-category optional
  location_link?: string | null;
  short_address?: string | null;
  age?: number | null;
  gender?: string | null;
  rental_type?: string | null;
  event_opening?: string | null;
  event_ceremony?: string | null;
  location_type?: string | null;
}

// vendor_categories lookup (seeded by migration 029).
export interface LegacyVendorCategory {
  id: string;
  key:
    | 'influencer' | 'ugc' | 'props' | 'makeup_artist' | 'logistics'
    | 'model' | 'videographer' | 'rentals' | 'events' | 'location'
    | 'photographer';
  label: string;
  requires_license: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

/**
 * Fetch active vendor_categories in sort_order. Used by the vendor form
 * to render the category picker and decide whether ID or License is the
 * required identifier.
 */
export function useVendorCategoriesLegacy() {
  const [categories, setCategories] = useState<LegacyVendorCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('vendor_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) logSbError('useVendorCategoriesLegacy', error);
    setCategories((data || []) as LegacyVendorCategory[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { categories, loading, refetch: fetch };
}
export interface LegacyBankAccount {
  id: number;
  vendor_id: number;
  bank_name: string;
  account_name: string;
  iban: string;
  account_number: string;
  swift_code: string;
}
// ─────────────────────────────────────────────────────────────────────
// Vendor files (one file list per vendor, any file type).
//
// Storage: bucket `vendor-files`, path `{vendor_id}/{uuid}-{filename}`.
// Schema: public.vendor_files (migration 030).
// ─────────────────────────────────────────────────────────────────────

export interface VendorFileRow {
  id: string;
  vendor_id: number;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string | null;
  uploaded_at: string;
  // Migration 032: which "slot" in the Design C modal this file
  // belongs to. Empty string = legacy / pre-modal uploads. Examples:
  // 'license', 'id', 'bank:7', 'headshot', 'equipment'.
  slot: string;
}

const VENDOR_FILES_BUCKET = 'vendor-files';
export const VENDOR_FILE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

/** Build the slot key for a specific bank account row. Keep this
 *  here so every caller agrees on the format. */
export function bankSlot(bankId: number | string): string {
  return `bank:${bankId}`;
}

/** List the files attached to a vendor, newest first. */
export function useVendorFiles(vendorId: number | null) {
  const [files, setFiles] = useState<VendorFileRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetch = useCallback(async () => {
    if (vendorId == null) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('vendor_files')
      .select('*')
      .eq('vendor_id', vendorId)
      .order('uploaded_at', { ascending: false });
    if (error) logSbError('useVendorFiles', error, { vendorId });
    setFiles((data || []) as VendorFileRow[]);
    setLoading(false);
  }, [vendorId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { files, loading, refetch: fetch };
}

/**
 * Upload a single file to a vendor.
 *
 * Path layout: `{vendor_id}/{slot|_general}/{rand}-{sanitized_filename}`.
 * The random prefix prevents collisions when the same filename is
 * uploaded twice; the original name is preserved as a column for
 * display. Including the slot in the path lets you eyeball storage in
 * Supabase Studio and tell at a glance what a file is for.
 *
 * On success, returns the created vendor_files row.
 *
 * Throws if the file exceeds VENDOR_FILE_MAX_BYTES (25 MB) — the UI
 * surfaces that as a friendly inline error.
 *
 * `slot` is the Design C modal destination this file belongs to
 * (`'license'`, `'id'`, `bankSlot(bankId)`, `'headshot'`, etc.).
 * Pass an empty string for "general / no slot" uploads.
 */
export async function uploadVendorFile(
  vendorId: number,
  file: File,
  slot: string = '',
): Promise<VendorFileRow> {
  if (file.size > VENDOR_FILE_MAX_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 25 MB.`);
  }

  // Build a collision-resistant storage path while keeping the original
  // filename visible in the URL (helps with debugging Supabase Studio).
  const rand = crypto.randomUUID().slice(0, 8);
  const safeName = (file.name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')   // strip OS-illegal chars
    .replace(/\s+/g, '_')
    .slice(0, 120);
  // Slots can contain a colon (bank:7), which is illegal on some
  // storage backends. Normalize to an underscore so the storage layer
  // never barfs and we can still rebuild the slot from the DB column.
  const safeSlot = (slot || '_general').replace(/[\\/:*?"<>|]/g, '_');
  const storagePath = `${vendorId}/${safeSlot}/${rand}-${safeName}`;

  // 1) push the bytes to storage
  const { error: uploadErr } = await supabase
    .storage
    .from(VENDOR_FILES_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`);

  // 2) record the metadata row. If this fails we orphan the storage
  //    object — surface the error so the caller can decide to retry.
  //    We could also try to delete the storage object here, but
  //    leaving it lets a manual SQL cleanup recover.
  const { data: userResp } = await supabase.auth.getUser();
  const uploadedBy = userResp?.user?.id ?? null;

  const insertPayload = {
    vendor_id: vendorId,
    storage_path: storagePath,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || 'application/octet-stream',
    uploaded_by: uploadedBy,
    slot,
  };
  const { data, error: insertErr } = await supabase
    .from('vendor_files')
    .insert(insertPayload)
    .select()
    .single();
  if (insertErr) throw new Error(`Saved file but couldn't index it: ${insertErr.message}`);

  return data as VendorFileRow;
}

/**
 * Group a vendor's files by slot. Returns a Map where keys are slot
 * names ('license', 'bank:7', '') and values are the matching files
 * sorted newest-first. Used by the Design C modal to populate each
 * tab independently from a single fetch.
 */
export function groupVendorFilesBySlot(files: VendorFileRow[]): Map<string, VendorFileRow[]> {
  const out = new Map<string, VendorFileRow[]>();
  for (const f of files) {
    const key = f.slot ?? '';
    const bucket = out.get(key);
    if (bucket) bucket.push(f);
    else out.set(key, [f]);
  }
  // Each bucket newest-first.
  for (const arr of out.values()) {
    arr.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  }
  return out;
}

/**
 * Delete a vendor file — wipes the storage object and the metadata
 * row. Best-effort: if storage deletion fails the metadata row is
 * still removed (otherwise the UI would keep showing a broken link).
 */
export async function deleteVendorFile(file: VendorFileRow): Promise<void> {
  const { error: storageErr } = await supabase
    .storage
    .from(VENDOR_FILES_BUCKET)
    .remove([file.storage_path]);
  if (storageErr) {
    // Log but keep going so the row gets cleaned up.
    logSbError('deleteVendorFile.storage', storageErr, { path: file.storage_path });
  }

  const { error: rowErr } = await supabase
    .from('vendor_files')
    .delete()
    .eq('id', file.id);
  if (rowErr) throw new Error(`Could not delete file row: ${rowErr.message}`);
}

/**
 * Mint a short-lived signed URL the browser can open to download the
 * file. Default expiry is 10 minutes — plenty to click through.
 */
export async function getVendorFileDownloadUrl(
  file: VendorFileRow,
  expirySeconds = 600,
): Promise<string> {
  const { data, error } = await supabase
    .storage
    .from(VENDOR_FILES_BUCKET)
    .createSignedUrl(file.storage_path, expirySeconds, { download: file.file_name });
  if (error || !data?.signedUrl) {
    throw new Error(`Could not create download link: ${error?.message ?? 'unknown error'}`);
  }
  return data.signedUrl;
}


export function useLegacyVendors() {
  const [vendors, setVendors] = useState<LegacyVendor[]>([]);
  const [banks, setBanks] = useState<LegacyBankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (force = false) => {
    const both = await cachedFetch<{ vendors: LegacyVendor[]; banks: LegacyBankAccount[] }>(
      'legacy-vendors',
      async () => {
        // Vendors and bank accounts are both paged: the vendor book was at
        // 495 rows when this was written, which is close enough to the 1000
        // cap that hitting it was a matter of time, and the failure is silent.
        const [v, b, { data: cats }] = await Promise.all([
          selectAllRows<LegacyVendor>('useLegacyVendors vendors',
            () => supabase.from('vendors').select('*').order('name', { ascending: true })),
          selectAllRows<LegacyBankAccount>('useLegacyVendors banks',
            () => supabase.from('bank_accounts').select('*').order('id', { ascending: true })),
          supabase.from('vendor_categories').select('id, key'),
        ]);

        // Backfill the legacy free-text category from the 029 FK, ONCE, here.
        //
        // Six different places ask "what category is this vendor" —
        // the tracking-sheet gate, the insight rule, the licence-vs-ID
        // identifier, the picker's search text, the contract readiness check
        // and the request payload. Every one of them read `vendor_category`
        // and so read "none" for any vendor registered through the current
        // form, which writes `category_id`. Repairing it at the source fixes
        // all six; repairing it at each call site would have fixed five.
        const categories = (cats || []) as { id: string; key: string }[];
        const vendors = ((v || []) as LegacyVendor[]).map((row) => (
          (row.vendor_category ?? '').trim()
            ? row
            : { ...row, vendor_category: vendorCategoryKey(row, categories) }
        ));

        return { vendors, banks: (b || []) as LegacyBankAccount[] };
      },
      force,
    );
    setVendors(both.vendors);
    setBanks(both.banks);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { vendors, banks, loading, refetch: () => fetch(true) };
}

// ============================================================
// Clients & brands (the contract-app `clients` + `client_brands`
// tables, which both apps share). NewTaskForm uses these to make
// Client/Brand pickers instead of free-text inputs.
// ============================================================

export interface ClientRow {
  id: string;
  company_name: string;
  /** Auto-fills pm_tasks.client_category_id when this client is picked (042). */
  client_category_id: string | null;
  cr_number: string | null;
  vat_number: string | null;
  signatory_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  country: string | null;
  status: string | null;
  zoho_customer_id: string | null;
}

export interface ClientBrandRow {
  id: string;
  client_id: string;
  brand_name: string;
  description: string | null;
  status: string | null;
}

export function useClients() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async (force = false) => {
    const rows = await cachedFetch<ClientRow[]>('clients', () => selectAllRows<ClientRow>(
      'useClients',
      () => supabase
        .from('clients')
        .select('id, company_name, cr_number, vat_number, signatory_name, contact_email, contact_phone, city, country, status, zoho_customer_id, client_category_id')
        .order('company_name', { ascending: true }),
    ), force);
    setClients(rows);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { clients, loading, refetch: () => fetch(true) };
}

export function useClientBrands(clientId: string | null) {
  const [brands, setBrands] = useState<ClientBrandRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!clientId) { setBrands([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('client_brands')
      .select('id, client_id, brand_name, description, status')
      .eq('client_id', clientId)
      .order('brand_name', { ascending: true });
    if (error) logSbError('useClientBrands', error, { clientId });
    setBrands((data || []) as ClientBrandRow[]);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { brands, loading, refetch: fetch };
}

// ── Is this request ready to send? ──────────────────────────────────
//
// The old flow opened a form and asked for details the app already had,
// then let you submit something incomplete for Legal to chase. Siraj:
// "if all data is present it should just send a request to the contract
// app and if theyre not it says fill these requirtments".
//
// So: check first. Everything present → send, no form. Anything missing →
// name it, and say WHERE to fix it, because "CR number missing" is useless
// if you don't know it lives on the client record rather than the task.

export interface MissingRequirement {
  /** What's missing, in the user's words. */
  label: string;
  /** Where they go to fill it in. */
  where: string;
}

export interface ContractReadiness {
  ready: boolean;
  missing: MissingRequirement[];
}

/**
 * What a CLIENT contract needs before Legal can draft it.
 *
 * The client's own details come from the client record, not the campaign —
 * they're the same on every campaign for that client, so asking again per
 * campaign is how they end up inconsistent.
 */
export function clientContractReadiness(
  task: PMTask | null,
  client: ClientRow | null,
): ContractReadiness {
  const missing: MissingRequirement[] = [];
  const has = (v: unknown) => typeof v === 'string' ? v.trim().length > 0 : v != null;

  if (!task) return { ready: false, missing: [{ label: 'A campaign', where: '' }] };

  if (!task.client_id && !task.legacy_client_id) {
    missing.push({ label: 'Client', where: 'this campaign' });
  }
  if (!has(task.brand_name)) missing.push({ label: 'Brand', where: 'this campaign' });

  const amount = Number(task.budget);
  if (!Number.isFinite(amount) || amount <= 0) {
    missing.push({ label: 'Total amount', where: 'this campaign' });
  }

  // Only complain about client-record fields once we know which client.
  if (task.client_id || task.legacy_client_id) {
    if (!client) {
      missing.push({ label: "The client's registration", where: 'Clients' });
    } else {
      if (!has(client.cr_number))      missing.push({ label: 'CR number', where: `Clients → ${client.company_name}` });
      if (!has(client.vat_number))     missing.push({ label: 'VAT number', where: `Clients → ${client.company_name}` });
      if (!has(client.signatory_name)) missing.push({ label: 'Signatory name', where: `Clients → ${client.company_name}` });
      if (!has(client.contact_email) && !has(client.contact_phone)) {
        missing.push({ label: 'An email or phone number', where: `Clients → ${client.company_name}` });
      }
    }
  }

  return { ready: missing.length === 0, missing };
}

/**
 * What a vendor subtask costs.
 *
 * `price` is the field ops actually fills — the bulk popup writes it, the
 * campaign money rollup reads it, and the margin is computed from it. The
 * subtask also had a `budget` box, which nobody filled and which therefore
 * sat at 0 and blocked every contract request with "Budget — this subtask".
 * Siraj: "we can remove budget from vendor".
 *
 * `budget` is still read as a fallback so vendor rows created before this
 * change, which may have a budget and no price, keep their amount.
 */
export function vendorSubtaskAmount(subtask: PMTask | null): number | null {
  if (!subtask) return null;
  const price = Number(subtask.price);
  if (subtask.price != null && Number.isFinite(price) && price > 0) return price;
  const budget = Number(subtask.budget);
  if (subtask.budget != null && Number.isFinite(budget) && budget > 0) return budget;
  return null;
}

/**
 * What a VENDOR contract needs. Bank details matter here and don't for a
 * client — this is the side AQ pays.
 */
export function vendorContractReadiness(
  subtask: PMTask | null,
  vendor: LegacyVendor | null,
  bank: LegacyBankAccount | null,
  /** Sum of the subtask's ad lines, when the caller has them. */
  linesTotal?: number | null,
): ContractReadiness {
  const missing: MissingRequirement[] = [];
  const has = (v: unknown) => typeof v === 'string' ? v.trim().length > 0 : v != null;

  if (!subtask) return { ready: false, missing: [{ label: 'A vendor subtask', where: '' }] };

  if (!subtask.vendor_id || !vendor) {
    missing.push({ label: 'Vendor', where: 'this subtask' });
  }

  // Money can come from either place: a single price on the subtask, or the
  // ad lines inside it. `linesTotal` is passed in by callers that have
  // already loaded them — a booking priced entirely through its lines has no
  // subtask price, and asking for one would be asking for the same number
  // twice.
  const money = linesTotal != null && linesTotal > 0
    ? linesTotal
    : vendorSubtaskAmount(subtask);
  if (money == null) {
    missing.push({ label: 'Price, or at least one ad line', where: 'this subtask' });
  }

  if (vendor) {
    const where = `Vendors → ${vendor.name}`;
    const { kind, value } = vendorIdentifier(vendor as any);
    if (!value) {
      missing.push({ label: kind === 'license' ? 'Licence number' : 'ID number', where });
    }
    if (!has(vendor.signatory_name)) missing.push({ label: 'Signatory name', where });
    if (!bank) {
      missing.push({ label: 'Bank account', where });
    } else if (!has(bank.iban)) {
      missing.push({ label: 'IBAN', where });
    }
  }

  return { ready: missing.length === 0, missing };
}

/**
 * Send a client contract request straight through, with no form.
 *
 * Everything is read from the campaign and the client record at send time,
 * so the request can't disagree with them. Refuses rather than sending a
 * half-filled request — an incomplete one just becomes someone else's
 * chase-up.
 */
export async function sendClientContractRequest(input: {
  task: PMTask;
  client: ClientRow | null;
  requestedBy: string;
  notes?: string | null;
}): Promise<ContractRequest> {
  const { task, client, requestedBy } = input;
  const check = clientContractReadiness(task, client);
  if (!check.ready) {
    throw new Error(
      `Not ready to send. Still needed: ${check.missing.map((m) => m.label).join(', ')}.`,
    );
  }
  if (!task.workspace_id) throw new Error('This campaign has no workspace.');

  return createContractRequest({
    pm_task_id: task.id,
    workspace_id: task.workspace_id,
    requested_by: requestedBy,
    request_kind: 'client',
    template_key: null,
    brand_name: task.brand_name ?? '',
    amount: Number(task.budget),
    notes: input.notes?.trim() || null,

    client_name: client?.company_name ?? null,
    client_id_legacy: task.legacy_client_id ?? null,
    pending_client_id: null,
    cr_number: client?.cr_number ?? null,
    vat_number: client?.vat_number ?? null,
    signatory_name: client?.signatory_name ?? null,
    street: null,
    city: client?.city ?? null,
    postcode: null,
    country: client?.country ?? null,
    email: client?.contact_email ?? null,
    phone: client?.contact_phone ?? null,

    pending_vendor_id: null,
    vendor_id: null, vendor_name: null, vendor_category: null,
    vendor_email: null, vendor_phone: null,
    bank_account_id: null, bank_name: null, account_name: null,
    iban: null, account_number: null, swift_code: null,
    license_number: null, is_influencer: null,
    platforms: task.platforms?.join(', ') || null,
    ad_type: task.ad_type ?? null,
    qty: null, channel: null,
    details: task.task_name ?? task.title ?? null,
  } as any);
}

/**
 * Everything a vendor contract request carries, assembled from the subtask,
 * its parent campaign, the vendor record and the vendor's bank account.
 *
 * The rule Siraj set is "all data relevent from parent goes automatically to
 * sub tasks". A subtask holds the vendor and the money; the campaign holds the
 * client, the brand, the platforms and the ad type. A request built only from
 * the subtask arrived at the contract app with half its fields blank and
 * somebody had to type them again — so every campaign-level field is read
 * through here, with the subtask's own value winning where it has one.
 */
function buildVendorContractPayload(opts: {
  subtask: PMTask;
  parent: PMTask;
  vendor: LegacyVendor;
  bank: LegacyBankAccount | null;
  client?: ClientRow | null;
  requestedBy: string;
  notes?: string | null;
  /** The ads inside this booking (migration 056). Empty = the old shape. */
  lines?: AdLine[];
}) {
  const { subtask, parent, vendor, bank, client, requestedBy, notes } = opts;
  const lines = opts.lines ?? [];
  const lineTotals = totalsOf(lines);
  const txt = (v: unknown) => {
    const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    return s.length ? s : null;
  };

  // Subtask first, campaign second. A vendor booked on Instagram inside a
  // campaign that also runs TikTok should say Instagram, not both.
  const platforms = txt(subtask.platform) ?? campaignPlatformText(parent);
  const adType = txt(subtask.ad_type) ?? txt(parent.ad_type);
  const category = txt(vendor.vendor_category);

  return {
    pm_task_id: subtask.id,
    workspace_id: subtask.workspace_id as string,
    requested_by: requestedBy,
    request_kind: 'vendor' as const,
    template_key: null,
    brand_name: parent.brand_name ?? subtask.brand_name ?? '',
    // With ad lines, the lines ARE the price — a booking of six home ads and
    // six store visits is worth what they add up to, and the subtask's single
    // price field cannot express it. Without lines, nothing changes.
    amount: lines.length ? lineTotals.amount : vendorSubtaskAmount(subtask),
    notes: notes ?? null,

    // Who the work is ultimately for. The contract app shows it as context;
    // it is not the counterparty, so no CR/VAT/signatory of the client here.
    client_name: txt(client?.company_name),
    client_id_legacy: parent.legacy_client_id ?? null,
    pending_client_id: null,
    cr_number: null, vat_number: null, signatory_name: txt(vendor.signatory_name),
    street: null, city: null, postcode: null, country: null,
    email: null, phone: null,

    pending_vendor_id: null,
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    vendor_category: category,
    vendor_email: txt(vendor.email),
    vendor_phone: txt(vendor.phone),
    bank_account_id: bank?.id ?? null,
    bank_name: bank?.bank_name ?? null,
    account_name: bank?.account_name ?? null,
    iban: bank?.iban ?? null,
    account_number: bank?.account_number ?? null,
    swift_code: bank?.swift_code ?? null,
    license_number: txt(vendor.license_number) ?? txt(vendor.id_number),
    is_influencer: isTrackableVendorCategory(vendor.vendor_category),
    platforms,
    // "6 × Home Ad, 6 × Store Visit, 3 × Reminder" rather than one ad type,
    // so the contract says what was actually booked.
    ad_type: lines.length ? adTypeSummary(lines) : adType,
    // Counted by quantity: six home ads are six ads, not one line.
    // `channel` is still left alone — it isn't the platform list, and filling
    // it with a copy would be inventing data.
    qty: lines.length ? lineTotals.ads : null,
    channel: null,
    // Itemised once, free lines included. A reminder that costs nothing is
    // still part of the agreement.
    details: lines.length
      ? contractDetails(lines, subtask.title ?? null)
      : (subtask.title ?? null),
  };
}

/** Insert the request and link it back onto the subtask so it can't re-fire. */
async function insertVendorContractRequest(
  subtask: PMTask,
  payload: ReturnType<typeof buildVendorContractPayload>,
): Promise<string> {
  const created = await createContractRequest(payload as any);
  await supabase
    .from('pm_tasks')
    .update({ contract_request_id: created.id } as any)
    .eq('id', subtask.id);
  return created.id;
}

/**
 * Send a vendor contract request on purpose, from the subtask.
 *
 * Siraj: "you cant request contract from subtask". The auto-fire below only
 * runs when everything happens to be in place and says nothing when it isn't,
 * so a subtask whose vendor was missing an IBAN just sat there. This is the
 * button: it refuses loudly, naming what's missing and where to fix it, which
 * is the same contract the client-side send already honours.
 */
export async function sendVendorContractRequest(opts: {
  subtask: PMTask;
  parent: PMTask;
  vendor: LegacyVendor | null;
  bank: LegacyBankAccount | null;
  client?: ClientRow | null;
  requestedBy: string;
  notes?: string | null;
}): Promise<string> {
  const { subtask, vendor, bank } = opts;

  if ((subtask as any).contract_request_id) {
    throw new Error('A contract has already been requested for this subtask.');
  }
  if (!subtask.workspace_id) {
    throw new Error('This subtask has no workspace; cannot raise a request.');
  }

  // One contract per vendor subtask, covering every ad inside it.
  const lines = await fetchVendorAdLines(subtask.id);
  const linesTotal = totalsOf(lines).amount;

  const check = vendorContractReadiness(subtask, vendor, bank, linesTotal);
  if (!check.ready || !vendor) {
    throw new Error(
      `Not ready to send. Still needed: ${check.missing.map((m) => m.label).join(', ')}.`,
    );
  }

  return insertVendorContractRequest(
    subtask,
    buildVendorContractPayload({ ...opts, vendor, bank, lines }),
  );
}

/**
 * Auto-create a contract request for a subtask the moment it has both a
 * vendor AND a non-zero budget. No-op if the subtask already has a
 * `contract_request_id` (idempotent: safe to call from any save path).
 *
 * Returns the new contract_request id, or null if no action was taken.
 */
export async function autoCreateContractRequestForSubtask(opts: {
  subtask: PMTask;
  parent: PMTask;
  vendor: LegacyVendor | null;
  bank: LegacyBankAccount | null;
  client?: ClientRow | null;
  requestedBy: string;
  notes?: string | null;
}): Promise<string | null> {
  const { subtask, vendor, bank } = opts;

  // Already sent? Don't double-fire.
  if ((subtask as any).contract_request_id) return null;

  // Need a vendor, and money from somewhere — the subtask's price or its ad
  // lines. A package booked entirely through lines has no subtask price.
  if (!vendor) return null;

  const lines = await fetchVendorAdLines(subtask.id);
  const linesTotal = totalsOf(lines).amount;
  if (vendorSubtaskAmount(subtask) == null && linesTotal <= 0) return null;

  if (!subtask.workspace_id) {
    throw new Error('Subtask has no workspace_id; cannot create contract request.');
  }
  if (!vendorContractReadiness(subtask, vendor, bank, linesTotal).ready) return null;

  return insertVendorContractRequest(
    subtask,
    buildVendorContractPayload({ ...opts, vendor, bank, lines }),
  );
}

// ── Contract state per subtask, and the counts built on it ──────────
//
// Siraj: "if vendors have some missing data show a count of the requested and
// highlight the ones requested and the one still missing contracts".
//
// Three states that matter, plus one for rows the question doesn't apply to
// (an analysis report has no vendor and owes no contract).

export type SubtaskContractState = 'requested' | 'ready' | 'missing' | 'n/a';

export function subtaskContractState(
  subtask: PMTask,
  vendor: LegacyVendor | null,
  bank: LegacyBankAccount | null,
): SubtaskContractState {
  if (!isVendorSubtaskKind(subtask.subtask_kind)) return 'n/a';
  if (subtask.contract_request_id) return 'requested';
  return vendorContractReadiness(subtask, vendor, bank).ready ? 'ready' : 'missing';
}

export interface ContractTally {
  /** Vendor subtasks — the only ones that owe a contract. */
  total: number;
  requested: number;
  /** Everything present, just not sent yet. */
  ready: number;
  /** Blocked on data somebody has to fill in. */
  missing: number;
}

export function contractTally(
  subtasks: PMTask[],
  vendors: LegacyVendor[],
  banks: LegacyBankAccount[],
): ContractTally {
  const tally: ContractTally = { total: 0, requested: 0, ready: 0, missing: 0 };
  for (const s of subtasks) {
    const v = s.vendor_id != null ? vendors.find((x) => x.id === s.vendor_id) ?? null : null;
    const b = v ? banks.find((x) => x.vendor_id === v.id) ?? null : null;
    const state = subtaskContractState(s, v, b);
    if (state === 'n/a') continue;
    tally.total += 1;
    tally[state] += 1;
  }
  return tally;
}

/**
 * Request contracts for several subtasks at once.
 *
 * Never all-or-nothing: one vendor missing an IBAN must not stop the other
 * six going out. Every failure comes back named so the caller can show which
 * rows were skipped and why, rather than a single "some failed".
 */
export async function sendVendorContractRequests(opts: {
  subtasks: PMTask[];
  parent: PMTask;
  vendors: LegacyVendor[];
  banks: LegacyBankAccount[];
  client?: ClientRow | null;
  requestedBy: string;
}): Promise<{ sent: number; skipped: { title: string; reason: string }[] }> {
  const skipped: { title: string; reason: string }[] = [];
  let sent = 0;

  for (const subtask of opts.subtasks) {
    const vendor = subtask.vendor_id != null
      ? opts.vendors.find((v) => v.id === subtask.vendor_id) ?? null
      : null;
    const bank = vendor ? opts.banks.find((b) => b.vendor_id === vendor.id) ?? null : null;
    try {
      await sendVendorContractRequest({
        subtask, parent: opts.parent, vendor, bank,
        client: opts.client, requestedBy: opts.requestedBy,
      });
      sent += 1;
    } catch (e: any) {
      skipped.push({ title: subtask.title, reason: e?.message ?? String(e) });
    }
  }

  return { sent, skipped };
}

/** Apply the same change to several subtasks. Failures are reported, not thrown. */
export async function updateTasksBulk(
  taskIds: string[],
  fields: Partial<PMTask>,
): Promise<{ updated: number; failed: { id: string; reason: string }[] }> {
  const failed: { id: string; reason: string }[] = [];
  let updated = 0;
  for (const id of taskIds) {
    try { await updateTaskFields(id, fields); updated += 1; }
    catch (e: any) { failed.push({ id, reason: e?.message ?? String(e) }); }
  }
  return { updated, failed };
}

// ============================================================
// CRM activity log (migration 014)
// Per-client / per-vendor timeline. Foundation for "last contacted",
// dormant-account queries, follow-up reminders. Same hook handles both
// target types via the `target_type` discriminator.
// ============================================================

export type CrmTargetType = 'client' | 'vendor';
export type CrmActivityKind = 'note' | 'call' | 'meeting' | 'email' | 'status_change';

export interface CrmActivity {
  id: string;
  workspace_id: string;
  target_type: CrmTargetType;
  target_id: string;
  kind: CrmActivityKind;
  body: string;
  author_id: string | null;
  author_name: string;
  occurred_at: string;
  created_at: string;
}

/** All activities for the workspace, newest first. Used by the CRM
 *  dashboard "recent activity" feed. */
export function useCrmRecentActivities(workspaceId: string | null, limit = 50) {
  const [items, setItems] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('crm_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) logSbError('useCrmRecentActivities', error, { workspaceId });
    setItems((data || []) as CrmActivity[]);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/** Activities for one specific client/vendor, newest first. */
export function useCrmActivities(
  workspaceId: string | null,
  targetType: CrmTargetType | null,
  targetId: string | null,
) {
  const [items, setItems] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId || !targetType || !targetId) {
      setItems([]); setLoading(false); return;
    }
    const { data, error } = await supabase
      .from('crm_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('target_type', targetType)
      .eq('target_id', String(targetId))
      .order('occurred_at', { ascending: false });
    if (error) logSbError('useCrmActivities', error, { workspaceId, targetType, targetId });
    setItems((data || []) as CrmActivity[]);
    setLoading(false);
  }, [workspaceId, targetType, targetId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function addCrmActivity(input: {
  workspace_id: string;
  target_type: CrmTargetType;
  target_id: string;
  kind: CrmActivityKind;
  body: string;
  author_id: string;
  author_name: string;
  occurred_at?: string;     // defaults to now() server-side
}) {
  const { data, error } = await supabase
    .from('crm_activities')
    .insert({
      workspace_id: input.workspace_id,
      target_type:  input.target_type,
      target_id:    String(input.target_id),
      kind:         input.kind,
      body:         input.body,
      author_id:    input.author_id,
      author_name:  input.author_name,
      occurred_at:  input.occurred_at ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as CrmActivity;
}

export async function deleteCrmActivity(id: string) {
  const { error } = await supabase.from('crm_activities').delete().eq('id', id);
  if (error) throw error;
}

/* ────────────────────────────────────────────────────────────────
   Auto-logging PM events onto the CRM timeline

   The CRM used to know only what somebody typed into it, so a client's
   timeline showed the calls people remembered to log and nothing about
   the campaigns we actually ran. These helpers are the bridge: creating
   a campaign, finishing one, getting the contract signed and getting
   paid all land on that client's timeline by themselves.

   Two deliberate properties:

   · Logging NEVER breaks the thing that triggered it. Every call is
     wrapped — if the insert is refused (RLS, a missing workspace) the
     campaign still saves and the failure goes to the console. A timeline
     entry is worth less than the save it accompanies.
   · The wording, and the "is this worth logging at all?" rules, live in
     lib/crm-sync.ts, which is pure and unit tested. This file decides
     WHEN to ask, and does the writing.
   ──────────────────────────────────────────────────────────────── */

/** Who is doing this. Resolved once per session, not once per event. */
let CRM_ACTOR: { id: string; name: string } | null = null;

async function currentActor(): Promise<{ id: string; name: string } | null> {
  if (CRM_ACTOR) return CRM_ACTOR;
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const name = String((profile as any)?.full_name ?? '').trim()
    || String(user.email ?? '').trim()
    || 'Someone';
  CRM_ACTOR = { id: user.id, name };
  return CRM_ACTOR;
}

/** Forget the cached actor — called on sign-out so the next user isn't them. */
export function resetCrmActor() { CRM_ACTOR = null; }

async function logToClientTimeline(
  workspaceId: string | null,
  clientId: string | null,
  entry: { kind: CrmActivityKind; body: string } | null,
): Promise<void> {
  if (!entry || !workspaceId || !clientId) return;
  try {
    const actor = await currentActor();
    await addCrmActivity({
      workspace_id: workspaceId,
      target_type: 'client',
      target_id: clientId,
      kind: entry.kind,
      body: entry.body,
      author_id: actor?.id ?? '',
      author_name: actor?.name ?? 'System',
    });
  } catch (err) {
    // Deliberately swallowed — see the note above.
    logSbError('logToClientTimeline', err, { clientId, body: entry.body });
  }
}

/** Log a won or lost deal against whoever the deal is about. */
export async function logDealOutcome(deal: CrmDeal, stage: DealStage): Promise<void> {
  if (stage !== 'won' && stage !== 'lost') return;
  if (!deal.target_type || !deal.target_id) return;
  const entry = stage === 'won' ? onDealWon(deal) : onDealLost(deal);
  try {
    const actor = await currentActor();
    await addCrmActivity({
      workspace_id: deal.workspace_id,
      target_type: deal.target_type,
      target_id: String(deal.target_id),
      kind: entry.kind,
      body: entry.body,
      author_id: actor?.id ?? '',
      author_name: actor?.name ?? 'System',
    });
  } catch (err) {
    logSbError('logDealOutcome', err, { deal: deal.id, stage });
  }
}

// Pending vendor & client onboarding queues (legacy contract app)
export interface PendingVendor {
  id: number; full_name: string; license_number: string | null;
  email: string | null; phone: string | null;
  iban: string | null; bank_name: string | null; account_name: string | null;
  account_number: string | null; swift_code: string | null;
  vendor_category: string | null; platforms: string | null;
  status: string; submitted_at: string | null;
}
export interface PendingClient {
  id: number; company_name: string; cr_number: string | null;
  vat_number: string | null; signatory_name: string | null; phone: string | null; email: string | null;
  company_email: string | null; street: string | null; city: string | null;
  postcode: string | null; country: string | null; national_address: string | null;
  status: string; submitted_at: string | null;
}
export function usePendingVendors() {
  const [items, setItems] = useState<PendingVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('pending_vendors').select('*').order('submitted_at', { ascending: false });
    if (error) logSbError('usePendingVendors', error);
    setItems((data || []) as PendingVendor[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}
export function usePendingClients() {
  const [items, setItems] = useState<PendingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('pending_clients').select('*').order('submitted_at', { ascending: false });
    if (error) logSbError('usePendingClients', error);
    setItems((data || []) as PendingClient[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function approvePendingVendor(id: number, reviewerName: string) {
  const now = new Date().toISOString();
  const { data: pending, error: getErr } = await supabase
    .from('pending_vendors').select('*').eq('id', id).maybeSingle();
  if (getErr || !pending) throw getErr ?? new Error('Pending vendor not found');
  // Promote to vendors + bank_accounts
  const { data: vendor, error: vErr } = await supabase
    .from('vendors').insert({
      name: pending.full_name,
      license_number: pending.license_number ?? '',
      created_at: now,
    }).select().single();
  if (vErr) throw vErr;
  if (pending.iban) {
    const { error: bankErr } = await supabase.from('bank_accounts').insert({
      vendor_id: vendor.id,
      bank_name: pending.bank_name ?? '',
      account_name: pending.account_name ?? '',
      iban: pending.iban,
      account_number: pending.account_number ?? '',
      swift_code: pending.swift_code ?? '',
    });
    if (bankErr) throw bankErr;
  }
  const { error: updateErr } = await supabase.from('pending_vendors')
    .update({ status: 'approved', reviewed_at: now }).eq('id', id);
  if (updateErr) throw updateErr;
}
export async function rejectPendingVendor(id: number) {
  const { error } = await supabase.from('pending_vendors')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function approvePendingClient(id: number) {
  const { error } = await supabase.from('pending_clients')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function rejectPendingClient(id: number) {
  const { error } = await supabase.from('pending_clients')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function createApprovedClientRegistration(input: {
  company_name: string;
  cr_number?: string;
  vat_number?: string;
  signatory_name?: string;
  phone?: string;
  email?: string;
  company_email?: string;
  street?: string;
  city?: string;
  postcode?: string;
  country?: string;
  national_address?: string;
}) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('pending_clients')
    .insert({
      ...input,
      company_email: input.company_email || input.email || '',
      status: 'approved',
      submitted_at: now,
      reviewed_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PendingClient;
}

/**
 * Vendor create payload — covers the migration-029 surface.
 *
 * Required: full_name, category_id, signatory_name, contact info, bank info,
 * and (id_number OR license_number depending on the category's
 * requires_license flag — the UI enforces this; the backend just stores
 * whatever's sent).
 *
 * Per-category optional fields are also accepted here. The DB schema lets
 * them be NULL for any category — the UI hides what isn't relevant.
 */
export interface VendorRegistrationInput {
  full_name: string;
  category_id?: string | null;
  // Identifiers — one or the other depending on category
  id_number?: string;
  license_number?: string;
  // Base
  signatory_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  vat_number?: string;
  details?: string;
  // Legacy free-text (kept for backward compat with old form callers)
  vendor_category?: string;
  platforms?: string;
  // Bank info (goes to public.bank_accounts)
  bank_name?: string;
  account_name?: string;
  iban?: string;
  account_number?: string;
  swift_code?: string;
  // Per-category optional
  location_link?: string;
  short_address?: string;
  age?: number | null;
  gender?: string;
  rental_type?: string;
  event_opening?: string;
  event_ceremony?: string;
  location_type?: string;
}

export async function createApprovedVendorRegistration(input: VendorRegistrationInput) {
  const now = new Date().toISOString();
  // Mirror request into pending_vendors as an audit trail. We only copy
  // columns that exist on pending_vendors — the new category fields are
  // not mirrored there (yet) so we hand-pick.
  const pendingPayload = {
    full_name: input.full_name,
    license_number: input.license_number ?? input.id_number ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    vendor_category: input.vendor_category ?? '',
    platforms: input.platforms ?? '',
    bank_name: input.bank_name ?? '',
    account_name: input.account_name ?? '',
    iban: input.iban ?? '',
    account_number: input.account_number ?? '',
    swift_code: input.swift_code ?? '',
    status: 'approved',
    submitted_at: now,
    reviewed_at: now,
  };
  const { data: pending, error: pendingErr } = await supabase
    .from('pending_vendors')
    .insert(pendingPayload)
    .select()
    .single();
  if (pendingErr) throw pendingErr;

  // Actual vendor row — picks up every new 029 column.
  const vendorPayload: Record<string, any> = {
    name: input.full_name,
    license_number: input.license_number ?? null,
    id_number: input.id_number ?? '',
    category_id: input.category_id ?? null,
    signatory_name: input.signatory_name ?? '',
    contact_name: input.contact_name ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    vat_number: input.vat_number ?? '',
    details: input.details ?? '',
    vendor_category: input.vendor_category ?? '',
    platforms: input.platforms ?? '',
    // Per-category — store whatever was sent, NULL/empty otherwise.
    location_link:  input.location_link  ?? '',
    short_address:  input.short_address  ?? '',
    age:            input.age ?? null,
    gender:         input.gender ?? '',
    rental_type:    input.rental_type ?? '',
    event_opening:  input.event_opening ?? '',
    event_ceremony: input.event_ceremony ?? '',
    location_type:  input.location_type ?? '',
    created_at: now,
  };
  const { data: vendor, error: vendorErr } = await supabase
    .from('vendors')
    .insert(vendorPayload)
    .select()
    .single();
  if (vendorErr) throw vendorErr;

  if (input.iban) {
    const { error: bankErr } = await supabase
      .from('bank_accounts')
      .insert({
        vendor_id: vendor.id,
        bank_name: input.bank_name ?? '',
        account_name: input.account_name || input.full_name,
        iban: input.iban,
        account_number: input.account_number ?? '',
        swift_code: input.swift_code ?? '',
      });
    if (bankErr) throw bankErr;
  }

  return pending as PendingVendor;
}

/**
 * Update an existing vendor — covers both the base fields and any
 * per-category fields. The bank-account update path also lives here:
 * if `iban` is included we upsert the FIRST bank_accounts row attached
 * to this vendor (the current schema treats the first row as primary).
 *
 * Pass only the fields that should change — undefined keys are stripped.
 */
export async function updateVendorRegistration(
  vendorId: number,
  patch: Partial<VendorRegistrationInput>,
) {
  // Whitelisted vendors-table fields. Anything else is silently ignored.
  const vendorPatch: Record<string, any> = {};
  const map: Array<[keyof VendorRegistrationInput, string]> = [
    ['full_name',       'name'],
    ['category_id',     'category_id'],
    ['id_number',       'id_number'],
    ['license_number',  'license_number'],
    ['signatory_name',  'signatory_name'],
    ['contact_name',    'contact_name'],
    ['email',           'email'],
    ['phone',           'phone'],
    ['vat_number',      'vat_number'],
    ['details',         'details'],
    ['vendor_category', 'vendor_category'],
    ['platforms',       'platforms'],
    ['location_link',   'location_link'],
    ['short_address',   'short_address'],
    ['age',             'age'],
    ['gender',          'gender'],
    ['rental_type',     'rental_type'],
    ['event_opening',   'event_opening'],
    ['event_ceremony',  'event_ceremony'],
    ['location_type',   'location_type'],
  ];
  for (const [from, to] of map) {
    if (patch[from] !== undefined) vendorPatch[to] = patch[from];
  }

  if (Object.keys(vendorPatch).length > 0) {
    const { error } = await supabase
      .from('vendors')
      .update(vendorPatch)
      .eq('id', vendorId);
    if (error) throw error;
  }

  // Bank account — upsert the first row if any bank field changed.
  const bankTouched =
    patch.bank_name !== undefined ||
    patch.account_name !== undefined ||
    patch.iban !== undefined ||
    patch.account_number !== undefined ||
    patch.swift_code !== undefined;

  if (bankTouched) {
    const { data: existing } = await supabase
      .from('bank_accounts')
      .select('id')
      .eq('vendor_id', vendorId)
      .order('id', { ascending: true })
      .limit(1);

    const bankPatch: Record<string, any> = {
      vendor_id: vendorId,
      bank_name:      patch.bank_name      ?? '',
      account_name:   patch.account_name   ?? '',
      iban:           patch.iban           ?? '',
      account_number: patch.account_number ?? '',
      swift_code:     patch.swift_code     ?? '',
    };

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from('bank_accounts')
        .update(bankPatch)
        .eq('id', existing[0].id);
      if (error) throw error;
    } else if (patch.iban) {
      // Only create a new bank row if we actually have an IBAN to anchor it.
      const { error } = await supabase
        .from('bank_accounts')
        .insert(bankPatch);
      if (error) throw error;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Multi-bank CRUD for the Design C modal.
//
// The existing updateVendorRegistration only manages a single primary
// bank row. The new modal lets you keep multiple banks per vendor, so
// we expose primitives the modal can call when the user adds/removes
// banks tab-by-tab. Each call is a single REST round-trip; the modal
// orchestrates batching.
// ─────────────────────────────────────────────────────────────────────

export interface VendorBankInput {
  bank_name?: string;
  account_name?: string;
  iban?: string;
  account_number?: string;
  swift_code?: string;
}

/** Add a new bank account to a vendor. Returns the created row. */
export async function addVendorBank(
  vendorId: number,
  bank: VendorBankInput,
): Promise<LegacyBankAccount> {
  const payload = {
    vendor_id:      vendorId,
    bank_name:      bank.bank_name ?? '',
    account_name:   bank.account_name ?? '',
    iban:           bank.iban ?? '',
    account_number: bank.account_number ?? '',
    swift_code:     bank.swift_code ?? '',
  };
  const { data, error } = await supabase
    .from('bank_accounts')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as LegacyBankAccount;
}

/**
 * Patch fields on a single bank_accounts row. Undefined keys are
 * skipped — the underlying values stay as-is.
 */
export async function updateVendorBank(
  bankId: number,
  patch: VendorBankInput,
): Promise<void> {
  const update: Record<string, any> = {};
  for (const k of ['bank_name','account_name','iban','account_number','swift_code'] as const) {
    if (patch[k] !== undefined) update[k] = patch[k];
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await supabase
    .from('bank_accounts')
    .update(update)
    .eq('id', bankId);
  if (error) throw error;
}

/**
 * Delete a single bank_accounts row. Files in storage that were
 * attached to that bank (slot = `bank:<id>`) are NOT deleted here;
 * the modal cleans those up separately via deleteVendorFile so we
 * don't accidentally torch a file that's been reassigned.
 */
export async function deleteVendorBank(bankId: number): Promise<void> {
  const { error } = await supabase
    .from('bank_accounts')
    .delete()
    .eq('id', bankId);
  if (error) throw error;
}

/** Service types attached to a single task (multi). */
export function useTaskServiceTypes(taskId: string | null) {
  const [items, setItems] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_service_types')
      .select('service_type:service_types(*)')
      .eq('task_id', taskId)
      .order('position', { ascending: true });
    if (error) logSbError('useTaskServiceTypes', error, { taskId });
    setItems(((data || []) as any[]).map((r) => r.service_type).filter(Boolean) as ServiceType[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}


// ─── CRM Deals (sales pipeline) ──────────────────────────────────────

export type DealStage = 'prospect' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export const DEAL_STAGES: { key: DealStage; label: string }[] = [
  { key: 'prospect',    label: 'Prospect' },
  { key: 'qualified',   label: 'Qualified' },
  { key: 'proposal',    label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'won',         label: 'Won' },
  { key: 'lost',        label: 'Lost' },
];

export interface CrmDeal {
  id: string;
  workspace_id: string;
  target_type: 'client' | 'vendor' | null;
  target_id: string | null;
  name: string;
  value: number;
  currency_code: string;
  stage: DealStage;
  probability: number | null;
  expected_close_date: string | null;
  owner_id: string | null;
  owner_name: string;
  notes: string;
  stage_changed_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useCrmDeals(workspaceId: string | null) {
  const [items, setItems] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('crm_deals')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('stage_changed_at', { ascending: false });
    if (error) logSbError('useCrmDeals', error, { workspaceId });
    setItems((data || []) as CrmDeal[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function addCrmDeal(deal: {
  workspace_id: string;
  name: string;
  value?: number;
  currency_code?: string;
  stage?: DealStage;
  probability?: number | null;
  expected_close_date?: string | null;
  target_type?: 'client' | 'vendor' | null;
  target_id?: string | null;
  owner_id?: string | null;
  owner_name?: string;
  notes?: string;
}) {
  const { data, error } = await supabase
    .from('crm_deals')
    .insert([deal])
    .select()
    .single();
  if (error) throw error;
  return data as CrmDeal;
}

export async function updateCrmDeal(id: string, updates: Partial<CrmDeal>) {
  const { error } = await supabase.from('crm_deals').update(updates).eq('id', id);
  if (error) throw error;
}

export async function moveCrmDealStage(id: string, stage: DealStage) {
  // stage_changed_at + closed_at are maintained by the trigger.
  const { error } = await supabase.from('crm_deals').update({ stage }).eq('id', id);
  if (error) throw error;
}

export async function deleteCrmDeal(id: string) {
  const { error } = await supabase.from('crm_deals').delete().eq('id', id);
  if (error) throw error;
}


// ─── CRM Tasks (follow-ups / next actions) ───────────────────────────

export interface CrmTask {
  id: string;
  workspace_id: string;
  target_type: 'client' | 'vendor' | null;
  target_id: string | null;
  deal_id: string | null;
  title: string;
  description: string;
  due_at: string | null;
  assigned_to_id: string | null;
  assigned_to_name: string;
  completed_at: string | null;
  completed_by_id: string | null;
  created_by_id: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export function useCrmTasks(workspaceId: string | null, opts?: {
  assignedTo?: string;            // user id — show only this user's tasks
  targetType?: 'client' | 'vendor';
  targetId?: string;
  dealId?: string;
  includeCompleted?: boolean;
}) {
  const [items, setItems] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    let q = supabase
      .from('crm_tasks')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (opts?.assignedTo)   q = q.eq('assigned_to_id', opts.assignedTo);
    if (opts?.targetType)   q = q.eq('target_type', opts.targetType);
    if (opts?.targetId)     q = q.eq('target_id', opts.targetId);
    if (opts?.dealId)       q = q.eq('deal_id', opts.dealId);
    if (!opts?.includeCompleted) q = q.is('completed_at', null);
    q = q.order('due_at', { ascending: true, nullsFirst: false });
    const { data, error } = await q;
    if (error) logSbError('useCrmTasks', error, { workspaceId, opts });
    setItems((data || []) as CrmTask[]);
    setLoading(false);
  }, [workspaceId, opts?.assignedTo, opts?.targetType, opts?.targetId, opts?.dealId, opts?.includeCompleted]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function addCrmTask(task: {
  workspace_id: string;
  title: string;
  description?: string;
  due_at?: string | null;
  target_type?: 'client' | 'vendor' | null;
  target_id?: string | null;
  deal_id?: string | null;
  assigned_to_id?: string | null;
  assigned_to_name?: string;
  created_by_id?: string | null;
  created_by_name?: string;
}) {
  const { data, error } = await supabase
    .from('crm_tasks')
    .insert([task])
    .select()
    .single();
  if (error) throw error;
  return data as CrmTask;
}

export async function updateCrmTask(id: string, updates: Partial<CrmTask>) {
  const { error } = await supabase.from('crm_tasks').update(updates).eq('id', id);
  if (error) throw error;
}

export async function completeCrmTask(id: string, userId: string) {
  const { error } = await supabase.from('crm_tasks').update({
    completed_at: new Date().toISOString(),
    completed_by_id: userId,
  }).eq('id', id);
  if (error) throw error;
}

export async function uncompleteCrmTask(id: string) {
  const { error } = await supabase.from('crm_tasks').update({
    completed_at: null,
    completed_by_id: null,
  }).eq('id', id);
  if (error) throw error;
}

export async function deleteCrmTask(id: string) {
  const { error } = await supabase.from('crm_tasks').delete().eq('id', id);
  if (error) throw error;
}
