#!/usr/bin/env node
/**
 * Compile the pure libraries, then run every suite in tests/.
 *
 * â”€â”€ Why this exists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * The suites were real and they were good and they lived nowhere. They ran
 * when somebody remembered to run them, in a scratch directory, against a
 * hand-compiled copy of the library. So they protected the afternoon they
 * were written and nothing after it â€” which is the same failure as a backup
 * nobody has restored.
 *
 * This makes them a fixture of the repository: `npm test`, and the same
 * command in CI on every push.
 *
 * â”€â”€ Why there is no test framework â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 * Deliberately none. The suites are plain `.mjs` files that import the
 * compiled module, compare values, and print. That is the whole contract,
 * and it has two properties worth more here than anything Jest would add:
 *
 *   * **They test the REAL module.** tsc compiles `lib/*.ts` and the test
 *     imports the output. No transform, no module mocking, no chance of
 *     passing against something that is not what ships.
 *   * **There is nothing to keep working.** No config, no version drift, no
 *     morning where the runner breaks and the tests are skipped "for now".
 *
 * The rule that makes this possible is the one `lib/` already follows: pure
 * functions, no React, no Supabase, no argless `new Date()`. A library you
 * can test with `node file.mjs` is a library that was designed properly.
 *
 * â”€â”€ Adding a suite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 *
 *   1. Put `lib/<thing>.ts` in LIBS below if it is not there.
 *   2. Write `tests/<name>.test.mjs`, importing from
 *      `../.test-build/<thing>.js`.
 *   3. End it with the pass/fail line and `process.exit(fail ? 1 : 0)`.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.test-build');

/**
 * The compiler, found rather than shelled to.
 *
 * This used to be `execFileSync('npx', ['tsc', ...])`, which works on Linux
 * and CANNOT work on Windows: there is no `npx` there, only `npx.cmd`, and
 * execFile does not consult PATHEXT â€” that is a shell's job, and execFile
 * deliberately isn't one. `npm test` died with `spawnSync npx ENOENT` on the
 * only machine this repo is actually developed on.
 *
 * Reaching for `shell: true` would fix it and bring in a shell, quoting
 * rules, and a path with a space and a bracket in it ("New folder (3)").
 * TypeScript is a dependency and its entry point is a .js file, so the
 * portable thing is to run it with the Node we are already running:
 * no shell, no PATH, no platform difference.
 */
const TSC = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

/** The pure libraries under test. Anything importing React or Supabase is
 *  not on this list, and that is the point. */
const LIBS = [
  'lib/campaign-page.ts',
  'lib/ad-lines.ts',
  'lib/dashboard-data.ts',
  'lib/payment-schedule.ts',
  'lib/vendor-contracts.ts',
  'lib/tracking-sync.ts',
  'lib/attention.ts',
  'lib/contracts.ts',
  'lib/all-tasks.ts',
  'lib/asana-import.ts',
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

function compile() {
  // Clearing the output directory is a convenience, not a requirement: tsc
  // overwrites what it emits. Some sandboxed filesystems refuse the rmdir
  // with EPERM, and failing the whole suite over a directory we were only
  // tidying would be the runner breaking the tests rather than running
  // them. So: try, and carry on if the filesystem says no.
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch (err) {
    if (err?.code !== 'EPERM' && err?.code !== 'EBUSY' && err?.code !== 'ENOTEMPTY') throw err;
    console.log(`${DIM}  (could not clear ${outDir}: ${err.code} â€” reusing it)${OFF}`);
  }
  mkdirSync(outDir, { recursive: true });
  // Strict, and the same target the app builds with. A test that passes
  // against loosely-compiled output is testing something else.
  if (!existsSync(TSC)) {
    console.error(
      `${RED}TypeScript is not installed.${OFF}\n`
      + `Looked for ${TSC}. Run \`npm ci\` (or \`npm install\`) first.`,
    );
    process.exit(1);
  }
  execFileSync(process.execPath, [
    TSC, ...LIBS,
    '--outDir', outDir,
    '--target', 'es2020',
    '--module', 'es2020',
    '--moduleResolution', 'node',
    '--strict',
  ], { cwd: root, stdio: 'inherit' });
}

function run() {
  const suites = readdirSync(join(root, 'tests'))
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();

  if (!suites.length) {
    console.error('No suites found in tests/.');
    process.exit(1);
  }

  let totalPass = 0;
  let totalFail = 0;
  const broken = [];

  for (const file of suites) {
    // process.execPath, not 'node': the same reasoning as TSC above, plus it
    // guarantees the suites run under the Node that started the runner
    // rather than whichever one happens to be first on PATH.
    const res = spawnSync(process.execPath, [join(root, 'tests', file)], {
      cwd: root, encoding: 'utf8',
    });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    const m = /(\d+) passed, (\d+) failed/.exec(out);
    const passed = m ? Number(m[1]) : 0;
    const failed = m ? Number(m[2]) : 0;
    totalPass += passed;
    totalFail += failed;

    const name = file.replace(/\.test\.mjs$/, '');
    if (res.status === 0 && failed === 0 && m) {
      console.log(`${GREEN}  ok${OFF}  ${name.padEnd(16)} ${DIM}${passed} assertions${OFF}`);
    } else {
      broken.push(name);
      console.log(`${RED}FAIL${OFF}  ${name}`);
      // The suite's own output IS the failure report â€” it prints what it
      // got and what it wanted. Repeating that here would be a worse
      // version of a message the suite already wrote.
      console.log(out.split('\n').filter(Boolean).map((l) => `        ${l}`).join('\n'));
    }
  }

  console.log('');
  if (totalFail || broken.length) {
    console.log(`${RED}${totalFail} failed${OFF}, ${totalPass} passed Â· ${broken.join(', ')}`);
    process.exit(1);
  }
  console.log(`${GREEN}${totalPass} assertions passed${OFF} across ${suites.length} suites.`);
}

compile();
run();
