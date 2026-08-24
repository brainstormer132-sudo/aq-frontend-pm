/**
 * The tracking sheet: the list of campaigns that have one, and the sheet itself.
 *
 * Pure. No React, no Supabase, and no argless `new Date()` — every function
 * that needs to know the date is handed it, so a test can pin the day and the
 * server and the browser can never render two different answers.
 *
 * Three things in here are not cosmetic:
 *
 *  1. Row numbers. The `#` column used to be the index in the *filtered* list,
 *     so turning on a status filter renumbered the sheet. That number is what
 *     people read out on a call and what the Excel export carries, so it is
 *     computed once, from the sheet's own order, and never changes when the
 *     view narrows.
 *
 *  2. Export scope. `exportTrackingXlsx` was handed the filtered rows. Filter to
 *     Posted, press Export, and the client receives a sheet with every unposted
 *     ad silently missing. The button now says what it is about to send.
 *
 *  3. Publish state. `tracking_published_at` existed and only the task panel
 *     ever showed it. From this screen you could not tell published from stale
 *     from never-published. `publishStatus` compares the working rows against
 *     the published snapshot row by row and says which.
 *
 * A note on zero. A tracking row seeded from a vendor booking arrives with
 * price_excl = 0 because the column is NOT NULL — that is "nobody has priced
 * this", not "free". Money here is `number | null`, and null prints as an
 * em dash. Same rule as the All Tasks register.
 */

// ── Small shared helpers ────────────────────────────────────────────

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A money figure where zero means "not priced", not "free". */
function pos(v: unknown): number | null {
  const n = num(v);
  return n != null && n > 0 ? n : null;
}

/** Group-separated, two decimals, no locale lookup. */
export function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(2);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}.${frac}`;
}

/** Whole SAR, for headline totals. */
export function moneyRound(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const whole = String(Math.round(Math.abs(v)));
  return `${v < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The date part of anything the database hands back. '' when unusable. */
export function isoDay(v: unknown): string {
  const s = txt(v);
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/**
 * "12 Aug" inside the current year, "14 Jul 2025" outside it.
 *
 * Built by hand rather than through toLocaleDateString, which reads the
 * machine's locale and therefore renders differently on the server and in
 * the browser — a hydration mismatch waiting to happen.
 */
export function shortDate(value: unknown, today: string): string {
  const day = isoDay(value);
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  const label = `${Number(d)} ${MONTHS[Number(m) - 1] ?? '?'}`;
  return day.slice(0, 4) === isoDay(today).slice(0, 4) ? label : `${label} ${y}`;
}

/** Sortable number for a date. 0 when there isn't one. */
export function dayMs(value: unknown): number {
  const day = isoDay(value);
  return day ? Date.parse(`${day}T00:00:00Z`) : 0;
}

/** Full timestamp comparison, for updated_at against published_at. */
function stampMs(value: unknown): number {
  const s = txt(value);
  if (!s) return 0;
  const n = Date.parse(s.includes('T') || s.includes(' ') ? s : `${s}T00:00:00Z`);
  return Number.isFinite(n) ? n : 0;
}

// ── Stage labels ────────────────────────────────────────────────────
//
// The list used to print `stage.replace('_', ' ')`, which lower-cases the
// screen and only replaces the FIRST underscore. Same words as All Tasks.

const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_marketing: 'Pending marketing',
  in_progress: 'In progress',
  awaiting_review: 'Awaiting review',
  completed: 'Completed',
};

export function stageLabel(raw: string | null | undefined): string {
  const k = txt(raw).toLowerCase();
  if (!k) return 'No stage';
  if (STAGE_LABELS[k]) return STAGE_LABELS[k];
  const words = k.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'No stage';
}

export const STAGE_FILTERS = [
  { key: '', label: 'All stages' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'pending_marketing', label: 'Pending marketing' },
  { key: 'awaiting_review', label: 'Awaiting review' },
  { key: 'completed', label: 'Completed' },
] as const;

// ── Publish state ───────────────────────────────────────────────────

export type PublishState = 'never' | 'stale' | 'current';

export interface PublishStatus {
  state: PublishState;
  /** ISO timestamp of the last publish, or null. */
  publishedAt: string | null;
  added: number;
  removed: number;
  edited: number;
  /** Everything the client is not yet seeing. */
  changes: number;
  /** For the list column: short. */
  label: string;
  /** For the banner above the sheet: a full sentence. */
  sentence: string;
  tone: 'none' | 'warn' | 'ok';
}

export interface WorkingRowStamp {
  id: string;
  updated_at?: string | null;
}

export interface PublishedRowStamp {
  /** The working row this snapshot came from. Null once the original is gone. */
  source_row_id?: string | null;
  updated_at?: string | null;
}

/**
 * What the client is currently seeing, compared with what is on the screen.
 *
 * Row-by-row rather than a single timestamp, because a timestamp cannot tell
 * you that somebody deleted a row: pm_tasks.tracking_published_at would still
 * be newer than every surviving row's updated_at, and the sheet would claim to
 * be up to date while the client looked at an ad that no longer exists.
 */
export function publishStatus(input: {
  publishedAt?: string | null;
  working: WorkingRowStamp[];
  published: PublishedRowStamp[];
  today: string;
}): PublishStatus {
  const publishedAt = txt(input.publishedAt) || null;
  const working = input.working ?? [];
  const published = input.published ?? [];

  if (!publishedAt && published.length === 0) {
    return {
      state: 'never', publishedAt: null,
      added: 0, removed: 0, edited: 0, changes: 0,
      label: 'Never published',
      sentence: working.length
        ? 'The client cannot see this sheet. Publishing sends them a copy.'
        : 'Nothing to publish yet.',
      tone: 'none',
    };
  }

  const snapshot = new Map<string, number>();
  let orphans = 0;
  for (const p of published) {
    const src = txt(p.source_row_id);
    if (!src) { orphans += 1; continue; }
    snapshot.set(src, stampMs(p.updated_at));
  }

  let added = 0;
  let edited = 0;
  const seen = new Set<string>();
  for (const w of working) {
    const id = txt(w.id);
    if (!id) continue;
    seen.add(id);
    if (!snapshot.has(id)) { added += 1; continue; }
    if (stampMs(w.updated_at) > (snapshot.get(id) ?? 0)) edited += 1;
  }

  // A published row whose source is gone was deleted here, and a snapshot row
  // that never carried a source id can no longer be matched to anything — both
  // are rows the client is seeing that the sheet no longer has.
  let removed = orphans;
  for (const src of snapshot.keys()) if (!seen.has(src)) removed += 1;

  const changes = added + removed + edited;
  const on = shortDate(publishedAt, input.today);

  if (changes === 0) {
    return {
      state: 'current', publishedAt,
      added, removed, edited, changes,
      label: 'Up to date',
      sentence: `The client is seeing this sheet as it is now. Published ${on}.`,
      tone: 'ok',
    };
  }

  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (edited) parts.push(`${edited} changed`);
  if (removed) parts.push(`${removed} removed`);

  return {
    state: 'stale', publishedAt,
    added, removed, edited, changes,
    label: `${changes} change${changes === 1 ? '' : 's'} since ${on}`,
    sentence: `The client is seeing this sheet as it was on ${on} — ${parts.join(', ')} since.`,
    tone: 'warn',
  };
}

// ── The list of campaigns ───────────────────────────────────────────

export interface CampaignInput {
  id: string;
  task_name?: string | null;
  title?: string | null;
  brand_name?: string | null;
  stage?: string | null;
  created_at?: string | null;
  tracking_published_at?: string | null;
  [key: string]: unknown;
}

export interface RollupRow {
  task_id: string;
  id: string;
  price_incl?: unknown;
  price_excl?: unknown;
  updated_at?: string | null;
}

export interface RollupPublishedRow {
  task_id: string;
  source_row_id?: string | null;
  updated_at?: string | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  brand: string;
  stage: string;
  stageLabel: string;
  /** Rows on the sheet. Called "ads" because that is what a row is. */
  ads: number;
  /** Total incl. VAT, or null when nothing on the sheet is priced. */
  total: number | null;
  created: string;
  createdMs: number;
  publish: PublishStatus;
  /** Lower-cased haystack for the search box. */
  search: string;
}

export function buildCampaigns(input: {
  campaigns: CampaignInput[];
  rows: RollupRow[];
  published: RollupPublishedRow[];
  today: string;
}): CampaignRow[] {
  const byTask = new Map<string, RollupRow[]>();
  for (const r of input.rows ?? []) {
    const k = txt(r.task_id);
    if (!k) continue;
    const list = byTask.get(k);
    if (list) list.push(r); else byTask.set(k, [r]);
  }

  const pubByTask = new Map<string, RollupPublishedRow[]>();
  for (const p of input.published ?? []) {
    const k = txt(p.task_id);
    if (!k) continue;
    const list = pubByTask.get(k);
    if (list) list.push(p); else pubByTask.set(k, [p]);
  }

  return (input.campaigns ?? []).map((c) => {
    const rows = byTask.get(txt(c.id)) ?? [];
    let total: number | null = null;
    for (const r of rows) {
      const v = pos(r.price_incl);
      if (v != null) total = (total ?? 0) + v;
    }
    const name = txt(c.task_name) || txt(c.title) || 'Untitled campaign';
    const brand = txt(c.brand_name);
    const stage = txt(c.stage);

    return {
      id: txt(c.id),
      name,
      brand,
      stage,
      stageLabel: stageLabel(stage),
      ads: rows.length,
      total,
      created: shortDate(c.created_at, input.today),
      createdMs: dayMs(c.created_at),
      publish: publishStatus({
        publishedAt: c.tracking_published_at ?? null,
        working: rows.map((r) => ({ id: txt(r.id), updated_at: r.updated_at ?? null })),
        published: pubByTask.get(txt(c.id)) ?? [],
        today: input.today,
      }),
      search: `${name} ${brand}`.toLowerCase(),
    };
  });
}

export type ListSortKey = 'name' | 'brand' | 'stage' | 'ads' | 'total' | 'client' | 'created';
export type SortDir = 'asc' | 'desc';
export interface ListSort { key: ListSortKey; dir: SortDir }

export const DEFAULT_LIST_SORT: ListSort = { key: 'created', dir: 'desc' };

export const LIST_COLUMNS: { key: ListSortKey; label: string; num?: boolean }[] = [
  { key: 'name', label: 'Campaign' },
  { key: 'brand', label: 'Brand' },
  { key: 'stage', label: 'Stage' },
  { key: 'ads', label: 'Ads', num: true },
  { key: 'total', label: 'Total incl. VAT', num: true },
  { key: 'client', label: 'Client sees' },
  { key: 'created', label: 'Created' },
];

/**
 * Which way a column opens on its first click.
 *
 * Text opens A–Z; a count, a total and a date open at the biggest or newest,
 * because that is the question being asked. "Client sees" opens at the sheets
 * with the most unpublished changes — the reason anybody sorts that column.
 */
export function firstListDir(key: ListSortKey): SortDir {
  if (key === 'name' || key === 'brand' || key === 'stage') return 'asc';
  return 'desc';
}

/** Stale first, then never published, then up to date. */
function publishRank(p: PublishStatus): number {
  if (p.state === 'stale') return 2 + Math.min(p.changes, 1);
  if (p.state === 'never') return 1;
  return 0;
}

export function sortCampaigns(rows: CampaignRow[], sort: ListSort): CampaignRow[] {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const out = [...(rows ?? [])];
  out.sort((a, b) => {
    let d = 0;
    switch (sort.key) {
      case 'name':  d = a.name.localeCompare(b.name); break;
      case 'brand': d = a.brand.localeCompare(b.brand); break;
      case 'stage': d = a.stageLabel.localeCompare(b.stageLabel); break;
      case 'ads':   d = a.ads - b.ads; break;
      case 'total': d = (a.total ?? -1) - (b.total ?? -1); break;
      case 'created': d = a.createdMs - b.createdMs; break;
      case 'client': {
        d = publishRank(a.publish) - publishRank(b.publish);
        if (d === 0) d = a.publish.changes - b.publish.changes;
        break;
      }
    }
    if (d !== 0) return d * dir;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export type ClientViewFilter = '' | 'needs' | 'current';

export interface ListFilter {
  query: string;
  stage: string;
  client: ClientViewFilter;
}

export const EMPTY_LIST_FILTER: ListFilter = { query: '', stage: '', client: '' };

export function isListFiltered(f: ListFilter): boolean {
  return Boolean(txt(f.query) || txt(f.stage) || txt(f.client));
}

export function filterCampaigns(rows: CampaignRow[], f: ListFilter): CampaignRow[] {
  const q = txt(f.query).toLowerCase();
  const stage = txt(f.stage);
  const client = txt(f.client) as ClientViewFilter;
  return (rows ?? []).filter((r) => {
    if (q && !r.search.includes(q)) return false;
    if (stage && r.stage !== stage) return false;
    if (client === 'needs' && r.publish.state === 'current') return false;
    if (client === 'current' && r.publish.state !== 'current') return false;
    return true;
  });
}

export interface ListSummary {
  campaigns: number;
  ads: number;
  total: number | null;
  /** Sheets the client is not seeing the current version of. */
  needsPublishing: number;
  label: string;
}

export function listSummary(rows: CampaignRow[]): ListSummary {
  const list = rows ?? [];
  let ads = 0;
  let total: number | null = null;
  let needsPublishing = 0;
  for (const r of list) {
    ads += r.ads;
    if (r.total != null) total = (total ?? 0) + r.total;
    if (r.publish.state !== 'current') needsPublishing += 1;
  }
  const parts = [
    `${list.length} campaign${list.length === 1 ? '' : 's'}`,
    `${ads} ad${ads === 1 ? '' : 's'}`,
  ];
  if (total != null) parts.push(`SAR ${moneyRound(total)} incl. VAT`);
  return { campaigns: list.length, ads, total, needsPublishing, label: parts.join(' · ') };
}

export function listEmptyMessage(f: ListFilter): string {
  if (txt(f.query)) return `No campaign matches “${txt(f.query)}”.`;
  if (f.client === 'needs') return 'Every sheet is published and up to date.';
  if (f.client === 'current') return 'No sheet is fully published yet.';
  if (txt(f.stage)) return `No tracking sheet on a campaign at ${stageLabel(f.stage).toLowerCase()}.`;
  return 'No tracking sheets yet. Pick “Tracking Sheet” as a subtask when triaging a campaign to start one.';
}

// ── Ad types ────────────────────────────────────────────────────────
//
// Type of ad was a free-text box, so the same ad arrived spelled five ways and
// the sheet could not be grouped or filtered by it. This is the list the vendor
// booking already uses (AD_TYPE_OPTIONS in hooks/use-workflow) — the same list
// on both sides is also the cheapest step towards ever merging the two tables.

export const TRACKING_AD_TYPES = [
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

/** Suggestions only — the platform box still takes anything. */
export const PLATFORM_SUGGESTIONS = [
  'Instagram', 'TikTok', 'Snapchat', 'X', 'YouTube', 'Facebook', 'LinkedIn', 'Outdoor',
] as const;

export type AdTypeKind = 'store' | 'home' | 'other';

/**
 * Which situational panel an ad type opens.
 *
 * The old code asked `type_of_ad.toLowerCase().includes('store')` against a
 * free-text box, so "Branch visit" opened nothing and "Homemade" opened the
 * home-ad fields. Known types are matched exactly; the substring test survives
 * only as a fallback for rows typed before the picker existed.
 */
export function adTypeKind(adType: unknown): AdTypeKind {
  const raw = txt(adType);
  if (!raw) return 'other';
  const key = raw.toLowerCase();

  const known = TRACKING_AD_TYPES.find((t) => t.toLowerCase() === key);
  if (known) {
    if (known === 'Store Visit' || known === 'Store Visit -Silent-') return 'store';
    if (known === 'Home Ad' || known === 'Home Ad -Silent-') return 'home';
    if (known === 'Event Attending') return 'store';
    return 'other';
  }

  // Legacy free text.
  if (key.includes('store') || key.includes('visit') || key.includes('event')) return 'store';
  if (key.includes('home')) return 'home';
  return 'other';
}

/** Which extra field groups the row editor shows. */
export function situationalPanels(adType: unknown, isEvent: unknown): {
  storeVisit: boolean; homeAd: boolean; plateRequired: boolean;
} {
  const kind = adTypeKind(adType);
  const event = Boolean(isEvent);
  return {
    storeVisit: kind === 'store' || event,
    homeAd: kind === 'home',
    plateRequired: event,
  };
}

// ── The sheet ───────────────────────────────────────────────────────

export const AD_STATUS_KEYS = ['Not started', 'Scheduled', 'Shot', 'Posted', 'Cancelled'] as const;
export type SheetStatus = typeof AD_STATUS_KEYS[number];

export function statusTone(status: unknown): 'ok' | 'info' | 'warn' | 'bad' | 'none' {
  switch (txt(status)) {
    case 'Posted': return 'ok';
    case 'Shot': return 'info';
    case 'Scheduled': return 'warn';
    case 'Cancelled': return 'bad';
    default: return 'none';
  }
}

export interface SheetRowInput {
  id: string;
  position?: unknown;
  influencer_name?: string | null;
  profile_link?: string | null;
  platform?: string | null;
  type_of_ad?: string | null;
  content?: string | null;
  product?: string | null;
  shooting_date?: string | null;
  posting_date?: string | null;
  ad_status?: string | null;
  ad_link?: string | null;
  price_excl?: unknown;
  price_incl?: unknown;
  is_event?: unknown;
  notes?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface SheetRow {
  id: string;
  /** The row's place in the sheet. Fixed — filtering does not renumber it. */
  num: number;
  name: string;
  platform: string;
  adType: string;
  product: string;
  shooting: string;
  posting: string;
  postingMs: number;
  status: string;
  tone: ReturnType<typeof statusTone>;
  link: string;
  excl: number | null;
  incl: number | null;
  isEvent: boolean;
  search: string;
}

export function buildSheet(rows: SheetRowInput[], today: string): SheetRow[] {
  const ordered = [...(rows ?? [])].sort((a, b) => {
    const pa = num(a.position);
    const pb = num(b.position);
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return txt(a.id).localeCompare(txt(b.id));
  });

  return ordered.map((r, i) => {
    const name = txt(r.influencer_name);
    const adType = txt(r.type_of_ad);
    const product = txt(r.product);
    const platform = txt(r.platform);
    const status = txt(r.ad_status) || 'Not started';
    return {
      id: txt(r.id),
      num: i + 1,
      name,
      platform,
      adType,
      product,
      shooting: shortDate(r.shooting_date, today),
      posting: shortDate(r.posting_date, today),
      postingMs: dayMs(r.posting_date),
      status,
      tone: statusTone(status),
      link: txt(r.ad_link),
      excl: pos(r.price_excl),
      incl: pos(r.price_incl),
      isEvent: Boolean(r.is_event),
      search: `${name} ${platform} ${adType} ${product} ${txt(r.content)} ${txt(r.notes)}`.toLowerCase(),
    };
  });
}

export interface SheetFilter { query: string; status: string }
export const EMPTY_SHEET_FILTER: SheetFilter = { query: '', status: '' };

export function isSheetFiltered(f: SheetFilter): boolean {
  return Boolean(txt(f.query) || txt(f.status));
}

export function filterSheet(rows: SheetRow[], f: SheetFilter): SheetRow[] {
  const q = txt(f.query).toLowerCase();
  const status = txt(f.status);
  return (rows ?? []).filter((r) => {
    if (q && !r.search.includes(q)) return false;
    if (status && r.status !== status) return false;
    return true;
  });
}

export interface SheetTotals {
  shown: number;
  all: number;
  excl: number | null;
  incl: number | null;
  /** True when the figures below the table are not the whole sheet. */
  partial: boolean;
  label: string;
}

/**
 * The figures under the table, and — this is the part that was missing — a
 * label that admits when they only describe part of the sheet.
 */
export function sheetTotals(all: SheetRow[], shown: SheetRow[]): SheetTotals {
  let excl: number | null = null;
  let incl: number | null = null;
  for (const r of shown ?? []) {
    if (r.excl != null) excl = (excl ?? 0) + r.excl;
    if (r.incl != null) incl = (incl ?? 0) + r.incl;
  }
  const total = (all ?? []).length;
  const count = (shown ?? []).length;
  const partial = count !== total;
  return {
    shown: count, all: total, excl, incl, partial,
    label: partial ? `Shown (${count} of ${total})` : 'Total',
  };
}

export function statusCounts(rows: SheetRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of AD_STATUS_KEYS) out[s] = 0;
  for (const r of rows ?? []) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

/** What the export button says it will do. */
export function exportLabel(shown: number, all: number): string {
  if (all === 0) return 'Export Excel';
  if (shown === all) return `Export ${all} row${all === 1 ? '' : 's'}`;
  return `Export ${shown} of ${all} rows`;
}

/**
 * Said next to the button when a filter is on, because the export takes the
 * filtered rows and the client cannot tell that anything is missing.
 */
export function exportWarning(shown: number, all: number): string | null {
  if (shown === all) return null;
  const hidden = all - shown;
  if (shown === 0) return 'Nothing to export — every row is filtered out.';
  return `A filter is on. ${hidden} row${hidden === 1 ? '' : 's'} will be left out of the file.`;
}

export function sheetEmptyMessage(f: SheetFilter, total: number): string {
  if (total === 0) return 'No ads tracked yet.';
  if (txt(f.query)) return `No row matches “${txt(f.query)}”.`;
  if (txt(f.status)) return `No row is at “${txt(f.status)}”.`;
  return 'No rows match.';
}

/** Named out loud, because the old delete was a browser confirm() saying "this row". */
export function deleteWarning(row: { name?: string; num?: number } | null | undefined): string {
  if (!row) return 'Remove this row from the sheet?';
  const who = txt(row.name);
  const at = row.num ? `Row ${row.num}` : 'This row';
  return who
    ? `${at} — ${who} — will be removed from the sheet. Anything already published to the client stays until you publish again.`
    : `${at} will be removed from the sheet. Anything already published to the client stays until you publish again.`;
}

export function publishWarning(status: PublishStatus, rowCount: number): string {
  if (rowCount === 0) return 'There is nothing on this sheet to publish.';
  if (status.state === 'never') {
    return `The client will be able to see all ${rowCount} row${rowCount === 1 ? '' : 's'} of this sheet, including prices incl. VAT.`;
  }
  return `The client's copy will be replaced with all ${rowCount} row${rowCount === 1 ? '' : 's'} as they stand now.`;
}

export function unpublishWarning(): string {
  return 'The client will stop seeing this sheet entirely. Your working copy is untouched.';
}

// ── The row editor ──────────────────────────────────────────────────

export interface SheetFormLike {
  influencer_name?: string | null;
  type_of_ad?: string | null;
  is_event?: unknown;
  license_plate_url?: string | null;
  price_excl?: unknown;
  ad_link?: string | null;
}

/**
 * Everything wrong with the form, in the order the fields appear.
 *
 * Returned as a list rather than a single string so the editor can say all of
 * it at once instead of revealing one problem per save.
 */
export function formProblems(f: SheetFormLike): string[] {
  const out: string[] = [];
  if (!txt(f.influencer_name)) out.push('An influencer or vendor name is needed.');
  if (Boolean(f.is_event) && !txt(f.license_plate_url)) {
    out.push('This is flagged as an event, so a licence-plate photo link is required.');
  }
  const price = num(f.price_excl);
  if (price != null && price < 0) out.push('A price cannot be negative.');
  const link = txt(f.ad_link);
  if (link && !/^https?:\/\//i.test(link)) out.push('The ad link should start with http:// or https://.');
  return out;
}

export const VAT_RATE = 0.15;

/** Mirrors withVat() in hooks/use-workflow — kept here so the editor is testable. */
export function withVat(priceExcl: unknown): number | null {
  const n = pos(priceExcl);
  if (n == null) return null;
  return Math.round(n * (1 + VAT_RATE) * 100) / 100;
}
