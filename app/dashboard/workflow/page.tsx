'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { withBase } from '@/lib/paths';
import {
  useMyRole, useServiceTypes, useWorkspaceProfiles, useWorkflowTasks,
} from '@/hooks/use-workflow';
import { WorkflowSidebar, type View } from '@/components/workflow/WorkflowSidebar';
import { NewTaskForm } from '@/components/workflow/NewTaskForm';
import { MarketingInbox } from '@/components/workflow/MarketingInbox';
import { MyTasksList } from '@/components/workflow/MyTasksList';
import { TaskDetailPanel } from '@/components/workflow/TaskDetailPanel';
import { NotificationsBell } from '@/components/workflow/NotificationsBell';
import { WorkflowDashboard } from '@/components/workflow/WorkflowDashboard';
import { TeamSettingsPanel } from '@/components/workflow/TeamSettingsPanel';
import { ContractsView } from '@/components/workflow/ContractsView';
import { ClientsView } from '@/components/workflow/ClientsView';
import { VendorsView } from '@/components/workflow/VendorsView';

const supabase = createClient();

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
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Bumping this triggers child components (MyTasksList etc.) to refetch.
  const [refreshTick, setRefreshTick] = useState(0);
  // Slide-over task detail panel — null when closed.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

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
      setUser({
        id: u.id,
        email: u.email ?? '',
        full_name: u.user_metadata?.full_name || u.email || 'User',
      });
      const { data: memberships, error: mErr } = await supabase
        .from('workspace_members')
        .select('workspace_id, workspace:workspaces(id, name)')
        .eq('user_id', u.id)
        .limit(1);
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
  const { tasks: pendingMarketing, refetch: refetchPending } = useWorkflowTasks(wsId, 'pending_marketing');
  const { tasks: allTasks, refetch: refetchAll } = useWorkflowTasks(wsId, 'all');

  // Default landing: Dashboard for everyone — replaces the role-specific routing.
  const [initialViewSet, setInitialViewSet] = useState(false);
  useEffect(() => {
    if (!role || initialViewSet) return;
    setView('dashboard');
    setInitialViewSet(true);
  }, [role, initialViewSet]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchPending(), refetchAll(), refetchProfiles(), refetchServiceTypes()]);
      setRefreshTick((n) => n + 1);
      setToast({ kind: 'ok', text: 'Refreshed' });
    } catch (e: any) {
      setToast({ kind: 'err', text: `Refresh failed: ${e?.message ?? e}` });
    } finally {
      setRefreshing(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = withBase('/auth');
  };

  // ---- boot states ----
  if (booting) {
    return (
      <div style={fullCenter}>
        <div className="aq-card" style={{ padding: 32, textAlign: 'center' }}>
          <Logo size={48} />
          <p style={{ color: 'var(--aq-text-muted)', marginTop: 16 }}>Loading workspace…</p>
        </div>
      </div>
    );
  }
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
    refetchPending(); refetchAll();
    setView(role === 'sales' ? 'my-tasks' : 'inbox');
    setRefreshTick((n) => n + 1);
    setToast({ kind: 'ok', text: 'Task submitted to marketing.' });
  };

  const onTaskTriaged = () => {
    refetchPending(); refetchAll();
    setRefreshTick((n) => n + 1);
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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <NotificationsBell onOpenTask={(id) => setOpenTaskId(id)} />
            <button
              type="button"
              className="aq-btn aq-btn-ghost"
              onClick={refreshAll}
              disabled={refreshing}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

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
            workspaceId={workspace.id}
            currentUserId={user.id}
            role={role}
            profiles={profiles}
            onCreated={onTaskCreated}
          />
        )}

        {view === 'inbox' && (
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
          <AllTasks
            tasks={allTasks}
            profiles={profiles}
            serviceTypes={serviceTypes}
            onOpen={(id) => setOpenTaskId(id)}
          />
        )}

        {view === 'my-tasks' && (
          <MyTasksList
            workspaceId={workspace.id}
            userId={user.id}
            refreshKey={refreshTick}
            onOpen={(id) => setOpenTaskId(id)}
          />
        )}

        {view === 'contracts' && (
          <ContractsView
            workspaceId={workspace.id}
            role={role}
            onOpenTask={(id) => setOpenTaskId(id)}
          />
        )}

        {view === 'clients'  && <ClientsView role={role} />}
        {view === 'vendors'  && <VendorsView role={role} userName={user.full_name} />}

        {view === 'team' && <TeamPanel profiles={profiles} />}

        {view === 'settings' && (
          <TeamSettingsPanel
            workspaceId={workspace.id}
            currentUserId={user.id}
            role={role}
          />
        )}

        {/* Slide-over task detail */}
        <TaskDetailPanel
          taskId={openTaskId}
          currentUserId={user.id}
          role={role}
          profiles={profiles}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => { refetchPending(); refetchAll(); setRefreshTick((n) => n + 1); }}
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
    : v === 'inbox'    ? 'Marketing Inbox'
    : v === 'all-tasks'? 'All Tasks'
    : v === 'my-tasks' ? 'My Tasks'
    : v === 'contracts'? 'Contract Requests'
    : v === 'clients'  ? 'Clients'
    : v === 'vendors'  ? 'Vendors'
    : v === 'team'     ? 'Team'
    : 'Settings';
}
function viewSubtitle(v: View) {
  return v === 'dashboard' ? 'Your at-a-glance view of the workspace.'
    : v === 'new-task'  ? 'Sales submits the brief; marketing picks it up next.'
    : v === 'inbox'     ? 'Tasks waiting for priority, service type, and a key account.'
    : v === 'all-tasks' ? 'Every workflow task in this workspace — searchable.'
    : v === 'my-tasks'  ? "What you're assigned to or own."
    : v === 'contracts' ? 'Vendor and client contract requests submitted from tasks.'
    : v === 'clients'   ? 'Add and search approved clients used by projects and contracts.'
    : v === 'vendors'   ? 'Add vendors, bank details, and review pending registration requests.'
    : v === 'team'      ? 'People in this workspace and their roles.'
    : 'Configuration and admin tools.';
}

function TeamPanel({ profiles }: { profiles: any[] }) {
  const labelRole = (role: string) => role === 'key_account' ? 'Key account' : role;
  return (
    <div className="aq-card" style={{ padding: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Team</h2>
      <p style={{ color: 'var(--aq-text-muted)', marginTop: 6, fontSize: 14 }}>
        {profiles.length} member{profiles.length === 1 ? '' : 's'}
      </p>
      <ul style={{ listStyle: 'none', marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {profiles.map((p) => (
          <li key={p.id} style={rowStyle}>
            <span style={{ fontSize: 14 }}>{p.full_name}</span>
            <span className="aq-badge aq-badge-muted">{labelRole(p.role)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AllTasks({
  tasks, profiles, serviceTypes, onOpen,
}: {
  tasks: any[]; profiles: any[]; serviceTypes: any[];
  onOpen: (id: string) => void;
}) {
  const labelRole = (role: string) => role === 'key_account' ? 'Key account' : role;
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [memberFilter, setMemberFilter] = useState<string>('all');

  const q = query.trim().toLowerCase();
  const filtered = tasks.filter((t) => {
    if (stageFilter !== 'all' && t.stage !== stageFilter) return false;
    if (memberFilter !== 'all') {
      const matches =
        t.assignee_id     === memberFilter ||
        t.key_account_id  === memberFilter ||
        t.sales_closer_id === memberFilter ||
        t.creator_id      === memberFilter;
      if (!matches) return false;
    }
    if (!q) return true;
    // Multi-field search: name, brand, client identifier, task id,
    // assignee / KA / closer name (resolved via profiles).
    return [
      t.task_name, t.title, t.brand_name, t.legacy_client_id,
      t.id, t.description, t.contract_request_id,
      profiles.find((p: any) => p.id === t.assignee_id)?.full_name,
      profiles.find((p: any) => p.id === t.key_account_id)?.full_name,
      profiles.find((p: any) => p.id === t.sales_closer_id)?.full_name,
    ].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const completed = filtered.filter((t) => t.stage === 'completed').length;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="aq-card" style={{ padding: 16, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10 }}>
        <input
          className="aq-input"
          placeholder="Search task name, brand, client, assignee, key account, ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="aq-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="all">All stages</option>
          <option value="pending_marketing">Pending marketing</option>
          <option value="in_progress">In progress</option>
          <option value="awaiting_review">Awaiting review</option>
          <option value="completed">Completed</option>
          <option value="draft">Draft</option>
        </select>
        <select className="aq-select" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}>
          <option value="all">All members</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.full_name} ({labelRole(p.role)})</option>
          ))}
        </select>
        <span className="aq-badge aq-badge-muted" style={{ alignSelf: 'center' }}>
          {filtered.length} · {completed} done
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="aq-card" style={{ padding: 32, textAlign: 'center', color: 'var(--aq-text-muted)' }}>
          {tasks.length === 0
            ? 'No workflow tasks yet. Try the New Task screen.'
            : 'No tasks match your filters.'}
        </div>
      ) : (
        <div className="aq-card" style={{ padding: 20 }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map((t) => {
              const closer = profiles.find((p) => p.id === t.sales_closer_id);
              const ka = profiles.find((p) => p.id === t.key_account_id);
              const st = serviceTypes.find((s) => s.id === t.service_type_id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(t.id)}
                    style={{ ...(rowStyle as any), width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>{t.task_name || t.title}</strong>
                      <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                        {t.brand_name ? `${t.brand_name} · ` : ''}
                        {t.legacy_client_id ? `client ${t.legacy_client_id} · ` : ''}
                        {st ? `${st.icon ?? ''} ${st.name} · ` : ''}
                        priority {t.priority}
                        {closer ? ` · sales ${closer.full_name}` : ''}
                        {ka ? ` · KA ${ka.full_name}` : ''}
                      </div>
                    </div>
                    <span className={`aq-badge ${
                      t.stage === 'completed' ? 'aq-badge-success'
                      : t.stage === 'pending_marketing' ? 'aq-badge-warning'
                      : 'aq-badge-info'
                    }`}>
                      {t.stage.replace('_', ' ')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 14px', borderRadius: 'var(--aq-radius)',
  border: '1px solid var(--aq-border-light)',
  background: 'var(--aq-bg-elevated)',
};
