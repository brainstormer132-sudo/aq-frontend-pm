/**
 * What a vendor contract needs, and how many contracts a booking becomes.
 *
 * Pure, because both questions are rules rather than data. A readiness check
 * that lives inside a hook can only be exercised by clicking, and the cost of
 * getting it wrong is a contract that goes to Legal missing the one field
 * they need, or a booking that sits blocked on a field nobody can supply.
 *
 * ── What changed, and why ─────────────────────────────────────────
 *
 * Siraj: *"vendor contracts dont need a signatory name just the name in the
 * license id brand name the first and last name and the platform the name in
 * the platform the ad type and the bank info payment and payment terms which
 * can all be found in the task"*.
 *
 * Signatory name was the blocker. It is a company idea — the person
 * authorised to bind a legal entity — and an influencer is not a company.
 * Nothing in the vendor registration ever filled it, so every vendor
 * contract failed its readiness check on a field that had no source, and the
 * "Ask for all the ready ones" button had nothing to send.
 *
 * The set below replaces it with the eight things a vendor contract actually
 * states, every one of which is already somewhere in the task:
 *
 *   1. the name on the licence or ID   → the vendor record, and its number
 *   2. the brand                        → the campaign
 *   3. first and last name              → the vendor's contact
 *   4. the platform                     → the booking, or its ads
 *   5. their name on that platform      → the vendor's profile
 *   6. the ad type                      → the booking, or its ads
 *   7. bank info                        → the vendor's bank account
 *   8. payment, and payment terms       → the booking
 *
 * Nothing new to type. If a check here fails, the fix is a field somebody
 * skipped, not a field that does not exist.
 */

export interface Missing {
  /** What's missing, in the user's words. */
  label: string;
  /** Where they go to fill it in. */
  where: string;
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function has(v: unknown): boolean {
  return txt(v).length > 0;
}

export interface VendorContractInput {
  /** The booking. */
  booking: {
    platform?: unknown;
    ad_type?: unknown;
    brand_name?: unknown;
    payment_terms?: unknown;
    payment_split_pct?: unknown;
    payment_net_days?: unknown;
  } | null;
  /** The campaign above it — where the brand usually lives. */
  campaign?: { brand_name?: unknown } | null;
  vendor: {
    name?: unknown;
    contact_name?: unknown;
    /** Their handle or profile — "the name in the platform". */
    platforms?: unknown;
  } | null;
  /** Licence or ID, already resolved by the caller — they know the category. */
  identifier: { kind: 'license' | 'id'; value: string | null };
  bank: { iban?: unknown } | null;
  /** What the vendor is owed. Null when nobody has priced the booking. */
  amount: number | null;
  /**
   * Whether this vendor posts. A van rental has no Instagram handle, and
   * asking for one blocks a contract that never needed it.
   */
  posts: boolean;
  /** Ad types and platforms from the ads, which outrank the booking's own. */
  adTypes?: string[];
  platformList?: string[];
}

/**
 * Everything still missing before Legal can draft this one.
 *
 * The order is the order somebody would fix them in: the vendor first,
 * because half the rest hangs off the vendor record.
 */
export function vendorContractNeeds(input: VendorContractInput): Missing[] {
  const out: Missing[] = [];
  const { booking, campaign, vendor, identifier, bank, amount, posts } = input;

  if (!booking) return [{ label: 'A vendor booking', where: '' }];
  if (!vendor) return [{ label: 'Vendor', where: 'this booking' }];

  const onVendor = `Vendors → ${txt(vendor.name) || 'this vendor'}`;

  // 1. The name on the licence or ID, and the number itself.
  if (!has(vendor.name)) out.push({ label: 'Name on the licence or ID', where: onVendor });
  if (!identifier.value) {
    out.push({
      label: identifier.kind === 'license' ? 'Licence number' : 'ID number',
      where: onVendor,
    });
  }

  // 3. The person. `contact_name` is where the vendor form puts a human
  //    being; `name` may be a trading name, and a contract signed by a
  //    trading name is not signed by anybody.
  if (!has(vendor.contact_name)) {
    out.push({ label: 'First and last name', where: onVendor });
  }

  // 2. The brand the work is for. The campaign holds it; a booking may
  //    override it, and either will do.
  if (!has(booking.brand_name) && !has(campaign?.brand_name)) {
    out.push({ label: 'Brand name', where: 'the campaign' });
  }

  // 4, 5 and 6. The ads answer 4 and 6 when they carry them — a booking with
  //    a Home Ad on TikTok and a Store Visit on Instagram has both, and the
  //    booking's own single fields cannot say so.
  const adTypes = (input.adTypes ?? []).filter(has);
  const platforms = (input.platformList ?? []).filter(has);

  if (!adTypes.length && !has(booking.ad_type)) {
    out.push({ label: 'Ad type', where: 'this booking' });
  }
  if (posts) {
    if (!platforms.length && !has(booking.platform)) {
      out.push({ label: 'Platform', where: 'this booking' });
    }
    if (!has(vendor.platforms)) {
      out.push({ label: 'Their name on the platform', where: onVendor });
    }
  }

  // 7. Where the money goes. A bank name without an IBAN is not payable.
  if (!bank) out.push({ label: 'Bank account', where: onVendor });
  else if (!has(bank.iban)) out.push({ label: 'IBAN', where: onVendor });

  // 8. The money, and when it is due. Terms are not a nicety: "50% up front"
  //    is half the agreement, and a contract that omits it is renegotiated
  //    by whoever is chased for payment first.
  if (amount == null || !(amount > 0)) {
    out.push({ label: 'Price, or at least one ad line', where: 'this booking' });
  }
  if (!has(booking.payment_terms)) {
    out.push({ label: 'Payment terms', where: 'this booking' });
  } else if (txt(booking.payment_terms) === 'split' && !Number(booking.payment_split_pct)) {
    out.push({ label: 'How much is paid up front', where: 'this booking' });
  } else if (txt(booking.payment_terms) === 'net_days' && !Number(booking.payment_net_days)) {
    out.push({ label: 'How many days after delivery', where: 'this booking' });
  }

  return out;
}

/* ── One contract, or several ────────────────────────────────────── */

/**
 * Siraj: *"vendor contract should be requested all combined to one contract
 * or multiple contract based on the vendor lines"*.
 *
 * `combined` is one agreement covering everything the vendor is booked for
 * — the normal case, and what the app did before this existed.
 *
 * `per-line` is one agreement per ad line. His words were "based on the
 * vendor lines", and a line is already the unit people think in: a line is
 * "6 × Home Ad on TikTok", so six identical reels stay one contract while a
 * Home Ad in March and a Store Visit in June become two. Splitting per
 * individual ad instead would produce twelve contracts for a twelve-piece
 * package, which is nobody's intent.
 */
export type SplitMode = 'combined' | 'per-line';

export interface ContractGroup {
  /** A stable key for React, and for matching a group to what it produced. */
  key: string;
  /** The ad lines this contract would cover. */
  lineIds: string[];
  /** What the contract is for, in the user's words. */
  label: string;
  /** What the vendor is owed under it. */
  amount: number;
  /** How many ads, counting quantities. */
  ads: number;
}

export interface PlanLine {
  id?: unknown;
  ad_type?: unknown;
  platform?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  line_total?: unknown;
}

function qty(l: PlanLine): number {
  const n = Number(l.quantity);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function total(l: PlanLine): number {
  const stored = Number(l.line_total);
  if (l.line_total != null && Number.isFinite(stored)) return stored;
  const unit = Number(l.unit_price);
  return qty(l) * (Number.isFinite(unit) ? unit : 0);
}

/** What a line is called on a contract: `6 × Home Ad on TikTok`. */
export function lineLabel(l: PlanLine): string {
  const type = txt(l.ad_type) || 'Ad';
  const platform = txt(l.platform);
  const n = qty(l);
  const head = n > 1 ? `${n} × ${type}` : type;
  return platform ? `${head} on ${platform}` : head;
}

/**
 * The contracts a booking would become, under the chosen mode.
 *
 * A booking with no ad lines is one contract either way — there is nothing
 * to split, and returning nothing would mean the split option silently sent
 * no contract at all.
 */
export function contractPlan(
  lines: PlanLine[],
  mode: SplitMode,
  fallbackLabel = 'The whole booking',
): ContractGroup[] {
  const all = lines ?? [];

  if (mode === 'combined' || all.length <= 1) {
    const ids = all.map((l) => txt(l.id)).filter(Boolean);
    const label = all.length === 1
      ? lineLabel(all[0])
      : all.length
        ? `${all.length} lines · ${all.map(lineLabel).join(', ')}`
        : fallbackLabel;
    return [{
      key: 'all',
      lineIds: ids,
      label,
      amount: all.reduce((s, l) => s + total(l), 0),
      ads: all.reduce((s, l) => s + qty(l), 0),
    }];
  }

  return all.map((l, i) => ({
    key: txt(l.id) || `line-${i}`,
    lineIds: [txt(l.id)].filter(Boolean),
    label: lineLabel(l),
    amount: total(l),
    ads: qty(l),
  }));
}

/**
 * The sentence on the button, so nobody has to count.
 *
 * Named for what will actually happen — the ask-all button already learned
 * this lesson: reporting a number after the fact left people guessing which
 * vendors were skipped.
 */
export function planSentence(groups: ContractGroup[]): string {
  if (!groups.length) return 'Nothing to contract.';
  if (groups.length === 1) return 'One contract, covering everything booked.';
  return `${groups.length} separate contracts, one per line.`;
}

/* ── How much of a booking is actually under contract ────────────── */

export interface Coverage {
  /** Ads with a contract behind them, counting quantities. */
  covered: number;
  /** Ads with none. */
  uncovered: number;
  /** How many separate contracts cover this booking. */
  contracts: number;
  /** True when every ad is covered — and there is at least one ad. */
  complete: boolean;
  /** The half-way state the old one-per-booking link could not express. */
  partial: boolean;
}

/**
 * Read from the ads, not the booking.
 *
 * Before 070 a booking pointed at one contract and that was the whole story,
 * so a vendor whose March ads were contracted and whose June ads were not
 * read as "contract signed". Counting the ads is the only way to say it.
 */
export function contractCoverage(
  lines: (PlanLine & { contract_request_id?: unknown })[],
): Coverage {
  let covered = 0, uncovered = 0;
  const requests = new Set<string>();
  for (const l of lines ?? []) {
    const req = txt(l.contract_request_id);
    if (req) { covered += qty(l); requests.add(req); }
    else uncovered += qty(l);
  }
  return {
    covered,
    uncovered,
    contracts: requests.size,
    complete: covered > 0 && uncovered === 0,
    partial: covered > 0 && uncovered > 0,
  };
}
