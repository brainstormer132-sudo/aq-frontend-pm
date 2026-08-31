'use client';

import { useState, useEffect } from 'react';
import { createClient, applyRememberMe, rememberMeChosen } from '@/lib/supabase-browser';
import { absoluteUrl, withBase } from '@/lib/paths';
import { SplitAuthLayout } from '@/components/auth/SplitAuthLayout';

type InviteInfo = {
  valid: boolean;
  reason: string;
  email: string | null;
  role: string | null;
  workspace_name: string | null;
  expires_at: string | null;
};


export default function AuthPage() {
  const [supabase] = useState(() => createClient());

  // Sign-in form state
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [signInError, setSignInError] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);

  // Create-account form state
  const [signUpFullName, setSignUpFullName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpError, setSignUpError] = useState('');
  const [signUpMessage, setSignUpMessage] = useState('');
  const [signUpLoading, setSignUpLoading] = useState(false);

  // Invite + environment
  const [inviteRequired, setInviteRequired] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
  const [envOk, setEnvOk] = useState(true);
  const [envError, setEnvError] = useState('');

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || url.includes('placeholder')) {
      setEnvOk(false);
      setEnvError(
        'Supabase is not configured. Create a .env.local file in your project root with:\n\n' +
        'NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co\n' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key\n\n' +
        'Then restart the dev server (Ctrl+C, then npm run dev).'
      );
      return;
    }

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('invite') || localStorage.getItem('aq_pending_invite') || '';
      setInviteToken(token);

      const { data: hasWorkspace } = await supabase.rpc('has_any_workspace');
      setInviteRequired(Boolean(hasWorkspace));

      if (token) {
        const { data, error: inviteError } = await supabase
          .rpc('validate_workspace_invite', { invite_token: token });
        const info = (Array.isArray(data) ? data[0] : data) as InviteInfo | null;
        if (inviteError) {
          setSignUpError(inviteError.message);
        } else if (info) {
          setInviteInfo(info);
          if (info.valid && info.email) {
            setSignUpEmail(info.email);
            localStorage.setItem('aq_pending_invite', token);
          } else if (info.reason) {
            setSignUpError(info.reason);
          }
        }
      }
    })();
  }, [supabase]);

  // Restore Remember-me preference on mount.
  useEffect(() => {
    setRememberMe(rememberMeChosen());
  }, []);

  const claimInviteIfPresent = async () => {
    const token = inviteToken || localStorage.getItem('aq_pending_invite') || '';
    if (!token) return;
    const { error: claimError } = await supabase.rpc('claim_workspace_invite', { invite_token: token });
    if (claimError) throw claimError;
    localStorage.removeItem('aq_pending_invite');
  };

  // The choice now sets the auth cookie's lifetime — see lib/supabase-browser.
  // It used to only write a localStorage flag and hang a "sign out on tab
  // close" listener off it, while the cookie itself stayed a session cookie
  // either way. So the box did nothing: ticked or not, closing the browser
  // signed you out.

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envOk) return;
    setSignInError('');
    setSignInLoading(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password: signInPassword,
      });
      if (signInErr) throw signInErr;
      await applyRememberMe(rememberMe);
      await claimInviteIfPresent();
      window.location.href = withBase('/dashboard/workflow');
    } catch (err: any) {
      console.error('Sign-in error:', err);
      if (err.message === 'Failed to fetch' || err.message?.includes('fetch')) {
        setSignInError(
          'Cannot connect to Supabase. Check your internet connection and .env.local.'
        );
      } else if (err.message?.includes('Email not confirmed')) {
        setSignInError('Please check your email and click the confirmation link, then sign in.');
      } else if (err.message?.includes('Invalid login credentials')) {
        setSignInError('Wrong email or password.');
      } else {
        setSignInError(err.message || 'Sign-in failed. Check the browser console for details.');
      }
    } finally {
      setSignInLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!envOk) return;
    setSignUpError('');
    setSignUpMessage('');
    setSignUpLoading(true);
    try {
      if (inviteRequired) {
        if (!inviteInfo?.valid || !inviteToken) {
          throw new Error('Signup is invite-only. Ask an owner/admin for an invite link.');
        }
        if (inviteInfo.email && signUpEmail.trim().toLowerCase() !== inviteInfo.email.toLowerCase()) {
          throw new Error(`This invite is for ${inviteInfo.email}. Use that email address.`);
        }
        localStorage.setItem('aq_pending_invite', inviteToken);
      }

      const redirect = inviteToken
        ? absoluteUrl(`/dashboard/workflow?invite=${inviteToken}`)
        : absoluteUrl('/dashboard/workflow');
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          data: { full_name: signUpFullName },
          emailRedirectTo: redirect,
        },
      });
      if (signUpErr) throw signUpErr;

      if (data.user && !data.session) {
        setSignUpMessage('Check your email for a confirmation link. Once you confirm, you will be redirected back here.');
      } else if (data.session) {
        await applyRememberMe(rememberMe);
        await claimInviteIfPresent();
        window.location.href = withBase('/dashboard/workflow');
      }
    } catch (err: any) {
      console.error('Sign-up error:', err);
      if (err.message?.includes('User already registered')) {
        setSignUpError('This email is already registered. Use Sign In on the left.');
      } else {
        setSignUpError(err.message || 'Sign-up failed.');
      }
    } finally {
      setSignUpLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setSignInError('');
    try {
      const redirect = inviteToken
        ? absoluteUrl(`/dashboard/workflow?invite=${inviteToken}`)
        : absoluteUrl('/dashboard/workflow');
      if (inviteToken) localStorage.setItem('aq_pending_invite', inviteToken);
      await applyRememberMe(rememberMe);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirect },
      });
      if (oauthError) throw oauthError;
    } catch (err: any) {
      setSignInError(err.message || 'OAuth sign-in failed');
    }
  };

  const signupBlocked = inviteRequired && !inviteInfo?.valid;
  // Default to Sign In, but jump to Create Account when arriving via an invite.
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>(
    inviteInfo?.valid ? 'signup' : 'signin',
  );

  // Keep the tab in sync when invite info loads asynchronously.
  useEffect(() => {
    if (inviteInfo?.valid) setActiveTab('signup');
  }, [inviteInfo?.valid]);

  return (
    <SplitAuthLayout
      subtitle="Project Management"
      blurb="Tasks, vendors, clients, and contract requests for the AQ team. Sign in to your workspace, or create an account if your admin sent you an invite."
      tabs={
        <div style={{
          display: 'inline-flex', gap: 4, alignSelf: 'flex-start',
          background: '#f3f4f6', padding: 4, borderRadius: 999,
          marginBottom: 6,
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('signin')}
            style={tabBtn(activeTab === 'signin')}
          >Sign In</button>
          <button
            type="button"
            onClick={() => setActiveTab('signup')}
            style={tabBtn(activeTab === 'signup')}
          >Create Account</button>
        </div>
      }
    >
      {/* Backwards-compat: legacy heading + invite banners still rendered
          for users who navigated mid-flow. */}
      <header style={{ display: 'none' }}>
        <div style={logoWrapStyle}>{/* hidden but kept so old style consts
          remain referenced and TypeScript doesn't complain */}</div>
      </header>

        {!envOk && (
          <div style={errorBlock}>{envError}</div>
        )}

        {/* INVITE BANNERS */}
        {inviteInfo?.valid && (
          <div style={{ ...successBanner, marginBottom: 18 }}>
            Invite accepted for <strong>{inviteInfo.email}</strong>. Role: {inviteInfo.role}.
            Workspace: {inviteInfo.workspace_name}.
          </div>
        )}
        {inviteRequired && !inviteInfo?.valid && inviteToken && (
          <div style={{ ...warnBanner, marginBottom: 18 }}>
            This invite link is no longer valid. Ask the workspace admin to send a new one.
          </div>
        )}

      {/* INVITE BANNERS */}
      {inviteInfo?.valid && (
        <div style={{ ...successBanner, marginBottom: 14 }}>
          Invite accepted for <strong>{inviteInfo.email}</strong>. Role: {inviteInfo.role}.
          Workspace: {inviteInfo.workspace_name}.
        </div>
      )}
      {inviteRequired && !inviteInfo?.valid && inviteToken && (
        <div style={{ ...warnBanner, marginBottom: 14 }}>
          This invite link is no longer valid. Ask the workspace admin to send a new one.
        </div>
      )}

      {!envOk && (
        <div style={errorBlock}>{envError}</div>
      )}

      {activeTab === 'signin' ? (
        <form onSubmit={handleSignIn} style={formStyle}>
          <h2 style={cardTitle}>Sign in</h2>
          <p style={cardSubtitle}>Welcome back.</p>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              className="aq-input" type="email"
              value={signInEmail}
              onChange={(e) => setSignInEmail(e.target.value)}
              placeholder="you@example.com"
              required autoComplete="email"
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              className="aq-input" type="password"
              value={signInPassword}
              onChange={(e) => setSignInPassword(e.target.value)}
              placeholder="Your password"
              required autoComplete="current-password"
            />
          </div>
          <label style={rememberLabel}>
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Remember me on this device
          </label>
          {signInError && <div style={errorBlock}>{signInError}</div>}
          <button
            className="aq-btn aq-btn-primary"
            type="submit"
            disabled={signInLoading || !envOk}
            style={primaryBtn(signInLoading || !envOk)}
          >
            {signInLoading ? 'Signing in…' : 'Sign In'}
          </button>
          <p style={{ marginTop: 14, fontSize: 13, textAlign: 'center', color: '#6b7280' }}>
            Don&apos;t have an account?
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setActiveTab('signup'); }}
              style={{ marginLeft: 6 }}
            >Create one</a>
          </p>
        </form>
      ) : (
        <form onSubmit={handleSignUp} style={formStyle}>
          <h2 style={cardTitle}>Create your account</h2>
          <p style={cardSubtitle}>
            {inviteRequired
              ? 'Open the invite link your admin sent you, or paste its URL into the address bar first.'
              : 'Set up the first workspace.'}
          </p>
          <div>
            <label style={labelStyle}>Full name</label>
            <input
              className="aq-input" type="text"
              value={signUpFullName}
              onChange={(e) => setSignUpFullName(e.target.value)}
              placeholder="Your full name"
              required disabled={signupBlocked}
              autoComplete="name"
            />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              className="aq-input" type="email"
              value={signUpEmail}
              onChange={(e) => setSignUpEmail(e.target.value)}
              placeholder="you@example.com"
              required disabled={Boolean(inviteInfo?.valid)}
              autoComplete="email"
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              className="aq-input" type="password"
              value={signUpPassword}
              onChange={(e) => setSignUpPassword(e.target.value)}
              placeholder="At least 6 characters"
              required minLength={6} disabled={signupBlocked}
              autoComplete="new-password"
            />
          </div>
          {signUpError && <div style={errorBlock}>{signUpError}</div>}
          {signUpMessage && <div style={successBlock}>{signUpMessage}</div>}
          <button
            className="aq-btn aq-btn-primary"
            type="submit"
            disabled={signUpLoading || !envOk || signupBlocked}
            style={primaryBtn(signUpLoading || !envOk || signupBlocked)}
          >
            {signUpLoading ? 'Creating…' : 'Create Account'}
          </button>
          <p style={{ marginTop: 14, fontSize: 13, textAlign: 'center', color: '#6b7280' }}>
            Already have an account?
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); setActiveTab('signin'); }}
              style={{ marginLeft: 6 }}
            >Sign in</a>
          </p>
        </form>
      )}
    </SplitAuthLayout>
  );
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    padding: '7px 16px',
    background: active ? '#0b0b0e' : 'transparent',
    color: active ? '#fff' : '#6b7280',
    border: 'none',
    borderRadius: 999,
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

// ─── Styles ────────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--aq-bg)',
  padding: 24,
};

const shellStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 920,
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  marginBottom: 28,
};

const logoStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 14,
  background: 'var(--aq-accent)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 24,
  fontWeight: 700,
  color: '#fff',
  marginBottom: 14,
};

const logoWrapStyle: React.CSSProperties = {
  // No white circle, no padding — show the logo at its native shape.
  width: 76,
  height: 76,
  borderRadius: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  marginBottom: 14,
};

const cardsRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 16,
  alignItems: 'start',
};

const cardStyle: React.CSSProperties = {
  padding: 28,
};

const cardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  margin: '0 0 4px',
};

const cardSubtitle: React.CSSProperties = {
  color: 'var(--aq-text-muted)',
  fontSize: 13,
  margin: '0 0 18px',
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--aq-text-muted)',
  display: 'block',
  marginBottom: 6,
};

const rememberLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  fontSize: 13,
  color: 'var(--aq-text-secondary)',
  cursor: 'pointer',
  userSelect: 'none',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  width: '100%',
  padding: '11px 16px',
  fontSize: 14,
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
});

const dividerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '20px 0',
};

const dividerLine: React.CSSProperties = {
  flex: 1,
  height: 1,
  background: 'var(--aq-border-light)',
};

const dividerText: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--aq-text-muted)',
};

const errorBlock: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--aq-error)',
  padding: '12px 14px',
  background: '#fef2f2',
  borderRadius: 'var(--aq-radius)',
  whiteSpace: 'pre-wrap',
  lineHeight: 1.5,
};

const successBlock: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--aq-success, #15803d)',
  padding: '12px 14px',
  background: '#ecfdf5',
  borderRadius: 'var(--aq-radius)',
  lineHeight: 1.5,
};

const successBanner: React.CSSProperties = {
  padding: '12px 14px',
  background: '#ecfdf5',
  color: '#15803d',
  borderRadius: 'var(--aq-radius)',
  fontSize: 13,
  lineHeight: 1.5,
};

const warnBanner: React.CSSProperties = {
  padding: '12px 14px',
  background: '#fef3c7',
  color: '#92400e',
  borderRadius: 'var(--aq-radius)',
  fontSize: 13,
  lineHeight: 1.5,
};
