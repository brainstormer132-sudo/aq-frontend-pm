'use client';

import { useEffect, useState } from 'react';
import type { WorkspaceRole } from '@/hooks/use-workflow';
import { AQMark } from '@/components/auth/AQMark';

/** Remembered across sessions so the sidebar opens the way you left it. */
const COLLAPSED_KEY = 'aq_sidebar_collapsed';

type View = 'dashboard' | 'inbox' | 'marketing-triage' | 'new-task' | 'all-tasks' | 'my-tasks' | 'crm'
          | 'clients' | 'vendors' | 'tracking' | 'contracts' | 'data'
          | 'team' | 'settings';

interface NavItem {
  id: View;
  label: string;
  icon: IconName;
  visibleTo: WorkspaceRole[];
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard',  icon: 'home',     visibleTo: [] },
  { id: 'new-task',  label: 'New Task',   icon: 'plus',     visibleTo: ['owner','admin','sales','marketing'] },
  // Personal Inbox — searchable list of notifications + mentions for the
  // current user. Replaces the old topbar bell. Visible to everyone; the
  // marketing-triage queue (different concept) is reached via the dashboard
  // "Pending triage" stat card.
  { id: 'inbox',     label: 'Inbox',      icon: 'inbox',    visibleTo: [] },
  // Operations is included: quotation/invoice/contract requests (migration 038)
  // notify Ops, and All Tasks is how they browse to the campaign that owns the
  // subtask they were pinged about.
  { id: 'all-tasks', label: 'All Tasks',  icon: 'list',     visibleTo: ['owner','admin','marketing','key_account','operations'] },
  { id: 'my-tasks',  label: 'My Tasks',   icon: 'check',    visibleTo: [] },
  // Marketing Triage — tasks waiting for priority/service-type/key-account.
  // Marketing/admin/owner only. The dashboard "Pending triage" stat card
  // also links here.
  { id: 'marketing-triage', label: 'Marketing Inbox', icon: 'inbox', visibleTo: ['owner','admin','marketing'] },
  // Contracts nav removed 2026-05-16 — contract requests flow lives in the
  // contract maker (/contracts/). The "Request contract" button on a task
  // still posts here, just no dedicated view in the PM sidebar.
  // CRM lives ABOVE the raw Clients/Vendors data screens — it's the
  // primary surface for relationship management; the others stay around
  // for admin/data entry. Visible to anyone who works with clients/vendors.
  { id: 'crm',             label: 'CRM',             icon: 'users',     visibleTo: ['owner','admin','marketing','sales','key_account'] },
  { id: 'clients',         label: 'Clients',         icon: 'building',  visibleTo: ['owner','admin','marketing','sales'] },
  { id: 'vendors',         label: 'Vendors',         icon: 'briefcase', visibleTo: ['owner','admin','marketing'] },
  // Tracking Sheets — every campaign flagged with a tracking sheet (chosen at
  // triage via the "Tracking Sheet" subtask). Opens the ad/vendor grid.
  { id: 'tracking',        label: 'Tracking Sheets', icon: 'grid',      visibleTo: ['owner','admin','marketing','sales','key_account','operations'] },
  // Data — one search box over every client and vendor, and the same panels
  // narrowed to whoever is picked. It shows net_amount and aq_gross, which
  // are AQ's margin, so it is NOT visible to everyone: marketing and
  // operations have no reason to see what the agency makes on a job.
  { id: 'data',            label: 'Data',            icon: 'chart',     visibleTo: ['owner','admin','sales','key_account'] },
  { id: 'team',            label: 'Team',            icon: 'users',     visibleTo: [] },
  { id: 'settings',        label: 'Settings',        icon: 'settings',  visibleTo: ['owner','admin'] },
];

/** Two letters for the collapsed footer. Falls back to a dot for a blank name. */
function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function roleLabel(role: WorkspaceRole | null) {
  if (!role) return 'no role';
  if (role === 'key_account') return 'Key account';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function WorkflowSidebar({
  view, onViewChange, role, userName, workspaceName, pendingCount, onSignOut,
}: {
  view: View;
  onViewChange: (v: View) => void;
  role: WorkspaceRole | null;
  userName: string;
  workspaceName: string;
  pendingCount?: number;
  onSignOut: () => void;
}) {
  const items = NAV.filter((n) => n.visibleTo.length === 0 || (role && n.visibleTo.includes(role)));

  // Starts expanded and corrects itself after mount rather than reading
  // localStorage during render — the server has no localStorage, and a
  // mismatch between the two renders is a hydration error.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1'); } catch { /* private mode */ }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  };

  return (
    <aside style={{
      width: collapsed ? 68 : 240,
      flexShrink: 0,
      transition: 'width var(--aq-transition, 160ms ease)',
      background: 'var(--aq-sidebar-bg)',
      color: 'var(--aq-sidebar-text)',
      display: 'flex',
      flexDirection: 'column',
      padding: collapsed ? '20px 10px' : '20px 14px',
      gap: 4,
      borderRight: '1px solid var(--aq-sidebar-border)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: collapsed ? '6px 0 18px' : '6px 10px 18px',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <div
          title={collapsed ? 'AQ' : undefined}
          style={{
            width: 40, height: 40, borderRadius: 10,
            background: '#000', color: '#fff', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {/* Drawn, not fetched — see AQMark. The old <img src="/aq-logo.png">
              404'd on every load and its onError fallback quietly printed the
              letters "AQ", which is why nobody noticed the logo was missing. */}
          <AQMark size={24} />
        </div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <strong style={{ color: 'var(--aq-sidebar-text-active)', fontSize: 15 }}>AQ</strong>
            <span style={{
              fontSize: 11, color: 'var(--aq-sidebar-text)', opacity: 0.7,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{workspaceName}</span>
          </div>
        )}
      </div>

      {/* Collapse toggle. Its own row rather than tucked next to the logo, so
          it doesn't move when the labels disappear. */}
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          gap: 8, marginBottom: 6, padding: '6px 12px',
          background: 'transparent', border: 'none',
          color: 'var(--aq-sidebar-text)', opacity: 0.7,
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
          borderRadius: 'var(--aq-radius)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--aq-sidebar-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'transparent'; }}
      >
        {!collapsed && <span>Collapse</span>}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
             style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }}>
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {items.map((n) => {
          const active = view === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onViewChange(n.id)}
              title={collapsed ? n.label : undefined}
              aria-label={collapsed ? n.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 10,
                padding: collapsed ? '10px 0' : '10px 12px',
                border: 'none',
                background: active ? 'var(--aq-sidebar-hover)' : 'transparent',
                color: active ? 'var(--aq-sidebar-text-active)' : 'var(--aq-sidebar-text)',
                borderRadius: 'var(--aq-radius)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                textAlign: 'left',
                position: 'relative',
                transition: 'all var(--aq-transition)',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--aq-sidebar-hover)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{
                width: 22,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: active ? 1 : 0.72,
              }}>
                <NavIcon name={n.icon} />
              </span>
              {!collapsed && <span style={{ flex: 1 }}>{n.label}</span>}
              {/* pendingCount is the marketing TRIAGE backlog, so it belongs on
                  Marketing Inbox — it used to sit on the personal Inbox, where
                  every role saw a number that had nothing to do with them. */}
              {n.id === 'marketing-triage' && pendingCount && pendingCount > 0 ? (
                collapsed ? (
                  // No room for the count, but "there is something waiting"
                  // still has to survive the collapse.
                  <span
                    title={`${pendingCount} waiting`}
                    style={{
                      position: 'absolute', top: 7, right: 9,
                      width: 7, height: 7, borderRadius: '50%',
                      background: 'var(--aq-accent)',
                    }}
                  />
                ) : (
                  <span style={{
                    background: 'var(--aq-accent)', color: '#fff',
                    fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 9999,
                  }}>{pendingCount}</span>
                )
              ) : null}
              {active && (
                <span style={{
                  position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
                  background: 'var(--aq-accent)', borderRadius: 2,
                }} />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{
        borderTop: '1px solid var(--aq-sidebar-border)',
        paddingTop: 12, marginTop: 8,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {collapsed ? (
          <div
            title={`${userName} · ${roleLabel(role)}`}
            style={{
              alignSelf: 'center', width: 32, height: 32, borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--aq-sidebar-hover)',
              color: 'var(--aq-sidebar-text-active)', fontSize: 11, fontWeight: 700,
            }}
          >{initials(userName)}</div>
        ) : (
          <div style={{ padding: '4px 10px' }}>
            <div style={{ color: 'var(--aq-sidebar-text-active)', fontSize: 13, fontWeight: 600 }}>{userName}</div>
            <div style={{ color: 'var(--aq-sidebar-text)', fontSize: 11, opacity: 0.7 }}>{roleLabel(role)}</div>
          </div>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title={collapsed ? 'Sign out' : undefined}
          aria-label="Sign out"
          style={{
            background: 'transparent',
            border: '1px solid var(--aq-sidebar-border)',
            color: 'var(--aq-sidebar-text)',
            padding: collapsed ? '8px 0' : '8px 12px',
            borderRadius: 'var(--aq-radius)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >{collapsed ? '⏻' : 'Sign out'}</button>
      </div>
    </aside>
  );
}

export type { View };

type IconName = 'home' | 'plus' | 'inbox' | 'list' | 'check' | 'file' | 'building' | 'briefcase' | 'grid' | 'chart' | 'users' | 'settings';

function NavIcon({ name }: { name: IconName }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'home') return (
    <svg {...common}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></svg>
  );
  if (name === 'plus') return (
    <svg {...common}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
  );
  if (name === 'inbox') return (
    <svg {...common}><path d="M4 4h16l2 10v6H2v-6L4 4Z" /><path d="M2 14h6l2 3h4l2-3h6" /></svg>
  );
  if (name === 'list') return (
    <svg {...common}><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></svg>
  );
  if (name === 'check') return (
    <svg {...common}><path d="m5 12 4 4L19 6" /></svg>
  );
  if (name === 'file') return (
    <svg {...common}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /></svg>
  );
  if (name === 'building') return (
    <svg {...common}><path d="M4 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" /><path d="M9 21v-5h4v5" /><path d="M8 7h1" /><path d="M13 7h1" /><path d="M8 11h1" /><path d="M13 11h1" /><path d="M3 21h18" /></svg>
  );
  if (name === 'briefcase') return (
    <svg {...common}><path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1" /><path d="M3 7h18v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 12h18" /></svg>
  );
  if (name === 'grid') return (
    <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /></svg>
  );
  if (name === 'chart') return (
    <svg {...common}><path d="M3 3v18h18" /><path d="M7 15v-4" /><path d="M12 15V7" /><path d="M17 15v-6" /></svg>
  );
  if (name === 'users') return (
    <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
  );
  return (
    <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-.4-1.1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.1.4 1.7 1.7 0 0 0-.44.2Z" /></svg>
  );
}
