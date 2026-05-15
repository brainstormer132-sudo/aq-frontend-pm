'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { TopBar } from '@/components/layout/TopBar';
import { Modal } from '@/components/ui/Modal';
import { Dropdown } from '@/components/ui/Dropdown';
import { formatDate } from '@/lib/utils';
import type { WorkspaceMember, WorkspaceRole } from '@/types';

interface TeamViewProps {
  members: WorkspaceMember[];
  onInvite: (email: string, role: WorkspaceRole) => void;
  onUpdateRole: (memberId: string, role: WorkspaceRole) => void;
  onRemoveMember: (memberId: string) => void;
  currentUserId: string | null;
}

export function TeamView({
  members,
  onInvite,
  onUpdateRole,
  onRemoveMember,
  currentUserId,
}: TeamViewProps) {
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredMembers = members.filter((m) =>
    m.profile?.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const roleColors: Record<WorkspaceRole, string> = {
    owner: 'var(--aq-warning)',
    admin: 'var(--aq-accent)',
    operations: 'var(--aq-info)',
    sales: 'var(--aq-success)',
    marketing: 'var(--aq-purple)',
    key_account: 'var(--aq-primary)',
    member: 'var(--aq-success)',
  };
  const roles: WorkspaceRole[] = ['owner', 'admin', 'operations', 'sales', 'marketing', 'key_account', 'member'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TopBar
        title="Team"
        subtitle={`${members.length} members`}
        onSearch={setSearchQuery}
        actions={
          <button
            className="aq-btn aq-btn-primary"
            style={{ fontSize: 13 }}
            onClick={() => setInviteModalOpen(true)}
          >
            + Invite Member
          </button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {/* Stats */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {roles.map((role) => {
            const count = members.filter((m) => m.role === role).length;
            return (
              <div
                key={role}
                className="aq-card"
                style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: roleColors[role],
                  }}
                />
                <span style={{ fontSize: 13, color: 'var(--aq-text-secondary)' }}>
                  {role.charAt(0).toUpperCase() + role.slice(1)}s
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, marginLeft: 'auto' }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Members list */}
        <div className="aq-card" style={{ overflow: 'hidden' }}>
          {/* Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 140px 80px',
              padding: '10px 16px',
              borderBottom: '1px solid var(--aq-border-light)',
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--aq-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <span>Member</span>
            <span>Role</span>
            <span>Joined</span>
            <span />
          </div>

          {filteredMembers.map((member) => (
            <div
              key={member.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 140px 80px',
                padding: '12px 16px',
                alignItems: 'center',
                borderBottom: '1px solid var(--aq-border-light)',
                transition: 'background var(--aq-transition)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--aq-bg-sunken)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar user={member.profile || null} size="md" />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {member.profile?.full_name}
                    {member.user_id === currentUserId && (
                      <span style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginLeft: 6 }}>(you)</span>
                    )}
                  </div>
                  {member.profile?.job_title && (
                    <div style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>{member.profile.job_title}</div>
                  )}
                </div>
              </div>

              <span
                className="aq-badge"
                style={{
                  background: roleColors[member.role] + '18',
                  color: roleColors[member.role],
                }}
              >
                {member.role}
              </span>

              <span style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>
                {formatDate(member.joined_at)}
              </span>

              <div>
                {member.user_id !== currentUserId && member.role !== 'owner' && (
                  <Dropdown
                    trigger={
                      <button className="aq-btn aq-btn-ghost" style={{ padding: '2px 6px', fontSize: 14 }}>
                        ⋯
                      </button>
                    }
                    items={[
                      { label: 'Make Admin', value: 'admin', icon: '⬆' },
                      { label: 'Make Operations', value: 'operations', icon: '⬆' },
                      { label: 'Make Sales', value: 'sales', icon: '↔' },
                      { label: 'Make Marketing', value: 'marketing', icon: '↔' },
                      { label: 'Make Key Account', value: 'key_account', icon: '↔' },
                      { label: 'Make Member', value: 'member', icon: '↔' },
                      { label: '', value: '', divider: true },
                      { label: 'Remove', value: 'remove', icon: '🗑', danger: true },
                    ]}
                    onSelect={(v) => {
                      if (v === 'remove') onRemoveMember(member.id);
                      else onUpdateRole(member.id, v as WorkspaceRole);
                    }}
                    align="right"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Invite Team Member">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
              Email Address
            </label>
            <input
              className="aq-input"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              autoFocus
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--aq-text-muted)', display: 'block', marginBottom: 4 }}>
              Role
            </label>
            <select
              className="aq-input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
            >
              <option value="member">Member</option>
              <option value="sales">Sales</option>
              <option value="marketing">Marketing</option>
              <option value="key_account">Key Account</option>
              <option value="operations">Operations</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button className="aq-btn aq-btn-secondary" onClick={() => setInviteModalOpen(false)}>
              Cancel
            </button>
            <button
              className="aq-btn aq-btn-primary"
              onClick={() => {
                if (inviteEmail.trim()) {
                  onInvite(inviteEmail.trim(), inviteRole);
                  setInviteEmail('');
                  setInviteModalOpen(false);
                }
              }}
            >
              Send Invite
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
