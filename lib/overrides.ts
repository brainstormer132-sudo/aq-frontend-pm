/**
 * Passing a rule, on purpose, with your name on it.
 *
 * Siraj: "if rules want to be passed for example mark a vendor complete
 * without a contract(based on the vendor) resaults in a password type screen
 * to overpass and these overhaul will be counted per person and tracked in
 * the log" - and, asked whether that was only the contract rule: "it should
 * also go for all rules like sales sending to marketing without all info
 * every rule can be bypassed but will be documented".
 *
 * -- THE BARGAIN --------------------------------------------------------
 *
 * EVERY rule can be passed. None of them is a wall. What a rule buys is not
 * prevention - somebody with a deadline will always find a way round, and
 * the way round is usually worse than the thing the rule forbade. What it
 * buys is a RECORD: the person, the reason, the thing, the minute.
 *
 * That is why the reason is required and has a floor under it, and why a
 * refused attempt is logged exactly like a successful one. A log with only
 * the successes in it cannot tell you somebody spent ten minutes guessing.
 *
 * -- WHAT IS NOT IN THIS FILE -------------------------------------------
 *
 * THE CODE IS NEVER COMPARED HERE. `codeShapeError` checks that somebody
 * typed something long enough to be worth sending, and nothing else. The
 * comparison happens in the database, against a hash, inside a function that
 * rate-limits and logs - see migration 124. A client-side check of a shared
 * secret is a check the client can skip.
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

/**
 * A rule somebody can be stopped by.
 *
 * `blocked` is what the person reads at the moment they are stopped, so it
 * says what is wrong with THIS thing, not what the rule is called. `why`
 * is the one line that justifies the rule's existence, shown under the
 * override box - somebody about to pass a rule should be able to see what
 * they are taking on.
 */
export interface RuleDef {
  key: string;
  label: string;
  blocked: string;
  why: string;
  /**
   * Whether the override code can open this one YET.
   *
   * Not a policy - Siraj's instruction is that every rule can be passed. It
   * is a statement of fact about what is wired, so the Settings card can say
   * what the code actually opens instead of promising two rules and
   * delivering one. A rule listed here but not routed through the gate is a
   * rule somebody will hand the code out for and then find they still cannot
   * pass.
   */
  passable: boolean;
}

/**
 * The rules, as data.
 *
 * ONLY RULES THAT ARE ACTUALLY ENFORCED GO IN HERE. A registry that lists a
 * rule nothing checks is a promise the app does not keep, and the log will
 * never show a single entry against it - which reads as "nobody ever breaks
 * that one" rather than "nothing ever asks".
 */
export const RULES: RuleDef[] = [
  {
    key: 'booking_complete_without_contract',
    label: 'A finished booking needs a contract',
    blocked: 'This booking has no contract, so it cannot be marked complete.',
    why: 'A vendor who has worked and been paid with nothing signed is the'
      + ' position with no way back. Categories that never have a contract can'
      + ' be excused in Settings instead of passed here.',
    passable: true,
  },
  {
    key: 'contract_request_incomplete',
    label: 'A contract request needs its details',
    blocked: 'Some of what the contract needs is still missing.',
    why: 'Every missing field here comes out blank on the paper somebody'
      + ' signs, and the values freeze the moment it is issued - so passing'
      + ' this sends the request to legal for them to judge, not to the vendor.',
    // Siraj, asked whether this one should be passable: "yes details should be
    // passable the legal needs to see the details to understand if the details
    // are right or not".
    //
    // Which is the argument this file was missing. The rule was written as
    // though the app could tell a missing field from an acceptable one, and it
    // cannot: a vendor with no licence number may be a category that has none,
    // and a fee left blank may be a favour. Blocking at the REQUEST stage does
    // not prevent a bad contract - it prevents the one person qualified to
    // spot one from ever seeing it.
    //
    // So it opens, and what comes out the other side is a request in legal's
    // queue with the gaps visible and a logged reason for why it was sent
    // anyway. Nothing is issued by passing this.
    passable: true,
  },
  {
    key: 'campaign_to_marketing_incomplete',
    label: 'A campaign needs its budget and its brief',
    blocked: 'This campaign is going to marketing without everything it needs.',
    why: 'Marketing triages against the budget and the brief - service type,'
      + ' priority, who works on it. Without them the campaign is either'
      + ' guessed at or parked until somebody chases sales, and the chasing'
      + ' happens days later. Passing this sends it anyway, with the gap'
      + ' visible on the campaign and your name against it.',
    // The client and the brand are NOT in this rule. They are foreign keys
    // everything downstream hangs off, not judgement calls, and
    // campaignBlockers refuses them where nothing can pass.
    passable: true,
  },
];

const BY_KEY = new Map(RULES.map((r) => [r.key, r]));

export function ruleByKey(key: unknown): RuleDef | null {
  return BY_KEY.get(String(key ?? '').trim()) ?? null;
}

/** The rules the code actually opens today. What the Settings card lists. */
export function passableRules(): RuleDef[] {
  return RULES.filter((r) => r.passable);
}

/**
 * What to call a rule on screen.
 *
 * An unknown key renders AS THE KEY, never as blank and never as "Unknown".
 * The log outlives the registry: a rule that is retired next year still has
 * its entries, and a row reading "-" in the rule column is a row nobody can
 * account for.
 */
export function ruleLabel(key: unknown): string {
  const k = String(key ?? '').trim();
  return ruleByKey(k)?.label ?? (k || '(no rule named)');
}

/** The floor on a reason. Twelve, not ten: "urgent" and "Siraj said" are
 *  both things people type when there is no floor, and neither tells the
 *  next reader anything. */
export const REASON_MIN = 12;
export const REASON_MAX = 500;

/** Why this reason will not do, or null when it will. */
export function reasonError(reason: unknown): string | null {
  const r = String(reason ?? '').trim();
  if (!r) return 'Say why you are passing this. It goes in the log with your name.';
  if (r.length < REASON_MIN) {
    return `A few more words - ${REASON_MIN} characters at least. Somebody will read this later.`;
  }
  if (r.length > REASON_MAX) return `That is ${r.length} characters. Keep it under ${REASON_MAX}.`;
  return null;
}

/** Trimmed, with inner runs of whitespace collapsed. */
export function normaliseReason(reason: unknown): string {
  return String(reason ?? '').replace(/\s+/g, ' ').trim();
}

/** The shortest code worth setting. Short enough to say over a phone, long
 *  enough that the rate limit in 124 has something to protect. */
export const CODE_MIN = 6;
export const CODE_MAX = 64;

/**
 * Whether what was typed is the SHAPE of a code - not whether it is the
 * code. See the header: the comparison is the database's job.
 */
export function codeShapeError(code: unknown): string | null {
  const c = String(code ?? '');
  if (!c.trim()) return 'Enter the override code.';
  if (c.length < CODE_MIN) return 'That is too short to be the code.';
  if (c.length > CODE_MAX) return 'That is too long to be the code.';
  return null;
}

/** A row of the log. `passed` false is a refused attempt, kept on purpose. */
export interface OverrideRow {
  id: string;
  rule_key?: string | null;
  entity_kind?: string | null;
  entity_id?: string | null;
  /** What the thing was CALLED at the time. Names change; a log that
   *  resolves them live tells you today's name for yesterday's decision. */
  entity_name?: string | null;
  actor?: string | null;
  actor_name?: string | null;
  reason?: string | null;
  passed?: boolean | null;
  created_at?: string | null;
}

/** Who somebody is, on a line. Never blank: an unnamed actor is a fact, and
 *  an empty cell reads as a rendering bug. */
export function actorLabel(row: OverrideRow): string {
  const n = String(row?.actor_name ?? '').trim();
  if (n) return n;
  return String(row?.actor ?? '').trim() ? 'somebody without a name on file' : 'nobody we can name';
}

export interface OverrideTally {
  passed: number;
  refused: number;
  people: number;
}

export function overrideTally(rows: OverrideRow[]): OverrideTally {
  let passed = 0;
  let refused = 0;
  const who = new Set<string>();
  for (const r of rows ?? []) {
    if (r?.passed) passed += 1; else refused += 1;
    const a = String(r?.actor ?? '').trim();
    if (a && r?.passed) who.add(a);
  }
  return { passed, refused, people: who.size };
}

export interface PersonCount {
  actor: string;
  name: string;
  passed: number;
  refused: number;
  last: string;
}

/**
 * Counted per person - the thing Siraj asked for by name.
 *
 * Most passes first, then most recent. Somebody who passes a rule twice a
 * week is the signal; somebody who did it once in March is not, and sorting
 * by date alone buries the first under the second.
 *
 * Rows with no actor are folded into ONE line rather than dropped. A pass
 * nobody can be named for still happened, and dropping it makes the totals
 * on this screen disagree with the totals above it.
 */
export function byPerson(rows: OverrideRow[]): PersonCount[] {
  const acc = new Map<string, PersonCount>();
  for (const r of rows ?? []) {
    const actor = String(r?.actor ?? '').trim() || '(unnamed)';
    let cur = acc.get(actor);
    if (!cur) {
      cur = { actor, name: actorLabel(r), passed: 0, refused: 0, last: '' };
      acc.set(actor, cur);
    }
    if (r?.passed) cur.passed += 1; else cur.refused += 1;
    const at = String(r?.created_at ?? '');
    if (at > cur.last) cur.last = at;
    // A later row may carry a name where an earlier one did not.
    if (cur.name.startsWith('somebody') || cur.name.startsWith('nobody')) {
      const n = String(r?.actor_name ?? '').trim();
      if (n) cur.name = n;
    }
  }
  return Array.from(acc.values()).sort((a, b) => (b.passed - a.passed)
    || b.last.localeCompare(a.last)
    || a.actor.localeCompare(b.actor));
}

export interface RuleCount {
  key: string;
  label: string;
  passed: number;
  refused: number;
}

/** Group before you cap: which rules are being passed, most first. Five
 *  hundred rows of the same rule are one fact. */
export function byRule(rows: OverrideRow[]): RuleCount[] {
  const acc = new Map<string, RuleCount>();
  for (const r of rows ?? []) {
    const key = String(r?.rule_key ?? '').trim() || '(none)';
    let cur = acc.get(key);
    if (!cur) { cur = { key, label: ruleLabel(key), passed: 0, refused: 0 }; acc.set(key, cur); }
    if (r?.passed) cur.passed += 1; else cur.refused += 1;
  }
  return Array.from(acc.values()).sort((a, b) => (b.passed - a.passed)
    || (b.refused - a.refused)
    || a.key.localeCompare(b.key));
}

/** Newest first. This is a log; a log is read from the top. */
export function sortOverrides<T extends OverrideRow>(rows: T[]): T[] {
  return (rows ?? []).slice().sort((a, b) =>
    String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))
    || String(a.id).localeCompare(String(b.id)));
}

/** Search over the words somebody would actually remember: the reason, the
 *  thing, the person, the rule. */
export function filterOverrides<T extends OverrideRow>(rows: T[], q: string): T[] {
  const needle = String(q ?? '').trim().toLowerCase();
  if (!needle) return (rows ?? []).slice();
  return (rows ?? []).filter((r) => [
    r.reason, r.entity_name, r.entity_id, r.actor_name, r.rule_key, ruleLabel(r.rule_key),
  ].some((v) => String(v ?? '').toLowerCase().includes(needle)));
}

/* ===================================================================
   THE RULES THEMSELVES
   =================================================================== */

/**
 * Whether marking this booking done is blocked by the contract rule, as the
 * sentence somebody reads - or null when it is not blocked at all.
 *
 * -- WHY THE STATUS IS AN ARGUMENT ----------------------------------
 *
 * The rule is about COMPLETING a booking, not about a booking. Putting one on
 * hold, cancelling it, or moving it back to pending are all fine with no
 * contract, and a rule that fired on every status change would be a rule
 * people learn to click through.
 *
 * `cancelled` is deliberately not blocked. A booking that never happened owes
 * nobody a contract, and blocking the tidy-up is how a campaign ends with six
 * live bookings nobody did.
 *
 * -- WHY THE EXEMPTION COMES IN AS A VALUE --------------------------
 *
 * From vendor_categories.requires_contract (125). UNDEFINED READS AS
 * REQUIRED, matching lib/settings: a row fetched before that migration ran
 * carries no such field, and reading its absence as "excused" would turn the
 * rule off everywhere at exactly the moment nobody would notice.
 */
export function bookingContractGap(input: {
  /** The status the booking is being moved TO. */
  nextStatus?: unknown;
  /** The contract request raised from this booking, if any. */
  contractRequestId?: unknown;
  /** A contract in the legal register against this booking, if the caller
   *  has looked. Either one counts - a contract is a contract. */
  contractId?: unknown;
  /** vendor_categories.requires_contract. Undefined means required. */
  categoryRequiresContract?: unknown;
  /** For the sentence. */
  vendorName?: unknown;
}): string | null {
  if (String(input?.nextStatus ?? '').trim().toLowerCase() !== 'done') return null;
  if (input?.categoryRequiresContract === false) return null;
  if (String(input?.contractRequestId ?? '').trim()) return null;
  if (String(input?.contractId ?? '').trim()) return null;

  const who = String(input?.vendorName ?? '').trim();
  return who
    ? `${who} has no contract on this booking.`
    : 'This booking has no contract.';
}

/**
 * The heading. One sentence with the numbers in it, so the screen says
 * something before anybody scrolls.
 */
export function overrideSummary(rows: OverrideRow[]): string {
  const t = overrideTally(rows);
  if (!t.passed && !t.refused) return 'No rule has been passed.';
  if (!t.passed) {
    return t.refused === 1
      ? 'One attempt was refused, and no rule has been passed.'
      : `${t.refused} attempts were refused, and no rule has been passed.`;
  }
  const head = t.passed === 1 ? '1 rule passed' : `${t.passed} rules passed`;
  const by = t.people === 1 ? 'by 1 person' : `by ${t.people} people`;
  const tail = t.refused
    ? `, and ${t.refused} attempt${t.refused === 1 ? '' : 's'} refused`
    : '';
  return `${head} ${by}${tail}.`;
}
