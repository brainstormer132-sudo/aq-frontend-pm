/**
 * searchEntities: one box over clients and vendors, and a client is found by
 * any of its brands as readily as by its company name. A brand match resolves
 * to the client that owns it, so the Clients and Data search boxes both reach
 * a client when someone types a brand instead of the registered company name.
 */
import { searchEntities } from '../.test-build/dashboard-data.js';

let p = 0, f = 0;
const eq = (n, g, w) => {
  if (JSON.stringify(g) === JSON.stringify(w)) p++;
  else { f++; console.log(`FAIL ${n}: ${JSON.stringify(g)} != ${JSON.stringify(w)}`); }
};

const clients = [
  { id: 'c1', company_name: 'Coffee Company LLC', cr_number: '1010', vat_number: null },
  { id: 'c2', company_name: 'Gold Shop', cr_number: null, vat_number: null },
];
const vendors = [];
const brands = new Map([['c1', ['PocoDor', 'Badie']], ['c2', ['Aurora']]]);

// a brand finds its client
{
  const hits = searchEntities('pocodor', clients, vendors, brands);
  eq('a brand matches', hits.length, 1);
  eq('and resolves to the owning client, tagged as a brand match',
     [hits[0].id, hits[0].kind, hits[0].matched], ['c1', 'client', 'brand']);
}

// the company name still finds the client
{
  const hits = searchEntities('gold', clients, vendors, brands);
  eq('company name still matches', [hits[0].id, hits[0].matched], ['c2', 'name']);
}

// a client is found by any of its several brands
eq('a second brand of the same client also matches',
   searchEntities('badie', clients, vendors, brands)[0]?.id, 'c1');

// with no brand map, a brand no longer matches (and nothing else does)
eq('without the brand map a brand finds nothing',
   searchEntities('aurora', clients, vendors).length, 0);

console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
