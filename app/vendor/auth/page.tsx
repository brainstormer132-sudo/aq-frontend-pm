'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient, applyRememberMe, rememberMeChosen } from '@/lib/supabase-browser';
import { PortalAuthShell } from '@/components/portal/PortalAuthShell';
import { portal } from '@/lib/portal-api';

export default function VendorAuthPage() {
  return <PortalLogin role="vendor" />;
}

export function PortalLogin({ role }: { role: 'vendor' | 'client' }) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(true);

  useEffect(() => { setRemember(rememberMeChosen()); }, []);

  const other = role === 'vendor' ? 'client' : 'vendor';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({ email, password });
      if (e1) throw e1;

      /**
       * The door has to check who it lets in.
       *
       * The comment here used to say "confirm caller is actually an
       * external user of the right role, otherwise sign them right out"
       * — and then redirected without confirming anything. So a client
       * could sign in at the vendor door, and a member of staff could
       * sign in at either. The session was created either way; the
       * portal shell bounced them somewhere afterwards, which is not the
       * same as refusing them.
       *
       * Siraj: *"seperate client and vendor portals you cant log in to a
       * vendor portal from the clients and vice verca"*. So: ask who
       * this is, and sign them straight back out if the answer is wrong.
       */
      let me;
      try {
        me = await portal.me();
      } catch {
        await supabase.auth.signOut();
        setError(
          'That account is not a portal account. If you work at AQ, sign in '
          + 'at the main dashboard instead.',
        );
        return;
      }

      if (me.role !== role) {
        await supabase.auth.signOut();
        setError(
          `That is a ${me.role} account, and this is the ${role} portal. `
          + `Sign in at the ${me.role} portal instead.`,
        );
        return;
      }

      await applyRememberMe(remember);
      window.location.href = role === 'vendor' ? '/vendor' : '/client';
    } catch (err: any) {
      const msg = err.message || 'Sign-in failed.';
      if (/Invalid login credentials/i.test(msg)) {
        setError('Wrong email or password.');
      } else if (/Email not confirmed/i.test(msg)) {
        setError('Open your invite link first to set up the account.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalAuthShell
      title={role === 'vendor' ? 'Vendor portal' : 'Client portal'}
      subtitle="Sign in with the email and password you set when you accepted your invite."
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          <span>Email</span>
          <input
            className="aq-input" type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        <label style={labelStyle}>
          <span>Password</span>
          <input
            className="aq-input" type="password" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </label>
        {error && (
          <div style={errorBlock}>{error}</div>
        )}
        <button
          type="submit"
          className="aq-btn aq-btn-primary"
          disabled={loading}
          style={{ padding: '11px 16px', fontSize: 14 }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          color: 'var(--aq-text-secondary)',
        }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Keep me signed in on this device</span>
        </label>
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', textAlign: 'center', marginTop: 6 }}>
          Forgot your password? Ask your AQ contact to send you a new setup link.
          <br />
          {/* Named, because somebody at the wrong door needs the right one,
              not just to be told they are at the wrong one. */}
          Are you a {other}?{' '}
          <a href={other === 'vendor' ? '/vendor/auth' : '/client/auth'}
             style={{ color: 'var(--aq-text)', textDecoration: 'underline' }}>
            Use the {other} portal
          </a>
        </p>
      </form>
    </PortalAuthShell>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13,
};
const errorBlock: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--aq-error)',
  padding: '12px 14px',
  background: '#fef2f2',
  borderRadius: 'var(--aq-radius)',
  whiteSpace: 'pre-wrap', lineHeight: 1.5,
};
