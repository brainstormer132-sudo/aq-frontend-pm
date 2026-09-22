'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase-browser';
import { selectAllRows } from '@/hooks/use-workflow';
import {
  readDocxFile, docxToBlocks, summarise,
  type ImportedBlock, type ImportSummary,
} from '@/lib/legal-docx';
import type { VendorBankAccount } from '@/lib/legal-prefill';
import { stampContractNumber } from '@/lib/legal-prefill';
import type {
  DocKind, LegalTemplateLite, VersionStatus, EditorBlockType, TemplateBlock, Placeholder,
  Dept, ManagedList, ManagedListValue, FieldDef, Contract, ContractStatus,
  ContractBatch, ContractBatchLite, DeletedBatch,
} from '@/lib/legal';
import {
  defaultBlockContent, moveItem, withPositions, nextPosition, contractEditable,
  contractCanonical, FINGERPRINT_KEY, ISSUED_AT_KEY,
  OPT_OFF_KEY, parseOffIds, serializeOffIds, visibleBlocks, TABLE_KEY_PREFIX,
  withoutArchived,
} from '@/lib/legal';
import type { PrintContract, PrintBuild, FieldRow } from '@/lib/legal-bulk';
import { chunk, versionIdsOf, buildPrintDocs } from '@/lib/legal-bulk';
import type { SupersedeContract, SupersedeLinks } from '@/lib/legal-supersede';
import {
  SIGNED_BUCKET, validateSignedFile, signedStoragePath, cannotFileSigned,
} from '@/lib/legal-signed';
import type { ExternalDoc } from '@/lib/legal-external';
import {
  validateExternalDoc, validateExternalFile, externalStoragePath,
} from '@/lib/legal-external';
import {
  validateSupersedeReason, correctionTitle, carriedValues, supersedeLinks,
} from '@/lib/legal-supersede';

/** SHA-256 of a string as lowercase hex, via the Web Crypto API (browser + Node 18+). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
      .select('id, doc_kind, name, description, updated_at, archived_at')
      .eq('workspace_id', workspaceId);
    if (e1) { setError(e1.message ?? String(e1)); setTemplates([]); setLoading(false); return; }
    // PAGED: versions only ever accumulate - one per publish, forever - so
    // this is the read that crosses 1000 first. Truncated, a template loses
    // its version badge and reads as though it has none.
    const vers = await selectAllRows<any>('useLegalTemplates versions', () => legal().from('doc_template_version')
      .select('template_id, version, status')
      .eq('workspace_id', workspaceId).order('id'));
    const byTpl = new Map<string, { version: number; status: VersionStatus }>();
    for (const v of vers as any[]) {
      const cur = byTpl.get(v.template_id);
      if (!cur || v.version > cur.version) byTpl.set(v.template_id, { version: v.version, status: v.status });
    }
    setTemplates(((tpls ?? []) as any[]).map((t) => ({
      id: t.id, doc_kind: t.doc_kind, name: t.name, description: t.description, updated_at: t.updated_at,
      archived_at: t.archived_at ?? null,
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

  /**
   * Retire a template, or bring it back (119).
   *
   * This writes ONE column on ONE row. It deliberately does not touch the
   * template's versions: archiving a version is irreversible under the 098
   * freeze, and a draft-only version cannot be archived at all. See the
   * header of 119 for the whole argument.
   *
   * `archived_by` is written with the date and cleared with it, because the
   * CHECK refuses one without the other.
   */
  const setArchived = useCallback(async (id: string, archived: boolean) => {
    const sb = createClient() as unknown as SupabaseClient;
    const { data: who } = await sb.auth.getUser();
    const { error: e } = await legal().from('doc_template').update(archived
      ? { archived_at: new Date().toISOString(), archived_by: who?.user?.id ?? null }
      : { archived_at: null, archived_by: null }).eq('id', id);
    if (e) throw e;
    await fetchAll();
  }, [fetchAll]);

  return { templates, loading, error, refetch: fetchAll, createTemplate, setArchived };
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
/** Every column the editor reads. One list, so a select and an insert's
 *  returning clause cannot come back with different shapes. */
const BLOCK_COLS = 'id, version_id, workspace_id, position, block_type, content, '
  + 'optional, optional_group, optional_label, condition, clause_id';

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
      .select(BLOCK_COLS)
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

  /** Mark a block optional (can be toggled off per contract) or required. */
  const setBlockOptional = (id: string, optional: boolean) => run(async () => {
    guard();
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, optional } : b)));
    const { error: e } = await legal().from('doc_template_block').update({ optional }).eq('id', id);
    if (e) throw e;
  });

  /**
   * Persist an ARBITRARY new order in one upsert.
   *
   * Extracted from moveBlock because the document editor moves a whole
   * section - nine blocks past nine others - which is one decision and has to
   * be one write. The deferrable unique on (version_id, position) is what lets
   * the whole list land in a single statement without colliding halfway
   * through; see 098.
   */
  const persistOrder = async (next: TemplateBlock[]) => {
    const reordered = withPositions(next);
    setBlocks(reordered);
    const rows = reordered.map((b) => ({
      id: b.id, version_id: b.version_id, workspace_id: b.workspace_id,
      position: b.position, block_type: b.block_type, content: b.content,
    }));
    const { error: e } = await legal().from('doc_template_block').upsert(rows, { onConflict: 'id' });
    if (e) { await load(); throw e; }
  };

  /** Reorder to exactly this list. A caller that got back the same array
   *  reference from a refused move writes nothing. */
  const reorder = (next: TemplateBlock[]) => run(async () => {
    guard();
    if (next === blocks) return;
    await persistOrder(next);
  });

  /** Move a block up/down and persist the whole list's positions in one upsert. */
  const moveBlock = (id: string, dir: -1 | 1) => run(async () => {
    guard();
    const idx = blocks.findIndex((b) => b.id === id);
    const reordered = moveItem(blocks, idx, dir);
    if (reordered === blocks) return; // no-op at an edge
    await persistOrder(reordered);
  });

  /**
   * Add a line at a POSITION rather than at the end.
   *
   * The old editor could only append, so building a document meant adding
   * forty-two blocks and then walking each one up into place. This inserts
   * where the "+" was pressed: one write to create the row (which comes back
   * whole, so nothing is guessed about its shape), then one reorder.
   */
  const addBlockAt = (type: EditorBlockType, index: number) => run(async () => {
    guard();
    const { data, error: e } = await legal().from('doc_template_block').insert({
      version_id: version!.id, workspace_id: workspaceId,
      position: nextPosition(blocks), block_type: type, content: defaultBlockContent(type),
    }).select(BLOCK_COLS).single();
    if (e) throw e;
    const row = data as unknown as TemplateBlock;
    const at = Math.max(0, Math.min(Math.trunc(index), blocks.length));
    const next = blocks.slice();
    next.splice(at, 0, row);
    await persistOrder(next);
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
    reload: load, addBlock, addBlockAt, saveBlock, deleteBlock, moveBlock, reorder,
    setBlockOptional, publish, startNewDraft,
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
    const data = await selectAllRows<any>('useLegalPlaceholders', () => legal().from('placeholder')
      .select('id, key, label, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days, allow_other')
      .eq('workspace_id', workspaceId).order('key').order('id'), setError);
    setPlaceholders(((data ?? []) as any[]).map((r) => ({
      id: r.id, key: r.key, label: r.label, field_type: r.field_type, required: !!r.required,
      default_value: r.default_value ?? '', num_min: r.num_min, num_max: r.num_max,
      list_id: r.list_id, owner_dept: r.owner_dept, alert_days: r.alert_days ?? null,
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async (field: FieldDef) => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const { error: e } = await legal().from('placeholder').insert({
      workspace_id: workspaceId, key: field.key.trim(), label: field.label.trim(),
      field_type: field.field_type, required: field.required, default_value: field.default_value,
      num_min: field.num_min, num_max: field.num_max, list_id: field.list_id, owner_dept: field.owner_dept,
      alert_days: field.alert_days,
    });
    if (e) throw e;
    await load();
  }, [workspaceId, load]);

  const update = useCallback(async (id: string, patch: Partial<FieldDef>) => {
    const clean: Record<string, unknown> = {};
    for (const k of ['key', 'label', 'field_type', 'required', 'default_value', 'num_min', 'num_max', 'list_id', 'owner_dept', 'alert_days'] as const) {
      if (patch[k] !== undefined) clean[k] = typeof patch[k] === 'string' ? (patch[k] as string).trim() : patch[k];
    }
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

/**
 * The workspace's managed lists (legal.managed_list) and their values. Two slim
 * reads - the lists, then all their values - grouped client-side by list. A
 * list-type field points at one of these; this hook is the list editor's data.
 */
export function useManagedLists(workspaceId: string | null) {
  const [lists, setLists] = useState<ManagedList[]>([]);
  const [valuesByList, setValuesByList] = useState<Record<string, ManagedListValue[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setLists([]); setValuesByList({}); setLoading(false); return; }
    setLoading(true); setError('');
    const c = legal();
    const ls = await selectAllRows<any>('useManagedLists', () => c.from('managed_list')
      .select('id, key, name, owner_dept')
      .eq('workspace_id', workspaceId).order('name').order('id'), setError);
    setLists((ls as any[]).map((r) => ({ id: r.id, key: r.key, name: r.name, owner_dept: r.owner_dept })));
    // PAGED. This is the table in the legal schema that genuinely holds
    // thousands of rows - a managed list of vendors or influencers is exactly
    // what it is for - and PostgREST stops at 1000 without saying so.
    //
    // The consequence was not a short dropdown. ContractFill builds its
    // validation sets from these values, and contractReady REJECTS a value
    // that is not in the list. So a contract holding a perfectly valid value
    // that happened to sort past row 1000 failed validation, Issue stayed
    // disabled, and the only explanation on screen was "Fill every required
    // field first" on a form where every field was filled.
    const vs = await selectAllRows<any>('useManagedLists values', () => c.from('managed_list_value')
      .select('id, list_id, value, label, position, active')
      .eq('workspace_id', workspaceId).order('position').order('id'));
    const grouped: Record<string, ManagedListValue[]> = {};
    for (const v of vs as any[]) (grouped[v.list_id] ??= []).push({
      id: v.id, list_id: v.list_id, value: v.value, label: v.label, position: v.position, active: v.active,
    });
    setValuesByList(grouped);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const createList = useCallback(async (key: string, name: string, owner_dept: Dept): Promise<string> => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const { data, error: e } = await legal().from('managed_list')
      .insert({ workspace_id: workspaceId, key: key.trim(), name: name.trim(), owner_dept })
      .select('id').single();
    if (e) throw e;
    await load();
    return (data as any).id as string;
  }, [workspaceId, load]);

  const updateList = useCallback(async (id: string, patch: { name?: string; owner_dept?: Dept }) => {
    const clean: Record<string, string> = {};
    if (patch.name !== undefined) clean.name = patch.name.trim();
    if (patch.owner_dept !== undefined) clean.owner_dept = patch.owner_dept;
    const { error: e } = await legal().from('managed_list').update(clean).eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  const removeList = useCallback(async (id: string) => {
    const { error: e } = await legal().from('managed_list').delete().eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  const addValue = useCallback(async (listId: string, value: string, label: string) => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const existing = valuesByList[listId] ?? [];
    const nextPos = existing.reduce((m, v) => Math.max(m, v.position + 1), 0);
    const { error: e } = await legal().from('managed_list_value')
      .insert({ list_id: listId, workspace_id: workspaceId, value: value.trim(), label: label.trim(), position: nextPos });
    if (e) throw e;
    await load();
  }, [workspaceId, valuesByList, load]);

  const updateValue = useCallback(async (id: string, patch: { value?: string; label?: string; active?: boolean }) => {
    const clean: Record<string, unknown> = {};
    if (patch.value !== undefined) clean.value = patch.value.trim();
    if (patch.label !== undefined) clean.label = patch.label.trim();
    if (patch.active !== undefined) clean.active = patch.active;
    const { error: e } = await legal().from('managed_list_value').update(clean).eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  const removeValue = useCallback(async (id: string) => {
    const { error: e } = await legal().from('managed_list_value').delete().eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  return {
    lists, valuesByList, loading, error, reload: load,
    createList, updateList, removeList, addValue, updateValue, removeValue,
  };
}

// ---- contracts (filled documents, stamped to a published version) --------

export interface PublishedVersion {
  version_id: string;
  template_id: string;
  template_name: string;
  doc_kind: DocKind;
  version: number;
}

/**
 * The published template versions a new contract can be started from - the
 * latest published version of each template. A template with only a draft
 * version is not offered (you cannot issue a contract off an unfrozen draft).
 */
export function usePublishedVersions(workspaceId: string | null) {
  const [versions, setVersions] = useState<PublishedVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setVersions([]); setLoading(false); return; }
    setLoading(true); setError('');
    const c = legal();
    // PAGED, same growth. Truncated, a template simply stops appearing in
    // the New-contract picker: it exists, it is published, and it cannot be
    // chosen, with nothing on screen to say why.
    const vers = await selectAllRows<any>('usePublishedVersions', () => c.from('doc_template_version')
      .select('id, template_id, version, status')
      .eq('workspace_id', workspaceId).eq('status', 'published').order('id'), setError);
    const { data: tpls } = await c.from('doc_template')
      .select('id, name, doc_kind, archived_at').eq('workspace_id', workspaceId);
    const byId = new Map(((tpls ?? []) as any[]).map((t) => [t.id, t]));
    // A retired template is not offered for a new contract (119). The flag is
    // on the TEMPLATE and this read lists VERSIONS, so the filter has to
    // happen here - without it, retiring one changes nothing on this screen,
    // which is the complaint that started it.
    const retired = new Set(((tpls ?? []) as any[])
      .filter((t) => !!t.archived_at).map((t) => String(t.id)));
    // keep the highest published version per template
    const best = new Map<string, any>();
    for (const v of withoutArchived((vers ?? []) as any[], retired)) {
      const cur = best.get(v.template_id);
      if (!cur || v.version > cur.version) best.set(v.template_id, v);
    }
    setVersions([...best.values()].map((v) => ({
      version_id: v.id, template_id: v.template_id, version: v.version,
      template_name: byId.get(v.template_id)?.name ?? 'Template',
      doc_kind: (byId.get(v.template_id)?.doc_kind ?? 'other') as DocKind,
    })).sort((a, b) => a.template_name.localeCompare(b.template_name)));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);
  return { versions, loading, error, reload: load };
}

/**
 * One version's blocks, in document order, for a screen that is not editing
 * it: the New-task form, which needs them only to know what the optional
 * clauses ARE before a single contract exists.
 *
 * Deliberately not useDocEditor: that one is keyed on the TEMPLATE and always
 * opens its newest version, draft included. This has to read the exact
 * published version the task will be stamped to, or the block ids it hands
 * back name clauses in a document nobody is signing.
 *
 * Not paged, and the paging suite agrees: this is narrowed to ONE parent row
 * (`.eq('version_id', ...)`), not a workspace-wide read. A version's blocks
 * are its whole document - forty-three of them today - and useContractEditor
 * reads them exactly this way for the same reason.
 */
export function useVersionBlocks(workspaceId: string | null, versionId: string | null) {
  const [blocks, setBlocks] = useState<TemplateBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId || !versionId) { setBlocks([]); setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error: e } = await legal().from('doc_template_block')
      .select('id, version_id, workspace_id, position, block_type, content, optional, optional_group, optional_label, condition, clause_id')
      .eq('version_id', versionId).order('position');
    if (e) { setError(e.message ?? String(e)); setBlocks([]); setLoading(false); return; }
    setBlocks(((data ?? []) as any[]) as TemplateBlock[]);
    setLoading(false);
  }, [workspaceId, versionId]);

  useEffect(() => { void load(); }, [load]);
  return { blocks, loading, error, reload: load };
}

export type ContractRow = Contract & { template_name: string; doc_kind: DocKind };

/**
 * The workspace's contracts, newest first, each folded with its template's name
 * and kind for the list. Create stamps the contract to the chosen version;
 * remove is allowed only on a draft (a live non-draft freezes, and the freeze
 * trigger lets a draft delete cascade its fields).
 */
export function useContracts(workspaceId: string | null) {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setContracts([]); setLoading(false); return; }
    setLoading(true); setError('');
    const c = legal();
    // Paged, and ordered on a TOTAL order. A bare select stops at PostgREST's
    // thousand-row limit with no error and no sign on screen, which on this
    // screen means a register that silently stops listing contracts - and,
    // now that the register can print a batch, a "print everything" that
    // quietly leaves out everything past the thousandth. created_at alone is
    // not unique (an import writes hundreds in the same second), so id ends
    // the order: with a non-unique order two pages overlap and a row falls
    // between them. See selectAllRows and tests/paging.
    const cs = await selectAllRows<any>('useContracts', () => c.from('contract')
      .select('id, workspace_id, template_id, version_id, title, status, created_at, updated_at, pm_task_id, subtask_id, vendor_id, bank_account_id, contract_no, supersedes_id, supersede_reason, signed_path, signed_name, signed_bytes, signed_on, signed_recorded_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .order('id'), (m) => setError(m));
    const { data: tpls } = await c.from('doc_template')
      .select('id, name, doc_kind').eq('workspace_id', workspaceId);
    const byId = new Map(((tpls ?? []) as any[]).map((t) => [t.id, t]));
    setContracts(((cs ?? []) as any[]).map((r) => ({
      ...(r as Contract),
      template_name: byId.get(r.template_id)?.name ?? 'Template',
      doc_kind: (byId.get(r.template_id)?.doc_kind ?? 'other') as DocKind,
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async (versionId: string, templateId: string, title: string): Promise<string> => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const { data, error: e } = await legal().from('contract')
      .insert({ workspace_id: workspaceId, template_id: templateId, version_id: versionId, title: title.trim(), status: 'draft' })
      .select('id').single();
    if (e) throw e;
    await load();
    return (data as any).id as string;
  }, [workspaceId, load]);

  const remove = useCallback(async (id: string) => {
    const { error: e } = await legal().from('contract').delete().eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  return { contracts, loading, error, reload: load, create, remove };
}

/**
 * One contract for the fill screen: its row, the blocks of the version it was
 * stamped to (read-only - the wording is fixed at that version), and its field
 * values keyed by field key. Values are editable only while the contract is a
 * draft; saveAll upserts them, and issue saves then flips the status, at which
 * point the database freezes the fields.
 */
/**
 * What the brand and bank pickers on a contract can offer.
 *
 * Both read `public`, not `legal`: client_brands is reachable by any signed-in
 * user and bank_accounts by any staff member, so legal can see them without a
 * SECURITY DEFINER detour. Both are small per row - one client's brands, one
 * vendor's accounts - so neither is paged.
 *
 * A contract with no campaign has no client, and one with no vendor has no
 * accounts; both come back empty and the pickers simply do not appear. That is
 * the standalone case, not an error.
 */
/**
 * The tasks: a batch of contracts raised together off one set of terms.
 *
 * Two slim reads rather than an embedded join - the batches, then a count of
 * their contracts - so the list stays predictable and the second read is one
 * query however many batches there are.
 */
export function useContractBatches(workspaceId: string | null) {
  const [batches, setBatches] = useState<ContractBatchLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) { setBatches([]); setLoading(false); return; }
    setLoading(true); setError('');
    const c = legal();
    // PAGED, and CHUNKED. Three failures were stacked here.
    //
    // The batch list was unpaged; the id array built from it was unpaged;
    // and the contract read that counts per batch was neither paged nor
    // chunked. With a few thousand contracts the counts were built from the
    // first 1000 rows only, so every batch past that boundary reported
    // "0 of 0 filled" and lost its "N to fill" badge - a wrong number that
    // looks like a right one. And a few hundred uuids in one `in()` is an
    // 11KB URL, which comes back as a 414 and zeroes every count at once.
    //
    // 60 per chunk, the same as loadContractPrintDocs.
    const bs = await selectAllRows<any>('useContractBatches', () => c.from('contract_batch')
      .select('id, workspace_id, title, shared, version_id, created_at')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: false }).order('id'), setError);
    const ids = (bs as any[]).map((b) => b.id);
    const counts = new Map<string, { total: number; unassigned: number; issued: number }>();
    if (ids.length) {
      const cs: any[] = [];
      for (const part of chunk(ids, 60)) {
        cs.push(...await selectAllRows<any>('useContractBatches counts', () => c.from('contract')
          .select('batch_id, status, vendor_id').in('batch_id', part).order('id')));
      }
      for (const row of cs) {
        const cur = counts.get(row.batch_id) ?? { total: 0, unassigned: 0, issued: 0 };
        cur.total += 1;
        if (row.vendor_id == null) cur.unassigned += 1;
        if (row.status !== 'draft') cur.issued += 1;
        counts.set(row.batch_id, cur);
      }
    }
    setBatches((bs as any[]).map((b) => ({
      ...(b as ContractBatch),
      shared: (b.shared ?? {}) as Record<string, string>,
      ...(counts.get(b.id) ?? { total: 0, unassigned: 0, issued: 0 }),
    })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true); setError('');
    try { return await fn(); }
    catch (e: any) { setError(e?.message ?? String(e)); throw e; }
    finally { setBusy(false); }
  };

  /**
   * Create a task and its first N contracts. Returns the batch id.
   *
   * `versionId` is the template version the New-task form was looking at when
   * it drew the optional-clause checkboxes. It matters because the choice is
   * stored as BLOCK IDS, and a block id only means something inside the
   * version it belongs to. Left out, create_contract_batch resolves the
   * published vendor-contract version itself - the same rule, run twice, and
   * two answers that agree today is not the same as two answers that cannot
   * disagree. Passing it makes the contracts carry the document the operator
   * actually ticked.
   */
  const create = (title: string, count: number, shared: Record<string, string>,
    versionId?: string | null) =>
    run(async () => {
      if (!workspaceId) throw new Error('No workspace selected.');
      const { data, error: e } = await legal().rpc('create_contract_batch', {
        p_workspace_id: workspaceId, p_title: title.trim(), p_count: count, p_shared: shared,
        p_version_id: versionId ?? null,
      });
      if (e) throw e;
      await load();
      return String(data);
    });

  /** Add more contracts to a task, on the terms it was created with. */
  const addMore = (batchId: string, count: number) => run(async () => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const { error: e } = await legal().rpc('create_contract_batch', {
      p_workspace_id: workspaceId, p_title: null, p_count: count,
      p_shared: null, p_version_id: null, p_batch_id: batchId,
    });
    if (e) throw e;
    await load();
  });

  /**
   * Send the task to the bin. It comes back for thirty days (migration 120).
   *
   * Was a hard `delete`, which took the grouping with it the moment somebody
   * clicked the cross: legal.contract.batch_id is ON DELETE SET NULL, so the
   * contracts survived but stopped being grouped, permanently. The soft
   * delete keeps the batch row, so the grouping is still there if it is
   * restored; the contracts ungroup at purge instead, thirty days later.
   */
  const remove = (batchId: string) => run(async () => {
    const { error: e } = await legal().rpc('soft_delete_batch', { p_batch_id: batchId });
    if (e) throw e;
    await load();
  });

  return { batches, loading, error, busy, reload: load, create, addMore, remove };
}

/**
 * The tasks in the bin, and the way back out.
 *
 * Read through an RPC rather than a table select, because the 120 policy
 * hides exactly these rows from an ordinary read - which is the point. A
 * screen that forgets `.is('deleted_at', null)` cannot show a deleted task as
 * live, because it cannot see one at all.
 *
 * Deliberately NOT loaded with the main list: the bin is opened rarely, and
 * fetching it on every visit to Tasks would spend a round trip on something
 * nobody asked for. The caller loads it when the drawer opens.
 */
export function useDeletedBatches(workspaceId: string | null) {
  const [rows, setRows] = useState<DeletedBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setRows([]); return; }
    setLoading(true); setError('');
    const { data, error: e } = await legal().rpc('deleted_batches', { p_workspace_id: workspaceId });
    if (e) { setError(e.message ?? String(e)); setRows([]); }
    else setRows((data ?? []) as DeletedBatch[]);
    setLoading(false);
  }, [workspaceId]);

  const restore = useCallback(async (batchId: string) => {
    setError('');
    const { data, error: e } = await legal().rpc('restore_batch', { p_batch_id: batchId });
    if (e) { setError(e.message ?? String(e)); throw e; }
    // 0 rows means somebody else brought it back, or its thirty days are up.
    // Saying so is better than a silent no-op that looks like a broken button.
    if (Number(data ?? 0) === 0) {
      setError('Nothing to bring back - it may have been restored already, or its 30 days may be up.');
    }
    await load();
  }, [load]);

  return { rows, loading, error, reload: load, restore };
}

/** The contracts in one task, with each one's vendor name folded in. */
export function useBatchContracts(workspaceId: string | null, batchId: string | null) {
  const [rows, setRows] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId || !batchId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError('');
    // PAGED: a task is "add 200 vendors at a time" by design and nothing
    // caps how often that is repeated, so a batch can hold more than a page.
    const data = await selectAllRows<any>('useBatchContracts', () => legal().from('contract')
      .select('id, workspace_id, template_id, version_id, title, status, created_at, updated_at, pm_task_id, subtask_id, vendor_id, bank_account_id, contract_no, batch_id')
      .eq('batch_id', batchId).order('created_at', { ascending: true }).order('id'), setError);
    setRows(data as Contract[]);
    setLoading(false);
  }, [workspaceId, batchId]);

  useEffect(() => { void load(); }, [load]);
  return { rows, loading, error, reload: load };
}

/** The active brands of one client, for the task form's brand picker. */
export function useClientBrands(clientId: string | null) {
  const [brands, setBrands] = useState<{ id: string; brand_name: string }[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      if (!clientId) { if (live) setBrands([]); return; }
      const { data } = await createClient().from('client_brands')
        .select('id, brand_name, status').eq('client_id', clientId).order('brand_name');
      if (!live) return;
      setBrands(((data ?? []) as any[])
        .filter((b) => (b.status ?? 'active') === 'active')
        .map((b) => ({ id: String(b.id), brand_name: String(b.brand_name ?? '') })));
    })();
    return () => { live = false; };
  }, [clientId]);
  return brands;
}

export function useContractSources(contract: Contract | null) {
  const [brands, setBrands] = useState<{ id: string; brand_name: string }[]>([]);
  const [banks, setBanks] = useState<VendorBankAccount[]>([]);
  const [nonce, setNonce] = useState(0);
  const taskId = contract?.pm_task_id ?? null;
  const vendorId = contract?.vendor_id ?? null;

  useEffect(() => {
    let live = true;
    void (async () => {
      const pub = createClient();
      let nextBrands: { id: string; brand_name: string }[] = [];
      if (taskId) {
        const { data: t } = await pub.from('pm_tasks')
          .select('client_id').eq('id', taskId).maybeSingle();
        const clientId = (t as any)?.client_id ?? null;
        if (clientId) {
          const { data } = await pub.from('client_brands')
            .select('id, brand_name, status').eq('client_id', clientId).order('brand_name');
          nextBrands = ((data ?? []) as any[])
            .filter((b) => (b.status ?? 'active') === 'active')
            .map((b) => ({ id: String(b.id), brand_name: String(b.brand_name ?? '') }));
        }
      }
      let nextBanks: VendorBankAccount[] = [];
      if (vendorId != null) {
        const { data } = await pub.from('bank_accounts')
          .select('id, bank_name, account_name, account_number, iban')
          .eq('vendor_id', vendorId).order('id');
        nextBanks = ((data ?? []) as any[]) as VendorBankAccount[];
      }
      if (!live) return;
      setBrands(nextBrands);
      setBanks(nextBanks);
    })();
    return () => { live = false; };
  }, [taskId, vendorId, nonce]);

  // Bumped after adding an account, so the picker sees it without a reload.
  return { brands, banks, reload: () => setNonce((n) => n + 1) };
}

export function useContractEditor(workspaceId: string | null, contractId: string | null) {
  const [contract, setContract] = useState<Contract | null>(null);
  const [blocks, setBlocks] = useState<TemplateBlock[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const editable = contractEditable(contract?.status);

  const load = useCallback(async () => {
    if (!workspaceId || !contractId) { setLoading(false); return; }
    setLoading(true); setError('');
    const c = legal();
    const { data: ct, error: e0 } = await c.from('contract')
      .select('id, workspace_id, template_id, version_id, title, status, created_at, updated_at, pm_task_id, subtask_id, vendor_id, bank_account_id, contract_no, supersedes_id, supersede_reason, signed_path, signed_name, signed_bytes, signed_on, signed_recorded_at')
      .eq('id', contractId).single();
    if (e0) { setError(e0.message ?? String(e0)); setLoading(false); return; }
    setContract(ct as Contract);
    const { data: blks, error: e1 } = await c.from('doc_template_block')
      .select('id, version_id, workspace_id, position, block_type, content, optional, optional_group, optional_label, condition, clause_id')
      .eq('version_id', (ct as any).version_id).order('position');
    if (e1) { setError(e1.message ?? String(e1)); setLoading(false); return; }
    setBlocks(((blks ?? []) as any[]) as TemplateBlock[]);
    const { data: fvs } = await c.from('contract_field')
      .select('key, value').eq('contract_id', contractId);
    const map: Record<string, string> = {};
    for (const f of (fvs ?? []) as any[]) map[f.key] = f.value ?? '';
    setValues(map);
    setLoading(false);
  }, [workspaceId, contractId]);

  useEffect(() => { void load(); }, [load]);

  const setValue = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const guard = () => {
    if (!workspaceId || !contract) throw new Error('No contract loaded.');
    if (!contractEditable(contract.status)) throw new Error('This contract is issued and its fields are frozen.');
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e: any) { setError(e?.message ?? String(e)); throw e; } finally { setBusy(false); }
  };

  /**
   * Point this contract at a vendor, or at nobody.
   *
   * A contract raised from a booking already knows its vendor; one raised in
   * the Register does not, and the vendor is what makes the licence fields and
   * the IBAN list resolvable. Writing it on the contract rather than only into
   * the field values means the bank picker can reload for the new vendor and
   * the register can later say who a contract is with.
   *
   * Only while a draft: the guard is the same one the field writes use, and
   * the database refuses a field write on an issued contract anyway.
   */
  const setVendor = (vendorId: number | null) => run(async () => {
    guard();
    const { error: e } = await legal().from('contract')
      .update({ vendor_id: vendorId })
      .eq('id', contract!.id);
    if (e) throw e;
    setContract((c) => (c ? { ...c, vendor_id: vendorId } : c));
  });

  /** Upsert one row per field key with its current value. The reserved keys -
   *  the optional-clause choice and each table's rows - ride along whenever the
   *  operator has touched them. */
  const persist = async (keys: string[]) => {
    const reserved = Object.keys(values).filter(
      (k) => k === OPT_OFF_KEY || k.startsWith(TABLE_KEY_PREFIX),
    );
    const allKeys = [...new Set([...keys, ...reserved])];
    const rows = allKeys.map((k) => ({
      contract_id: contractId, workspace_id: workspaceId, key: k, value: values[k] ?? '',
    }));
    if (!rows.length) return;
    const { error: e } = await legal().from('contract_field').upsert(rows, { onConflict: 'contract_id,key' });
    if (e) throw e;
  };

  const saveAll = (keys: string[]) => run(async () => { guard(); await persist(keys); });

  /** Save the values, take the contract's number, stamp an integrity
   *  fingerprint, then move the contract to `issued` (fields freeze).
   *
   *  The order is load-bearing. The number has to be reserved before the
   *  fingerprint, so the sealed document covers the number it prints; and both
   *  have to be written while the contract is still a draft, because the freeze
   *  trigger (100_contracts.sql) refuses any field write the moment it is
   *  issued. reserve_contract_number writes the `id` field itself and is
   *  idempotent, so a retry after a failed issue re-uses the same number
   *  instead of burning another. */
  const issue = (keys: string[]) => run(async () => {
    guard();
    await persist(keys);
    const { data: noData, error: eN } = await legal().rpc('reserve_contract_number', {
      p_contract_id: contractId,
    });
    if (eN) throw eN;
    const contractNo = typeof noData === 'string' ? noData : null;
    const sealed = stampContractNumber(values, contractNo);
    const shown = visibleBlocks(blocks, parseOffIds(sealed[OPT_OFF_KEY]));
    const canonical = contractCanonical((contract as Contract).version_id, shown, sealed);
    const hash = await sha256Hex(canonical);
    const { error: eF } = await legal().from('contract_field').upsert([
      { contract_id: contractId, workspace_id: workspaceId, key: FINGERPRINT_KEY, value: hash },
      { contract_id: contractId, workspace_id: workspaceId, key: ISSUED_AT_KEY, value: new Date().toISOString() },
    ], { onConflict: 'contract_id,key' });
    if (eF) throw eF;
    const { error: e } = await legal().from('contract')
      .update({ status: 'issued' as ContractStatus }).eq('id', contractId);
    if (e) throw e;
    await load();
  });

  const rename = (title: string) => run(async () => {
    guard();
    const { error: e } = await legal().from('contract').update({ title: title.trim() }).eq('id', contractId);
    if (e) throw e;
    setContract((c) => (c ? { ...c, title: title.trim() } : c));
  });

  const fingerprint = values[FINGERPRINT_KEY] || null;
  const issuedAt = values[ISSUED_AT_KEY] || null;
  const offIds = parseOffIds(values[OPT_OFF_KEY]);

  /** Include (off=false) or exclude (off=true) an optional clause. */
  const toggleBlockOff = (id: string, off: boolean) => {
    const cur = new Set(offIds);
    if (off) cur.add(id); else cur.delete(id);
    setValue(OPT_OFF_KEY, serializeOffIds([...cur]));
  };

  return {
    contract, blocks, values, loading, error, busy, editable, fingerprint, issuedAt, offIds,
    setVendor,
    reload: load, setValue, saveAll, issue, rename, toggleBlockOff,
  };
}

/* ===================================================================
   The Legal Registry: matters, and their log.
   Schema in supabase/migrations/113_legal_matters.sql; the rules that
   decide how they read are in lib/legal-matters.ts.
   =================================================================== */

export interface MatterRow {
  id: string;
  workspace_id: string;
  title: string;
  party_type: 'client' | 'vendor';
  client_id: string | null;
  vendor_id: number | null;
  party_name: string;
  kind: string;
  status: string;
  amount: number | null;
  pm_task_id: string | null;
  contract_id: string | null;
  source_key: string | null;
  opened_at: string;
  closed_at: string | null;
  outcome: string;
}

const MATTER_COLS = 'id, workspace_id, title, party_type, client_id, vendor_id, party_name, '
  + 'kind, status, amount, pm_task_id, contract_id, source_key, opened_at, closed_at, outcome';

/**
 * Every matter in the workspace.
 *
 * Paged, unlike useContracts above, which still stops at a thousand: a matter
 * carries a status somebody is meant to act on, and one that fell off the end
 * of the first page would be a case nobody is working because the screen never
 * mentioned it. The order ends in `id` because offset paging needs a total
 * order - opened_at alone repeats, and two pages would overlap.
 *
 * `open` goes through legal.open_matter rather than an insert: the RPC is what
 * enforces the party rules and writes the opening log entry, and its
 * source_key is what stops the same derived warning being raised twice.
 */
export function useMatters(workspaceId: string | null) {
  const [matters, setMatters] = useState<MatterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setMatters([]); setLoading(false); return; }
    setLoading(true); setError('');
    const rows = await selectAllRows<any>(
      'legal.matter',
      () => legal().from('matter').select(MATTER_COLS)
        .eq('workspace_id', workspaceId)
        .order('opened_at', { ascending: false })
        .order('id', { ascending: false }),
      setError,
    );
    setMatters(rows.map((r) => ({
      ...r,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    })) as MatterRow[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const open = useCallback(async (input: {
    title: string;
    partyType: 'client' | 'vendor';
    partyName: string;
    clientId?: string | null;
    vendorId?: number | null;
    kind?: string;
    amount?: number | null;
    pmTaskId?: string | null;
    contractId?: string | null;
    sourceKey?: string | null;
  }): Promise<string> => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const { data, error: e } = await legal().rpc('open_matter', {
      p_workspace_id: workspaceId,
      p_title: input.title.trim(),
      p_party_type: input.partyType,
      p_party_name: input.partyName.trim(),
      p_client_id: input.clientId ?? null,
      p_vendor_id: input.vendorId ?? null,
      p_kind: input.kind ?? 'other',
      p_amount: input.amount ?? null,
      p_pm_task_id: input.pmTaskId ?? null,
      p_contract_id: input.contractId ?? null,
      p_source_key: input.sourceKey ?? null,
    });
    if (e) throw e;
    await load();
    return String(data);
  }, [workspaceId, load]);

  /**
   * Move a matter along the ladder. A plain update, not an RPC: the status
   * trail is a TRIGGER, so it holds however the row is changed, and closed_at
   * is stamped and cleared there too rather than here.
   */
  const setStatus = useCallback(async (id: string, status: string, outcome?: string) => {
    const patch: Record<string, unknown> = { status };
    if (outcome !== undefined) patch.outcome = outcome;
    const { error: e } = await legal().from('matter').update(patch).eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  const edit = useCallback(async (id: string, patch: {
    title?: string; kind?: string; amount?: number | null;
  }) => {
    const { error: e } = await legal().from('matter').update(patch).eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { error: e } = await legal().from('matter').delete().eq('id', id);
    if (e) throw e;
    await load();
  }, [load]);

  return { matters, loading, error, reload: load, open, setStatus, edit, remove };
}

export interface MatterEventRow {
  id: string;
  at: string;
  actor: string | null;
  kind: string;
  body: string;
  from_status: string | null;
  to_status: string | null;
  amount: number | null;
}

/**
 * One matter's log, newest first.
 *
 * Not paged: it is one case's history, and a case with a thousand entries is a
 * different problem from a list that silently truncates. `log` goes through
 * legal.log_matter_event, which refuses kind='status' - those are the
 * trigger's, and a hand-written one would be a status change that never
 * happened.
 */
export function useMatterEvents(matterId: string | null) {
  const [events, setEvents] = useState<MatterEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!matterId) { setEvents([]); setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error: e } = await legal().from('matter_event')
      .select('id, at, actor, kind, body, from_status, to_status, amount')
      .eq('matter_id', matterId)
      .order('at', { ascending: false })
      .order('id', { ascending: false });
    if (e) { setError(e.message ?? String(e)); setEvents([]); setLoading(false); return; }
    setEvents(((data ?? []) as any[]).map((r) => ({
      ...r,
      amount: r.amount === null || r.amount === undefined ? null : Number(r.amount),
    })) as MatterEventRow[]);
    setLoading(false);
  }, [matterId]);

  useEffect(() => { void load(); }, [load]);

  const log = useCallback(async (kind: string, body: string, amount?: number | null) => {
    if (!matterId) throw new Error('No matter open.');
    const { error: e } = await legal().rpc('log_matter_event', {
      p_matter_id: matterId,
      p_kind: kind,
      p_body: body.trim(),
      p_amount: amount ?? null,
      p_at: null,
    });
    if (e) throw e;
    await load();
  }, [matterId, load]);

  return { events, loading, error, reload: load, log };
}

/* ===================================================================
   Importing a Word file as a template.
   The parsing is in lib/legal-docx.ts and is pure; this is the half
   that touches the browser and the database. Schema in
   supabase/migrations/115_template_upload.sql.
   =================================================================== */

/**
 * Raw deflate, from the browser's own decompressor.
 *
 * DecompressionStream has been in every browser this app supports for years
 * and is in Node 18+, which is why lib/legal-docx.ts takes the inflater as an
 * argument instead of importing one: no JSZip, no pako, nothing to keep
 * up to date, and the suite can run the same code path under node.
 *
 * 'deflate-raw', not 'deflate': a zip entry carries no zlib header, and
 * asking for 'deflate' fails on the very first byte.
 */
async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot unpack a .docx. Try Chrome or Edge.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ParsedDocx {
  blocks: ImportedBlock[];
  summary: ImportSummary;
  /** Kept so the file can be stored only if the person actually saves. */
  file: File;
}

/**
 * Read a .docx and say what is in it - WITHOUT writing anything.
 *
 * Deliberately two steps. Siraj asked for the upload to be "as self
 * explanitary as posiible", and the screen can only explain what it found if
 * it has the answer before it commits to it. Nothing reaches the database, or
 * the bucket, until somebody has seen the summary and pressed save.
 */
export async function parseDocxFile(file: File): Promise<ParsedDocx> {
  if (!/\.docx$/i.test(file.name)) {
    throw new Error('That is not a .docx. A .doc from an old Word needs saving as .docx first.');
  }
  if (file.size > 8_000_000) {
    throw new Error('That file is over 8MB - a contract template should be a fraction of that.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xml = await readDocxFile(bytes, 'word/document.xml', inflateRaw);
  const blocks = docxToBlocks(xml);
  return { blocks, summary: summarise(blocks), file };
}

/**
 * Save a parsed document as a new template, its first draft version, and its
 * blocks - then keep the original file beside it.
 *
 * THE ORDER MATTERS. The template and its blocks are written FIRST and the
 * upload comes last, because a template with no copy of its Word file is
 * merely missing something, while a file in the bucket with no template is
 * rubbish nobody will ever find. If the upload fails the template still
 * stands and says so, which is what the half-upload CHECK in 115 is for.
 */
export async function saveImportedTemplate(input: {
  workspaceId: string;
  name: string;
  kind: DocKind;
  parsed: ParsedDocx;
}): Promise<string> {
  const c = legal();
  const { data: t, error: e1 } = await c.from('doc_template')
    .insert({ workspace_id: input.workspaceId, doc_kind: input.kind, name: input.name.trim() })
    .select('id').single();
  if (e1) throw e1;
  const templateId = (t as any).id as string;

  const { data: v, error: e2 } = await c.from('doc_template_version')
    .insert({ template_id: templateId, workspace_id: input.workspaceId, version: 1, status: 'draft' })
    .select('id').single();
  if (e2) throw e2;
  const versionId = (v as any).id as string;

  if (input.parsed.blocks.length) {
    // Positions are spaced, not 1..n, so a block can be dropped between two
    // others later without renumbering the whole document - the same spacing
    // nextPosition() uses.
    const rows = input.parsed.blocks.map((b, i) => ({
      version_id: versionId,
      workspace_id: input.workspaceId,
      position: (i + 1) * 10,
      block_type: b.block_type,
      content: b.content,
    }));
    const { error: e3 } = await c.from('doc_template_block').insert(rows);
    if (e3) throw e3;
  }

  // Last, and non-fatal: see the header.
  try {
    const f = input.parsed.file;
    const path = `${input.workspaceId}/${templateId}.docx`;
    const { error: up } = await (createClient() as unknown as SupabaseClient)
      .storage.from('legal-templates').upload(path, f, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true,
      });
    if (up) throw up;
    await c.from('doc_template').update({
      source_path: path,
      source_name: f.name,
      source_bytes: f.size,
      imported_at: new Date().toISOString(),
    }).eq('id', templateId);
  } catch {
    // The template is real and usable; it just has no copy of the original.
    // Swallowed on purpose - failing here would leave a good template behind
    // an error message and tempt somebody to import it a second time.
  }
  return templateId;
}

/** A signed link to the original Word file, good for one minute. */
export async function templateSourceUrl(path: string): Promise<string | null> {
  const { data } = await (createClient() as unknown as SupabaseClient)
    .storage.from('legal-templates').createSignedUrl(path, 60);
  return data?.signedUrl ?? null;
}

/**
 * Every contract's status, and nothing else, for the KPI strip on Cases.
 *
 * One narrow column over a paged read: the strip needs four counts, and
 * counting them here costs less than four round trips asking PostgREST for a
 * count each. Paged, because the number it reports would otherwise quietly
 * stop at a thousand - and a KPI that is wrong is worse than no KPI, because
 * nobody checks it twice. (useContracts is paged too now, for the same
 * reason; this one stays separate because it reads one column and the Cases
 * screen has no use for the rest.)
 */
export function useContractStatuses(workspaceId: string | null) {
  const [rows, setRows] = useState<{ status: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const data = await selectAllRows<{ status: string; id: string }>(
      'legal.contract statuses',
      () => legal().from('contract').select('id, status')
        .eq('workspace_id', workspaceId).order('id'),
    );
    setRows(data.map((r) => ({ status: r.status })));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);
  return { statuses: rows, loading, reload: load };
}

/**
 * Everything a batch of contracts needs to print, in two reads.
 *
 * Siraj asked for "all pdfs at once instead of going one by one", and the
 * naive way to do that is to run the fill screen's loader once per contract:
 * three round trips each, sixty contracts, a hundred and eighty requests and
 * a minute of staring. This reads the BLOCKS ONCE PER VERSION - fifty
 * contracts off one template is one read, not fifty - and every field value
 * for the whole selection in one more.
 *
 * Both are paged and both are chunked. Paged because a template with two
 * hundred blocks across six versions passes a thousand rows sooner than
 * anyone expects, and a print that silently drops the last clauses of an
 * agreement is the worst bug this screen could have. Chunked because a
 * hundred uuids in an `in(...)` is a two-kilobyte URL and PostgREST will not
 * always say why it refused.
 *
 * The assembling is pure and lives in lib/legal-bulk, so what the printer
 * receives is testable without a database.
 */
export async function loadContractPrintDocs(
  contracts: PrintContract[],
  onError?: (message: string) => void,
  /** The supersede arrows over the WHOLE workspace, so a replaced contract
   *  prints as replaced even when its correction is not in the selection.
   *  The Register derives them for free; see useSupersedeLinks for a screen
   *  that does not already hold every contract. */
  links?: SupersedeLinks,
): Promise<PrintBuild> {
  const list = contracts ?? [];
  if (!list.length) return { docs: [], skipped: [] };
  const c = legal();

  // Each read is written out where it pages, rather than through a shared
  // helper taking a builder. The helper version was tidier and tests/paging
  // rejected it, correctly: the rule is that a paged read ENDS ON .order('id')
  // at the call site, and a builder passed in from elsewhere hides the order
  // from the test and from anyone reading the line. The guard exists because
  // 22 of 39 call sites had got this wrong.
  const readBlocks = async () => {
    const out: TemplateBlock[] = [];
    for (const part of chunk(versionIdsOf(list), 60)) {
      out.push(...await selectAllRows<TemplateBlock>('loadContractPrintDocs blocks', () =>
        c.from('doc_template_block')
          .select('id, version_id, workspace_id, position, block_type, content, optional, optional_group, optional_label, condition, clause_id')
          .in('version_id', part).order('position').order('id'), onError));
    }
    return out;
  };
  const readFields = async () => {
    const out: FieldRow[] = [];
    for (const part of chunk(list.map((x) => x.id), 60)) {
      out.push(...await selectAllRows<FieldRow>('loadContractPrintDocs fields', () =>
        c.from('contract_field')
          .select('id, contract_id, key, value')
          .in('contract_id', part).order('id'), onError));
    }
    return out;
  };

  const [blocks, fields] = await Promise.all([readBlocks(), readFields()]);
  return buildPrintDocs({ contracts: list, blocks, fields, links });
}

/**
 * Raise a correction of an issued contract (migration 116).
 *
 * A NEW contract, stamped to the SAME template version, carrying the
 * original's values minus its seal and its number, pointing back at it with a
 * reason. The original is not touched at all - not its status, not its
 * number, not one field value. That is the whole point: nothing here needs
 * the freeze relaxed, and the seal on the original still verifies afterwards.
 *
 * THE VERSION IS DELIBERATELY THE SAME ONE. A correction corrects the facts -
 * a fee, an IBAN, a spelling. If the WORDING was wrong then the template was
 * wrong, and the honest answer is a new contract off the new version, not a
 * correction that quietly swaps the clauses out from under a number that
 * claims to replace the old one.
 *
 * The order is load-bearing, the same way issue() is. The row is inserted
 * first and its values written second, because the values need a contract to
 * hang on; and they are written while it is a draft, which it is, because the
 * freeze trigger refuses field writes on anything else. If the insert
 * succeeds and the copy fails, what is left is an empty draft correction that
 * can be deleted - not a half-corrected contract.
 */
export async function raiseCorrection(input: {
  workspaceId: string;
  original: Contract;
  reason: string;
  values: Record<string, string>;
}): Promise<string> {
  const err = validateSupersedeReason(input.reason);
  if (err) throw new Error(err);
  const o = input.original;
  const c = legal();

  const { data, error: e1 } = await c.from('contract').insert({
    workspace_id: input.workspaceId,
    template_id: o.template_id,
    version_id: o.version_id,
    title: correctionTitle(o.title),
    status: 'draft',
    // Carried so the correction knows who it is for and where the money goes.
    // A correction of a vendor's contract is still that vendor's contract.
    pm_task_id: o.pm_task_id ?? null,
    subtask_id: o.subtask_id ?? null,
    vendor_id: o.vendor_id ?? null,
    bank_account_id: o.bank_account_id ?? null,
    supersedes_id: o.id,
    supersede_reason: input.reason.trim(),
  }).select('id').single();
  if (e1) throw e1;
  const id = (data as any).id as string;

  const carried = carriedValues(input.values);
  const rows = Object.entries(carried).map(([key, value]) => ({
    contract_id: id, workspace_id: input.workspaceId, key, value,
  }));
  if (rows.length) {
    const { error: e2 } = await c.from('contract_field').insert(rows);
    if (e2) throw e2;
  }
  return id;
}

/**
 * The supersede arrows for a workspace, for a screen that holds one contract
 * rather than the whole register.
 *
 * Two narrow reads. The first is every CORRECTION - `supersedes_id is not
 * null` - which is a handful of rows in a register of thousands, because
 * correcting a contract is rare and always will be. The second is the
 * contracts those point at, so a correction can name what it replaces.
 *
 * It has to be the whole workspace, not the contract on screen and its
 * neighbours. The dangerous case is printing ONE old contract on its own: if
 * its correction is not in the data, the page comes out looking like the
 * current agreement. The Register needs none of this - it already holds every
 * contract and builds the same links locally with supersedeLinks.
 */
export function useSupersedeLinks(workspaceId: string | null) {
  const [links, setLinks] = useState<SupersedeLinks>({ correctionOf: {}, replaces: {} });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!workspaceId) { setLinks({ correctionOf: {}, replaces: {} }); setLoading(false); return; }
    setLoading(true);
    const c = legal();
    const corrections = await selectAllRows<SupersedeContract>('legal supersede corrections', () =>
      c.from('contract').select('id, title, status, contract_no, supersedes_id, supersede_reason')
        .eq('workspace_id', workspaceId)
        .not('supersedes_id', 'is', null)
        .order('id'));
    const targets: SupersedeContract[] = [];
    const ids = [...new Set(corrections.map((x) => String(x.supersedes_id ?? '')).filter(Boolean))];
    for (const part of chunk(ids, 60)) {
      targets.push(...await selectAllRows<SupersedeContract>('legal supersede targets', () =>
        c.from('contract').select('id, title, status, contract_no, supersedes_id, supersede_reason')
          .in('id', part).order('id')));
    }
    setLinks(supersedeLinks([...targets, ...corrections]));
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);
  return { links, loading, reload: load };
}

/**
 * File the signed counterpart against a contract (migration 117).
 *
 * The order is the same shape as every other two-step write in this file, and
 * for the same reason. The BYTES GO FIRST, then the row. If the upload
 * succeeds and the row update fails, what is left is an orphaned object in a
 * private bucket that nobody sees - recoverable, and costing nothing. The
 * other order would leave a contract marked `signed` pointing at a file that
 * does not exist, which is the state somebody discovers in a dispute.
 *
 * 117 does the rest: the CHECK refuses a status without a file or a file
 * without the status, and the trigger refuses anything that was not issued
 * and stamps when it was filed.
 *
 * `upsert: false` on purpose. The path carries a random segment, so a
 * collision means something is wrong rather than something needs replacing.
 */
export async function fileSignedCopy(input: {
  workspaceId: string;
  contract: Contract;
  file: File;
  /** The date written on the document, when she knows it. Not the upload day. */
  signedOn?: string | null;
}): Promise<void> {
  const blocked = cannotFileSigned(input.contract as any);
  if (blocked) throw new Error(blocked);
  const bad = validateSignedFile({ name: input.file.name, size: input.file.size });
  if (bad) throw new Error(bad);

  const sb = createClient() as unknown as SupabaseClient;
  const path = signedStoragePath(
    input.workspaceId, input.contract.id, input.file.name,
    (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).replace(/-/g, '').slice(0, 10),
  );

  const { error: eU } = await sb.storage.from(SIGNED_BUCKET).upload(path, input.file, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  });
  if (eU) throw new Error(`Could not upload the signed copy: ${eU.message}`);

  const { data: who } = await sb.auth.getUser();
  const { error: eR } = await legal().from('contract').update({
    status: 'signed',
    signed_path: path,
    signed_name: input.file.name,
    signed_bytes: input.file.size,
    signed_on: input.signedOn || null,
    signed_by: who?.user?.id ?? null,
  }).eq('id', input.contract.id);
  if (eR) {
    // Take the orphan back out rather than leaving it. Best effort: if this
    // fails too, the object is invisible in a private bucket and the contract
    // is correctly still `issued`, which is the safe half of the pair.
    await sb.storage.from(SIGNED_BUCKET).remove([path]).catch(() => {});
    throw eR;
  }
}

/**
 * Take the signed copy back off.
 *
 * The ROW goes first here, which is the mirror of filing and the same rule:
 * end on the state that is safe to be wrong. Clearing the row drops the
 * contract back to `issued` (117's trigger), so if the storage delete then
 * fails, what is left is an unreferenced object nobody can reach - not a
 * contract marked signed whose file has been deleted.
 */
export async function removeSignedCopy(contract: Contract): Promise<void> {
  const path = String((contract as any)?.signed_path ?? '');
  const { error } = await legal().from('contract')
    .update({ status: 'issued', signed_path: null }).eq('id', contract.id);
  if (error) throw error;
  if (path) {
    await (createClient() as unknown as SupabaseClient)
      .storage.from(SIGNED_BUCKET).remove([path]).catch(() => {});
  }
}

/** A short-lived link to the signed copy, named so the download is called
 *  what she uploaded. The bucket is private; nothing is ever public. */
export async function signedCopyUrl(path: string, fileName?: string | null): Promise<string | null> {
  const { data } = await (createClient() as unknown as SupabaseClient)
    .storage.from(SIGNED_BUCKET)
    .createSignedUrl(path, 60, fileName ? { download: fileName } : undefined);
  return data?.signedUrl ?? null;
}

/* ===================================================================
   AGREEMENTS THAT WERE NEVER MADE IN THIS APP (migration 118)
   =================================================================== */

/**
 * The filed outside agreements for a workspace.
 *
 * Paged and ordered on a total order, like every other read on this screen:
 * a filing cabinet that silently stops at a thousand is a filing cabinet
 * nobody can trust to be complete, which is the only reason it exists.
 *
 * The ORDER is decided in lib/legal-external, not here. This read returns
 * them newest first because that is a total order the database can give
 * cheaply; sortExternal then puts whatever has expired at the top, which is
 * a question about today and so belongs in a pure function that takes today
 * as an argument.
 */
export function useExternalDocs(workspaceId: string | null) {
  const [docs, setDocs] = useState<ExternalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) { setDocs([]); setLoading(false); return; }
    setLoading(true); setError('');
    const rows = await selectAllRows<ExternalDoc>('useExternalDocs', () =>
      legal().from('external_doc')
        .select('id, workspace_id, title, doc_kind, party_name, reference, signed_on, expires_on, notes, file_path, file_name, file_bytes, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .order('id'), (m) => setError(m));
    setDocs(rows);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  /**
   * File one. The ROW goes in first here, and that is the opposite of
   * fileSignedCopy - deliberately.
   *
   * A signed counterpart hangs off a contract that already exists, so the
   * bytes can go first and an orphaned object is the safe failure. An
   * external document has no row until we make one, and its storage path is
   * keyed BY that row's id - so the id has to exist before the file can be
   * named. The insert therefore goes first with a placeholder path, then the
   * upload, then the real path.
   *
   * If the upload fails, the half-made row is DELETED rather than left
   * behind: the table's own rule is that the document is the record, and a
   * row pointing at a file that was never written is exactly the thing that
   * rule exists to prevent.
   */
  const file = useCallback(async (input: {
    title: string; doc_kind: string; party_name?: string; reference?: string;
    signed_on?: string | null; expires_on?: string | null; notes?: string;
    fileObj: File;
  }): Promise<string> => {
    if (!workspaceId) throw new Error('No workspace selected.');
    const bad = validateExternalDoc(input) ?? validateExternalFile({
      name: input.fileObj.name, size: input.fileObj.size,
    });
    if (bad) throw new Error(bad);

    const sb = createClient() as unknown as SupabaseClient;
    const { data: who } = await sb.auth.getUser();
    const { data: row, error: e1 } = await legal().from('external_doc').insert({
      workspace_id: workspaceId,
      title: input.title.trim(),
      doc_kind: input.doc_kind,
      party_name: (input.party_name ?? '').trim(),
      reference: (input.reference ?? '').trim() || null,
      signed_on: input.signed_on || null,
      expires_on: input.expires_on || null,
      notes: (input.notes ?? '').trim(),
      // A placeholder that satisfies the NOT NULL and the non-blank CHECK
      // for the moment between the insert and the upload. It is replaced
      // below, and the row is deleted if the upload fails, so nothing ever
      // observes it.
      file_path: 'pending', file_name: input.fileObj.name,
      file_bytes: input.fileObj.size,
      created_by: who?.user?.id ?? null,
    }).select('id').single();
    if (e1) throw e1;
    const id = (row as any).id as string;

    try {
      const path = externalStoragePath(
        workspaceId, id, input.fileObj.name,
        (globalThis.crypto?.randomUUID?.() ?? String(Math.random())).replace(/-/g, '').slice(0, 10),
      );
      const { error: eU } = await sb.storage.from(SIGNED_BUCKET).upload(path, input.fileObj, {
        contentType: input.fileObj.type || 'application/octet-stream', upsert: false,
      });
      if (eU) throw new Error(`Could not upload the document: ${eU.message}`);
      const { error: e2 } = await legal().from('external_doc')
        .update({ file_path: path }).eq('id', id);
      if (e2) throw e2;
    } catch (err) {
      await legal().from('external_doc').delete().eq('id', id);
      throw err;
    }
    await load();
    return id;
  }, [workspaceId, load]);

  /** Remove one, file and all. The row goes first for the same reason it does
   *  on a signed copy: an unreferenced object nobody can reach is a better
   *  failure than a row pointing at a file that has been deleted. */
  const remove = useCallback(async (doc: ExternalDoc) => {
    const { error: e } = await legal().from('external_doc').delete().eq('id', doc.id);
    if (e) throw e;
    const path = String(doc?.file_path ?? '');
    if (path && path !== 'pending') {
      await (createClient() as unknown as SupabaseClient)
        .storage.from(SIGNED_BUCKET).remove([path]).catch(() => {});
    }
    await load();
  }, [load]);

  return { docs, loading, error, reload: load, file, remove };
}
