import { pageIndex, PAGE_SECTION_IDS } from '../.test-build/campaign-page.js';
let p=0,f=0;
const eq=(n,g,w)=>{ if(JSON.stringify(g)===JSON.stringify(w)) p++; else {f++;console.log(`FAIL ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);} };

const base = { bookings:0, contractsWaiting:0, contractsTotal:0, trackingRows:0,
               adsPosted:0, adsTotal:0, reports:0, comments:0 };

// ── THE bug: every anchor must be a section that exists ────────────
const ids = new Set(PAGE_SECTION_IDS);
for (const e of pageIndex(base)) {
  eq(`"${e.label}" points at a real section (${e.anchor})`, ids.has(e.anchor.replace('#','')), true);
}
// and nothing on the page is unreachable
const reached = new Set(pageIndex(base).map(e => e.anchor.replace('#','')));
for (const id of PAGE_SECTION_IDS) {
  // 'activity' is reached by Comments; every id must be reachable by something
  eq(`#${id} is reachable from the index`, reached.has(id), true);
}

// ── Bookings ───────────────────────────────────────────────────────
const by = (rows, k) => rows.find(r => r.key === k);
eq('no bookings is not a problem',
   by(pageIndex(base),'bookings').flag, false);
eq('and reads grey',
   by(pageIndex(base),'bookings').tone, 'grey');
eq('a booking with no price is',
   by(pageIndex({...base, bookings:3, bookingsUnready:1}),'bookings').flag, true);
eq('amber while any is unready',
   by(pageIndex({...base, bookings:3, bookingsUnready:1}),'bookings').tone, 'amber');
eq('green once all are ready',
   by(pageIndex({...base, bookings:3, bookingsUnready:0}),'bookings').tone, 'green');

// ── Paperwork ──────────────────────────────────────────────────────
eq('none of the three done', by(pageIndex(base),'paperwork').count, '0/3');
eq('and is flagged',         by(pageIndex(base),'paperwork').flag, true);
eq('two of three',           by(pageIndex({...base, paperworkDone:2}),'paperwork').count, '2/3');
eq('two of three is amber',  by(pageIndex({...base, paperworkDone:2}),'paperwork').tone, 'amber');
eq('all three is green',     by(pageIndex({...base, paperworkDone:3}),'paperwork').tone, 'green');
eq('all three unflags',      by(pageIndex({...base, paperworkDone:3}),'paperwork').flag, false);
eq('cannot exceed the total', by(pageIndex({...base, paperworkDone:9}),'paperwork').count, '3/3');

// ── Vendor contracts ───────────────────────────────────────────────
eq('waiting on Legal flags',
   by(pageIndex({...base, contractsTotal:2, contractsWaiting:1}),'contracts').flag, true);
eq('all back is green',
   by(pageIndex({...base, contractsTotal:2, contractsWaiting:0}),'contracts').tone, 'green');
eq('it goes to its own card',
   by(pageIndex(base),'contracts').anchor, '#vendor-contracts');

// ── Ads posted ─────────────────────────────────────────────────────
eq('no ads is not amber',  by(pageIndex(base),'ads').tone, 'grey');
eq('and is not flagged',   by(pageIndex(base),'ads').flag, false);
eq('ads with none posted', by(pageIndex({...base, adsTotal:2, adsPosted:0}),'ads').tone, 'amber');
eq('is flagged',           by(pageIndex({...base, adsTotal:2, adsPosted:0}),'ads').flag, true);
eq('part way is blue',     by(pageIndex({...base, adsTotal:4, adsPosted:2}),'ads').tone, 'blue');
eq('all posted is green',  by(pageIndex({...base, adsTotal:4, adsPosted:4}),'ads').tone, 'green');
eq('counts read n/total',  by(pageIndex({...base, adsTotal:4, adsPosted:2}),'ads').count, '2/4');

// ── The two that used to go nowhere ────────────────────────────────
eq('Work & reports lands on #work', by(pageIndex(base),'work').anchor, '#work');
eq('Comments lands on #activity',   by(pageIndex(base),'comments').anchor, '#activity');

eq('eight entries', pageIndex(base).length, 8);
console.log(`\n${p} passed, ${f} failed`);
process.exit(f?1:0);
