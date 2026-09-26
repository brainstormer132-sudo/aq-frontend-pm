/**
 * Tell finance about client money that is due.
 *
 * The finance payments screen (All / Partial paid / Advanced) shows what is
 * owed, but only to whoever opens it. This route, hit by a daily cron, turns
 * that silence into an inbox notification, exactly as the contract chaser does
 * for stuck contract requests:
 *
 *   - a client instalment past its due date and unpaid  -> "payment overdue"
 *   - a delivered campaign with money still to collect   -> "ready to invoice"
 *
 * Both are what Siraj asked for: notify finance when something is supposed to
 * be paid, AND when work is delivered.
 *
 * Which campaigns qualify is decided by `paymentsDue` (pure, tested). This
 * route owns only the plumbing: read the campaigns, tell owner/admin/finance,
 * and do not tell them the same thing every single morning.
 *
 * Auth:
 *   - GET  with `Authorization: Bearer <CRON_SECRET>` - the Vercel cron, same
 *          shared secret the Asana sync and contract chaser use. Scans every
 *          workspace.
 *   - POST from a signed-in owner/admin/finance user with `{ workspace_id }` -
 *          a "run now" from the Finance screen. Scans only that workspace.
 *
 * De-duplication: at most one notice per campaign per reason per
 * NOTIFY_EVERY_DAYS, decided by looking for an existing notification with this
 * candidate's link. No schema change, no "last notified" column to keep in
 * sync. The link carries the reason, so an overdue notice is never silenced by
 * an earlier "ready to invoice" one.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';
import { sentLinks } from '@/lib/notify-dedup';
import {
  paymentsDue, paymentDueMessage, paymentDueLink,
  NOTIFY_EVERY_DAYS, RECIPIENT_ROLES,
  type CampaignForNotify,
} from '@/lib/finance-notify';

export const dynamic = 'force-dynamic';

const DAY_MS = 86_400_000;

/** A parent pm_tasks row, the money/terms columns this scan reads. */
interface TaskRow {
  id: string;
  workspace_id: string | null;
  task_name: string | null;
  title: string | null;
  brand_name: string | null;
  status: string | null;
  completed_at: string | null;
  client_payment_amount: number | null;
  payment_terms: string | null;
  payment_split_pct: number | null;
  payment_net_days: number | null;
  due_date: string | null;
  package_start_date: string | null;
}

interface RollupRow { parent_task_id: string; sum_prices: number | null }

/**
 * Read the campaigns for one workspace (or all), decide who to notify, and
 * notify them. Shared by the cron (GET, all workspaces) and the manual run
 * (POST, one workspace). Uses the service-role client so it sees every
 * campaign regardless of RLS.
 */
async function scanAndNotify(opts: { workspaceId?: string }) {
  const admin = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  // Parent tasks (campaigns) only. The client billed amount comes from the
  // rollup, the same source the Finance screen bills the client from.
  let taskQ = admin
    .from('pm_tasks')
    .select('id, workspace_id, task_name, title, brand_name, status, completed_at, client_payment_amount, payment_terms, payment_split_pct, payment_net_days, due_date, package_start_date')
    .is('parent_task_id', null)
    .is('deleted_at', null);
  if (opts.workspaceId) taskQ = taskQ.eq('workspace_id', opts.workspaceId);
  const { data: tasks, error: taskErr } = await taskQ;
  if (taskErr) return { error: taskErr.message, status: 500 as const };

  let rollQ = admin.from('pm_task_campaign_rollup').select('parent_task_id, sum_prices');
  if (opts.workspaceId) rollQ = rollQ.eq('workspace_id', opts.workspaceId);
  const { data: roll, error: rollErr } = await rollQ;
  if (rollErr) return { error: rollErr.message, status: 500 as const };

  const billedBy = new Map<string, number>(
    ((roll as RollupRow[]) ?? []).map((r) => [r.parent_task_id, Number(r.sum_prices ?? 0)]),
  );

  const campaigns: CampaignForNotify[] = ((tasks as TaskRow[]) ?? []).map((t) => ({
    id: t.id,
    workspace_id: t.workspace_id,
    title: t.title || t.task_name,
    brand: t.brand_name,
    billed: billedBy.get(t.id) ?? 0,
    paid: t.client_payment_amount,
    status: t.status,
    completedAt: t.completed_at,
    paymentTerms: t.payment_terms,
    paymentSplitPct: t.payment_split_pct,
    paymentNetDays: t.payment_net_days,
    dueDate: t.due_date,
    startDate: t.package_start_date,
  }));

  const candidates = paymentsDue(campaigns, today);
  const since = new Date(Date.now() - NOTIFY_EVERY_DAYS * DAY_MS).toISOString();

  let notified = 0;
  let skipped = 0;

  // Already told them this, recently? Asked ONCE for the whole run, not
  // once per candidate before any work is done - see lib/notify-dedup.
  const { sent, error: dupErr } = await sentLinks(
    candidates.map(paymentDueLink),
    (batch) => admin.from('notifications').select('link')
      .in('link', batch).gte('created_at', since),
  );
  if (dupErr) return { error: dupErr, status: 500 as const, notified, skipped };

  for (const c of candidates) {
    const link = paymentDueLink(c);
    if (sent.has(link)) { skipped += 1; continue; }

    const { title, body } = paymentDueMessage(c);
    const { error: roleErr } = await admin.rpc('notify_role', {
      ws_id: c.workspace_id,
      role_names: RECIPIENT_ROLES,
      n_type: 'due_soon',
      n_title: title,
      n_body: body,
      n_link: link,
    });
    if (roleErr) return { error: roleErr.message, status: 500 as const, notified, skipped };

    // Two candidates on the same link make one notification, which the
    // old query-per-candidate got for free.
    sent.add(link);
    notified += 1;
  }

  return { ok: true as const, scanned: campaigns.length, candidates: candidates.length, notified, skipped };
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const result = await scanAndNotify({});
  if ('error' in result) {
    return NextResponse.json(result, { status: result.status });
  }
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

  // The caller must be a signed-in owner/admin/finance of this workspace.
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
    return NextResponse.json({ error: 'Only owner, admin or finance can run the payments check' }, { status: 403 });
  }

  const result = await scanAndNotify({ workspaceId });
  if ('error' in result) {
    return NextResponse.json(result, { status: result.status });
  }
  return NextResponse.json(result);
}
