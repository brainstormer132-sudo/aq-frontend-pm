/**
 * Who closed this deal — a colleague, or an influencer.
 *
 * The database keeps two mutually exclusive columns (migration 054):
 * `sales_closer_id` → profiles, `sales_closer_vendor_id` → vendors. Two
 * columns for one idea is normally a smell, and the way it stops being one
 * is that nothing above this file ever sees both. The UI has a single
 * picker; these functions turn a task into the one value that picker shows,
 * and turn the picked value back into the pair of columns to save — always
 * clearing the other one.
 *
 * Pure: no React, no Supabase. The encoding is the whole risk here — a
 * mis-parsed key would write a vendor id into a uuid column — so it is
 * tested directly.
 */

export type CloserKind = 'team' | 'influencer';

export interface CloserOption {
  /** `p:<uuid>`, the bare INFLUENCER key, or legacy `v:<id>`. '' = nobody. */
  key: string;
  label: string;
  kind: CloserKind;
}

/**
 * The one option that stands for every influencer (migration 061).
 *
 * The register holds hundreds of them, and the picker listing all of those
 * names made the field harder to fill in than to skip. What people were
 * actually recording is "an influencer brought this in", so that is what
 * the picker offers.
 */
export const INFLUENCER_KEY = 'influencer';
export const INFLUENCER_LABEL = 'Influencer';

export interface CloserFields {
  sales_closer_id: string | null;
  sales_closer_vendor_id: number | null;
  sales_closer_influencer: boolean;
}

export interface TaskCloser {
  sales_closer_id?: string | null;
  sales_closer_vendor_id?: number | null;
  sales_closer_influencer?: boolean | null;
}

export interface PersonRow { id: string; full_name?: string | null }
export interface VendorRow { id: number; name: string; vendor_category?: string | null }

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/** Categories whose vendors are people who can bring in business. */
const CLOSER_CATEGORIES = ['influencer', 'ugc', 'ugc creator', 'user generated content'];

export function canCloseDeals(vendor: VendorRow): boolean {
  return CLOSER_CATEGORIES.includes(txt(vendor.vendor_category).toLowerCase());
}

/** What the picker currently shows for a task. */
export function closerKey(task: TaskCloser | null | undefined): string {
  if (!task) return '';
  if (txt(task.sales_closer_id)) return `p:${txt(task.sales_closer_id)}`;
  // A row saved before 061 names its influencer. It keeps naming them.
  if (task.sales_closer_vendor_id != null) return `v:${task.sales_closer_vendor_id}`;
  if (task.sales_closer_influencer) return INFLUENCER_KEY;
  return '';
}

/**
 * What to save when the picker changes.
 *
 * Always returns BOTH columns, so choosing a colleague clears an influencer
 * and vice versa. Returning only the one that changed is how a row ends up
 * with two closers and the CHECK constraint rejects the save.
 */
export function closerFields(key: string): CloserFields {
  const k = txt(key);
  if (k.startsWith('p:')) {
    const id = k.slice(2);
    return { sales_closer_id: id || null, sales_closer_vendor_id: null, sales_closer_influencer: false };
  }
  if (k === INFLUENCER_KEY) {
    return { sales_closer_id: null, sales_closer_vendor_id: null, sales_closer_influencer: true };
  }
  if (k.startsWith('v:')) {
    const n = Number(k.slice(2));
    const id = Number.isFinite(n) && n > 0 ? n : null;
    return { sales_closer_id: null, sales_closer_vendor_id: id, sales_closer_influencer: false };
  }
  return { sales_closer_id: null, sales_closer_vendor_id: null, sales_closer_influencer: false };
}

/**
 * Team members, alphabetical, then a single "Influencer".
 *
 * `vendors` is no longer listed one by one (061) — it is kept only to name
 * the influencer on a row that was saved before the change, so that opening
 * such a row does not silently replace a name with the generic option.
 */
export function closerOptions(
  people: PersonRow[],
  vendors: VendorRow[],
  current?: TaskCloser | null,
): CloserOption[] {
  const team: CloserOption[] = (people || [])
    .map((p) => ({
      key: `p:${p.id}`,
      label: txt(p.full_name) || 'Unnamed member',
      kind: 'team' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const out: CloserOption[] = [
    ...team,
    { key: INFLUENCER_KEY, label: INFLUENCER_LABEL, kind: 'influencer' },
  ];

  const legacyId = current?.sales_closer_vendor_id;
  if (legacyId != null) {
    const v = (vendors || []).find((x) => Number(x.id) === Number(legacyId));
    out.push({
      key: `v:${legacyId}`,
      label: v ? (txt(v.name) || `Vendor ${legacyId}`) : 'Removed influencer',
      kind: 'influencer',
    });
  }
  return out;
}

/**
 * The name to print. Falls back to the raw reference rather than an empty
 * space: a closer who was deleted should read as a gap you can see, not as
 * "nobody closed this".
 */
export function closerLabel(
  task: TaskCloser | null | undefined,
  people: PersonRow[],
  vendors: VendorRow[],
): string {
  if (!task) return '—';
  const pid = txt(task.sales_closer_id);
  if (pid) {
    const p = (people || []).find((x) => x.id === pid);
    return p ? (txt(p.full_name) || 'Unnamed member') : 'Former member';
  }
  if (task.sales_closer_vendor_id != null) {
    const v = (vendors || []).find((x) => Number(x.id) === Number(task.sales_closer_vendor_id));
    return v ? (txt(v.name) || `Vendor ${v.id}`) : 'Removed influencer';
  }
  if (task.sales_closer_influencer) return INFLUENCER_LABEL;
  return '—';
}

/**
 * True when an influencer, not a colleague, closed it.
 *
 * Either way of recording it counts: the generic flag, or a named vendor on
 * a row saved before 061. Anything that reports on influencer-sourced deals
 * has to see both or it will show the number falling off a cliff on the day
 * the picker changed.
 */
export function closedByInfluencer(task: TaskCloser | null | undefined): boolean {
  if (!task || txt(task.sales_closer_id)) return false;
  return task.sales_closer_vendor_id != null || !!task.sales_closer_influencer;
}
