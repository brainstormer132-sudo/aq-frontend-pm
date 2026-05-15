// Browser-side Supabase client.
//
// Uses @supabase/ssr's createBrowserClient so the session is stored in cookies
// (not localStorage). Cookies are visible to the Next.js middleware running on
// the server, so the auth gate can actually see when you're signed in.
//
// Without this, the middleware reads cookies (sees nothing), redirects to
// /auth, and you get an infinite "auth → dashboard → auth" loop after signup.

import { createBrowserClient } from '@supabase/ssr';

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
