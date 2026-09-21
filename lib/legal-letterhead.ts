/**
 * The company letterhead that every printed contract carries.
 *
 * Siraj, sending the real signed UGC agreement: "i need the app to be seemless
 * ... we need to fix contracts to look close to this one as close as possible",
 * and, asked where the letterhead should live: "a company setting, set once".
 *
 * -- WHAT WAS WRONG ---------------------------------------------------
 *
 * The app printed the words "AQ Creativity" over a rule, and a line of meta
 * under it. The real document has the mark top-right on EVERY page and the
 * company strip - name, phone, email, P.O, CR, address - along the bottom of
 * EVERY page. Side by side they are not the same document, and the one the
 * app produced is the one a vendor would query.
 *
 * -- WHY IT IS TEXT AND ONE SVG PATH, NOT A PICTURE -------------------
 *
 * The obvious move is to paste in the two images from the Word file. It was
 * not taken, for three reasons that matter more than the hour it would save:
 *
 *   * A raster letterhead is fixed at the resolution it was scanned at. This
 *     one is vector, so it is sharp at any size, on any printer, forever.
 *   * The phone number, the P.O box and the CR number are DATA. As an image
 *     they can only be changed by someone with the original file and an
 *     editor. As fields they are a company setting anybody can correct.
 *   * Nothing here has to survive a console. Every byte below is ASCII,
 *     including the traced logo outline, so it ships like any other code.
 *
 * The outline in LOGO_PATH is the real mark, traced from the document he
 * sent - not an approximation drawn by eye.
 *
 * -- WHY THE DEFAULTS ARE IN THE CODE ---------------------------------
 *
 * A workspace with no letterhead row still prints the right letterhead. The
 * setting EDITS the default rather than supplying it, so the feature works the
 * moment it deploys, with nothing to fill in first. That is what "set once"
 * has to mean to be worth anything: set once by us, not once by them.
 */

/** Which part of the sheet a piece of the letterhead belongs to. */
export interface Letterhead {
  /** The mark, drawn top of every page. */
  logoPath: string;
  logoViewBox: string;
  /** Under the mark: the brand line and what sits beneath it. */
  brandLine: string;
  brandSub: string;
  /** The footer strip. */
  companyAr: string;
  companyEn: string;
  phone: string;
  email: string;
  poBox: string;
  crNumber: string;
  addressAr: string;
  addressEn: string;
  /** Off prints a bare sheet - for a draft somebody is proofreading. */
  enabled: boolean;
}

/**
 * The AQ mark, traced from the letterhead on the signed agreement.
 *
 * potrace output over a 346 x 284 box, drawn with the y axis pointing down -
 * LOGO_TRANSFORM is what puts it back the right way up. Kept as one constant
 * so a future rebrand is a replaced string rather than a hunt through a
 * stylesheet.
 */
export const LOGO_PATH = 'M1450 2829 c-468 -59 -873 -351 -1070 -772 -95 -203 -133 -376 -133 -607 0 -235 34 -388 132 -596 7'
  + '1 -149 140 -245 270 -375 127 -127 216 -191 369 -269 206 -103 383 -144 617 -144 168 1 289 21 442 '
  + '75 102 36 287 129 334 168 l32 27 -73 110 c-40 60 -74 111 -76 112 -1 2 -30 -15 -65 -38 -88 -60 -2'
  + '14 -117 -327 -148 -87 -23 -114 -26 -272 -26 -158 0 -185 3 -273 27 -431 116 -747 459 -828 897 -15'
  + ' 84 -15 287 1 370 18 99 65 236 110 324 241 469 769 702 1268 560 371 -105 670 -401 776 -765 45 -1'
  + '57 56 -370 26 -502 -8 -38 -6 -41 98 -180 l106 -142 18 60 c49 164 62 254 62 445 0 136 -4 208 -17 '
  + '272 -103 515 -480 927 -979 1072 -172 50 -378 67 -548 45z M1493 1488 c-214 -320 -393 -589 -397 -5'
  + '95 -6 -10 34 -13 186 -13 l193 1 204 299 205 300 30 -44 c17 -23 240 -340 496 -704 l465 -661 198 -'
  + '1 c108 0 197 2 197 4 0 4 -1376 1985 -1385 1994 -2 2 -179 -259 -392 -580z';
export const LOGO_VIEW_BOX = '0 0 346 284';
/** potrace traces with the y axis down; this puts it back. */
export const LOGO_TRANSFORM = 'translate(0,284) scale(0.1,-0.1)';

/**
 * AQ's own letterhead, as it reads on the signed agreement.
 *
 * These are the defaults, not a sample: a workspace that never opens the
 * setting still prints this.
 */
export const DEFAULT_LETTERHEAD: Letterhead = {
  logoPath: LOGO_PATH,
  logoViewBox: LOGO_VIEW_BOX,
  brandLine: 'CREATIVE AGENCY',
  brandSub: 'Entertainment . Consultancy . Marketing',
  companyAr: '\u0634\u0631\u0643\u0629 \u0631\u0648\u0627\u062f \u0627\u0644\u062a\u0623\u062b\u064a\u0631',
  companyEn: 'RAWAD ALTATHIR COMPANY',
  phone: '+966 54 070 0760',
  email: 'INFO@AQCREATIVITY.COM',
  poBox: '23442',
  crNumber: '7017229233',
  addressAr: '\u0623\u062f\u064a\u0643\u0633 \u062a\u0627\u0648\u0631 \u062c\u062f\u0629 - \u0627\u0644\u0645\u0645\u0644\u0643\u0629 \u0627\u0644\u0639\u0631\u0628\u064a\u0629 \u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629',
  addressEn: 'ADEX TOWER JEDDAH - SAUDI ARABIA',
  enabled: true,
};

/**
 * A stored row folded onto the defaults.
 *
 * A blank field falls back rather than printing an empty line: a letterhead
 * with the phone number deleted should show the old number until somebody
 * types a new one, not a gap where a number belongs. `enabled` is the one
 * field where false is a real answer, so it is read separately. Pure.
 */
export function letterheadFrom(row: Partial<Record<string, unknown>> | null | undefined): Letterhead {
  const pick = (k: keyof Letterhead, col: string): string => {
    const v = row?.[col];
    const s = typeof v === 'string' ? v.trim() : '';
    return s || (DEFAULT_LETTERHEAD[k] as string);
  };
  return {
    logoPath: pick('logoPath', 'logo_path'),
    logoViewBox: pick('logoViewBox', 'logo_view_box'),
    brandLine: pick('brandLine', 'brand_line'),
    brandSub: pick('brandSub', 'brand_sub'),
    companyAr: pick('companyAr', 'company_ar'),
    companyEn: pick('companyEn', 'company_en'),
    phone: pick('phone', 'phone'),
    email: pick('email', 'email'),
    poBox: pick('poBox', 'po_box'),
    crNumber: pick('crNumber', 'cr_number'),
    addressAr: pick('addressAr', 'address_ar'),
    addressEn: pick('addressEn', 'address_en'),
    enabled: row?.enabled === undefined || row?.enabled === null ? true : !!row.enabled,
  };
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The mark, as an <img> carrying the SVG in a data URL.
 *
 * NOT inline <svg>. Inline SVG inside a repeated THEAD paints on the first
 * printed page and nowhere else - page one had the logo and pages two, three
 * and four had the brand text sitting alone above the margin. An <img> with
 * the same vector inside repeats on every page, and is still vector, so this
 * costs nothing but the encode.
 *
 * encodeURIComponent, not base64: it works identically in the browser and in
 * Node, so the print output can be rendered in a test without a DOM. Pure.
 */
export function logoSvg(lh: Letterhead, widthMm: number): string {
  const parts = String(lh.logoViewBox).trim().split(/\s+/).map(Number);
  const vw = parts[2] || 1;
  const vh = parts[3] || 1;
  const heightMm = (widthMm * vh) / vw;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${esc(lh.logoViewBox)}">`
    + `<g transform="${LOGO_TRANSFORM}" fill="#111" stroke="none">`
    + `<path d="${esc(lh.logoPath)}"/></g></svg>`;
  // Sized in the style attribute, not the width/height attributes: those are
  // pixel counts in HTML, so "16mm" is discarded and the mark comes out a few
  // millimetres tall. It printed that way once.
  return `<img class="lh-mark" alt="${esc(lh.brandLine)}"`
    + ` style="width:${widthMm}mm;height:${heightMm.toFixed(2)}mm"`
    + ` src="data:image/svg+xml,${encodeURIComponent(svg)}">`;
}

/**
 * The block that repeats at the top of every page.
 *
 * Always LTR inside, whatever the document's direction: the mark and the two
 * brand lines are a logo, and a logo does not mirror. The document around it
 * still flows right to left.
 */
export function letterheadHeaderHtml(lh: Letterhead): string {
  if (!lh.enabled) return '';
  return '<div class="lh-head" dir="ltr">'
    + `<div class="lh-head-in">${logoSvg(lh, 16)}`
    + `<div class="lh-brand">${esc(lh.brandLine)}</div>`
    + `<div class="lh-brand-sub">${esc(lh.brandSub)}</div>`
    + '</div></div>';
}

/**
 * The strip that repeats at the bottom of every page: a rule, the company
 * name beside the mark, then the three contact columns.
 *
 * The columns are laid out left to right exactly as they are on the paper -
 * phone and email, then P.O and CR, then the address - because that is what
 * the page he is comparing against looks like, and "as close as possible" was
 * the whole brief.
 */
export function letterheadFooterHtml(lh: Letterhead): string {
  if (!lh.enabled) return '';
  const col = (inner: string) => `<div class="lh-col">${inner}</div>`;
  return '<div class="lh-foot">'
    + '<div class="lh-rule"></div>'
    + '<div class="lh-name">'
    + `<div class="lh-name-txt"><div class="lh-name-ar" dir="rtl">${esc(lh.companyAr)}</div>`
    + `<div class="lh-name-en" dir="ltr">${esc(lh.companyEn)}</div></div>`
    + logoSvg(lh, 7) + '</div>'
    + '<div class="lh-cols" dir="ltr">'
    + col(`<div class="lh-line" dir="ltr">${esc(lh.phone)}</div>`
        + `<div class="lh-line" dir="ltr">${esc(lh.email)}</div>`)
    + col(`<div class="lh-line" dir="ltr"><b>P.O</b> ${esc(lh.poBox)}</div>`
        + `<div class="lh-line" dir="ltr"><b>CR</b> ${esc(lh.crNumber)}</div>`)
    + col(`<div class="lh-line lh-ar" dir="rtl">${esc(lh.addressAr)}</div>`
        + `<div class="lh-line" dir="ltr">${esc(lh.addressEn)}</div>`)
    + '</div></div>';
}

/**
 * The stylesheet for both, and the page geometry that makes them repeat.
 *
 * -- HOW A HEADER REPEATS ON EVERY PRINTED PAGE -----------------------
 *
 * Not `position: fixed`. That is the answer everyone reaches for and it is
 * wrong here: Chromium INVERTS top and bottom for a fixed element once the
 * document paginates. A header at `top: -26mm` printed near the foot of every
 * page and the footer printed near the head of it - which was found by
 * printing to PDF and looking at page three, and would not have been found by
 * reading the CSS.
 *
 * The technique that does work is the old one: a table whose THEAD and TFOOT
 * are repeated by the browser on every page it breaks across. It is in the
 * spec, every engine does it, and - unlike a fixed element - the repeated
 * rows RESERVE their space, so body text cannot slide underneath the
 * letterhead. `contractPrintHTML` wraps the sheet in that table.
 */
export function letterheadCss(): string {
  return `
  @page { size: A4; margin: 14mm 25.4mm 10mm 25.4mm; }
  .page { width: 100%; border-collapse: collapse; }
  .page > thead td, .page > tfoot td, .page > tbody td { padding: 0; border: 0; }
  .page > thead td { padding-bottom: 9mm; }
  .page > tfoot td { padding-top: 9mm; }

  .lh-mark { display: block; color: #111; }
  .lh-head { text-align: right; }
  .lh-head-in { display: inline-block; text-align: center; }
  .lh-brand { font-size: 7pt; font-weight: 800; letter-spacing: .18em; margin-top: 1.5mm; white-space: nowrap; }
  .lh-brand-sub { font-size: 4.2pt; font-weight: 700; letter-spacing: .05em; color: #222; white-space: nowrap; }
  .lh-head .lh-mark { margin: 0 auto; }

  .lh-foot { font-size: 7.5pt; color: #333; line-height: 1.45; }
  .lh-rule { border-top: 1.2pt solid #111; margin-bottom: 3.5mm; }
  .lh-name { display: flex; align-items: center; justify-content: center; gap: 2.5mm; }
  .lh-name-ar { font-size: 8.5pt; letter-spacing: .1em; }
  .lh-name-en { font-size: 7.5pt; letter-spacing: .02em; }
  .lh-name-txt { text-align: center; }
  .lh-cols { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; margin-top: 3.5mm; }
  .lh-col:last-child { text-align: right; }
  .lh-line b { font-weight: 800; margin-inline-end: 1.5mm; }`;
}
