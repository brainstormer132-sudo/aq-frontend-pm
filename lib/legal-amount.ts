/**
 * An amount, written the way a contract writes one.
 *
 * Siraj: "next to the 500 the (500) needs brackets and then after also in
 * brakets (five hundred) and then riyal".
 *
 * That is the Saudi contract convention and it exists for a reason older than
 * any of this: a figure can be altered with a pen, and the words next to it
 * cannot. So the amount prints as the digits in brackets, the same amount
 * spelled out in brackets, then the currency:
 *
 *     (500.00) (\u062e\u0645\u0633\u0645\u0627\u0626\u0629 \u0631\u064a\u0627\u0644) \u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a
 *
 * Pure: no React, no Supabase, no argless `new Date()`.
 */

/* -- Arabic numerals in words ------------------------------------------ */

const ONES = ['', '\u0648\u0627\u062d\u062f', '\u0627\u062b\u0646\u0627\u0646', '\u062b\u0644\u0627\u062b\u0629', '\u0623\u0631\u0628\u0639\u0629',
  '\u062e\u0645\u0633\u0629', '\u0633\u062a\u0629', '\u0633\u0628\u0639\u0629', '\u062b\u0645\u0627\u0646\u064a\u0629', '\u062a\u0633\u0639\u0629'];

const TEENS = ['\u0639\u0634\u0631\u0629', '\u0623\u062d\u062f \u0639\u0634\u0631', '\u0627\u062b\u0646\u0627 \u0639\u0634\u0631', '\u062b\u0644\u0627\u062b\u0629 \u0639\u0634\u0631',
  '\u0623\u0631\u0628\u0639\u0629 \u0639\u0634\u0631', '\u062e\u0645\u0633\u0629 \u0639\u0634\u0631', '\u0633\u062a\u0629 \u0639\u0634\u0631', '\u0633\u0628\u0639\u0629 \u0639\u0634\u0631',
  '\u062b\u0645\u0627\u0646\u064a\u0629 \u0639\u0634\u0631', '\u062a\u0633\u0639\u0629 \u0639\u0634\u0631'];

const TENS = ['', '', '\u0639\u0634\u0631\u0648\u0646', '\u062b\u0644\u0627\u062b\u0648\u0646', '\u0623\u0631\u0628\u0639\u0648\u0646',
  '\u062e\u0645\u0633\u0648\u0646', '\u0633\u062a\u0648\u0646', '\u0633\u0628\u0639\u0648\u0646', '\u062b\u0645\u0627\u0646\u0648\u0646', '\u062a\u0633\u0639\u0648\u0646'];

const HUNDREDS = ['', '\u0645\u0627\u0626\u0629', '\u0645\u0627\u0626\u062a\u0627\u0646', '\u062b\u0644\u0627\u062b\u0645\u0627\u0626\u0629', '\u0623\u0631\u0628\u0639\u0645\u0627\u0626\u0629',
  '\u062e\u0645\u0633\u0645\u0627\u0626\u0629', '\u0633\u062a\u0645\u0627\u0626\u0629', '\u0633\u0628\u0639\u0645\u0627\u0626\u0629', '\u062b\u0645\u0627\u0646\u0645\u0627\u0626\u0629', '\u062a\u0633\u0639\u0645\u0627\u0626\u0629'];

const AND = ' \u0648';

/** 1..999 in words. */
function underThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest) {
    if (rest < 10) parts.push(ONES[rest]);
    else if (rest < 20) parts.push(TEENS[rest - 10]);
    else {
      const t = Math.floor(rest / 10);
      const o = rest % 10;
      // Arabic says the unit FIRST: twenty-five is "five and twenty".
      parts.push(o ? `${ONES[o]}${AND}${TENS[t]}` : TENS[t]);
    }
  }
  return parts.join(AND);
}

/**
 * The scale words, each with its dual and its plural, because Arabic counts
 * one, two, a few and many differently and a contract that says
 * "\u0648\u0627\u062d\u062f \u0623\u0644\u0641" instead of "\u0623\u0644\u0641" reads as though nobody checked it.
 */
const SCALES: { one: string; two: string; few: string; many: string }[] = [
  { one: '', two: '', few: '', many: '' },
  { one: '\u0623\u0644\u0641', two: '\u0623\u0644\u0641\u0627\u0646', few: '\u0622\u0644\u0627\u0641', many: '\u0623\u0644\u0641' },
  { one: '\u0645\u0644\u064a\u0648\u0646', two: '\u0645\u0644\u064a\u0648\u0646\u0627\u0646', few: '\u0645\u0644\u0627\u064a\u064a\u0646', many: '\u0645\u0644\u064a\u0648\u0646' },
  { one: '\u0645\u0644\u064a\u0627\u0631', two: '\u0645\u0644\u064a\u0627\u0631\u0627\u0646', few: '\u0645\u0644\u064a\u0627\u0631\u0627\u062a', many: '\u0645\u0644\u064a\u0627\u0631' },
];

function scaleWord(group: number, level: number): string {
  const s = SCALES[level];
  if (!s || !s.one) return '';
  if (group === 1) return s.one;
  if (group === 2) return s.two;
  if (group >= 3 && group <= 10) return `${s.few}`;
  return s.many;
}

/**
 * A whole number in Arabic words. Returns '' for zero, because "zero riyals"
 * is not a thing a contract says - the caller decides what to do with it.
 *
 * Handles up to 999,999,999,999, which is more than a marketing contract will
 * ever carry and costs nothing to support.
 */
export function arabicNumberWords(n: number): string {
  const v = Math.floor(Math.abs(Number(n) || 0));
  if (v === 0) return '';
  // Split into groups of three, least significant first.
  const groups: number[] = [];
  let rest = v;
  while (rest > 0) { groups.push(rest % 1000); rest = Math.floor(rest / 1000); }
  if (groups.length > SCALES.length) return '';
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i];
    if (!g) continue;
    const w = scaleWord(g, i);
    if (i === 0) out.push(underThousand(g));
    else if (g === 1 || g === 2) out.push(w);
    // 3..10 take the plural and the number before it; 11+ take the singular.
    else out.push(`${underThousand(g)} ${w}`);
  }
  return out.join(AND);
}

/* -- the amount as a contract writes it --------------------------------- */

export const RIYAL = '\u0631\u064a\u0627\u0644';
export const HALALA = '\u0647\u0644\u0644\u0629';

/**
 * Parse whatever was typed into riyals and halalas.
 *
 * Accepts "500", "500.00", "1,250.50" and Arabic-Indic digits, because the
 * value comes from a person typing into a box and not from an API.
 */
export function parseAmount(raw: string | number): { riyals: number; halalas: number } | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  // Arabic-Indic and Eastern Arabic-Indic digits to ASCII.
  s = s.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,\u066c\s]/g, '')
    .replace(/[\u066b]/g, '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const riyals = Math.floor(n);
  const halalas = Math.round((n - riyals) * 100);
  return { riyals, halalas };
}

/** A whole number with thousands separators, without Intl. 1234 -> "1,234". */
function groupThousands(n: number): string {
  const v = Math.trunc(Math.abs(Number(n) || 0));
  const digits = String(v);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return `${Number(n) < 0 ? '-' : ''}${out}`;
}

/** The digits, grouped, always with two decimals. "1250.5" -> "1,250.50" */
export function amountDigits(raw: string | number): string {
  const a = parseAmount(raw);
  if (!a) return String(raw ?? '').trim();
  // Hand-grouped, not toLocaleString. This file's header claims purity and an
  // Intl call is not pure - it reads the environment's locale data. The digits
  // on a contract must not depend on which machine printed it, which is the
  // same reason generatedOn stopped using toLocaleDateString.
  return `${groupThousands(a.riyals)}.${String(a.halalas).padStart(2, '0')}`;
}

/**
 * The amount as it belongs on a Saudi contract:
 *
 *     (500.00) (\u062e\u0645\u0633\u0645\u0627\u0626\u0629) \u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a
 *
 * Digits first, the same amount in words beside it, then the currency. The
 * words are what make the figure hard to alter, which is the whole reason the
 * convention exists.
 *
 * Anything that is not a number is returned UNCHANGED. A template field can
 * hold "to be agreed" and a contract that turned that into "(0) (zero)" would
 * be worse than one that left it alone.
 */
export function amountInWords(raw: string | number): string {
  const a = parseAmount(raw);
  if (!a) return String(raw ?? '').trim();
  const digits = amountDigits(raw);
  // The currency is NOT repeated inside the brackets. Siraj: "remove riyal
  // from the word is just need (five hundred)". It reads once, after the
  // brackets - saying it twice is what made the line look padded.
  const words: string[] = [];
  const r = arabicNumberWords(a.riyals);
  if (r) words.push(r);
  if (a.halalas) {
    const h = arabicNumberWords(a.halalas);
    if (h) words.push(`${h} ${HALALA}`);
  }
  // Zero with no halalas: the figure still prints, the words say nothing.
  const spelled = words.join(AND);
  return spelled
    ? `(${digits}) (${spelled}) ${RIYAL} \u0633\u0639\u0648\u062f\u064a`
    : `(${digits}) ${RIYAL} \u0633\u0639\u0648\u062f\u064a`;
}

/**
 * Which template fields hold money.
 *
 * Same shape as QTY_KEYS in legal-prefill: one named list, in one file, so a
 * behaviour that depends on a field's MEANING is not spelled out at three
 * call sites that then drift. `Amount_full` is what the UGC template has
 * called its fee since the first seed.
 *
 * A field named here prints as "(figure) (words) riyal" wherever it appears -
 * in the wording, in a detail line, in a table cell. Everything else prints
 * exactly as typed.
 */
export const AMOUNT_KEYS: string[] = ['Amount_full'];

export function isAmountKey(k: string): boolean {
  return AMOUNT_KEYS.includes(String(k ?? ''));
}
