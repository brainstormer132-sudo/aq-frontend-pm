import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth gate — redirects unauthenticated users to /auth, and authenticated
 * users away from /auth back to /dashboard. Uses Supabase SSR cookies.
 *
 * Perf note (2026-05-15): every Supabase `auth.getUser()` is a network
 * round-trip. We short-circuit on public / static paths BEFORE calling
 * it, so the public landing pages (/, /portals, /hub) and the static
 * contract maker (/contracts/*) don't pay an auth-roundtrip cost on
 * every CSS/JS asset they load. The matcher below also drops common
 * static asset extensions defensively.
 */

// Paths that never need a Supabase session check — public landing,
// the static contract maker, and the API-route that has its own auth.
const PUBLIC_PREFIXES = [
  '/portals',
  '/hub',
  '/contracts',     // includes /contracts/, /contracts/styles.css, etc.
  '/api/invites',   // hit by server-only code; does its own auth
];

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
