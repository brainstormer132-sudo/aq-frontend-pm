/**
 * Chase lapsing CRs and licences.
 *
 * A client's commercial registration or a vendor's trade licence used to fall
 * out of date with nobody the wiser until someone opened the register. This
 * route, hit by a daily cron, turns that silence into an inbox notice for the
 * workspace's owners and admins — the same shape as the stuck-contract chaser
 * and the payments-due check.
 *
 * Which records qualify is decided by `expiryDue` (pure, tested). This route
 * owns the plumbing: read the two tables, fan a notice to the right owners and
 * admins, and don't tell them the same thing every morning.
 *
 * Clients carry a `workspace_id`, so a client notice goes to that workspace.
 * Vendors are a shared, workspace-less table, so a vendor notice fans to every
 * workspace's owners and admins — the link carries the workspace, so each one
 * is counted (and de-duplicated) on its own.
 *
 * Auth: GET with `Authorization: Bearer <CRON_SECRET>` — the same shared
 * secret the Asana sync, contract chaser and payments check use.
 *
 * De-duplication: at most one notice per (workspace, record, state) per
 * NOTIFY_EVERY_DAYS, decided by looking for an existing notification with this
 * candidate's link. No schema change, no per-row "last chased" column. The
 * link carries the state, so an "expired" notice is never silenced by the
 * "expiring soon" one that came before it.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
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

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Only rows that have a date at all — the register's own filter, moved to
  // the query so the scan reads the few, not the thousands.
  const [clientsRes, vendorsRes, wsRes] = await Promise.all([
    admin
      .from('clients')
      .select('id, workspace_id, company_name, cr_expiry')
      .eq('status', 'active')
      .not('cr_expiry', 'is', null),
    admin
      .from('vendors')
      .select('id, name, license_expiry')
      .not('license_expiry', 'is', null),
    admin.from('workspaces').select('id'),
  ]);

  if (clientsRes.error) return NextResponse.json({ error: clientsRes.error.message }, { status: 500 });
  if (vendorsRes.error) return NextResponse.json({ error: vendorsRes.error.message }, { status: 500 });
  if (wsRes.error) return NextResponse.json({ error: wsRes.error.message }, { status: 500 });

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
    // workspace of its own, reaches every workspace's owners and admins.
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
      if (dupErr) {
        return NextResponse.json({ error: dupErr.message, notified, skipped }, { status: 500 });
      }
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
      if (roleErr) {
        return NextResponse.json({ error: roleErr.message, notified, skipped }, { status: 500 });
      }

      notified += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    scannedClients: clients.length,
    scannedVendors: vendors.length,
    workspaces: workspaceIds.length,
    candidates: candidates.length,
    notified,
    skipped,
  });
}
