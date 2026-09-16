/**
 * The screen band.
 *
 * Every screen opens with one dark band carrying the screen's question, one
 * hero figure, and the counts that matter as chips. The band itself is a
 * component (components/workflow/ScreenBand.tsx); this file is the arithmetic
 * behind what it shows, kept pure so it is tested with plain node.
 *
 * The rule for a hero: it is derived from rows the screen already loaded,
 * never a new request, and it names its slice ("N of M live campaigns") so a
 * percentage is never a mystery number.
 */

export type ChipTone = 'urgent' | 'soon' | 'tidy' | 'neutral';

export interface BandChip {
  tone: ChipTone;
  label: string;
  count: number;
  /** Optional: what clicking the chip does. A chip with no action is a fact. */
  onClick?: () => void;
}

export interface BandHero {
  /** The big figure, already formatted ("72%", "SAR 2,145,500"). */
  value: string;
  /** One short line under it, naming the slice. */
  label: string;
  /** 0..100 draws the ring; null/undefined draws no ring. */
  pct?: number | null;
}

/** What a view may add to the band. Anything absent falls back to the page default. */
export interface BandExtras {
  title?: string;
  sub?: string;
  hero?: BandHero | null;
  chips?: BandChip[];
}

/** Circumference of the ring: 2 * pi * 22, the radius the SVG uses. */
export const RING_C = 138.23;

/** stroke-dashoffset for a percentage. 0% is a full offset (nothing drawn). */
export function ringOffset(pct: number | null | undefined): number {
  const p = pct == null || !Number.isFinite(pct) ? 0 : Math.min(100, Math.max(0, pct));
  return Math.round(RING_C * (1 - p / 100) * 100) / 100;
}

/** Stages that mean a campaign is not live work. */
const NOT_LIVE = new Set(['completed', 'cancelled', 'draft']);

export interface LiveRow {
  id: string;
  parent_task_id?: string | null;
  stage?: string | null;
  status?: string | null;
  assignee_id?: string | null;
  key_account_id?: string | null;
  creator_id?: string | null;
}

/**
 * Yours: assigned to you, your key account, or created by you. A subtask
 * counts if it or its campaign is yours - the same rule lib/attention uses,
 * so the hero and the list under it agree about whose work this is.
 */
export function isMine(r: LiveRow, userId: string, byId?: Map<string, LiveRow>): boolean {
  // "Mine" is being ON the campaign - assigned to you or your key account.
  // NOT creator: the owner creates every campaign, so counting creator made
  // the whole workspace "yours" and the dashboard useless as a personal view.
  if (r.assignee_id === userId || r.key_account_id === userId) return true;
  if (r.parent_task_id && byId) {
    const parent = byId.get(r.parent_task_id);
    if (parent) return isMine(parent, userId);
  }
  return false;
}

/** A campaign (no parent) that is still being worked. */
export function isLiveCampaign(r: LiveRow): boolean {
  if (r.parent_task_id) return false;
  if (r.status === 'done') return false;
  return !NOT_LIVE.has(r.stage || '');
}

/**
 * How many live campaigns have nothing wrong with them.
 *
 * An attention item points at a task OR a subtask; a subtask's problem is
 * its campaign's problem, so each item is resolved up to its parent first.
 * A problem on a task that is not live (a completed campaign with a late
 * subtask, say) is not counted against the live set.
 */
export function cleanCampaigns(
  rows: LiveRow[],
  items: Array<{ taskId: string }>,
  userId?: string | null,
): { live: number; clean: number; pct: number | null } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const liveIds = new Set(
    rows.filter((r) => isLiveCampaign(r) && (!userId || isMine(r, userId, byId))).map((r) => r.id),
  );
  const bad = new Set<string>();
  for (const it of items) {
    const row = byId.get(it.taskId);
    const campaignId = row?.parent_task_id || it.taskId;
    if (liveIds.has(campaignId)) bad.add(campaignId);
  }
  const live = liveIds.size;
  const clean = live - bad.size;
  return { live, clean, pct: live === 0 ? null : Math.round((clean / live) * 100) };
}

/**
 * The Dashboard hero, or null when there is nothing live to measure. With a
 * userId it measures only your campaigns, and the label says so.
 */
export function dashboardHero(
  rows: LiveRow[],
  items: Array<{ taskId: string }>,
  userId?: string | null,
): BandHero | null {
  const c = cleanCampaigns(rows, items, userId);
  if (c.live === 0 || c.pct == null) return null;
  const noun = `campaign${c.live === 1 ? '' : 's'}`;
  return {
    value: `${c.pct}%`,
    label: userId
      ? `${c.clean} of your ${c.live} live ${noun} with nothing wrong`
      : `${c.clean} of ${c.live} live ${noun} with nothing wrong`,
    pct: c.pct,
  };
}

/** The Dashboard title. First name only; a blank name gets a plain welcome. */
export function welcomeTitle(fullName: string | null | undefined): string {
  const first = (fullName || '').trim().split(/\s+/)[0];
  return first ? `Welcome, ${first}` : 'Welcome';
}

/**
 * Severity counts as chips. All three are always present, zero included: a
 * chip that vanishes when it empties makes the row jump under the cursor.
 */
export function attentionChips(
  counts: { urgent: number; soon: number; tidy: number },
  onClick?: (severity: 'urgent' | 'soon' | 'tidy') => void,
): BandChip[] {
  const mk = (tone: 'urgent' | 'soon' | 'tidy', label: string): BandChip => ({
    tone, label, count: counts[tone] || 0,
    onClick: onClick ? () => onClick(tone) : undefined,
  });
  return [mk('urgent', 'Urgent'), mk('soon', 'Soon'), mk('tidy', 'Missing data')];
}

/** The All Tasks hero: total value of the priced rows on screen, named honestly. */
export function allTasksHero(s: { shown: number; total: number; value: number; unpriced: number }): BandHero | null {
  if (s.value <= 0) return null;
  const priced = s.shown - s.unpriced;
  const scope = s.shown === s.total ? '' : ' (filtered)';
  return {
    value: `SAR ${Math.round(s.value).toLocaleString('en-US')}`,
    label: `across ${priced} priced campaign${priced === 1 ? '' : 's'}${scope}`,
    pct: null,
  };
}
