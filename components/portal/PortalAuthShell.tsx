'use client';

import { ReactNode } from 'react';
import { SplitAuthLayout } from '@/components/auth/SplitAuthLayout';

/**
 * Centered card layout used by every portal auth page (vendor + client login,
 * setup, password reset). Now uses the shared SplitAuthLayout so the visual
 * matches the contract maker and PM-app login surfaces.
 */
export function PortalAuthShell({
  title, subtitle, children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <SplitAuthLayout
      subtitle={title}
      blurb="Sign in with the credentials your AQ administrator gave you. Forgot your password? Ask them for a fresh invite."
    >
      {subtitle && (
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 18 }}>{subtitle}</p>
      )}
      {children}
    </SplitAuthLayout>
  );
}
