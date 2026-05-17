'use client';

import { ReactNode } from 'react';

/**
 * Centered card layout used by every portal auth page (vendor + client login,
 * setup, password reset).
 *
 * 2026-05-17: replaced the green "AQ" text box with the actual logo image
 * served from /public/logo.png. Removed the "AQ Creativity" wordmark so the
 * page leans on the logo only (matches the rest of the brand surfaces).
 */
export function PortalAuthShell({
  title, subtitle, children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <header style={headerStyle}>
          <div style={logoWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" style={logoImg} />
          </div>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, margin: 0, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {title}
          </p>
        </header>
        <section className="aq-card" style={cardStyle}>
          {subtitle && (
            <p style={{ color: 'var(--aq-text-muted)', fontSize: 13, marginBottom: 18 }}>{subtitle}</p>
          )}
          {children}
        </section>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--aq-bg)',
  padding: 24,
};
const shellStyle: React.CSSProperties = { width: '100%', maxWidth: 460 };
const headerStyle: React.CSSProperties = { textAlign: 'center', marginBottom: 28 };
const logoWrap: React.CSSProperties = {
  width: 96, height: 96, borderRadius: '50%',
  background: '#fff', padding: 14,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  marginBottom: 18,
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.08)',
};
const logoImg: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
const cardStyle: React.CSSProperties = { padding: 28 };
