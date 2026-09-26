-- ============================================================
-- 140_client_documents_stop_being_readable_by_the_anon_key.sql
-- The four policies on the client-files bucket say who.
--
-- -- WHAT IS WRONG -------------------------------------------------
--
-- 102 created the bucket and its four policies like this:
--
--   create policy "client-files objects read"
--     on storage.objects for select using (bucket_id = 'client-files');
--
-- There is no TO clause. A policy with no TO clause is TO PUBLIC, and
-- PUBLIC includes `anon`. The live policy list says so out loud - every
-- other bucket in this project reads {authenticated} and this one reads
-- {public}:
--
--   client-files objects read    | SELECT | {public}
--   legal-signed read            | SELECT | {authenticated}
--   vendor-files objects read    | SELECT | {authenticated}
--
-- `anon` is the key that ships inside the browser bundle. It is public by
-- design and it is not a secret. What is behind these four policies is the
-- client document store - trade licences, VAT certificates, whatever gets
-- attached to a client, up to 25 MB a file - and the policies let that key
-- list the bucket, download from it, overwrite it and delete from it.
--
-- -- WHO SHOULD HAVE IT --------------------------------------------
--
-- public.is_staff(), which is a row in workspace_members. That is not a
-- guess about the audience: client-files is touched by exactly one screen,
-- ClientsView, which is an internal screen, and nothing under app/client/
-- or lib/portal-api.ts references the bucket or the client_files table at
-- all. So the people who use it are workspace members, and the predicate
-- that says "workspace member" is the one 124 already uses on the
-- contracts bucket.
--
-- `authenticated` alone would NOT be enough. Vendors and clients sign in
-- to their portals through Supabase auth, so they are authenticated and
-- they are not in workspace_members. is_staff() is the line that matches
-- who the screen is for.
--
-- -- WHAT THIS DOES NOT DO -----------------------------------------
--
-- It does not touch any other bucket. The avatars, task-files and
-- vendor-files policies are scoped to {authenticated} already, and porting
-- them into files is 141's job - they have WITH CHECK expressions that
-- nobody has read yet, and a policy written from the outside is a guess
-- about who can upload.
-- ============================================================

-- 1. the bucket vendor-files, which 139 missed ---------------------
--
-- 139 created the three buckets the app uses that were made by hand.
-- There were four: hooks/use-workflow.ts uploads to vendor-files and that
-- bucket is in no file either.
insert into storage.buckets (id, name, public)
values ('vendor-files', 'vendor-files', false)
on conflict (id) do nothing;

-- 2. client-files, said properly -----------------------------------
drop policy if exists "client-files objects read"   on storage.objects;
drop policy if exists "client-files objects write"  on storage.objects;
drop policy if exists "client-files objects update" on storage.objects;
drop policy if exists "client-files objects delete" on storage.objects;

create policy "client-files objects read" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-files' and public.is_staff());

create policy "client-files objects write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-files' and public.is_staff());

create policy "client-files objects update" on storage.objects
  for update to authenticated
  using (bucket_id = 'client-files' and public.is_staff())
  with check (bucket_id = 'client-files' and public.is_staff());

create policy "client-files objects delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-files' and public.is_staff());

-- 3. prove it, rather than trust it --------------------------------
--
-- Structural, so it holds on an empty database and a full one alike: all
-- four policies exist, NONE of them is open to public or anon, and every
-- one of them names is_staff(). The last part is what stops a future edit
-- from widening this back to "any logged-in person" without noticing that
-- a vendor portal account is a logged-in person.
do $$
declare
  n_all    integer;
  n_open   integer;
  n_staff  integer;
begin
  select count(*) into n_all from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'client-files objects %';
  if n_all <> 4 then
    raise exception 'storage: expected 4 client-files policies, found %', n_all;
  end if;

  select count(*) into n_open from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'client-files objects %'
     and (roles::text like '%public%' or roles::text like '%anon%');
  if n_open > 0 then
    raise exception
      'storage: % client-files policy(ies) are still open to the anon key', n_open;
  end if;

  select count(*) into n_staff from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'client-files objects %'
     and coalesce(qual, '') || coalesce(with_check, '') like '%is_staff%';
  if n_staff <> 4 then
    raise exception
      'storage: only % of the 4 client-files policies ask whether you are staff', n_staff;
  end if;

  raise notice 'storage: client documents are staff-only, and the anon key cannot see them';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select policyname, cmd, roles::text, qual, with_check
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and policyname like 'client-files objects %'
--  order by policyname;
-- expected: four rows, roles {authenticated} on every one, is_staff() in
--           the qual or the with_check of every one
--
-- And, to see it from the outside: open the app signed out and ask the
-- storage API to list the bucket with the anon key. Before this migration
-- it answers with the objects. After it, it answers with nothing.
