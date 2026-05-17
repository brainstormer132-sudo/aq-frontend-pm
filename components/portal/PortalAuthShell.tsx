'use client';

import { ReactNode } from 'react';

/**
 * Centered card layout used by every portal auth page (vendor + client login,
 * setup, password reset).
 *
 * 2026-05-17: black/white monochrome (AQ brand). Logo is rendered at its
 * native shape — no white circle wrapper. Submit buttons are forced black.
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
      {/* Inline style override forces all `aq-btn-primary` buttons inside
          this shell to render in solid black, regardless of the global
          green `--aq-accent` token. Scoped to .portal-auth-mono so no
          other PM screens are affected. */}
      <style>{`
        .portal-auth-mono .aq-btn-primary,
        .portal-auth-mono button[type="submit"] {
          background: #0b0b0e !important;
          border-color: #0b0b0e !important;
          color: #fff !important;
        }
        .portal-auth-mono .aq-btn-primary:hover,
        .portal-auth-mono button[type="submit"]:hover {
          background: #000 !important;
          border-color: #000 !important;
        }
        .portal-auth-mono input:focus {
          border-color: #0b0b0e !important;
          box-shadow: 0 0 0 3px rgba(11, 11, 14, 0.12) !important;
        }
        .portal-auth-mono a { color: #0b0b0e; }
      `}</style>

      <div style={shellStyle} className="portal-auth-mono">
        <header style={headerStyle}>
          <div style={logoWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" style={logoImg} />
          </div>
          <p style={{
            color: '#6b7280', fontSize: 12, margin: 0,
            letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700,
          }}>
            {title}
          </p>
        </header>
        <section style={cardStyle}>
          {subtitle && (
            <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 18 }}>{subtitle}</p>
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
  background: '#f5f5f5',
  padding: 24,
};
const shellStyle: React.CSSProperties = { width: '100%', maxWidth: 420 };
const headerStyle: React.CSSProperties = { textAlign: 'center', marginBottom: 24 };
const logoWrap: React.CSSProperties = {
  // No white circle, no padding ring. Just the logo at its native square
  // shape, with the same rounded-corner radius as the form card so the two
  // shapes feel related.
  width: 76,
  height: 76,
  borderRadius: 16,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  marginBottom: 14,
};
const logoImg: React.CSSProperties = {
  width: '100%', height: '100%', objectFit: 'contain', display: 'block',
};
const cardStyle: React.CSSProperties = {
  padding: 28,
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.06)',
  border: '1px solid #e5e7eb',
};
