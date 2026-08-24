/**
 * Turning vendor bookings into tracking-sheet rows — one row per ad.
 *
 * Pure. No React, no Supabase, no argless `new Date()`.
 *
 * Variant B of the Tracking Sheets designs, picked Aug 2026. The sheet and
 * `vendor_ad_lines` still hold the same ad in two tables — that is variant C
 * and a bigger migration — but the two shapes now agree:
 *
 *   Before: `ensureTrackingRowForVendor` was idempotent by vendor NAME, so a
 *   vendor booked for six home ads and six store visits got twelve ad lines
 *   and exactly ONE sheet row, carrying one posting date and one status for
 *   all twelve.
 *
 *   Now: one row per ad. A line of 4 Store Visits is four rows, each with its
 *   own date, status and link, keyed to (ad_line_id, ad_line_seq).
 *
 * Nothing here mutates anything. `planSync()` says what would change and the
 * screen shows it before a single row is written — existing sheets are real
 * client data and a migration is not the place to rewrite them.
 */

// ── Small shared helpers ────────────────────────────────────────────

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function int(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function money(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** How many ads one line is, floored at 1 — a line is at least one ad. */
export function adsOnLine(quantity: unknown): number {
  const n = int(quantity, 1);
  return n > 0 ? Math.min(n, MAX_ADS_PER_LINE) : 1;
}

/**
 * A line claiming ten thousand ads is a typo, not a booking. Seeding stops
 * rather than writing ten thousand rows onto somebody's sheet.
 */
export const MAX_ADS_PER_LINE = 200;

// ── What a booking implies ──────────────────────────────────────────

export interface AdLineInput {
  id: string;
  subtask_id?: string | null;
  position?: unknown;
  ad_type?: string | null;
  platform?: string | null;
  quantity?: unknown;
  unit_price?: unknown;
  due_date?: string | null;
  description?: string | null;
  status?: string | null;
  proof_of_posting_link?: string | null;
  notes?: string | null;
}

export interface BookingInput {
  /** The vendor subtask's id. */
  subtask_id: string;
  vendor_name?: string | null;
  /** The vendor's handle, if one is on file. */
  profile_link?: string | null;
  /** Falls back to the campaign's when the booking does not say. */
  platform?: string | null;
  lines: AdLineInput[];
}

/** One ad a booking says exists. Not a row yet. */
export interface PlannedAd {
  key: string;
  adLineId: string;
  adLineSeq: number;
  subtaskId: string;
  vendorName: string;
  profileLink: string;
  platform: string;
  adType: string;
  /** Per-ad rate. `quantity × unit_price` is the LINE total, not this. */
  priceExcl: number | null;
  postingDate: string | null;
  status: string;
  adLink: string;
  notes: string;
  /** "Ad 2 of 4" — only when the line carries more than one. */
  ordinal: string;
}

const KNOWN_STATUSES = ['Not started', 'Scheduled', 'Shot', 'Posted', 'Cancelled'];

function cleanStatus(v: unknown): string {
  const s = txt(v);
  return KNOWN_STATUSES.includes(s) ? s : 'Not started';
}

/**
 * Every ad in a booking, expanded by quantity.
 *
 * `campaignPlatform` and `campaignProduct` fill the gaps the booking leaves —
 * the same prefill the old per-vendor seeding did, kept because an empty cell
 * on this sheet means "nobody has entered this", so a value we already know
 * belongs in it.
 */
export function expandBooking(
  booking: BookingInput,
  campaignPlatform?: string | null,
): PlannedAd[] {
  const out: PlannedAd[] = [];
  const vendorName = txt(booking.vendor_name);

  const lines = [...(booking.lines ?? [])].sort(
    (a, b) => int(a.position, 0) - int(b.position, 0) || txt(a.id).localeCompare(txt(b.id)),
  );

  for (const line of lines) {
    const id = txt(line.id);
    if (!id) continue;
    const count = adsOnLine(line.quantity);
    const platform = txt(line.platform) || txt(booking.platform) || txt(campaignPlatform);
    const adType = txt(line.ad_type);
    const price = money(line.unit_price);

    for (let seq = 1; seq <= count; seq += 1) {
      out.push({
        key: `${id}#${seq}`,
        adLineId: id,
        adLineSeq: seq,
        subtaskId: txt(booking.subtask_id) || txt(line.subtask_id),
        vendorName,
        profileLink: txt(booking.profile_link),
        platform,
        adType,
        priceExcl: price,
        postingDate: txt(line.due_date) || null,
        status: cleanStatus(line.status),
        adLink: txt(line.proof_of_posting_link),
        notes: txt(line.description) || txt(line.notes),
        ordinal: count > 1 ? `Ad ${seq} of ${count}` : '',
      });
    }
  }
  return out;
}

export function expandBookings(
  bookings: BookingInput[],
  campaignPlatform?: string | null,
): PlannedAd[] {
  return (bookings ?? []).flatMap((b) => expandBooking(b, campaignPlatform));
}

// ── What is already on the sheet ────────────────────────────────────

export interface ExistingRow {
  id: string;
  ad_line_id?: string | null;
  ad_line_seq?: unknown;
  influencer_name?: string | null;
  [key: string]: unknown;
}

export function rowKey(row: ExistingRow): string | null {
  const id = txt(row.ad_line_id);
  if (!id) return null;
  const seq = int(row.ad_line_seq, 0);
  return seq > 0 ? `${id}#${seq}` : null;
}

export interface Adoption { row: ExistingRow; ad: PlannedAd }

export interface SyncPlan {
  /** Ads the bookings have and the sheet does not. */
  toAdd: PlannedAd[];
  /**
   * Placeholder rows to claim rather than duplicate.
   *
   * A vendor picked on a subtask that has no ads yet gets one row so the sheet
   * is not empty while the booking is being built. When the ads arrive, that
   * row IS the first of them — adding a second would leave the placeholder
   * sitting above it saying the same thing.
   */
  toAdopt: Adoption[];
  /** Ads already on the sheet, keyed. */
  alreadyThere: number;
  /** Rows somebody typed by hand. Never touched. */
  manual: number;
  /**
   * Rows whose ad line is gone — the booking shrank, or the line was deleted.
   * Reported, never removed: the row may carry a posting date and a link that
   * only exist here.
   */
  orphaned: ExistingRow[];
  /** Vendors seen in the bookings, for the sentence. */
  vendors: string[];
}

export function planSync(input: {
  ads: PlannedAd[];
  rows: ExistingRow[];
}): SyncPlan {
  const onSheet = new Set<string>();
  let manual = 0;
  const keyedRows: { row: ExistingRow; key: string }[] = [];
  /** subtask_id → placeholder rows waiting to be claimed, oldest first. */
  const placeholders = new Map<string, ExistingRow[]>();

  for (const row of input.rows ?? []) {
    const key = rowKey(row);
    if (!key) {
      manual += 1;
      const sub = txt(row.subtask_id);
      if (sub && !txt(row.ad_line_id)) {
        const list = placeholders.get(sub);
        if (list) list.push(row); else placeholders.set(sub, [row]);
      }
      continue;
    }
    onSheet.add(key);
    keyedRows.push({ row, key });
  }

  const wanted = new Set((input.ads ?? []).map((a) => a.key));
  const missing = (input.ads ?? []).filter((a) => !onSheet.has(a.key));

  const toAdopt: Adoption[] = [];
  const toAdd: PlannedAd[] = [];
  for (const ad of missing) {
    const waiting = placeholders.get(ad.subtaskId);
    const row = waiting?.shift();
    if (row) toAdopt.push({ row, ad }); else toAdd.push(ad);
  }

  const orphaned = keyedRows.filter((r) => !wanted.has(r.key)).map((r) => r.row);

  const vendors: string[] = [];
  for (const a of input.ads ?? []) {
    if (a.vendorName && !vendors.includes(a.vendorName)) vendors.push(a.vendorName);
  }

  return {
    toAdd,
    toAdopt,
    alreadyThere: (input.ads ?? []).length - missing.length,
    manual,
    orphaned,
    vendors,
  };
}

/** Everything the sync would write, added and adopted together. */
export function syncTotal(plan: SyncPlan): number {
  return plan.toAdd.length + plan.toAdopt.length;
}

/** The patch that turns a placeholder into the ad it was standing in for. */
export function adoptionPatch(adoption: Adoption): Partial<PlannedRowInput> {
  const { ad } = adoption;
  const patch: Partial<PlannedRowInput> = {
    ad_line_id: ad.adLineId,
    ad_line_seq: ad.adLineSeq,
  };
  // Only fills gaps. Somebody may already have typed a real posting date or a
  // link onto the placeholder, and the booking does not get to overwrite it.
  const row = adoption.row;
  if (ad.adType && !txt(row.type_of_ad)) patch.type_of_ad = ad.adType;
  if (ad.platform && !txt(row.platform)) patch.platform = ad.platform;
  if (ad.postingDate && !txt(row.posting_date)) patch.posting_date = ad.postingDate;
  if (ad.priceExcl != null && !(Number(row.price_excl) > 0)) patch.price_excl = ad.priceExcl;
  return patch;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the banner above the sheet says. Null when there is nothing to say. */
export function syncSentence(plan: SyncPlan): string | null {
  const add = syncTotal(plan);
  if (add === 0 && plan.orphaned.length === 0) return null;

  const parts: string[] = [];
  if (add > 0) {
    const names = namesIn([...plan.toAdd, ...plan.toAdopt.map((a) => a.ad)]);
    parts.push(
      `${plural(add, 'ad')} on ${names} ${add === 1 ? 'is' : 'are'} not on this sheet yet.`,
    );
  }
  if (plan.orphaned.length > 0) {
    parts.push(
      `${plural(plan.orphaned.length, 'row')} came from a booking that no longer has ${plan.orphaned.length === 1 ? 'that ad' : 'those ads'} — left alone, in case the date or the link on ${plan.orphaned.length === 1 ? 'it' : 'them'} is real.`,
    );
  }
  return parts.join(' ');
}

function namesIn(ads: PlannedAd[]): string {
  const names: string[] = [];
  for (const a of ads) if (a.vendorName && !names.includes(a.vendorName)) names.push(a.vendorName);
  if (names.length === 0) return 'a booking';
  if (names.length === 1) return `${names[0]}’s booking`;
  if (names.length === 2) return `${names[0]} and ${names[1]}’s bookings`;
  return `${names.length} vendors’ bookings`;
}

/** The button. */
export function syncLabel(plan: SyncPlan): string {
  const n = syncTotal(plan);
  return n === 1 ? 'Add the missing ad' : `Add the ${n} missing ads`;
}

/**
 * Said before the rows are written. It only ever adds, and it says so — the
 * one thing somebody looking at a sheet full of real work needs to know.
 */
export function syncWarning(plan: SyncPlan): string {
  const n = syncTotal(plan);
  const kept = plan.manual > 0
    ? ` The ${plural(plan.manual, 'row')} typed by hand ${plan.manual === 1 ? 'is' : 'are'} left exactly as ${plan.manual === 1 ? 'it is' : 'they are'}.`
    : '';
  return `${plural(n, 'row')} will be added, one per ad, with the vendor, ad type, posting date and price from the booking. Nothing already on the sheet is changed or removed.${kept}`;
}

// ── Turning a planned ad into an insert ─────────────────────────────

export interface PlannedRowInput {
  position: number;
  ad_line_id: string;
  ad_line_seq: number;
  subtask_id: string;
  influencer_name: string;
  profile_link?: string;
  platform?: string;
  type_of_ad?: string;
  product?: string;
  posting_date?: string | null;
  ad_status?: string;
  ad_link?: string;
  price_excl?: number;
  notes?: string;
}

/**
 * Fields we actually know, and nothing else.
 *
 * Siraj, on the first version of this: *"filled out with the data that we have
 * and the ones we dont have dont fill any data"*. An empty cell has to mean
 * "nobody has entered this", or the sheet stops being a to-do list — so a
 * blank is left off the insert entirely rather than written as ''.
 */
export function plannedRowInput(
  ad: PlannedAd,
  position: number,
  product?: string | null,
): PlannedRowInput {
  const row: PlannedRowInput = {
    position,
    ad_line_id: ad.adLineId,
    ad_line_seq: ad.adLineSeq,
    subtask_id: ad.subtaskId,
    influencer_name: ad.vendorName,
  };
  if (ad.profileLink) row.profile_link = ad.profileLink;
  if (ad.platform) row.platform = ad.platform;
  if (ad.adType) row.type_of_ad = ad.adType;
  if (txt(product)) row.product = txt(product);
  if (ad.postingDate) row.posting_date = ad.postingDate;
  if (ad.status) row.ad_status = ad.status;
  if (ad.adLink) row.ad_link = ad.adLink;
  if (ad.priceExcl != null) row.price_excl = ad.priceExcl;

  const note = [ad.ordinal, ad.notes].filter(Boolean).join(' · ');
  if (note) row.notes = note;
  return row;
}

export function plannedRows(
  plan: SyncPlan,
  startPosition: number,
  product?: string | null,
): PlannedRowInput[] {
  return plan.toAdd.map((ad, i) => plannedRowInput(ad, startPosition + i, product));
}

// ── Reading a row back ──────────────────────────────────────────────

export interface RowOrigin {
  /** Came from a booking. */
  booked: boolean;
  /** The booking exists but the ad line has been deleted since. */
  orphaned: boolean;
  label: string;
  /** Why the price is not editable here. */
  priceNote: string;
}

export function rowOrigin(row: ExistingRow, liveAdLineIds: Set<string>): RowOrigin {
  const id = txt(row.ad_line_id);
  if (!id) {
    return { booked: false, orphaned: false, label: '', priceNote: '' };
  }
  const orphaned = !liveAdLineIds.has(id);
  return {
    booked: true,
    orphaned,
    label: orphaned ? 'booking removed' : 'booked',
    priceNote: orphaned
      ? 'This ad is no longer on the booking. The price is whatever it was when the row was made.'
      : 'The price comes from the vendor’s booking, which is what the contract is written from. Change it there.',
  };
}

/** Every ad line id the bookings still have, for `rowOrigin`. */
export function liveAdLineIds(ads: PlannedAd[]): Set<string> {
  return new Set((ads ?? []).map((a) => a.adLineId));
}
