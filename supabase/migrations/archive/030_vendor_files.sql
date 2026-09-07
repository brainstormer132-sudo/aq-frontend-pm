-- ============================================================
-- 030 — Vendor files
--
-- One simple file list per vendor — any file type, no categories.
-- Files live in the Supabase Storage bucket `vendor-files`; this
-- migration creates the bucket if it doesn't already exist, the
-- public.vendor_files table that mirrors the storage object with
-- friendly metadata, and the RLS policies that let any signed-in
-- workspace user upload/read/delete.
--
-- Storage path convention: `{vendor_id}/{uuid}-{original_filename}`
-- (assembled in app code, not enforced by the DB). Files are NOT
-- public — they go through signed URLs.
--
-- Size cap (25 MB) is enforced in the frontend uploader, not here.
--
-- Run in Supabase SQL Editor.
-- ============================================================


-- ─── 1. vendor_files metadata table ─────────────────────────────────
create table if not exists public.vendor_files (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     bigint not null references public.vendors(id) on delete cascade,
  storage_path  text   not null,
  file_name     text   not null,
  file_size     bigint not null default 0,
  mime_type     text   not null default '',
  uploaded_by   uuid   references auth.users(id) on delete set null,
  uploaded_at   timestamptz not null default now()
);

create index if not exists idx_vendor_files_vendor_id
  on public.vendor_files (vendor_id, uploaded_at desc);

create unique index if not exists ux_vendor_files_storage_path
  on public.vendor_files (storage_path);

alter table public.vendor_files enable row level security;

-- Anyone signed in (including anon for the current portal model) can do
-- anything on this table. The contract / PM apps already trust the
-- session-level role check at the UI; the DB is permissive to match
-- everything else in the schema. Tighten when workspace-scoped RLS
-- lands across the rest of the codebase.
drop policy if exists "vendor_files read"   on public.vendor_files;
drop policy if exists "vendor_files write"  on public.vendor_files;
drop policy if exists "vendor_files update" on public.vendor_files;
drop policy if exists "vendor_files delete" on public.vendor_files;

create policy "vendor_files read"   on public.vendor_files for select using (true);
create policy "vendor_files write"  on public.vendor_files for insert with check (true);
create policy "vendor_files update" on public.vendor_files for update using (true);
create policy "vendor_files delete" on public.vendor_files for delete using (true);

grant select, insert, update, delete on public.vendor_files to anon, authenticated;


-- ─── 2. Storage bucket `vendor-files` ───────────────────────────────
-- Idempotent: skips if the bucket already exists.
insert into storage.buckets (id, name, public)
values ('vendor-files', 'vendor-files', false)
on conflict (id) do nothing;


-- ─── 3. Storage object policies ─────────────────────────────────────
-- Storage policies live on the `storage.objects` table, scoped per
-- bucket via the bucket_id column. We mirror the table policy
-- above: any session can read/upload/update/delete its own bucket
-- objects.
drop policy if exists "vendor-files objects read"   on storage.objects;
drop policy if exists "vendor-files objects write"  on storage.objects;
drop policy if exists "vendor-files objects update" on storage.objects;
drop policy if exists "vendor-files objects delete" on storage.objects;

create policy "vendor-files objects read"
  on storage.objects for select
  using (bucket_id = 'vendor-files');

create policy "vendor-files objects write"
  on storage.objects for insert
  with check (bucket_id = 'vendor-files');

create policy "vendor-files objects update"
  on storage.objects for update
  using (bucket_id = 'vendor-files');

create policy "vendor-files objects delete"
  on storage.objects for delete
  using (bucket_id = 'vendor-files');


-- ─── 4. Verification (run by hand) ──────────────────────────────────
-- select * from public.vendor_files order by uploaded_at desc limit 20;
-- select id, name, public from storage.buckets where id = 'vendor-files';
-- select count(*) from storage.objects where bucket_id = 'vendor-files';
