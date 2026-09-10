/** @type {import('next').NextConfig} */
//
// IMPORTANT: NO basePath. The folder structure under app/ already encodes
// the URL path: /dashboard/workflow → app/dashboard/workflow/page.tsx,
// /vendor/auth → app/vendor/auth/page.tsx, etc.
// nginx forwards those paths through unchanged.
//
// Setting basePath: '/dashboard' would prepend /dashboard a SECOND time
// (the user saw localhost/dashboard/dashboard/workflow as a result).
const nextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Tokens ride in download URLs (see aq-contract-app-audit); never
          // leak them to a third party through the Referer header.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
};

module.exports = nextConfig;
