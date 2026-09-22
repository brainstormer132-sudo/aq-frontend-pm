/**
 * An amount, written the way a Saudi contract writes one.
 *
 * Siraj: "next to the 500 the (500) needs brackets and then after also in
 * brakets (five hundred) and then riyal".
 *
 * The convention is older than this app: a figure can be altered with a pen
 * and the words beside it cannot. So what is worth protecting is:
 *
 *   1. THE WORDS MATCH THE FIGURE. Always. That is the entire point.
 *   2. ARABIC COUNTS DIFFERENTLY. The unit comes before the ten, and one,
 *      two, three-to-ten and eleven-plus each take a different scale word.
 *   3. SOMETHING THAT IS NOT A NUMBER IS LEFT ALONE. A field holding
 *      "to be agreed" must not become "(0) (zero)".
 */
import {
  arabicNumberWords, parseAmount, amountDigits, amountInWords, RIYAL,
} from '../.test-build/legal-amount.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  if (got === want) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

/* -- 1 and 2. the words ---------------------------------------------- */

eq('zero says nothing', arabicNumberWords(0), '');
eq('one', arabicNumberWords(1), '\u0648\u0627\u062d\u062f');
eq('three', arabicNumberWords(3), '\u062b\u0644\u0627\u062b\u0629');
eq('ten', arabicNumberWords(10), '\u0639\u0634\u0631\u0629');
eq('eleven', arabicNumberWords(11), '\u0623\u062d\u062f \u0639\u0634\u0631');
eq('nineteen', arabicNumberWords(19), '\u062a\u0633\u0639\u0629 \u0639\u0634\u0631');
eq('twenty', arabicNumberWords(20), '\u0639\u0634\u0631\u0648\u0646');
// The unit comes FIRST in Arabic: twenty-five is "five and twenty".
eq('twenty-five puts the unit first', arabicNumberWords(25), '\u062e\u0645\u0633\u0629 \u0648\u0639\u0634\u0631\u0648\u0646');
eq('ninety-nine', arabicNumberWords(99), '\u062a\u0633\u0639\u0629 \u0648\u062a\u0633\u0639\u0648\u0646');
eq('one hundred', arabicNumberWords(100), '\u0645\u0627\u0626\u0629');
eq('two hundred is the dual, not "two hundreds"', arabicNumberWords(200), '\u0645\u0627\u0626\u062a\u0627\u0646');
// The one he named.
eq('five hundred', arabicNumberWords(500), '\u062e\u0645\u0633\u0645\u0627\u0626\u0629');
eq('five hundred and fifty', arabicNumberWords(550), '\u062e\u0645\u0633\u0645\u0627\u0626\u0629 \u0648\u062e\u0645\u0633\u0648\u0646');
eq('nine hundred and ninety-nine', arabicNumberWords(999),
  '\u062a\u0633\u0639\u0645\u0627\u0626\u0629 \u0648\u062a\u0633\u0639\u0629 \u0648\u062a\u0633\u0639\u0648\u0646');

// The scale words. One and two are the word itself and its dual - never
// "one thousand", which is what a naive implementation writes.
eq('a thousand is not "one thousand"', arabicNumberWords(1000), '\u0623\u0644\u0641');
eq('two thousand is the dual', arabicNumberWords(2000), '\u0623\u0644\u0641\u0627\u0646');
eq('three thousand takes the plural', arabicNumberWords(3000), '\u062b\u0644\u0627\u062b\u0629 \u0622\u0644\u0627\u0641');
eq('eleven thousand goes back to the singular', arabicNumberWords(11000),
  '\u0623\u062d\u062f \u0639\u0634\u0631 \u0623\u0644\u0641');
eq('twelve thousand five hundred', arabicNumberWords(12500),
  '\u0627\u062b\u0646\u0627 \u0639\u0634\u0631 \u0623\u0644\u0641 \u0648\u062e\u0645\u0633\u0645\u0627\u0626\u0629');
eq('a million', arabicNumberWords(1000000), '\u0645\u0644\u064a\u0648\u0646');
eq('two million', arabicNumberWords(2000000), '\u0645\u0644\u064a\u0648\u0646\u0627\u0646');
eq('a thousand and one', arabicNumberWords(1001), '\u0623\u0644\u0641 \u0648\u0648\u0627\u062d\u062f');
// A zero group is skipped, not spoken.
eq('a million and five hundred skips the empty thousands',
  arabicNumberWords(1000500), '\u0645\u0644\u064a\u0648\u0646 \u0648\u062e\u0645\u0633\u0645\u0627\u0626\u0629');

/* -- parsing what somebody typed --------------------------------------- */

eq('a plain number', JSON.stringify(parseAmount('500')), JSON.stringify({ riyals: 500, halalas: 0 }));
eq('with decimals', JSON.stringify(parseAmount('500.00')), JSON.stringify({ riyals: 500, halalas: 0 }));
eq('with halalas', JSON.stringify(parseAmount('12.50')), JSON.stringify({ riyals: 12, halalas: 50 }));
eq('with thousands separators', JSON.stringify(parseAmount('1,250.50')),
  JSON.stringify({ riyals: 1250, halalas: 50 }));
// The value comes from a person typing, not an API.
eq('arabic-indic digits parse', JSON.stringify(parseAmount('\u0665\u0660\u0660')),
  JSON.stringify({ riyals: 500, halalas: 0 }));
ok('words are not a number', parseAmount('to be agreed') === null);
ok('empty is not a number', parseAmount('') === null);
ok('and neither is nothing at all', parseAmount(null) === null);
ok('three decimal places is refused', parseAmount('1.234') === null);

eq('digits always carry two decimals', amountDigits('500'), '500.00');
eq('and are grouped', amountDigits('1250.5'), '1,250.50');

/* -- 1 and 3. the printed form ----------------------------------------- */

// Exactly what he asked for: the figure in brackets, the words in brackets,
// then the currency.
// The currency reads ONCE, after the brackets. Siraj: "remove riyal from the
// word is just need (five hundred)" - saying it twice padded the line.
eq('five hundred, the way he asked for it',
  amountInWords('500'),
  '(500.00) (\u062e\u0645\u0633\u0645\u0627\u0626\u0629) \u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a');
ok('the currency is not repeated inside the brackets',
  (amountInWords('500').match(/\u0631\u064a\u0627\u0644/g) || []).length === 1);
eq('and it does not care how the number was typed',
  amountInWords('500.00'), amountInWords('500'));

{
  const s = amountInWords('12500.75');
  ok('the figure is in brackets', s.includes('(12,500.75)'));
  ok('the words are in brackets beside it',
    s.includes('\u0627\u062b\u0646\u0627 \u0639\u0634\u0631 \u0623\u0644\u0641 \u0648\u062e\u0645\u0633\u0645\u0627\u0626\u0629'));
  ok('the halalas are spelled out too', s.includes('\u0647\u0644\u0644\u0629'));
  ok('and it ends in the currency', s.trim().endsWith('\u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a'));
}

// THE PROPERTY: the words always agree with the figure. Checked over a spread
// of values rather than asserted once and hoped for.
{
  let mismatched = 0;
  for (const n of [1, 2, 7, 10, 11, 20, 21, 99, 100, 101, 200, 500, 999,
    1000, 1001, 2000, 3000, 11000, 12500, 99999, 1000000, 1000500]) {
    const s = amountInWords(String(n));
    const w = arabicNumberWords(n);
    if (!s.includes(n.toLocaleString('en-US')) || (w && !s.includes(w))) mismatched += 1;
  }
  eq('the words agree with the figure at every scale', mismatched, 0);
}

// A field holding something that is not a number is left EXACTLY alone. A
// contract that turned "to be agreed" into "(0.00) (zero)" would be worse
// than one that printed the words.
eq('a non-numeric amount is untouched', amountInWords('to be agreed'), 'to be agreed');
eq('and so is an empty one', amountInWords(''), '');
eq('zero prints the figure and no words',
  amountInWords('0'), '(0.00) \u0631\u064a\u0627\u0644 \u0633\u0639\u0648\u062f\u064a');
ok('the riyal is the one the contract uses', RIYAL === '\u0631\u064a\u0627\u0644');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
