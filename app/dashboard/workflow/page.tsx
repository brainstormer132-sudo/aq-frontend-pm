'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { withBase } from '@/lib/paths';
import {
  useMyRole, useServiceTypes, useWorkspaceProfiles, useWorkflowTasks,
  usePmTaskCampaignRollup, displayName, needsRealName,
} from '@/hooks/use-workflow';
import { useRealtime } from '@/hooks/use-realtime';
import { SetYourNameCard } from '@/components/workflow/SetYourNameCard';
import { SkeletonShell, SkeletonRows } from '@/components/Skeleton';
import { WorkflowSidebar, type View } from '@/components/workflow/WorkflowSidebar';
import { NewTaskForm } from '@/components/workflow/NewTaskForm';
import { MarketingInbox } from '@/components/workflow/MarketingInbox';
import { TaskDetailPanel } from '@/components/workflow/TaskDetailPanel';
// NotificationsBell removed from topbar 2026-05-17 — the inbox is now an
// item in the left sidebar (see WorkflowSidebar "Inbox" entry) which opens
// a searchable list view backed by the same notifications + mentions data.
import { InboxView } from '@/components/workflow/InboxView';
import { CrmView } from '@/components/workflow/CrmView';
import { WorkflowDashboard } from '@/components/workflow/WorkflowDashboard';
import { SettingsView } from '@/components/workflow/SettingsView';
import { TeamView } from '@/components/workflow/TeamView';
import { ContractsView } from '@/components/workflow/ContractsView';
import { ClientsView } from '@/components/workflow/ClientsView';
import { VendorsView } from '@/components/workflow/VendorsView';
import { TrackingListView } from '@/components/workflow/TrackingListView';
import { DataView } from '@/components/workflow/DataView';
import { AllTasksView } from '@/components/workflow/AllTasksView';
import { prefillFromDeal, type CampaignPrefill } from '@/lib/crm-sync';

const supabase = createClient();

/** Guards the ?task= deep link so junk in the URL can't reach the panel. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ensureProfile(user: { id: string; email?: string | null; user_metadata?: any }) {
  const fullName = user.user_metadata?.full_name || user.email || 'User';
  const { error } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      full_name: fullName,
      avatar_url: user.user_metadata?.avatar_url ?? null,
    }, { onConflict: 'id' });
  if (error) throw error;
}

export default function WorkflowPage() {
  const [view, setView] = useState<View>('inbox');
  const [user, setUser] = useState<{ id: string; email: string; full_name: string } | null>(null);
  const [workspace, setWorkspace] = useState<{ id: string; name: string } | null>(null);
  const [bootError, setBootError] = useState('');
  const [booting, setBooting] = useState(true);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Slide-over task detail panel — null when closed.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  // Set when a CRM deal is won: the New Task form opens filled in from it.
  const [taskPrefill, setTaskPrefill] = useState<CampaignPrefill | null>(null);

  // Remember-me opt-out: if the auth page set aq_session_only on this tab,
  // sign the user out as soon as the tab is closing. The flag lives in
  // sessionStorage so it dies with the tab regardless of what we do.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let sessionOnly = false;
    try { sessionOnly = sessionStorage.getItem('aq_session_only') === '1'; } catch {}
    if (!sessionOnly) return;
    const handler = () => { void supabase.auth.signOut(); };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  }, []);

  // Boot.
  useEffect(() => {
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { window.location.href = withBase('/auth'); return; }
      try {
        await ensureProfile(u);
      } catch (e: any) {
        setBootError(`Could not prepare your profile: ${e?.message ?? e}`);
        setBooting(false);
        return;
      }
      const params = new URLSearchParams(window.location.search);

      // Deep link: /dashboard/workflow?task=<uuid> opens that task in the
      // slide-over panel. This is the link format the DB notification
      // triggers write (migrations 037 / 038), so an Ops user notified of a
      // quotation request can actually click through to it. Read it BEFORE
      // the invite branch below, which replaceState's the query string away.
      const taskParam = params.get('task');
      if (taskParam && UUID_RE.test(taskParam)) setOpenTaskId(taskParam);

      const inviteToken = params.get('invite') || localStorage.getItem('aq_pending_invite');
      if (inviteToken) {
        const { error: claimError } = await supabase.rpc('claim_workspace_invite', { invite_token: inviteToken });
        if (claimError) {
          setBootError(`Could not accept invite: ${claimError.message}`);
          setBooting(false);
          return;
        }
        localStorage.removeItem('aq_pending_invite');
        window.history.replaceState({}, '', withBase('/dashboard/workflow'));
      }
      // Read the name from the PROFILE, not from auth metadata.
      //
      // This used to fall back to `u.email`, which is how several people
      // ended up displayed to their colleagues as an email address: the
      // fallback got written into profiles.full_name at signup and every
      // view then rendered it faithfully. An address is not a name — if
      // there isn't one, say so and prompt for it (SetYourNameCard).
      // These two do not need each other, so they go together. In sequence
      // they were two round trips before anything at all could render, on
      // top of the two above.
      const [{ data: myProfile }, { data: memberships, error: mErr }] = await Promise.all([
        supabase.from('profiles').select('full_name').eq('id', u.id).maybeSingle(),
        supabase
          .from('workspace_members')
          .select('workspace_id, workspace:workspaces(id, name)')
          .eq('user_id', u.id)
          .limit(1),
      ]);
      setUser({
        id: u.id,
        email: u.email ?? '',
        full_name: displayName(myProfile as any),
      });
      if (mErr) { setBootError(mErr.message); setBooting(false); return; }
      const ws = (memberships?.[0] as any)?.workspace;
      if (ws) setWorkspace({ id: ws.id, name: ws.name });
      if (!ws) {
        const { data: hasWorkspace } = await supabase.rpc('has_any_workspace');
        if (hasWorkspace) {
          setBootError('This workspace is invite-only. Ask an owner or admin for a 24-hour invite link tied to your email.');
          setBooting(false);
          return;
        }
      }
      setBooting(false);
    })();
  }, []);

  const wsId = workspace?.id ?? null;
  const { role } = useMyRole(wsId);
  const { profiles, refetch: refetchProfiles } = useWorkspaceProfiles(wsId);
  const { serviceTypes, steps, refetch: refetchServiceTypes } = useServiceTypes(wsId);
  const { tasks: allTasks, loading: tasksLoading, refetch: refetchAll } = useWorkflowTasks(wsId, 'all');
  // Cached and shared with the Dashboard and All Tasks — see the hook.
  const { rows: clientRollup } = usePmTaskCampaignRollup(wsId);

  // Derived, not fetched. This used to be a second full scan of pm_tasks for
  // rows the first scan had already returned — twice the wait on every load
  // and on every save, for a number in the sidebar.
  const pendingMarketing = useMemo(
    () => allTasks.filter((t) => t.stage === 'pending_marketing'),
    [allTasks],
  );

  // Default landing: Dashboard for everyone — replaces the role-specific routing.
  const [initialViewSet, setInitialViewSet] = useState(false);
  useEffect(() => {
    if (!role || initialViewSet) return;
    setView('dashboard');
    setInitialViewSet(true);
  }, [role, initialViewSet]);

  // Keep the URL in step with the open panel, so a task can be linked to and
  // a refresh doesn't reopen something the user already closed. Gated on
  // `booting` — otherwise this would strip ?task= off the URL before the
  // (async) boot effect has had a chance to read it.
  useEffect(() => {
    if (booting || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (openTaskId) params.set('task', openTaskId);
    else params.delete('task');
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState({}, '', next);
    }
  }, [openTaskId, booting]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // The manual Refresh button is gone (Aug 2026). Every view refetches when
  // it mounts, each action refetches what it touched — and now the database
  // pushes changes as they happen, so a task somebody else creates appears
  // here on its own.
  //
  // Debounced, because a bulk edit of twenty subtasks arrives as twenty
  // separate events and would otherwise fire twenty identical refetches.
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (syncTimer.current) clearTimeout(syncTimer.current); }, []);

  /**
   * Reload the task list, once, after things stop happening.
   *
   * Everything funnels through here — realtime events and the detail panel's
   * own saves. Before, saving one field ran two full scans of pm_tasks and
   * re-rendered the page, and then the realtime echo of that same save ran
   * them again: four scans for one date. Typing felt like wading.
   *
   * 700ms because a save and its echo arrive within a few hundred
   * milliseconds of each other, and a bulk edit of twenty subtasks arrives
   * as twenty separate events.
   */
  const scheduleSync = () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { refetchAll(); }, 700);
  };

  useRealtime({
    table: 'pm_tasks',
    enabled: !!wsId,
    filter: wsId ? `workspace_id=eq.${wsId}` : undefined,
    onChange: scheduleSync,
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = withBase('/auth');
  };

  // ---- boot states ----
  // The shell, in the shape it will be in a moment — sidebar where the
  // sidebar goes, header where the header goes. A centred card in the middle
  // of an empty page made every load feel like a cold start, because the
  // whole layout arrived at once and jumped.
  if (booting) return <SkeletonShell />;
  if (bootError) {
    return (
      <div className="aq-card" style={{ margin: 40, padding: 32, color: 'var(--aq-error)' }}>
        <strong>Could not load workspace:</strong> {bootError}
      </div>
    );
  }
  if (!user) return null;
  if (!workspace) {
    return (
      <SetupWorkspace
        userId={user.id}
        onCreated={(created) => setWorkspace({ id: created.id, name: created.name })}
      />
    );
  }

  // After sales submits a task, route them to "My Tasks" (so they can see
  // their submitted task in stage=pending_marketing) — not Inbox, where
  // they'd just see "Marketing only".
  const onTaskCreated = () => {
    refetchAll();
    setView(role === 'sales' ? 'all-tasks' : 'inbox');
    setToast({ kind: 'ok', text: 'Task submitted to marketing.' });
  };

  const onTaskTriaged = () => {
    refetchAll();
    setToast({ kind: 'ok', text: 'Task triaged. Subtasks created and key account notified.' });
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <WorkflowSidebar
        view={view}
        onViewChange={setView}
        role={role}
        userName={user.full_name}
        workspaceName={workspace.name}
        pendingCount={pendingMarketing.length}
        onSignOut={signOut}
      />

      <main style={{ flex: 1, padding: 28, overflow: 'auto', position: 'relative' }}>
        <header style={{
          marginBottom: 22, display: 'flex',
          justifyContent: 'space-between', alignItems: 'flex-end',
          gap: 16,
        }}>
          <div>
            <p style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--aq-text-muted)',
            }}>
              {workspace.name} · {role ?? 'no role'}
            </p>
            <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 2 }}>{viewTitle(view)}</h1>
            <p style={{ fontSize: 14, color: 'var(--aq-text-secondary)', marginTop: 4 }}>
              {viewSubtitle(view)}
            </p>
          </div>
        </header>

        {/* Only while this person still has no real name of their own.
            Saving it updates every view that renders them. */}
        {needsRealName({ full_name: user.full_name }) && (
          <SetYourNameCard
            userId={user.id}
            onSaved={(name) => {
              setUser((u) => (u ? { ...u, full_name: name } : u));
              refetchProfiles?.();
            }}
          />
        )}

        {view === 'dashboard' && (
          <WorkflowDashboard
            workspaceId={workspace.id}
            userId={user.id}
            userName={user.full_name}
            role={role}
            profiles={profiles}
            onOpenTask={(id) => setOpenTaskId(id)}
            onGoTo={(v) => setView(v)}
          />
        )}

        {view === 'new-task' && (
          <NewTaskForm
            // Keyed on the prefill so arriving from a won deal always gets a
            // fresh form: without it React reuses the mounted one and the
            // boxes stay empty.
            key={taskPrefill ? `deal-${taskPrefill.task_name}` : 'blank'}
            workspaceId={workspace.id}
            currentUserId={user.id}
            role={role}
            profiles={profiles}
            prefill={taskPrefill}
            onCreated={() => { setTaskPrefill(null); onTaskCreated(); }}
          />
        )}

        {view === 'inbox' && (
          <InboxView onOpenTask={(id) => setOpenTaskId(id)} />
        )}

        {view === 'crm' && (
          <CrmView
            workspaceId={workspace.id}
            currentUserId={user.id}
            currentUserName={user.full_name}
            onStartCampaign={(deal) => { setTaskPrefill(prefillFromDeal(deal)); setView('new-task'); }}
          />
        )}

        {view === 'marketing-triage' && (
          <MarketingInbox
            tasks={pendingMarketing}
            serviceTypes={serviceTypes}
            steps={steps}
            profiles={profiles}
            currentUserId={user.id}
            workspaceId={workspace.id}
            role={role}
            onTriaged={onTaskTriaged}
          />
        )}

        {view === 'all-tasks' && (
          <AllTasksView
            tasks={allTasks}
            loading={tasksLoading}
            profiles={profiles}
            currentUserId={user.id}
            workspaceId={workspace.id}
            onOpen={(id) => setOpenTaskId(id)}
          />
        )}

        {view === 'contracts' && (
          <ContractsView
            workspaceId={workspace.id}
            role={role}
            onOpenTask={(id) => setOpenTaskId(id)}
            /* Already loaded — so a contract row can name its campaign
               instead of repeating the brand. No extra query. */
            tasks={allTasks}
            profiles={profiles}
          />
        )}

        {/* One search box over every client and vendor; the same panels
            narrowed to whoever is picked. Read-only — it writes nothing. */}
        {view === 'data' && (
          <DataView workspaceId={workspace.id} onOpenTask={(id) => setOpenTaskId(id)} />
        )}

        {/* Campaigns and the rollup are already loaded for the Dashboard
            and All Tasks, so the Clients register can say how much work each
            client has had without a new query. */}
        {view === 'clients'  && (
          <ClientsView role={role} campaigns={allTasks} rollup={clientRollup} />
        )}
        {view === 'vendors'  && <VendorsView role={role} userName={user.full_name} />}
        {view === 'tracking' && <TrackingListView workspaceId={workspace.id} role={role} />}

        {/* Team owns people: your own profile, the roster, roles and logins.
            It used to be twenty lines printing a name and a badge, while the
            real thing sat on Settings — which members cannot open. */}
        {view === 'team' && (
          <TeamView
            workspaceId={workspace.id}
            currentUserId={user.id}
            role={role}
            onProfileSaved={(p) => {
              setUser((u) => (u ? { ...u, full_name: p.full_name } : u));
              refetchProfiles?.();
            }}
          />
        )}

        {/* Settings is configuration only — the vocabularies campaigns pick
            from, and the numbers the app runs on. Your profile moved to Team,
            which everybody can open. */}
        {view === 'settings' && (
          <SettingsView workspaceId={workspace.id} role={role} />
        )}

        {/* Slide-over task detail */}
        <TaskDetailPanel
          taskId={openTaskId}
          workspaceId={workspace.id}
          currentUserId={user.id}
          role={role}
          profiles={profiles}
          serviceTypeSteps={steps}
          onClose={() => setOpenTaskId(null)}
          onChanged={scheduleSync}
        />

        {/* Floating toast */}
        {toast && (
          <div
            className="animate-fade-in"
            role="status"
            style={{
              position: 'fixed', bottom: 24, right: 24, zIndex: 50,
              padding: '12px 18px',
              borderRadius: 'var(--aq-radius)',
              background: toast.kind === 'ok' ? 'var(--aq-accent)' : 'var(--aq-error)',
              color: '#fff', fontSize: 14, fontWeight: 600,
              boxShadow: 'var(--aq-shadow-lg)',
              maxWidth: 420,
            }}
          >
            {toast.text}
          </div>
        )}
      </main>
    </div>
  );
}

const fullCenter: React.CSSProperties = {
  minHeight: '100vh', display: 'flex',
  alignItems: 'center', justifyContent: 'center',
};

function Logo({ size = 40 }: { size?: number }) {
  return (
    // Tries /aq-logo.png; if missing, the alt text falls back gracefully.
    // Saving the logo to public/aq-logo.png will pick it up automatically.
    <div style={{
      width: size, height: size, borderRadius: 12,
      background: '#0f1d22', color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.45,
      overflow: 'hidden',
    }}>
      <img
        src="/aq-logo.png"
        alt="AQ"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = 'none';
          if (e.currentTarget.parentElement) {
            e.currentTarget.parentElement.textContent = 'AQ';
          }
        }}
      />
    </div>
  );
}

function SetupWorkspace({
  userId, onCreated,
}: {
  userId: string;
  onCreated: (workspace: { id: string; name: string }) => void;
}) {
  const [name, setName] = useState('AQ Creativity');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createWorkspace = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || `workspace-${Date.now()}`;
      const { data, error: wsErr } = await supabase
        .from('workspaces')
        .insert({ name: name.trim(), slug, owner_id: userId })
        .select('id, name')
        .single();
      if (wsErr) throw wsErr;
      const { error: memberErr } = await supabase
        .from('workspace_members')
        .upsert(
          { workspace_id: data.id, user_id: userId, role: 'owner' },
          { onConflict: 'workspace_id,user_id' },
        );
      if (memberErr) throw memberErr;
      onCreated(data);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ ...fullCenter, padding: 24 }}>
      <div className="aq-card" style={{ padding: 32, maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <Logo size={48} />
        <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 16 }}>Create workspace</h1>
        <p style={{ color: 'var(--aq-text-muted)', marginTop: 8, fontSize: 14 }}>
          This is now the main dashboard. Create your workspace here to begin.
        </p>
        <label style={{ display: 'block', textAlign: 'left', marginTop: 22 }}>
          <span className="aq-label">Workspace name</span>
          <input
            className="aq-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createWorkspace(); }}
            autoFocus
          />
        </label>
        {error && <div className="aq-badge aq-badge-error" style={{ marginTop: 14 }}>{error}</div>}
        <button
          className="aq-btn aq-btn-primary"
          disabled={busy || !name.trim()}
          onClick={createWorkspace}
          style={{ width: '100%', marginTop: 18 }}
        >
          {busy ? 'Creating...' : 'Create Workspace'}
        </button>
      </div>
    </div>
  );
}

function viewTitle(v: View) {
  return v === 'dashboard' ? 'Dashboard'
    : v === 'new-task' ? 'New Task'
    : v === 'inbox'    ? 'Inbox'
    : v === 'crm'      ? 'CRM'
    : v === 'marketing-triage' ? 'Marketing Inbox'
    : v === 'all-tasks'? 'All Tasks'
    : v === 'contracts'? 'Contract Requests'
    : v === 'clients'  ? 'Clients'
    : v === 'vendors'  ? 'Vendors'
    : v === 'tracking' ? 'Tracking Sheets'
    : v === 'data'     ? 'Data'
    : v === 'team'     ? 'Team'
    : 'Settings';
}
function viewSubtitle(v: View) {
  return v === 'dashboard' ? 'Your at-a-glance view of the workspace.'
    : v === 'new-task'  ? 'Sales submits the brief; marketing picks it up next.'
    : v === 'inbox'     ? 'Notifications, mentions, and anything that needs your eyes.'
    : v === 'crm'       ? 'Client and vendor relationships — activity log, notes, recent contact.'
    : v === 'marketing-triage' ? 'Tasks waiting for priority, service type, and a key account.'
    : v === 'all-tasks' ? 'Every workflow task in this workspace — searchable.'
    : v === 'contracts' ? 'Vendor and client contract requests submitted from tasks.'
    : v === 'clients'   ? 'Add and search approved clients used by projects and contracts.'
    : v === 'vendors'   ? 'Add vendors, bank details, and review pending registration requests.'
    : v === 'tracking'  ? 'Campaigns with a tracking sheet — open one to add and track vendors.'
    : v === 'data'      ? 'Everything, until you search for someone.'
    : v === 'team'      ? 'Your profile, and everyone in this workspace.'
    : 'The lists campaigns pick from, and the numbers the app runs on.';
}


