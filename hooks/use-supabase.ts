'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import type {
  Profile, Workspace, WorkspaceMember, Project,
  Section, Task, Comment, ActivityLog, Notification,
  TaskStatus, FilterState,
  // Legacy types
  LegacyTask, Subtask, Vendor, BankAccount, PendingVendor, PendingClient
} from '@/types';

const supabase = createClient();

// ================================================================
// AUTH
// ================================================================
export function useUser() {
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sessionToProfile = (u: any): Profile => ({
      id: u.id,
      full_name: u.user_metadata?.full_name || u.email || 'User',
      avatar_url: u.user_metadata?.avatar_url || null,
      job_title: null,
      timezone: 'UTC',
      created_at: u.created_at || new Date().toISOString(),
      updated_at: u.created_at || new Date().toISOString(),
    } as Profile);

    // Pull current session from cookies (works because we're on createBrowserClient).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) setUser(sessionToProfile(session.user));
      setLoading(false);
    }).catch(() => setLoading(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(sessionToProfile(session.user));
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return { user, loading };
}

// ================================================================
// WORKSPACES
// ================================================================
export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: false });
    setWorkspaces(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { workspaces, loading, refetch: fetch };
}

export function useWorkspaceMembers(workspaceId: string | null) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from('workspace_members')
      .select('*, profile:profiles(*)')
      .eq('workspace_id', workspaceId);
    setMembers(data?.map((m: any) => ({ ...m, profile: m.profile })) || []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { members, loading, refetch: fetch };
}

// ================================================================
// PROJECTS
// ================================================================
export function useProjects(workspaceId: string | null) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    setProjects(data || []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { projects, loading, refetch: fetch };
}

// ================================================================
// SECTIONS
// ================================================================
export function useSections(projectId: string | null) {
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from('sections')
      .select('*')
      .eq('project_id', projectId)
      .order('position', { ascending: true });
    setSections(data || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { sections, loading, refetch: fetch };
}

// ================================================================
// PM TASKS (reads from "pm_tasks" table)
// ================================================================
export function useTasks(projectId: string | null, filters?: FilterState) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!projectId) return;
    let query = supabase
      .from('pm_tasks')  // <-- CHANGED from 'tasks' to 'pm_tasks'
      .select('*, assignee:profiles!pm_tasks_assignee_id_fkey(*), creator:profiles!pm_tasks_creator_id_fkey(*)')
      .eq('project_id', projectId)
      .is('parent_task_id', null)
      .order('position', { ascending: true });

    if (filters?.assignee) query = query.eq('assignee_id', filters.assignee);
    if (filters?.priority) query = query.eq('priority', filters.priority);
    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.search) query = query.ilike('title', `%${filters.search}%`);

    const { data } = await query;
    setTasks(data || []);
    setLoading(false);
  }, [projectId, filters?.assignee, filters?.priority, filters?.status, filters?.search]);

  useEffect(() => { fetch(); }, [fetch]);
  return { tasks, loading, refetch: fetch };
}

export function useMyTasks(userId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('pm_tasks')  // <-- CHANGED
      .select('*, assignee:profiles!pm_tasks_assignee_id_fkey(*), project:projects(*)')
      .eq('assignee_id', userId)
      .neq('status', 'done')
      .neq('status', 'cancelled')
      .order('due_date', { ascending: true, nullsFirst: false });
    setTasks(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { tasks, loading, refetch: fetch };
}

// ================================================================
// COMMENTS (references pm_tasks)
// ================================================================
export function useComments(taskId: string | null) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) return;
    const { data } = await supabase
      .from('comments')
      .select('*, author:profiles(*)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setComments(data || []);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { comments, loading, refetch: fetch };
}

// ================================================================
// ACTIVITY
// ================================================================
export function useActivity(workspaceId: string | null, limit = 20) {
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from('activity_log')
      .select('*, user:profiles(*), task:pm_tasks(title), project:projects(name)')  // <-- pm_tasks
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    setActivity(data || []);
    setLoading(false);
  }, [workspaceId, limit]);

  useEffect(() => { fetch(); }, [fetch]);
  return { activity, loading, refetch: fetch };
}

// ================================================================
// NOTIFICATIONS
// ================================================================
export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    const items = data || [];
    setNotifications(items);
    setUnreadCount(items.filter((n) => !n.read).length);
  }, []);

  const markRead = useCallback(async (id: string) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id);
    fetch();
  }, [fetch]);

  const markAllRead = useCallback(async () => {
    await supabase.from('notifications').update({ read: true }).eq('read', false);
    fetch();
  }, [fetch]);

  useEffect(() => { fetch(); }, [fetch]);
  return { notifications, unreadCount, markRead, markAllRead, refetch: fetch };
}

// ================================================================
// PM MUTATIONS (write to "pm_tasks")
// ================================================================
export function useTaskMutations(onSuccess?: () => void) {
  const createTask = async (task: Partial<Task>) => {
    const { data, error } = await supabase.from('pm_tasks').insert(task).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    const { data, error } = await supabase.from('pm_tasks').update(updates).eq('id', id).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const deleteTask = async (id: string) => {
    const { error } = await supabase.from('pm_tasks').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  const moveTask = async (id: string, sectionId: string, position: number) => {
    return updateTask(id, { section_id: sectionId, position } as any);
  };

  return { createTask, updateTask, deleteTask, moveTask };
}

export function useProjectMutations(onSuccess?: () => void) {
  const createProject = async (project: Partial<Project>) => {
    const { data, error } = await supabase.from('projects').insert(project).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const updateProject = async (id: string, updates: Partial<Project>) => {
    const { data, error } = await supabase.from('projects').update(updates).eq('id', id).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const deleteProject = async (id: string) => {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  return { createProject, updateProject, deleteProject };
}

export function useCommentMutations(onSuccess?: () => void) {
  const addComment = async (taskId: string, authorId: string, content: string) => {
    const { data, error } = await supabase
      .from('comments')
      .insert({ task_id: taskId, author_id: authorId, content })
      .select('*, author:profiles(*)')
      .single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  return { addComment };
}

// ================================================================
// LEGACY CONTRACT HOOKS
// These read from your existing tables (tasks, subtasks, vendors, etc.)
// ================================================================

/** Fetch legacy contract tasks (text PK "tasks" table) */
export function useLegacyTasks() {
  const [tasks, setTasks] = useState<LegacyTask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('tasks')          // your original tasks table
      .select('*')
      .order('id', { ascending: true });
    setTasks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { tasks, loading, refetch: fetch };
}

/** Fetch subtasks for a legacy task */
export function useSubtasks(taskId: string | null) {
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) return;
    const { data } = await supabase
      .from('subtasks')
      .select('*')
      .eq('task_id', taskId);
    setSubtasks(data || []);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { subtasks, loading, refetch: fetch };
}

/** Fetch vendors */
export function useVendors() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('vendors')
      .select('*')
      .order('id', { ascending: true });
    setVendors(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { vendors, loading, refetch: fetch };
}

/** Fetch bank accounts */
export function useBankAccounts() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('bank_accounts')
      .select('*');
    setAccounts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { accounts, loading, refetch: fetch };
}

/** Fetch pending vendors */
export function usePendingVendors() {
  const [vendors, setVendors] = useState<PendingVendor[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('pending_vendors')
      .select('*');
    setVendors(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { vendors, loading, refetch: fetch };
}

/** Fetch pending clients */
export function usePendingClients() {
  const [clients, setClients] = useState<PendingClient[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('pending_clients')
      .select('*');
    setClients(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);
  return { clients, loading, refetch: fetch };
}

// ================================================================
// ROLE & PERMISSIONS
// ================================================================

/** Get the current user's role in a workspace */
export function useMyRole(workspaceId: string | null, userId: string | null) {
  const [role, setRole] = useState<import('@/types').WorkspaceRole | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId || !userId) { setLoading(false); return; }
    const { data } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    setRole(data?.role || null);
    setLoading(false);
  }, [workspaceId, userId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { role, loading, refetch: fetch };
}

// ================================================================
// CLIENTS
// ================================================================

export function useClients(workspaceId: string | null) {
  const [clients, setClients] = useState<import('@/types').Client[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from('clients')
      .select('*, brands:client_brands(*)')
      .eq('workspace_id', workspaceId)
      .order('company_name', { ascending: true });
    setClients(data || []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { clients, loading, refetch: fetch };
}

export function useClientMutations(onSuccess?: () => void) {
  const createClient = async (client: Partial<import('@/types').Client>) => {
    const { data, error } = await supabase.from('clients').insert(client).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const updateClient = async (id: string, updates: Partial<import('@/types').Client>) => {
    const { data, error } = await supabase.from('clients').update(updates).eq('id', id).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const deleteClient = async (id: string) => {
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  return { createClient, updateClient, deleteClient };
}

// ================================================================
// BRANDS
// ================================================================

export function useBrands(clientId: string | null) {
  const [brands, setBrands] = useState<import('@/types').ClientBrand[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!clientId) { setBrands([]); setLoading(false); return; }
    const { data } = await supabase
      .from('client_brands')
      .select('*')
      .eq('client_id', clientId)
      .order('brand_name', { ascending: true });
    setBrands(data || []);
    setLoading(false);
  }, [clientId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { brands, loading, refetch: fetch };
}

export function useBrandMutations(onSuccess?: () => void) {
  const createBrand = async (brand: Partial<import('@/types').ClientBrand>) => {
    const { data, error } = await supabase.from('client_brands').insert(brand).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const updateBrand = async (id: string, updates: Partial<import('@/types').ClientBrand>) => {
    const { data, error } = await supabase.from('client_brands').update(updates).eq('id', id).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const deleteBrand = async (id: string) => {
    const { error } = await supabase.from('client_brands').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  return { createBrand, updateBrand, deleteBrand };
}

// ================================================================
// MANAGER-CLIENT ASSIGNMENTS
// ================================================================

export function useManagerClients(workspaceId: string | null, managerId?: string | null) {
  const [assignments, setAssignments] = useState<import('@/types').ManagerClient[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) return;
    let query = supabase
      .from('manager_clients')
      .select('*, manager:profiles!manager_clients_manager_id_fkey(*), client:clients(*)')
      .eq('workspace_id', workspaceId);
    if (managerId) query = query.eq('manager_id', managerId);
    const { data } = await query;
    setAssignments(data || []);
    setLoading(false);
  }, [workspaceId, managerId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { assignments, loading, refetch: fetch };
}

export function useManagerClientMutations(onSuccess?: () => void) {
  const assignClient = async (workspaceId: string, managerId: string, clientId: string, assignedBy: string) => {
    const { data, error } = await supabase
      .from('manager_clients')
      .insert({ workspace_id: workspaceId, manager_id: managerId, client_id: clientId, assigned_by: assignedBy })
      .select()
      .single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const unassignClient = async (id: string) => {
    const { error } = await supabase.from('manager_clients').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  return { assignClient, unassignClient };
}

// ================================================================
// TASK MEMBERS
// ================================================================

export function useTaskMembers(taskId: string | null) {
  const [members, setMembers] = useState<import('@/types').TaskMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!taskId) { setMembers([]); setLoading(false); return; }
    const { data } = await supabase
      .from('task_members')
      .select('*, user:profiles!task_members_user_id_fkey(*)')
      .eq('task_id', taskId);
    setMembers(data || []);
    setLoading(false);
  }, [taskId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { members, loading, refetch: fetch };
}

export function useTaskMemberMutations(onSuccess?: () => void) {
  const addMember = async (taskId: string, userId: string, addedBy: string, role = 'member') => {
    const { data, error } = await supabase
      .from('task_members')
      .insert({ task_id: taskId, user_id: userId, added_by: addedBy, role })
      .select('*, user:profiles!task_members_user_id_fkey(*)')
      .single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const removeMember = async (id: string) => {
    const { error } = await supabase.from('task_members').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  return { addMember, removeMember };
}


// ================================================================
// MANAGED VENDORS
// ================================================================

export function useManagedVendors(workspaceId: string | null) {
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!workspaceId) return;
    const { data } = await supabase
      .from('managed_vendors')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('company_name', { ascending: true });
    setVendors(data || []);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { fetch(); }, [fetch]);
  return { vendors, loading, refetch: fetch };
}

export function useManagedVendorMutations(onSuccess?: () => void) {
  const createVendor = async (vendor: any) => {
    const { data, error } = await supabase.from('managed_vendors').insert(vendor).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const updateVendor = async (id: string, updates: any) => {
    const { data, error } = await supabase.from('managed_vendors').update(updates).eq('id', id).select().single();
    if (!error) onSuccess?.();
    return { data, error };
  };

  const deleteVendor = async (id: string) => {
    const { error } = await supabase.from('managed_vendors').delete().eq('id', id);
    if (!error) onSuccess?.();
    return { error };
  };

  return { createVendor, updateVendor, deleteVendor };
}

// ================================================================
// PENDING CLIENT/VENDOR ACCEPTANCE
// ================================================================

export function useAcceptClient(onSuccess?: () => void) {
  const acceptClient = async (pendingId: string, workspaceId: string, reviewedBy: string, pendingData: any) => {
    const { data: newClient, error: clientErr } = await supabase.from('clients').insert({
      workspace_id: workspaceId,
      company_name: pendingData.company_name || pendingData.name || 'Unknown',
      contact_name: pendingData.contact_name || pendingData.name || null,
      contact_email: pendingData.email || pendingData.contact_email || null,
      contact_phone: pendingData.phone || pendingData.contact_phone || null,
      industry: pendingData.industry || null,
      notes: 'Accepted from registration form. Original ID: ' + pendingId,
      status: 'active',
    }).select().single();

    if (clientErr) return { data: null, error: clientErr };

    await supabase.from('pending_clients').update({
      review_status: 'accepted',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    }).eq('id', pendingId);

    onSuccess?.();
    return { data: newClient, error: null };
  };

  const rejectClient = async (pendingId: string, reviewedBy: string) => {
    const { error } = await supabase.from('pending_clients').update({
      review_status: 'rejected',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    }).eq('id', pendingId);
    if (!error) onSuccess?.();
    return { error };
  };

  return { acceptClient, rejectClient };
}

export function useAcceptVendor(onSuccess?: () => void) {
  const acceptVendor = async (pendingId: string, workspaceId: string, reviewedBy: string, pendingData: any) => {
    const { data: newVendor, error: vendorErr } = await supabase.from('managed_vendors').insert({
      workspace_id: workspaceId,
      company_name: pendingData.company_name || pendingData.name || 'Unknown',
      contact_name: pendingData.contact_name || pendingData.name || null,
      contact_email: pendingData.email || pendingData.contact_email || null,
      contact_phone: pendingData.phone || pendingData.contact_phone || null,
      service_type: pendingData.service_type || pendingData.services || null,
      notes: 'Accepted from registration form. Original ID: ' + pendingId,
      status: 'active',
    }).select().single();

    if (vendorErr) return { data: null, error: vendorErr };

    await supabase.from('pending_vendors').update({
      review_status: 'accepted',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    }).eq('id', pendingId);

    onSuccess?.();
    return { data: newVendor, error: null };
  };

  const rejectVendor = async (pendingId: string, reviewedBy: string) => {
    const { error } = await supabase.from('pending_vendors').update({
      review_status: 'rejected',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    }).eq('id', pendingId);
    if (!error) onSuccess?.();
    return { error };
  };

  return { acceptVendor, rejectVendor };
}
