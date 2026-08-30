'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useMyRole } from '@/hooks/use-workflow';
import { CampaignPage } from '@/components/workflow/CampaignPage';
import { CampaignLoading } from '@/components/workflow/CampaignSkeleton';

const supabase = createClient();

/**
 * A campaign's own page.
 *
 * The only place a campaign is edited. The slide-over drawer this replaced is
 * gone; /dashboard/workflow?task=<id> now resolves the id to its campaign and
 * redirects here, so every link in every notification already sent still
 * works — including the ones pointing at a booking rather than a campaign.
 */
export default function CampaignRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { role } = useMyRole(workspaceId);

  useEffect(() => {
    let alive = true;
    (async () => {
      // getSession reads the token already in local storage. getUser is a
      // round trip to the auth server for an id the session already holds,
      // and NOTHING on this page — not one of its twelve queries — could
      // start until it came back. From Frankfurt that was a tenth of a
      // second of skeleton before the real work was allowed to begin.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { router.replace('/auth'); return; }
      const { data } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      setUserId(user.id);
      setWorkspaceId(data?.workspace_id ?? null);
      setReady(true);
    })();
    return () => { alive = false; };
  }, [router]);

  // The same screen the page itself shows, so signing-in and fetching the
  // campaign look like one wait rather than a bare "Loading…" that jumps into
  // a skeleton a moment later.
  if (!ready || !workspaceId || !userId) return <CampaignLoading />;

  return <CampaignPage taskId={id} workspaceId={workspaceId} role={role} currentUserId={userId} />;
}
