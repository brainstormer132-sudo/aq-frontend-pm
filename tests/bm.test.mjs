import { brandMark } from '../.test-build/campaign-page.js';
let p=0,f=0;
const eq=(n,g,w)=>{ if(JSON.stringify(g)===JSON.stringify(w)) p++; else {f++;console.log(`FAIL ${n}: ${JSON.stringify(g)} != ${JSON.stringify(w)}`);} };
const ok=(n,c)=>{ if(c) p++; else {f++;console.log('FAIL '+n);} };

// The one property that matters: stable.
const a = brandMark('Dressing Room');
eq('same name, same colour', brandMark('Dressing Room'), a);
eq('and again',              brandMark('Dressing Room'), a);
ok('different names differ', JSON.stringify(brandMark('Brand Ripplr')) !== JSON.stringify(a));

// An anagram must not collide — a plain char-code sum would.
ok('anagrams differ', JSON.stringify(brandMark('Ripplr')) !== JSON.stringify(brandMark('Rlpprri')));

// No client yet is stone, not a colour that implies a brand.
eq('no client', brandMark(null), { from: '#78716c', to: '#a8a29e' });
eq('blank',     brandMark('   '), { from: '#78716c', to: '#a8a29e' });
eq('not a string', brandMark(42), { from: '#78716c', to: '#a8a29e' });

// Always a real pair of hexes.
for (const n of ['A','شركة عالم الاعمال','Bright Studios FZ-LLC','x'.repeat(300),'Alya Khalil']) {
  const m = brandMark(n);
  ok(`${n.slice(0,18)} → hex pair`, /^#[0-9a-f]{6}$/.test(m.from) && /^#[0-9a-f]{6}$/.test(m.to));
}

// Spread: 60 names should not all land on one or two pairs.
const seen = new Set();
for (let i=0;i<60;i++) seen.add(JSON.stringify(brandMark('Client number ' + i)));
ok(`spread across pairs (${seen.size} of 10)`, seen.size >= 6);

console.log(`\n${p} passed, ${f} failed`);
process.exit(f?1:0);
