'use client';

import { OperationsLookupsPanel } from './OperationsLookupsPanel';
import type { WorkspaceRole } from '@/hooks/use-workflow';

/**
 * Settings — configuration, and nothing about people.
 *
 * This file used to be the team screen: the roster, role changes, account
 * creation, removals and the legacy invite links, all on a screen called
 * Settings, while the screen called **Team** printed a name and a badge.
 * Worse, Settings is `visibleTo: ['owner','admin']` in the sidebar, so
 * everything on it — including *your own profile* — was invisible to
 * everybody else.
 *
 * All of that moved to `TeamView.tsx`, which is where the sidebar already
 * pointed. What is left here is workspace configuration.
 *
 * `currentUserId` and `onProfileSaved` are still accepted so page.tsx does not
 * have to change shape twice; they are unused now that the profile card lives
 * on Team, and can go when Settings gets its own pass.
 */
export function TeamSettingsPanel({
  workspaceId, role,
}: {
  workspaceId: string;
  currentUserId?: string;
  role: WorkspaceRole | null;
  onProfileSaved?: (profile: { full_name: string; avatar_url: string | null }) => void;
}) {
  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Settings</h2>
        <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginTop: 4 }}>
          Workspace configuration. People, roles and logins live on <strong>Team</strong>.
        </p>
      </header>

      {/* Operations lookups — the Source and Client Category options used on
          every campaign. Admin-only; the panel gates itself. */}
      <OperationsLookupsPanel workspaceId={workspaceId} role={role} />
    </div>
  );
}
