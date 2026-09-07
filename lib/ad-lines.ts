/**
 * The ads inside one vendor booking, and how they read on a contract.
 *
 * A Package Ad is one booking with several ads in it — six home ads, six
 * store visits, and often a few reminders that cost nothing. The subtask
 * carries one ad_type and one price, which is why a twelve-piece booking
 * used to be contracted as "1 × ad".
 *
 * These functions turn a list of lines into the three things a contract
 * needs: an amount, a quantity, and a sentence that says what was actually
 * agreed. Pure, so the wording of a legal document is testable.
 *
 * A free line is a line. A reminder at zero is still part of the agreement
 * and still appears in the contract — dropping it because it costs nothing
 * is how something ends up delivered but not covered.
 */

export interface AdLine {
  id?: string;
  subtask_id?: string;
  position?: number;
  ad_type: string;
  platform?: string | null;
  quantity: number;
  unit_price: number;
  /** Generated in the database; recomputed here when absent. */
  line_total?: number | null;
  notes?: string | null;

  // ── per-ad, not per-booking (migration 057) ───────────────────
  // Same vendor, same contract, different work: the ads inside one booking
  // land on different days and carry their own briefs.
  due_date?: string | null;
  description?: string | null;
  status?: string | null;

  // ── proof, per ad (migration 058) ─────────────────────────────
  // An influencer booked for twelve pieces posts twelve times. One link on
  // the booking says "some of it happened" and nothing about which.
  proof_of_posting_link?: string | null;

  // ── money, per ad (migration 067) ─────────────────────────────
  // A vendor booked for ten ads is not paid in one lump: ads can be quoted
  // separately and paid on different days, so a half-paid booking had no
  // way to be described while all of this lived on the booking.
  quotation_no?: string | null;
  net_amount?: number | null;
  net_payment_date?: string | null;
  net_payment_status?: string | null;
  proof_of_posting_attached?: boolean | null;
  posted_on?: string | null;
}

export const AD_LINE_STATUSES = ['Not started', 'Scheduled', 'Shot', 'Posted', 'Cancelled'] as const;

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function num(v: number | null | undefined): number {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : 0;
}

/**
 * What a line costs: the price of ONE ad, times how many of them.
 *
 * 059 briefly made the price flat for the whole line — a vendor quotes
 * "this ad, 1,500", so one box seemed simpler. In use it read wrong: a line
 * of 4 Store Visits at 5,000.66 showed as 5,000 for all four, and the number
 * people carry in their head is the per-ad rate. 060 put the multiplication
 * back.
 */
export function lineTotal(line: AdLine): number {
  if (line.line_total != null && Number.isFinite(Number(line.line_total))) {
    return Number(line.line_total);
  }
  return num(line.quantity) * num(line.unit_price);
}

/**
 * What the VENDOR takes for a line: their fee for one ad, times how many.
 *
 * `net_amount` is per ad, exactly as `unit_price` is — "what the vendor takes
 * for that one ad" (aq-price-is-not-net.md). It has no generated column to
 * lean on the way `line_total` does, so it is always computed.
 *
 * Null, not zero, when nobody has worked the net out. Those are different
 * claims: zero says the vendor works for free, null says we do not yet know
 * what we owe them — and a contract must never be written from the second.
 */
export function lineNet(line: AdLine): number | null {
  if (line.net_amount == null) return null;
  const n = Number(line.net_amount);
  if (!Number.isFinite(n)) return null;
  return num(line.quantity) * n;
}

export interface AdLineTotals {
  /** How many ads, counting quantities — 6 home + 6 store = 12. */
  ads: number;
  /**
   * What the CLIENT is billed for all of them.
   *
   * This field used to be documented as "what the vendor is owed", and it was
   * that comment — not a calculation — that put the client's price on every
   * vendor contract. `unit_price` is the client charge; the vendor's fee is
   * `net` below. Read the name of the field you want.
   */
  amount: number;
  /** What the VENDOR is owed for all of them. Zero when nothing is worked out. */
  net: number;
  /**
   * True when at least one line carries a net. False means nothing here can
   * describe what the vendor is owed, and `net` is 0 because there is nothing
   * to add up — never because the work is free.
   */
  netKnown: boolean;
  /** Lines with a price but no net. These are what block a vendor contract. */
  netMissing: number;
  /** Lines that cost nothing. Worth naming, because people forget them. */
  freeLines: number;
}

export function totalsOf(lines: AdLine[]): AdLineTotals {
  let ads = 0, amount = 0, net = 0, freeLines = 0, netMissing = 0;
  let netKnown = false;
  for (const l of lines || []) {
    ads += num(l.quantity);
    const t = lineTotal(l);
    amount += t;
    if (t === 0) freeLines += 1;

    const n = lineNet(l);
    if (n == null) { if (t > 0) netMissing += 1; } else { net += n; netKnown = true; }
  }
  return { ads, amount, net, netKnown, netMissing, freeLines };
}

export interface AdTypeGroup {
  ad_type: string;
  quantity: number;
  /** What the client is billed for this group. */
  amount: number;
  /** What the vendor is owed for it. */
  net: number;
  /** False when no line in the group has a net worked out. */
  netKnown: boolean;
}

/**
 * Collapse the lines by ad type, keeping the order they were entered in.
 *
 * Two lines of "Home Ad" written on different days are one thing to whoever
 * reads the contract, so they are added together rather than listed twice.
 */
export function groupByAdType(lines: AdLine[]): AdTypeGroup[] {
  const order: string[] = [];
  const acc = new Map<string, AdTypeGroup>();
  for (const l of lines || []) {
    const key = txt(l.ad_type) || 'Ad';
    if (!acc.has(key)) {
      acc.set(key, { ad_type: key, quantity: 0, amount: 0, net: 0, netKnown: false });
      order.push(key);
    }
    const g = acc.get(key)!;
    g.quantity += num(l.quantity);
    g.amount += lineTotal(l);
    const n = lineNet(l);
    if (n != null) { g.net += n; g.netKnown = true; }
  }
  return order.map((k) => acc.get(k)!);
}

/**
 * The one-line summary that goes in the contract's ad-type field:
 * `6 × Home Ad, 6 × Store Visit, 3 × Reminder`.
 */
export function adTypeSummary(lines: AdLine[]): string {
  const groups = groupByAdType(lines);
  if (!groups.length) return '';
  return groups.map((g) => `${g.quantity} × ${g.ad_type}`).join(', ');
}

function money(n: number): string {
  return `SAR ${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * The itemisation, written once, for the VENDOR contract's details.
 *
 * ── THE BUG THIS REPLACES ─────────────────────────────────────────
 *
 * Every figure here used to be `lineTotal()` — the CLIENT's price. So a
 * booking of six ads at 1,500 that cost AQ 700 each produced a contract
 * reading "6 × Home Ad — SAR 1,500 each · SAR 9,000", handed to an influencer
 * who is owed 4,200. AQ was promising, in writing, its own selling price.
 *
 * Nothing in the arithmetic was wrong. `AdLineTotals.amount` was documented
 * as "what the vendor is owed", and whoever wired it in believed the comment.
 * That is the same failure as 046's "belt and braces" revoke: a confident
 * wrong comment stops the next person from checking.
 *
 * A vendor contract now shows `net_amount` and nothing else. If the net has
 * not been worked out, it says so in the document rather than substituting
 * the number it does have — a contract that admits a gap can be stopped by
 * the person reading it; one quoting the wrong figure cannot.
 *
 * Free lines are marked "no charge" rather than "SAR 0", because a zero in a
 * price column reads like a mistake and an explicit "no charge" reads like a
 * decision — which is what it is.
 */
export function contractDetails(lines: AdLine[], header?: string | null): string {
  const groups = groupByAdType(lines);
  if (!groups.length) return txt(header);

  // The per-ad rate is what was agreed and what the vendor will check, so
  // the contract shows it alongside the total rather than only the total.
  //
  // `each` is a division across a group that may hold lines at different
  // rates, so it is only shown when the number we would PRINT multiplies back
  // to the total we would print beside it.
  //
  // Two Home Ad lines at 1,000 and one at 1,500 average 1,166.67. money()
  // rounds that to "SAR 1,167", and 1,167 × 3 = 3,501 against a stated total
  // of 3,500 — two numbers on one line of a signed document that contradict
  // each other, at a per-ad rate nobody agreed to. Testing the unrounded
  // division instead would always pass and catch nothing: it is the rounding
  // that breaks the reconciliation, so the rounded figure is what to test.
  const body = groups.map((g) => {
    if (!g.netKnown) return `${g.quantity} × ${g.ad_type} — fee not agreed yet`;
    if (g.net === 0) return `${g.quantity} × ${g.ad_type} — no charge`;
    const each = g.quantity > 0 ? Math.round(g.net / g.quantity) : 0;
    const reconciles = g.quantity > 0 && each * g.quantity === Math.round(g.net);
    return reconciles
      ? `${g.quantity} × ${g.ad_type} — ${money(each)} each · ${money(g.net)}`
      : `${g.quantity} × ${g.ad_type} — ${money(g.net)}`;
  });

  const { net, ads, netKnown, netMissing } = totalsOf(lines);
  const head = txt(header);
  const dated = schedule(lines);

  // The dates belong in the contract: they are what the vendor is agreeing
  // to deliver and when. A line with a brief carries it here too, because
  // "Store Visit" alone does not tell anybody which branch.
  const when = dated.length ? [
    '',
    'Schedule:',
    ...dated.map((l) => {
      const bits = [
        `${txt(l.due_date)} — ${txt(l.ad_type) || 'Ad'}`,
        Number(l.quantity) > 1 ? `×${l.quantity}` : null,
        txt(l.description) || null,
      ].filter(Boolean);
      return bits.join(' · ');
    }),
  ] : [];

  // The total says what it is. "Total: SAR 4,200" on a page whose other
  // number is 9,000 is exactly the ambiguity that caused the bug.
  const total = netKnown
    ? `Total payable to the vendor: ${ads} ad${ads === 1 ? '' : 's'} · ${money(net)}`
    : `Total payable to the vendor: ${ads} ad${ads === 1 ? '' : 's'} · not agreed yet`;

  const gap = netMissing > 0
    ? `(${netMissing} ${netMissing === 1 ? 'line has' : 'lines have'} no agreed fee — `
      + 'settle those before this is signed.)'
    : null;

  return [
    head,
    head ? '' : null,
    ...body,
    ...when,
    '',
    total,
    gap,
  ].filter((l) => l !== null).join('\n').trim();
}

/**
 * The dated lines, oldest first, for the contract's schedule.
 *
 * Only lines that actually have a date. A booking where nobody has set dates
 * yet gets no schedule section rather than a list of blanks, which would
 * read as though the dates were deliberately left open.
 */
export function schedule(lines: AdLine[]): AdLine[] {
  return (lines || [])
    .filter((l) => !!txt(l.due_date))
    .slice()
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
}

/** A blank line for the editor, positioned after the ones already there. */
export function blankLine(subtaskId: string, existing: AdLine[]): AdLine {
  const nextPos = (existing || []).reduce((max, l) => Math.max(max, num(l.position)), -1) + 1;
  return {
    subtask_id: subtaskId,
    position: nextPos,
    ad_type: '',
    platform: null,
    quantity: 1,
    unit_price: 0,
    notes: null,
  };
}

// ── Adding several at once ──────────────────────────────────────────
//
// Bookings arrive in batches: "six home ads at 1,500". Adding those one
// blank row at a time meant six rounds of typing the same ad type and the
// same price, and six chances to typo one of them. The dialog asks once.
//
// Six separate lines, not one line of quantity six, because the whole point
// of 057 is that each ad has its own day and its own brief. A single line of
// six cannot hold six dates.

export interface AdLineSpec {
  /** How many separate ads to create. */
  count: number;
  ad_type: string;
  platform?: string | null;
  /** How many ads this line stands for. Multiplies the price. */
  quantity: number;
  unit_price: number;
  /** Optional brief copied onto each; they can be edited apart afterwards. */
  description?: string | null;
}

export interface AdLineSpecTotals {
  /** Rows that will be created. */
  lines: number;
  /** Ads, counting quantity — 6 lines × 2 = 12 ads. */
  ads: number;
  amount: number;
  free: boolean;
}

/**
 * What the dialog shows above the fields, recomputed on every keystroke.
 *
 * The number that ends up in the contract is worth showing BEFORE the rows
 * exist, because "6 × 1500 = 9,000" is checkable at a glance and a list of
 * six rows adding up to 9,000 is not.
 */
export function specTotals(spec: AdLineSpec): AdLineSpecTotals {
  const lines = Math.max(0, Math.floor(num(spec.count)));
  const qty = Math.max(0, Math.floor(num(spec.quantity)));
  // Price is per ad, so quantity multiplies it (060): three lines of two
  // Stories at 500 is six ads and 3,000.
  const amount = lines * qty * num(spec.unit_price);
  return { lines, ads: lines * qty, amount, free: amount === 0 };
}

/** What is still wrong with the dialog, in words. Empty means it can be saved. */
export function specProblems(spec: AdLineSpec): string[] {
  const out: string[] = [];
  const count = num(spec.count);
  if (!Number.isInteger(count) || count < 1) out.push('Add at least one line.');
  else if (count > 100) out.push('That is more than 100 lines — add them in smaller batches.');
  if (!txt(spec.ad_type)) out.push('Pick an ad type.');
  if (!(num(spec.quantity) > 0)) out.push('Quantity must be at least 1.');
  if (num(spec.unit_price) < 0) out.push('A price cannot be negative.');
  return out;
}

/**
 * The rows the dialog will create, positioned after whatever is already
 * there so a second batch lands underneath the first rather than jumbled
 * through it.
 *
 * No due dates: they differ per ad by definition, so they are set on the
 * ads themselves. Leaving them blank is visible — the card counts undated
 * lines in red — where a guessed date would not be.
 */
export function newLines(subtaskId: string, existing: AdLine[], spec: AdLineSpec): AdLine[] {
  const start = (existing || []).reduce((max, l) => Math.max(max, num(l.position)), -1) + 1;
  const count = Math.max(0, Math.floor(num(spec.count)));
  const out: AdLine[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      subtask_id: subtaskId,
      position: start + i,
      ad_type: txt(spec.ad_type),
      platform: txt(spec.platform) || null,
      quantity: Math.floor(num(spec.quantity)) || 1,
      unit_price: num(spec.unit_price),
      description: txt(spec.description) || null,
      status: 'Not started',
      due_date: null,
      notes: null,
    });
  }
  return out;
}

// ── Proof, per ad ───────────────────────────────────────────────────

/** A link OR the tick. Whitespace is not a link. */
export function hasProof(line: AdLine): boolean {
  return Boolean(line?.proof_of_posting_attached) || txt(line?.proof_of_posting_link) !== '';
}

/**
 * The ads still owing proof.
 *
 * A cancelled ad is exempt: nothing was posted, so there is nothing to
 * prove, and counting it would leave a warning that can never be cleared
 * except by deleting a line somebody deliberately kept.
 */
export function adsMissingProof(lines: AdLine[]): AdLine[] {
  return (lines || []).filter((l) => txt(l.status) !== 'Cancelled' && !hasProof(l));
}

/** The ads that are expected to produce proof at all. */
export function adsExpectingProof(lines: AdLine[]): AdLine[] {
  return (lines || []).filter((l) => txt(l.status) !== 'Cancelled');
}

/** One ad's name in a list: `Home Ad ×2 — Riyadh branch`. */
export function lineLabel(line: AdLine): string {
  const type = txt(line?.ad_type) || 'Ad';
  const qty = num(line?.quantity) > 1 ? ` ×${line.quantity}` : '';
  const desc = txt(line?.description);
  return `${type}${qty}${desc ? ` — ${desc}` : ''}`;
}

/** What is still wrong with a line, in words. Empty means it can be saved. */
export function lineProblems(line: AdLine): string[] {
  const out: string[] = [];
  if (!txt(line.ad_type)) out.push('Give the line an ad type.');
  if (!(num(line.quantity) > 0)) out.push('Quantity must be at least 1.');
  if (num(line.unit_price) < 0) out.push('A price cannot be negative.');
  return out;
}
