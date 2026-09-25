-- ============================================================
-- 139_every_bucket_the_app_uses_exists_in_a_file.sql
-- The storage buckets stop existing only in the live project.
--
-- -- WHAT THIS IS ABOUT ----------------------------------------------
--
-- The app reads and writes six buckets. Three of them were created by a
-- migration and three were made by hand in the dashboard:
--
--   client-files     102    in a file
--   legal-templates  115    in a file
--   legal-signed     117    in a file
--   contracts        --     made by hand, 1,245 objects in it
--   avatars          --     made by hand, policy added by 096
--   task-files       --     made by hand
--
-- A bucket that exists only in the live project is a bucket that will not
-- exist in the new one. The upload does not fail loudly on a missing bucket
-- either - the client returns "Bucket not found" to a catch that reports a
-- failed upload, and the screen says the file could not be saved. So the
-- three are created here, idempotently, before the move rather than after
-- the first person tries to attach something.
--
-- Nothing is dropped and nothing is renamed. On the live database this whole
-- file is a no-op: every insert conflicts, and the policy is recreated
-- exactly as 124's header recorded it.
--
-- -- WHAT IS DELIBERATELY NOT HERE ------------------------------------
--
-- The `avatars` and `task-files` POLICIES. 096 adds one select policy on
-- avatars and this file adds no others, because nobody has read the live
-- policy list and a policy invented from the app's behaviour is a guess
-- about who can read a file. The verify query at the bottom prints the
-- real set; whatever it shows that is not in a file belongs in 140.
--
-- The `contracts` service-role policy IS here, because 124's header quotes
-- it verbatim from the live database:
--
--   policyname                 | cmd | roles
--   contracts_service_role_all | ALL | {service_role}
--
-- service_role carries BYPASSRLS in Supabase, so this policy grants nothing
-- the backend did not already have. It is here because 124 asserts it is
-- there, and an assertion about a thing that exists in no file is an
-- assertion that stops being true the day the project moves.
-- ============================================================

-- 1. the three buckets ---------------------------------------------
--
-- All private. Every read in this app goes through a signed URL asked for
-- per download - see 115 and 117 - and a public bucket would make every
-- contract, avatar and attachment readable by URL alone, forever.
insert into storage.buckets (id, name, public) values
  ('contracts',  'contracts',  false),
  ('avatars',    'avatars',    false),
  ('task-files', 'task-files', false)
on conflict (id) do nothing;

-- 2. the backend's policy on the contracts bucket ------------------
drop policy if exists "contracts_service_role_all" on storage.objects;
create policy "contracts_service_role_all" on storage.objects
  for all to service_role
  using (bucket_id = 'contracts')
  with check (bucket_id = 'contracts');

-- 3. prove it, rather than trust it --------------------------------
--
-- Structural only, and true of an empty database and a full one alike: the
-- buckets are there, none of them is public, and the policy 124 checks for
-- exists and belongs to service_role. Nothing here counts objects - this
-- file is about the shape of a new project, not the contents of the old one.
do $$
declare
  n_buckets integer;
  n_public  integer;
  n_policy  integer;
begin
  select count(*) into n_buckets from storage.buckets
   where id in ('contracts', 'avatars', 'task-files',
                'client-files', 'legal-templates', 'legal-signed');
  if n_buckets <> 6 then
    raise exception 'storage: % of the 6 buckets the app uses exist', n_buckets;
  end if;

  select count(*) into n_public from storage.buckets
   where id in ('contracts', 'avatars', 'task-files',
                'client-files', 'legal-templates', 'legal-signed')
     and public;
  if n_public > 0 then
    raise exception 'storage: % bucket(s) are public - every object in them is readable by URL', n_public;
  end if;

  select count(*) into n_policy from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'contracts_service_role_all'
     and cmd = 'ALL'
     and roles::text like '%service_role%';
  if n_policy <> 1 then
    raise exception 'storage: the backend policy on the contracts bucket is not there as written (found %)', n_policy;
  end if;

  raise notice 'storage: six buckets, none public, and the backend policy is in a file';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select id, public from storage.buckets order by id;
-- expected: six rows, public false on every one
--
-- And this one, whose answer belongs in 140 - it prints every policy on
-- storage.objects in the LIVE project, including the ones nobody has written
-- down:
-- select policyname, cmd, roles::text, qual
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--  order by policyname;
