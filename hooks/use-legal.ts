'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';
import type { DocKind, LegalTemplateLite, VersionStatus } from '@/lib/legal';

// The legal tables live in the `legal` schema (migration 098), so every read
// and write goes through .schema('legal'). The schema must be added to
// Supabase's Exposed schemas or these 404.
//
// The client is cast to the bare SupabaseClient before .schema(): the installed
// @supabase/ssr (0.5.2) and supabase-js (2.101) disagree on the client's schema
// generics, which narrows .schema()'s argument to `never` for any non-public
// name. The cast restores the untyped (Database = any) signature, where a
// schema name is just a string. We have no generated Database types anyway, so
// the query builders were already loosely typed.
const legal = () => (createClient() as unknown as SupabaseClient).schema('legal');

/**
 * The document templates for a workspace, each folded with its newest version's
 * number and status. Two slim reads (templates, then versions) rather than an
 * embedded join, so it stays predictable while the tables are small.
 */
export function useLegalTemplates(workspaceId: string | null) {
  const [templates, setTemplates] = useState<LegalTemplateLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchAll = useCallback(async () => {
    if (!workspaceId) { setTemplates([]); setLoading(false); return; }
    setLoading(true); setError('');
    const { data: tpls, error: e1 } = await legal().from('doc_template')
      .select('id, doc_kind, name, description, updated_at')
      .eq('workspace_id', workspaceId);
    if (e1) { setError(e1.message ?? String(e1)); setTemplates([]); setLoading(false); return; }
    const { data: vers } = await legal().from('doc_template_version')
      .select('template_id, version, status')
      .eq('workspace_id', workspaceId);
    const byTpl = new Map<string, { version: number; status: VersionStatus }>();
    for (const v of (vers ?? []) as any[]) {
      const cur = byTpl.get(v.template_id);
      if (!cur || v.version > cur.version) byTpl.set(v.template_id, { version: v.version, status: v.status });
    }
    setTemplates(((tpls ?? []) as any[]).map((t) => ({
      id: t.id, doc_kind: t.doc_kind, name: t.name, description: t.description, updated_at: t.updated_at,
      latest_version: byTpl.get(t.id)?.version ?? null,
      latest_status: byTpl.get(t.id)?.status ?? null,
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  /** Create a template and its first draft version. Returns the template id. */
  const createTemplate = useCallback(async (name: string, kind: DocKind): Promise<string> => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const c = legal();
    const { data: t, error: e1 } = await c.from('doc_template')
      .insert({ workspace_id: workspaceId, doc_kind: kind, name: name.trim() })
      .select('id').single();
    if (e1) throw e1;
    const id = (t as any).id as string;
    const { error: e2 } = await c.from('doc_template_version')
      .insert({ template_id: id, workspace_id: workspaceId, version: 1, status: 'draft' });
    if (e2) throw e2;
    await fetchAll();
    return id;
  }, [workspaceId, fetchAll]);

  return { templates, loading, error, refetch: fetchAll, createTemplate };
}
