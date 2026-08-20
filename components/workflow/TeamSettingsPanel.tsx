'use client';

import { useEffect, useMemo, useState } from 'react';
import { absoluteUrl, withBase } from '@/lib/paths';
import {
  useWorkspaceMembers, setWorkspaceMemberRole, useTaskCountsByMember,
  useWorkspaceInvites, deleteWorkspaceInvite, deleteExpiredWorkspaceInvites,
  type WorkspaceInviteRow,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { OperationsLookupsPanel } from './OperationsLookupsPanel';
import { MyProfileCard } from './MyProfileCard';

const ROLES: WorkspaceRole[] = [
  'owner','admin','operations','sales','marketing','key_account','member',
];

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operations: 'Operations',
  sales: 'Sales',
  marketing: 'Marketing',
  key_account: 'Key account',
  member: 'Member',
};

// Color tier per role — owner = accent, admin = info, mid roles = neutral, low = muted.
const ROLE_BADGE: Record<WorkspaceRole, string> = {
  owner: 'aq-badge-success',
  admin: 'aq-badge-info',
  sales: 'aq-badge-info',
  marketing: 'aq-badge-info',
  key_account: 'aq-badge-info',
  operations: 'aq-badge-muted',
  member: 'aq-badge-muted',
};

type CreatedAccount = {
  email: string;
  // null when we linked an existing auth user — they keep their own password.
  password: string | null;
  role: WorkspaceRole;
  created_new_user: boolean;
};

type DeleteTarget = {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired';
};

/**
 * "Remove member" confirm-dialog target. Separate from DeleteTarget
 * because that one is for legacy invite-link rows; this one is for
 * actual workspace_members rows.
 */
type RemoveMemberTarget = {
  membershipId: string;
  displayName: string;
  role: WorkspaceRole;
  isSelf: boolean;
};

export function TeamSettingsPanel({
  workspaceId, currentUserId, role, onProfileSaved,
}: {
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
  /** So the header stops showing the name you have just changed. */
  onProfileSaved?: (profile: { full_name: string; avatar_url: string | null }) => void;
}) {
  const { members, refetch, loading } = useWorkspaceMembers(workspaceId);
  const { counts } = useTaskCountsByMember(workspaceId);
  const { invites, refetch: refetchInvites, loading: loadingInvites } = useWorkspaceInvites(workspaceId);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [showClearExpiredConfirm, setShowClearExpiredConfirm] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [removeMemberTarget, setRemoveMemberTarget] = useState<RemoveMemberTarget | null>(null);

  // Tick once a second so cooldown countdowns and "expired" pills stay accurate
  // even when the tab sits open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const canEdit = role && ['owner','admin'].includes(role);

  const summary = useMemo(() => {
    let pending = 0, accepted = 0, expired = 0;
    for (const inv of invites) {
      if (inv.accepted_at) accepted++;
      else if (new Date(inv.expires_at).getTime() <= now) expired++;
      else pending++;
    }
    return { pending, accepted, expired, total: invites.length };
  }, [invites, now]);

  const expiredPendingCount = useMemo(
    () => invites.filter(
      (inv) => !inv.accepted_at && new Date(inv.expires_at).getTime() <= now,
    ).length,
    [invites, now],
  );

  const change = async (membershipId: string, newRole: WorkspaceRole) => {
    setBusyId(membershipId);
    setError('');
    try {
      await setWorkspaceMemberRole(membershipId, newRole);
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Admin-create: skip the email link entirely. Server provisions the
   * auth user (random password) and links them to the workspace; we
   * reveal the credentials inline for the admin to copy / share.
   *
   * Mirrors the contract app's AdminCreatePortalModal but for team
   * members instead of vendor/client portal accounts.
   */
  const createAccount = async () => {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    setError('');
    setCreatedAccount(null);

    try {
      const targetEmail = inviteEmail.trim();
      const response = await fetch(withBase('/api/team/admin-create'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          email: targetEmail,
          role: inviteRole,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || response.statusText || 'Account creation failed');
      }

      setCreatedAccount({
        email: result.email,
        password: result.password ?? null,
        role: result.role,
        created_new_user: !!result.created_new_user,
      });
      setInviteEmail('');
      setInviteRole('member');
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const copyInviteLink = async (inv: WorkspaceInviteRow) => {
    const link = absoluteUrl(`/auth?invite=${inv.token}`);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedInviteId(inv.id);
      setTimeout(() => setCopiedInviteId((id) => (id === inv.id ? null : id)), 1500);
    } catch (e: any) {
      setError(`Could not copy link: ${e?.message ?? e}`);
    }
  };

  const removeInvite = async (target: DeleteTarget) => {
    setBusyId(target.id);
    setError('');
    try {
      await deleteWorkspaceInvite(target.id);
      await refetchInvites();
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  const clearExpired = async () => {
    setBusyId('clear-expired');
    setError('');
    try {
      await deleteExpiredWorkspaceInvites(workspaceId);
      await refetchInvites();
      setShowClearExpiredConfirm(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Remove a member from the workspace (keep their auth account intact).
   * Server enforces: owner/admin only, blocks removing the last owner,
   * and blocks admin from removing an owner.
   */
  const removeMember = async (target: RemoveMemberTarget) => {
    setBusyId(target.membershipId);
    setError('');
    try {
      const response = await fetch(withBase('/api/team/remove-member'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          membership_id: target.membershipId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || response.statusText || 'Removal failed');
      }
      setRemoveMemberTarget(null);
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  // Your own profile comes FIRST, and for everyone.
  //
  // The rest of this screen is team administration and is owner/admin only —
  // which used to mean a member opening Settings got one sentence telling
  // them they were not allowed in, and no way to change their own name.
  // Editing yourself is not an admin power.
  if (!canEdit) {
    return (
      <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <MyProfileCard userId={currentUserId} onSaved={onProfileSaved} />
        <div className="aq-card" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Team &amp; roles</h2>
          <p style={{ marginTop: 8, color: 'var(--aq-text-muted)', fontSize: 14 }}>
            Managing the team is owner and admin only. Your role is <strong>{role ?? 'unset'}</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <MyProfileCard userId={currentUserId} onSaved={onProfileSaved} />
      <div className="aq-card" style={{ padding: 24 }}>
        <header style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Team & roles</h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
            Create a teammate's account directly — no email is sent. You'll
            get a one-time password to share with them. They can change it
            after signing in.
          </p>
        </header>

        {error && <div className="aq-badge aq-badge-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1fr) 170px auto',
          gap: 10,
          marginBottom: 18,
        }}>
          <input
            className="aq-input"
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="teammate@aqcreativity.com"
          />
          <select
            className="aq-select"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
          >
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button
            type="button"
            className="aq-btn aq-btn-primary"
            onClick={createAccount}
            disabled={inviteBusy || !inviteEmail.trim()}
          >
            {inviteBusy ? 'Creating...' : 'Create account'}
          </button>
        </div>

        {createdAccount && (
          <CreatedAccountCard
            account={createdAccount}
            onClose={() => setCreatedAccount(null)}
          />
        )}

        {loading ? (
          <p style={{ color: 'var(--aq-text-muted)' }}>Loading team...</p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {members.map((m) => {
              const isMe = m.user_id === currentUserId;
              return (
                <li key={m.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '12px 14px',
                  borderRadius: 'var(--aq-radius)',
                  border: '1px solid var(--aq-border-light)',
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {m.profile?.full_name ?? '(no profile)'}
                      {isMe && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--aq-text-muted)' }}>(you)</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>
                      Joined {new Date(m.joined_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className="aq-badge aq-badge-muted">
                    {(counts[m.user_id] ?? 0)} task{(counts[m.user_id] ?? 0) === 1 ? '' : 's'}
                  </span>
                  <select
                    className="aq-select"
                    style={{ width: 160 }}
                    value={m.role}
                    disabled={busyId === m.id || (isMe && m.role === 'owner')}
                    onChange={(e) => change(m.id, e.target.value as WorkspaceRole)}
                    title={isMe && m.role === 'owner' ? "You can't demote yourself from owner here" : ''}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <span className={`aq-badge ${ROLE_BADGE[m.role]}`}>
                    {ROLE_LABELS[m.role]}
                  </span>
                  {/*
                   * Remove button: server enforces the real rules (last
                   * owner, admin-vs-owner). The UI just hides it for
                   * obvious cases: you can't remove yourself if you're
                   * the only owner, and admins can't see Remove on owners.
                   */}
                  <RemoveMemberButton
                    member={m}
                    isMe={isMe}
                    callerRole={role}
                    busy={busyId === m.id}
                    onClick={() => setRemoveMemberTarget({
                      membershipId: m.id,
                      displayName: m.profile?.full_name ?? 'this member',
                      role: m.role,
                      isSelf: isMe,
                    })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/*
       * Legacy invites — kept visible only so admins can clean up rows
       * left over from the old email-link flow. New invites no longer
       * go through this table. Existing pending links still work for
       * the recipient (the /auth?invite=<token> path is unchanged), but
       * we don't expose Resend any more because email sending is gone.
       */}
      {invites.length > 0 && (
        <div className="aq-card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700 }}>Legacy invite links</h3>
              <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
                Old token-based invites from the previous flow. You can copy
                a link or delete the row. New accounts are now created
                directly above — no email or token needed.
              </p>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span className="aq-badge aq-badge-warning">{summary.pending} pending</span>
                <span className="aq-badge aq-badge-success">{summary.accepted} accepted</span>
                <span className="aq-badge aq-badge-error">{summary.expired} expired</span>
              </div>
            </div>
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={() => setShowClearExpiredConfirm(true)}
              disabled={busyId === 'clear-expired' || expiredPendingCount === 0}
              title={expiredPendingCount === 0 ? 'No expired invites to clear' : ''}
            >
              {busyId === 'clear-expired' ? 'Clearing...' : `Clear expired${expiredPendingCount ? ` (${expiredPendingCount})` : ''}`}
            </button>
          </div>

          {loadingInvites ? (
            <p style={{ color: 'var(--aq-text-muted)', marginTop: 14 }}>Loading invites...</p>
          ) : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              {invites.map((inv) => (
                <InviteRow
                  key={inv.id}
                  invite={inv}
                  now={now}
                  busyId={busyId}
                  copiedInviteId={copiedInviteId}
                  onCopy={() => copyInviteLink(inv)}
                  onRequestDelete={(status) => setDeleteTarget({ id: inv.id, email: inv.email, status })}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete invite?"
          body={
            deleteTarget.status === 'accepted'
              ? `This invite for ${deleteTarget.email} has already been accepted. Deleting it will not remove the user — only the audit row.`
              : deleteTarget.status === 'expired'
                ? `Delete the expired invite for ${deleteTarget.email}? This cannot be undone.`
                : `Delete the pending invite for ${deleteTarget.email}? Their existing link will stop working immediately.`
          }
          confirmLabel="Delete invite"
          tone="danger"
          busy={busyId === deleteTarget.id}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => removeInvite(deleteTarget)}
        />
      )}

      {showClearExpiredConfirm && (
        <ConfirmDialog
          title={`Clear ${expiredPendingCount} expired invite${expiredPendingCount === 1 ? '' : 's'}?`}
          body="Only pending invites that have already passed their expiry will be removed. Accepted invites are kept."
          confirmLabel="Clear expired"
          tone="danger"
          busy={busyId === 'clear-expired'}
          onCancel={() => setShowClearExpiredConfirm(false)}
          onConfirm={clearExpired}
        />
      )}

      {removeMemberTarget && (
        <ConfirmDialog
          title={removeMemberTarget.isSelf ? 'Leave this workspace?' : `Remove ${removeMemberTarget.displayName}?`}
          body={
            removeMemberTarget.isSelf
              ? `You will lose access to this workspace. Your Supabase account will not be deleted — an owner can re-add you later.`
              : `${removeMemberTarget.displayName} will lose access to this workspace as ${ROLE_LABELS[removeMemberTarget.role]}. Their Supabase login is kept, so they could be re-added later.`
          }
          confirmLabel={removeMemberTarget.isSelf ? 'Leave workspace' : 'Remove member'}
          tone="danger"
          busy={busyId === removeMemberTarget.membershipId}
          onCancel={() => setRemoveMemberTarget(null)}
          onConfirm={() => removeMember(removeMemberTarget)}
        />
      )}

      {/* Operations lookups — admin-only screen for editing Source +
          Client Category dropdown options used on every campaign.
          Added in migration 028. */}
      <OperationsLookupsPanel workspaceId={workspaceId} role={role} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InviteRow({
  invite, now, busyId, copiedInviteId,
  onCopy, onRequestDelete,
}: {
  invite: WorkspaceInviteRow;
  now: number;
  busyId: string | null;
  copiedInviteId: string | null;
  onCopy: () => void;
  onRequestDelete: (status: 'pending' | 'accepted' | 'expired') => void;
}) {
  const expiresMs = new Date(invite.expires_at).getTime();
  const expired = expiresMs <= now;
  const pending = !invite.accepted_at && !expired;
  const status: 'pending' | 'accepted' | 'expired' =
    invite.accepted_at ? 'accepted' : expired ? 'expired' : 'pending';

  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1fr) auto auto auto auto',
      gap: 10,
      alignItems: 'center',
      padding: '12px 14px',
      borderRadius: 'var(--aq-radius)',
      border: '1px solid var(--aq-border-light)',
    }}>
      <div>
        <div style={{ fontWeight: 650, fontSize: 14 }}>{invite.email}</div>
        <div style={{ color: 'var(--aq-text-muted)', fontSize: 12 }}>
          Sent by {invite.inviter?.full_name ?? 'Unknown'} · {expired ? 'expired' : 'expires'} {new Date(invite.expires_at).toLocaleString()}
        </div>
      </div>
      <span className={`aq-badge ${
        status === 'accepted' ? 'aq-badge-success'
        : status === 'expired' ? 'aq-badge-error'
        : 'aq-badge-warning'
      }`}>
        {status}
      </span>
      <span className={`aq-badge ${ROLE_BADGE[invite.role]}`}>
        {ROLE_LABELS[invite.role]}
      </span>
      <button
        type="button"
        className="aq-btn aq-btn-ghost"
        onClick={onCopy}
        disabled={!pending}
        title={pending ? 'Copy invite link' : 'Cannot copy a non-pending invite'}
        style={{ padding: '6px 10px' }}
      >
        {copiedInviteId === invite.id ? 'Copied' : 'Copy link'}
      </button>
      <button
        type="button"
        className="aq-btn aq-btn-ghost"
        onClick={() => onRequestDelete(status)}
        disabled={busyId === invite.id}
        style={{ padding: '6px 10px' }}
      >
        Delete
      </button>
    </li>
  );
}

/**
 * Reveal-once credentials card shown after the admin-create POST
 * succeeds. Mirrors the vendor/client portal AdminCreatePortalModal
 * UX: email + password + role in copyable code blocks.
 */
function CreatedAccountCard({
  account, onClose,
}: {
  account: CreatedAccount;
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      setTimeout(() => setCopiedField((c) => (c === label ? null : c)), 1500);
    } catch { /* swallow — user can select & copy by hand */ }
  };

  return (
    <div className="aq-card" style={{
      marginBottom: 16,
      padding: 16,
      background: 'var(--aq-bg-elevated)',
      border: '1px solid var(--aq-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {account.created_new_user ? 'Account created' : 'Workspace access granted'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--aq-text-muted)', marginTop: 2 }}>
            {account.created_new_user
              ? `Share these credentials with the new ${ROLE_LABELS[account.role]}. They can change the password after signing in.`
              : `${account.email} already had an account — they were added to this workspace as ${ROLE_LABELS[account.role]}. No new password needed.`}
          </div>
        </div>
        <button
          type="button"
          className="aq-btn aq-btn-ghost"
          onClick={onClose}
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          Dismiss
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        <CredentialLine
          label="Email"
          value={account.email}
          copied={copiedField === 'email'}
          onCopy={() => copy('email', account.email)}
        />
        {account.password && (
          <CredentialLine
            label="Password"
            value={account.password}
            copied={copiedField === 'password'}
            onCopy={() => copy('password', account.password!)}
          />
        )}
        <CredentialLine
          label="Sign-in URL"
          value={absoluteUrl('/auth')}
          copied={copiedField === 'url'}
          onCopy={() => copy('url', absoluteUrl('/auth'))}
        />
      </div>
    </div>
  );
}

/**
 * Per-row Remove button. The real authorization happens server-side in
 * /api/team/remove-member — this component just hides cases that are
 * obviously useless to surface:
 *   - Don't show "Remove" on an owner row when the caller isn't an
 *     owner; admin can't remove an owner anyway.
 *   - Don't show "Remove" on your own row if you're the sole owner —
 *     it would either fail with "last owner" or leave the workspace
 *     stranded. (Multi-owner self-removal is allowed.)
 */
function RemoveMemberButton({
  member, isMe, callerRole, busy, onClick,
}: {
  member: { id: string; role: WorkspaceRole };
  isMe: boolean;
  callerRole: WorkspaceRole | null;
  busy: boolean;
  onClick: () => void;
}) {
  // Admin viewing an owner → hide.
  if (member.role === 'owner' && callerRole !== 'owner') return null;

  return (
    <button
      type="button"
      className="aq-btn aq-btn-ghost"
      onClick={onClick}
      disabled={busy}
      style={{ padding: '6px 10px', fontSize: 12, color: 'var(--aq-error)' }}
      title={isMe ? 'Leave this workspace' : 'Remove from workspace'}
    >
      {busy ? 'Working...' : (isMe ? 'Leave' : 'Remove')}
    </button>
  );
}

function CredentialLine({
  label, value, copied, onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--aq-text-muted)',
        minWidth: 80,
      }}>
        {label}
      </span>
      <code style={{
        flex: 1, fontSize: 13, padding: '8px 10px',
        background: 'var(--aq-bg)', borderRadius: 'var(--aq-radius)',
        wordBreak: 'break-all',
      }}>
        {value}
      </code>
      <button
        type="button"
        className="aq-btn aq-btn-secondary"
        onClick={onCopy}
        style={{ padding: '6px 12px', fontSize: 12 }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ConfirmDialog({
  title, body, confirmLabel, tone, busy, onConfirm, onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'danger' | 'default';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="aq-card"
        style={{
          maxWidth: 440, width: '100%', padding: 24, background: 'var(--aq-bg-elevated)',
          boxShadow: '0 16px 48px rgba(15, 23, 42, 0.25)',
        }}
      >
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{title}</h3>
        <p style={{ color: 'var(--aq-text-secondary)', fontSize: 13, lineHeight: 1.55, marginBottom: 18 }}>
          {body}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="aq-btn aq-btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`aq-btn ${tone === 'danger' ? 'aq-btn-danger' : 'aq-btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
            style={tone === 'danger' ? { background: 'var(--aq-error)', color: '#fff' } : undefined}
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
