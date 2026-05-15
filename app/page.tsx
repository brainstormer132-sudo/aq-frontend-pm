import { redirect } from 'next/navigation';

// Mirrors the nginx rule `location = / { return 302 /portals; }`.
// /portals is a static HTML file in /public/portals.html, surfaced at
// /portals via a vercel.json rewrite. From there users pick vendor,
// client, or team-internal entry.
export default function HomePage() {
  redirect('/portals');
}
