import {
  parseTheme, resolveTheme, nextTheme, THEME_BOOT_SCRIPT, THEME_KEY, DARK_CLASS,
} from '../.test-build/theme.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
}

// parseTheme: only the two exact strings are preferences; the rest is "system"
eq('light parses', parseTheme('light'), 'light');
eq('dark parses', parseTheme('dark'), 'dark');
eq('null is system', parseTheme(null), 'system');
eq('garbage is system', parseTheme('DARK'), 'system');
eq('undefined is system', parseTheme(undefined), 'system');

// resolveTheme: explicit wins, system follows the OS
eq('explicit dark on light OS', resolveTheme('dark', false), 'dark');
eq('explicit light on dark OS', resolveTheme('light', true), 'light');
eq('system follows dark OS', resolveTheme('system', true), 'dark');
eq('system follows light OS', resolveTheme('system', false), 'light');

// nextTheme: a toggle, never "system"
eq('dark -> light', nextTheme('dark'), 'light');
eq('light -> dark', nextTheme('light'), 'dark');

// The boot script must agree with resolveTheme. Run it against a fake DOM.
function boot(stored, osDark) {
  const classes = new Set();
  const sandbox = {
    localStorage: { getItem: (k) => (k === THEME_KEY ? stored : null) },
    window: { matchMedia: (q) => ({ matches: osDark && q.includes('dark') }) },
    document: { documentElement: { classList: { add: (c) => classes.add(c) } } },
  };
  new Function('localStorage', 'window', 'document', THEME_BOOT_SCRIPT)(
    sandbox.localStorage, sandbox.window, sandbox.document,
  );
  return classes.has(DARK_CLASS) ? 'dark' : 'light';
}
for (const stored of ['light', 'dark', null, 'junk']) {
  for (const osDark of [true, false]) {
    eq(`boot(${stored}, os=${osDark}) matches resolveTheme`,
      boot(stored, osDark), resolveTheme(parseTheme(stored), osDark));
  }
}

// The boot script never throws when storage is blocked
{
  const throwing = { getItem: () => { throw new Error('blocked'); } };
  let threw = false;
  try {
    new Function('localStorage', 'window', 'document', THEME_BOOT_SCRIPT)(
      throwing, {}, { documentElement: { classList: { add: () => {} } } },
    );
  } catch { threw = true; }
  eq('boot script swallows storage errors', threw, false);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
