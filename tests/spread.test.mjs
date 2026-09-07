import { bookingRows, campaignSpread, groupDigits, caretAfterGrouping, bookingSubtitle } from '../.test-build/campaign-page.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const names = new Map([[1, 'Reem'], [2, 'Bright Studios'], [3, 'Layla']]);

/* ── Siraj's case, stated exactly ────────────────────────────────────
   "the same vendor could do one ad home ad one store visit one of them
   tiktok and one instagram so it should reflect that in the vendor task
   on top after the line update"                                        */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1, ad_type: 'Home Ad', platform: 'TikTok' }],
    ads: [
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'TikTok', quantity: 1 },
      { subtask_id: 'a', ad_type: 'Store Visit', platform: 'Instagram', quantity: 1 },
    ],
    vendorNames: names,
  });
  eq('both ad types', rows[0].adTypeList, ['Home Ad', 'Store Visit']);
  eq('both platforms', rows[0].platformList, ['TikTok', 'Instagram']);
  eq('mixed types', rows[0].mixedAdTypes, true);
  eq('mixed platforms', rows[0].mixedPlatforms, true);
  eq('the text still reads', rows[0].adTypes, 'Home Ad, Store Visit');
  eq('two ads counted', rows[0].ads, 2);
  eq('the ads own the type', rows[0].adTypesFromAds, true);
  eq('the ads own the platform', rows[0].platformsFromAds, true);
}

/* ── One type, two platforms — mixed on one axis only ─────────────── */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1 }],
    ads: [
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'TikTok' },
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'Instagram' },
    ],
  });
  eq('one type', rows[0].adTypeList, ['Home Ad']);
  eq('not mixed on type', rows[0].mixedAdTypes, false);
  eq('two platforms', rows[0].platformList, ['TikTok', 'Instagram']);
  eq('mixed on platform', rows[0].mixedPlatforms, true);
}

/* ── Order is first-seen, and repeats do not duplicate ───────────── */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1 }],
    ads: [
      { subtask_id: 'a', ad_type: 'Store Visit', platform: 'Instagram' },
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'TikTok' },
      { subtask_id: 'a', ad_type: 'Store Visit', platform: 'Instagram' },
      { subtask_id: 'a', ad_type: 'Store Visit', platform: 'Snapchat' },
    ],
  });
  eq('first seen wins the order', rows[0].adTypeList, ['Store Visit', 'Home Ad']);
  eq('platforms likewise', rows[0].platformList, ['Instagram', 'TikTok', 'Snapchat']);
}

/* ── Fallback: a booking with no lines is still whatever it says ──── */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1, ad_type: 'Home Ad', platform: 'TikTok' }],
    ads: [],
  });
  eq('falls back to the booking type', rows[0].adTypeList, ['Home Ad']);
  eq('falls back to the booking platform', rows[0].platformList, ['TikTok']);
  eq('a fallback is never mixed', rows[0].mixedAdTypes, false);
  eq('nor on platform', rows[0].mixedPlatforms, false);
  // The dropdowns stay editable — nothing below is answering for them.
  eq('not from ads', rows[0].adTypesFromAds, false);
  eq('platform not from ads', rows[0].platformsFromAds, false);
}
// One line, one type: still the ads' answer, so the field reports rather
// than edits. Otherwise typing on the booking would set a value the tile
// never reads and the next line edit would contradict.
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1, ad_type: 'Home Ad', platform: 'TikTok' }],
    ads: [{ subtask_id: 'a', ad_type: 'Store Visit', platform: 'Instagram' }],
  });
  eq('one line still wins', rows[0].adTypeList, ['Store Visit']);
  eq('and is not mixed', rows[0].mixedAdTypes, false);
  eq('but is from the ads', rows[0].adTypesFromAds, true);
  eq('platform likewise', rows[0].platformsFromAds, true);
}

/* ── Lines that carry nothing do not erase the booking's own field ── */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1, ad_type: 'Home Ad', platform: 'TikTok' }],
    ads: [{ subtask_id: 'a', quantity: 3 }],
  });
  eq('blank lines keep the booking type', rows[0].adTypeList, ['Home Ad']);
  eq('blank lines keep the booking platform', rows[0].platformList, ['TikTok']);
}
// Half-typed lines: the ads win the axis they carry, the booking keeps the other.
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1, ad_type: 'Home Ad', platform: 'TikTok' }],
    ads: [
      { subtask_id: 'a', ad_type: 'Store Visit' },
      { subtask_id: 'a', ad_type: 'Reel' },
    ],
  });
  eq('the ads own the type', rows[0].adTypeList, ['Store Visit', 'Reel']);
  eq('the booking still owns the platform', rows[0].platformList, ['TikTok']);
  eq('type is reported', rows[0].adTypesFromAds, true);
  eq('platform is still editable', rows[0].platformsFromAds, false);
}

/* ── Nothing anywhere ────────────────────────────────────────────── */
{
  const rows = bookingRows({ subtasks: [{ id: 'a', vendor_id: 1 }], ads: [] });
  eq('no types', rows[0].adTypeList, []);
  eq('no platforms', rows[0].platformList, []);
  eq('no text', rows[0].adTypes, '');
  eq('not mixed', rows[0].mixedAdTypes, false);
}

/* ── Lines belong to their own booking, never a neighbour's ──────── */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1 }, { id: 'b', vendor_id: 2 }],
    ads: [
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'TikTok' },
      { subtask_id: 'b', ad_type: 'Store Visit', platform: 'Instagram' },
    ],
    vendorNames: names,
  });
  eq('a keeps its own', rows[0].adTypeList, ['Home Ad']);
  eq('b keeps its own', rows[1].adTypeList, ['Store Visit']);
  eq('a platform', rows[0].platformList, ['TikTok']);
  eq('b platform', rows[1].platformList, ['Instagram']);
}

/* ── The campaign, from the ads up ───────────────────────────────── */
// "same for the client task" — the campaign shows the union of its bookings.
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1 }, { id: 'b', vendor_id: 2 }, { id: 'c', vendor_id: 3 }],
    ads: [
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'TikTok' },
      { subtask_id: 'a', ad_type: 'Store Visit', platform: 'Instagram' },
      { subtask_id: 'b', ad_type: 'Home Ad', platform: 'Instagram' },
      { subtask_id: 'c', ad_type: 'Reel', platform: 'Snapchat' },
    ],
    vendorNames: names,
  });
  const s = campaignSpread(rows);
  eq('every type once', s.adTypes, ['Home Ad', 'Store Visit', 'Reel']);
  eq('every platform once', s.platforms, ['TikTok', 'Instagram', 'Snapchat']);
}
{
  const s = campaignSpread([]);
  eq('empty campaign types', s.adTypes, []);
  eq('empty campaign platforms', s.platforms, []);
}
// A campaign whose bookings have no lines still reports what they say.
{
  const rows = bookingRows({
    subtasks: [
      { id: 'a', vendor_id: 1, ad_type: 'Home Ad', platform: 'TikTok' },
      { id: 'b', vendor_id: 2, ad_type: 'Home Ad', platform: 'Instagram' },
    ],
    ads: [],
  });
  const s = campaignSpread(rows);
  eq('deduped across bookings', s.adTypes, ['Home Ad']);
  eq('both platforms', s.platforms, ['TikTok', 'Instagram']);
}

/* ── The subtitle names every type and platform ──────────────────── */
{
  const rows = bookingRows({
    subtasks: [{ id: 'a', vendor_id: 1 }],
    ads: [
      { subtask_id: 'a', ad_type: 'Home Ad', platform: 'TikTok' },
      { subtask_id: 'a', ad_type: 'Store Visit', platform: 'Instagram' },
    ],
  });
  eq('subtitle', bookingSubtitle({ ...rows[0], contractNote: '' }, rows[0].ads),
    '2 ads · Home Ad, Store Visit · TikTok, Instagram');
}
eq('subtitle with nothing booked', bookingSubtitle({ ads: 0 }, 0), 'no ads yet');
eq('the old drawer shape still works',
  bookingSubtitle({ ads: 3, adType: 'Home Ad', contractNote: 'contract signed' }, 3),
  '3 ads · Home Ad · contract signed');
eq('blanks in the list are dropped',
  bookingSubtitle({ ads: 1, adTypeList: ['Home Ad', '', null], platformList: [] }, 1),
  '1 ad · Home Ad');

/* ── The money grouping, still holding ───────────────────────────── */
eq('a thousand', groupDigits('1000'), '1,000');
eq('while typing', groupDigits('12345'), '12,345');
eq('caret rides the comma', caretAfterGrouping('1000', 4, '1,000'), 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
