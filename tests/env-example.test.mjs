/**
 * .env.example lists every variable, and only the ones that exist.
 *
 * THE PROBLEM THIS SOLVES: there was no list at all. SETUP.md used to name
 * some of them next to a Supabase project ref, and it was deleted for
 * naming the ref. So the only way to find out what a new deployment needs
 * was to grep the source for process.env - which is exactly what this file
 * does, except it does it on every push instead of once, badly, under time
 * pressure, in the middle of a migration to a new Vercel project.
 *
 * The failure it prevents is specific and quiet. A missing NEXT_PUBLIC_
 * variable does not crash the build; it compiles to `undefined` and the
 * app loads and then cannot reach Supabase. A missing CRON_SECRET does not
 * crash either - the routes refuse every request, which is the safe
 * direction but looks exactly like "the crons stopped working".
 *
 * Both directions matter:
 *
 *   code -> file   a variable nobody documented is a variable nobody sets
 *   file -> code   a variable nobody reads is a line in a setup guide that
 *                  sends the next person looking for a dashboard page that
 *                  does not matter
 *
 * NODE_ENV is excluded: node and Next set it, nobody configures it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0, fail = 0;
const ok = (name, c) => { if (c) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};

const ROOTS = ['app', 'lib', 'hooks', 'scripts'];
const SINGLE = ['middleware.ts'];
const BUILT_IN = new Set(['NODE_ENV']);

function sources(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'node_modules' && e !== '.next') sources(p, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e)) out.push(p);
  }
  return out;
}

const files = [...ROOTS.flatMap((r) => sources(r)), ...SINGLE];
const used = new Set();
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z_][A-Z_0-9]*)/g)) {
    if (!BUILT_IN.has(m[1])) used.add(m[1]);
  }
}

const example = readFileSync('.env.example', 'utf8');
const listed = new Set(
  Array.from(example.matchAll(/^([A-Z_][A-Z_0-9]*)=/gm), (m) => m[1]),
);

const undocumented = Array.from(used).filter((v) => !listed.has(v)).sort();
const unused = Array.from(listed).filter((v) => !used.has(v)).sort();

eq('every variable the code reads is in .env.example', undocumented, []);
eq('every variable in .env.example is read somewhere', unused, []);

// A floor, so a regex that stopped matching cannot pass this in silence.
ok(`the scan still finds the variables (${used.size})`, used.size >= 8);

// No value may ever be committed here. The file is a list of names.
const withValues = Array.from(example.matchAll(/^([A-Z_][A-Z_0-9]*)=(.+)$/gm), (m) => m[1]);
eq('no variable in .env.example has a value', withValues, []);

// The secret ones must not be NEXT_PUBLIC_, which would compile them into
// the browser bundle. This is the mistake that turns a service-role key
// into a public one, and it is a prefix away.
const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL', 'CRON_SECRET', 'ASANA_PAT'];
for (const s of secrets) {
  ok(`${s} is not exposed to the browser`, !used.has(`NEXT_PUBLIC_${s}`) && !listed.has(`NEXT_PUBLIC_${s}`));
}

console.log(`env-example: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
