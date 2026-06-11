/**
 * Supabase service-role client. SERVER-ONLY.
 *
 * Used for admin actions that need to bypass RLS — currently:
 *   - creating auth users for the "admin-creates-portal" team-invite flow
 *
 * NEVER import this from a client component. It must be referenced only
 * from API routes (`app/api/**\/route.ts`) or other server modules. The
 * service-role key is a god key for the project — leaking it to the
 * browser would let anyone bypass every RLS policy.
 *
 * Requires env var:
 *   SUPABASE_SERVICE_ROLE_KEY  (not prefixed NEXT_PUBLIC_)
 *
 * Add it in `.env.local` for dev, and in the Vercel project settings
 * (Production + Preview) for deployed environments.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase admin client misconfigured: missing NEXT_PUBLIC_SUPABASE_URL ' +
      'or SUPABASE_SERVICE_ROLE_KEY. Add SUPABASE_SERVICE_ROLE_KEY to ' +
      '.env.local (dev) and the Vercel environment vars (prod) and restart.'
    );
  }

  cached = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
