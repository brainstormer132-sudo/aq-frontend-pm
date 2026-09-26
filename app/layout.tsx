import type { Metadata } from 'next';
import '@/styles/globals.css';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'AQ Creativity — Project Management',
  description: 'Modern project management for creative teams',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the boot script below adds class="dark" to
    // <html> before React runs, so the server markup (no class) and the
    // client DOM legitimately differ on this one attribute.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a dark user never sees a white flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          Cairo is the Arabic face. Until it was added, NOTHING in this app
          loaded a font with Arabic coverage — DM Sans has none — so the
          registration form's Arabic fell back to whatever the visitor's
          browser happened to have, which on Windows is Tahoma and on a
          phone is anyone's guess. `display=swap` and one stylesheet for
          all three, so this costs one request, not two.
        */}
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Cairo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
