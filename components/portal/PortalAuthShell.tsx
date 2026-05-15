'use client';

import { ReactNode } from 'react';

/**
 * Centered card layout used by every portal auth page (vendor + client login,
 * setup, password reset). Matches the PM dashboard auth design.
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
          <div style={logoStyle}>AQ</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 4px' }}>AQ Creativity</h1>
          <p style={{ color: 'var(--aq-text-muted)', fontSize: 14, margin: 0 }}>{title}</p>
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
const logoStyle: React.CSSProperties = {
  width: 56, height: 56, borderRadius: 14,
  background: 'var(--aq-accent)', color: '#fff',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 24, fontWeight: 700, marginBottom: 14,
};
const cardStyle: React.CSSProperties = { padding: 28 };
