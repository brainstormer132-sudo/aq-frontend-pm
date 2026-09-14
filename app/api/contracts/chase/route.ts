/**
 * Chase stuck contract requests.
 *
 * A contract request that sits waiting on a person (pending/approved, not yet
 * generated) used to be visible only if someone opened the register. This
 * route, hit by a daily cron, turns that silence into an inbox notification:
 * any request waiting longer than CHASE_AFTER_DAYS gets one notification to
 * the workspace's owners and admins and to the person who requested it.
 *
 * There is no "legal" workspace role, so "tell Legal" is served by owners +
 * admins (who oversee the contract work) plus `requested_by` (the person
 * actually blocked waiting). Change RECIPIENT_ROLES below to retarget.
 *
 * Auth: GET with `Authorization: Bearer <CRON_SECRET>` (same shared secret the
 * Asana sync cron uses). Register a daily schedule against this path the same
 * way that one is registered.
 *
 * De-duplication: at most one chase per request per CHASE_AFTER_DAYS window,
 * decided by looking for an existing notification with this request's link -
 * no schema change, no per-request "last chased" column to keep in sync.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { chaseCandidates, CHASE_AFTER_DAYS } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

/** Roles told about a stuck request, besides the person who requested it. */
const RECIPIENT_ROLES = ['owner', 'admin'];

const DAY_MS = 86_400_000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - CHASE_AFTER_DAYS * DAY_MS).toISOString();
  const admin = getSupabaseAdmin();

  // Only rows that could possibly be stale: a waiting status, old enough.
  const { data: rows, error } = await admin
    .from('contract_requests')
    .select('id, workspace_id, pm_task_id, requested_by, request_kind, vendor_name, client_name, brand_name, status, created_at')
    .in('status', ['pending', 'approved'])
    .lte('created_at', cutoff);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const all = rows ?? [];
  const byId = new Map(all.map((r) => [r.id as string, r]));
  const candidates = chaseCandidates(all as any, today);

  let notified = 0;
  let skipped = 0;

  for (const c of candidates) {
    const r = byId.get(c.id);
    if (!r || !r.workspace_id) { skipped += 1; continue; }

    // Deep-link to the task the contract lives on; the request id makes the
    // link unique per request, which is also the de-dup key.
    const link = `/dashboard?task=${r.pm_task_id ?? ''}&contract=${r.id}`;

    const since = new Date(Date.now() - CHASE_AFTER_DAYS * DAY_MS).toISOString();
    const { count, error: dupErr } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('link', link)
      .gte('created_at', since);
    if (dupErr) {
      return NextResponse.json({ error: dupErr.message, notified, skipped }, { status: 500 });
    }
    if ((count ?? 0) > 0) { skipped += 1; continue; }

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
    if (roleErr) {
      return NextResponse.json({ error: roleErr.message, notified, skipped }, { status: 500 });
    }

    // The person who asked for it is the one actually blocked; tell them too.
    if (r.requested_by) {
      const { error: reqErr } = await admin.from('notifications').insert({
        user_id: r.requested_by,
        type: 'due_soon',
        title,
        body,
        link,
      });
      if (reqErr) {
        return NextResponse.json({ error: reqErr.message, notified, skipped }, { status: 500 });
      }
    }

    notified += 1;
  }

  return NextResponse.json({
    ok: true,
    scanned: all.length,
    candidates: candidates.length,
    notified,
    skipped,
  });
}
