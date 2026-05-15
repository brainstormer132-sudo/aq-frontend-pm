'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { portal, type PortalMe } from '@/lib/portal-api';

/**
 * Outer chrome for the vendor and client dashboards. Boots the session,
 * redirects to /<role>/auth if signed out or wrong role, then renders the
 * children with a small top bar.
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
