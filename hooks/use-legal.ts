'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';
import type {
  DocKind, LegalTemplateLite, VersionStatus, EditorBlockType, TemplateBlock, Placeholder,
} from '@/lib/legal';
import { defaultBlockContent, moveItem, withPositions, nextPosition } from '@/lib/legal';

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

export interface DocVersionLite {
  id: string;
  version: number;
  status: VersionStatus;
}

/**
 * The block editor for one template: its newest version and that version's
 * blocks. Only a `draft` version is editable - the freeze trigger (migration
 * 098) rejects any write to a published/archived version's blocks, so the UI
 * disables editing off `editable` and offers `startNewDraft` instead.
 */
export function useDocEditor(workspaceId: string | null, templateId: string | null) {
  const [name, setName] = useState('');
  const [docKind, setDocKind] = useState<DocKind | null>(null);
  const [version, setVersion] = useState<DocVersionLite | null>(null);
  const [blocks, setBlocks] = useState<TemplateBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const editable = version?.status === 'draft';

  const load = useCallback(async () => {
    if (!workspaceId || !templateId) { setLoading(false); return; }
    setLoading(true); setError('');
    const c = legal();
    const { data: tpl, error: e0 } = await c.from('doc_template')
      .select('name, doc_kind').eq('id', templateId).single();
    if (e0) { setError(e0.message ?? String(e0)); setLoading(false); return; }
    setName((tpl as any).name); setDocKind((tpl as any).doc_kind);
    const { data: vers, error: e1 } = await c.from('doc_template_version')
      .select('id, version, status').eq('template_id', templateId);
    if (e1) { setError(e1.message ?? String(e1)); setLoading(false); return; }
    const newest = ((vers ?? []) as any[]).sort((a, b) => b.version - a.version)[0] ?? null;
    setVersion(newest);
    if (!newest) { setBlocks([]); setLoading(false); return; }
    const { data: blks, error: e2 } = await c.from('doc_template_block')
      .select('id, version_id, workspace_id, position, block_type, content, optional, condition, clause_id')
      .eq('version_id', newest.id).order('position');
    if (e2) { setError(e2.message ?? String(e2)); setLoading(false); return; }
    setBlocks(((blks ?? []) as any[]) as TemplateBlock[]);
    setLoading(false);
  }, [workspaceId, templateId]);

  useEffect(() => { void load(); }, [load]);

  const guard = () => {
    if (!workspaceId || !version) throw new Error('No draft loaded.');
    if (version.status !== 'draft') throw new Error('This version is published and cannot be edited.');
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e: any) { setError(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  /** Append a new block of the given type at the end. */
  const addBlock = (type: EditorBlockType) => run(async () => {
    guard();
    const { error: e } = await legal().from('doc_template_block').insert({
      version_id: version!.id, workspace_id: workspaceId,
      position: nextPosition(blocks), block_type: type, content: defaultBlockContent(type),
    });
    if (e) throw e;
    await load();
  });

  /** Save a block's content (called on blur, so one write per edit, not per key). */
  const saveBlock = (id: string, content: Record<string, unknown>) => run(async () => {
    guard();
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, content } : b)));
    const { error: e } = await legal().from('doc_template_block').update({ content }).eq('id', id);
    if (e) throw e;
  });

  const deleteBlock = (id: string) => run(async () => {
    guard();
    const { error: e } = await legal().from('doc_template_block').delete().eq('id', id);
    if (e) throw e;
    await load();
  });

  /** Move a block up/down and persist the whole list's positions in one upsert. */
  const moveBlock = (id: string, dir: -1 | 1) => run(async () => {
    guard();
    const idx = blocks.findIndex((b) => b.id === id);
    const reordered = withPositions(moveItem(blocks, idx, dir));
    if (reordered === blocks) return; // no-op at an edge
    setBlocks(reordered);
    const rows = reordered.map((b) => ({
      id: b.id, version_id: b.version_id, workspace_id: b.workspace_id,
      position: b.position, block_type: b.block_type, content: b.content,
    }));
    const { error: e } = await legal().from('doc_template_block').upsert(rows, { onConflict: 'id' });
    if (e) { await load(); throw e; }
  });

  /** Publish the draft: freeze it and stamp published_at (the CHECK requires it). */
  const publish = () => run(async () => {
    guard();
    const { error: e } = await legal().from('doc_template_version')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', version!.id);
    if (e) throw e;
    await load();
  });

  /** Copy the current (published) version into a fresh draft v+1 and switch to it. */
  const startNewDraft = () => run(async () => {
    if (!workspaceId || !version || !templateId) throw new Error('No version loaded.');
    const c = legal();
    const { data: nv, error: e1 } = await c.from('doc_template_version')
      .insert({ template_id: templateId, workspace_id: workspaceId, version: version.version + 1, status: 'draft' })
      .select('id').single();
    if (e1) throw e1;
    const newId = (nv as any).id as string;
    if (blocks.length) {
      const copies = blocks.map((b) => ({
        version_id: newId, workspace_id: workspaceId,
        position: b.position, block_type: b.block_type, content: b.content,
        optional: b.optional ?? false, condition: b.condition ?? null, clause_id: b.clause_id ?? null,
      }));
      const { error: e2 } = await c.from('doc_template_block').insert(copies);
      if (e2) throw e2;
    }
    await load();
  });

  return {
    name, docKind, version, blocks, loading, error, busy, editable,
    reload: load, addBlock, saveBlock, deleteBlock, moveBlock, publish, startNewDraft,
  };
}

/**
 * The workspace's placeholder registry (legal.placeholder) - the merge fields a
 * template's wording may reference. Shared across all templates in the
 * workspace, so it is keyed on the workspace, not a template.
 */
export function useLegalPlaceholders(workspaceId: string | null) {
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setPlaceholders([]); setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error: e } = await legal().from('placeholder')
      .select('id, key, label').eq('workspace_id', workspaceId).order('key');
    if (e) { setError(e.message ?? String(e)); setPlaceholders([]); setLoading(false); return; }
    setPlaceholders(((data ?? []) as any[]).map((r) => ({ id: r.id, key: r.key, label: r.label })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async (key: string, label: string) => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const { error: e } = await legal().from('placeholder')
      .insert({ workspace_id: workspaceId, key: key.trim(), label: label.trim() });
    if (e) throw e;
    await load();
  }, [workspaceId, load]);

  const update = useCallback(async (id: string, patch: { key?: string; label?: string }) => {
    const clean: Record<string, string> = {};
    if (patch.key !== undefined) clean.key = patch.key.trim();
    if (patch.label !== undefined) clean.label = patch.label.trim();
    const { error: e } = await legal().from('placeholder').update(clean).eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { error: e } = await legal().from('placeholder').delete().eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  return { placeholders, loading, error, reload: load, create, update, remove };
}
