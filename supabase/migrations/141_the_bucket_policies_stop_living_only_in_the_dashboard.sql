-- ============================================================
-- 141_the_bucket_policies_stop_living_only_in_the_dashboard.sql
-- Eleven policies, copied out of the live project and into a file.
--
-- -- WHY --------------------------------------------------------------
--
-- 139 and 140 put the four hand-made BUCKETS into files. Their POLICIES
-- were still only in the dashboard, which means a new Supabase project
-- would get the buckets and no rules about them - and a bucket with RLS on
-- and no policy is a bucket nobody can read or write at all. Avatars would
-- stop uploading, task attachments would stop uploading, vendor files
-- would stop uploading, and every one of those fails as a storage error
-- with no clue in it about a missing policy.
--
-- These eleven are transcribed from `pg_policies` on the live database on
-- 26 September, not invented. The three buckets they cover are the three
-- this app actually names in its code:
--
--   avatars       4 policies   hooks/use-workflow.ts
--   task-files    3 policies   hooks/use-workflow.ts
--   vendor-files  4 policies   hooks/use-workflow.ts
--
-- On the live database this file is a no-op in effect: each policy is
-- dropped and recreated with the predicate it already has.
--
-- -- WHAT IS NOT HERE, AND WHY ----------------------------------------
--
-- The live project also has policies on three buckets this repository
-- never names: vendor-docs (allow_read, allow_upload, vendor_docs_all),
-- client-docs (client_docs_all, client_docs_read, client_docs_upload) and
-- templates (templates_service_role_all). They are almost certainly the
-- retired contract app's.
--
-- Porting them would be writing rules for something nothing in this
-- codebase reads. Whether those three buckets travel is a decision about
-- DATA - is there anything in them worth keeping - and it should be made
-- by looking in them, not by a migration that quietly carries them along.
--
-- -- ON `allow_upload` -------------------------------------------------
--
-- Worth recording because it was worried about and turned out fine. Its
-- USING is null, which looked like an INSERT policy with no bucket named -
-- any signed-in person uploading into any bucket. An INSERT policy has no
-- USING at all; the whole predicate is WITH CHECK, and its WITH CHECK is
-- `bucket_id = 'vendor-docs'`. It is scoped. A null `qual` on an INSERT
-- row is the normal shape, not a hole.
--
-- -- ON `UPDATE` AND `WITH CHECK` ---------------------------------------
--
-- The two UPDATE policies below are written with USING only, which is what
-- the live ones are: when an UPDATE policy has no WITH CHECK, Postgres
-- uses the USING expression for the new row as well. Spelling it once
-- keeps the two halves from drifting apart later.
-- ============================================================

-- 1. avatars -------------------------------------------------------
--
-- Read by any signed-in person - a profile picture is the one thing here
-- that is not confidential, and the bucket is public anyway (139). Write,
-- change and delete only inside the folder named after your own user id,
-- which is what stops one person replacing another's picture.
drop policy if exists "avatars_select" on storage.objects;
drop policy if exists "avatars_insert" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;
drop policy if exists "avatars_delete" on storage.objects;

create policy "avatars_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

create policy "avatars_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
              and (string_to_array(name, '/'))[1] = (auth.uid())::text);

create policy "avatars_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars'
         and (string_to_array(name, '/'))[1] = (auth.uid())::text);

create policy "avatars_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars'
         and (string_to_array(name, '/'))[1] = (auth.uid())::text);

-- 2. task-files ----------------------------------------------------
--
-- The first path segment is the WORKSPACE id, so the predicate reads "you
-- hold a role in the workspace this file belongs to". Read and write are
-- open to every role including member; delete is narrower - owner, admin
-- and marketing, or the person who attached it in the first place.
--
-- There is deliberately no UPDATE policy. The live project has none, and
-- an attachment is replaced by uploading another one, not by rewriting the
-- bytes under a name somebody already has a link to.
drop policy if exists "task_files_select" on storage.objects;
drop policy if exists "task_files_insert" on storage.objects;
drop policy if exists "task_files_delete" on storage.objects;

create policy "task_files_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'task-files'
         and public.has_role(((string_to_array(name, '/'))[1])::uuid,
                             array['owner', 'admin', 'marketing',
                                   'sales', 'key_account', 'member']));

create policy "task_files_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-files'
              and public.has_role(((string_to_array(name, '/'))[1])::uuid,
                                  array['owner', 'admin', 'marketing',
                                        'sales', 'key_account', 'member']));

create policy "task_files_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-files'
         and (public.has_role(((string_to_array(name, '/'))[1])::uuid,
                              array['owner', 'admin', 'marketing'])
              or exists (select 1 from public.task_attachments ta
                          where ta.file_url like '%' || storage.objects.name
                            and ta.uploader_id = auth.uid())));

-- 3. vendor-files --------------------------------------------------
--
-- Any signed-in person, which is what the live policies say. Note that
-- this is BROADER than the vendor_files TABLE beside it, whose read policy
-- is `is_staff() or the vendor themselves`. Left as found: narrowing a
-- live policy is a change to who can do their job, and it belongs in its
-- own migration with somebody deciding it, not smuggled into a transcription.
drop policy if exists "vendor-files objects read"   on storage.objects;
drop policy if exists "vendor-files objects write"  on storage.objects;
drop policy if exists "vendor-files objects update" on storage.objects;
drop policy if exists "vendor-files objects delete" on storage.objects;

create policy "vendor-files objects read" on storage.objects
  for select to authenticated using (bucket_id = 'vendor-files');
create policy "vendor-files objects write" on storage.objects
  for insert to authenticated with check (bucket_id = 'vendor-files');
create policy "vendor-files objects update" on storage.objects
  for update to authenticated using (bucket_id = 'vendor-files');
create policy "vendor-files objects delete" on storage.objects
  for delete to authenticated using (bucket_id = 'vendor-files');

-- 4. prove it, rather than trust it --------------------------------
--
-- Structural, so it holds on an empty database and a full one alike.
do $$
declare
  n_all   integer;
  n_open  integer;
  n_own   integer;
begin
  select count(*) into n_all from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('avatars_select', 'avatars_insert', 'avatars_update',
                        'avatars_delete', 'task_files_select',
                        'task_files_insert', 'task_files_delete',
                        'vendor-files objects read', 'vendor-files objects write',
                        'vendor-files objects update', 'vendor-files objects delete');
  if n_all <> 11 then
    raise exception 'storage: expected 11 ported policies, found %', n_all;
  end if;

  -- None of them may be open to the key in the browser bundle. 080 says
  -- this for the whole table; saying it here too means the migration that
  -- introduces a policy is the thing that catches it, not a test run later.
  select count(*) into n_open from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and (roles::text like '%public%' or roles::text like '%anon%');
  if n_open > 0 then
    raise exception 'storage: % policy(ies) are open to the anon key', n_open;
  end if;

  -- The three avatars policies that write must all pin the caller to their
  -- own folder. Losing that turns "change your picture" into "change
  -- anybody's picture", and it is one dropped clause away.
  select count(*) into n_own from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('avatars_insert', 'avatars_update', 'avatars_delete')
     and coalesce(qual, '') || coalesce(with_check, '') like '%auth.uid()%';
  if n_own <> 3 then
    raise exception
      'storage: only % of the 3 avatars write policies tie the file to its owner', n_own;
  end if;

  raise notice 'storage: the avatars, task-files and vendor-files policies are in a file';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select policyname, cmd, roles::text
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--  order by policyname;
-- expected: the eleven above, all {authenticated}, alongside the
--           client-files, legal-signed, legal-templates, contracts and
--           service-role policies that were already in files
