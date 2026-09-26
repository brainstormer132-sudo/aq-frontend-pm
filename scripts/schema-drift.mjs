#!/usr/bin/env node
/**
 * Does the LIVE database still match the migration files?
 *
 * -- WHY THIS EXISTS ------------------------------------------------
 *
 * scripts/test-migrations.mjs replays every migration into an empty
 * Postgres and asserts the security properties, and CI runs it on every
 * push. Its own header is careful about what that proves:
 *
 *     "It does not claim production matches. Migrations here have been
 *      applied by hand in the SQL editor since at least 044, so this
 *      proves the FILES are correct, not that the live database agrees
 *      with them."
 *
 * That gap has no consequences right up until the day somebody builds a
 * new project from the files and copies the data across. Then a column
 * that exists in one and not the other is a failed import, at the worst
 * possible moment, with the old project already being decommissioned.
 *
 * This closes it. The replay's shape is recorded as a fingerprint per
 * table - its columns AND its grants; the live database is asked for the
 * same thing; anything that disagrees is printed. NO OUTPUT IS THE GOOD
 * ANSWER.
 *
 * -- WHY GRANTS, AFTER THE FACT ------------------------------------
 *
 * The first version hashed columns only, and on 26 September it reported
 * all 76 tables in agreement - truthfully, about columns. On that same
 * database `anon` held TRUNCATE on FIFTY tables, because migration 075
 * had never been applied to production. TRUNCATE is the one privilege
 * row-level security does not gate; the check written to find a migration
 * that never ran was looking past the migration that never ran.
 *
 * Columns break a data copy. Grants break who can read it. A fingerprint
 * whose job is "do the files and the live database still describe the
 * same database" needs both.
 *
 * -- WHY A FINGERPRINT AND NOT A DUMP ------------------------------
 *
 * Because the answer has to be READ. A schema dump of both sides and a
 * diff produces thousands of lines that differ in ways nobody cares about
 * - ownership, statistics targets, the order pg_dump felt like emitting
 * things in. Two short hashes per table - over (column, type, nullable)
 * and over (role, privilege) - are the parts that actually break a move,
 * and the report is three lines instead of three thousand.
 *
 * -- MODES ---------------------------------------------------------
 *
 *   --write   read PGURL (the scratch database test-migrations just
 *             built) and write scripts/schema-fingerprint.txt
 *   --check   read PGURL and fail if it disagrees with that file. This
 *             is what keeps the file from rotting: it runs in CI right
 *             after the replay, so a migration that changes a table and
 *             does not update the fingerprint fails the build.
 *   --sql     WRITE a self-contained SQL block, with the committed
 *             fingerprints embedded, to drift.sql, to run against
 *             PRODUCTION. It returns only the differences.
 *
 *             It writes the file itself rather than printing for the
 *             shell to redirect, and that is not fussiness. On the only
 *             machine this repo is developed on, `npm run db:drift >
 *             drift.sql` produces a file that psql cannot read at all,
 *             for two separate reasons at once: npm prints its own two
 *             banner lines to stdout and they land in the file, and
 *             PowerShell's `>` writes UTF-16LE with a byte-order mark.
 *             A step that cannot be piped cannot be got wrong.
 *
 * The three modes exist so that the file is generated, verified and used
 * by the same code. A fingerprint file maintained by hand is a file that
 * is wrong by the second week.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(root, 'scripts', 'schema-fingerprint.txt');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

/**
 * One row per base table in public and legal:
 *
 *     schema.table|columns-hash|column-count|grants-hash
 *
 * -- WHY GRANTS ARE IN HERE ----------------------------------------
 *
 * They were not, and that cost something real. On 26 September this file
 * reported that production and the migrations agreed on all 76 tables -
 * and they did, on columns. At the same moment `anon` held TRUNCATE on
 * FIFTY tables in production and on none in the replay, because
 * migration 075 had never been applied there. TRUNCATE is the one
 * privilege row-level security does not gate, and the check that exists
 * to find exactly this kind of gap was looking straight past it.
 *
 * Columns break a data copy; grants break who can read it. Both belong
 * in a fingerprint whose whole job is "do the files and the live
 * database still describe the same database".
 *
 * Only anon, authenticated and service_role are hashed. Those are the
 * three roles a Supabase client can ever be, and the owner's own
 * privileges are noise that differs between a scratch replay and a
 * managed project for reasons nobody can act on.
 *
 * Read from pg_class.relacl through aclexplode rather than from
 * information_schema.role_table_grants, because the information_schema
 * views show only grants involving roles the CALLER belongs to - so the
 * same query can answer differently for two people, which is not a
 * property a fingerprint may have.
 */
const QUERY = `
with cols as (
  select c.table_schema as s, c.table_name as t,
         left(md5(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable,
                             ',' order by c.column_name)), 8) as h,
         count(*)::int as n
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema
     and tb.table_name   = c.table_name
     and tb.table_type   = 'BASE TABLE'
   where c.table_schema in ('public', 'legal')
   group by 1, 2
),
grants as (
  select n.nspname as s, cl.relname as t,
         left(md5(string_agg(g.rolname || ':' || a.privilege_type,
                             ',' order by g.rolname, a.privilege_type)), 8) as h
    from pg_class cl
    join pg_namespace n on n.oid = cl.relnamespace
    left join lateral aclexplode(cl.relacl) a on true
    left join pg_roles g
      on g.oid = a.grantee
     and g.rolname in ('anon', 'authenticated', 'service_role')
   where n.nspname in ('public', 'legal') and cl.relkind = 'r'
   group by 1, 2
)
select cols.s || '.' || cols.t || '|' || cols.h || '|' || cols.n::text
       || '|' || coalesce(grants.h, 'none')
  from cols
  left join grants on grants.s = cols.s and grants.t = cols.t
 order by 1;
`;

function fingerprintFrom(url) {
  const res = spawnSync('psql', [url, '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', QUERY], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error(res.stderr || 'psql failed');
    process.exit(1);
  }
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean).sort();
}

const mode = process.argv[2] ?? '--check';
const url = process.env.PGURL || 'postgres://postgres@localhost:5432/aq_migration_test';

if (mode === '--sql') {
  if (!existsSync(FILE)) {
    console.error('No scripts/schema-fingerprint.txt. Run `npm run db:test` first.');
    process.exit(1);
  }
  const rows = readFileSync(FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const values = rows.map((r) => {
    const [tbl, cols, n, grants] = r.split('|');
    return `    ('${tbl}', '${cols}', ${n}, '${grants}')`;
  }).join(',\n');

  const out = join(root, 'drift.sql');
  writeFileSync(out, `-- Does the LIVE database still match the migration files?
--
-- Expected fingerprints below come from a real replay of every migration
-- in this repository. This returns ONLY what disagrees.
--
-- NO ROWS IS THE GOOD ANSWER.
--
-- Generated by: node scripts/schema-drift.mjs --sql

with expected(tbl, cols, n, grants) as (values
${values}
),
live_cols as (
  select c.table_schema || '.' || c.table_name as tbl,
         left(md5(string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable,
                             ',' order by c.column_name)), 8) as cols,
         count(*)::int as n
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema
     and t.table_name   = c.table_name
     and t.table_type   = 'BASE TABLE'
   where c.table_schema in ('public', 'legal')
   group by c.table_schema, c.table_name
),
live_grants as (
  -- anon, authenticated and service_role only, read from the ACL itself:
  -- information_schema.role_table_grants answers differently depending on
  -- who is asking, which a fingerprint may not do.
  select n.nspname || '.' || cl.relname as tbl,
         left(md5(string_agg(g.rolname || ':' || a.privilege_type,
                             ',' order by g.rolname, a.privilege_type)), 8) as grants
    from pg_class cl
    join pg_namespace n on n.oid = cl.relnamespace
    left join lateral aclexplode(cl.relacl) a on true
    left join pg_roles g
      on g.oid = a.grantee
     and g.rolname in ('anon', 'authenticated', 'service_role')
   where n.nspname in ('public', 'legal') and cl.relkind = 'r'
   group by 1
),
live as (
  select c.tbl, c.cols, c.n, coalesce(g.grants, 'none') as grants
    from live_cols c left join live_grants g on g.tbl = c.tbl
)
select coalesce(e.tbl, l.tbl) as table_name,
       case
         when l.tbl is null then 'IN THE FILES, NOT IN LIVE'
         when e.tbl is null then 'IN LIVE, NOT IN THE FILES'
         when e.cols is distinct from l.cols
          and e.grants is distinct from l.grants then 'COLUMNS AND GRANTS DIFFER'
         when e.cols is distinct from l.cols then 'COLUMNS DIFFER'
         else 'GRANTS DIFFER'
       end as what,
       e.n as files_columns,
       l.n as live_columns
  from expected e
  full outer join live l on l.tbl = e.tbl
 where e.tbl is null
    or l.tbl is null
    or e.cols is distinct from l.cols
    or e.grants is distinct from l.grants
 order by 2, 1;

-- When a GRANTS row comes back, this says which privileges differ. It is
-- the query that would have found migration 075 unapplied - fifty tables
-- where anon held TRUNCATE in production and in no replay ever run.
-- select n.nspname || '.' || cl.relname as tbl, g.rolname, a.privilege_type
--   from pg_class cl
--   join pg_namespace n on n.oid = cl.relnamespace,
--        lateral aclexplode(cl.relacl) a
--   join pg_roles g on g.oid = a.grantee
--  where n.nspname in ('public', 'legal') and cl.relkind = 'r'
--    and g.rolname in ('anon', 'authenticated')
--    and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
--  order by 1, 2, 3;
`, 'utf8');
  console.log(`${GREEN}  ok${OFF}  wrote drift.sql ${DIM}${rows.length} tables${OFF}`);
  console.log(`${DIM}Run it against production with:`
    + `\n  psql "$env:PROD_URL" -q -f drift.sql`
    + `\nNo rows is the good answer.${OFF}`);
  process.exit(0);
}

const now = fingerprintFrom(url);

if (mode === '--write') {
  writeFileSync(FILE, now.join('\n') + '\n');
  console.log(`${GREEN}  ok${OFF}  schema fingerprint written ${DIM}${now.length} tables${OFF}`);
  process.exit(0);
}

if (mode !== '--check') {
  console.error(`Unknown mode ${mode}. Use --write, --check or --sql.`);
  process.exit(1);
}

if (!existsSync(FILE)) {
  console.log(`${DIM}No scripts/schema-fingerprint.txt yet - writing it.${OFF}`);
  writeFileSync(FILE, now.join('\n') + '\n');
  process.exit(0);
}

const want = readFileSync(FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).sort();
const wantMap = new Map(want.map((r) => [r.split('|')[0], r]));
const nowMap = new Map(now.map((r) => [r.split('|')[0], r]));

const added = now.filter((r) => !wantMap.has(r.split('|')[0]));
const gone = want.filter((r) => !nowMap.has(r.split('|')[0]));
const changed = now.filter((r) => {
  const k = r.split('|')[0];
  return wantMap.has(k) && wantMap.get(k) !== r;
});

if (!added.length && !gone.length && !changed.length) {
  console.log(`${GREEN}  ok${OFF}  schema fingerprint matches ${DIM}${now.length} tables${OFF}`);
  process.exit(0);
}

console.log(`${RED}FAIL${OFF}  the replayed schema no longer matches scripts/schema-fingerprint.txt`);
for (const r of gone) console.log(`        gone     ${r.split('|')[0]}`);
for (const r of added) console.log(`        new      ${r.split('|')[0]}`);
for (const r of changed) {
  const k = r.split('|')[0];
  const [, wc, , wg] = wantMap.get(k).split('|');
  const [, nc, , ng] = r.split('|');
  const what = [wc !== nc ? 'columns' : null, wg !== ng ? 'grants' : null]
    .filter(Boolean).join(' and ');
  console.log(`        changed  ${k} ${DIM}(${what})${OFF}`);
}
console.log(`\n${DIM}If a migration in this change was meant to do that, refresh the file:`
  + `\n  PGURL=<scratch db> node scripts/schema-drift.mjs --write`
  + `\nand commit it with the migration. The file is how the live database is`
  + `\nchecked before a move, so it is only useful while it is current.${OFF}`);
process.exit(1);
