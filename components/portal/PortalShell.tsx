'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { portal, type PortalMe } from '@/lib/portal-api';

/**
 * Outer chrome for the vendor and client dashboards. Boots the session,
 * redirects to /<role>/auth if signed out or wrong role, then renders the
 * children with a small top bar.
 *
 * First-login password change (2026-05-15): when admin creates the portal
 * account with a temp password, the backend marks `must_change_password=true`
 * on the external_users row. If that flag is set, we block the dashboard
 * and require the user to set their own password before continuing.
 */
export function PortalShell({
  expectedRole,
  children,
}: {
  expectedRole: 'vendor' | 'client';
  children: (me: PortalMe) => ReactNode;
}) {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<PortalMe | null>(null);
  const [error, setError] = useState('');

  const refetchMe = async () => {
    const data = await portal.me();
    setMe(data);
    return data;
  };

  useEffect(() => {
    (async () => {
      const { data: { user }, error: getUserError } = await supabase.auth.getUser();

      // Not signed in at all → send to the portal login. Use replace so
      // the back button doesn't recycle the loop.
      if (!user || getUserError) {
        window.location.replace(expectedRole === 'vendor' ? '/vendor/auth' : '/client/auth');
        return;
      }

      try {
        const data = await portal.me();
        if (data.role !== expectedRole) {
          window.location.replace(data.role === 'vendor' ? '/vendor' : '/client');
          return;
        }
        setMe(data);
      } catch (e: any) {
        // DON'T redirect on a /me failure — surfacing the error in the
        // page prevents a redirect loop when the backend is unreachable
        // or the external_users row hasn't been linked yet.
        setError(
          (e?.message ?? 'Could not load your account.') +
          '\n\nIf this says "not a portal user", your AQ admin needs to ' +
          'click Make portal again on your row and give you the new password.',
        );
      }
    })();
  }, [expectedRole, supabase]);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = expectedRole === 'vendor' ? '/vendor/auth' : '/client/auth';
  };

  if (error) {
    return (
      <div style={pageWrap}>
        <div className="aq-card" style={{ padding: 32, color: 'var(--aq-error)' }}>
          <strong>Could not load your portal:</strong> {error}
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div style={pageWrap}>
        <div className="aq-card" style={{ padding: 32 }}>
          <p style={{ color: 'var(--aq-text-muted)' }}>Loading your portal…</p>
        </div>
      </div>
    );
  }

  // ── First-login password-change gate ──────────────────────
  if (me.must_change_password) {
    return (
      <div style={pageWrap}>
        <header style={topbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={logoMini}>AQ</div>
            <div>
              <strong style={{ fontSize: 15 }}>Welcome to AQ Creativity</strong>
              <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 2 }}>
                {me.role === 'vendor' ? 'Vendor portal' : 'Client portal'} · {me.email}
              </div>
            </div>
          </div>
          <button type="button" className="aq-btn aq-btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </header>
        <main style={contentWrap}>
          <MustChangePasswordForm
            onSuccess={async () => {
              await refetchMe();
            }}
          />
        </main>
      </div>
    );
  }

  const headline = me.role === 'vendor'
    ? me.profile.name
    : (me.profile as any).company_name;

  return (
    <div style={pageWrap}>
      <header style={topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={logoMini}>AQ</div>
          <div>
            <strong style={{ fontSize: 15 }}>{headline}</strong>
            <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 2 }}>
              {me.role === 'vendor' ? 'Vendor portal' : 'Client portal'} · {me.email}
            </div>
          </div>
        </div>
        <button type="button" className="aq-btn aq-btn-ghost" onClick={signOut}>
          Sign out
        </button>
      </header>
      <main style={contentWrap}>{children(me)}</main>
    </div>
  );
}

/**
 * Forced password change form. Shown the FIRST time a portal user signs in
 * after the admin gave them a temp password. Calls backend
 * /api/external-portal/change-password which:
 *   1. Uses Supabase Admin API to set the new password
 *   2. Clears must_change_password = false on the external_users row
 */
function MustChangePasswordForm({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw1.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pw1 !== pw2) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await portal.changePassword(pw1);
      setDone(true);
      setPw1('');
      setPw2('');
      // Refetch /me so the must_change_password flag flips to false and
      // PortalShell renders the real dashboard.
      await onSuccess();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aq-card" style={{ maxWidth: 480, padding: 28, margin: '20px auto' }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
        Set your password
      </h2>
      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginBottom: 18 }}>
        Your AQ administrator created this account with a temporary password.
        Pick a new one to continue.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          New password
          <input
            type="password"
            className="aq-input"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          Confirm new password
          <input
            type="password"
            className="aq-input"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        {error && (
          <div style={{
            background: 'var(--aq-error)', color: '#fff',
            padding: '10px 12px', borderRadius: 'var(--aq-radius)', fontSize: 13,
          }}>{error}</div>
        )}

        {done && (
          <div style={{
            background: 'var(--aq-accent-light)', color: 'var(--aq-accent)',
            padding: '10px 12px', borderRadius: 'var(--aq-radius)', fontSize: 13,
          }}>Password updated. Loading your portal…</div>
        )}

        <button
          type="submit"
          className="aq-btn aq-btn-primary"
          disabled={busy || done}
          style={{ alignSelf: 'flex-start' }}
        >{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--aq-bg)',
};
const topbar: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 28px',
  borderBottom: '1px solid var(--aq-border-light)',
  background: 'var(--aq-bg-elevated, #fff)',
};
const logoMini: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: 'var(--aq-accent)', color: '#fff',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 15, fontWeight: 800,
};
const contentWrap: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '28px 28px 60px',
};
