// ============================================================
// AQ Creativity — TypeScript Types (Phase 1: Roles + Clients)
// ============================================================

export type UUID = string;

// ================================================================
// ENUMS
// ================================================================
export type WorkspaceRole = 'owner' | 'admin' | 'operations' | 'sales' | 'marketing' | 'key_account' | 'member';
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';
export type ProjectColor = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'indigo' | 'purple' | 'pink' | 'gray';
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'completed' | 'assigned' | 'unassigned' | 'commented' | 'moved' | 'status_changed' | 'priority_changed';
export type NotificationType = 'task_assigned' | 'task_completed' | 'comment_added' | 'mention' | 'due_soon' | 'project_invite';

// ================================================================
// PERMISSIONS HELPER
// ================================================================
export function canDo(role: WorkspaceRole | undefined, action: string): boolean {
  if (!role) return false;
  const permissions: Record<string, WorkspaceRole[]> = {
    'manage_workspace':     ['owner'],
    'manage_members':       ['owner', 'admin'],
    'invite_members':       ['owner', 'admin'],
    'assign_clients':       ['owner', 'admin'],
    'create_projects':      ['owner', 'admin'],
    'delete_projects':      ['owner', 'admin'],
    'view_all_tasks':       ['owner', 'admin', 'marketing'],
    'view_assigned_tasks':  ['owner', 'admin', 'operations', 'marketing', 'key_account', 'member'],
    'create_tasks':         ['owner', 'admin', 'sales', 'marketing'],
    'assign_task_members':  ['owner', 'admin', 'marketing', 'key_account'],
    'edit_any_task':        ['owner', 'admin', 'marketing'],
    'edit_own_tasks':       ['owner', 'admin', 'operations', 'sales', 'marketing', 'key_account', 'member'],
    'delete_tasks':         ['owner', 'admin', 'marketing'],
    'view_all_clients':     ['owner', 'admin', 'marketing', 'sales'],
    'view_assigned_clients':['owner', 'admin', 'operations', 'marketing', 'key_account'],
    'create_clients':       ['owner', 'admin'],
    'edit_clients':         ['owner', 'admin'],
    'view_team':            ['owner', 'admin', 'operations', 'marketing', 'key_account', 'member'],
    'change_roles':         ['owner', 'admin'],
  };
  return permissions[action]?.includes(role) ?? false;
}

// ================================================================
// MODELS
// ================================================================
export interface Profile {
  id: UUID;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  owner_id: UUID;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: UUID;
  workspace_id: UUID;
  user_id: UUID;
  role: WorkspaceRole;
  joined_at: string;
  profile?: Profile;
}

export interface Project {
  id: UUID;
  workspace_id: UUID;
  name: string;
  description: string | null;
  color: ProjectColor;
  status: ProjectStatus;
  icon: string;
  owner_id: UUID | null;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  task_count?: number;
  completed_count?: number;
  members?: Profile[];
}

export interface Section {
  id: UUID;
  project_id: UUID;
  name: string;
  position: number;
  created_at: string;
  tasks?: Task[];
}

export interface Task {
  id: UUID;
  project_id: UUID;
  section_id: UUID | null;
  parent_task_id: UUID | null;
  legacy_task_id: string | null;
  client_id: UUID | null;
  brand_id: UUID | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: UUID | null;
  creator_id: UUID;
  due_date: string | null;
  start_date: string | null;
  position: number;
  completed_at: string | null;
  estimated_hours: number | null;
  created_at: string;
  updated_at: string;
  assignee?: Profile;
  creator?: Profile;
  labels?: Label[];
  subtasks?: Task[];
  assignments?: TaskAssignment[];
  task_members?: TaskMember[];
  comments_count?: number;
  client?: Client;
  brand?: ClientBrand;
}

export interface TaskAssignment {
  id: UUID;
  task_id: UUID;
  user_id: UUID;
  assigned_at: string;
  assigned_by: UUID | null;
  user?: Profile;
}

export interface TaskMember {
  id: UUID;
  task_id: UUID;
  user_id: UUID;
  added_by: UUID | null;
  role: string;
  added_at: string;
  user?: Profile;
}

export interface Label {
  id: UUID;
  workspace_id: UUID;
  name: string;
  color: string;
  created_at: string;
}

export interface Comment {
  id: UUID;
  task_id: UUID;
  author_id: UUID;
  content: string;
  created_at: string;
  updated_at: string;
  author?: Profile;
}

export interface ActivityLog {
  id: UUID;
  workspace_id: UUID;
  project_id: UUID | null;
  task_id: UUID | null;
  user_id: UUID;
  action: ActivityAction;
  details: Record<string, unknown>;
  created_at: string;
  user?: Profile;
  task?: Task;
  project?: Project;
}

export interface Notification {
  id: UUID;
  user_id: UUID;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

// ================================================================
// CLIENT / BRAND MODELS
// ================================================================
export interface Client {
  id: UUID;
  workspace_id: UUID;
  user_id: UUID | null;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  industry: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  brands?: ClientBrand[];
}

export interface ClientBrand {
  id: UUID;
  client_id: UUID;
  brand_name: string;
  brand_logo_url: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ManagerClient {
  id: UUID;
  workspace_id: UUID;
  manager_id: UUID;
  client_id: UUID;
  assigned_at: string;
  assigned_by: UUID | null;
  manager?: Profile;
  client?: Client;
}

// ================================================================
// LEGACY CONTRACT MODELS
// ================================================================
export interface LegacyTask {
  id: string;
  [key: string]: any;
}

export interface Subtask {
  id: string;
  task_id: string;
  [key: string]: any;
}

/**
 * Vendor categories — single FK on `vendors.category_id`.
 *
 * `requires_license = true` means the category uses license_number on the
 * vendor row (currently Influencer + UGC). Everything else uses id_number.
 *
 * Schema lives in supabase/migrations/029_vendor_categories.sql.
 */
export interface VendorCategory {
  id: string;
  key: string;
  label: string;
  requires_license: boolean;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

/** Stable category keys — keep in sync with the seed in migration 029. */
export type VendorCategoryKey =
  | 'influencer'
  | 'ugc'
  | 'props'
  | 'makeup_artist'
  | 'logistics'
  | 'model'
  | 'videographer'
  | 'rentals'
  | 'events'
  | 'location'
  | 'photographer';

export interface Vendor {
  id: string;
  name: string;
  // Category (single FK — vendor is one thing at a time)
  category_id?: string | null;
  vendor_category?: string;  // legacy free-text — kept for backward compat
  // Base required fields (some legacy rows may still be empty)
  id_number?: string;
  license_number?: string | null;
  signatory_name?: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  // Base optional
  vat_number?: string;
  details?: string;
  // Per-category optional fields
  location_link?: string;     // Logistics, Location
  short_address?: string;     // Logistics
  age?: number | null;        // Model
  gender?: string;            // Model
  rental_type?: string;       // Rentals
  event_opening?: string;     // Events
  event_ceremony?: string;    // Events
  location_type?: string;     // Location
  // Other existing fields
  platforms?: string;
  invite_status?: string;
  pending_vendor_id?: string | null;
  created_at?: string;
  [key: string]: any;
}

export interface BankAccount {
  id: string;
  vendor_id?: string;
  bank_name?: string;
  account_name?: string;
  iban?: string;
  account_number?: string;
  swift_code?: string;
  [key: string]: any;
}

export interface PendingVendor {
  id: string;
  [key: string]: any;
}

export interface PendingClient {
  id: string;
  [key: string]: any;
}

// ================================================================
// UI STATE
// ================================================================
export type ViewMode = 'board' | 'list' | 'calendar';

export interface BoardColumn {
  id: string;
  title: string;
  status: TaskStatus;
  tasks: Task[];
  color: string;
}

export interface FilterState {
  assignee?: UUID;
  priority?: TaskPriority;
  status?: TaskStatus;
  label?: UUID;
  search?: string;
  due?: 'overdue' | 'today' | 'this_week' | 'no_date';
  client_id?: UUID;
  brand_id?: UUID;
}
