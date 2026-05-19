'use client';

import { useState } from 'react';
import {
  usePmInvites,
  createPmInvite,
  revokePmInvite,
  type PmInvite,
  type PmInviteRole,
  type WorkspaceRole,
} from '@/hooks/use-workflow';

/**
 * Owner/admin panel for inviting internal staff into the PM workspace.
 *
 * Flow:
 *   1. Admin types name + email + role, clicks Send.
 *   2. createPmInvite() inserts a token-bearing row and POSTs the email
 *      through /api/invites/send. The Vercel function calls Resend.
 *   3. UI shows the resulting link so the admin can also copy it
 *      manually (useful when email isn't configured yet, or when the
 *      vendor / sales lead prefers WhatsApp).
 *   4. Invitee opens /auth?invite=TOKEN → signs up with Supabase →
 *      claim function inserts them into workspace_members.
 */
export function InvitesPanel({
  workspaceId,
  workspaceName,
  role,
  currentUserId,
}: {
  workspaceId: string;
  workspaceName?: string | null;
  role: WorkspaceRole | null;
  currentUserId: string;
}) {
  const { invites, refetch, loading } = usePmInvites(workspaceId);

  const [email, setEmail]       = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<PmInviteRole>('member');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState<{ link: string; emailed: boolean; warning?: string } | null>(null);

  const canManage = role === 'owner' || role === 'admin';

  if (!canManage) {
    return (
      <section className="aq-card" style={{ padding: 22 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700 }}>Invites</h2>
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--aq-text-muted)' }}>
          Only owners and admins can invite people to the workspace.
        </p>
      </section>
    );
  }

  const handleSend = async () => {
    setError('');
    setSuccess(null);
    if (!email.trim()) {
      setError('Email is required.');
      return;
    }
    setBusy(true);
    try {
      const result = await createPmInvite({
        workspace_id: workspaceId,
        email: email.trim(),
        full_name: fullName.trim(),
        role: inviteRole,
        created_by: currentUserId,
        workspace_name: workspaceName ?? 'AQ Creativity',
      });
      setSuccess({
        link: result.link,
        emailed: result.emailed,
        warning: result.emailError,
      });
      setEmail('');
      setFullName('');
      setInviteRole('member');
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Revoke this invite? The link will stop working immediately.')) return;
    try {
      await revokePmInvite(id);
      await refetch();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers — fall back to a prompt the user can copy from.
      window.prompt('Copy this link:', text);
    }
  };

  return (
    <section className="aq-card" style={{ padding: 22 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Invites</h2>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--aq-text-muted)' }}>
            Invite teammates to the PM app. Each invite is a unique link tied to an email.
          </p>
        </div>
      </header>

      {/* Form */}
      <div style={{
        marginTop: 18,
        padding: 16,
        background: 'var(--aq-bg-sunken)',
        borderRadius: 'var(--aq-radius)',
        display: 'grid',
        gridTemplateColumns: '2fr 2fr 1fr auto',
        gap: 10,
        alignItems: 'end',
      }}>
        <div>
          <div className="aq-label">Name</div>
          <input
            className="aq-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Jane Smith"
          />
        </div>
        <div>
          <div className="aq-label">Email *</div>
          <input
            className="aq-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@aqcreativity.com"
            required
          />
        </div>
        <div>
          <div className="aq-label">Role</div>
          <select
            className="aq-select"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as PmInviteRole)}
          >
            <option value="member">Member</option>
            <option value="sales">Sales</option>
            <option value="marketing">Marketing</option>
            <option value="key_account">Key account</option>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button
          type="button"
          className="aq-btn aq-btn-primary"
          onClick={handleSend}
          disabled={busy || !email.trim()}
        >{busy ? 'Sending…' : 'Send invite'}</button>
      </div>

      {error && (
        <div style={{
          marginTop: 12,
          background: 'var(--aq-error)',
          color: '#fff',
          padding: '10px 14px',
          borderRadius: 'var(--aq-radius)',
          fontSize: 13,
        }}>{error}</div>
      )}

      {success && (
        <div style={{
          marginTop: 12,
          background: 'var(--aq-accent-light)',
          color: 'var(--aq-accent)',
          padding: '12px 14px',
          borderRadius: 'var(--aq-radius)',
          fontSize: 13,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <strong>
            {success.emailed
              ? '✓ Invite created and email sent.'
              : 'Invite created. Email could not be sent — copy the link manually:'}
          </strong>
          {success.warning && (
            <span style={{ color: 'var(--aq-error)', fontSize: 12 }}>{success.warning}</span>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="aq-input"
              readOnly
              value={success.link}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, fontSize: 12 }}
            />
            <button
              type="button"
              className="aq-btn aq-btn-secondary"
              onClick={() => copy(success.link)}
              style={{ fontSize: 12 }}
            >Copy</button>
          </div>
        </div>
      )}

      {/* Pending list */}
      <div style={{ marginTop: 22 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          Pending & recent invites ({invites.length})
        </h3>
        {loading && <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>Loading…</p>}
        {!loading && invites.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--aq-text-muted)' }}>No invites yet.</p>
        )}
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {invites.map((inv) => (
            <InviteRow
              key={inv.id}
              invite={inv}
              onRevoke={() => handleRevoke(inv.id)}
              onCopy={() => copy(buildLink(inv.token))}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function buildLink(token: string): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}/auth?invite=${encodeURIComponent(token)}`;
}

function InviteRow({
  invite, onRevoke, onCopy,
}: {
  invite: PmInvite;
  onRevoke: () => void;
  onCopy: () => void;
}) {
  const now = Date.now();
  const expired = new Date(invite.expires_at).getTime() < now;
  const claimed = Boolean(invite.claimed_at);
  const stateBadge = claimed
    ? { label: 'claimed', cls: 'aq-badge-success' }
    : expired
      ? { label: 'expired', cls: 'aq-badge-muted' }
      : { label: 'pending', cls: 'aq-badge-info' };

  return (
    <li style={{
      display: 'grid',
      gridTemplateColumns: '1.5fr 1fr 0.7fr auto auto',
      gap: 10,
      alignItems: 'center',
      padding: '8px 12px',
      borderRadius: 'var(--aq-radius)',
      background: 'var(--aq-bg-sunken)',
    }}>
      <div>
        <strong style={{ fontSize: 13 }}>{invite.full_name || invite.email}</strong>
        {invite.full_name && (
          <div style={{ fontSize: 11, color: 'var(--aq-text-muted)' }}>{invite.email}</div>
        )}
      </div>
      <span style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
        {invite.role}
        {invite.email_sent_at
          ? ' · emailed'
          : invite.email_error
            ? ' · email failed'
            : ''}
      </span>
      <span className={`aq-badge ${stateBadge.cls}`} style={{ fontSize: 11 }}>{stateBadge.label}</span>
      {!claimed && (
        <button
          type="button"
          className="aq-btn aq-btn-ghost"
          onClick={onCopy}
          style={{ padding: '4px 10px', fontSize: 12 }}
        >Copy link</button>
      )}
      <button
        type="button"
        className="aq-btn aq-btn-ghost"
        onClick={onRevoke}
        style={{ padding: '4px 10px', fontSize: 12 }}
        aria-label="Revoke invite"
      >✕</button>
    </li>
  );
}
