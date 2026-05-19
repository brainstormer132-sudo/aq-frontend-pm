'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

const supabase = createClient();

/** Pretty-print a Supabase / PostgrestError so it doesn't show up as `{}`. */
function logSbError(label: string, err: any, ctx?: Record<string, unknown>) {
  if (!err) return;
  const detail = {
    message: err.message ?? null,
    code:    err.code ?? null,
    details: err.details ?? null,
    hint:    err.hint ?? null,
    status:  err.status ?? null,
  };
  // Console gets the structured object; alert gets the gist.
  // eslint-disable-next-line no-console
  console.error(label, detail, ctx ?? {});
}

// ============================================================
// Types matching the Phase 1 schema (006_role_workflow.sql)
// ============================================================

export type TaskStage = 'draft' | 'pending_marketing' | 'in_progress' | 'awaiting_review' | 'completed';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type WorkspaceRole = 'owner' | 'admin' | 'operations' | 'sales' | 'marketing' | 'key_account' | 'member';

export interface ServiceType {
  id: string;
  workspace_id: string | null;
  name: string;
  icon: string | null;
  description: string | null;
  is_template: boolean;
  position: number;
}

export interface ServiceTypeStep {
  id: string;
  service_type_id: string;
  position: number;
  title: string;
  description: string | null;
}

export interface PMTask {
  id: string;
  workspace_id: string | null;
  project_id: string | null;
  parent_task_id: string | null;
  task_name: string | null;
  brand_name: string | null;
  legacy_client_id: string | null;
  // FK to public.clients (set by NewTaskForm picker, may be null on legacy rows).
  client_id: string | null;
  // FK to public.client_brands (set by NewTaskForm picker).
  brand_id: string | null;
  sales_closer_id: string | null;
  key_account_id: string | null;
  service_type_id: string | null;
  budget: number | null;
  stage: TaskStage;
  status: string;
  priority: TaskPriority;
  title: string;
  description: string | null;
  assignee_id: string | null;
  creator_id: string;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Per-subtask vendor (added in migration 011). FK to public.vendors.
  vendor_id: number | null;
  // Auto-set when the subtask spawns a contract request (migration 011).
  contract_request_id: string | null;
}

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

// ============================================================
// Hooks
// ============================================================

/** Current user's role in the active workspace. Null while loading. */
export function useMyRole(workspaceId: string | null) {
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setRole(null); setLoading(false); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRole(null); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) { logSbError('useMyRole', error, { workspaceId }); }
    setRole((data?.role as WorkspaceRole) ?? null);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { role, loading, refetch: fetch };
}

/** Service-type templates and any workspace-custom ones, with their steps. */
export function useServiceTypes(workspaceId: string | null) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [steps, setSteps] = useState<ServiceTypeStep[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    // Templates (workspace_id NULL) + this workspace's customs
    let query = supabase.from('service_types').select('*').order('position', { ascending: true });
    const { data: types, error } = await query;
    if (error) logSbError('useServiceTypes types', error, { workspaceId });
    const filtered = (types || []).filter((t: any) => t.workspace_id === null || t.workspace_id === workspaceId);
    setServiceTypes(filtered as ServiceType[]);

    if (filtered.length) {
      const { data: stepRows, error: stepErr } = await supabase
        .from('service_type_steps')
        .select('*')
        .in('service_type_id', filtered.map((t: any) => t.id))
        .order('position', { ascending: true });
      if (stepErr) logSbError('useServiceTypes steps', stepErr, { workspaceId });
      setSteps((stepRows || []) as ServiceTypeStep[]);
    } else {
      setSteps([]);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { serviceTypes, steps, loading, refetch: fetch };
}

/** Workspace members (for sales closer / key account / assignee dropdowns). */
export function useWorkspaceProfiles(workspaceId: string | null) {
  const [profiles, setProfiles] = useState<(Profile & { role: WorkspaceRole })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setProfiles([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('role, profile:profiles(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId);
    if (error) logSbError('useWorkspaceProfiles', error, { workspaceId });
    const out = (data || [])
      .filter((m: any) => m.profile)
      .map((m: any) => ({ ...m.profile, role: m.role as WorkspaceRole }));
    setProfiles(out);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { profiles, loading, refetch: fetch };
}

/** Workflow tasks in a workspace, optionally filtered by stage. */
export function useWorkflowTasks(workspaceId: string | null, stage?: TaskStage | 'all') {
  const [tasks, setTasks] = useState<PMTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setTasks([]); setLoading(false); return; }
    let query = supabase.from('pm_tasks').select('*').eq('workspace_id', workspaceId).is('parent_task_id', null);
    if (stage && stage !== 'all') query = query.eq('stage', stage);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) logSbError('useWorkflowTasks', error, { workspaceId, stage });
    setTasks((data || []) as PMTask[]);
    setLoading(false);
  }, [workspaceId, stage]);

  useEffect(() => { fetch(); }, [fetch]);
  return { tasks, loading, refetch: fetch };
}

/** Subtasks (child rows) for a parent task. */
export function useTaskSubtasks(parentTaskId: string | null) {
  const [subtasks, setSubtasks] = useState<PMTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!parentTaskId) { setSubtasks([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pm_tasks')
      .select('*')
      .eq('parent_task_id', parentTaskId)
      .order('position', { ascending: true });
    if (error) logSbError('useTaskSubtasks', error, { parentTaskId });
    setSubtasks((data || []) as PMTask[]);
    setLoading(false);
  }, [parentTaskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { subtasks, loading, refetch: fetch };
}

// ============================================================
// Mutations
// ============================================================

/** Sales: create a new task. Sets stage = pending_marketing — triggers
 * the on_pm_task_stage_change DB trigger which notifies marketing. */
export async function createSalesTask(input: {
  workspace_id: string;
  task_name: string;
  brand_name: string;
  /** Legacy text identifier kept for compat with the contract maker. */
  legacy_client_id?: string | null;
  /** FK to public.clients.id — set by the new dropdown picker. */
  client_id?: string | null;
  /** FK to public.client_brands.id — set by the new dropdown picker. */
  brand_id?: string | null;
  sales_closer_id?: string | null;
  budget?: number | null;
  details?: string | null;
  creator_id: string;
}) {
  const { data, error } = await supabase
    .from('pm_tasks')
    .insert({
      workspace_id: input.workspace_id,
      title: input.task_name,
      task_name: input.task_name,
      brand_name: input.brand_name,
      legacy_client_id: input.legacy_client_id ?? null,
      client_id: input.client_id ?? null,
      brand_id: input.brand_id ?? null,
      sales_closer_id: input.sales_closer_id ?? null,
      budget: input.budget ?? null,
      description: input.details ?? null,
      creator_id: input.creator_id,
      stage: 'pending_marketing',
      status: 'todo',
    })
    .select()
    .single();
  if (error) throw error;
  return data as PMTask;
}

/** Marketing: triage. Set priority + service types + key_account, advance stage,
 * and auto-spawn one child task per service-type step (across ALL chosen services).
 * If `selected_step_ids` is provided, only those steps are spawned. Otherwise all steps. */
export async function triageMarketingTask(input: {
  task_id: string;
  workspace_id: string;
  priority: TaskPriority;
  service_type_ids: string[];
  key_account_id: string;
  creator_id: string;
  selected_step_ids?: string[] | null;
}) {
  if (!input.service_type_ids.length) {
    throw new Error('Pick at least one service type.');
  }

  // 1. Update the parent task. Keep service_type_id pointing at the first one
  //    for backward compat with anything still reading the single column.
  const { error: updateErr } = await supabase
    .from('pm_tasks')
    .update({
      priority: input.priority,
      service_type_id: input.service_type_ids[0],
      key_account_id: input.key_account_id,
      stage: 'in_progress',
    })
    .eq('id', input.task_id);
  if (updateErr) throw updateErr;

  // 2. Replace junction rows.
  await supabase.from('task_service_types').delete().eq('task_id', input.task_id);
  const junctionRows = input.service_type_ids.map((id, idx) => ({
    task_id: input.task_id,
    service_type_id: id,
    position: idx,
  }));
  const { error: jErr } = await supabase.from('task_service_types').insert(junctionRows);
  if (jErr) throw jErr;

  // 3. For each service type, fetch its steps and spawn child tasks. Prefix each
  //    title with the service-type label so the inbox shows "Campaign — Visuals".
  //    If selected_step_ids is provided, only spawn those specific steps.
  const filterByIds = input.selected_step_ids && input.selected_step_ids.length > 0;
  const selectedSet = filterByIds ? new Set(input.selected_step_ids) : null;

  for (const stId of input.service_type_ids) {
    const { data: steps, error: stepsErr } = await supabase
      .from('service_type_steps')
      .select('*')
      .eq('service_type_id', stId)
      .order('position', { ascending: true });
    if (stepsErr) throw stepsErr;
    if (!steps || !steps.length) continue;

    // Filter steps if the caller specified which ones to include.
    const filteredSteps = selectedSet
      ? steps.filter((s: any) => selectedSet.has(s.id))
      : steps;
    if (!filteredSteps.length) continue;

    const { data: stMeta } = await supabase
      .from('service_types')
      .select('name, icon')
      .eq('id', stId)
      .maybeSingle();
    const prefix = stMeta ? `${stMeta.icon ?? ''} ${stMeta.name} — ` : '';

    const rows = filteredSteps.map((s: any) => ({
      workspace_id: input.workspace_id,
      parent_task_id: input.task_id,
      title: `${prefix}${s.title}`,
      description: s.description ?? null,
      position: s.position,
      stage: 'in_progress' as TaskStage,
      status: 'todo',
      priority: input.priority,
      creator_id: input.creator_id,
    }));
    const { error: insertErr } = await supabase.from('pm_tasks').insert(rows);
    if (insertErr) throw insertErr;
  }
}

/** Member / key account: update a task (status / completed / etc). */
export async function updateTaskFields(taskId: string, fields: Partial<PMTask>) {
  const { error } = await supabase.from('pm_tasks').update(fields).eq('id', taskId);
  if (error) throw error;
}

/** Hard-delete a task. Cascades to subtasks via the FK. */
export async function deleteTask(taskId: string) {
  const { error } = await supabase.from('pm_tasks').delete().eq('id', taskId);
  if (error) throw error;
}

/** Key account / admin: mark a task complete. Stage flips to `completed`,
 *  which fires the DB trigger that notifies marketing. */
export async function markTaskCompleted(taskId: string) {
  const { error } = await supabase
    .from('pm_tasks')
    .update({
      status: 'done',
      stage: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', taskId);
  if (error) throw error;
}

// ============================================================
// Single-task + relations
// ============================================================

export function useTask(taskId: string | null) {
  const [task, setTask] = useState<PMTask | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setTask(null); setLoading(false); return; }
    const { data, error } = await supabase
      .from('pm_tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) logSbError('useTask', error, { taskId });
    setTask((data as PMTask | null) ?? null);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { task, loading, refetch: fetch };
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  content: string;
  created_at: string;
  author?: Profile;
}

export function useTaskComments(taskId: string | null) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setComments([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles(id, full_name, avatar_url)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) logSbError('useTaskComments', error, { taskId });
    setComments((data || []) as TaskComment[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { comments, loading, refetch: fetch };
}

export async function addComment(taskId: string, authorId: string, content: string) {
  const { error } = await supabase
    .from('comments')
    .insert({ task_id: taskId, author_id: authorId, content });
  if (error) throw error;
}

export async function deleteComment(commentId: string) {
  const { error } = await supabase.from('comments').delete().eq('id', commentId);
  if (error) throw error;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploader_id: string | null;
  filename: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export function useTaskAttachments(taskId: string | null) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setAttachments([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) logSbError('useTaskAttachments', error, { taskId });
    setAttachments((data || []) as TaskAttachment[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { attachments, loading, refetch: fetch };
}

/** Add an attachment by URL (Drive, Dropbox, paste, etc). */
export async function addAttachmentLink(input: {
  task_id: string;
  uploader_id: string;
  filename: string;
  file_url: string;
  mime_type?: string | null;
}) {
  const { error } = await supabase.from('task_attachments').insert({
    task_id: input.task_id,
    uploader_id: input.uploader_id,
    filename: input.filename,
    file_url: input.file_url,
    mime_type: input.mime_type ?? null,
  });
  if (error) throw error;
}

/**
 * Upload a real file to Supabase Storage (bucket `task-files`) and create
 * the matching `task_attachments` row.
 *
 * Path convention: `{workspace_id}/{task_id}/{uuid}-{originalFilename}` —
 * the leading workspace_id is what the storage RLS policies key on, so a
 * member of one workspace can never read/write another workspace's files.
 */
export async function uploadTaskAttachment(input: {
  file: File;
  task_id: string;
  uploader_id: string;
  workspace_id: string;
}) {
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const uid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const path = `${input.workspace_id}/${input.task_id}/${uid}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from('task-files')
    .upload(path, input.file, {
      cacheControl: '3600',
      upsert: false,
      contentType: input.file.type || undefined,
    });
  if (upErr) throw upErr;

  // Store the storage path in `file_url`. We sign download URLs at click time.
  const { error: insErr } = await supabase.from('task_attachments').insert({
    task_id: input.task_id,
    uploader_id: input.uploader_id,
    filename: input.file.name,
    file_url: path,
    file_size: input.file.size,
    mime_type: input.file.type || null,
  });
  if (insErr) {
    // Best-effort cleanup if metadata insert fails after upload succeeded.
    await supabase.storage.from('task-files').remove([path]).catch(() => {});
    throw insErr;
  }
}

/**
 * Get a temporary download URL for a stored file. Storage rows store the
 * `file_url` column as either:
 *   - a Supabase Storage path (no leading slash, no http) — sign on demand
 *   - or an external http(s) URL (legacy `addAttachmentLink` rows) — return as-is
 */
export async function getAttachmentDownloadUrl(
  fileUrl: string,
  expiresInSeconds = 60 * 5,
): Promise<string> {
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
  const { data, error } = await supabase.storage
    .from('task-files')
    .createSignedUrl(fileUrl, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteAttachment(id: string) {
  // Look up the row first so we know what to remove from Storage too.
  const { data: row, error: fetchErr } = await supabase
    .from('task_attachments')
    .select('file_url')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const { error } = await supabase.from('task_attachments').delete().eq('id', id);
  if (error) throw error;

  // Best-effort: if the file_url is a storage path (not an external URL),
  // also remove the bytes. Failure here is non-fatal — RLS/cleanup policies
  // will catch any orphans.
  if (row?.file_url && !/^https?:\/\//i.test(row.file_url)) {
    await supabase.storage.from('task-files').remove([row.file_url]).catch(() => {});
  }
}

// ============================================================
// Notifications
// ============================================================

export interface AppNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export function useNotifications(opts: { pollMs?: number } = {}) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) logSbError('useNotifications', error);
    setItems((data || []) as AppNotification[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch();
    if (opts.pollMs && opts.pollMs > 0) {
      const id = setInterval(fetch, opts.pollMs);
      return () => clearInterval(id);
    }
  }, [fetch, opts.pollMs]);

  const unreadCount = items.filter((n) => !n.read).length;
  return { items, unreadCount, loading, refetch: fetch };
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
  if (error) throw error;
}
export async function markAllNotificationsRead() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', user.id)
    .eq('read', false);
  if (error) throw error;
}

// ============================================================
// Stats / activity / member assignment / role mutations
// ============================================================

export interface WorkspaceStats {
  total: number;
  completed: number;
  pendingMarketing: number;
  inProgress: number;
  overdue: number;
  dueToday: number;
  mine: number;
}

export function useWorkspaceStats(workspaceId: string | null, userId: string | null) {
  const [stats, setStats] = useState<WorkspaceStats>({
    total: 0, completed: 0, pendingMarketing: 0, inProgress: 0,
    overdue: 0, dueToday: 0, mine: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setLoading(false); return; }
    setLoading(true);
    // One round-trip — pull all parent tasks + a count subset, derive client-side.
    const { data, error } = await supabase
      .from('pm_tasks')
      .select('id, stage, status, due_date, completed_at, assignee_id, key_account_id, creator_id, parent_task_id')
      .eq('workspace_id', workspaceId);
    if (error) { logSbError('useWorkspaceStats', error, { workspaceId }); setLoading(false); return; }
    const rows = (data || []) as any[];
    const today = new Date().toISOString().slice(0, 10);
    const parents = rows.filter((r) => !r.parent_task_id);
    const isMine = (r: any) => userId && (r.assignee_id === userId || r.key_account_id === userId || r.creator_id === userId);
    const next: WorkspaceStats = {
      total: parents.length,
      completed: parents.filter((r) => r.stage === 'completed').length,
      pendingMarketing: parents.filter((r) => r.stage === 'pending_marketing').length,
      inProgress: parents.filter((r) => r.stage === 'in_progress').length,
      overdue: rows.filter((r) => r.due_date && r.due_date < today && r.status !== 'done').length,
      dueToday: rows.filter((r) => r.due_date === today && r.status !== 'done').length,
      mine: rows.filter(isMine).length,
    };
    setStats(next);
    setLoading(false);
  }, [workspaceId, userId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { stats, loading, refetch: fetch };
}

export interface ActivityRow {
  id: string;
  workspace_id: string;
  task_id: string | null;
  user_id: string;
  action: string;
  details: any;
  created_at: string;
}

export function useRecentActivity(workspaceId: string | null, limit = 10) {
  const [items, setItems] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('activity_log')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) logSbError('useRecentActivity', error);
    setItems((data || []) as ActivityRow[]);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/** Counts of tasks assigned per member in a workspace (parent + child both count). */
export function useTaskCountsByMember(workspaceId: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setCounts({}); setLoading(false); return; }
    const { data: a } = await supabase
      .from('pm_tasks').select('assignee_id').eq('workspace_id', workspaceId).neq('status', 'done');
    const { data: tm } = await supabase
      .from('task_members')
      .select('user_id, task:pm_tasks!inner(workspace_id, status)')
      .eq('task.workspace_id', workspaceId);
    const c: Record<string, number> = {};
    for (const r of (a || []) as any[]) if (r.assignee_id) c[r.assignee_id] = (c[r.assignee_id] ?? 0) + 1;
    for (const r of (tm || []) as any[]) {
      if (r.task?.status !== 'done' && r.user_id) c[r.user_id] = (c[r.user_id] ?? 0) + 1;
    }
    setCounts(c);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { counts, loading, refetch: fetch };
}

/** Members on a single task. */
export interface TaskMember {
  id: string;
  task_id: string;
  user_id: string;
  added_by: string | null;
  role: string;
  added_at: string;
  user?: Profile;
}
export function useTaskMembers(taskId: string | null) {
  const [members, setMembers] = useState<TaskMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setMembers([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_members')
      .select('*, user:profiles!task_members_user_id_fkey(id, full_name, avatar_url)')
      .eq('task_id', taskId);
    if (error) logSbError('useTaskMembers', error, { taskId });
    setMembers((data || []) as TaskMember[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { members, loading, refetch: fetch };
}

export async function addTaskMember(taskId: string, userId: string, addedBy: string, role = 'collaborator') {
  const { error } = await supabase
    .from('task_members')
    .insert({ task_id: taskId, user_id: userId, added_by: addedBy, role });
  if (error) throw error;
}
export async function removeTaskMember(membershipId: string) {
  const { error } = await supabase.from('task_members').delete().eq('id', membershipId);
  if (error) throw error;
}

/** Admin: change someone's role in the workspace. */
export async function setWorkspaceMemberRole(membershipId: string, role: WorkspaceRole) {
  const { error } = await supabase
    .from('workspace_members')
    .update({ role })
    .eq('id', membershipId);
  if (error) throw error;
}

/** All workspace_members rows with profile info (used by Settings team panel). */
export interface WorkspaceMemberRow {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  joined_at: string;
  profile?: Profile;
}
export function useWorkspaceMembers(workspaceId: string | null) {
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setMembers([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_members')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId);
    if (error) logSbError('useWorkspaceMembers', error, { workspaceId });
    setMembers((data || []) as WorkspaceMemberRow[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { members, loading, refetch: fetch };
}

export interface WorkspaceInviteRow {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  resend_count: number;
  last_resent_at: string | null;
  inviter?: Profile | null;
}

export function useWorkspaceInvites(workspaceId: string | null) {
  const [invites, setInvites] = useState<WorkspaceInviteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setInvites([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('workspace_invites')
      .select('*, inviter:profiles!workspace_invites_invited_by_fkey(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) logSbError('useWorkspaceInvites', error, { workspaceId });
    setInvites((data || []) as WorkspaceInviteRow[]);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { invites, loading, refetch: fetch };
}

export interface InviteEventRow {
  id: string;
  invite_id: string | null;
  workspace_id: string;
  invite_email: string;
  invite_role: WorkspaceRole;
  action:
    | 'created'
    | 'resent'
    | 'accepted'
    | 'revoked'
    | 'expired'
    | 'role_changed'
    | 'resend_failed';
  actor_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  actor?: Profile | null;
}

export function useInviteEvents(workspaceId: string | null, limit = 25) {
  const [events, setEvents] = useState<InviteEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setEvents([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('invite_events')
      .select('*, actor:profiles!invite_events_actor_id_fkey(id, full_name, avatar_url)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) logSbError('useInviteEvents', error, { workspaceId });
    setEvents((data || []) as InviteEventRow[]);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { events, loading, refetch: fetch };
}

export async function createWorkspaceInvite(
  workspaceId: string,
  email: string,
  role: WorkspaceRole,
  expiresHours: 1 | 12 | 24,
) {
  const { data, error } = await supabase
    .rpc('create_workspace_invite', {
      ws_id: workspaceId,
      invite_email: email,
      invite_role: role,
      expires_hours: expiresHours,
    });
  if (error) throw error;
  return (data?.[0] || data) as {
    id: string;
    token: string;
    email: string;
    role: WorkspaceRole;
    expires_at: string;
  };
}

export async function deleteWorkspaceInvite(inviteId: string) {
  const { error } = await supabase
    .from('workspace_invites')
    .delete()
    .eq('id', inviteId);
  if (error) throw error;
}

export async function deleteExpiredWorkspaceInvites(workspaceId: string) {
  const { error } = await supabase
    .from('workspace_invites')
    .delete()
    .eq('workspace_id', workspaceId)
    .is('accepted_at', null)
    .lt('expires_at', new Date().toISOString());
  if (error) throw error;
}

/**
 * Records that we are about to resend an invite. The DB enforces a 60-second
 * cooldown per invite and increments resend_count. Throws if cooldown is
 * still active, the invite is accepted, or the invite is expired.
 */
export async function recordInviteResend(inviteId: string) {
  const { data, error } = await supabase.rpc('record_invite_resend', {
    invite_id: inviteId,
  });
  if (error) throw error;
  return (data?.[0] || data) as {
    resend_count: number;
    last_resent_at: string;
    cooldown_remaining_seconds: number;
  };
}

/**
 * Logs that a resend attempt failed (e.g., the email provider rejected it).
 * The cooldown window has already been consumed by recordInviteResend, so
 * the admin can fix the issue and try again after 60 seconds.
 */
export async function recordInviteResendFailure(inviteId: string, reason: string) {
  const { error } = await supabase.rpc('record_invite_resend_failure', {
    invite_id: inviteId,
    reason,
  });
  if (error) throw error;
}

// ============================================================
// Contract requests + clients + vendors
// ============================================================

export type ContractKind = 'client' | 'vendor';
export type ContractRequestStatus = 'pending' | 'approved' | 'generated' | 'rejected' | 'cancelled';

export interface ContractRequest {
  id: string;
  pm_task_id: string | null;
  workspace_id: string;
  requested_by: string;
  request_kind: ContractKind;
  template_key: string | null;
  brand_name: string | null;
  amount: number | null;
  notes: string | null;
  client_name: string | null;
  client_id_legacy: string | null;
  pending_client_id: number | null;
  cr_number: string | null;
  vat_number: string | null;
  signatory_name: string | null;
  street: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  pending_vendor_id: number | null;
  vendor_id: number | null;
  vendor_name: string | null;
  vendor_category: string | null;
  vendor_email: string | null;
  vendor_phone: string | null;
  bank_account_id: number | null;
  bank_name: string | null;
  account_name: string | null;
  iban: string | null;
  account_number: string | null;
  swift_code: string | null;
  license_number: string | null;
  is_influencer: boolean | null;
  platforms: string | null;
  ad_type: string | null;
  qty: string | null;
  channel: string | null;
  details: string | null;
  status: ContractRequestStatus;
  generated_contract_id: string | null;
  generated_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export function useContractRequests(workspaceId: string | null, taskId?: string | null) {
  const [items, setItems] = useState<ContractRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    let q = supabase.from('contract_requests').select('*').eq('workspace_id', workspaceId);
    if (taskId) q = q.eq('pm_task_id', taskId);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) logSbError('useContractRequests', error, { workspaceId, taskId });
    setItems((data || []) as ContractRequest[]);
    setLoading(false);
  }, [workspaceId, taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function createContractRequest(input: Omit<ContractRequest,
  'id' | 'created_at' | 'status' | 'generated_contract_id' | 'generated_at' | 'reviewed_at' | 'reviewed_by'
> & { status?: ContractRequestStatus }) {
  const { data, error } = await supabase
    .from('contract_requests')
    .insert({ ...input, status: input.status ?? 'pending' })
    .select().single();
  if (error) throw error;
  return data as ContractRequest;
}
export async function updateContractRequestStatus(id: string, status: ContractRequestStatus) {
  const fields: any = { status };
  if (status === 'approved' || status === 'rejected' || status === 'cancelled') {
    fields.reviewed_at = new Date().toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) fields.reviewed_by = user.id;
  }
  const { error } = await supabase.from('contract_requests').update(fields).eq('id', id);
  if (error) throw error;
}

export async function generateContractRequest(id: string, templateKey?: string | null) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You need to sign in again before generating contracts.');
  }

  const apiBase = process.env.NEXT_PUBLIC_CONTRACT_API_URL || 'http://127.0.0.1:8000';
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/contract-requests/${id}/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(templateKey ? { template_key: templateKey } : {}),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string'
      ? payload.detail
      : `Contract generation failed (${response.status})`;
    throw new Error(detail);
  }
  return payload as {
    request_id: string;
    template_key: string;
    contract_id: string;
    legacy_task_id: string;
    docx_path: string | null;
    pdf_path: string | null;
    pdf_error: string | null;
  };
}

// Vendors + bank accounts (legacy contract app tables)
export interface LegacyVendor {
  id: number;
  name: string;
  license_number: string;
  created_at: string | null;
}
export interface LegacyBankAccount {
  id: number;
  vendor_id: number;
  bank_name: string;
  account_name: string;
  iban: string;
  account_number: string;
  swift_code: string;
}
export function useLegacyVendors() {
  const [vendors, setVendors] = useState<LegacyVendor[]>([]);
  const [banks, setBanks] = useState<LegacyBankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const [{ data: v, error: vE }, { data: b, error: bE }] = await Promise.all([
      supabase.from('vendors').select('*').order('name', { ascending: true }),
      supabase.from('bank_accounts').select('*'),
    ]);
    if (vE) logSbError('useLegacyVendors vendors', vE);
    if (bE) logSbError('useLegacyVendors banks', bE);
    setVendors((v || []) as LegacyVendor[]);
    setBanks((b || []) as LegacyBankAccount[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { vendors, banks, loading, refetch: fetch };
}

// ============================================================
// Clients & brands (the contract-app `clients` + `client_brands`
// tables, which both apps share). NewTaskForm uses these to make
// Client/Brand pickers instead of free-text inputs.
// ============================================================

export interface ClientRow {
  id: string;
  company_name: string;
  cr_number: string | null;
  vat_number: string | null;
  signatory_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  country: string | null;
  status: string | null;
  zoho_customer_id: string | null;
}

export interface ClientBrandRow {
  id: string;
  client_id: string;
  brand_name: string;
  description: string | null;
  status: string | null;
}

export function useClients() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('id, company_name, cr_number, vat_number, signatory_name, contact_email, contact_phone, city, country, status, zoho_customer_id')
      .order('company_name', { ascending: true });
    if (error) logSbError('useClients', error);
    setClients((data || []) as ClientRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { clients, loading, refetch: fetch };
}

export function useClientBrands(clientId: string | null) {
  const [brands, setBrands] = useState<ClientBrandRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!clientId) { setBrands([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('client_brands')
      .select('id, client_id, brand_name, description, status')
      .eq('client_id', clientId)
      .order('brand_name', { ascending: true });
    if (error) logSbError('useClientBrands', error, { clientId });
    setBrands((data || []) as ClientBrandRow[]);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { brands, loading, refetch: fetch };
}

/**
 * Auto-create a contract request for a subtask the moment it has both a
 * vendor AND a non-zero budget. No-op if the subtask already has a
 * `contract_request_id` (idempotent: safe to call from any save path).
 *
 * Returns the new contract_request id, or null if no action was taken.
 */
export async function autoCreateContractRequestForSubtask(opts: {
  subtask: PMTask;
  parent: PMTask;
  vendor: LegacyVendor | null;
  bank: LegacyBankAccount | null;
  requestedBy: string;
  notes?: string | null;
}): Promise<string | null> {
  const { subtask, parent, vendor, bank, requestedBy, notes } = opts;

  // Already sent? Don't double-fire.
  if ((subtask as any).contract_request_id) return null;

  // Need both vendor + budget to be meaningful.
  if (!vendor) return null;
  const amount = Number(subtask.budget);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (!subtask.workspace_id) {
    throw new Error('Subtask has no workspace_id; cannot create contract request.');
  }

  const created = await createContractRequest({
    pm_task_id: subtask.id,
    workspace_id: subtask.workspace_id,
    requested_by: requestedBy,
    request_kind: 'vendor',
    template_key: null,
    brand_name: parent.brand_name ?? subtask.brand_name ?? '',
    amount,
    notes: notes ?? null,

    client_name: null,
    client_id_legacy: parent.legacy_client_id ?? null,
    pending_client_id: null,
    cr_number: null, vat_number: null, signatory_name: null,
    street: null, city: null, postcode: null, country: null,
    email: null, phone: null,

    pending_vendor_id: null,
    vendor_id: vendor.id,
    vendor_name: vendor.name,
    vendor_category: null,
    vendor_email: null,
    vendor_phone: null,
    bank_account_id: bank?.id ?? null,
    bank_name: bank?.bank_name ?? null,
    account_name: bank?.account_name ?? null,
    iban: bank?.iban ?? null,
    account_number: bank?.account_number ?? null,
    swift_code: bank?.swift_code ?? null,
    license_number: vendor.license_number ?? null,
    is_influencer: null,
    platforms: null,
    ad_type: null,
    qty: null,
    channel: null,
    details: subtask.title ?? null,
  } as any);

  // Link the request id back onto the subtask so we don't re-fire.
  await supabase
    .from('pm_tasks')
    .update({ contract_request_id: created.id } as any)
    .eq('id', subtask.id);

  return created.id;
}

// ============================================================
// CRM activity log (migration 014)
// Per-client / per-vendor timeline. Foundation for "last contacted",
// dormant-account queries, follow-up reminders. Same hook handles both
// target types via the `target_type` discriminator.
// ============================================================

export type CrmTargetType = 'client' | 'vendor';
export type CrmActivityKind = 'note' | 'call' | 'meeting' | 'email' | 'status_change';

export interface CrmActivity {
  id: string;
  workspace_id: string;
  target_type: CrmTargetType;
  target_id: string;
  kind: CrmActivityKind;
  body: string;
  author_id: string | null;
  author_name: string;
  occurred_at: string;
  created_at: string;
}

/** All activities for the workspace, newest first. Used by the CRM
 *  dashboard "recent activity" feed. */
export function useCrmRecentActivities(workspaceId: string | null, limit = 50) {
  const [items, setItems] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('crm_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('occurred_at', { ascending: false })
      .limit(limit);
    if (error) logSbError('useCrmRecentActivities', error, { workspaceId });
    setItems((data || []) as CrmActivity[]);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

/** Activities for one specific client/vendor, newest first. */
export function useCrmActivities(
  workspaceId: string | null,
  targetType: CrmTargetType | null,
  targetId: string | null,
) {
  const [items, setItems] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId || !targetType || !targetId) {
      setItems([]); setLoading(false); return;
    }
    const { data, error } = await supabase
      .from('crm_activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('target_type', targetType)
      .eq('target_id', String(targetId))
      .order('occurred_at', { ascending: false });
    if (error) logSbError('useCrmActivities', error, { workspaceId, targetType, targetId });
    setItems((data || []) as CrmActivity[]);
    setLoading(false);
  }, [workspaceId, targetType, targetId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function addCrmActivity(input: {
  workspace_id: string;
  target_type: CrmTargetType;
  target_id: string;
  kind: CrmActivityKind;
  body: string;
  author_id: string;
  author_name: string;
  occurred_at?: string;     // defaults to now() server-side
}) {
  const { data, error } = await supabase
    .from('crm_activities')
    .insert({
      workspace_id: input.workspace_id,
      target_type:  input.target_type,
      target_id:    String(input.target_id),
      kind:         input.kind,
      body:         input.body,
      author_id:    input.author_id,
      author_name:  input.author_name,
      occurred_at:  input.occurred_at ?? new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data as CrmActivity;
}

export async function deleteCrmActivity(id: string) {
  const { error } = await supabase.from('crm_activities').delete().eq('id', id);
  if (error) throw error;
}

// Pending vendor & client onboarding queues (legacy contract app)
export interface PendingVendor {
  id: number; full_name: string; license_number: string | null;
  email: string | null; phone: string | null;
  iban: string | null; bank_name: string | null; account_name: string | null;
  account_number: string | null; swift_code: string | null;
  vendor_category: string | null; platforms: string | null;
  status: string; submitted_at: string | null;
}
export interface PendingClient {
  id: number; company_name: string; cr_number: string | null;
  vat_number: string | null; signatory_name: string | null; phone: string | null; email: string | null;
  company_email: string | null; street: string | null; city: string | null;
  postcode: string | null; country: string | null; national_address: string | null;
  status: string; submitted_at: string | null;
}
export function usePendingVendors() {
  const [items, setItems] = useState<PendingVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('pending_vendors').select('*').order('submitted_at', { ascending: false });
    if (error) logSbError('usePendingVendors', error);
    setItems((data || []) as PendingVendor[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}
export function usePendingClients() {
  const [items, setItems] = useState<PendingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('pending_clients').select('*').order('submitted_at', { ascending: false });
    if (error) logSbError('usePendingClients', error);
    setItems((data || []) as PendingClient[]);
    setLoading(false);
  }, []);
  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}

export async function approvePendingVendor(id: number, reviewerName: string) {
  const now = new Date().toISOString();
  const { data: pending, error: getErr } = await supabase
    .from('pending_vendors').select('*').eq('id', id).maybeSingle();
  if (getErr || !pending) throw getErr ?? new Error('Pending vendor not found');
  // Promote to vendors + bank_accounts
  const { data: vendor, error: vErr } = await supabase
    .from('vendors').insert({
      name: pending.full_name,
      license_number: pending.license_number ?? '',
      created_at: now,
    }).select().single();
  if (vErr) throw vErr;
  if (pending.iban) {
    const { error: bankErr } = await supabase.from('bank_accounts').insert({
      vendor_id: vendor.id,
      bank_name: pending.bank_name ?? '',
      account_name: pending.account_name ?? '',
      iban: pending.iban,
      account_number: pending.account_number ?? '',
      swift_code: pending.swift_code ?? '',
    });
    if (bankErr) throw bankErr;
  }
  const { error: updateErr } = await supabase.from('pending_vendors')
    .update({ status: 'approved', reviewed_at: now }).eq('id', id);
  if (updateErr) throw updateErr;
}
export async function rejectPendingVendor(id: number) {
  const { error } = await supabase.from('pending_vendors')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function approvePendingClient(id: number) {
  const { error } = await supabase.from('pending_clients')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function rejectPendingClient(id: number) {
  const { error } = await supabase.from('pending_clients')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function createApprovedClientRegistration(input: {
  company_name: string;
  cr_number?: string;
  vat_number?: string;
  signatory_name?: string;
  phone?: string;
  email?: string;
  company_email?: string;
  street?: string;
  city?: string;
  postcode?: string;
  country?: string;
  national_address?: string;
}) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('pending_clients')
    .insert({
      ...input,
      company_email: input.company_email || input.email || '',
      status: 'approved',
      submitted_at: now,
      reviewed_at: now,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PendingClient;
}

export async function createApprovedVendorRegistration(input: {
  full_name: string;
  license_number?: string;
  email?: string;
  phone?: string;
  vendor_category?: string;
  platforms?: string;
  bank_name?: string;
  account_name?: string;
  iban?: string;
  account_number?: string;
  swift_code?: string;
}) {
  const now = new Date().toISOString();
  const { data: pending, error: pendingErr } = await supabase
    .from('pending_vendors')
    .insert({
      ...input,
      status: 'approved',
      submitted_at: now,
      reviewed_at: now,
    })
    .select()
    .single();
  if (pendingErr) throw pendingErr;

  const { data: vendor, error: vendorErr } = await supabase
    .from('vendors')
    .insert({
      name: input.full_name,
      license_number: input.license_number ?? '',
      created_at: now,
    })
    .select()
    .single();
  if (vendorErr) throw vendorErr;

  if (input.iban) {
    const { error: bankErr } = await supabase
      .from('bank_accounts')
      .insert({
        vendor_id: vendor.id,
        bank_name: input.bank_name ?? '',
        account_name: input.account_name || input.full_name,
        iban: input.iban,
        account_number: input.account_number ?? '',
        swift_code: input.swift_code ?? '',
      });
    if (bankErr) throw bankErr;
  }

  return pending as PendingVendor;
}

/** Service types attached to a single task (multi). */
export function useTaskServiceTypes(taskId: string | null) {
  const [items, setItems] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setItems([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('task_service_types')
      .select('service_type:service_types(*)')
      .eq('task_id', taskId)
      .order('position', { ascending: true });
    if (error) logSbError('useTaskServiceTypes', error, { taskId });
    setItems(((data || []) as any[]).map((r) => r.service_type).filter(Boolean) as ServiceType[]);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { items, loading, refetch: fetch };
}
