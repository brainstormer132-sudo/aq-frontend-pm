/**
 * The company letterhead.
 *
 * Two things are worth protecting here and neither is the styling. The first
 * is that a workspace which has never opened the setting still prints a
 * correct letterhead - the defaults ARE the letterhead, and a blank field
 * falls back rather than printing a gap where a phone number belongs. The
 * second is that the mark goes out as an <img>: inline SVG inside a repeated
 * THEAD paints on page one and nowhere else, so a test that only checks "the
 * logo is in the HTML" would have passed while pages two onward had no logo.
 */
import {
  DEFAULT_LETTERHEAD, LOGO_PATH, LOGO_VIEW_BOX,
  letterheadFrom, logoSvg, letterheadHeaderHtml, letterheadFooterHtml, letterheadCss,
} from '../.test-build/legal-letterhead.js';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
}

/* -- the defaults are the letterhead --------------------------------- */

eq('nothing stored still gives AQ its letterhead',
  letterheadFrom(null).companyEn, 'RAWAD ALTATHIR COMPANY');
eq('and its phone', letterheadFrom(undefined).phone, DEFAULT_LETTERHEAD.phone);
eq('and its CR', letterheadFrom({}).crNumber, '7017229233');
eq('and the mark', letterheadFrom(null).logoPath, LOGO_PATH);

// A blank is a fallback, not an instruction to print nothing: somebody who
// clears the phone field should see the old number until they type a new one.
eq('a stored value wins', letterheadFrom({ phone: '+966 11 111 1111' }).phone, '+966 11 111 1111');
eq('a blank falls back', letterheadFrom({ phone: '   ' }).phone, DEFAULT_LETTERHEAD.phone);
eq('a null falls back', letterheadFrom({ phone: null }).phone, DEFAULT_LETTERHEAD.phone);
eq('a number falls back', letterheadFrom({ phone: 12345 }).phone, DEFAULT_LETTERHEAD.phone);
eq('a stored value is trimmed', letterheadFrom({ email: '  a@b.com ' }).email, 'a@b.com');

// enabled is the one field where false is a real answer.
eq('missing enabled reads as on', letterheadFrom({}).enabled, true);
eq('null enabled reads as on', letterheadFrom({ enabled: null }).enabled, true);
eq('false enabled reads as off', letterheadFrom({ enabled: false }).enabled, false);
eq('true enabled reads as on', letterheadFrom({ enabled: true }).enabled, true);

eq('every default is filled in',
  Object.entries(DEFAULT_LETTERHEAD).filter(([, v]) => v === '' || v === null || v === undefined), []);

/* -- the mark ---------------------------------------------------------- */

{
  const lh = letterheadFrom(null);
  const img = logoSvg(lh, 16);
  // An <img>, not inline <svg>. Inline SVG in a repeated THEAD printed the
  // logo on page one only; this is the whole reason for the encode.
  ok('the mark ships as an img', img.startsWith('<img') && !img.includes('<svg class'));
  ok('carrying the vector, not a raster', img.includes('data:image/svg+xml,'));
  ok('the traced outline is in it', img.includes(encodeURIComponent(LOGO_PATH.slice(0, 20))));
  // Sized in style, not the width attribute: an HTML width attribute is a
  // pixel count, so "16mm" is discarded and the mark prints a few mm tall.
  ok('sized in the style attribute', img.includes('style="width:16mm'));
  ok('not in the width attribute', !img.includes('width="16mm"'));
  // Height comes from the viewBox, so the mark cannot be squashed.
  const [, , vw, vh] = LOGO_VIEW_BOX.split(/\s+/).map(Number);
  ok('height follows the aspect ratio',
    img.includes(`height:${((16 * vh) / vw).toFixed(2)}mm`));
  ok('a second size scales with it', logoSvg(lh, 8).includes('style="width:8mm'));
  ok('the data url is escaped', !img.includes('<svg xmlns'));
}
{
  // A letterhead with a junk viewBox must still produce something with a
  // size, rather than height:NaNmm.
  const img = logoSvg({ ...letterheadFrom(null), logoViewBox: 'junk' }, 10);
  ok('a junk viewBox does not print NaN', !img.includes('NaN'));
}

/* -- the header -------------------------------------------------------- */

{
  const lh = letterheadFrom(null);
  const h = letterheadHeaderHtml(lh);
  ok('the header carries the mark', h.includes('<img'));
  ok('and the brand line', h.includes('CREATIVE AGENCY'));
  ok('and what sits under it', h.includes('Entertainment . Consultancy . Marketing'));
  // A logo does not mirror, whatever the document does.
  ok('the header is ltr inside an rtl document', h.includes('dir="ltr"'));
  eq('switched off, there is no header', letterheadHeaderHtml({ ...lh, enabled: false }), '');
}

/* -- the footer -------------------------------------------------------- */

{
  const lh = letterheadFrom(null);
  const f = letterheadFooterHtml(lh);
  for (const bit of ['RAWAD ALTATHIR COMPANY', '+966 54 070 0760', 'INFO@AQCREATIVITY.COM',
    '23442', '7017229233', 'ADEX TOWER JEDDAH - SAUDI ARABIA']) {
    ok(`the strip carries ${bit}`, f.includes(bit));
  }
  ok('the rule above it', f.includes('lh-rule'));
  ok('the small mark beside the name', f.includes('<img'));
  // The columns read left to right as they do on the paper. Without this the
  // flex row mirrors inside the rtl document and the address swaps sides.
  ok('the columns do not mirror under rtl', f.includes('class="lh-cols" dir="ltr"'));
  const iPhone = f.indexOf('+966 54 070 0760');
  const iPo = f.indexOf('23442');
  const iAddr = f.indexOf('ADEX TOWER');
  ok('phone, then P.O, then the address', iPhone < iPo && iPo < iAddr);
  eq('switched off, there is no footer', letterheadFooterHtml({ ...lh, enabled: false }), '');
}
{
  // Everything interpolated is escaped - a letterhead is editable, so a
  // stray < in a company name must not become markup.
  const f = letterheadFooterHtml(letterheadFrom({ company_en: 'A <b>co</b> & Sons' }));
  ok('a stored name is escaped', f.includes('A &lt;b&gt;co&lt;/b&gt; &amp; Sons'));
  ok('and does not become markup', !f.includes('<b>co</b>'));
}

/* -- the page geometry ------------------------------------------------- */

{
  const css = letterheadCss();
  ok('A4', css.includes('size: A4'));
  // NOT position:fixed. Chromium inverts top and bottom for a fixed element
  // once the document paginates - the header printed at the foot of every
  // page. The repeating thead/tfoot is what replaced it, and this assertion
  // is what stops somebody reaching for the obvious answer again.
  ok('the letterhead does not use position: fixed', !css.includes('position: fixed'));
  ok('the repeating table is styled', css.includes('.page > thead td')
    && css.includes('.page > tfoot td'));
  ok('the thead leaves the body room', css.includes('padding-bottom'));
  ok('and the tfoot does too', css.includes('padding-top'));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
