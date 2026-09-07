import {
  expandBooking, planSync, plannedRows, adoptionPatch, rowKey, adsOnLine,
  MAX_ADS_PER_LINE,
} from '../.test-build/tracking-sync.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

/* ── Siraj's report, reproduced end to end ───────────────────────────
   "there should be a booking in the tracking sheet per line added right
   now its just the one vendor task added"

   The sheet is seeded when the VENDOR is picked. At that moment the
   booking has no ad lines, so one placeholder row is written. The ads
   arrive afterwards — and nothing used to come back to turn that
   placeholder into the real rows.                                      */

const BOOKING = {
  subtask_id: 'sub-1',
  vendor_name: 'Reem',
  profile_link: '@reem',
  platform: null,
  lines: [
    { id: 'l1', position: 0, ad_type: 'Home Ad', platform: 'TikTok', quantity: 6, unit_price: 1000 },
    { id: 'l2', position: 1, ad_type: 'Store Visit', platform: 'Instagram', quantity: 6, unit_price: 1500 },
  ],
};

// Step 1 — the vendor is picked. No lines yet, so the sheet gets one
// placeholder: no ad_line_id, but keyed to the subtask so it can be claimed.
const placeholder = {
  id: 'row-placeholder', subtask_id: 'sub-1', influencer_name: 'Reem',
  ad_line_id: null, ad_line_seq: null, position: 0,
};
eq('a placeholder has no key', rowKey(placeholder), null);
{
  const plan = planSync({ ads: [], rows: [placeholder] });
  eq('and nothing to do while there are no ads', plan.toAdd.length, 0);
  eq('it counts as hand-typed for now', plan.manual, 1);
}

// Step 2 — the ads are added. THIS is what was never happening.
{
  const ads = expandBooking(BOOKING, null);
  eq('twelve ads, not two lines and not one vendor', ads.length, 12);

  const plan = planSync({ ads, rows: [placeholder] });
  eq('the placeholder is claimed, not duplicated', plan.toAdopt.length, 1);
  eq('and it becomes the FIRST ad', plan.toAdopt[0].ad.key, 'l1#1');
  eq('the other eleven are added', plan.toAdd.length, 11);
  eq('twelve rows in total', plan.toAdopt.length + plan.toAdd.length, 12);
  eq('nothing is orphaned', plan.orphaned.length, 0);
  eq('one vendor named', plan.vendors, ['Reem']);

  // What the adopted row is actually set to.
  const patch = adoptionPatch(plan.toAdopt[0]);
  eq('adopted row gets the line id', patch.ad_line_id, 'l1');
  eq('and its sequence', patch.ad_line_seq, 1);
  eq('and the ad type', patch.type_of_ad, 'Home Ad');
  eq('and the platform', patch.platform, 'TikTok');
}

// Step 3 — running it again adds nothing. This is what makes it safe to
// call on every ad-line change.
{
  const ads = expandBooking(BOOKING, null);
  const rows = ads.map((a, i) => ({
    id: `row-${i}`, subtask_id: 'sub-1', ad_line_id: a.adLineId, ad_line_seq: a.adLineSeq,
  }));
  const plan = planSync({ ads, rows });
  eq('nothing to add', plan.toAdd.length, 0);
  eq('nothing to adopt', plan.toAdopt.length, 0);
  eq('all twelve already there', plan.alreadyThere, 12);
  eq('and none orphaned', plan.orphaned.length, 0);
}

/* ── Both ad types and both platforms reach the sheet ────────────── */
{
  const ads = expandBooking(BOOKING, null);
  eq('six of each type',
    [ads.filter((a) => a.adType === 'Home Ad').length,
     ads.filter((a) => a.adType === 'Store Visit').length], [6, 6]);
  eq('and each on its own platform',
    [ads.filter((a) => a.platform === 'TikTok').length,
     ads.filter((a) => a.platform === 'Instagram').length], [6, 6]);
  // The per-ad rate, not the line total: a line of 6 at 1,000 is six ads
  // of 1,000, not one of 6,000.
  eq('per-ad price', ads[0].priceExcl, 1000);
  eq('numbered so a person can tell them apart', ads[0].ordinal, 'Ad 1 of 6');
  eq('and the last of its line', ads[5].ordinal, 'Ad 6 of 6');
}
// A line of one is not numbered — "Ad 1 of 1" is noise.
{
  const ads = expandBooking({
    ...BOOKING, lines: [{ id: 'l1', ad_type: 'Reel', platform: 'TikTok', quantity: 1, unit_price: 900 }],
  }, null);
  eq('one ad', ads.length, 1);
  eq('no ordinal', ads[0].ordinal, '');
}

/* ── Falling back for what the line does not say ─────────────────── */
{
  const ads = expandBooking({
    ...BOOKING, platform: 'Snapchat',
    lines: [{ id: 'l1', ad_type: 'Home Ad', platform: null, quantity: 2 }],
  }, 'Instagram');
  eq('the booking fills in for the line', ads[0].platform, 'Snapchat');
}
{
  const ads = expandBooking({
    ...BOOKING, platform: null,
    lines: [{ id: 'l1', ad_type: 'Home Ad', platform: null, quantity: 2 }],
  }, 'Instagram');
  eq('and the campaign fills in for the booking', ads[0].platform, 'Instagram');
}

/* ── Growing and shrinking a booking ─────────────────────────────── */
// Quantity raised from 6 to 8: two more rows, and the six that exist are
// left alone.
{
  const before = expandBooking(BOOKING, null);
  const rows = before.map((a, i) => ({
    id: `row-${i}`, subtask_id: 'sub-1', ad_line_id: a.adLineId, ad_line_seq: a.adLineSeq,
  }));
  const grown = expandBooking({
    ...BOOKING,
    lines: [{ ...BOOKING.lines[0], quantity: 8 }, BOOKING.lines[1]],
  }, null);
  const plan = planSync({ ads: grown, rows });
  eq('two more', plan.toAdd.length, 2);
  eq('and they are the new sequences', plan.toAdd.map((a) => a.key), ['l1#7', 'l1#8']);
  eq('nothing orphaned by growing', plan.orphaned.length, 0);
}
// A line deleted. The rows are REPORTED, never removed — they may carry a
// posting date and a link that exist nowhere else.
{
  const before = expandBooking(BOOKING, null);
  const rows = before.map((a, i) => ({
    id: `row-${i}`, subtask_id: 'sub-1', ad_line_id: a.adLineId, ad_line_seq: a.adLineSeq,
  }));
  const plan = planSync({ ads: expandBooking({ ...BOOKING, lines: [BOOKING.lines[0]] }, null), rows });
  eq('six rows have no line any more', plan.orphaned.length, 6);
  eq('and nothing is added to replace them', plan.toAdd.length, 0);
}

/* ── Two bookings of the same vendor are two bookings ────────────── */
// The old seeding was idempotent by vendor NAME, which is how one vendor
// booked twice ended up as a single row.
{
  const a = expandBooking(BOOKING, null);
  const b = expandBooking({ ...BOOKING, subtask_id: 'sub-2' }, null);
  const rows = a.map((x, i) => ({
    id: `row-${i}`, subtask_id: 'sub-1', ad_line_id: x.adLineId, ad_line_seq: x.adLineSeq,
  }));
  // Same line ids would collide; a second booking has its own lines.
  const b2 = b.map((x) => ({ ...x, adLineId: `b-${x.adLineId}`, key: `b-${x.key}` }));
  const plan = planSync({ ads: [...a, ...b2], rows });
  eq('the second booking is all new', plan.toAdd.length, 12);
}
// A placeholder belongs to ITS subtask and cannot be claimed by another's ads.
{
  const other = { id: 'row-x', subtask_id: 'sub-OTHER', ad_line_id: null, ad_line_seq: null };
  const plan = planSync({ ads: expandBooking(BOOKING, null), rows: [other] });
  eq('not adopted by a stranger', plan.toAdopt.length, 0);
  eq('so all twelve are added', plan.toAdd.length, 12);
}

/* ── Guards ──────────────────────────────────────────────────────── */
eq('a line is at least one ad', adsOnLine(0), 1);
eq('and so is a blank one', adsOnLine(null), 1);
eq('a typo is capped, not written', adsOnLine(999999), MAX_ADS_PER_LINE);
eq('a line with no id is skipped',
  expandBooking({ ...BOOKING, lines: [{ id: '', quantity: 4 }] }, null).length, 0);
// Rows somebody typed by hand are never touched.
{
  const manual = { id: 'row-typed', ad_line_id: null, ad_line_seq: null };
  const plan = planSync({ ads: expandBooking(BOOKING, null), rows: [manual] });
  eq('counted as manual', plan.manual, 1);
  eq('and left alone', plan.toAdopt.length, 0);
}

/* ── The rows that actually get written ──────────────────────────── */
{
  const plan = planSync({ ads: expandBooking(BOOKING, null), rows: [] });
  const rows = plannedRows(plan, 5, 'Nice Brand');
  eq('twelve rows', rows.length, 12);
  eq('positions continue from where the sheet ended', rows[0].position, 5);
  eq('and keep counting', rows[11].position, 16);
  eq('carrying the line id', rows[0].ad_line_id, 'l1');
  eq('the vendor', rows[0].influencer_name, 'Reem');
  eq('and the product', rows[0].product, 'Nice Brand');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
