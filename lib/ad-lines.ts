/**
 * The ads inside one vendor booking, and how they read on a contract.
 *
 * A Package Ad is one booking with several ads in it \u2014 six home ads, six
 * store visits, and often a few reminders that cost nothing. The subtask
 * carries one ad_type and one price, which is why a twelve-piece booking
 * used to be contracted as "1 \u00d7 ad".
 *
 * These functions turn a list of lines into the three things a contract
 * needs: an amount, a quantity, and a sentence that says what was actually
 * agreed. Pure, so the wording of a legal document is testable.
 *
 * A free line is a line. A reminder at zero is still part of the agreement
 * and still appears in the contract \u2014 dropping it because it costs nothing
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

  // \u2500\u2500 per-ad, not per-booking (migration 057) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Same vendor, same contract, different work: the ads inside one booking
  // land on different days and carry their own briefs.
  due_date?: string | null;
  description?: string | null;
  status?: string | null;

  // \u2500\u2500 proof, per ad (migration 058) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // An influencer booked for twelve pieces posts twelve times. One link on
  // the booking says "some of it happened" and nothing about which.
  proof_of_posting_link?: string | null;

  // \u2500\u2500 money, per ad (migration 067) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // A vendor booked for ten ads is not paid in one lump: ads can be quoted
  // separately and paid on different days, so a half-paid booking had no
  // way to be described while all of this lived on the booking.
  quotation_no?: string | null;
  net_amount?: number | null;
  net_payment_date?: string | null;
  net_payment_status?: string | null;
  proof_of_posting_attached?: boolean | null;
  posted_on?: string | null;

  // -- which bank this ad is paid to (migration 083) ------------
  // A vendor can use a different bank per ad. Null means the vendor's
  // default; a per-line contract uses this, a combined one uses the default.
  bank_account_id?: number | null;
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
 * 059 briefly made the price flat for the whole line \u2014 a vendor quotes
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
 * `net_amount` is per ad, exactly as `unit_price` is \u2014 "what the vendor takes
 * for that one ad" (aq-price-is-not-net.md). It has no generated column to
 * lean on the way `line_total` does, so it is always computed.
 *
 * Null, not zero, when nobody has worked the net out. Those are different
 * claims: zero says the vendor works for free, null says we do not yet know
 * what we owe them \u2014 and a contract must never be written from the second.
 */
export function lineNet(line: AdLine): number | null {
  if (line.net_amount == null) return null;
  const n = Number(line.net_amount);
  if (!Number.isFinite(n)) return null;
  return num(line.quantity) * n;
}

export interface AdLineTotals {
  /** How many ads, counting quantities \u2014 6 home + 6 store = 12. */
  ads: number;
  /**
   * What the CLIENT is billed for all of them.
   *
   * This field used to be documented as "what the vendor is owed", and it was
   * that comment \u2014 not a calculation \u2014 that put the client's price on every
   * vendor contract. `unit_price` is the client charge; the vendor's fee is
   * `net` below. Read the name of the field you want.
   */
  amount: number;
  /** What the VENDOR is owed for all of them. Zero when nothing is worked out. */
  net: number;
  /**
   * True when at least one line carries a net. False means nothing here can
   * describe what the vendor is owed, and `net` is 0 because there is nothing
   * to add up \u2014 never because the work is free.
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
 * `6 \u00d7 Home Ad, 6 \u00d7 Store Visit, 3 \u00d7 Reminder`.
 */
export function adTypeSummary(lines: AdLine[]): string {
  const groups = groupByAdType(lines);
  if (!groups.length) return '';
  return groups.map((g) => `${g.quantity} \u00d7 ${g.ad_type}`).join(', ');
}

function money(n: number): string {
  return `SAR ${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * The itemisation, written once, for the VENDOR contract's details.
 *
 * \u2500\u2500 THE BUG THIS REPLACES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 *
 * Every figure here used to be `lineTotal()` \u2014 the CLIENT's price. So a
 * booking of six ads at 1,500 that cost AQ 700 each produced a contract
 * reading "6 \u00d7 Home Ad \u2014 SAR 1,500 each \u00b7 SAR 9,000", handed to an influencer
 * who is owed 4,200. AQ was promising, in writing, its own selling price.
 *
 * Nothing in the arithmetic was wrong. `AdLineTotals.amount` was documented
 * as "what the vendor is owed", and whoever wired it in believed the comment.
 * That is the same failure as 046's "belt and braces" revoke: a confident
 * wrong comment stops the next person from checking.
 *
 * A vendor contract now shows `net_amount` and nothing else. If the net has
 * not been worked out, it says so in the document rather than substituting
 * the number it does have \u2014 a contract that admits a gap can be stopped by
 * the person reading it; one quoting the wrong figure cannot.
 *
 * Free lines are marked "no charge" rather than "SAR 0", because a zero in a
 * price column reads like a mistake and an explicit "no charge" reads like a
 * decision \u2014 which is what it is.
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
  // rounds that to "SAR 1,167", and 1,167 \u00d7 3 = 3,501 against a stated total
  // of 3,500 \u2014 two numbers on one line of a signed document that contradict
  // each other, at a per-ad rate nobody agreed to. Testing the unrounded
  // division instead would always pass and catch nothing: it is the rounding
  // that breaks the reconciliation, so the rounded figure is what to test.
  const body = groups.map((g) => {
    if (!g.netKnown) return `${g.quantity} \u00d7 ${g.ad_type} \u2014 fee not agreed yet`;
    if (g.net === 0) return `${g.quantity} \u00d7 ${g.ad_type} \u2014 no charge`;
    const each = g.quantity > 0 ? Math.round(g.net / g.quantity) : 0;
    const reconciles = g.quantity > 0 && each * g.quantity === Math.round(g.net);
    return reconciles
      ? `${g.quantity} \u00d7 ${g.ad_type} \u2014 ${money(each)} each \u00b7 ${money(g.net)}`
      : `${g.quantity} \u00d7 ${g.ad_type} \u2014 ${money(g.net)}`;
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
        `${txt(l.due_date)} \u2014 ${txt(l.ad_type) || 'Ad'}`,
        Number(l.quantity) > 1 ? `\u00d7${l.quantity}` : null,
        txt(l.description) || null,
      ].filter(Boolean);
      return bits.join(' \u00b7 ');
    }),
  ] : [];

  // The total says what it is. "Total: SAR 4,200" on a page whose other
  // number is 9,000 is exactly the ambiguity that caused the bug.
  const total = netKnown
    ? `Total payable to the vendor: ${ads} ad${ads === 1 ? '' : 's'} \u00b7 ${money(net)}`
    : `Total payable to the vendor: ${ads} ad${ads === 1 ? '' : 's'} \u00b7 not agreed yet`;

  const gap = netMissing > 0
    ? `(${netMissing} ${netMissing === 1 ? 'line has' : 'lines have'} no agreed fee \u2014 `
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

// \u2500\u2500 Adding several at once \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
  /** Ads, counting quantity \u2014 6 lines \u00d7 2 = 12 ads. */
  ads: number;
  amount: number;
  free: boolean;
}

/**
 * What the dialog shows above the fields, recomputed on every keystroke.
 *
 * The number that ends up in the contract is worth showing BEFORE the rows
 * exist, because "6 \u00d7 1500 = 9,000" is checkable at a glance and a list of
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
  else if (count > 100) out.push('That is more than 100 lines \u2014 add them in smaller batches.');
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
 * ads themselves. Leaving them blank is visible \u2014 the card counts undated
 * lines in red \u2014 where a guessed date would not be.
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

// \u2500\u2500 Proof, per ad \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

/** One ad's name in a list: `Home Ad \u00d72 \u2014 Riyadh branch`. */
export function lineLabel(line: AdLine): string {
  const type = txt(line?.ad_type) || 'Ad';
  const qty = num(line?.quantity) > 1 ? ` \u00d7${line.quantity}` : '';
  const desc = txt(line?.description);
  return `${type}${qty}${desc ? ` \u2014 ${desc}` : ''}`;
}

/** What is still wrong with a line, in words. Empty means it can be saved. */
export function lineProblems(line: AdLine): string[] {
  const out: string[] = [];
  if (!txt(line.ad_type)) out.push('Give the line an ad type.');
  if (!(num(line.quantity) > 0)) out.push('Quantity must be at least 1.');
  if (num(line.unit_price) < 0) out.push('A price cannot be negative.');
  return out;
}

/* -- what the contract should say the ad type is ----------------------- */

/**
 * The ad-type value the campaign screen stores when a booking carries SEVERAL
 * types. It is a sentinel, not a service anybody sells: the real list goes in
 * `ad_type_custom` beside it.
 *
 * Defined here rather than in hooks/use-workflow, because the rule that reads
 * it is pure and belongs where it can be tested. use-workflow re-exports this
 * one so every existing import keeps working and the two cannot drift.
 */
export const AD_TYPE_NEEDS_DETAIL = 'Multi Service';

/**
 * The ad type a vendor contract should print.
 *
 * -- THE THREE BUGS THIS REPLACES -------------------------------------
 *
 * Siraj: "ad type isnt automatic for some reason".
 *
 * 1. THE GATE WAS `lines.length`, NOT "any line says what it is".
 *    A booking can have ad lines with no ad_type on them - the quantity and
 *    the price are what the operator came for. `groupByAdType` defaults an
 *    empty type to the word "Ad", so a booking with three blank lines made
 *    the contract read "3 \u00d7 Ad" and the type picked on the booking, sitting
 *    right there on the screen, was thrown away. Note the UI already gets
 *    this right - `adTypesFromAds` checks `types.length > 0` - so the screen
 *    showed the picked value as live and editable while the contract builder
 *    ignored it.
 *
 * 2. `ad_type_custom` HAD NO READER anywhere in the app. A booking with
 *    several types stores the sentinel plus the real list; the contract read
 *    only the sentinel and printed the literal words "Multi Service" at the
 *    vendor.
 *
 * 3. Neither was visible from the screen, because both produce a plausible
 *    string rather than a blank.
 *
 * The order is: what was actually booked, then what was picked, then nothing.
 * Pure.
 */
export function contractAdType(
  lines: AdLine[] | null | undefined,
  picked?: string | null,
  pickedDetail?: string | null,
): string {
  // Only lines that SAY what they are. A line with a blank type carries no
  // opinion, and letting it vote means "Ad" wins over a real answer.
  const typed = (lines || []).filter((l) => txt(l.ad_type));
  if (typed.length) return adTypeSummary(typed);

  const p = txt(picked) || '';
  if (p === AD_TYPE_NEEDS_DETAIL) return txt(pickedDetail) || '';
  return p;
}
