'use client';

import { useEffect, useMemo, useState } from 'react';
import { absoluteUrl, withBase } from '@/lib/paths';
import {
  useWorkspaceMembers, setWorkspaceMemberRole, useTaskCountsByMember,
  useWorkspaceInvites, createWorkspaceInvite, deleteWorkspaceInvite,
  deleteExpiredWorkspaceInvites,
  recordInviteResend, recordInviteResendFailure,
  useInviteEvents,
  type WorkspaceInviteRow,
  type InviteEventRow,
  type WorkspaceRole,
} from '@/hooks/use-workflow';
import { OperationsLookupsPanel } from './OperationsLookupsPanel';

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

const RESEND_COOLDOWN_SECONDS = 60;

type LastInvite = {
  link: string;
  email: string;
  status: string;
  ok: boolean;
  detail?: string | null;
};

type DeleteTarget = {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired';
};

export function TeamSettingsPanel({
  workspaceId, currentUserId, role,
}: {
  workspaceId: string;
  currentUserId: string;
  role: WorkspaceRole | null;
}) {
  const { members, refetch, loading } = useWorkspaceMembers(workspaceId);
  const { counts } = useTaskCountsByMember(workspaceId);
  const { invites, refetch: refetchInvites, loading: loadingInvites } = useWorkspaceInvites(workspaceId);
  const { events, refetch: refetchEvents } = useInviteEvents(workspaceId, 15);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [inviteHours, setInviteHours] = useState<1 | 12 | 24>(24);
  const [lastInvite, setLastInvite] = useState<LastInvite | null>(null);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [showClearExpiredConfirm, setShowClearExpiredConfirm] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

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

  const sendInviteEmail = async (email: string, link: string, roleLabel: string, expiresAt: string) => {
    const mail = await fetch(withBase('/api/invites/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        link,
        role: roleLabel,
        expiresAt,
        workspaceName: 'AQ Creativity',
      }),
    });
    const result = await mail.json().catch(() => ({}));
    if (!mail.ok) {
      const err = new Error(result?.error || mail.statusText);
      (err as any).provider = result?.provider ?? null;
      throw err;
    }
  };

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

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteBusy(true);
    setError('');
    setLastInvite(null);

    try {
      const targetEmail = inviteEmail.trim();
      const created = await createWorkspaceInvite(workspaceId, targetEmail, inviteRole, inviteHours);
      const link = absoluteUrl(`/auth?invite=${created.token}`);
      await navigator.clipboard?.writeText(link).catch(() => {});

      try {
        await sendInviteEmail(created.email, link, ROLE_LABELS[created.role], created.expires_at);
        setLastInvite({
          email: targetEmail,
          link,
          ok: true,
          status: `Invite email sent to ${targetEmail}. The link was also copied.`,
        });
      } catch (mailError: any) {
        const provider = mailError?.provider;
        const detail = provider
          ? `${provider.name ?? 'error'} (${provider.status ?? '???'}): ${provider.message ?? ''}`
          : null;
        setLastInvite({
          email: targetEmail,
          link,
          ok: false,
          status: `Invite created, but email was not sent: ${mailError?.message ?? mailError}`,
          detail,
        });
      }

      setInviteEmail('');
      setInviteRole('member');
      setInviteHours(24);
      await refetchInvites();
      await refetchEvents();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const resendInvite = async (inv: WorkspaceInviteRow) => {
    setBusyId(inv.id);
    setError('');
    setLastInvite(null);
    const link = absoluteUrl(`/auth?invite=${inv.token}`);

    try {
      // 1. Server-side cooldown check + counter bump. If this throws, no email
      //    is sent and no counter is consumed for follow-up clicks.
      await recordInviteResend(inv.id);

      // 2. Actually send the email.
      try {
        await sendInviteEmail(inv.email, link, ROLE_LABELS[inv.role], inv.expires_at);
        await navigator.clipboard?.writeText(link).catch(() => {});
        setLastInvite({
          email: inv.email,
          link,
          ok: true,
          status: `Invite resent to ${inv.email}. The link was also copied.`,
        });
      } catch (mailError: any) {
        const provider = mailError?.provider;
        const reason = provider
          ? `${provider.name ?? 'error'} (${provider.status ?? '???'}): ${provider.message ?? ''}`
          : (mailError?.message ?? String(mailError));
        // Log the failure so admins can see it in the audit trail.
        await recordInviteResendFailure(inv.id, reason).catch(() => {});
        setLastInvite({
          email: inv.email,
          link,
          ok: false,
          status: `Invite was not resent: ${mailError?.message ?? mailError}`,
          detail: reason,
        });
      }
    } catch (cooldownError: any) {
      // The cooldown RPC threw — show the message verbatim, no email sent.
      setLastInvite({
        email: inv.email,
        link,
        ok: false,
        status: cooldownError?.message ?? String(cooldownError),
      });
    } finally {
      await refetchInvites();
      await refetchEvents();
      setBusyId(null);
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
      await refetchEvents();
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
      await refetchEvents();
      setShowClearExpiredConfirm(false);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!canEdit) {
    return (
      <div className="aq-card" style={{ padding: 28 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Settings - Team</h2>
        <p style={{ marginTop: 8, color: 'var(--aq-text-muted)', fontSize: 14 }}>
          Only owner and admin roles can manage team. Your role is <strong>{role ?? 'unset'}</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="aq-card" style={{ padding: 24 }}>
        <header style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Team & roles</h2>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
            Invite teammates, promote, demote, or remove access. Invites expire in the window you choose.
          </p>
        </header>

        {error && <div className="aq-badge aq-badge-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1fr) 170px 150px auto',
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
          <select
            className="aq-select"
            value={inviteHours}
            onChange={(e) => setInviteHours(Number(e.target.value) as 1 | 12 | 24)}
          >
            <option value={1}>1 hour</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
          </select>
          <button
            type="button"
            className="aq-btn aq-btn-primary"
            onClick={invite}
            disabled={inviteBusy || !inviteEmail.trim()}
          >
            {inviteBusy ? 'Creating...' : 'Create invite'}
          </button>
        </div>

        {lastInvite && (
          <InviteStatus invite={lastInvite} />
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
                  gridTemplateColumns: '1fr auto auto auto',
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="aq-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Recent invites</h3>
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
              Resend pending invites, copy a link, or clear all expired pending invites.
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
        ) : invites.length === 0 ? (
          <p style={{ color: 'var(--aq-text-muted)', marginTop: 14 }}>No invites yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {invites.map((inv) => (
              <InviteRow
                key={inv.id}
                invite={inv}
                now={now}
                busyId={busyId}
                copiedInviteId={copiedInviteId}
                onResend={() => resendInvite(inv)}
                onCopy={() => copyInviteLink(inv)}
                onRequestDelete={(status) => setDeleteTarget({ id: inv.id, email: inv.email, status })}
              />
            ))}
          </ul>
        )}
      </div>

      {events.length > 0 && (
        <div className="aq-card" style={{ padding: 24 }}>
          <header style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>Invite activity</h3>
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 4 }}>
              Audit trail of every invite action in this workspace.
            </p>
          </header>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {events.map((ev) => (
              <li key={ev.id} style={{ fontSize: 12, color: 'var(--aq-text-secondary)', padding: '4px 0' }}>
                <strong>{ev.actor?.full_name ?? 'Someone'}</strong>
                {' '}{describeEvent(ev)}{' '}
                <span style={{ color: 'var(--aq-text-muted)' }}>· {formatRelative(ev.created_at, now)}</span>
              </li>
            ))}
          </ul>
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
  onResend, onCopy, onRequestDelete,
}: {
  invite: WorkspaceInviteRow;
  now: number;
  busyId: string | null;
  copiedInviteId: string | null;
  onResend: () => void;
  onCopy: () => void;
  onRequestDelete: (status: 'pending' | 'accepted' | 'expired') => void;
}) {
  const expiresMs = new Date(invite.expires_at).getTime();
  const expired = expiresMs <= now;
  const pending = !invite.accepted_at && !expired;
  const status: 'pending' | 'accepted' | 'expired' =
    invite.accepted_at ? 'accepted' : expired ? 'expired' : 'pending';

  const cooldownLeft = invite.last_resent_at
    ? Math.max(
        0,
        RESEND_COOLDOWN_SECONDS -
          Math.floor((now - new Date(invite.last_resent_at).getTime()) / 1000),
      )
    : 0;
  const onCooldown = cooldownLeft > 0;

  const resendDisabled = !pending || busyId === invite.id || onCooldown;
  const resendLabel = busyId === invite.id
    ? 'Working...'
    : onCooldown
      ? `Resend (${cooldownLeft}s)`
      : invite.resend_count > 0
        ? `Resend (sent ${invite.resend_count}x)`
        : 'Resend';

  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(180px, 1fr) auto auto auto auto auto',
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
        className="aq-btn aq-btn-secondary"
        onClick={onResend}
        disabled={resendDisabled}
        title={
          onCooldown
            ? `Wait ${cooldownLeft}s before resending`
            : !pending
              ? 'Only pending invites can be resent'
              : ''
        }
        style={{ padding: '6px 10px' }}
      >
        {resendLabel}
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

function InviteStatus({ invite }: { invite: LastInvite }) {
  return (
    <div className={`aq-badge ${invite.ok ? 'aq-badge-success' : 'aq-badge-warning'}`} style={{
      display: 'block',
      marginBottom: 16,
      whiteSpace: 'normal',
      lineHeight: 1.45,
    }}>
      {invite.status}
      {invite.detail && (
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>
          Provider response: {invite.detail}
        </div>
      )}
      <br />
      <code style={{ wordBreak: 'break-all' }}>{invite.link}</code>
      <div style={{ marginTop: 10 }}>
        <a
          className="aq-btn aq-btn-secondary"
          href={`mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent('AQ Creativity workspace invite')}&body=${encodeURIComponent(`You have been invited to AQ Creativity.\n\nOpen this link within the invite window to create your account:\n${invite.link}`)}`}
          style={{ display: 'inline-flex', textDecoration: 'none' }}
        >
          Open email draft
        </a>
      </div>
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function describeEvent(ev: InviteEventRow): string {
  const role = ROLE_LABELS[ev.invite_role] ?? ev.invite_role;
  const target = ev.invite_email;
  switch (ev.action) {
    case 'created':       return `created an invite for ${target} (${role})`;
    case 'resent':        return `resent the invite to ${target}`;
    case 'accepted':      return `accepted the invite for ${target}`;
    case 'revoked':       return `revoked the invite for ${target}`;
    case 'expired':       return `cleared an expired invite for ${target}`;
    case 'role_changed':  return `changed the role on ${target}'s invite`;
    case 'resend_failed': return `tried to resend ${target}'s invite, but email failed`;
    default:              return `${ev.action} (${target})`;
  }
}

function formatRelative(iso: string, nowMs: number): string {
  const diff = nowMs - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
