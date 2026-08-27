'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { AQLoadingScreen } from '@/components/AQLoading';
import { createClient } from '@/lib/supabase-browser';
import { portal, type PortalMe } from '@/lib/portal-api';
import { Icon, initials } from './PortalUI';

/**
 * Outer chrome for the vendor and client dashboards. Boots the session,
 * redirects to /<role>/auth if signed out or wrong role, gates first-login
 * password change, and renders the sidebar + topbar shell.
 *
 * Each page declares its views via the `buildViews` prop. PortalShell owns
 * the active-view state and renders the matching sub-view.
 *
 * History (2026-05-15): added must_change_password gate.
 * History (2026-05-20): replaced single-page chrome with sidebar layout +
 *   per-view dispatch. Visual-only redesign — backend surfaces for "Download
 *   all", "Export CSV", "Request a change" and the AQ contact card remain
 *   on the frontend until the next backend pass.
 */
export interface PortalView {
  id: string;
  label: string;
  icon: ReactNode;
  count?: number | string;
  render: () => ReactNode;
}

export function PortalShell({
  expectedRole,
  buildViews,
}: {
  expectedRole: 'vendor' | 'client';
  /**
   * Build the sidebar views. Receives `me` and a `navigate(viewId)` callback
   * so views can jump to other tabs (e.g. the Profile "Request a change"
   * button jumps to Help).
   */
  buildViews: (me: PortalMe, navigate: (viewId: string) => void) => PortalView[];
}) {
  const [supabase] = useState(() => createClient());
  const [me, setMe] = useState<PortalMe | null>(null);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState<string>('overview');

  const refetchMe = async () => {
    const data = await portal.me();
    setMe(data);
    return data;
  };

  useEffect(() => {
    (async () => {
      const { data: { user }, error: getUserError } = await supabase.auth.getUser();
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

  // ─── Loading / error states ───────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--aq-bg)', padding: 32 }}>
        <div className="aq-card" style={{ padding: 32, color: 'var(--aq-error)', maxWidth: 720, margin: '60px auto' }}>
          <strong>Could not load your portal:</strong>
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 10, fontFamily: 'inherit', fontSize: 13 }}>{error}</pre>
        </div>
      </div>
    );
  }
  if (!me) {
    // No skeleton here on purpose: the role decides the layout, and a
    // skeleton of the wrong shape promises a page that never arrives.
    return <AQLoadingScreen label="Loading your portal" />;
  }

  // ─── First-login password-change gate ────────────────────────────────────
  if (me.must_change_password) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--aq-bg)' }}>
        <MinimalTopbar me={me} onSignOut={signOut} />
        <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 20px' }}>
          <MustChangePasswordForm onSuccess={async () => { await refetchMe(); }} />
        </main>
      </div>
    );
  }

  // ─── Main dashboard ──────────────────────────────────────────────────────
  return (
    <Shell
      me={me}
      // Pass the active-view setter as the navigate callback so pages can wire
      // cross-view buttons (e.g. Profile → Help).
      buildViews={(meArg) => buildViews(meArg, setActiveId)}
      activeId={activeId}
      setActiveId={setActiveId}
      onSignOut={signOut}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Sidebar + topbar layout
   ───────────────────────────────────────────────────────────────────────── */

function Shell({
  me, buildViews, activeId, setActiveId, onSignOut,
}: {
  me: PortalMe;
  buildViews: (me: PortalMe) => PortalView[];
  activeId: string;
  setActiveId: (id: string) => void;
  onSignOut: () => void;
}) {
  // Recompute views whenever me changes. Memoize so handlers stay stable.
  const views = useMemo(() => buildViews(me), [me, buildViews]);
  const current = views.find((v) => v.id === activeId) ?? views[0];

  // If buildViews returns empty (e.g. role mismatch), bail. The PortalShell
  // would already have redirected, but this keeps the renderer honest.
  if (!current) return null;

  const headline =
    me.role === 'vendor' ? me.profile.name : me.profile.company_name;
  const subtitle =
    me.role === 'vendor' ? 'Vendor portal' : 'Client portal';

  return (
    <div className="portal-shell">
      <aside className="portal-aside">
        <div className="portal-brand">
          <div className="portal-brand-mark">AQ</div>
          <div style={{ minWidth: 0 }}>
            <div className="portal-brand-name">AQ Creativity</div>
            <div className="portal-brand-sub">{subtitle}</div>
          </div>
        </div>

        <nav className="portal-nav">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`portal-nav-item${v.id === current.id ? ' active' : ''}`}
              onClick={() => setActiveId(v.id)}
            >
              {v.icon}
              <span>{v.label}</span>
              {v.count != null && <span className="portal-nav-count">{v.count}</span>}
            </button>
          ))}
        </nav>

        <div className="portal-aside-footer">
          <div className="portal-avatar">{initials(headline)}</div>
          <div className="who">
            <strong>{headline}</strong>
            <span>{me.email}</span>
          </div>
          <button type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out">⎋</button>
        </div>
      </aside>

      <main className="portal-main">
        <div className="portal-topbar">
          <div>
            <div className="crumbs">{subtitle} · {current.label}</div>
            <h1>{current.label}</h1>
          </div>
          <div className="portal-toolbar">
            {/* Topbar slots could be view-driven later; keeping minimal for v1. */}
            <button type="button" className="aq-btn aq-btn-ghost aq-btn-sm" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>

        <div className="portal-content">{current.render()}</div>
      </main>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Minimal topbar (used during the forced password change before the full
   sidebar shell is reasonable to render).
   ───────────────────────────────────────────────────────────────────────── */

function MinimalTopbar({ me, onSignOut }: { me: PortalMe; onSignOut: () => void }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 28px',
      borderBottom: '1px solid var(--aq-border-light)',
      background: 'var(--aq-bg-elevated)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="portal-brand-mark" style={{ width: 36, height: 36, fontSize: 14 }}>AQ</div>
        <div>
          <strong style={{ fontSize: 15 }}>Welcome to AQ Creativity</strong>
          <div style={{ fontSize: 11, color: 'var(--aq-text-muted)', marginTop: 2 }}>
            {me.role === 'vendor' ? 'Vendor portal' : 'Client portal'} · {me.email}
          </div>
        </div>
      </div>
      <button type="button" className="aq-btn aq-btn-ghost" onClick={onSignOut}>Sign out</button>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Forced password change form. Unchanged from previous version — kept here
   so PortalShell stays the single auth boundary.
   ───────────────────────────────────────────────────────────────────────── */

function MustChangePasswordForm({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw1.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (pw1 !== pw2) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await portal.changePassword(pw1);
      setDone(true);
      setPw1(''); setPw2('');
      await onSuccess();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aq-card" style={{ padding: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Set your password</h2>
      <p style={{ fontSize: 13, color: 'var(--aq-text-muted)', marginBottom: 18 }}>
        Your AQ administrator created this account with a temporary password.
        Pick a new one to continue.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          New password
          <input type="password" className="aq-input" value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            autoComplete="new-password" minLength={8} required autoFocus />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          Confirm new password
          <input type="password" className="aq-input" value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password" minLength={8} required />
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

        <button type="submit" className="aq-btn aq-btn-primary"
          disabled={busy || done} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </div>
  );
}

// Re-export the Icon set so pages can grab icons via the same import path
// they already use for PortalShell.
export { Icon };
