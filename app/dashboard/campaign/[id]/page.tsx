'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useMyRole } from '@/hooks/use-workflow';
import { CampaignPage } from '@/components/workflow/CampaignPage';

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
      const { data: { user } } = await supabase.auth.getUser();
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

  if (!ready || !workspaceId || !userId) {
    return <div style={{ padding: 40, color: 'var(--aq-text-muted)' }}>Loading…</div>;
  }

  return <CampaignPage taskId={id} workspaceId={workspaceId} role={role} currentUserId={userId} />;
}
