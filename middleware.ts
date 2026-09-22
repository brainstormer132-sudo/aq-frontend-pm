import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth gate — redirects unauthenticated users to /auth, and authenticated
 * users away from /auth back to /dashboard. Uses Supabase SSR cookies.
 *
 * Perf note (2026-05-15): every Supabase `auth.getUser()` is a network
 * round-trip. We short-circuit on public / static paths BEFORE calling
 * it, so the public landing page (/, /portals) and the backend proxy
 * (/contracts/api/*) don't pay an auth-roundtrip cost.
 * The matcher below also drops common static asset extensions defensively.
 */

// Paths that never need a Supabase session check — the public portal
// picker, and the proxied backend routes, which carry their own auth.
//
// `/hub` and the static contract maker that used to live under
// `/contracts/` are gone (Sep 2026); what remains under /contracts is the
// FastAPI proxy the portals still call, and that must stay public or every
// vendor sign-in pays an auth round-trip it cannot satisfy.
const PUBLIC_PREFIXES = [
  '/portals',
  '/contracts',     // /contracts/api/*, /contracts/health — the proxy only
];

/**
 * The two front doors of the app that no longer exists.
 *
 * Siraj: "lets remove the contract and pm app screen and create a clean
 * screen to log in to pm app since we dont need the contract app".
 *
 * `/hub` was the chooser - Project Management on one card, Contracts on the
 * other - and `/contracts/` was the contract maker itself. Both are deleted,
 * and both are in somebody's bookmarks, so they REDIRECT rather than 404.
 * /auth is the one login; middleware already sends a signed-in visitor there
 * straight on to the workflow, so for anybody still signed in this is a
 * single bounce into the app.
 *
 * Exact matches only. /contracts/api/* is the live proxy and must not be
 * touched by this.
 */
const RETIRED_ENTRY_POINTS = new Set(['/hub', '/hub/', '/contracts', '/contracts/']);

function isPublicPath(path: string): boolean {
  if (path === '/') return true;          // root redirects to /portals
  for (const p of PUBLIC_PREFIXES) {
    if (path === p || path.startsWith(p + '/') || path.startsWith(p + '?')) {
      return true;
    }
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // ── 0. The retired app's front doors. Before the public check, because
  //       /contracts is a public PREFIX and this is an exact path. ────────
  if (RETIRED_ENTRY_POINTS.has(path)) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ── 1. Public / static paths: return immediately, no Supabase call ──
  if (isPublicPath(path)) {
    return NextResponse.next({ request });
  }

  // ── 2. Stale-link defenses (cheap, no network) ──────────────────────
  if (path === '/dashboard' || path === '/dashboard/') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard/workflow';
    return NextResponse.redirect(url);
  }
  if (path.startsWith('/dashboard/dashboard/')) {
    const url = request.nextUrl.clone();
    url.pathname = path.replace('/dashboard/dashboard/', '/dashboard/');
    return NextResponse.redirect(url);
  }

  // ── 3. Auth-aware routes: now we pay the Supabase round-trip ────────
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Unauthenticated users hitting protected routes → /auth
  if (!user && path.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Authenticated users on /auth → /dashboard
  if (user && path.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    const nextPath = request.nextUrl.searchParams.get('next');
    url.pathname = nextPath && nextPath.startsWith('/') ? nextPath : '/dashboard/workflow';
    url.searchParams.delete('next');
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip Next internals, image optimization, common static asset
  // extensions (so `.css`, `.js`, `.html`, `.woff2`, `.map`, source
  // maps, etc. never invoke the middleware at all). Belt-and-braces
  // with the early return inside the function above.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|woff|woff2|ttf|otf|html|json|txt|xml|webmanifest)$).*)',
  ],
};
