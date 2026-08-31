// Browser-side Supabase client.
//
// Uses @supabase/ssr's createBrowserClient so the session is stored in cookies
// (not localStorage). Cookies are visible to the Next.js middleware running on
// the server, so the auth gate can actually see when you're signed in.
//
// Without this, the middleware reads cookies (sees nothing), redirects to
// /auth, and you get an infinite "auth → dashboard → auth" loop after signup.
//
// ── Why the cookie lifetime is set explicitly ──────────────────────
//
// Siraj: *"fix loggin in not keeping them in even after keep me logged in
// is checked"*.
//
// With no `maxAge`, the auth cookie is written as a SESSION cookie — no
// Expires attribute — and the browser throws it away when it closes.
// "Keep me logged in" was a checkbox over a cookie that was never going to
// survive the night, so it made no difference whether it was ticked: the
// preference was recorded in localStorage and nothing acted on the only
// thing that decides how long you stay signed in.
//
// So the checkbox now sets the cookie's lifetime, which is what a cookie
// lifetime is for:
//
//   ticked   — a persistent cookie that outlives the browser
//   unticked — a session cookie, which the browser drops on close by itself
//
// That also replaced a `pagehide` handler that called signOut() when the
// tab went away. `pagehide` fires on ordinary navigation as well as on
// close, and sessionStorage is per-tab, so an old tab left open from a
// session-only sign-in could sign out every other tab with it — the
// cookies are shared. Letting the browser expire its own cookie has none
// of those failure modes.

import { createBrowserClient } from '@supabase/ssr';

/** Where the "keep me logged in" choice is remembered between visits. */
export const REMEMBER_ME_KEY = 'aq_remember_me';

/**
 * 400 days — the longest a browser will honour. Chrome caps cookie
 * lifetimes there and silently truncates anything longer, so asking for
 * more is asking for a number that is not what you get.
 */
const REMEMBERED_MAX_AGE = 400 * 24 * 60 * 60;

/** True unless the person has explicitly said otherwise. */
export function rememberMeChosen(): boolean {
  if (typeof window === 'undefined') return true;
  try { return localStorage.getItem(REMEMBER_ME_KEY) !== '0'; } catch { return true; }
}

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        // Undefined maxAge = a session cookie, which is exactly what
        // "don't keep me logged in" should mean.
        maxAge: rememberMeChosen() ? REMEMBERED_MAX_AGE : undefined,
        path: '/',
        sameSite: 'lax',
        // Set on https only. On http://localhost a Secure cookie is simply
        // not stored, and the dev sign-in loop that causes is hard to spot.
        secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
      },
    },
  );
  return client;
}

/**
 * Record the choice and re-issue the cookies with the new lifetime.
 *
 * Called right after a successful sign-in. The client is a module
 * singleton created before the choice was known, so the preference is
 * written first and the session is then re-set — which makes
 * @supabase/ssr write the cookies again, this time with the right maxAge.
 */
export async function applyRememberMe(remember: boolean): Promise<void> {
  try { localStorage.setItem(REMEMBER_ME_KEY, remember ? '1' : '0'); } catch { /* private mode */ }

  // Drop the cached client so the next createClient() picks up the new
  // lifetime, then rewrite the cookies from the session we already hold.
  const current = client;
  client = null;
  if (!current) return;
  const { data: { session } } = await current.auth.getSession();
  if (!session) return;
  const fresh = createClient();
  await fresh.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}
