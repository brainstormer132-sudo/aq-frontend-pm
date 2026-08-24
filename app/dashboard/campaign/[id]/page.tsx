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
 * The drawer on /dashboard/workflow stays — it is still the right thing for a
 * subtask and for a four-second fix from All Tasks. This is where you go to
 * work on a campaign, and it is a link you can send somebody.
 */
export default function CampaignRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
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
      setWorkspaceId(data?.workspace_id ?? null);
      setReady(true);
    })();
    return () => { alive = false; };
  }, [router]);

  if (!ready || !workspaceId) {
    return <div style={{ padding: 40, color: 'var(--aq-text-muted)' }}>Loading…</div>;
  }

  return <CampaignPage taskId={id} workspaceId={workspaceId} role={role} />;
}
