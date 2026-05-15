'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { canDo } from '@/types';
import type { Profile, Workspace, Project, WorkspaceRole } from '@/types';
import { PROJECT_COLORS } from '@/lib/utils';

interface SidebarProps {
  user: Profile | null;
  workspace: Workspace | null;
  projects: Project[];
  activeProjectId: string | null;
  activePage: string;
  userRole: WorkspaceRole | null;
  onNavigate: (page: string, projectId?: string) => void;
  onCreateProject: () => void;
  onSignOut: () => void;
}

export function Sidebar({
  user, workspace, projects, activeProjectId,
  activePage, userRole, onNavigate, onCreateProject, onSignOut,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Build nav items based on role
  const navItems: { id: string; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: '◫' },
    { id: 'my-tasks', label: 'My Tasks', icon: '☑' },
  ];

  if (canDo(userRole || undefined, 'view_assigned_clients')) {
    navItems.push({ id: 'clients', label: 'Clients', icon: '🏢' });
    navItems.push({ id: 'vendors', label: 'Vendors', icon: '🏭' });
  }

  navItems.push({ id: 'contracts', label: 'Contracts', icon: '📄' });

  if (canDo(userRole || undefined, 'view_team')) {
    navItems.push({ id: 'team', label: 'Team', icon: '⚇' });
  }

  navItems.push({ id: 'inbox', label: 'Inbox', icon: '✉' });

  return (
    <aside style={{
      width: collapsed ? 60 : 260, height: '100vh',
      background: 'var(--aq-sidebar-bg)', display: 'flex', flexDirection: 'column',
      transition: 'width 0.2s ease', flexShrink: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: collapsed ? '16px 12px' : '16px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid rgba(255,255,255,0.08)', minHeight: 56,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6, background: 'var(--aq-accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>AQ</div>
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--aq-sidebar-text-active)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workspace?.name || 'AQ Creativity'}
            </div>
            {userRole && (
              <div style={{ fontSize: 10, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {userRole}
              </div>
            )}
          </div>
        )}
        <button onClick={() => setCollapsed(!collapsed)} style={{
          background: 'none', border: 'none', color: 'var(--aq-sidebar-text)',
          cursor: 'pointer', fontSize: 16, padding: 2, flexShrink: 0,
        }} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ padding: '12px 8px', flex: 1, overflowY: 'auto' }}>
        {navItems.map((item) => (
          <button key={item.id} onClick={() => onNavigate(item.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '8px 12px', borderRadius: 6, border: 'none',
            background: activePage === item.id ? 'var(--aq-sidebar-hover)' : 'transparent',
            color: activePage === item.id ? 'var(--aq-sidebar-text-active)' : 'var(--aq-sidebar-text)',
            cursor: 'pointer', fontSize: 13,
            fontWeight: activePage === item.id ? 500 : 400,
            textAlign: 'left', transition: 'all var(--aq-transition)', marginBottom: 2,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}>
            <span style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}

        {/* Projects section */}
        {!collapsed && (
          <div style={{ marginTop: 24 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0 12px', marginBottom: 8,
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--aq-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Projects
              </span>
              {canDo(userRole || undefined, 'create_projects') && (
                <button onClick={onCreateProject} style={{
                  background: 'none', border: 'none', color: 'var(--aq-sidebar-text)',
                  cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
                }} title="New project">+</button>
              )}
            </div>
            {projects.map((project) => (
              <button key={project.id} onClick={() => onNavigate('project', project.id)} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 12px', borderRadius: 6, border: 'none',
                background: activeProjectId === project.id ? 'var(--aq-sidebar-hover)' : 'transparent',
                color: activeProjectId === project.id ? 'var(--aq-sidebar-text-active)' : 'var(--aq-sidebar-text)',
                cursor: 'pointer', fontSize: 13, textAlign: 'left',
                transition: 'all var(--aq-transition)', marginBottom: 1,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: PROJECT_COLORS[project.color], flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {project.icon} {project.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* User area */}
      <div style={{
        padding: collapsed ? '12px 8px' : '12px 16px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Avatar user={user} size="sm" />
        {!collapsed && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--aq-sidebar-text-active)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.full_name || 'User'}
              </div>
            </div>
            <button onClick={onSignOut} style={{
              background: 'none', border: 'none', color: 'var(--aq-sidebar-text)',
              cursor: 'pointer', fontSize: 14,
            }} title="Sign out">↗</button>
          </>
        )}
      </div>
    </aside>
  );
}
