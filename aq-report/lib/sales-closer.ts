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
  /** The picker's value: `p:<uuid>` or `v:<id>`. Empty string = nobody. */
  key: string;
  label: string;
  kind: CloserKind;
}

export interface CloserFields {
  sales_closer_id: string | null;
  sales_closer_vendor_id: number | null;
}

export interface TaskCloser {
  sales_closer_id?: string | null;
  sales_closer_vendor_id?: number | null;
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
  if (task.sales_closer_vendor_id != null) return `v:${task.sales_closer_vendor_id}`;
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
    return { sales_closer_id: id || null, sales_closer_vendor_id: null };
  }
  if (k.startsWith('v:')) {
    const n = Number(k.slice(2));
    return {
      sales_closer_id: null,
      sales_closer_vendor_id: Number.isFinite(n) && n > 0 ? n : null,
    };
  }
  return { sales_closer_id: null, sales_closer_vendor_id: null };
}

/** Team first, then influencers — both alphabetical. */
export function closerOptions(people: PersonRow[], vendors: VendorRow[]): CloserOption[] {
  const team: CloserOption[] = (people || [])
    .map((p) => ({
      key: `p:${p.id}`,
      label: txt(p.full_name) || 'Unnamed member',
      kind: 'team' as const,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const influencers: CloserOption[] = (vendors || [])
    .filter(canCloseDeals)
    .map((v) => ({ key: `v:${v.id}`, label: txt(v.name) || `Vendor ${v.id}`, kind: 'influencer' as const }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return [...team, ...influencers];
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
  return '—';
}

/** True when an influencer, not a colleague, closed it. */
export function closedByInfluencer(task: TaskCloser | null | undefined): boolean {
  return !!task && task.sales_closer_vendor_id != null && !txt(task.sales_closer_id);
}
