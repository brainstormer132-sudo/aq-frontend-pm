'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

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

async function cachedFetch<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
  const now = Date.now();
  const hit = REF_CACHE.get(key) as CacheEntry<T> | undefined;
  if (!force && hit) {
    // A request already in flight: join it rather than starting a second.
    if (hit.inflight) return hit.inflight;
    if (now - hit.at < REF_CACHE_TTL_MS) return hit.data;
  }
  const inflight = loader().then(
    (data) => { REF_CACHE.set(key, { at: Date.now(), data, inflight: null }); return data; },
    (err) => { REF_CACHE.delete(key); throw err; },
  );
  REF_CACHE.set(key, { at: hit?.at ?? 0, data: hit?.data as T, inflight });
  return inflight;
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

  const fetch = useCallback(async () => {
    if (!workspaceId) { setRole(null); setLoading(false); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRole(null); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) { logSbError('useMyRole', error, { workspaceId }); }
    setRole((data?.role as WorkspaceRole) ?? null);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { role, loading, refetch: fetch };
}

/** Service-type templates and any workspace-custom ones, with their steps. */
export function useServiceTypes(workspaceId: string | null) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [steps, setSteps] = useState<ServiceTypeStep[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    // Templates (workspace_id NULL) + this workspace's customs
    let query = supabase.from('service_types').select('*').order('position', { ascending: true });
    const { data: types, error } = await query;
    if (error) logSbError('useServiceTypes types', error, { workspaceId });
    const filtered = (types || []).filter((t: any) => t.workspace_id === null || t.workspace_id === workspaceId);
    setServiceTypes(filtered as ServiceType[]);

    if (filtered.length) {
      const { data: stepRows, error: stepErr } = await supabase
        .from('service_type_steps')
        .select('*')
        .in('service_type_id', filtered.map((t: any) => t.id))
        .order('position', { ascending: true });
      if (stepErr) logSbError('useServiceTypes steps', stepErr, { workspaceId });
      setSteps((stepRows || []) as ServiceTypeStep[]);
    } else {
      setSteps([]);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { serviceTypes, steps, loading, refetch: fetch };
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

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_sources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (error) logSbError('useTaskSources', error, { workspaceId });
    setItems((data || []) as TaskSource[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/** Platform options for the campaign multi-select (migration 042). */
export function useTaskPlatforms(workspaceId: string | null) {
  const [items, setItems] = useState<TaskSource[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_platforms')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (error) logSbError('useTaskPlatforms', error, { workspaceId });
    setItems((data || []) as TaskSource[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export function useClientCategories(workspaceId: string | null) {
  const [items, setItems] = useState<ClientCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('client_categories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (error) logSbError('useClientCategories', error, { workspaceId });
    setItems((data || []) as ClientCategory[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
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

  const fetch = useCallback(async () => {
    if (!workspaceId) { setProfiles([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('role, profile:profiles(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId);
    if (error) logSbError('useWorkspaceProfiles', error, { workspaceId });
    const out = (data || [])
      .filter((m: any) => m.profile)
      .map((m: any) => ({ ...m.profile, role: m.role as WorkspaceRole }));
    setProfiles(out);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { profiles, loading, refetch: fetch };
}

/** Workflow tasks in a workspace, optionally filtered by stage. */
export function useWorkflowTasks(workspaceId: string | null, stage?: TaskStage | 'all') {
  const [tasks, setTasks] = useState<PMTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setTasks([]); setLoading(false); return; }
    let query = supabase.from('pm_tasks').select('*').eq('workspace_id', workspaceId).is('parent_task_id', null);
    if (stage && stage !== 'all') query = query.eq('stage', stage);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) logSbError('useWorkflowTasks', error, { workspaceId, stage });
    setTasks((data || []) as PMTask[]);
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
      budget: input.budget ?? null,
      description: input.details ?? null,
      creator_id: input.creator_id,
      stage: 'pending_marketing',
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data as PMTask;
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

    const price = Number(input.price_excl);
    await createTrackingRow(input.parent_task_id, {
      position: nextPos,
      influencer_name: name,
      platform: input.platform ?? '',
      price_excl: Number.isFinite(price) && input.price_excl != null ? price : 0,
    });
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
  } = {},
): CompletenessWarning[] {
  if (!parent) return [];
  const out: CompletenessWarning[] = [];

  if (!parent.proof_of_posting_attached && !(parent.proof_of_posting_link ?? '').trim()) {
    out.push({ key: 'proof_of_posting', message: 'Proof of posting has not been added.' });
  }

  if (opts.expectsAnalysisReport) {
    const analysis = subtasks.filter((s) => s.subtask_kind === 'analysis_report');
    if (analysis.length === 0) {
      out.push({ key: 'analysis_report', message: 'No analysis report yet.' });
    } else if (!analysis.some((s) => s.status === 'done')) {
      out.push({ key: 'analysis_report', message: 'The analysis report is not finished.' });
    }
  }

  // Insight lives on the vendor subtask. Only complain once we have vendors
  // to hang it off — a campaign with no vendors yet isn't missing anything.
  const vendors = subtasks.filter((s) => isVendorSubtaskKind(s.subtask_kind));
  if (vendors.length > 0) {
    const without = vendors.filter(
      (s) => !s.insight_attached && !(s.insight_link ?? '').trim(),
    );
    if (without.length > 0) {
      out.push({
        key: 'insight',
        message: without.length === vendors.length
          ? 'No insight added on any vendor yet.'
          : `Insight missing on ${without.length} of ${vendors.length} vendors.`,
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
  const { error } = await supabase.from('pm_tasks').update(fields).eq('id', taskId);
  if (error) throw error;
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
  const { error } = await supabase
    .from('pm_tasks')
    .update({
      status: 'done',
      stage: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);
  if (error) throw error;
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
  return { task, loading, refetch: fetch };
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
): { text: string; caret: number } {
  const token = `${mentionToken(userId)} `;
  const next = text.slice(0, start) + token + text.slice(caret);
  return { text: next, caret: start + token.length };
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
        const [{ data: v, error: vE }, { data: b, error: bE }] = await Promise.all([
          supabase.from('vendors').select('*').order('name', { ascending: true }),
          supabase.from('bank_accounts').select('*'),
        ]);
        if (vE) logSbError('useLegacyVendors vendors', vE);
        if (bE) logSbError('useLegacyVendors banks', bE);
        return { vendors: (v || []) as LegacyVendor[], banks: (b || []) as LegacyBankAccount[] };
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
    const rows = await cachedFetch<ClientRow[]>('clients', async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_name, cr_number, vat_number, signatory_name, contact_email, contact_phone, city, country, status, zoho_customer_id, client_category_id')
        .order('company_name', { ascending: true });
      if (error) { logSbError('useClients', error); return []; }
      return (data || []) as ClientRow[];
    }, force);
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
  requestedBy: string;
  notes?: string | null;
}): Promise<string | null> {
  const { subtask, parent, vendor, bank, requestedBy, notes } = opts;

  // Already sent? Don't double-fire.
  if ((subtask as any).contract_request_id) return null;

  // Need both vendor + budget to be meaningful.
  if (!vendor) return null;
  const amount = Number(subtask.budget);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (!subtask.workspace_id) {
    throw new Error('Subtask has no workspace_id; cannot create contract request.');
  }

  const created = await createContractRequest({
    pm_task_id: subtask.id,
    workspace_id: subtask.workspace_id,
    requested_by: requestedBy,
    request_kind: 'vendor',
    template_key: null,
    brand_name: parent.brand_name ?? subtask.brand_name ?? '',
    amount,
    notes: notes ?? null,

    client_name: null,
    client_id_legacy: parent.legacy_client_id ?? null,
    pending_client_id: null,
    cr_number: null, vat_number: null, signatory_name: null,
    street: null, city: null, postcode: null, country: null,
    email: null, phone: null,

    pending_vendor_id: null,
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    vendor_category: null,
    vendor_email: null,
    vendor_phone: null,
    bank_account_id: bank?.id ?? null,
    bank_name: bank?.bank_name ?? null,
    account_name: bank?.account_name ?? null,
    iban: bank?.iban ?? null,
    account_number: bank?.account_number ?? null,
    swift_code: bank?.swift_code ?? null,
    license_number: vendor.license_number ?? null,
    is_influencer: null,
    platforms: null,
    ad_type: null,
    qty: null,
    channel: null,
    details: subtask.title ?? null,
  } as any);

  // Link the request id back onto the subtask so we don't re-fire.
  await supabase
    .from('pm_tasks')
    .update({ contract_request_id: created.id } as any)
    .eq('id', subtask.id);

  return created.id;
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
