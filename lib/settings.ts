/**
 * Settings — the vocabularies every campaign picks from, and the numbers the
 * app runs on.
 *
 * Pure. No React, no Supabase, no argless `new Date()`.
 *
 * The thing that made this screen worth a pass:
 *
 * **Deleting a lookup entry silently blanks it on every row that used it.**
 * `pm_tasks.source_id`, `pm_tasks.client_category_id` and
 * `clients.client_category_id` are all `on delete set null` (migrations 028
 * and 042). The old panel's own tip said the opposite —
 *
 *   "Tasks already using a deleted entry will keep their value but it won't
 *    appear in the picker anymore."
 *
 * — which is not what the database does. It said it in small grey type at the
 * bottom of the card, not on the delete, and it never said how many rows were
 * about to lose their value. `deleteWarning()` counts them and says what
 * actually happens.
 */

// ── Small shared helpers ────────────────────────────────────────────

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── The two campaign vocabularies ───────────────────────────────────

export type LookupKind = 'source' | 'category' | 'platform';

export const LOOKUP_COPY: Record<LookupKind, {
  title: string;
  blurb: string;
  addLabel: string;
  /** The singular noun, for the sentences below. */
  noun: string;
  plural: string;
}> = {
  source: {
    title: 'Where work comes from',
    blurb: 'The Source dropdown on every campaign. AQ, Inf., Referral — whatever your team actually says.',
    addLabel: 'Add a source',
    noun: 'source',
    plural: 'sources',
  },
  category: {
    title: 'Client categories',
    blurb: 'The industry a client is in. Set on the client, and copied onto each of their campaigns.',
    addLabel: 'Add a category',
    noun: 'category',
    plural: 'categories',
  },
  platform: {
    title: 'Platforms',
    blurb: 'What a campaign runs on. A campaign can carry several at once.',
    addLabel: 'Add a platform',
    noun: 'platform',
    plural: 'platforms',
  },
};

/**
 * Whether deleting an entry takes the value off the rows using it.
 *
 * Sources and categories are foreign keys with `on delete set null`, so they
 * do. Platforms are stored as text inside `pm_tasks.platforms`, so a campaign
 * keeps the word — the picker just stops offering it.
 */
export function deletionClearsRows(kind: LookupKind): boolean {
  return kind !== 'platform';
}

export interface LookupItemInput {
  id: string;
  name?: string | null;
  position?: unknown;
}

export interface LookupUsage {
  /** pm_tasks rows pointing at this entry. */
  campaigns?: number;
  /** clients rows pointing at it. Categories only. */
  clients?: number;
}

export interface LookupRow {
  id: string;
  name: string;
  position: number;
  /** Place in the list as drawn, from 1. */
  index: number;
  campaigns: number;
  clients: number;
  used: number;
  /** "12 campaigns · 3 clients", or '' when nothing uses it. */
  usedLine: string;
  first: boolean;
  last: boolean;
}

export function buildLookup(
  items: LookupItemInput[],
  usage: Record<string, LookupUsage> = {},
): LookupRow[] {
  const ordered = [...(items ?? [])].sort((a, b) => {
    const pa = Number(a.position);
    const pb = Number(b.position);
    const na = Number.isFinite(pa) ? pa : 0;
    const nb = Number.isFinite(pb) ? pb : 0;
    if (na !== nb) return na - nb;
    return txt(a.name).localeCompare(txt(b.name));
  });

  return ordered.map((item, i) => {
    const u = usage[txt(item.id)] ?? {};
    const campaigns = Number(u.campaigns ?? 0) || 0;
    const clients = Number(u.clients ?? 0) || 0;
    const parts: string[] = [];
    if (campaigns) parts.push(plural(campaigns, 'campaign'));
    if (clients) parts.push(plural(clients, 'client'));
    return {
      id: txt(item.id),
      name: txt(item.name),
      position: Number.isFinite(Number(item.position)) ? Number(item.position) : 0,
      index: i + 1,
      campaigns,
      clients,
      used: campaigns + clients,
      usedLine: parts.join(' · '),
      first: i === 0,
      last: i === ordered.length - 1,
    };
  });
}

/**
 * What deleting this entry really does.
 *
 * Every FK to these tables is `on delete set null`, so the rows survive and
 * the value does not. The old copy claimed the opposite.
 */
export function deleteWarning(row: LookupRow, kind: LookupKind): string {
  const what = LOOKUP_COPY[kind].noun;
  const name = row.name || `this ${what}`;
  if (row.used === 0) {
    return `“${name}” is not on anything, so deleting it only takes it out of the picker.`;
  }
  const one = row.used === 1;
  if (!deletionClearsRows(kind)) {
    return `${row.usedLine} ${one ? 'is' : 'are'} on “${name}”. ${one ? 'It' : 'They'} keep the word — deleting it only takes it out of the picker.`;
  }
  return `${row.usedLine} ${one ? 'is' : 'are'} set to “${name}”. Deleting it does not just take it out of the picker — ${one ? 'that row loses' : 'those rows lose'} the ${what} entirely, and it cannot be put back except by hand.`;
}

/** Renaming, and what it does to the rows already using the entry. */
export function renameNote(row: LookupRow, kind: LookupKind): string {
  const what = LOOKUP_COPY[kind].noun;
  if (row.used === 0) return 'Renaming is safe — nothing is using it yet.';
  if (!deletionClearsRows(kind)) {
    // pm_tasks.platforms holds the text, so a rename here does NOT reach it.
    return `${row.usedLine} already carry the old word, and renaming does not change ${row.used === 1 ? 'it' : 'them'} — the picker will offer the new name from now on.`;
  }
  return `Renaming is safe: the ${row.usedLine} using it keep the ${what} and show the new name. Deleting and re-adding does not.`;
}

/**
 * Both tables carry `unique (workspace_id, name)`, so a duplicate used to come
 * back from Postgres as a raw constraint error in a red badge.
 */
export function nameProblems(
  name: unknown,
  existing: LookupRow[],
  /** The row being renamed, which is allowed to keep its own name. */
  selfId?: string,
): string[] {
  const n = txt(name);
  if (!n) return ['A name is needed.'];
  if (n.length > 60) return ['That name is too long — 60 characters at most.'];
  const clash = (existing ?? []).find(
    (r) => r.id !== txt(selfId) && r.name.toLowerCase() === n.toLowerCase(),
  );
  if (clash) return [`“${clash.name}” is already on the list.`];
  return [];
}

/** The position for a new entry: after the last one. */
export function nextPosition(rows: LookupRow[]): number {
  let max = -1;
  for (const r of rows ?? []) max = Math.max(max, r.position);
  return max + 1;
}

export interface Swap { a: { id: string; position: number }; b: { id: string; position: number } }

/**
 * The two writes a move needs, or null when there is nowhere to go.
 *
 * Returned rather than performed so the caller can undo the first write if the
 * second fails — two entries sharing a position is how the arrows stop working.
 */
export function moveSwap(rows: LookupRow[], id: string, dir: -1 | 1): Swap | null {
  const list = rows ?? [];
  const i = list.findIndex((r) => r.id === txt(id));
  if (i === -1) return null;
  const other = list[i + dir];
  if (!other) return null;
  const me = list[i];
  // Equal positions would make the swap a no-op and freeze the arrows.
  const a = me.position === other.position ? other.position + dir * -1 : other.position;
  return {
    a: { id: me.id, position: a },
    b: { id: other.id, position: me.position },
  };
}

export function lookupSummary(rows: LookupRow[], kind: LookupKind): string {
  const list = rows ?? [];
  if (!list.length) return 'Nothing on the list yet.';
  const unused = list.filter((r) => r.used === 0).length;
  const head = plural(list.length, LOOKUP_COPY[kind].noun, LOOKUP_COPY[kind].plural);
  if (!unused) return `${head}, all in use.`;
  return `${head} · ${unused} on nothing`;
}

// ── Vendor categories — read-only here, and why ─────────────────────
//
// vendor_categories (migration 029) is a global table, not per workspace, and
// it drives two things nobody would guess from the Vendors screen: whether a
// vendor is asked for an ID or a licence number, and whether booking them adds
// a row to the campaign's tracking sheet.

export interface VendorCategoryInput {
  id: string;
  key?: string | null;
  label?: string | null;
  requires_license?: unknown;
  sort_order?: unknown;
  is_active?: unknown;
}

export interface VendorCategoryRow {
  id: string;
  key: string;
  label: string;
  identifier: 'Licence number' | 'ID number';
  active: boolean;
  tracked: boolean;
}

/**
 * `isTrackableVendorCategory()` matches on the category's **text**, not its id
 * — so a label edited in the database quietly stops that category getting a
 * tracking row. The screen shows which ones are matched so the mismatch is
 * visible instead of mysterious.
 */
export function buildVendorCategories(
  categories: VendorCategoryInput[],
  trackable: readonly string[],
): VendorCategoryRow[] {
  const wanted = new Set((trackable ?? []).map((t) => txt(t).toLowerCase()));
  return [...(categories ?? [])]
    .sort((a, b) => {
      const sa = Number(a.sort_order) || 0;
      const sb = Number(b.sort_order) || 0;
      if (sa !== sb) return sa - sb;
      return txt(a.label).localeCompare(txt(b.label));
    })
    .map((c) => {
      const key = txt(c.key);
      const label = txt(c.label) || key;
      return {
        id: txt(c.id),
        key,
        label,
        identifier: c.requires_license ? 'Licence number' : 'ID number',
        active: c.is_active !== false,
        tracked: wanted.has(key.toLowerCase()) || wanted.has(label.toLowerCase()),
      };
    });
}

/** Nothing matched means every influencer booking stopped seeding the sheet. */
export function trackingMatchWarning(rows: VendorCategoryRow[]): string | null {
  const active = (rows ?? []).filter((r) => r.active);
  if (!active.length) return null;
  const matched = active.filter((r) => r.tracked).length;
  if (matched > 0) return null;
  return 'No category matches the list the code checks, so booking a vendor no longer adds a row to the tracking sheet. A category was probably renamed.';
}

// ── The numbers that live in the code ───────────────────────────────
//
// An absent control is indistinguishable from a missing feature, so these are
// on the screen with the reason they cannot be typed here.

export interface FixedSetting {
  label: string;
  value: string;
  /** What it changes, in the user's words. */
  effect: string;
  /** Where it actually lives, for whoever has to change it. */
  where: string;
}

export function fixedSettings(input: {
  vatRate: number;
  triageDays: number;
  briefFiles: number;
  briefFileBytes: number;
  avatarBytes: number;
  pageSize: number;
  contractsCanDownload: boolean;
}): FixedSetting[] {
  return [
    {
      label: 'VAT',
      value: `${Math.round(input.vatRate * 100)}%`,
      effect: 'Added to every tracking-sheet price to give the figure the client sees.',
      where: 'VAT_RATE, in the code',
    },
    {
      label: 'Chase unassigned campaigns after',
      value: plural(input.triageDays, 'day'),
      effect: 'How long a campaign may sit unassigned before the Dashboard and the Marketing Inbox mark it urgent.',
      where: 'TRIAGE_PATIENCE_DAYS and STALE_DAYS, in the code',
    },
    {
      label: 'Files on a brief',
      value: `${input.briefFiles} files, ${mb(input.briefFileBytes)} each`,
      effect: 'What sales can attach when submitting a new campaign.',
      where: 'MAX_BRIEF_FILES, in the code',
    },
    {
      label: 'Profile photo',
      value: `${mb(input.avatarBytes)} at most`,
      effect: 'Matches the storage bucket — raising it here alone would fail on upload.',
      where: 'MAX_AVATAR_BYTES, and the avatars bucket',
    },
    {
      label: 'Rows read at a time',
      value: String(input.pageSize),
      effect: 'Every screen pages through this in a loop, so a bigger table stays whole.',
      where: 'PAGE_SIZE, and Supabase’s db-max-rows',
    },
    {
      label: 'Opening a generated contract',
      value: input.contractsCanDownload ? 'On' : 'Not built yet',
      effect: input.contractsCanDownload
        ? 'The Contracts screen can open a generated PDF.'
        : 'The Contracts screen shows Open disabled: the internal app has no download route yet, only the client portal.',
      where: 'CONTRACTS_CAN_DOWNLOAD, in the code',
    },
  ];
}

function mb(bytes: number): string {
  const n = bytes / (1024 * 1024);
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}MB`;
}
