'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { validateInviteToken, acceptInvite, type InviteValidationResult } from '@/lib/portal-api';
import { PortalAuthShell } from '@/components/portal/PortalAuthShell';

/**
 * Token-claim flow used by /vendor/setup and /client/setup.
 * 1. Reads ?token= from the URL.
 * 2. Validates the token against the FastAPI backend (no auth needed).
 * 3. If valid, asks the user for a password.
 * 4. Calls supabase.auth.signUp({ email, password }) — Supabase creates the
 *    auth.users row.
 * 5. Calls /api/external-invites/claim to mark the invite consumed and
 *    create the public.external_users row.
 * 6. Redirects to /vendor or /client.
 */
export function PortalSetupForm({ expectedRole }: { expectedRole: 'vendor' | 'client' }) {
  const [supabase] = useState(() => createClient());
  const [status, setStatus] = useState<'loading' | 'invalid' | 'ready' | 'submitting' | 'done' | 'error'>('loading');
  const [info, setInfo] = useState<InviteValidationResult | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get('token') || '';
    setToken(t);
    if (!t) {
      setStatus('invalid');
      setError('No invite token in the URL. Ask your AQ contact for a fresh link.');
      return;
    }
    (async () => {
      try {
        const v = await validateInviteToken(t);
        setInfo(v);
        if (!v.valid) {
          setStatus('invalid');
          setError(v.reason || 'Invite is no longer valid.');
        } else if (v.role !== expectedRole) {
          setStatus('invalid');
          setError(`This is a ${v.role} invite — open the ${v.role} setup page instead.`);
        } else {
          setStatus('ready');
        }
      } catch (e: any) {
        setStatus('error');
        setError(e?.message ?? 'Unable to reach the server.');
      }
    })();
  }, [expectedRole]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!info?.valid || !info.email) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setStatus('submitting');
    setError('');
    try {
      // One call. The account is created or its password is reset, and the
      // invite is consumed only once that has actually worked — so a
      // failure here leaves the link usable instead of burning it and
      // reporting "invalid token" on every retry.
      await acceptInvite(token, password);

      // Now an ordinary sign-in, against a password that definitely exists.
      const { error: signInError } =
        await supabase.auth.signInWithPassword({ email: info.email, password });
      if (signInError) throw signInError;

      setStatus('done');
      const target = expectedRole === 'vendor' ? '/vendor' : '/client';
      window.location.href = `${target}?welcome=1`;
    } catch (err: any) {
      setStatus('ready');
      setError(err?.message ?? 'Something went wrong.');
    }
  };

  if (status === 'loading') {
    return <PortalAuthShell title="Setup"><p>Checking your invite…</p></PortalAuthShell>;
  }

  if (status === 'invalid' || status === 'error') {
    return (
      <PortalAuthShell title={expectedRole === 'vendor' ? 'Vendor portal setup' : 'Client portal setup'}>
        <div style={errorBlock}>{error}</div>
        <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginTop: 14 }}>
          If you think this is a mistake, contact your AQ representative — they can re-issue your invite.
        </p>
      </PortalAuthShell>
    );
  }

  return (
    <PortalAuthShell
      title={expectedRole === 'vendor' ? 'Vendor portal setup' : 'Client portal setup'}
      subtitle={
        info?.email
          ? `Welcome ${info.email}. Pick a password to finish setting up your account.`
          : 'Pick a password to finish setting up your account.'
      }
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          <span>Email</span>
          <input className="aq-input" type="email" value={info?.email || ''} disabled readOnly />
        </label>
        <label style={labelStyle}>
          <span>New password</span>
          <input
            className="aq-input" type="password" required minLength={8}
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </label>
        <label style={labelStyle}>
          <span>Confirm password</span>
          <input
            className="aq-input" type="password" required minLength={8}
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </label>
        {error && <div style={errorBlock}>{error}</div>}
        <button
          type="submit"
          className="aq-btn aq-btn-primary"
          disabled={status === 'submitting'}
          style={{ padding: '11px 16px', fontSize: 14 }}
        >
          {status === 'submitting' ? 'Setting up…' : 'Activate account'}
        </button>
      </form>
    </PortalAuthShell>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13,
};
const errorBlock: React.CSSProperties = {
  fontSize: 13, color: 'var(--aq-error)',
  padding: '12px 14px', background: '#fef2f2',
  borderRadius: 'var(--aq-radius)', whiteSpace: 'pre-wrap', lineHeight: 1.5,
};
