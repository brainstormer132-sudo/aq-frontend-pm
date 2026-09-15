/**
 * Light / dark theme.
 *
 * The whole app paints from the --aq-* variables in styles/globals.css, so
 * dark mode is one class on <html>: `html.dark` redefines the variables and
 * everything that reads them follows. This file owns the three things that
 * are not CSS:
 *
 *   * what the stored preference means (parseTheme / resolveTheme),
 *   * the script that runs BEFORE React so the first paint is already the
 *     right colour (THEME_BOOT_SCRIPT) - without it a dark user gets a white
 *     flash on every load, and
 *   * applyTheme, the one place that writes the class and the preference.
 *
 * No React, no window at module scope: the pure parts are unit-tested with
 * plain node (tests/theme.test.mjs).
 */

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

/** localStorage key. Same `aq_` prefix as the sidebar/invite keys. */
export const THEME_KEY = 'aq_theme';

/** The class html carries in dark mode; tailwind.config.js is darkMode:'class'. */
export const DARK_CLASS = 'dark';

/** Anything not exactly 'light' or 'dark' means "follow the OS". */
export function parseTheme(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** The theme to paint given the stored preference and the OS setting. */
export function resolveTheme(pref: ThemePreference, systemDark: boolean): Theme {
  if (pref === 'system') return systemDark ? 'dark' : 'light';
  return pref;
}

/** What the toggle switches to. Always explicit, never back to 'system'. */
export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

/**
 * Inline <script> for <head>. Runs synchronously before any content paints,
 * mirrors parseTheme/resolveTheme exactly, and never throws (private mode,
 * storage disabled, no matchMedia).
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{var t=localStorage.getItem('" + THEME_KEY + "');" +
  "var d=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);" +
  "if(d)document.documentElement.classList.add('" + DARK_CLASS + "');}catch(e){}})();";

/** Read the theme currently painted. Browser only. */
export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light';
}

/** Paint a theme and remember it. Browser only; safe when storage is blocked. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle(DARK_CLASS, theme === 'dark');
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
}
