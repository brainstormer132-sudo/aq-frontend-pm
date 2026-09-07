import { pageIndex, PAGE_SECTION_IDS, indexProgress } from '../.test-build/campaign-page.js';
let p=0,f=0;
const eq=(n,g,w)=>{ if(JSON.stringify(g)===JSON.stringify(w)) p++; else {f++;console.log(`FAIL ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`);} };
const base = { bookings:0, contractsWaiting:0, contractsTotal:0, trackingRows:0,
               adsPosted:0, adsTotal:0, reports:0, comments:0 };
const by = (rows,k) => rows.find(r => r.key===k);

// ── anchors still all real, nothing unreachable ────────────────────
const ids = new Set(PAGE_SECTION_IDS);
for (const e of pageIndex(base)) eq(`${e.label} → real section`, ids.has(e.anchor.replace('#','')), true);
const reached = new Set(pageIndex(base).map(e=>e.anchor.replace('#','')));
for (const id of PAGE_SECTION_IDS) eq(`#${id} reachable`, reached.has(id), true);

// ── the thing that makes the ring honest ───────────────────────────
eq('Work has no settled state',     by(pageIndex(base),'work').step, 'none');
eq('Comments has no settled state', by(pageIndex(base),'comments').step, 'none');
eq('so six are counted, not eight', indexProgress(pageIndex(base)).total, 6);

// A brand-new campaign: nothing settled.
// With nothing missing on the campaign row itself, Campaign is already
// settled — so a bare campaign starts at 1 of 6, not 0.
eq('new campaign done',  indexProgress(pageIndex(base)).done, 1);
eq('new campaign line',  indexProgress(pageIndex(base)).line, '1 of 6');
eq('new campaign pct',   indexProgress(pageIndex(base)).pct, 17);

// Exactly one "next", and it is the FIRST unsettled one.
{
  const rows = pageIndex(base);
  eq('one next only', rows.filter(r=>r.step==='next').length, 1);
  eq('and it is the first unsettled', rows.find(r=>r.step==='next').key, 'bookings');
  // campaign settled by default (campaignMissing defaults to 0)
  eq('campaign settled with nothing missing', by(rows,'campaign').step, 'done');
}
{
  const rows = pageIndex({...base, campaignMissing:2});
  eq('missing fields unsettles the campaign', by(rows,'campaign').step, 'next');
  eq('and flags it', by(rows,'campaign').flag, true);
  eq('bookings then queue behind it', by(rows,'bookings').step, 'todo');
}

// ── everything settled reaches the end ─────────────────────────────
{
  const all = { bookings:2, bookingsUnready:0, contractsWaiting:0, contractsTotal:2,
                trackingRows:4, adsPosted:4, adsTotal:4, reports:0, comments:0,
                paperworkDone:3, campaignMissing:0,
                trackingPublished:true, trackingStale:false };
  const rows = pageIndex(all);
  eq('nothing is next',     rows.filter(r=>r.step==='next').length, 0);
  eq('nothing is todo',     rows.filter(r=>r.step==='todo').length, 0);
  eq('six ticks',           rows.filter(r=>r.step==='done').length, 6);
  const pr = indexProgress(rows);
  eq('reads all settled',   pr.line, 'all settled');
  eq('and hits 100',        pr.pct, 100);
  eq('6 of 6',              [pr.done, pr.total], [6,6]);
}

// ── each rule, on its own ──────────────────────────────────────────
// Unsettled AND first in line reads as `next`; the assertion that matters is
// that it is not `done`.
eq('bookings: none is not settled',   by(pageIndex(base),'bookings').step !== 'done', true);
eq('bookings: unpriced is not',       by(pageIndex({...base,bookings:2,bookingsUnready:1}),'bookings').step !== 'done', true);
eq('bookings: all ready is',          by(pageIndex({...base,bookings:2,bookingsUnready:0}),'bookings').step, 'done');
// ...and once it is settled, the marker moves on to whatever is next.
eq('next moves down the list',        pageIndex({...base,bookings:2,bookingsUnready:0}).find(r=>r.step==='next').key, 'paperwork');
eq('paperwork: 2/3 is not',           by(pageIndex({...base,paperworkDone:2}),'paperwork').step !== 'done', true);
eq('paperwork: 3/3 is',               by(pageIndex({...base,paperworkDone:3}),'paperwork').step, 'done');
eq('contracts: waiting is not',       by(pageIndex({...base,contractsTotal:2,contractsWaiting:1}),'contracts').step !== 'done', true);
eq('contracts: all back is',          by(pageIndex({...base,contractsTotal:2,contractsWaiting:0}),'contracts').step, 'done');
// Rows on a sheet nobody published is not the job being done.
eq('tracking: rows alone is not',     by(pageIndex({...base,trackingRows:5}),'tracking').step !== 'done', true);
eq('tracking: published is',          by(pageIndex({...base,trackingRows:5,trackingPublished:true}),'tracking').step, 'done');
eq('tracking: drifted is not',        by(pageIndex({...base,trackingRows:5,trackingPublished:true,trackingStale:true}),'tracking').step !== 'done', true);
eq('tracking: drifted flags',         by(pageIndex({...base,trackingRows:5,trackingPublished:true,trackingStale:true}),'tracking').flag, true);
eq('ads: none posted is not',         by(pageIndex({...base,adsTotal:3,adsPosted:0}),'ads').step !== 'done', true);
eq('ads: all posted is',              by(pageIndex({...base,adsTotal:3,adsPosted:3}),'ads').step, 'done');
eq('ads: no ads at all is not',       by(pageIndex(base),'ads').step !== 'done', true);

// A section with no settled state never counts, however busy it is.
eq('20 comments still uncounted', indexProgress(pageIndex({...base, comments:20, reports:9})).total, 6);
eq('and stays step:none',         by(pageIndex({...base, comments:20}),'comments').step, 'none');

eq('eight entries', pageIndex(base).length, 8);
eq('empty list is safe', indexProgress([]), { done:0, total:0, pct:0, line:'nothing to settle' });

console.log(`\n${p} passed, ${f} failed`);
process.exit(f?1:0);
