'use client';

import { ReactNode } from 'react';

/**
 * Shared split-screen auth layout — dark branded panel on the left,
 * white form panel on the right. Used by:
 *   - /auth                (PM Supabase login)
 *   - /vendor/auth, /client/auth   (portal logins, via PortalAuthShell)
 *
 * The contract maker at /contracts/ uses the same visual pattern but
 * is implemented inline in plain HTML/CSS since it's a static SPA.
 *
 * Props:
 *   - subtitle:   small label below the brand block (e.g. "Vendor portal")
 *   - blurb:      paragraph in the brand block describing the surface
 *   - children:   the form panel content
 *   - tabs:       optional pill toggle at the top of the form panel
 */
export function SplitAuthLayout({
  subtitle, blurb, children, tabs,
}: {
  subtitle: string;
  blurb?: string;
  children: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div style={pageStyle}>
      {/* Scoped style overrides so this card renders consistently regardless
          of the surrounding global theme (PM app uses a tan --aq-bg by
          default, which we override to near-black for the auth screen). */}
      <style>{`
        body.split-auth-active { background: #0b0b0e !important; }
        .split-auth-card .aq-btn-primary,
        .split-auth-card button[type="submit"]:not(.split-auth-tab) {
          background: #0b0b0e !important;
          border-color: #0b0b0e !important;
          color: #fff !important;
          border-radius: 999px !important;
          padding: 12px 18px !important;
          font-weight: 700 !important;
        }
        .split-auth-card .aq-btn-primary:hover,
        .split-auth-card button[type="submit"]:not(.split-auth-tab):hover {
          background: #000 !important; border-color: #000 !important;
        }
        .split-auth-card input:focus {
          outline: none !important;
          border-color: #0b0b0e !important;
          box-shadow: 0 0 0 3px rgba(11, 11, 14, 0.12) !important;
        }
        .split-auth-card a { color: #0b0b0e; font-weight: 700; }
      `}</style>

      <div style={splitStyle} className="split-auth-card">
        {/* LEFT — brand panel */}
        <aside style={brandStyle}>
          <p style={welcomeStyle}>Welcome to</p>
          <div style={logoWrapStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" style={logoImgStyle} />
          </div>
          <h1 style={brandNameStyle}>AQ Creativity</h1>
          {blurb && <p style={blurbStyle}>{blurb}</p>}
          <p style={footerStyle}>Internal · Confidential</p>
        </aside>

        {/* RIGHT — form panel */}
        <div style={formPanelStyle}>
          {tabs}
          <p style={subtitleStyle}>{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0b0b0e',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const splitStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  width: 'min(1080px, 96vw)',
  minHeight: 'min(620px, 90vh)',
  background: '#fff',
  borderRadius: 24,
  overflow: 'hidden',
  boxShadow: '0 30px 80px rgba(0, 0, 0, 0.5)',
};
const brandStyle: React.CSSProperties = {
  position: 'relative',
  background:
    'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.06), transparent 55%),'
    + 'linear-gradient(155deg, #1a1a1f 0%, #0b0b0e 55%, #000 100%)',
  color: '#fff',
  padding: '56px 44px 64px',
  display: 'flex', flexDirection: 'column',
  justifyContent: 'center', alignItems: 'center',
  textAlign: 'center',
};
const welcomeStyle: React.CSSProperties = {
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  fontSize: 12,
  fontWeight: 600,
  color: 'rgba(255, 255, 255, 0.65)',
  margin: '0 0 22px',
};
const logoWrapStyle: React.CSSProperties = {
  // Logo as-is, no white circle. Slightly larger so it reads at a glance.
  width: 110, height: 110,
  margin: '0 auto 22px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 16,
  overflow: 'hidden',
};
const logoImgStyle: React.CSSProperties = {
  width: '100%', height: '100%', objectFit: 'contain', display: 'block',
};
const brandNameStyle: React.CSSProperties = {
  fontSize: 28, fontWeight: 800,
  margin: '0 0 14px', letterSpacing: '-0.01em',
};
const blurbStyle: React.CSSProperties = {
  fontSize: 13, lineHeight: 1.65,
  color: 'rgba(255, 255, 255, 0.72)',
  maxWidth: 320, margin: '0 auto',
};
const footerStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 28, left: 0, right: 0,
  fontSize: 11,
  color: 'rgba(255, 255, 255, 0.45)',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
};
const formPanelStyle: React.CSSProperties = {
  background: '#fff',
  padding: '48px 52px',
  display: 'flex', flexDirection: 'column',
  justifyContent: 'center',
};
const subtitleStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 13,
  marginTop: 6,
  marginBottom: 22,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 700,
};
