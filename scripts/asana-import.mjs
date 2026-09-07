#!/usr/bin/env node
/**
 * Asana CSV -> SQL for the Supabase SQL editor.
 *
 *   node scripts/asana-import.mjs <export.csv> [<older-export.csv> ...] [--out <dir>] [--workspace <uuid>] [--chunk 1500]
 *
 * Extra CSVs fill in columns the first one lacks (Asana only exports the
 * fields currently visible on the project). They must be the same rows in
 * the same order; the script refuses otherwise.
 *
 * Writes `<dir>/report.md` (the dry run - read it first), then the SQL
 * files to run in name order:
 *
 *   01_registries.sql            lookups, clients, brands, vendors
 *   02_campaigns.sql             parent tasks
 *   03_bookings_NN_of_MM.sql     vendor subtasks
 *   04_ad_lines_NN_of_MM.sql     one ad line per booking
 *   99_wipe.sql                  remove everything the import created
 *
 * Migration 077 must be applied first. Every file is idempotent; re-run the
 * whole set after a fresh export and rows update in place.
 *
 * The logic lives in lib/asana-import.ts and is tested; this file only does
 * the reading and writing. It compiles that module with tsc into
 * .test-build/ the same way `npm test` does, so it runs against the same
 * code the tests ran against.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outBuild = join(root, '.test-build');

const args = process.argv.slice(2);
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { i++; continue; }
  positional.push(args[i]);
}
const [csvPath, ...extraPaths] = positional;
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
if (!csvPath) {
  console.error('usage: node scripts/asana-import.mjs <export.csv> [--out <dir>] [--workspace <uuid>] [--chunk 1500]');
  process.exit(1);
}
const outDir = resolve(opt('out', join('out', 'asana-import')));
const workspaceId = opt('workspace', null);
const chunk = Number(opt('chunk', '1500'));

// Compile the pure module (strict, same flags as scripts/run-tests.mjs).
const TSC = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(TSC)) {
  console.error('TypeScript is not installed. Run `npm ci` first.');
  process.exit(1);
}
mkdirSync(outBuild, { recursive: true });
execFileSync(process.execPath, [
  TSC, 'lib/asana-import.ts',
  '--outDir', outBuild, '--target', 'es2020', '--module', 'es2020', '--moduleResolution', 'node', '--strict',
], { cwd: root, stdio: 'inherit' });

const lib = await import(pathToFileURL(join(outBuild, 'asana-import.js')).href);

let text = readFileSync(resolve(csvPath), 'utf8');
for (const extra of extraPaths) {
  const merged = lib.mergeExports(text, readFileSync(resolve(extra), 'utf8'));
  text = merged.text;
  console.log(`Merged ${merged.added.length} column(s) from ${basename(extra)}: ${merged.added.join(', ') || '(none)'}`);
}
const read = lib.readRows(text);
const projectName = basename(csvPath).replace(/\.csv$/i, '').replace(/[_\s]*\(\d+\)$/, '');
const plan = lib.planImport(read.rows, projectName);
const files = lib.renderSql(plan, { workspaceId, chunk, projectName });

mkdirSync(outDir, { recursive: true });
const rep = lib.report(plan, read, basename(csvPath));
writeFileSync(join(outDir, 'report.md'), rep);
for (const f of files) writeFileSync(join(outDir, f.name), f.sql);

console.log(rep);
console.log(`Wrote ${files.length} SQL files to ${outDir}:`);
for (const f of files) console.log(`  ${f.name}  (${(f.sql.length / 1024).toFixed(0)} KB)`);
