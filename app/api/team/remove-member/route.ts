/**
 * POST /api/team/remove-member
 *
 * Removes a teammate from the workspace WITHOUT deleting their Supabase
 * auth user. They lose access to this workspace but their login still
 * exists — useful for:
 *   - Multi-workspace setups (they can still belong to another one)
 *   - Preserving historical activity logs tied to their user_id
 *   - Re-adding them later without recreating their account
 *
 * If you ever want full-account deletion, that's a separate endpoint:
 * we'd need to call `auth.admin.deleteUser` via the service-role client.
 *
 * Auth model:
 *   - Caller must have a valid Supabase session.
 *   - Caller must be owner or admin of the target workspace.
 *   - Owners can be removed by other owners only (admin can't fire an owner).
 *   - Refuses to remove the last remaining owner — that would orphan
 *     the workspace.
 *   - Self-removal is allowed for everyone EXCEPT the last owner, to
 *     stop someone soft-locking themselves out of their own workspace.
 */

import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

type Body = {
  workspace_id?: string;
  membership_id?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const workspaceId  = (body.workspace_id  ?? '').trim();
  const membershipId = (body.membership_id ?? '').trim();

  if (!workspaceId)  return NextResponse.json({ error: 'workspace_id is required' },  { status: 400 });
  if (!membershipId) return NextResponse.json({ error: 'membership_id is required' }, { status: 400 });

  // ─── 1. Authenticate caller ────────────────────────────────────────
  const userClient = await createServerSupabase();
  const { data: { user: caller }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !caller) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  // ─── 2. Resolve caller's role in this workspace ────────────────────
  const { data: callerMembership, error: callerErr } = await userClient
    .from('workspace_members')
    .select('id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.id)
    .maybeSingle();
  if (callerErr) {
    return NextResponse.json({ error: `Permission lookup failed: ${callerErr.message}` }, { status: 500 });
  }
  if (!callerMembership || !['owner', 'admin'].includes(callerMembership.role)) {
    return NextResponse.json({ error: 'Only owner or admin can remove members' }, { status: 403 });
  }

  // ─── 3. Look up the target membership row ──────────────────────────
  let adminClient;
  try {
    adminClient = getSupabaseAdmin();
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Service-role client unavailable' }, { status: 501 });
  }

  const { data: target, error: targetErr } = await adminClient
    .from('workspace_members')
    .select('id, role, user_id, workspace_id')
    .eq('id', membershipId)
    .maybeSingle();
  if (targetErr) {
    return NextResponse.json({ error: `Lookup failed: ${targetErr.message}` }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ error: 'Membership not found' }, { status: 404 });
  }
  if (target.workspace_id !== workspaceId) {
    // membership_id belongs to a different workspace — refuse before
    // anyone uses this endpoint as a way to enumerate / poke around.
    return NextResponse.json({ error: 'Membership does not belong to this workspace' }, { status: 400 });
  }

  // ─── 4. Authorization rules ────────────────────────────────────────
  // - Admin can't fire an owner.
  if (target.role === 'owner' && callerMembership.role !== 'owner') {
    return NextResponse.json({ error: 'Only an owner can remove another owner' }, { status: 403 });
  }

  // - Refuse to remove the LAST owner. If there's exactly one owner row
  //   left and the target is it, the workspace would end up ownerless.
  if (target.role === 'owner') {
    const { count, error: ownerCountErr } = await adminClient
      .from('workspace_members')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner');
    if (ownerCountErr) {
      return NextResponse.json({ error: `Owner count check failed: ${ownerCountErr.message}` }, { status: 500 });
    }
    if ((count ?? 0) <= 1) {
      return NextResponse.json({
        error: 'Cannot remove the last owner. Promote another member to owner first.',
      }, { status: 409 });
    }
  }

  // ─── 5. Delete the membership row ──────────────────────────────────
  const { error: deleteErr } = await adminClient
    .from('workspace_members')
    .delete()
    .eq('id', membershipId);
  if (deleteErr) {
    return NextResponse.json({ error: `Delete failed: ${deleteErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    removed_membership_id: membershipId,
    removed_user_id: target.user_id,
    workspace_id: workspaceId,
  });
}
