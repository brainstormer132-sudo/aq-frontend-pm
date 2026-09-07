-- ============================================================
-- 062_avatars_storage.sql
-- Somewhere to put a profile picture.
--
-- `profiles.avatar_url` has existed since 002 and nothing has ever written
-- to it, so every person in the app is a coloured circle with their initials
-- in it. The Avatar component already renders the picture when there is one
-- — all that was missing was a bucket to put it in.
--
-- Path convention:  {user_id}/{uuid}.{ext}
-- The first segment is the owner, and that is what the policies key on: you
-- can only write inside your own folder, whatever you name the file.
--
-- ─── On the bucket being public ─────────────────────────────────
-- It is. `<img src>` cannot carry an auth header, so a private bucket would
-- mean minting a signed URL for every face on every screen and refreshing
-- them before they expire — a lot of machinery for a headshot people
-- chose to upload. Anyone holding the URL can see the picture; nothing else
-- in this project is public, and the URLs are unguessable (a uuid inside a
-- uuid). Do not put anything in here that is not a profile picture.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,                              -- 2 MB. A face does not need more.
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_select" on storage.objects;
drop policy if exists "avatars_insert" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;
drop policy if exists "avatars_delete" on storage.objects;

-- READ: anyone. That is what "public bucket" means; stated explicitly so
-- nobody has to go looking for why it works.
create policy "avatars_select"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- WRITE: only inside your own folder. The path's first segment must be your
-- own user id, so no one can overwrite a colleague's face.
create policy "avatars_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );

create policy "avatars_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );

create policy "avatars_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (string_to_array(name, '/'))[1] = auth.uid()::text
  );

-- ─── Verification ───────────────────────────────────────────────
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'avatars';
-- Expect one row: public = true, 2097152 bytes, four image types.

select polname from pg_policy
 where polrelid = 'storage.objects'::regclass
   and polname like 'avatars_%'
 order by polname;
-- Expect four: avatars_delete, avatars_insert, avatars_select, avatars_update.

-- profiles already allows a person to edit their own row (002). Confirm:
select polname from pg_policy
 where polrelid = 'public.profiles'::regclass
 order by polname;
-- Expect "profiles update own" among them. Without it the name and job
-- title would save silently to nothing.
