/**
 * Chase lapsing CRs and licences.
 *
 * A client's commercial registration or a vendor's trade licence used to fall
 * out of date with nobody the wiser until someone opened the register. This
 * route turns that silence into an inbox notice for the workspace's owners and
 * admins — the same shape as the stuck-contract chaser and the payments-due
 * check.
 *
 * Which records qualify is decided by `expiryDue` (pure, tested). This route
 * owns the plumbing: read the two tables, fan a notice to the right owners and
 * admins, and don't tell them the same thing every morning.
 *
 * Clients carry a `workspace_id`, so a client notice goes to that workspace.
 * Vendors are a shared, workspace-less table, so a vendor notice fans to every
 * workspace's owners and admins (or, on a scoped run, just the one) — the link
 * carries the workspace, so each one is counted (and de-duplicated) on its own.
 *
 * Two ways in:
 *   - GET  with `Authorization: Bearer <CRON_SECRET>` — the daily cron, every
 *          workspace.
 *   - POST from a signed-in owner/admin with `{ workspace_id }` — a "Run now"
 *          from Settings, scoped to that one workspace.
 *
 * De-duplication: at most one notice per (workspace, record, state) per
 * NOTIFY_EVERY_DAYS, decided by looking for an existing notification with this
 * candidate's link. The link carries the state, so an "expired" notice is never
 * silenced by the "expiring soon" one that came before it.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';
import {
  expiryDue, expiryMessage, expiryLink,
  NOTIFY_EVERY_DAYS, RECIPIENT_ROLES,
  type PapersRow,
} from '@/lib/expiry-notify';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

interface ClientRow {
  id: string;
  workspace_id: string | null;
  company_name: string | null;
  cr_expiry: string | null;
}

interface VendorRow {
  id: number | string;
  name: string | null;
  license_expiry: string | null;
}

async function runExpiryCheck(opts: { workspaceId?: string }) {
  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Only rows that have a date at all — the register's own filter, moved to
  // the query so the scan reads the few, not the thousands.
  let clientsQ = admin
    .from('clients')
    .select('id, workspace_id, company_name, cr_expiry')
    .eq('status', 'active')
    .not('cr_expiry', 'is', null);
  if (opts.workspaceId) clientsQ = clientsQ.eq('workspace_id', opts.workspaceId);

  const vendorsP = admin
    .from('vendors')
    .select('id, name, license_expiry')
    .not('license_expiry', 'is', null);

  // On a scoped run only the caller's workspace hears about a vendor; the cron
  // fans vendor notices to every workspace.
  const workspacesP = opts.workspaceId
    ? Promise.resolve({ data: [{ id: opts.workspaceId }], error: null as any })
    : admin.from('workspaces').select('id');

  const [clientsRes, vendorsRes, wsRes] = await Promise.all([clientsQ, vendorsP, workspacesP]);

  if (clientsRes.error) return { error: clientsRes.error.message, status: 500 as const };
  if (vendorsRes.error) return { error: vendorsRes.error.message, status: 500 as const };
  if (wsRes.error) return { error: wsRes.error.message, status: 500 as const };

  const clients = (clientsRes.data ?? []) as ClientRow[];
  const vendors = (vendorsRes.data ?? []) as VendorRow[];
  const workspaceIds = ((wsRes.data ?? []) as { id: string }[]).map((w) => w.id);

  const rows: PapersRow[] = [
    ...clients.map((c) => ({
      id: c.id,
      kind: 'client' as const,
      name: c.company_name ?? '',
      expiry: c.cr_expiry,
      workspaceId: c.workspace_id,
    })),
    ...vendors.map((v) => ({
      id: String(v.id),
      kind: 'vendor' as const,
      name: v.name ?? '',
      expiry: v.license_expiry,
      workspaceId: null,
    })),
  ];

  const candidates = expiryDue(rows, today);
  const since = new Date(Date.now() - NOTIFY_EVERY_DAYS * DAY_MS).toISOString();

  let notified = 0;
  let skipped = 0;

  for (const c of candidates) {
    // A client notice lands in its own workspace; a vendor notice, having no
    // workspace of its own, reaches every scanned workspace's owners/admins.
    const targets = c.kind === 'client'
      ? (c.workspaceId ? [c.workspaceId] : [])
      : workspaceIds;

    for (const wsId of targets) {
      const link = expiryLink(c, wsId);

      const { count, error: dupErr } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('link', link)
        .gte('created_at', since);
      if (dupErr) return { error: dupErr.message, status: 500 as const, notified, skipped };
      if ((count ?? 0) > 0) { skipped += 1; continue; }

      const { title, body } = expiryMessage(c);
      const { error: roleErr } = await admin.rpc('notify_role', {
        ws_id: wsId,
        role_names: RECIPIENT_ROLES,
        n_type: 'due_soon',
        n_title: title,
        n_body: body,
        n_link: link,
      });
      if (roleErr) return { error: roleErr.message, status: 500 as const, notified, skipped };

      notified += 1;
    }
  }

  return {
    ok: true as const,
    scannedClients: clients.length,
    scannedVendors: vendors.length,
    workspaces: workspaceIds.length,
    candidates: candidates.length,
    notified,
    skipped,
  };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await runExpiryCheck({});
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
    return NextResponse.json({ error: 'Only owner or admin can run the expiry check' }, { status: 403 });
  }

  const result = await runExpiryCheck({ workspaceId });
  if ('error' in result) return NextResponse.json(result, { status: result.status });
  return NextResponse.json(result);
}
