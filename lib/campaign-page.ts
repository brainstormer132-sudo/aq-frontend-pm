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
 *    rules as the Dashboard's Needs attention rather than a second opinion;
 *  - when the ads go out, which is the question the tracking sheet answers one
 *    row at a time and nothing answered as a shape.
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

// ── The money bar ───────────────────────────────────────────────────

export interface MoneyBar {
  budget: number | null;
  vendorCost: number | null;
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
 * `marginRate` is null rather than 0 when there is no budget: a campaign
 * nobody has priced has no margin, and printing "0%" says we made nothing on
 * work that might be very profitable.
 */
export function moneyBar(input: {
  budget?: unknown;
  vendorCost?: unknown;
}): MoneyBar {
  const budget = pos(input.budget);
  const vendorCost = pos(input.vendorCost);

  if (budget == null) {
    return {
      budget: null, vendorCost, net: null, marginRate: null,
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

  return {
    budget,
    vendorCost,
    net,
    marginRate: rate,
    costPct,
    overspent,
    sentence: overspent
      ? `Vendors cost ${moneyRound(cost)}, which is more than the ${moneyRound(budget)} budget.`
      : `Of a ${moneyRound(budget)} budget, ${moneyRound(cost)} goes to vendors and ${moneyRound(net)} is net.`,
  };
}

// ── When the ads go out ─────────────────────────────────────────────

export type AdStatusKey = 'Posted' | 'Shot' | 'Scheduled' | 'Not started' | 'Cancelled';

export interface AdForStrip {
  posting_date?: string | null;
  ad_status?: string | null;
}

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
  quantity?: unknown;
  status?: string | null;
}

export interface BookingRow {
  id: string;
  name: string;
  initials: string;
  /** How many ads the booking holds, counting quantity. */
  ads: number;
  posted: number;
  /** 0–100 for the progress sliver. */
  progressPct: number;
  adTypes: string;
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
    for (const l of lines) {
      const q = Math.max(1, num(l.quantity) ?? 1);
      ads += q;
      if (txt(l.status) === 'Posted') posted += q;
      const t = txt(l.ad_type);
      if (t && !types.includes(t)) types.push(t);
    }
    if (!lines.length && txt(s.ad_type)) types.push(txt(s.ad_type));

    const name = txt(s.vendor_id != null ? input.vendorNames?.get(s.vendor_id) : '')
      || txt(s.task_name) || txt(s.title) || 'No vendor yet';
    const price = pos(s.price);

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
      price,
      contract,
      contractLabel: contractLabelFor(contract),
      problem,
      meta: bits.join(' · '),
    };
  });
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
  today: string;
}): Gap[] {
  const out: Gap[] = [];

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
      anchor: '#ads',
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

export interface IndexEntry {
  key: string;
  label: string;
  anchor: string;
  count: string;
  /** Draws the amber dot. */
  flag: boolean;
}

export function pageIndex(input: {
  bookings: number;
  contractsWaiting: number;
  contractsTotal: number;
  trackingRows: number;
  adsPosted: number;
  adsTotal: number;
  reports: number;
  comments: number;
}): IndexEntry[] {
  return [
    { key: 'campaign', label: 'Campaign', anchor: '#fields', count: '', flag: false },
    { key: 'bookings', label: 'Bookings', anchor: '#bookings', count: String(input.bookings), flag: false },
    {
      key: 'contracts', label: 'Contracts', anchor: '#bookings',
      count: String(input.contractsTotal), flag: input.contractsWaiting > 0,
    },
    { key: 'tracking', label: 'Tracking sheet', anchor: '#ads', count: String(input.trackingRows), flag: false },
    {
      key: 'ads', label: 'Ads posted', anchor: '#ads',
      count: `${input.adsPosted}/${input.adsTotal}`,
      flag: input.adsTotal > 0 && input.adsPosted === 0,
    },
    { key: 'reports', label: 'Reports', anchor: '#reports', count: String(input.reports), flag: false },
    { key: 'comments', label: 'Comments', anchor: '#comments', count: String(input.comments), flag: false },
  ];
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
export function parseMoney(v: unknown): number | null {
  const s = txt(v).replace(/[, ]/g, '');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** The grey line under a booking's name: what is booked, and where it stands. */
export function bookingSubtitle(
  row: { ads?: unknown; adType?: unknown; contractNote?: unknown },
  adLineCount: number,
): string {
  const parts: string[] = [];
  const ads = Number(row.ads ?? adLineCount) || adLineCount;
  parts.push(ads === 0 ? 'no ads yet' : `${ads} ad${ads === 1 ? '' : 's'}`);
  const type = txt(row.adType);
  if (type) parts.push(type);
  const note = txt(row.contractNote);
  if (note) parts.push(note);
  return parts.join(' · ');
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
