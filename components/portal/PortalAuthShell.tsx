'use client';

import { ReactNode } from 'react';
import { SplitAuthLayout } from '@/components/auth/SplitAuthLayout';

/**
 * Layout used by every portal auth page (vendor + client login, setup,
 * password reset). Defers the whole visual to SplitAuthLayout so the portals,
 * the PM login and /hub stay one surface.
 *
 * `title` is the portal's name and becomes the role line under the wordmark.
 * The headline is supplied here because portal forms — unlike /auth — don't
 * carry a heading of their own.
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
      heading="Sign in to your portal"
      blurb={subtitle}
    >
      {children}
    </SplitAuthLayout>
  );
}
