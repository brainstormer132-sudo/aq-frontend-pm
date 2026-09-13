/**
 * POST /api/asana/sync   - "Sync now", triggered by an owner/admin/finance user
 * GET  /api/asana/sync   - the hourly Vercel Cron job
 *
 * One-way sync: pull the "Jed Deals 26" project from the Asana API and apply
 * it with the SAME tested pipeline the CSV upload uses
 * (asanaApiToRows -> planImport -> renderSql), then execute the generated SQL
 * over a direct DB connection. Idempotent (keyed on asana_gid); never deletes.
 *
 * Nothing here writes back to Asana.
 *
 * Server env (all server-only, set in Vercel):
 *   ASANA_PAT             - Asana personal access token (a secret)
 *   ASANA_PROJECT_GID     - the "Jed Deals 26" project gid
 *   SUPABASE_DB_URL       - Postgres owner connection string (Supabase pooler)
 *   CRON_SECRET           - shared secret Vercel Cron sends as a Bearer token
 *   ASANA_WORKSPACE_ID    - optional; which workspace the cron writes into when
 *                           more than one exists (the button passes it explicitly)
 *
 * Auth:
 *   POST - a signed-in owner/admin/finance member of the target workspace.
 *   GET  - Authorization: Bearer <CRON_SECRET> (Vercel Cron).
 */
import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { fetchAsanaProjectTasks } from '@/lib/asana-fetch';
import { applyImportSql } from '@/lib/asana-apply';
import { asanaApiToRows, planImport, renderSql } from '@/lib/asana-import';

// postgres + the Asana fetch need the Node runtime, not Edge. Give the
// per-parent subtask fetch room without hanging a request forever.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface SyncSummary {
  ok: true;
  workspaceId: string | null;
  campaigns: number;
  bookings: number;
  clients: number;
  vendors: number;
  filesRun: string[];
  filesSkipped: string[];
  warnings: string[];
  finishedAt: string;
}

function missingEnv(): string[] {
  const need = ['ASANA_PAT', 'ASANA_PROJECT_GID', 'SUPABASE_DB_URL'];
  return need.filter((k) => !(process.env[k] && String(process.env[k]).trim()));
}

/** The whole sync, for a resolved workspace (null = let the SQL pick the only one). */
async function runSync(workspaceId: string | null): Promise<SyncSummary> {
  const pat = String(process.env.ASANA_PAT);
  const projectGid = String(process.env.ASANA_PROJECT_GID);
  const dbUrl = String(process.env.SUPABASE_DB_URL);

  const campaigns = await fetchAsanaProjectTasks(pat, projectGid);
  const rows = asanaApiToRows(campaigns);
  const plan = planImport(rows, 'Jed Deals 26');
  const files = renderSql(plan, { workspaceId: workspaceId ?? undefined, projectName: 'Jed Deals 26' });
  const { filesRun, filesSkipped } = await applyImportSql(dbUrl, files);

  return {
    ok: true,
    workspaceId,
    campaigns: plan.campaigns.length,
    bookings: plan.bookings.length,
    clients: plan.clients.length,
    vendors: plan.vendors.length,
    filesRun,
    filesSkipped,
    warnings: plan.warnings.slice(0, 50),
    finishedAt: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const gaps = missingEnv();
  if (gaps.length) {
    return NextResponse.json(
      { error: `Asana sync is not configured yet. Missing: ${gaps.join(', ')}.` },
      { status: 501 },
    );
  }

  let body: { workspace_id?: string };
  try { body = await request.json(); } catch { body = {}; }
  const workspaceId = (body.workspace_id ?? '').trim();
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
  }

  // Authenticate the caller and confirm they may run a sync here.
  const userClient = await createServerSupabase();
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const { data: membership, error: mErr } = await userClient
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (mErr) {
    return NextResponse.json({ error: `Permission lookup failed: ${mErr.message}` }, { status: 500 });
  }
  if (!membership || !['owner', 'admin', 'finance'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only owner, admin or finance can sync Asana' }, { status: 403 });
  }

  try {
    const summary = await runSync(workspaceId);
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}

export async function GET(request: Request) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const gaps = missingEnv();
  if (gaps.length) {
    return NextResponse.json({ error: `Asana sync is not configured. Missing: ${gaps.join(', ')}.` }, { status: 501 });
  }

  const workspaceId = (process.env.ASANA_WORKSPACE_ID ?? '').trim() || null;
  try {
    const summary = await runSync(workspaceId);
    return NextResponse.json(summary);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 502 });
  }
}