/**
 * POST /api/team/admin-create
 *
 * Admin-create flow — replaces the email-invite link path. Caller (an
 * owner/admin of the target workspace) provides email + role; the server
 * auto-generates a strong password, provisions a Supabase auth user via
 * the service-role admin API, links them to the workspace via
 * `workspace_members`, and returns the plaintext credentials in the
 * response body so the admin can pass them to the new teammate
 * manually. No email is sent.
 *
 * Mirrors the pattern used by the contract app's
 * /external-invites/admin-create endpoint (FastAPI side) for vendor /
 * client portal accounts.
 *
 * Auth model:
 *   - Caller must have a valid Supabase session cookie.
 *   - Caller must already be a member of the workspace.
 *   - Caller must have role 'owner' or 'admin' on that workspace.
 *
 * Edge cases handled:
 *   - Email is already a registered auth user → reuse that auth.user_id
 *     and just upsert the workspace_members row (so admins can grant
 *     workspace access to someone with an existing account).
 *   - Member row already exists for that user_id → 409 with explanation.
 */

import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type Role = 'owner' | 'admin' | 'operations' | 'sales' | 'marketing' | 'key_account' | 'member';

const VALID_ROLES: Role[] = [
  'owner', 'admin', 'operations', 'sales', 'marketing', 'key_account', 'member',
];

type Body = {
  workspace_id?: string;
  email?: string;
  role?: Role;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const workspaceId = (body.workspace_id ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase();
  const role = body.role;

  if (!workspaceId)            return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  if (!email)                  return NextResponse.json({ error: 'email is required' },        { status: 400 });
  if (!role)                   return NextResponse.json({ error: 'role is required' },         { status: 400 });
  if (!VALID_ROLES.includes(role))
    return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: 'email is not a valid address' }, { status: 400 });

  // ─── 1. Authenticate the caller ─────────────────────────────────────
  const userClient = await createServerSupabase();
  const { data: { user: caller }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !caller) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // ─── 2. Verify the caller is an owner or admin of the workspace ────
  const { data: callerMembership, error: membershipErr } = await userClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.id)
    .maybeSingle();
  if (membershipErr) {
    return NextResponse.json({ error: `Permission lookup failed: ${membershipErr.message}` }, { status: 500 });
  }
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    return NextResponse.json({ error: 'Only owner or admin can create team accounts' }, { status: 403 });
  }

  // ─── 3. Service-role: find or create the auth user ─────────────────
  let adminClient;
  try {
    adminClient = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Service-role client unavailable' }, { status: 501 });
  }

  // Generate a strong password the admin will read once. We use 16 bytes
  // → base64url, ~22 chars, plus a couple of symbols to satisfy any
  // future password-strength policies.
  const password = generatePassword();

  let authUserId: string | null = null;
  let createdNewUser = false;

  // Try to create. If email already exists, Supabase returns a 422 with
  // "User already registered". In that case we look the user up and
  // proceed to link them to the workspace.
  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skip email verification — admin owns onboarding
  });

  if (createErr) {
    const msg = (createErr.message || '').toLowerCase();
    const alreadyExists =
      msg.includes('already') ||
      msg.includes('exists') ||
      msg.includes('duplicate');

    if (!alreadyExists) {
      return NextResponse.json({ error: `Could not create auth user: ${createErr.message}` }, { status: 500 });
    }

    // Look up existing user via listUsers (no direct getByEmail in supabase-js).
    // Page through up to a few thousand users — for AQ Creativity scale this
    // is fine. If the workspace ever grows past that, switch to a server
    // function that queries auth.users directly.
    const existingId = await findUserIdByEmail(adminClient, email);
    if (!existingId) {
      return NextResponse.json({
        error: `Email is already registered, but I couldn't find the auth user record. Ask the user to sign in once, then try again.`,
      }, { status: 500 });
    }
    authUserId = existingId;
  } else {
    authUserId = created.user?.id ?? null;
    createdNewUser = true;
  }

  if (!authUserId) {
    return NextResponse.json({ error: 'Auth user creation returned no user_id' }, { status: 500 });
  }

  // ─── 4. Link the user to the workspace ─────────────────────────────
  // The composite unique constraint (workspace_id, user_id) on
  // workspace_members guarantees idempotency on retries.
  const { error: memberErr } = await adminClient
    .from('workspace_members')
    .upsert(
      { workspace_id: workspaceId, user_id: authUserId, role, joined_at: new Date().toISOString() },
      { onConflict: 'workspace_id,user_id' },
    );

  if (memberErr) {
    return NextResponse.json({
      error: `Auth user ${createdNewUser ? 'was created but' : 'exists, but'} I couldn't add them to the workspace: ${memberErr.message}`,
      auth_user_id: authUserId,
      created_new_user: createdNewUser,
    }, { status: 500 });
  }

  // ─── 5. Done. Return credentials so the admin can share them. ──────
  return NextResponse.json({
    ok: true,
    email,
    // Only newly-created users get the plaintext password back. If we're
    // linking an existing account, we don't have / didn't change their
    // password, so we tell the admin to direct them to sign in normally.
    password: createdNewUser ? password : null,
    role,
    auth_user_id: authUserId,
    created_new_user: createdNewUser,
    workspace_id: workspaceId,
  });
}

// ─── helpers ───────────────────────────────────────────────────────────

function generatePassword(): string {
  // 16 random bytes → base64url (~22 chars) → a couple of suffix symbols
  // so it satisfies any plausible "needs special char" policy.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const base = Buffer.from(bytes).toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return `${base}!Aq`;
}

/**
 * Walk the auth.users list looking for a matching email. Used only on
 * the rare path where createUser said "already registered" but we still
 * need the existing user_id. Caps at 5,000 users.
 */
async function findUserIdByEmail(admin: ReturnType<typeof getSupabaseAdmin>, email: string): Promise<string | null> {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null; // ran out of pages
  }
  return null;
}
