-- ============================================================
-- AQ CREATIVITY — FULL RESET + REBUILD (run this ONCE)
-- ============================================================
-- Wipes the public schema and recreates schemas for BOTH apps:
--   • Contract app  (FastAPI backend, in /aq-backend)
--   • Project mgmt  (Next.js app, in /New folder (3))
--
-- Both apps share this single Supabase project, but they live in
-- separate tables. The PM app uses Supabase Auth; the contract app
-- keeps its own JWT auth (its own `users` table) for now.
--
-- Structure of this file (ordered to avoid forward references):
--   0. Drop + reset schema
--   1. Extensions, enums, helper functions
--   2. ALL CREATE TABLE  (in FK dependency order)
--   3. ALL ROW LEVEL SECURITY enables + policies
--   4. ALL TRIGGERS
--   5. ALL INDEXES
--   6. Optional auth.users wipe (commented out)
-- ============================================================


-- =========================================================
-- 0. Reset
-- =========================================================
drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
grant all on schema public to anon;
grant all on schema public to authenticated;
grant all on schema public to service_role;

-- Default privileges so anon / authenticated can access tables created
-- LATER in this script. Without this, Postgres rejects at the ACL layer
-- with "permission denied for table X" before RLS even runs.
alter default privileges in schema public
  grant all on tables to postgres, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, service_role;
alter default privileges in schema public
  grant all on functions to postgres, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;


-- =========================================================
-- 1. Extensions, enums, helper functions
-- =========================================================
create extension if not exists "uuid-ossp";

create type task_status as enum ('todo','in_progress','in_review','done','cancelled');
create type task_priority as enum ('urgent','high','medium','low','none');
create type activity_action as enum (
  'created','updated','deleted','completed',
  'assigned','unassigned','commented','moved',
  'status_changed','priority_changed'
);
create type notification_type as enum (
  'task_assigned','task_completed','comment_added',
  'mention','due_soon','project_invite'
);

create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

-- Workspace-membership helpers. SECURITY DEFINER bypasses RLS during the
-- lookup, which prevents infinite recursion in policies that need to ask
-- "is the calling user a member/admin of workspace X?".
create or replace function public.is_member_of(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_admin_of(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner','admin')
  );
$$;

create or replace function public.is_manager_or_higher(ws_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws_id
      and user_id = auth.uid()
      and role in ('owner','admin','manager')
  );
$$;

-- Returns the workspace_id for a pm_tasks row without firing RLS — used by
-- task_members / task_assignments / task_labels / comments policies so they
-- don't have to subquery pm_tasks (which would recurse).
create or replace function public.task_workspace_id(t_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select workspace_id from public.pm_tasks where id = t_id;
$$;


-- =========================================================
-- 2. ALL TABLES  (FK dependency order; no policies yet)
-- =========================================================

-- ---- PM app ----

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  avatar_url text,
  job_title text,
  timezone text default 'UTC',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  owner_id uuid not null references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.workspace_members (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','manager','member','guest')),
  joined_at timestamptz default now(),
  unique (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  color text default 'blue',
  status text default 'active' check (status in ('active','on_hold','completed','archived')),
  icon text default '📁',
  owner_id uuid references public.profiles(id),
  start_date date,
  due_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.sections (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  position int default 0,
  created_at timestamptz default now()
);

create table public.pm_tasks (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  section_id uuid references public.sections(id) on delete set null,
  parent_task_id uuid references public.pm_tasks(id) on delete cascade,
  legacy_task_id text,
  client_id uuid,
  brand_id uuid,
  title text not null,
  description text,
  status task_status default 'todo',
  priority task_priority default 'none',
  assignee_id uuid references public.profiles(id),
  creator_id uuid not null references public.profiles(id),
  due_date date,
  start_date date,
  position int default 0,
  completed_at timestamptz,
  estimated_hours numeric(6,2),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.task_assignments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz default now(),
  assigned_by uuid references public.profiles(id),
  unique (task_id, user_id)
);

create table public.task_members (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  role text not null default 'collaborator',
  added_at timestamptz default now(),
  unique (task_id, user_id)
);

create table public.labels (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  created_at timestamptz default now()
);

create table public.task_labels (
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (task_id, label_id)
);

create table public.comments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.activity_log (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.pm_tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  action activity_action not null,
  details jsonb default '{}',
  created_at timestamptz default now()
);

create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text,
  link text,
  read boolean default false,
  created_at timestamptz default now()
);

create table public.clients (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id),
  company_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  industry text,
  notes text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.client_brands (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references public.clients(id) on delete cascade,
  brand_name text not null,
  brand_logo_url text,
  description text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.manager_clients (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  assigned_at timestamptz default now(),
  assigned_by uuid references public.profiles(id),
  unique (workspace_id, manager_id, client_id)
);

create table public.managed_vendors (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  company_name text not null,
  contact_name text,
  contact_email text,
  contact_phone text,
  service_type text,
  industry text,
  address text,
  bank_name text,
  iban text,
  notes text,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);


-- ---- Contract app ----
-- (RLS stays OFF on these — auth happens at the API layer)

create table public.users (
  id bigserial primary key,
  username text unique not null,
  email text,
  full_name text,
  password_hash text not null,
  role text default 'member' check (role in ('admin','member')),
  profile_color text default '#22c55e',
  profile_icon text default '👤',
  created_at timestamptz default now(),
  last_login timestamptz
);

create table public.tasks (
  id text primary key,
  brand text not null,
  amount text default '0',
  contract_type text default 'after_pay',
  status text default 'NEW',
  notes text default '',
  end_date text,
  created_at text,
  updated_at text
);

create table public.subtasks (
  id bigserial primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  lic_id text,
  vendor text default '',
  license_number text default '',
  iban text default '',
  channel text default '',
  platforms text default '',
  ad_type text default 'Store Visit',
  qty text default '1',
  details text default '',
  price text default '0',
  paid_at text,
  payment_note text default ''
);

create table public.vendors (
  id bigserial primary key,
  name text not null,
  license_number text not null,
  created_at text
);

create table public.bank_accounts (
  id bigserial primary key,
  vendor_id bigint not null references public.vendors(id) on delete cascade,
  bank_name text not null,
  account_name text not null,
  iban text not null,
  account_number text default '',
  swift_code text default ''
);

create table public.pending_vendors (
  id bigserial primary key,
  full_name text not null,
  license_number text default '',
  email text default '',
  phone text default '',
  address_1 text default '',
  address_2 text default '',
  address_3 text default '',
  iban text default '',
  bank_name text default '',
  account_name text default '',
  account_number text default '',
  swift_code text default '',
  license_expiry text,
  vendor_category text default '',
  platforms text default '',
  dropoff_locations text default '',
  status text default 'pending',
  submitted_at text,
  reviewed_at text
);

create table public.pending_clients (
  id bigserial primary key,
  company_name text not null,
  cr_number text default '',
  vat_number text default '',
  signatory_name text default '',
  phone text default '',
  email text default '',
  company_email text default '',
  street text default '',
  city text default '',
  postcode text default '',
  country text default '',
  national_address text default '',
  permit_doc text default '',
  vat_doc text default '',
  national_address_doc text default '',
  status text default 'pending',
  submitted_at text,
  reviewed_at text
);

create table public.audit_logs (
  id bigserial primary key,
  actor_username text not null,
  action text not null,
  entity_type text default '',
  entity_id text default '',
  details text default '',
  created_at text
);

create table public.app_settings (
  key text primary key,
  value text not null
);

create table public.generated_contracts (
  id bigserial primary key,
  contract_id text unique not null,
  task_id text references public.tasks(id) on delete set null,
  brand_name text default '',
  amount text default '0',
  contract_type text default '',
  generated_at text,
  generated_by text,
  docx_path text,
  pdf_path text,
  pdf_error text
);

create table public.contract_requests (
  id uuid primary key default uuid_generate_v4(),
  pm_task_id uuid references public.pm_tasks(id) on delete set null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  request_kind text not null check (request_kind in ('client','vendor')),
  template_key text,
  brand_name text,
  amount numeric(14,2),
  notes text,
  client_name text,
  client_id_legacy text,
  pending_client_id bigint,
  cr_number text,
  vat_number text,
  signatory_name text,
  street text,
  city text,
  postcode text,
  country text,
  email text,
  phone text,
  pending_vendor_id bigint,
  vendor_id bigint references public.vendors(id),
  vendor_name text,
  vendor_category text,
  vendor_email text,
  vendor_phone text,
  bank_account_id bigint references public.bank_accounts(id),
  bank_name text,
  account_name text,
  iban text,
  account_number text,
  swift_code text,
  license_number text,
  is_influencer boolean default false,
  platforms text,
  ad_type text,
  qty text default '1',
  channel text,
  details text,
  status text not null default 'pending'
    check (status in ('pending','approved','generated','rejected','cancelled')),
  generated_contract_id text,
  generated_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table public.contract_completions (
  id bigserial primary key,
  task_id text unique not null references public.tasks(id) on delete cascade,
  brand_name text default '',
  amount text default '0',
  contract_type text default '',
  status text default '',
  acceptance_status text default 'pending',
  pushed_at text,
  pushed_by text
);


-- =========================================================
-- 3. ROW LEVEL SECURITY (PM tables only)
-- =========================================================

alter table public.profiles            enable row level security;
alter table public.workspaces          enable row level security;
alter table public.workspace_members   enable row level security;
alter table public.projects            enable row level security;
alter table public.sections            enable row level security;
alter table public.pm_tasks            enable row level security;
alter table public.task_assignments    enable row level security;
alter table public.task_members        enable row level security;
alter table public.labels              enable row level security;
alter table public.task_labels         enable row level security;
alter table public.comments            enable row level security;
alter table public.activity_log        enable row level security;
alter table public.notifications       enable row level security;
alter table public.clients             enable row level security;
alter table public.client_brands       enable row level security;
alter table public.manager_clients     enable row level security;
alter table public.managed_vendors     enable row level security;
alter table public.contract_requests   enable row level security;

-- profiles
create policy "profiles select"     on public.profiles for select using (true);
create policy "profiles update own" on public.profiles for update using (auth.uid() = id);
create policy "profiles insert own" on public.profiles for insert with check (auth.uid() = id);

-- workspaces  (owner-or-member SELECT so insert().select() works on first create)
create policy "workspaces select if owner or member" on public.workspaces for select
  using (auth.uid() = owner_id or public.is_member_of(id));
create policy "workspaces insert by self" on public.workspaces for insert
  with check (auth.uid() = owner_id);
create policy "workspaces update by owner" on public.workspaces for update
  using (auth.uid() = owner_id);

-- workspace_members  (uses SECURITY DEFINER helpers to avoid RLS recursion)
create policy "wm select if same ws" on public.workspace_members for select
  using (public.is_member_of(workspace_id));
create policy "wm insert by self or admin" on public.workspace_members for insert
  with check (user_id = auth.uid() or public.is_admin_of(workspace_id));
create policy "wm update by admin" on public.workspace_members for update
  using (public.is_admin_of(workspace_id));
create policy "wm delete by admin" on public.workspace_members for delete
  using (public.is_admin_of(workspace_id));

-- projects
create policy "projects select if ws member" on public.projects for select
  using (public.is_member_of(workspace_id));
create policy "projects insert by member" on public.projects for insert
  with check (public.is_member_of(workspace_id));
create policy "projects update by member" on public.projects for update
  using (public.is_member_of(workspace_id));
create policy "projects delete by admin" on public.projects for delete
  using (public.is_admin_of(workspace_id));

-- sections
create policy "sections all if project visible" on public.sections for all
  using (project_id in (select id from public.projects));

-- pm_tasks  (role-aware select; relies on task_members' policy NOT recursing)
create policy "pm_tasks select" on public.pm_tasks for select
  using (
    public.has_role(workspace_id, array['owner','admin','operations','marketing','sales','key_account'])
    or assignee_id    = auth.uid()
    or creator_id     = auth.uid()
    or key_account_id = auth.uid()
    or id in (select task_id from public.task_members where user_id = auth.uid())
  );
create policy "pm_tasks insert" on public.pm_tasks for insert
  with check (
    public.has_role(workspace_id, array['owner','admin','operations','sales','marketing'])
  );
create policy "pm_tasks update by participant" on public.pm_tasks for update
  using (
    assignee_id = auth.uid()
    or creator_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = pm_tasks.project_id
        and public.is_manager_or_higher(p.workspace_id)
    )
  );
create policy "pm_tasks delete by admin" on public.pm_tasks for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = pm_tasks.project_id
        and public.is_admin_of(p.workspace_id)
    )
  );

-- task_assignments  (uses task_workspace_id helper to avoid pm_tasks recursion)
create policy "task_assignments select" on public.task_assignments for select
  using (
    user_id = auth.uid()
    or public.has_role(public.task_workspace_id(task_id), array['owner','admin','operations','marketing','key_account'])
  );
create policy "task_assignments write" on public.task_assignments for all
  using (public.has_role(public.task_workspace_id(task_id), array['owner','admin','operations','marketing','key_account']));

-- task_members  (same trick)
create policy "task_members select" on public.task_members for select
  using (
    user_id = auth.uid()
    or public.has_role(public.task_workspace_id(task_id), array['owner','admin','operations','marketing','key_account'])
  );
create policy "task_members write" on public.task_members for all
  using (public.has_role(public.task_workspace_id(task_id), array['owner','admin','operations','marketing','key_account']));

-- labels
create policy "labels all if ws member" on public.labels for all
  using (public.is_member_of(workspace_id));

-- task_labels
create policy "task_labels all" on public.task_labels for all
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );

-- comments
create policy "comments select" on public.comments for select
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );
create policy "comments insert by author" on public.comments for insert
  with check (auth.uid() = author_id);
create policy "comments update own" on public.comments for update
  using (auth.uid() = author_id);
create policy "comments delete own" on public.comments for delete
  using (auth.uid() = author_id);

-- activity_log
create policy "activity_log select if ws member" on public.activity_log for select
  using (public.is_member_of(workspace_id));
create policy "activity_log insert by member" on public.activity_log for insert
  with check (public.is_member_of(workspace_id));

-- notifications
create policy "notifications select own" on public.notifications for select using (user_id = auth.uid());
create policy "notifications update own" on public.notifications for update using (user_id = auth.uid());

-- clients
create policy "clients select if ws member" on public.clients for select
  using (public.is_member_of(workspace_id));
create policy "clients insert by member" on public.clients for insert
  with check (public.is_member_of(workspace_id));
create policy "clients update by member" on public.clients for update
  using (public.is_member_of(workspace_id));
create policy "clients delete by admin" on public.clients for delete
  using (public.is_admin_of(workspace_id));

-- client_brands
create policy "client_brands all if client visible" on public.client_brands for all
  using (client_id in (select id from public.clients));

-- manager_clients
create policy "manager_clients select if ws member" on public.manager_clients for select
  using (public.is_member_of(workspace_id));
create policy "manager_clients write by admin" on public.manager_clients for all
  using (public.is_admin_of(workspace_id));

-- managed_vendors
create policy "managed_vendors all if ws member" on public.managed_vendors for all
  using (public.is_member_of(workspace_id));

-- contract_requests
create policy "contract_requests select" on public.contract_requests for select
  using (public.is_member_of(workspace_id));
create policy "contract_requests insert" on public.contract_requests for insert
  with check (
    auth.uid() = requested_by
    and public.has_role(workspace_id,
      array['owner','admin','operations','marketing','sales','key_account'])
  );
create policy "contract_requests update" on public.contract_requests for update
  using (
    public.has_role(workspace_id,
      array['owner','admin','operations','marketing','key_account'])
  );
create policy "contract_requests delete" on public.contract_requests for delete
  using (
    requested_by = auth.uid()
    or public.has_role(workspace_id, array['owner','admin','operations'])
  );


-- =========================================================
-- 4. TRIGGERS
-- =========================================================

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-add the workspace owner to workspace_members on every new workspace.
create or replace function public.add_workspace_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.add_workspace_owner_as_member();

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

create trigger update_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.update_updated_at();

create trigger update_projects_updated_at
  before update on public.projects
  for each row execute function public.update_updated_at();

create trigger update_pm_tasks_updated_at
  before update on public.pm_tasks
  for each row execute function public.update_updated_at();

create trigger update_comments_updated_at
  before update on public.comments
  for each row execute function public.update_updated_at();

create trigger update_clients_updated_at
  before update on public.clients
  for each row execute function public.update_updated_at();

create trigger update_client_brands_updated_at
  before update on public.client_brands
  for each row execute function public.update_updated_at();

create trigger update_managed_vendors_updated_at
  before update on public.managed_vendors
  for each row execute function public.update_updated_at();


-- =========================================================
-- 5. INDEXES
-- =========================================================

create index idx_pm_tasks_project        on public.pm_tasks(project_id);
create index idx_pm_tasks_assignee       on public.pm_tasks(assignee_id);
create index idx_pm_tasks_status         on public.pm_tasks(status);
create index idx_pm_tasks_due_date       on public.pm_tasks(due_date);
create index idx_pm_tasks_section        on public.pm_tasks(section_id);
create index idx_workspace_members_user  on public.workspace_members(user_id);
create index idx_workspace_members_ws    on public.workspace_members(workspace_id);
create index idx_comments_task           on public.comments(task_id);
create index idx_activity_workspace      on public.activity_log(workspace_id);
create index idx_activity_task           on public.activity_log(task_id);
create index idx_notifications_user      on public.notifications(user_id);
create index idx_notifications_unread    on public.notifications(user_id) where read = false;

-- contract app
create index idx_subtasks_task              on public.subtasks(task_id);
create index idx_bank_accounts_vendor       on public.bank_accounts(vendor_id);
create index idx_audit_logs_created         on public.audit_logs(created_at desc);
create index idx_generated_contracts_task   on public.generated_contracts(task_id);
create index idx_generated_contracts_at     on public.generated_contracts(generated_at desc);
create index idx_contract_requests_workspace on public.contract_requests(workspace_id);
create index idx_contract_requests_task      on public.contract_requests(pm_task_id);
create index idx_contract_requests_status    on public.contract_requests(status);


-- =========================================================
-- 6. (Optional) Wipe Supabase Auth users
-- =========================================================
-- Uncomment to wipe every signed-up user. If your Supabase plan blocks
-- deletes via SQL Editor, do it from Authentication → Users instead.
--
-- delete from auth.users;


-- ============================================================
-- DONE.
-- After running:
--   1. Restart the FastAPI backend (start.bat)
--   2. cd "New folder (3)" && npm install && npm run dev
--   3. Open http://localhost:3000 and sign up fresh
-- ============================================================
