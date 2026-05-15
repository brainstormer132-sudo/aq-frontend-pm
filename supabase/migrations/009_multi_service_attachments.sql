-- ============================================================
-- Phase 3 schema: multi service types per task + attachments
-- ============================================================

-- ----- Multi-service-types junction -----
create table if not exists public.task_service_types (
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  position int default 0,
  added_at timestamptz default now(),
  primary key (task_id, service_type_id)
);
alter table public.task_service_types enable row level security;

drop policy if exists "task_service_types select" on public.task_service_types;
drop policy if exists "task_service_types write"  on public.task_service_types;

create policy "task_service_types select" on public.task_service_types for select
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );
create policy "task_service_types write" on public.task_service_types for all
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing'])
  );

-- Backfill: copy existing single service_type_id into the junction.
insert into public.task_service_types (task_id, service_type_id)
select id, service_type_id from public.pm_tasks
where service_type_id is not null
on conflict do nothing;


-- ----- Task attachments -----
-- file_url can be a Supabase Storage path OR an external URL (Drive / Dropbox / etc).
create table if not exists public.task_attachments (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  uploader_id uuid references public.profiles(id) on delete set null,
  filename text not null,
  file_url text not null,
  file_size bigint,
  mime_type text,
  created_at timestamptz default now()
);
create index if not exists idx_task_attachments_task on public.task_attachments(task_id);

alter table public.task_attachments enable row level security;

drop policy if exists "task_attachments select" on public.task_attachments;
drop policy if exists "task_attachments insert" on public.task_attachments;
drop policy if exists "task_attachments delete" on public.task_attachments;

-- Anyone with workspace access can see attachments.
create policy "task_attachments select" on public.task_attachments for select
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );
-- Any role with access can attach; uploader must be the calling user.
create policy "task_attachments insert" on public.task_attachments for insert
  with check (
    auth.uid() = uploader_id
    and public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );
-- Uploader can remove their own; admins/operations can remove any.
create policy "task_attachments delete" on public.task_attachments for delete
  using (
    auth.uid() = uploader_id
    or public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations'])
  );


-- ----- Comments delete: allow admins to clean up too -----
drop policy if exists "comments delete own"          on public.comments;
drop policy if exists "comments delete own or admin" on public.comments;
create policy "comments delete own or admin" on public.comments for delete
  using (
    auth.uid() = author_id
    or public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations'])
  );

-- ============================================================
-- DONE.
-- ============================================================
