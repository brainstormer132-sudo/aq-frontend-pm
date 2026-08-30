/**
 * The campaign page — everything it shows, worked out.
 *
 * Pure. No React, no Supabase, no argless `new Date()`.
 *
 * This replaces the slide-over drawer for editing a campaign. The drawer was
 * never chosen: a "view task" button landed on it two years ago, and because a
 * drawer is one narrow column, fifty-three fields had no choice but to stack.
 * Opening a vendor from inside a campaign put a slide-over on top of a
 * slide-over.
 *
 * A campaign is now a page, and a page can say things a stack of rows cannot:
 *
 *  - the three figures the agency lives on, at the top, with the margin RATE
 *    beside the amount — the absolute goes up whenever we do more work, the
 *    rate says whether the work was worth doing;
 *  - what is actually missing, on the campaign it belongs to, using the same
 *    rules as the Dashboard's Needs attention rather than a second opinion.
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

/**
 * The same reading of "a figure somebody actually entered", for callers
 * outside this file. Anything blank, unparseable or zero comes back null so
 * they do not have to invent their own rule and disagree with this one.
 */
export const amountOrNull = pos;

export const DAY_MS = 86_400_000;

export function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const neg = v < 0;
  const [whole, frac] = Math.abs(v).toFixed(2).split('.');
  return `${neg ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}

/** Whole SAR, for the masthead. */
export function moneyRound(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const whole = String(Math.round(Math.abs(v)));
  return `${v < 0 ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isoDay(v: unknown): string {
  const s = txt(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export function dayMs(v: unknown): number {
  const d = isoDay(v);
  return d ? Date.parse(`${d}T00:00:00Z`) : 0;
}

/** "12 Aug" this year, "14 Jul 2025" outside it. Never toLocaleDateString. */
export function shortDate(v: unknown, today: string): string {
  const d = isoDay(v);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  const label = `${Number(dd)} ${MONTHS[Number(m) - 1] ?? '?'}`;
  return y === isoDay(today).slice(0, 4) ? label : `${label} ${y}`;
}

export function longDate(v: unknown): string {
  const d = isoDay(v);
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${Number(dd)} ${MONTHS[Number(m) - 1] ?? '?'} ${y}`;
}

/**
 * Two letters for a vendor's tile. A dot rather than a blank for no name.
 *
 * The particle is skipped, which matters here more than it would elsewhere:
 * take the plain second letter and Al-Sudairi, Al-Otaibi and Al-Harbi all
 * initial as "A", so half the vendor book ends up wearing the same tile.
 */
const NAME_PARTICLES = ['al', 'el', 'bin', 'ibn', 'bint', 'abu', 'abd', 'van', 'de', 'da'];

export function initials(name: unknown): string {
  const words = txt(name).split(/[\s\-]+/).filter(Boolean);
  if (!words.length) return '·';
  const first = words[0][0];
  const rest = words.slice(1).filter((w) => !NAME_PARTICLES.includes(w.toLowerCase()));
  const second = rest[rest.length - 1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

// ── The brand mark ──────────────────────────────────────────────────

/**
 * Ten pairs, hand-picked rather than generated.
 *
 * A hue worked out from a hash lands on olive and mustard as often as on
 * anything good, and a 22px square of olive on near-black reads as a smudge.
 * These are all mid-to-vivid, all legible on the ink masthead, and no two are
 * close enough to be confused across a list of campaigns.
 */
const BRAND_PAIRS: [string, string][] = [
  ['#e0447a', '#f59e0b'],   // rose → amber
  ['#7c3aed', '#2dd4bf'],   // violet → teal
  ['#0ea5e9', '#22c55e'],   // sky → green
  ['#f43f5e', '#8b5cf6'],   // red → violet
  ['#f59e0b', '#ef4444'],   // amber → red
  ['#06b6d4', '#6366f1'],   // cyan → indigo
  ['#84cc16', '#0ea5e9'],   // lime → sky
  ['#ec4899', '#f97316'],   // pink → orange
  ['#14b8a6', '#a3e635'],   // teal → lime
  ['#6366f1', '#ec4899'],   // indigo → pink
];

/**
 * A campaign's colour, from its client's name.
 *
 * The database has no brand colour and inventing a column for one is a bigger
 * ask than this is worth. So the mark is *derived*: the same client always
 * gets the same pair, which is the property that matters — a swatch that
 * changed between page loads would be noise rather than identity.
 *
 * Deliberately hashed on the CLIENT, not the campaign, so every campaign for
 * one client wears the same colour and a list of them reads as belonging
 * together. Nothing to store, nothing to keep in step.
 */
export function brandMark(name: unknown): { from: string; to: string } {
  const s = txt(name);
  if (!s) return { from: '#78716c', to: '#a8a29e' };   // no client yet: stone
  // djb2. Small, stable, and — unlike a sum of char codes — it does not give
  // "Ripplr" and "Rlpprri" the same colour.
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  const [from, to] = BRAND_PAIRS[h % BRAND_PAIRS.length];
  return { from, to };
}

// ── The money bar ───────────────────────────────────────────────────

export interface MoneyBar {
  /** What the campaign is worth to the client. Falls back to the breakdown. */
  budget: number | null;
  /** True when `budget` came from adding the bookings up, not from a typed figure. */
  budgetFromBreakdown: boolean;
  /** What the vendors take — the sum of every booking's NET, not its price. */
  vendorCost: number | null;
  /** What the client is charged, added up per booking. */
  breakdown: number | null;
  /** budget − breakdown. Non-zero means the breakdown does not add up to the budget. */
  breakdownVariance: number | null;
  net: number | null;
  /** Net ÷ budget, as a percentage. Null when there is no revenue to divide by. */
  marginRate: number | null;
  /** Width of the vendor segment, 0–100. */
  costPct: number;
  /** True when the vendors cost more than the campaign is worth. */
  overspent: boolean;
  /** For a screen reader, and for the title attribute. */
  sentence: string;
}

/**
 * What the bar draws.
 *
 * Two different numbers were being called the same thing, so the bar was
 * arithmetic that could not be wrong and still was:
 *
 *   price      — what the CLIENT is charged for that vendor's work
 *   net_amount — what the VENDOR takes for doing it
 *   aq_gross   — price − net_amount, what AQ keeps (028, generated column)
 *
 * The bar was fed the sum of PRICES and labelled it "vendors cost", so net
 * came out as budget minus the client's own breakdown — a number that is
 * near zero on any campaign whose bookings add up to its budget, which is
 * every campaign entered correctly. Siraj: *"price is treated as net"*.
 *
 * The rest of the app never had this wrong: money-ledger bills the client on
 * `price` and pays the vendor on `net_amount`. Only this bar disagreed.
 *
 * `marginRate` is null rather than 0 when there is no revenue: a campaign
 * nobody has priced has no margin, and printing "0%" says we made nothing on
 * work that might be very profitable.
 */
export function moneyBar(input: {
  budget?: unknown;
  /** Sum of the bookings' net_amount. What leaves the agency. */
  vendorCost?: unknown;
  /** Sum of the bookings' price. What the client is billed, line by line. */
  breakdown?: unknown;
}): MoneyBar {
  const typedBudget = pos(input.budget);
  const vendorCost = pos(input.vendorCost);
  const breakdown = pos(input.breakdown);

  // A campaign whose bookings are priced but whose budget nobody typed still
  // has revenue — it is sitting in the breakdown. Using it beats showing a
  // margin of "unknown" next to a list of priced bookings.
  const budget = typedBudget ?? breakdown;
  const budgetFromBreakdown = typedBudget == null && breakdown != null;
  const breakdownVariance =
    typedBudget != null && breakdown != null ? typedBudget - breakdown : null;

  if (budget == null) {
    return {
      budget: null, budgetFromBreakdown: false, vendorCost,
      breakdown, breakdownVariance,
      net: null, marginRate: null,
      costPct: vendorCost == null ? 0 : 100,
      overspent: false,
      sentence: vendorCost == null
        ? 'Nothing priced yet.'
        : `${moneyRound(vendorCost)} committed to vendors, against a budget nobody has set.`,
    };
  }

  const cost = vendorCost ?? 0;
  const net = budget - cost;
  const rate = Math.round((net / budget) * 1000) / 10;
  const costPct = Math.max(0, Math.min(100, (cost / budget) * 100));
  const overspent = cost > budget;

  const worth = budgetFromBreakdown
    ? `${moneyRound(budget)} of bookings`
    : `a ${moneyRound(budget)} budget`;

  return {
    budget,
    budgetFromBreakdown,
    vendorCost,
    breakdown,
    breakdownVariance,
    net,
    marginRate: rate,
    costPct,
    overspent,
    sentence: overspent
      ? `Vendors take ${moneyRound(cost)}, which is more than the ${moneyRound(budget)} this campaign is worth.`
      : `Of ${worth}, ${moneyRound(cost)} goes to vendors and ${moneyRound(net)} is AQ's.`,
  };
}

// ── When the ads go out ─────────────────────────────────────────────

export type AdStatusKey = 'Posted' | 'Shot' | 'Scheduled' | 'Not started' | 'Cancelled';

export interface AdForStrip {
  posting_date?: string | null;
  ad_status?: string | null;
}

/**
 * @deprecated Nothing renders this. The posting strip it fed was removed from
 * the campaign page — Siraj: *"i dont need this"* — because the tracking sheet
 * already answers when the ads go out, row by row, and the strip restated it
 * as a shape nobody used. Kept only because it is pure and tested; delete it
 * along with `postingStrip` if nothing has claimed it by the next clear-out.
 */
export interface StripBucket {
  key: string;
  /** "Wk of 3 Aug" / "This week" / "No date yet" */
  label: string;
  count: number;
  /** The word under the number — posted / due / scheduled / ads. */
  noun: string;
  now: boolean;
  /** One bead per ad, in status order. */
  beads: AdStatusKey[];
}

function statusOf(v: unknown): AdStatusKey {
  const s = txt(v);
  if (s === 'Posted' || s === 'Shot' || s === 'Scheduled' || s === 'Cancelled') return s;
  return 'Not started';
}

/** Monday of the week `iso` falls in, as YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const ms = dayMs(iso);
  if (!ms) return '';
  const d = new Date(ms);
  const dow = (d.getUTCDay() + 6) % 7;      // Monday = 0
  return new Date(ms - dow * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The ads bucketed into weeks around today, plus one bucket for the ones
 * nobody has dated.
 *
 * Cancelled ads are left out of the counts entirely — an ad that is not
 * happening is not work waiting to be done, and leaving it in makes a finished
 * week look unfinished.
 */
/** @deprecated See StripBucket — nothing renders the strip any more. */
export function postingStrip(
  ads: AdForStrip[],
  today: string,
  weeks = 4,
): StripBucket[] {
  const thisWeek = weekStart(today);
  const live = (ads ?? []).filter((a) => statusOf(a.ad_status) !== 'Cancelled');

  const dated = live.filter((a) => isoDay(a.posting_date));
  const undated = live.filter((a) => !isoDay(a.posting_date));

  const byWeek = new Map<string, AdStatusKey[]>();
  for (const a of dated) {
    const wk = weekStart(String(a.posting_date));
    const list = byWeek.get(wk);
    if (list) list.push(statusOf(a.ad_status)); else byWeek.set(wk, [statusOf(a.ad_status)]);
  }

  // The weeks worth showing: this one, whatever is around it, newest last.
  const wanted = new Set<string>([thisWeek]);
  for (const wk of byWeek.keys()) wanted.add(wk);
  const ordered = [...wanted].sort();

  // Keep the window tight around today rather than drawing a year of empties.
  const here = ordered.indexOf(thisWeek);
  const from = Math.max(0, Math.min(here - 1, ordered.length - weeks + 1));
  const shown = ordered.slice(from, from + Math.max(1, weeks - (undated.length ? 1 : 0)));

  const buckets: StripBucket[] = shown.map((wk) => {
    const beads = beadOrder(byWeek.get(wk) ?? []);
    const now = wk === thisWeek;
    return {
      key: wk,
      label: now ? 'This week' : `Wk of ${shortDate(wk, today)}`,
      count: beads.length,
      noun: bucketNoun(beads, now, wk < thisWeek),
      now,
      beads,
    };
  });

  if (undated.length) {
    buckets.push({
      key: 'undated',
      label: 'No date yet',
      count: undated.length,
      noun: undated.length === 1 ? 'ad' : 'ads',
      now: false,
      beads: beadOrder(undated.map((a) => statusOf(a.ad_status))),
    });
  }
  return buckets;
}

const BEAD_RANK: Record<AdStatusKey, number> = {
  Posted: 0, Shot: 1, Scheduled: 2, 'Not started': 3, Cancelled: 4,
};

function beadOrder(list: AdStatusKey[]): AdStatusKey[] {
  return [...list].sort((a, b) => BEAD_RANK[a] - BEAD_RANK[b]);
}

function bucketNoun(beads: AdStatusKey[], now: boolean, past: boolean): string {
  if (!beads.length) return 'nothing';
  const allPosted = beads.every((b) => b === 'Posted');
  if (allPosted) return 'posted';
  if (now) return 'due';
  if (past) return beads.some((b) => b === 'Posted') ? 'posted' : 'late';
  return 'scheduled';
}

export function stripTotals(ads: AdForStrip[]): Record<AdStatusKey, number> {
  const out: Record<AdStatusKey, number> = {
    Posted: 0, Shot: 0, Scheduled: 0, 'Not started': 0, Cancelled: 0,
  };
  for (const a of ads ?? []) out[statusOf(a.ad_status)] += 1;
  return out;
}

// ── The bookings list ───────────────────────────────────────────────

export interface BookingSubtask {
  /** The booking's own single platform — a fallback when its ads carry none. */
  platform?: string | null;
  /** Typed on the booking only when it has no ads to be priced by. */
  net_amount?: unknown;
  id: string;
  vendor_id?: number | null;
  title?: string | null;
  task_name?: string | null;
  price?: unknown;
  ad_type?: string | null;
  contract_request_id?: string | null;
}

export interface BookingAd {
  subtask_id?: string | null;
  ad_type?: string | null;
  /** Per-ad. One vendor can post a Home Ad to TikTok and a Store Visit to Instagram. */
  platform?: string | null;
  quantity?: unknown;
  status?: string | null;
  // An influencer is priced per piece, not per booking: twelve ads at
  // different rates is one booking whose price is a sum, not a number
  // somebody types.
  unit_price?: unknown;
  net_amount?: unknown;
}

export interface BookingRow {
  id: string;
  name: string;
  initials: string;
  /** What AQ nets on the booking — summed from the ads when they carry it. */
  net?: number | null;
  /** True when the ads below are where the money is typed. */
  pricedPerLine?: boolean;
  /** How many ads the booking holds, counting quantity. */
  ads: number;
  posted: number;
  /** 0–100 for the progress sliver. */
  progressPct: number;
  adTypes: string;
  /**
   * Every distinct ad type and platform across this booking's ads.
   *
   * Siraj: *"the same vendor could do one ad home ad one store visit one of
   * them tiktok and one instagram so it should reflect that"*. The booking
   * carries a single `ad_type` and a single `platform`, which cannot say
   * that — so the lists come from the ads, and the single fields are only a
   * fallback for a booking that has none.
   */
  adTypeList: string[];
  platformList: string[];
  /** True when the ads disagree with each other, so one dropdown cannot say it. */
  mixedAdTypes: boolean;
  mixedPlatforms: boolean;
  /**
   * True when the list came from the ads rather than the booking's own field.
   *
   * The booking's dropdown is then a report, not a control — the same rule
   * Client price already follows once the lines carry money. Leaving it
   * editable would let somebody set a value nothing reads, which the next
   * line edit then silently contradicts.
   */
  adTypesFromAds: boolean;
  platformsFromAds: boolean;
  price: number | null;
  /** '' when there is no request at all. */
  contract: 'none' | 'requested' | 'signed';
  contractLabel: string;
  /** The one thing wrong with this booking, if anything. */
  problem: string;
  meta: string;
}

export function bookingRows(input: {
  subtasks: BookingSubtask[];
  ads: BookingAd[];
  vendorNames?: Map<number, string>;
  contractStatusById?: Map<string, string>;
}): BookingRow[] {
  const adsBySubtask = new Map<string, BookingAd[]>();
  for (const a of input.ads ?? []) {
    const k = txt(a.subtask_id);
    if (!k) continue;
    const list = adsBySubtask.get(k);
    if (list) list.push(a); else adsBySubtask.set(k, [a]);
  }

  return (input.subtasks ?? []).map((s) => {
    const lines = adsBySubtask.get(txt(s.id)) ?? [];
    let ads = 0;
    let posted = 0;
    const types: string[] = [];
    const platforms: string[] = [];
    for (const l of lines) {
      const q = Math.max(1, num(l.quantity) ?? 1);
      ads += q;
      if (txt(l.status) === 'Posted') posted += q;
      const t = txt(l.ad_type);
      if (t && !types.includes(t)) types.push(t);
      const pf = txt(l.platform);
      if (pf && !platforms.includes(pf)) platforms.push(pf);
    }
    const adTypesFromAds = types.length > 0;
    const platformsFromAds = platforms.length > 0;
    // No ads, or ads nobody has typed a type on: fall back to the booking's
    // own single field, which is all a booking without lines ever had.
    if (!types.length && txt(s.ad_type)) types.push(txt(s.ad_type));
    if (!platforms.length && txt(s.platform)) platforms.push(txt(s.platform));

    // Where the money is typed depends on whether the booking has ads.
    //
    // With ads — the influencer case — the price is the ads added up, and
    // typing over it on the booking was pointless: syncBookingPriceFromAds
    // overwrote it the next time anybody touched a line. So the lines are
    // the source and the booking only reports them.
    const adsTotal = lines.reduce(
      (sum, l) => sum + (Math.max(1, num(l.quantity) ?? 1) * (num(l.unit_price) ?? 0)), 0);
    const adsNet = lines.reduce((sum, l) => sum + (num(l.net_amount) ?? 0), 0);
    const anyLineNet = lines.some((l) => num(l.net_amount) != null);

    const name = txt(s.vendor_id != null ? input.vendorNames?.get(s.vendor_id) : '')
      || txt(s.task_name) || txt(s.title) || 'No vendor yet';
    // Only once the lines actually carry prices. A booking with ten unpriced
    // ads and a number typed on it still shows that number — otherwise every
    // booking made before per-line pricing existed would suddenly read "no
    // price yet" while its money sat there in plain sight.
    const anyLinePrice = lines.some((l) => (num(l.unit_price) ?? 0) > 0);
    const pricedPerLine = lines.length > 0 && anyLinePrice;
    const price = pricedPerLine ? pos(adsTotal) : pos(s.price);
    const net = pricedPerLine
      ? (anyLineNet ? adsNet : pos(s.net_amount))
      : pos(s.net_amount);

    const requestId = txt(s.contract_request_id);
    const status = requestId ? txt(input.contractStatusById?.get(requestId)) : '';
    const contract: BookingRow['contract'] =
      !requestId ? 'none' : (status === 'generated' ? 'signed' : 'requested');

    const problem = price == null
      ? 'no price yet'
      : (contract === 'none' ? 'no contract requested' : '');

    const bits = [
      ads ? `${ads} ${ads === 1 ? 'ad' : 'ads'}` : 'no ads yet',
      types.join(', '),
      problem || contractLabelFor(contract),
    ].filter(Boolean);

    return {
      id: txt(s.id),
      name,
      initials: initials(name),
      ads,
      posted,
      progressPct: ads ? Math.round((posted / ads) * 100) : 0,
      adTypes: types.join(', '),
      adTypeList: types,
      platformList: platforms,
      mixedAdTypes: types.length > 1,
      mixedPlatforms: platforms.length > 1,
      adTypesFromAds,
      platformsFromAds,
      price,
      net,
      /** True when the ads below are the source of the money, not the booking. */
      pricedPerLine,
      contract,
      contractLabel: contractLabelFor(contract),
      problem,
      meta: bits.join(' · '),
    };
  });
}

/**
 * Every ad type and platform running on the campaign, from the ads up.
 *
 * A campaign carries one `ad_type` and a `platforms` array, both typed when
 * it was created. Once the bookings have ads, those are a guess and the ads
 * are the fact: the campaign is whatever its vendors are actually posting.
 */
export function campaignSpread(rows: BookingRow[]): {
  adTypes: string[];
  platforms: string[];
} {
  const adTypes: string[] = [];
  const platforms: string[] = [];
  for (const r of rows ?? []) {
    for (const t of r.adTypeList ?? []) if (!adTypes.includes(t)) adTypes.push(t);
    for (const p of r.platformList ?? []) if (!platforms.includes(p)) platforms.push(p);
  }
  return { adTypes, platforms };
}

function contractLabelFor(c: BookingRow['contract']): string {
  if (c === 'signed') return 'contract signed';
  if (c === 'requested') return 'contract waiting';
  return 'no contract requested';
}

// ── What this campaign still needs ──────────────────────────────────

export type GapWeight = 'blocking' | 'soon';

export interface Gap {
  key: string;
  weight: GapWeight;
  /** Bolded first clause. */
  what: string;
  /** The consequence, in the user's terms. */
  why: string;
  /** What the button says. */
  action: string;
  /** Where it goes — a section anchor on this page. */
  anchor: string;
}

/**
 * The same shape as the Dashboard's Needs attention, scoped to one campaign
 * and phrased for somebody looking at it.
 *
 * `blocking` means something downstream cannot happen at all — a contract that
 * cannot be requested, a client that cannot be billed. `soon` is everything
 * else. Nothing here is red for being merely untidy.
 */
export function campaignGaps(input: {
  budget?: unknown;
  invoiceNumbers?: unknown[];
  clientPaymentStatus?: unknown;
  dueDate?: unknown;
  bookings: BookingRow[];
  adsWithoutDate: number;
  /**
   * Vendors whose money is past its date, worked out from their payment
   * terms. Passed in rather than derived here so there is exactly one
   * definition of a booking's schedule — see `bookingSchedule` in
   * lib/payment-schedule.
   */
  overduePayments?: { id: string; name: string; days: number; amount: number | null }[];
  /** Contracts sitting with Legal past CONTRACT_PATIENCE_DAYS. */
  stuckContracts?: { id: string; name: string; days: number }[];
  today: string;
}): Gap[] {
  const out: Gap[] = [];

  // First, above everything: work delivered that we have not paid for.
  //
  // Every other gap on this page is something unfinished. This one is a
  // debt — the vendor has done the job, the date has passed, and the next
  // thing that happens is a phone call. It goes at the top because it is
  // the only gap with somebody waiting on the other end of it.
  for (const p of input.overduePayments ?? []) {
    out.push({
      key: `overdue:${p.id}`,
      weight: 'blocking',
      what: `${p.name} should have been paid ${p.days} ${p.days === 1 ? 'day' : 'days'} ago${p.amount != null ? ` — ${money(p.amount)}` : ''}.`,
      why: 'Their terms fell due and the payment has not been recorded.',
      action: 'Pay them',
      anchor: '#vendor-contracts',
    });
  }

  for (const b of input.bookings) {
    if (b.price == null) {
      out.push({
        key: `price:${b.id}`,
        weight: 'blocking',
        what: `${b.name} has no price.`,
        why: 'Their contract cannot be requested until they do.',
        action: 'Set it',
        anchor: '#bookings',
      });
    }
  }
  for (const b of input.bookings) {
    if (b.price != null && b.contract === 'none') {
      out.push({
        key: `contract:${b.id}`,
        weight: 'soon',
        what: `${b.name} is priced with no contract requested.`,
        why: 'The work is agreed and nothing has been sent to sign.',
        action: 'Request it',
        anchor: '#bookings',
      });
    }
  }

  // Contracts that went out and never came back.
  for (const c of input.stuckContracts ?? []) {
    out.push({
      key: `stuck:${c.id}`,
      weight: 'soon',
      what: `${c.name}'s contract has been with Legal ${c.days} days.`,
      why: 'Nothing chases it on its own, and the work may already have started.',
      action: 'Chase it',
      anchor: '#vendor-contracts',
    });
  }

  const paid = txt(input.clientPaymentStatus);
  const invoices = (input.invoiceNumbers ?? []).filter((v) => txt(v));
  if (!invoices.length && (paid === 'paid' || paid === 'partial')) {
    out.push({
      key: 'invoice',
      weight: 'blocking',
      what: 'No invoice number.',
      why: 'The client has paid and there is nothing to reconcile it against.',
      action: 'Add one',
      anchor: '#fields',
    });
  }

  if (pos(input.budget) == null) {
    out.push({
      key: 'budget',
      weight: 'soon',
      what: 'No budget on the campaign.',
      why: 'Without one there is no margin to report, whatever the vendors cost.',
      action: 'Set it',
      anchor: '#fields',
    });
  }

  if (!isoDay(input.dueDate)) {
    out.push({
      key: 'due',
      weight: 'soon',
      what: 'No due date.',
      why: 'It will not appear on the calendar or in anybody’s week.',
      action: 'Set it',
      anchor: '#fields',
    });
  }

  if (input.adsWithoutDate > 0) {
    const n = input.adsWithoutDate;
    out.push({
      key: 'ad-dates',
      weight: 'soon',
      what: `${n} ${n === 1 ? 'ad has' : 'ads have'} no posting date.`,
      why: 'The client’s sheet cannot say when they go out.',
      action: 'Open the sheet',
      anchor: '#tracking',
    });
  }

  // Blocking first, then in the order found — which is booking order, so the
  // list does not reshuffle as prices are filled in.
  return out.sort((a, b) => (a.weight === b.weight ? 0 : a.weight === 'blocking' ? -1 : 1));
}

export function gapSummary(gaps: Gap[]): string {
  const list = gaps ?? [];
  if (!list.length) return 'Nothing is waiting on you.';
  const blocking = list.filter((g) => g.weight === 'blocking').length;
  if (blocking === list.length) {
    return `${list.length} ${list.length === 1 ? 'thing' : 'things'}, ${list.length === 1 ? 'it is' : 'all'} holding something up`;
  }
  if (blocking === 0) return `${list.length} to tidy up`;
  return `${list.length} things · ${blocking} holding something up`;
}

// ── The left index ──────────────────────────────────────────────────

export type IndexStep = 'done' | 'next' | 'todo' | 'none';

export interface IndexEntry {
  key: string;
  label: string;
  /** An id that exists on the page. Every one of these is asserted by a test. */
  anchor: string;
  count: string;
  /** Draws the dot, in the tone below. Something here wants attention. */
  flag: boolean;
  /** Which of the six tones the dot and the count take. */
  tone: 'grey' | 'blue' | 'amber' | 'green' | 'red';
  /**
   * Where this section is in the run-through.
   *
   * `none` is the important one. Comments and Work have no state at which
   * they are *finished* — a campaign with no comments is not a campaign with
   * an outstanding job — so they carry no tick, no empty circle, and are not
   * counted in the progress. Inventing a done state for them would make the
   * ring say "6 of 8" on a campaign that is entirely settled, and a
   * completion figure that never reaches the end is one nobody trusts twice.
   */
  step: IndexStep;
}

/**
 * The list down the left.
 *
 * Every anchor here has to be an id that something on the page actually
 * renders, and for a while three of them were not: **Reports** pointed at
 * `#reports` and **Comments** at `#comments`, neither of which has ever
 * existed, so both did nothing at all when clicked. **Contracts** counted the
 * vendor contract requests and then jumped you to the bookings list instead
 * of to the contracts card. And two whole sections — the client's paperwork,
 * and the non-vendor work — were not in the list, so there was no way to
 * reach them except scrolling.
 *
 * The ids on the page are: fields · bookings · contracts · vendor-contracts ·
 * work · tracking · activity. Seven sections, seven reachable, and the test
 * beside this file checks that set against this list rather than trusting
 * anybody to keep them in step by hand.
 */
export const PAGE_SECTION_IDS = [
  'fields', 'bookings', 'contracts', 'vendor-contracts', 'work', 'tracking', 'activity',
] as const;

export interface PageIndexInput {
  bookings: number;
  contractsWaiting: number;
  contractsTotal: number;
  trackingRows: number;
  adsPosted: number;
  adsTotal: number;
  reports: number;
  comments: number;
  /** Client contract, quotation and invoice — how many of the three are settled. */
  paperworkDone?: number;
  paperworkTotal?: number;
  /** Bookings with no price or no contract yet. */
  bookingsUnready?: number;
  /** Fields on the campaign itself that something downstream is waiting on. */
  campaignMissing?: number;
  /** The client is reading the sheet, and what they are reading is current. */
  trackingPublished?: boolean;
  trackingStale?: boolean;
}

export function pageIndex(input: PageIndexInput): IndexEntry[] {
  const paperTotal = input.paperworkTotal ?? 3;
  const paperDone = Math.min(input.paperworkDone ?? 0, paperTotal);
  const unready = input.bookingsUnready ?? 0;
  const missing = input.campaignMissing ?? 0;

  // `settled` is null where the section has no such thing — see IndexEntry.step.
  const rows: (Omit<IndexEntry, 'step'> & { settled: boolean | null })[] = [
    {
      key: 'campaign', label: 'Campaign', anchor: '#fields', count: '',
      flag: missing > 0,
      tone: missing > 0 ? 'amber' : 'green',
      settled: missing === 0,
    },
    {
      key: 'bookings', label: 'Bookings', anchor: '#bookings',
      count: String(input.bookings),
      // A campaign with no bookings at all is not yet a problem; one with
      // bookings that are missing a price or a contract is.
      flag: unready > 0,
      tone: unready > 0 ? 'amber' : input.bookings > 0 ? 'green' : 'grey',
      settled: input.bookings > 0 && unready === 0,
    },
    {
      key: 'paperwork', label: 'Paperwork', anchor: '#contracts',
      count: `${paperDone}/${paperTotal}`,
      flag: paperDone < paperTotal,
      tone: paperDone >= paperTotal ? 'green' : paperDone > 0 ? 'amber' : 'grey',
      settled: paperDone >= paperTotal,
    },
    {
      key: 'contracts', label: 'Vendor contracts', anchor: '#vendor-contracts',
      count: String(input.contractsTotal),
      flag: input.contractsWaiting > 0,
      tone: input.contractsWaiting > 0 ? 'amber'
        : input.contractsTotal > 0 ? 'green' : 'grey',
      settled: input.contractsTotal > 0 && input.contractsWaiting === 0,
    },
    {
      key: 'work', label: 'Tasks', anchor: '#work',
      count: String(input.reports), flag: false,
      tone: input.reports > 0 ? 'blue' : 'grey',
      // No finished state: a campaign with no tasks on it is not waiting
      // for one.
      settled: null,
    },
    {
      key: 'tracking', label: 'Tracking sheet', anchor: '#tracking',
      count: String(input.trackingRows),
      flag: !!input.trackingStale,
      tone: input.trackingStale ? 'amber'
        : input.trackingPublished ? 'green'
        : input.trackingRows > 0 ? 'blue' : 'grey',
      // Rows existing is not the job. The client reading a current sheet is.
      settled: !!input.trackingPublished && !input.trackingStale,
    },
    {
      key: 'ads', label: 'Ads posted', anchor: '#tracking',
      count: `${input.adsPosted}/${input.adsTotal}`,
      flag: input.adsTotal > 0 && input.adsPosted === 0,
      tone: input.adsTotal === 0 ? 'grey'
        : input.adsPosted === 0 ? 'amber'
        : input.adsPosted >= input.adsTotal ? 'green' : 'blue',
      settled: input.adsTotal > 0 && input.adsPosted >= input.adsTotal,
    },
    {
      key: 'comments', label: 'Comments', anchor: '#activity',
      count: String(input.comments), flag: false,
      tone: input.comments > 0 ? 'blue' : 'grey',
      settled: null,
    },
  ];

  // The first unsettled one is what to do next. Exactly one row can be
  // `next`, so the marker points somewhere rather than at four places at once.
  let nextTaken = false;
  return rows.map(({ settled, ...rest }) => {
    let step: IndexStep;
    if (settled === null) step = 'none';
    else if (settled) step = 'done';
    else if (!nextTaken) { step = 'next'; nextTaken = true; }
    else step = 'todo';
    return { ...rest, step };
  });
}

/**
 * How far through the campaign is, for the ring.
 *
 * Counts only the sections that have a finished state, so a campaign with
 * everything done reads "6 of 6" rather than stalling at "6 of 8" forever on
 * two sections that were never going anywhere.
 */
export function indexProgress(entries: IndexEntry[]): {
  done: number; total: number; pct: number; line: string;
} {
  const counted = (entries ?? []).filter((e) => e.step !== 'none');
  const done = counted.filter((e) => e.step === 'done').length;
  const total = counted.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return {
    done, total, pct,
    line: total === 0 ? 'nothing to settle'
      : done === total ? 'all settled'
      : `${done} of ${total}`,
  };
}

// ── Field groups ────────────────────────────────────────────────────
//
// The order is the question being answered, not the migration that added the
// column. Everything a campaign carries lands in one of these four.

export const FIELD_GROUPS = [
  {
    key: 'who', title: "Who it's for",
    fields: ['client', 'brand', 'category', 'source', 'closer', 'keyAccount'],
  },
  {
    key: 'what', title: 'What it is',
    fields: ['adType', 'platforms', 'due', 'priority', 'approval', 'status'],
  },
  {
    key: 'money', title: 'Money & paperwork',
    fields: ['budget', 'clientPaid', 'quotation', 'invoice', 'vendorCost', 'net'],
  },
] as const;

/** Which values the app works out and nobody types. */
export const CALCULATED_FIELDS = ['vendorCost', 'net'] as const;

export function isCalculated(key: string): boolean {
  return (CALCULATED_FIELDS as readonly string[]).includes(key);
}

/* ── What the booking rows and their actions say ────────────────── */

/**
 * A typed money value, or null.
 *
 * `null` and `0` are different claims — 0 says the work is free, null says
 * nobody has priced it — so a cleared box must not become a zero. Anything
 * that is not a number at all is also null rather than NaN, which would reach
 * Postgres as `NaN` and fail the insert with a message about JSON.
 */
/**
 * A money figure with its thousands separators, while it is being typed.
 *
 * Siraj: *"any integer places for prices and money it should auto put an
 * apostrophe for 1000 it should do it while you work also not when you
 * submit"*. A number only grouped on save is a number you cannot read at the
 * moment you most need to — 29000 and 290000 are one glance apart, and that
 * glance is the difference between a booking and a mistake.
 *
 * Deliberately forgiving, because it runs on every keystroke:
 *  - anything that is not a digit or a dot is dropped, so a pasted
 *    "SAR 29,000.00" cleans itself up;
 *  - a trailing dot survives, or typing "29." would delete the dot the
 *    instant you pressed it;
 *  - decimals stop at two, and the integer side is grouped in threes.
 */
export function groupDigits(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  const cleaned = s.replace(/[^\d.]/g, '');
  if (!cleaned) return '';

  // One dot only: the first wins, later ones are typos.
  const dot = cleaned.indexOf('.');
  const whole = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const frac = dot === -1 ? null : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2);

  // Leading zeros go, but a lone "0" stays — somebody is mid-way to "0.5".
  const trimmed = whole.replace(/^0+(?=\d)/, '');
  const grouped = trimmed.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (dot === -1) return grouped;
  return `${grouped}.${frac}`;
}

/**
 * Where the caret should sit after grouping.
 *
 * Without this the cursor jumps to the end on the keystroke that adds a
 * comma, so editing the middle of a figure is impossible. Counts the
 * characters that are not separators before the caret, then finds that same
 * position in the grouped string.
 */
export function caretAfterGrouping(before: string, caret: number, after: string): number {
  const kept = before.slice(0, Math.max(0, caret)).replace(/[^\d.]/g, '').length;
  if (kept === 0) return 0;
  let seen = 0;
  for (let i = 0; i < after.length; i += 1) {
    if (after[i] !== ',') seen += 1;
    if (seen === kept) return i + 1;
  }
  return after.length;
}

export function parseMoney(v: unknown): number | null {
  const s = txt(v).replace(/[, ]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * The grey line under a booking's name: what is booked, and where it stands.
 *
 * The ad type and the platform are LISTS, not words. One vendor doing a Home
 * Ad on TikTok and a Store Visit on Instagram is one booking, and a subtitle
 * that names only the first of each is a lie about what was booked.
 *
 * `adType` is still read because the drawer passed that shape; new callers
 * pass `adTypeList` and `platformList` straight off a `BookingRow`.
 */
export function bookingSubtitle(
  row: {
    ads?: unknown;
    adType?: unknown;
    adTypeList?: unknown;
    platformList?: unknown;
    contractNote?: unknown;
  },
  adLineCount: number,
): string {
  const parts: string[] = [];
  const ads = Number(row.ads ?? adLineCount) || adLineCount;
  parts.push(ads === 0 ? 'no ads yet' : `${ads} ad${ads === 1 ? '' : 's'}`);

  const types = list(row.adTypeList);
  if (types.length) parts.push(types.join(', '));
  else {
    const type = txt(row.adType);
    if (type) parts.push(type);
  }

  const platforms = list(row.platformList);
  if (platforms.length) parts.push(platforms.join(', '));

  const note = txt(row.contractNote);
  if (note) parts.push(note);
  return parts.join(' · ');
}

/** A string[] out of whatever a caller handed over, blanks dropped. */
function list(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = txt(x);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * The sentence after a bulk contract request.
 *
 * The drawer reported only a count, so "Requested 4 contracts" out of nine
 * selected left five vendors silently untouched and nothing said which. Every
 * skipped one is named with its reason.
 */
export function bulkResultLine(
  sent: number,
  skipped: { title?: unknown; reason?: unknown }[],
): string {
  const head = sent === 0
    ? 'No contracts were sent.'
    : `Requested ${sent} contract${sent === 1 ? '' : 's'}.`;
  if (!skipped.length) return head;
  const names = skipped
    .map((s) => `${txt(s.title) || 'a booking'} (${txt(s.reason) || 'not ready'})`)
    .join('; ');
  return `${head} Skipped ${skipped.length}: ${names}`;
}

/* ── Paperwork ──────────────────────────────────────────────────── */

export interface DocLike {
  id?: unknown;
  doc_kind?: unknown;
  status?: unknown;
  document_number?: unknown;
}

/**
 * Where one document request stands, in words.
 *
 * `cancelled` rows are ignored rather than counted: a cancelled quotation is
 * not a quotation you have, and it is not one in flight either — it is the
 * absence of one, and the row should offer to request another.
 */
export function docState(rows: DocLike[], kind: string): {
  line: string; pending: boolean; issued: boolean; id: string | null;
} {
  const mine = (rows ?? []).filter(
    (r) => txt(r.doc_kind) === kind && txt(r.status) !== 'cancelled',
  );
  const issued = mine.find((r) => txt(r.status) === 'issued');
  if (issued) {
    const num = txt(issued.document_number);
    return {
      line: num ? `issued · ${num}` : 'issued, but no number was recorded',
      pending: false, issued: true, id: txt(issued.id) || null,
    };
  }
  const pending = mine.find((r) => txt(r.status) === 'pending');
  if (pending) {
    return { line: 'requested, waiting on finance', pending: true, issued: false, id: txt(pending.id) || null };
  }
  return { line: 'not requested', pending: false, issued: false, id: null };
}

/** The card's one-line summary: what exists, and what is still outstanding. */
export function contractStateLine(clientRequests: unknown[], docs: DocLike[]): string {
  const parts: string[] = [];
  const live = (clientRequests ?? []).filter((r: any) =>
    !['rejected', 'cancelled'].includes(txt(r?.status)));
  parts.push(live.length ? 'client contract raised' : 'no client contract');
  for (const kind of ['quotation', 'invoice']) {
    const st = docState(docs, kind);
    if (st.issued) parts.push(`${kind} issued`);
    else if (st.pending) parts.push(`${kind} waiting`);
    else parts.push(`no ${kind}`);
  }
  return parts.join(' · ');
}

/**
 * Where a quotation / invoice / contract request row stands.
 *
 * The four states are one field (`request_status`) and mean different things
 * to different people, so the line says who the ball is with rather than
 * printing the raw value — `not_requested` told nobody anything.
 */
export function requestStateLine(sub: {
  request_status?: unknown; quotation_no?: unknown; invoice_no?: unknown;
}): string {
  const st = txt(sub.request_status) || 'not_requested';
  const num = txt(sub.quotation_no) || txt(sub.invoice_no);
  if (st === 'requested') return 'requested — waiting on finance';
  if (st === 'fulfilled') return num ? `done · ${num}` : 'done, but no number was recorded';
  return 'not requested yet';
}

/* ── Asked, then answered ───────────────────────────────────────── */

export type TrackState = 'none' | 'waiting' | 'done' | 'blocked';

/**
 * How long a contract can sit with Legal before somebody should ask.
 *
 * Five working days, said as seven calendar ones. Short enough that a
 * fortnight-old request cannot hide; long enough that the list is not
 * crying wolf on Monday about something sent on Friday.
 *
 * Nothing in the app has ever chased one of these. A request went out, and
 * whether it came back was a thing people noticed or did not.
 */
export const CONTRACT_PATIENCE_DAYS = 7;

/** True when a contract has been with Legal longer than anyone should wait. */
export function contractIsStuck(track: Track): boolean {
  return track.state === 'waiting'
    && track.waitingDays != null
    && track.waitingDays >= CONTRACT_PATIENCE_DAYS;
}

export interface Track {
  state: TrackState;
  /** The pill: what this document is, in one or two words. */
  badge: string;
  /** The left bead. */
  askedLabel: string;
  /** The right bead. Empty when there is nothing to draw yet. */
  answeredLabel: string;
  /** How many whole days it has been waiting, or null when it is not waiting. */
  waitingDays: number | null;
}

/** Whole days between two ISO dates. Never negative — a future ask is 0 days old. */
export function daysBetween(fromIso: unknown, toIso: unknown): number | null {
  const a = Date.parse(txt(fromIso));
  const b = Date.parse(txt(toIso));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / DAY_MS));
}

/**
 * One document's journey: you ask, then somebody answers.
 *
 * The waiting time is the whole point of drawing it. An invoice requested
 * eleven days ago and still unanswered is a different situation from one
 * requested this morning, and the old card said "requested" for both.
 */
export function docTrack(
  rows: DocLike[],
  kind: string,
  today: string,
): Track {
  const mine = (rows ?? []).filter(
    (r) => txt((r as any).doc_kind) === kind && txt((r as any).status) !== 'cancelled',
  );

  const issued = mine.find((r) => txt((r as any).status) === 'issued');
  if (issued) {
    const num = txt((issued as any).document_number);
    return {
      state: 'done',
      badge: num || 'Issued',
      askedLabel: askedOn((issued as any).requested_at, today),
      answeredLabel: `Issued ${shortDate((issued as any).issued_at, today)}`,
      waitingDays: null,
    };
  }

  const pending = mine.find((r) => txt((r as any).status) === 'pending');
  if (pending) {
    const days = daysBetween((pending as any).requested_at, today);
    return {
      state: 'waiting',
      badge: days == null ? 'Waiting' : days === 0 ? 'Asked today' : `Waiting ${days} day${days === 1 ? '' : 's'}`,
      askedLabel: askedOn((pending as any).requested_at, today),
      answeredLabel: 'Not issued',
      waitingDays: days,
    };
  }

  return {
    state: 'none',
    badge: 'Not asked for',
    askedLabel: 'Not asked for yet',
    answeredLabel: '',
    waitingDays: null,
  };
}

function askedOn(iso: unknown, today: string): string {
  const d = shortDate(iso, today);
  return d === '—' ? 'Asked' : `Asked ${d}`;
}

/**
 * The same journey for a contract request, whose columns are named differently
 * and whose states are Legal's rather than finance's.
 */
export function contractTrack(
  req: { status?: unknown; created_at?: unknown; generated_at?: unknown } | null,
  today: string,
  blockedReason?: string | null,
): Track {
  const reason = txt(blockedReason);
  if (!req) {
    return reason
      ? { state: 'blocked', badge: reason, askedLabel: `${reason} — then this can be asked for`, answeredLabel: '', waitingDays: null }
      : { state: 'none', badge: 'Ready to ask', askedLabel: 'Not asked for yet', answeredLabel: '', waitingDays: null };
  }

  const status = txt(req.status);
  if (status === 'generated') {
    return {
      state: 'done', badge: 'Signed',
      askedLabel: askedOn(req.created_at, today),
      answeredLabel: `Signed ${shortDate(req.generated_at, today)}`,
      waitingDays: null,
    };
  }
  // Rejected and cancelled are not "in flight" — they are a reason to ask again.
  if (status === 'rejected' || status === 'cancelled') {
    return {
      state: 'none', badge: status === 'rejected' ? 'Rejected' : 'Cancelled',
      askedLabel: askedOn(req.created_at, today),
      answeredLabel: 'Ask again', waitingDays: null,
    };
  }
  const days = daysBetween(req.created_at, today);
  return {
    state: 'waiting',
    badge: days == null ? 'With Legal' : days === 0 ? 'Sent today' : `With Legal ${days} day${days === 1 ? '' : 's'}`,
    askedLabel: askedOn(req.created_at, today),
    answeredLabel: 'Not back yet',
    waitingDays: days,
  };
}

/**
 * The ask-everything button.
 *
 * Named for what it will actually do. "Request all contracts" on a campaign
 * where two of five are blocked is a promise the button cannot keep, and the
 * drawer's version quietly sent three and reported a number.
 */
export function askAllLabel(ready: number, blocked: number): string {
  if (ready === 0) {
    return blocked > 0
      ? `Nothing ready — ${blocked} blocked`
      : 'Every contract is asked for';
  }
  const head = ready === 1 ? "Ask for the 1 that's ready" : `Ask for the ${ready} that are ready`;
  return blocked > 0 ? `${head} · ${blocked} blocked` : head;
}

/**
 * "90 days", or nothing at all when the term was never recorded.
 *
 * Weeks and months are gone from the input — Siraj asked for a plain number of
 * days, because "2 weeks" and "14 days" are the same contract written two ways
 * and only one of them can be added to a date without thinking. Rows entered
 * before this still carry their old unit, so it is still read and printed
 * rather than silently relabelled as days.
 */
export function lengthLabel(n: unknown, unit: unknown): string {
  // Not through txt(): it returns '' for a number, so a numeric 3 became ''.
  const num = typeof n === 'number' ? n : Number(txt(n));
  const u = txt(unit) || 'days';
  if (!Number.isFinite(num) || num <= 0) return '';
  const singular = num === 1 ? u.replace(/s$/, '') : u;
  return `${num} ${singular}`;
}

/** The document kinds, spelled the way a person writes them. */
const DOC_LABELS: Record<string, string> = {
  quotation: 'Quotation',
  invoice: 'Invoice',
  client: 'Client contract',
  vendor: 'Vendor contract',
};

/**
 * `labelFor` in use-workflow has no entry for the document kinds, so it
 * returned them raw and the card read "quotation" and "invoice" in lowercase.
 */
export function docLabel(kind: unknown): string {
  const k = txt(kind);
  return DOC_LABELS[k] ?? (k ? k[0].toUpperCase() + k.slice(1) : '—');
}

/* ── Small human formats ────────────────────────────────────────── */

/**
 * A file size a person can read.
 *
 * The drawer printed raw bytes, so a 1.3 MB deck read as "1363148" — a number
 * nobody can compare to the 10 MB limit it is being measured against.
 */
export function fileSize(bytes: unknown): string {
  // An absent size is not a zero-byte file — one is unknown, the other is
  // empty, and Number('') is 0 which would quietly conflate them.
  if (bytes == null) return '';
  const raw = typeof bytes === 'number' ? bytes : txt(bytes);
  if (raw === '') return '';
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * How long ago, without a clock being passed in.
 *
 * The only place in this file that reads the current time, and it is
 * deliberate: a comment timestamp is never rendered on the server (the card
 * only exists on the client), and threading `now` through every comment row
 * to satisfy a rule about hydration would be noise. `nowMs` is still an
 * argument so the tests can pin it.
 */
export function whenAgo(iso: unknown, nowMs?: number): string {
  const t = Date.parse(txt(iso));
  if (!Number.isFinite(t)) return '';
  const now = nowMs ?? Date.now();
  const secs = Math.max(0, Math.floor((now - t) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

/**
 * What the client is currently being shown, and whether it is still true.
 *
 * "Published" on its own is not enough. The published copy is a snapshot: rows
 * added, changed or deleted since then are not in it, so a sheet can be
 * published and out of date at the same time, and the client is reading the
 * old one. The drawer showed a timestamp — a timestamp cannot see a deletion.
 */
export function publishLine(input: {
  publishedAt?: unknown;
  rowCount: number;
  publishedCount: number;
}): { line: string; detail: string; stale: boolean } {
  const rows = Math.max(0, Number(input.rowCount) || 0);
  const published = Math.max(0, Number(input.publishedCount) || 0);
  const ever = !!txt(input.publishedAt);

  if (!ever) {
    return {
      line: rows ? `${rows} row${rows === 1 ? '' : 's'} · not published` : 'no rows yet',
      detail: rows
        ? 'The client cannot see any of this yet.'
        : 'Nothing on the sheet yet. Booking a vendor adds their ads to it.',
      stale: false,
    };
  }

  if (rows === published) {
    return {
      line: `${published} row${published === 1 ? '' : 's'} · client is up to date`,
      detail: 'What the client is reading matches what is here.',
      stale: false,
    };
  }

  const diff = rows - published;
  return {
    line: `${published} published · ${Math.abs(diff)} ${diff > 0 ? 'not sent' : 'removed since'}`,
    detail: diff > 0
      ? `The client is reading ${published} row${published === 1 ? '' : 's'}. ${diff} newer one${diff === 1 ? '' : 's'} ${diff === 1 ? 'is' : 'are'} not in it yet.`
      : `The client is still reading ${published} row${published === 1 ? '' : 's'}, ${Math.abs(diff)} of which ${Math.abs(diff) === 1 ? 'has' : 'have'} been removed here.`,
    stale: true,
  };
}
