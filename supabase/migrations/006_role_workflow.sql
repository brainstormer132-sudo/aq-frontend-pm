-- ============================================================
-- Phase 1 — Role-based task workflow
-- ============================================================
-- Adds the data model for the Sales → Marketing → Key account →
-- Member workflow described in the project vision.
--
-- Adds:
--   • Roles: sales, marketing, operations, key_account (in addition to
--     owner / admin / member). Drops manager + guest, remaps any rows.
--   • task_stage enum on pm_tasks.
--   • New pm_tasks columns: workspace_id, brand_name, sales_closer_id,
--     key_account_id, service_type_id, budget, stage, legacy_client_id.
--   • service_types + service_type_steps tables, seeded with the nine
--     service-type checklists from the project doc.
--   • has_role(ws_id, roles[]) SECURITY DEFINER helper.
--
-- Run this in Supabase SQL Editor.
-- ============================================================


-- =========================================================
-- 1. Expand the role check constraint on workspace_members
-- =========================================================
update public.workspace_members set role = 'key_account' where role = 'manager';
update public.workspace_members set role = 'member'      where role = 'guest';

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner','admin','operations','sales','marketing','key_account','member'));


-- =========================================================
-- 2. Helper function: has_role(workspace_id, roles[])
-- =========================================================
create or replace function public.has_role(ws_id uuid, role_names text[])
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
      and role = any(role_names)
  );
$$;


-- =========================================================
-- 3. task_stage enum
-- =========================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_stage') then
    create type task_stage as enum (
      'draft',              -- sales is filling, not yet submitted
      'pending_marketing',  -- sales submitted; marketing must triage (priority, service)
      'in_progress',        -- service-type chosen, subtasks live, members working
      'awaiting_review',    -- members done; key account reviewing
      'completed'           -- key account approved; marketing notified
    );
  end if;
end $$;


-- =========================================================
-- 4. service_types + service_type_steps
-- =========================================================
create table if not exists public.service_types (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  icon text default '🎯',
  description text,
  is_template boolean default false,
  position int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_service_types_ws on public.service_types(workspace_id);

create table if not exists public.service_type_steps (
  id uuid primary key default uuid_generate_v4(),
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  position int not null default 0,
  title text not null,
  description text,
  created_at timestamptz default now(),
  unique (service_type_id, position)
);
create index if not exists idx_service_type_steps_st on public.service_type_steps(service_type_id);

alter table public.service_types       enable row level security;
alter table public.service_type_steps  enable row level security;

drop policy if exists "service_types select"            on public.service_types;
drop policy if exists "service_types write by admin"    on public.service_types;
drop policy if exists "service_type_steps select"       on public.service_type_steps;
drop policy if exists "service_type_steps write admin"  on public.service_type_steps;

-- Templates (workspace_id IS NULL) are visible to anyone authed.
-- Custom service types belong to a workspace and follow membership rules.
create policy "service_types select" on public.service_types for select
  using (workspace_id is null or public.is_member_of(workspace_id));
create policy "service_types write by admin" on public.service_types for all
  using (workspace_id is not null and public.is_admin_of(workspace_id));

create policy "service_type_steps select" on public.service_type_steps for select
  using (
    exists (
      select 1 from public.service_types s
      where s.id = service_type_steps.service_type_id
        and (s.workspace_id is null or public.is_member_of(s.workspace_id))
    )
  );
create policy "service_type_steps write admin" on public.service_type_steps for all
  using (
    exists (
      select 1 from public.service_types s
      where s.id = service_type_steps.service_type_id
        and s.workspace_id is not null
        and public.is_admin_of(s.workspace_id)
    )
  );

create trigger update_service_types_updated_at
  before update on public.service_types
  for each row execute function public.update_updated_at();


-- =========================================================
-- 5. Seed the 9 system templates
-- =========================================================
insert into public.service_types (id, workspace_id, name, is_template, icon, position) values
  ('00000000-0000-0000-aaaa-000000000001', null, 'Marketing Strategy',   true, '🎯', 1),
  ('00000000-0000-0000-aaaa-000000000002', null, 'Influencers Campaign', true, '🌟', 2),
  ('00000000-0000-0000-aaaa-000000000003', null, 'Billboards',           true, '🛣️', 3),
  ('00000000-0000-0000-aaaa-000000000004', null, 'Sponsorship',          true, '🤝', 4),
  ('00000000-0000-0000-aaaa-000000000005', null, 'Creative Department',  true, '🎨', 5),
  ('00000000-0000-0000-aaaa-000000000006', null, 'Social Media',         true, '📱', 6),
  ('00000000-0000-0000-aaaa-000000000007', null, 'Branding',             true, '🪪', 7),
  ('00000000-0000-0000-aaaa-000000000008', null, 'Media Production',     true, '🎬', 8),
  ('00000000-0000-0000-aaaa-000000000009', null, 'Event',                true, '🎤', 9)
on conflict (id) do nothing;

insert into public.service_type_steps (service_type_id, position, title) values
  -- Marketing Strategy
  ('00000000-0000-0000-aaaa-000000000001', 1, 'Ask for contract'),
  ('00000000-0000-0000-aaaa-000000000001', 2, 'Research, building, and strategy'),
  ('00000000-0000-0000-aaaa-000000000001', 3, 'Review and approval'),
  -- Influencers Campaign
  ('00000000-0000-0000-aaaa-000000000002', 1, 'Platform'),
  ('00000000-0000-0000-aaaa-000000000002', 2, 'Ad type'),
  ('00000000-0000-0000-aaaa-000000000002', 3, 'Choose vendors (with platform link)'),
  ('00000000-0000-0000-aaaa-000000000002', 4, 'Budget distribution'),
  ('00000000-0000-0000-aaaa-000000000002', 5, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000002', 6, 'Ask for contracts'),
  -- Billboards
  ('00000000-0000-0000-aaaa-000000000003', 1, 'Initiate the proposal'),
  ('00000000-0000-0000-aaaa-000000000003', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000003', 3, 'Vendoring and contracts'),
  -- Sponsorship
  ('00000000-0000-0000-aaaa-000000000004', 1, 'Type of sponsorship'),
  ('00000000-0000-0000-aaaa-000000000004', 2, 'Initiate the proposal'),
  ('00000000-0000-0000-aaaa-000000000004', 3, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000004', 4, 'Contract'),
  -- Creative Department
  ('00000000-0000-0000-aaaa-000000000005', 1, 'Type of service'),
  ('00000000-0000-0000-aaaa-000000000005', 2, 'Research'),
  ('00000000-0000-0000-aaaa-000000000005', 3, 'Create a proposal'),
  ('00000000-0000-0000-aaaa-000000000005', 4, 'Vendoring'),
  ('00000000-0000-0000-aaaa-000000000005', 5, 'Contracting'),
  -- Social Media
  ('00000000-0000-0000-aaaa-000000000006', 1, 'Content calendar'),
  ('00000000-0000-0000-aaaa-000000000006', 2, 'Send request to media production'),
  ('00000000-0000-0000-aaaa-000000000006', 3, 'Approved assets'),
  ('00000000-0000-0000-aaaa-000000000006', 4, 'Graphic design'),
  ('00000000-0000-0000-aaaa-000000000006', 5, 'Review and approval (c)'),
  ('00000000-0000-0000-aaaa-000000000006', 6, 'Posting'),
  ('00000000-0000-0000-aaaa-000000000006', 7, 'Proof of post'),
  ('00000000-0000-0000-aaaa-000000000006', 8, 'Vendor payment'),
  -- Branding
  ('00000000-0000-0000-aaaa-000000000007', 1, 'Create a proposal'),
  ('00000000-0000-0000-aaaa-000000000007', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000007', 3, 'Contracts'),
  ('00000000-0000-0000-aaaa-000000000007', 4, 'Graphic design'),
  ('00000000-0000-0000-aaaa-000000000007', 5, 'Review and approval (c)'),
  -- Media Production
  ('00000000-0000-0000-aaaa-000000000008', 1, 'Execution'),
  ('00000000-0000-0000-aaaa-000000000008', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000008', 3, 'Archiving'),
  -- Event
  ('00000000-0000-0000-aaaa-000000000009', 1, 'Initiate a proposal'),
  ('00000000-0000-0000-aaaa-000000000009', 2, 'Review and approval'),
  ('00000000-0000-0000-aaaa-000000000009', 3, 'Contracting'),
  ('00000000-0000-0000-aaaa-000000000009', 4, 'Execution'),
  ('00000000-0000-0000-aaaa-000000000009', 5, 'Submission of videos')
on conflict do nothing;


-- =========================================================
-- 6. New columns on pm_tasks
-- =========================================================
-- workspace_id: stamped on every task so RLS can evaluate without
-- joining through projects (sales tasks have no project yet).
alter table public.pm_tasks add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- Make project_id nullable so a task can exist before being filed under a project.
alter table public.pm_tasks alter column project_id drop not null;

-- Sales-stage fields
alter table public.pm_tasks add column if not exists task_name        text;
alter table public.pm_tasks add column if not exists brand_name       text;
alter table public.pm_tasks add column if not exists legacy_client_id text;       -- "Client id / name" from the sketch
alter table public.pm_tasks add column if not exists sales_closer_id  uuid references public.profiles(id);
alter table public.pm_tasks add column if not exists budget           numeric(14,2);

-- Marketing-stage fields
alter table public.pm_tasks add column if not exists service_type_id  uuid references public.service_types(id);
alter table public.pm_tasks add column if not exists key_account_id   uuid references public.profiles(id);

-- Workflow stage
alter table public.pm_tasks add column if not exists stage task_stage default 'draft';

create index if not exists idx_pm_tasks_workspace      on public.pm_tasks(workspace_id);
create index if not exists idx_pm_tasks_stage          on public.pm_tasks(stage);
create index if not exists idx_pm_tasks_service_type   on public.pm_tasks(service_type_id);
create index if not exists idx_pm_tasks_key_account    on public.pm_tasks(key_account_id);


-- =========================================================
-- 7. RLS for pm_tasks — role-aware
-- =========================================================
-- A task is visible if:
--   • The user belongs to its workspace (any role except gated members);
--   • OR the user is a member-role assignee of the task itself;
--   • OR the user created it (always sees own work).
-- Admins/owners/operations/marketing always see everything.

drop policy if exists "pm_tasks select if project visible"  on public.pm_tasks;
drop policy if exists "pm_tasks insert by member"           on public.pm_tasks;
drop policy if exists "pm_tasks update by participant"      on public.pm_tasks;
drop policy if exists "pm_tasks delete by admin"            on public.pm_tasks;

create policy "pm_tasks select" on public.pm_tasks for select
  using (
    -- Privileged roles see all tasks in the workspace
    public.has_role(workspace_id, array['owner','admin','operations','marketing','sales','key_account'])
    -- Members only see tasks they're assigned to (assignee or in task_members)
    or assignee_id = auth.uid()
    or creator_id  = auth.uid()
    or exists (select 1 from public.task_members tm where tm.task_id = pm_tasks.id and tm.user_id = auth.uid())
  );

create policy "pm_tasks insert" on public.pm_tasks for insert
  with check (
    public.has_role(workspace_id, array['owner','admin','operations','sales','marketing'])
  );

create policy "pm_tasks update" on public.pm_tasks for update
  using (
    -- Owners/admins/operations: full edit
    public.has_role(workspace_id, array['owner','admin','operations'])
    -- Marketing: can edit during their stage (priority, service_type, key_account, stage)
    or public.has_role(workspace_id, array['marketing'])
    -- Sales: can edit only their draft tasks
    or (public.has_role(workspace_id, array['sales']) and stage = 'draft' and creator_id = auth.uid())
    -- Key account: can edit tasks assigned to them
    or (key_account_id = auth.uid())
    -- Member: can update task they're directly assigned to (mark done on their subtask)
    or assignee_id = auth.uid()
  );

create policy "pm_tasks delete" on public.pm_tasks for delete
  using (public.has_role(workspace_id, array['owner','admin']));


-- =========================================================
-- 8. Notification helper: notify all members with a given role
-- =========================================================
create or replace function public.notify_role(
  ws_id uuid,
  role_names text[],
  n_type notification_type,
  n_title text,
  n_body text default null,
  n_link text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select wm.user_id, n_type, n_title, n_body, n_link
  from public.workspace_members wm
  where wm.workspace_id = ws_id
    and wm.role = any(role_names);
end;
$$;


-- =========================================================
-- 9. Trigger: stage transitions auto-notify the right group
-- =========================================================
create or replace function public.on_pm_task_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- New task or stage moved to pending_marketing → notify marketing role
  if (tg_op = 'INSERT' and new.stage = 'pending_marketing')
     or (tg_op = 'UPDATE' and new.stage = 'pending_marketing' and old.stage is distinct from 'pending_marketing') then
    perform public.notify_role(
      new.workspace_id,
      array['marketing','admin','owner']::text[],
      'task_assigned'::notification_type,
      'New task awaits triage',
      coalesce(new.task_name, new.title) || ' for ' || coalesce(new.brand_name, '(no brand)'),
      '/dashboard/workflow?task=' || new.id::text
    );
  end if;

  -- Stage moved to in_progress → notify the assigned key account
  if tg_op = 'UPDATE' and new.stage = 'in_progress' and old.stage is distinct from 'in_progress' and new.key_account_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      new.key_account_id,
      'task_assigned',
      'You are the key account on a new task',
      coalesce(new.task_name, new.title),
      '/dashboard/workflow?task=' || new.id::text
    );
  end if;

  -- Stage moved to completed → notify marketing
  if tg_op = 'UPDATE' and new.stage = 'completed' and old.stage is distinct from 'completed' then
    perform public.notify_role(
      new.workspace_id,
      array['marketing','admin','owner']::text[],
      'task_completed'::notification_type,
      'Task completed',
      coalesce(new.task_name, new.title) || ' for ' || coalesce(new.brand_name, '(no brand)'),
      '/dashboard/workflow?task=' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists pm_task_stage_change on public.pm_tasks;
create trigger pm_task_stage_change
  after insert or update of stage on public.pm_tasks
  for each row execute function public.on_pm_task_stage_change();


-- ============================================================
-- DONE.
-- After running, verify with:
--   select
--     (select count(*) from public.service_types where is_template) as service_types,
--     (select count(*) from public.service_type_steps)              as steps,
--     (select count(*) from information_schema.columns
--        where table_name='pm_tasks' and column_name='stage')        as has_stage_col;
-- Expected: 9 / 42 / 1.
-- (Step total = 3+6+3+4+5+8+5+3+5 across the nine service types.)
-- ============================================================
