/**
 * Chase stuck contract requests.
 *
 * A contract request that sits waiting on a person (pending/approved, not yet
 * generated) used to be visible only if someone opened the register. This
 * route turns that silence into an inbox notification: any request waiting
 * longer than CHASE_AFTER_DAYS gets one notification to the workspace's owners
 * and admins and to the person who requested it.
 *
 * There is no "legal" workspace role, so "tell Legal" is served by owners +
 * admins (who oversee the contract work) plus `requested_by` (the person
 * actually blocked waiting). Change RECIPIENT_ROLES below to retarget.
 *
 * Two ways in:
 *   - GET  with `Authorization: Bearer <CRON_SECRET>` — the daily cron, every
 *          workspace.
 *   - POST from a signed-in owner/admin with `{ workspace_id }` — a "Run now"
 *          from Settings, scoped to that one workspace.
 *
 * De-duplication: at most one chase per request per CHASE_AFTER_DAYS window,
 * decided by looking for an existing notification with this request's link -
 * no schema change, no per-request "last chased" column to keep in sync.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';
import { chaseCandidates, CHASE_AFTER_DAYS } from '@/lib/contracts';
import { sentLinks } from '@/lib/notify-dedup';

export const dynamic = 'force-dynamic';

/** Roles told about a stuck request, besides the person who requested it. */
const RECIPIENT_ROLES = ['owner', 'admin'];

const DAY_MS = 86_400_000;

async function runChase(opts: { workspaceId?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - CHASE_AFTER_DAYS * DAY_MS).toISOString();
  const admin = getSupabaseAdmin();

  // Only rows that could possibly be stale: a waiting status, old enough.
  let q = admin
    .from('contract_requests')
    .select('id, workspace_id, pm_task_id, requested_by, request_kind, vendor_name, client_name, brand_name, status, created_at')
    .in('status', ['pending', 'approved'])
    .lte('created_at', cutoff);
  if (opts.workspaceId) q = q.eq('workspace_id', opts.workspaceId);
  const { data: rows, error } = await q;
  if (error) return { error: error.message, status: 500 as const };

  const all = rows ?? [];
  const byId = new Map(all.map((r) => [r.id as string, r]));
  const candidates = chaseCandidates(all as any, today);

  let notified = 0;
  let skipped = 0;

  // Deep-link to the task the contract lives on; the contract id makes the
  // link unique per contract, which is also the de-dup key.
  const linkFor = (r: any) => `/dashboard?task=${r.pm_task_id ?? ''}&contract=${r.id}`;

  // Which of these we have already sent, asked ONCE. This used to be a
  // query per candidate, before any work was done - see lib/notify-dedup.
  const since = new Date(Date.now() - CHASE_AFTER_DAYS * DAY_MS).toISOString();
  const { sent, error: dupErr } = await sentLinks(
    candidates.map((c) => byId.get(c.id)).filter(Boolean).map(linkFor),
    (batch) => admin.from('notifications').select('link')
      .in('link', batch).gte('created_at', since),
  );
  if (dupErr) return { error: dupErr, status: 500 as const, notified, skipped };

  for (const c of candidates) {
    const r = byId.get(c.id);
    if (!r || !r.workspace_id) { skipped += 1; continue; }

    const link = linkFor(r);
    if (sent.has(link)) { skipped += 1; continue; }

    const party = r.vendor_name || r.client_name || r.brand_name || 'a party';
    const title = 'Contract waiting with Legal';
    const body = `${party} - ${c.ageDays} days waiting and not generated yet.`;

    // Owners + admins, via the same helper the stage-change triggers use.
    const { error: roleErr } = await admin.rpc('notify_role', {
      ws_id: r.workspace_id,
      role_names: RECIPIENT_ROLES,
      n_type: 'due_soon',
      n_title: title,
      n_body: body,
      n_link: link,
    });
    if (roleErr) return { error: roleErr.message, status: 500 as const, notified, skipped };

    // The person who asked for it is the one actually blocked; tell them too.
    if (r.requested_by) {
      const { error: reqErr } = await admin.from('notifications').insert({
        user_id: r.requested_by,
        type: 'due_soon',
        title,
        body,
        link,
      });
      if (reqErr) return { error: reqErr.message, status: 500 as const, notified, skipped };
    }

    // Mark it here, not after the loop: two candidates that produce the
    // same link must still make one notification, which the old
    // query-per-candidate got for free.
    sent.add(link);
    notified += 1;
  }

  return { ok: true as const, scanned: all.length, candidates: candidates.length, notified, skipped };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runChase({});
  if ('error' in result) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  let body: { workspace_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const workspaceId = (body.workspace_id ?? '').trim();
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  // The caller must be a signed-in owner/admin of this workspace.
  const userClient = await createServerSupabase();
  const { data: { user: caller }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !caller) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: membership, error: memErr } = await userClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.id)
    .maybeSingle();
  if (memErr) {
    return NextResponse.json({ error: `Permission lookup failed: ${memErr.message}` }, { status: 500 });
  }
  if (!membership || !RECIPIENT_ROLES.includes(membership.role)) {
    return NextResponse.json({ error: 'Only owner or admin can run the contract chaser' }, { status: 403 });
  }

  const result = await runChase({ workspaceId });
  if ('error' in result) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
