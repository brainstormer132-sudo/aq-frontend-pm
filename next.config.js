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
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
};

module.exports = nextConfig;
