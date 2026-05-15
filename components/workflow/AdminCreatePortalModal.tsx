'use client';

import { useState } from 'react';
import { externalInvites } from '@/lib/contract-api';

/**
 * Admin path: type a password, click Create. Backend uses Supabase service
 * role to provision the auth user. After success the modal shows the
 * credentials so the admin can pass them to the user manually.
 */
export function AdminCreatePortalModal({
  open, target, onClose,
}: {
  open: boolean;
  target: {
    role: 'vendor' | 'client';
    label: string;          // displayed in the modal header
    vendor_id?: number;
    client_id?: string;
    email?: string | null;  // optional pre-fill
  } | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [emailOverride, setEmailOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ email: string; portal: string } | null>(null);

  if (!open || !target) return null;

  const close = () => {
    setPassword('');
    setConfirm('');
    setEmailOverride('');
    setError('');
    setCreated(null);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await externalInvites.adminCreate({
        role: target.role,
        password,
        vendor_id: target.vendor_id,
        client_id: target.client_id,
        email: emailOverride.trim() || target.email || undefined,
      });
      const portal = `${window.location.origin}${result.portal_path}`;
      setCreated({ email: result.email, portal });
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={close} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} className="aq-card" style={panel}>
        <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
          Create portal account — {target.label}
        </h3>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, margin: '6px 0 16px' }}>
          The {target.role} can sign in immediately with these credentials. No email is sent.
        </p>

        {created ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="aq-badge aq-badge-success" style={{ display: 'block', whiteSpace: 'normal' }}>
              Account created. Tell the {target.role}:
            </div>
            <DetailLine label="Portal" value={created.portal} />
            <DetailLine label="Email" value={created.email} />
            <DetailLine label="Password" value={password} />
            <p style={{ fontSize: 12, color: 'var(--aq-text-muted)' }}>
              Suggest they sign in and change the password from their settings later.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="aq-btn aq-btn-primary" onClick={close}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={labelStyle}>
              <span>Email (optional)</span>
              <input
                className="aq-input" type="email"
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
                placeholder={target.email || 'leave blank to use a placeholder'}
              />
            </label>
            <label style={labelStyle}>
              <span>Password (min 8 chars)</span>
              <input
                className="aq-input" type="text"
                required minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password"
                autoFocus
              />
            </label>
            <label style={labelStyle}>
              <span>Confirm password</span>
              <input
                className="aq-input" type="text"
                required minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>

            {error && (
              <div style={errorBlock}>{error}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
              <button type="button" className="aq-btn aq-btn-ghost" onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="aq-btn aq-btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--aq-text-muted)' }}>
        {label}
      </span>
      <code style={{ fontSize: 13, padding: '8px 10px', background: 'var(--aq-bg)', borderRadius: 'var(--aq-radius)', wordBreak: 'break-all' }}>
        {value}
      </code>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1300,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const panel: React.CSSProperties = {
  maxWidth: 460, width: '100%', padding: 24,
  background: 'var(--aq-bg-elevated)',
  boxShadow: '0 16px 48px rgba(15, 23, 42, 0.25)',
};
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13,
};
const errorBlock: React.CSSProperties = {
  fontSize: 13, color: 'var(--aq-error)',
  padding: '12px 14px', background: '#fef2f2',
  borderRadius: 'var(--aq-radius)',
  whiteSpace: 'pre-wrap', lineHeight: 1.5,
};
