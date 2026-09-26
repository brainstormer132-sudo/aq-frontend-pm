#!/usr/bin/env node
/**
 * The SQL roll-up and the TypeScript roll-up must agree, row for row.
 *
 * -- WHY THIS EXISTS -----------------------------------------------
 *
 * Migration 143 moved Vendor Performance's group-by into the database,
 * because the screen was downloading every booking and every ad line in
 * the company to draw one row per vendor and took five minutes to open.
 *
 * Moving logic from a tested pure function into SQL is how a screen
 * quietly starts lying. `lib/vendor-performance.ts` has 40 assertions
 * behind it; a hand-translated CASE expression has none, and the failure
 * mode is not a crash - it is a reliability percentage that is three
 * points out, on a screen people use to decide who to book again.
 *
 * So neither is trusted. Both are run over the SAME randomised data and
 * every field of every row is compared. If they ever disagree, this says
 * which vendor, which field, and what each side said.
 *
 * -- WHY RANDOMISED ------------------------------------------------
 *
 * A handful of hand-written cases test the cases you thought of. The
 * interesting ones here are the combinations nobody would write down: a
 * line with a posted date and no due date, a cancelled line that also has
 * proof, a vendor whose every line is cancelled, a booking with no lines
 * at all, two vendors tied on everything so the sort order decides. A
 * seeded generator walks into all of those on its own, and the seed is
 * fixed so a failure is reproducible.
 *
 * Run by `npm run db:test` after the schema tests, so it runs in CI.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const url = process.env.PGURL || 'postgres://postgres@localhost:5432/aq_migration_test';
const TODAY = '2026-06-15';

/* -- a seeded generator, so a failure can be reproduced ------------- */

let seed = 20260926;
function reseed(n) { seed = n; }
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const maybe = (p) => rnd() < p;

function dateNear(base, spread) {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.floor((rnd() - 0.5) * spread));
  return d.toISOString().slice(0, 10);
}

const STATUSES = ['Not started', 'Scheduled', 'Shot', 'Posted', 'Cancelled'];

function build(draw = 0) {
  const vendors = [];
  const bookings = [];
  const lines = [];
  // Vendor ids that sort differently as text than as numbers, on purpose -
  // the tie-break compares them as text and this is what catches a change.
  for (const id of [2, 9, 10, 11, 100, 101, 7, 70, 700, 8, 80, 800]) vendors.push(id);

  let bId = 0;
  for (const v of vendors) {
    const nB = 1 + Math.floor(rnd() * 6);
    for (let i = 0; i < nB; i++) {
      // The draw is IN the id. Without it every draw reuses draw 0's booking
      // ids, `on conflict do nothing` skips them, and four of the five
      // comparisons quietly run against an empty workspace and pass.
      const id = `00000000-0000-4000-8000-${String(draw)}${String(++bId).padStart(11, '0')}`;
      bookings.push({
        id,
        vendorId: v,
        owed: maybe(0.15) ? null : Math.round(rnd() * 500000) / 100,
        paid: maybe(0.25) ? null : Math.round(rnd() * 400000) / 100,
      });
      // a booking with no lines at all is a real case
      const nL = maybe(0.12) ? 0 : Math.floor(rnd() * 14);
      for (let k = 0; k < nL; k++) {
        const status = pick(STATUSES);
        const due = maybe(0.2) ? null : dateNear(TODAY, 60);
        const posted = maybe(0.45) ? null : dateNear(TODAY, 60);
        lines.push({
          subtaskId: id,
          vendorId: v,
          status,
          dueDate: due,
          postedOn: posted,
          attached: maybe(0.25),
          link: maybe(0.25) ? 'https://example.test/p' : (maybe(0.2) ? '   ' : ''),
        });
      }
    }
  }
  // TWINS: identical in every field the sort looks at, so only the last
  // tie-break separates them - and that compares ids as TEXT, because the
  // TypeScript keys its map on a string. As numbers these go 5, 6, 50, 60,
  // 500, 600; as text they go 5, 50, 500, 6, 60, 600. Without a set of rows
  // that tie, that branch of the ORDER BY is never exercised and a change
  // from ::text to plain id passes unnoticed - which it did, the first time
  // this was mutation-tested.
  for (const v of [5, 50, 500, 6, 60, 600]) {
    const id = `00000000-0000-4000-8000-${String(draw)}${String(++bId).padStart(11, '0')}`;
    bookings.push({ id, vendorId: v, owed: 1000, paid: 250 });
    lines.push({
      subtaskId: id, vendorId: v, status: 'Posted',
      dueDate: '2026-06-01', postedOn: '2026-06-01',
      attached: false, link: '',
    });
  }

  return { bookings, lines };
}

/* -- put it in the database ---------------------------------------- */

function psql(sql) {
  const res = spawnSync('psql', [url, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(res.stderr || 'psql failed');
    process.exit(1);
  }
  return res.stdout;
}

const parentId = (draw) => `00000000-0000-4000-7000-${String(draw + 1).padStart(12, '0')}`;
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

function seedDb({ bookings, lines }, draw = 0) {
  const ws = `00000000-0000-4000-9000-${String(draw + 1).padStart(12, '0')}`;
  const who = '00000000-0000-4000-9000-0000000000ff';
  // Clear this draw's own probe data first. vendor_ad_lines has a generated
  // id and no natural key, so `on conflict do nothing` cannot protect it -
  // run this twice against one database without the delete and every line is
  // counted twice, which is exactly what happened the first time and made the
  // comparison read 4x on both sides.
  psql(`
    delete from public.vendor_ad_lines l
      using public.pm_tasks t
     where t.id = l.subtask_id and t.workspace_id = '${ws}';
    delete from public.pm_tasks where workspace_id = '${ws}';
  `);

  // The owner has to exist: workspaces.owner_id -> profiles.id -> auth.users.id.
  // Three rows of scaffolding so the probe data has somewhere legal to hang.
  psql(`
    insert into auth.users (id, email) values ('${who}', 'probe@example.test')
      on conflict (id) do nothing;
    insert into public.profiles (id, full_name) values ('${who}', 'Probe')
      on conflict (id) do nothing;
    insert into public.workspaces (id, name, slug, owner_id)
    values ('${ws}', 'perf probe ${draw}', 'perf-probe-${draw}', '${who}')
    on conflict (id) do nothing;
    insert into public.pm_tasks (id, workspace_id, title, creator_id, parent_task_id)
    values ('${parentId(draw)}', '${ws}', 'probe parent', '${who}', null)
    on conflict (id) do nothing;
  `);

  // The vendors themselves. Ids are chosen, not generated, because the sort's
  // last tie-break compares them as TEXT and "10" before "9" is the thing
  // being checked.
  const vIds = [...new Set(bookings.map((b) => b.vendorId))];
  psql(`insert into public.vendors (id, name) values
    ${vIds.map((v) => `(${v}, 'Vendor ${v}')`).join(',')}
    on conflict (id) do nothing;`);

  const bVals = bookings.map((b) => `('${b.id}', '${ws}', 'booking', '${who}',
    '${parentId(draw)}', ${b.vendorId}, ${b.owed ?? 'null'}, ${b.paid ?? 'null'})`).join(',\n');
  psql(`insert into public.pm_tasks
      (id, workspace_id, title, creator_id, parent_task_id, vendor_id, net_amount, vendor_payment_amount)
    values ${bVals} on conflict (id) do nothing;`);

  if (lines.length) {
    const lVals = lines.map((l) => `('${l.subtaskId}', 'ad', ${lit(l.status)},
      ${l.dueDate ? `'${l.dueDate}'` : 'null'}, ${l.postedOn ? `'${l.postedOn}'` : 'null'},
      ${l.attached}, ${lit(l.link)})`).join(',\n');
    psql(`insert into public.vendor_ad_lines
        (subtask_id, ad_type, status, due_date, posted_on, proof_of_posting_attached, proof_of_posting_link)
      values ${lVals};`);
  }
  return ws;
}

/* -- ask both sides ------------------------------------------------ */

function fromSql(ws) {
  const out = psql(`select vendor_id, ads, delivered, on_time, late, overdue, pending,
      missing_proof, coalesce(reliability_pct::text,''), needs_chasing,
      coalesce(last_posted_on::text,''), owed::text, paid::text, outstanding::text
    from public.vendor_performance_summary('${ws}', '${TODAY}');`);
  return out.split('\n').filter(Boolean).map((r) => {
    const c = r.split('|');
    return {
      vendorId: c[0], ads: +c[1], delivered: +c[2], onTime: +c[3], late: +c[4],
      overdue: +c[5], pending: +c[6], missingProof: +c[7],
      reliabilityPct: c[8] === '' ? null : +c[8],
      needsChasing: +c[9], lastPostedOn: c[10] === '' ? null : c[10],
      owed: Number(c[11]), paid: Number(c[12]), outstanding: Number(c[13]),
    };
  });
}

async function fromTs({ bookings, lines }) {
  const build = join(root, '.test-build', 'vendor-performance.js');
  if (!existsSync(build)) {
    console.error('No .test-build/vendor-performance.js - run `npm test` first.');
    process.exit(1);
  }
  const { vendorPerformance, vendorMoney } = await import(build);
  const perf = vendorPerformance(
    lines.map((l) => ({
      vendorId: l.vendorId,
      status: l.status,
      dueDate: l.dueDate,
      postedOn: l.postedOn,
      hasProof: Boolean(l.attached) || String(l.link ?? '').trim() !== '',
    })),
    TODAY,
  );
  const money = vendorMoney(bookings.map((b) => ({ vendorId: b.vendorId, owed: b.owed, paid: b.paid })));
  return perf.map((p) => {
    const m = money.get(String(p.vendorId)) ?? { owed: 0, paid: 0, outstanding: 0 };
    return { ...p, vendorId: String(p.vendorId), owed: m.owed, paid: m.paid, outstanding: m.outstanding };
  });
}

/* -- compare ------------------------------------------------------- */

const FIELDS = ['vendorId', 'ads', 'delivered', 'onTime', 'late', 'overdue', 'pending',
  'missingProof', 'reliabilityPct', 'needsChasing', 'lastPostedOn', 'owed', 'paid', 'outstanding'];

// Several independent draws, each in its own workspace so they cannot
// contaminate one another. One seed is one shape of data; five is a sweep.
const SEEDS = [20260926, 7, 4242, 991, 13];
let bad = 0;
let vendors = 0, lines = 0, bookings = 0;

for (let s = 0; s < SEEDS.length; s++) {
  reseed(SEEDS[s]);
  const data = build(s);
  const ws = seedDb(data, s);
  const sql = fromSql(ws);
  const ts = await fromTs(data);
  vendors += sql.length; lines += data.lines.length; bookings += data.bookings.length;

  if (sql.length !== ts.length) {
    console.log(`${RED}FAIL${OFF}  seed ${SEEDS[s]}: SQL returned ${sql.length} vendors, TypeScript ${ts.length}`);
    bad += 1;
    continue;
  }
  for (let i = 0; i < sql.length; i++) {
    for (const f of FIELDS) {
      const a = sql[i][f], b = ts[i][f];
      const same = (a === b)
        || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 0.005);
      if (!same) {
        bad += 1;
        // One disagreement usually means every row disagrees. Show the first
        // dozen and count the rest; a thousand identical lines is one fact.
        if (bad <= 12) {
          console.log(`${RED}FAIL${OFF}  seed ${SEEDS[s]} row ${i} (vendor ${sql[i].vendorId}) `
            + `field ${f}: SQL ${JSON.stringify(a)} vs TypeScript ${JSON.stringify(b)}`);
        }
      }
    }
  }
}

if (bad) {
  if (bad > 12) console.log(`${DIM}        ... and ${bad - 12} more disagreements${OFF}`);
  console.log(`\n${DIM}Migration 143's SQL and lib/vendor-performance.ts have drifted. `
    + `Whichever is wrong, they must not disagree - the screen reads one and the `
    + `tests cover the other.${OFF}`);
  process.exit(1);
}
console.log(`${GREEN}  ok${OFF}  SQL matches lib/vendor-performance.ts `
  + `${DIM}${SEEDS.length} draws, ${vendors} vendor rows, ${lines} lines, ${bookings} bookings${OFF}`);
