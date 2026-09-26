-- No policy on a storage bucket may be open to the anon key.
--
-- THE BUG THIS FREEZES: migration 102 created the client-files bucket with
-- four policies and no TO clause. A policy with no TO clause is TO PUBLIC,
-- and PUBLIC includes anon - the key that ships inside the browser bundle
-- and is public by design. Behind those four policies is the client
-- document store: trade licences, VAT certificates, anything attached to a
-- client. Anon could list it, download it, overwrite it and delete from it.
-- Every other bucket in the project was already scoped to authenticated,
-- so it was one policy family out of step and nothing said so for months.
-- 140 fixed it; this is what keeps it fixed.
--
-- The rule is deliberately blunt: a bucket policy names a role. Writing
-- `create policy ... on storage.objects for select using (...)` and leaving
-- the TO clause off is the whole mistake, and it is invisible in a diff
-- unless you already know to look for what is NOT there.
--
-- service_role is exempt: it carries BYPASSRLS anyway, and a policy naming
-- it is documentation of what the backend does, not a grant to anybody.

do $$
declare
  n    integer;
  bad  text;
begin
  select count(*), string_agg(policyname, ', ' order by policyname)
    into n, bad
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and (roles::text like '%public%' or roles::text like '%anon%');

  if n > 0 then
    raise exception
      'storage: % policy(ies) on storage.objects are open to the anon key: %. '
      'A bucket policy must name its role - anon is the key in the browser '
      'bundle, so TO PUBLIC means anybody at all.', n, bad;
  end if;
end $$;
