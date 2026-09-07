#!/usr/bin/env node
/**
 * Run every migration into an empty Postgres, then assert the security
 * properties the app depends on.
 *
 * ── Why this exists ───────────────────────────────────────────────
 *
 * Four of the five worst things found in this codebase were in SQL, and
 * every one of them was invisible from the application:
 *
 *   * `pm_task_campaign_rollup` served budget, cost and margin for every
 *     campaign to anyone with the public anon key — because a view without
 *     `security_invoker` runs as its owner and the owner is exempt from
 *     the table's own RLS.
 *   * `revoke select (price_excl) … from authenticated` was a no-op, since
 *     the table-level grant was still there. It had a comment calling it
 *     "belt and braces".
 *   * The contract-app tables never had RLS enabled at all, so
 *     `users.password_hash` was world-readable.
 *   * Invite tokens were listable by `anon`, which is a way into the
 *     portal without credentials.
 *
 * None of those would fail a typecheck, a build, or any test of the
 * TypeScript. They are properties of the database, so they need a test that
 * talks to a database.
 *
 * ── What it does ──────────────────────────────────────────────────
 *
 * Applies `supabase/migrations/*.sql` in order to a scratch database, then
 * runs `supabase/tests/*.sql`. A test file is ordinary SQL that raises an
 * exception when something is wrong; raising is failing.
 *
 * ── The baseline ──────────────────────────────────────────────────
 *
 * The numbered files 001–0xx are a CHANGELOG, not a rebuild path, and this
 * script is what proved it: 002 creates a policy on `pm_tasks` referencing
 * `workspace_id` — a column a later migration adds — and calls
 * `public.has_role`, which 006 defines. It has never been runnable against
 * an empty database. It only ever worked because it was applied by hand,
 * in order, to a database that had already drifted from what the files
 * describe.
 *
 * Fixing 79 files of history is archaeology with no prize at the end. The
 * standard fix is a BASELINE:
 *
 *     pg_dump --schema-only --no-owner --no-privileges "$PROD_URL" \
 *       > supabase/migrations/000_baseline.sql
 *
 * That file is the schema as it really is. Everything numbered above it
 * replays on top of it, and from that day on the files and the database
 * agree — which is the property this whole script exists to protect.
 *
 * When `000_baseline.sql` is present, everything below the highest
 * migration already contained in it should be moved to
 * supabase/migrations/archive/ so the replay starts from the baseline.
 *
 * ── Two things it deliberately does not do ────────────────────────
 *
 *  * **It does not touch production.** It needs a throwaway database and
 *    refuses anything whose URL is not local.
 *  * **It does not claim production matches.** Migrations here have been
 *    applied by hand in the SQL editor since at least 044, so this proves
 *    the FILES are correct, not that the live database agrees with them.
 *    That is a real gap and closing it is a separate job — but a suite that
 *    proves the files are right is the thing you need before you can ever
 *    trust them to describe production.
 *
 * Usage:
 *   PGURL=postgres://postgres@localhost:5432/aq_test npm run db:test
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = join(root, 'supabase', 'migrations');
const testDir = join(root, 'supabase', 'tests');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

const url = process.env.PGURL || 'postgres://postgres@localhost:5432/aq_migration_test';

// Refuse anything that is not obviously a scratch database. These files
// drop policies and rewrite functions; pointed at production they would be
// a very bad afternoon.
if (!/@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(url)) {
  console.error(
    `${RED}Refusing to run against ${url}${OFF}\n`
    + 'This applies every migration to the target. Point PGURL at a local, '
    + 'throwaway database.',
  );
  process.exit(1);
}

function psql(args, opts = {}) {
  return spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8', ...opts,
  });
}

/* ── 1. Apply every migration, in order ──────────────────────────── */

// The Supabase-shaped scaffolding first — roles, the auth schema,
// auth.uid(). Without it every migration fails for a reason that is not
// about the migration.
const bootstrap = join(testDir, '000_bootstrap.sql');
if (existsSync(bootstrap)) {
  const b = psql(['-q', '-f', bootstrap]);
  if (b.status !== 0) {
    console.error(b.stderr);
    process.exit(1);
  }
}

const files = readdirSync(migrations)
  .filter((f) => f.endsWith('.sql') && !/DRYRUN/i.test(f))
  .sort();

const hasBaseline = files.some((f) => /^000_baseline/.test(f));
if (!hasBaseline) {
  console.log(
    `${DIM}No 000_baseline.sql. Replaying the full history, which has never `
    + `been known to work — see the note at the top of this file.${OFF}\n`,
  );
}

console.log(`Applying ${files.length} migrations…\n`);

let applied = 0;
for (const f of files) {
  const res = psql(['-q', '-f', join(migrations, f)]);
  if (res.status !== 0) {
    console.log(`${RED}FAIL${OFF}  ${f}`);
    console.log((res.stderr || '').split('\n').slice(0, 12)
      .map((l) => `        ${l}`).join('\n'));
    console.log(
      `\n${DIM}A migration that cannot be applied to an empty database is a `
      + `migration that cannot be applied to a new environment.${OFF}`,
    );
    process.exit(1);
  }
  applied += 1;
}
console.log(`${GREEN}  ok${OFF}  ${applied} migrations applied cleanly\n`);

/* ── 2. Assert what the schema must be true about ────────────────── */

if (!existsSync(testDir)) {
  console.log(`${DIM}No supabase/tests/ yet — schema applied, nothing asserted.${OFF}`);
  process.exit(0);
}

const tests = readdirSync(testDir)
  .filter((f) => f.endsWith('.sql') && f !== '000_bootstrap.sql')
  .sort();
let failed = 0;

for (const t of tests) {
  const res = psql(['-q', '-f', join(testDir, t)]);
  const name = t.replace(/\.sql$/, '');
  if (res.status === 0) {
    console.log(`${GREEN}  ok${OFF}  ${name}`);
  } else {
    failed += 1;
    console.log(`${RED}FAIL${OFF}  ${name}`);
    // The assertion's own message says what broke.
    const msg = (res.stderr || '').split('\n')
      .filter((l) => /ERROR|DETAIL|HINT/.test(l)).slice(0, 6);
    console.log(msg.map((l) => `        ${l}`).join('\n'));
  }
}

console.log('');
if (failed) {
  console.log(`${RED}${failed} schema test(s) failed${OFF}`);
  process.exit(1);
}
console.log(`${GREEN}${tests.length} schema tests passed${OFF}`);
