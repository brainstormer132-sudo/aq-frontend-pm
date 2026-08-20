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
}

function txt(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function num(v: number | null | undefined): number {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? n : 0;
}

export function lineTotal(line: AdLine): number {
  if (line.line_total != null && Number.isFinite(Number(line.line_total))) {
    return Number(line.line_total);
  }
  return num(line.quantity) * num(line.unit_price);
}

export interface AdLineTotals {
  /** How many ads, counting quantities — 6 home + 6 store = 12. */
  ads: number;
  /** What the vendor is owed for all of them. */
  amount: number;
  /** Lines that cost nothing. Worth naming, because people forget them. */
  freeLines: number;
}

export function totalsOf(lines: AdLine[]): AdLineTotals {
  let ads = 0, amount = 0, freeLines = 0;
  for (const l of lines || []) {
    ads += num(l.quantity);
    const t = lineTotal(l);
    amount += t;
    if (t === 0) freeLines += 1;
  }
  return { ads, amount, freeLines };
}

export interface AdTypeGroup { ad_type: string; quantity: number; amount: number }

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
    if (!acc.has(key)) { acc.set(key, { ad_type: key, quantity: 0, amount: 0 }); order.push(key); }
    const g = acc.get(key)!;
    g.quantity += num(l.quantity);
    g.amount += lineTotal(l);
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
 * The itemisation, written once, for the contract's details.
 *
 * Free lines are marked "no charge" rather than "SAR 0", because a zero in a
 * price column reads like a mistake and an explicit "no charge" reads like a
 * decision — which is what it is.
 */
export function contractDetails(lines: AdLine[], header?: string | null): string {
  const groups = groupByAdType(lines);
  if (!groups.length) return txt(header);

  const body = groups.map((g) => {
    const each = g.quantity > 0 ? g.amount / g.quantity : 0;
    const price = g.amount === 0
      ? 'no charge'
      : `${money(each)} each · ${money(g.amount)}`;
    return `${g.quantity} × ${g.ad_type} — ${price}`;
  });

  const { amount, ads } = totalsOf(lines);
  const head = txt(header);
  return [
    head,
    head ? '' : null,
    ...body,
    '',
    `Total: ${ads} ad${ads === 1 ? '' : 's'} · ${money(amount)}`,
  ].filter((l) => l !== null).join('\n').trim();
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

/** What is still wrong with a line, in words. Empty means it can be saved. */
export function lineProblems(line: AdLine): string[] {
  const out: string[] = [];
  if (!txt(line.ad_type)) out.push('Give the line an ad type.');
  if (!(num(line.quantity) > 0)) out.push('Quantity must be at least 1.');
  if (num(line.unit_price) < 0) out.push('A price cannot be negative.');
  return out;
}
