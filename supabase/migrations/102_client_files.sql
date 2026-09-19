-- 102_client_files.sql
-- Proof-of-detail documents for clients (CR, VAT, national address, etc.),
-- mirroring the vendor_files setup (migration 030). Labeled "slots" say which
-- document a file is: 'cr', 'vat', 'national_address', 'other'.
--
-- Files live in the Supabase Storage bucket `client-files`; this table is the
-- index (who uploaded what, when, which slot). Idempotent - safe to re-run.

-- --- 1. Table ----------------------------------------------------------
create table if not exists public.client_files (
  id           uuid default gen_random_uuid() not null primary key,
  client_id    uuid not null references public.clients(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  file_size    bigint default 0 not null,
  mime_type    text default ''::text not null,
  uploaded_by  uuid references auth.users(id) on delete set null,
  uploaded_at  timestamptz default now() not null,
  slot         text default ''::text not null
);

create index if not exists idx_client_files_client_id
  on public.client_files using btree (client_id, uploaded_at desc);
create index if not exists idx_client_files_client_slot
  on public.client_files using btree (client_id, slot);
create unique index if not exists ux_client_files_storage_path
  on public.client_files using btree (storage_path);

-- --- 2. RLS - same shape as vendor_files -------------------------------
alter table public.client_files enable row level security;

drop policy if exists "client_files scoped read" on public.client_files;
drop policy if exists "client_files staff write" on public.client_files;

-- Read: staff, or the client themselves (their portal login).
create policy "client_files scoped read" on public.client_files
  for select using (
    public.is_staff() or exists (
      select 1 from public.external_users eu
      where eu.auth_user_id = auth.uid()
        and eu.role = 'client'
        and eu.client_id = client_files.client_id
    )
  );

-- Write (insert/update/delete): staff only.
create policy "client_files staff write" on public.client_files
  using (public.is_staff()) with check (public.is_staff());

-- --- 3. Storage bucket `client-files` ----------------------------------
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

drop policy if exists "client-files objects read"   on storage.objects;
drop policy if exists "client-files objects write"  on storage.objects;
drop policy if exists "client-files objects update" on storage.objects;
drop policy if exists "client-files objects delete" on storage.objects;

create policy "client-files objects read"
  on storage.objects for select using (bucket_id = 'client-files');
create policy "client-files objects write"
  on storage.objects for insert with check (bucket_id = 'client-files');
create policy "client-files objects update"
  on storage.objects for update using (bucket_id = 'client-files');
create policy "client-files objects delete"
  on storage.objects for delete using (bucket_id = 'client-files');

-- Verify:
-- select id, name, public from storage.buckets where id = 'client-files';
-- select count(*) from public.client_files;
