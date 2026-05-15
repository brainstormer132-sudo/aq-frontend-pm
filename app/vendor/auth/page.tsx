'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { PortalAuthShell } from '@/components/portal/PortalAuthShell';

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: e1 } = await supabase.auth.signInWithPassword({ email, password });
      if (e1) throw e1;
      // Confirm caller is actually an external user of the right role,
      // otherwise sign them right out — this page is portal-only.
      const targetPath = role === 'vendor' ? '/vendor' : '/client';
      window.location.href = targetPath;
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
        <p style={{ fontSize: 12, color: 'var(--aq-text-muted)', textAlign: 'center', marginTop: 6 }}>
          Forgot your password? Ask your AQ contact to send you a new invite link.
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
