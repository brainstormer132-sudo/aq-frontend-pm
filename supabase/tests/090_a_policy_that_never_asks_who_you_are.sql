-- A policy open to PUBLIC must ask who you are, or be named here.
--
-- THE BUG THIS FREEZES: the client-files bucket (102, fixed by 140) had
-- four policies with no TO clause and a predicate that was nothing but
-- `bucket_id = 'client-files'`. No TO clause means TO PUBLIC, PUBLIC
-- includes anon, and the predicate never asked who was asking - so the key
-- in the browser bundle could read the client document store. What was
-- wrong was a clause that WAS NOT THERE, which no diff shows you.
--
-- 080 covers storage.objects. This covers everything else, because the
-- same two-line mistake is available on every table in the schema.
--
-- WHAT IS ACTUALLY FINE, AND WHY THE RULE IS PHRASED LIKE THIS:
--
-- Most policies here are TO PUBLIC and that is the ordinary Supabase
-- idiom - `using (is_member_of(workspace_id))` is TO PUBLIC and perfectly
-- safe, because for anon auth.uid() is null and the predicate is false.
-- The danger is not TO PUBLIC. The danger is TO PUBLIC with a predicate
-- that never consults the caller at all. So the rule is: name one of the
-- identity functions, or appear in the list below with a reason.
--
-- Widen IDENTITY below when a new identity function is written. Add to
-- ALLOWED only with a sentence saying why, and never to make this pass.

do $$
declare
  n   integer;
  bad text;
begin
  select count(*), string_agg(format('%s.%s/%s', schemaname, tablename, policyname),
                              ', ' order by schemaname, tablename, policyname)
    into n, bad
    from pg_policies p
   where p.roles::text like '%{public}%'
     -- only where it can actually be reached with the public key
     and exists (select 1 from information_schema.table_privileges g
                  where g.table_schema = p.schemaname
                    and g.table_name   = p.tablename
                    and g.grantee      = 'anon')
     -- IDENTITY: the predicate consults the caller
     and coalesce(p.qual, '') || coalesce(p.with_check, '') !~
         ('auth[.]uid|auth[.]role|is_staff|is_member_of|is_admin_of|has_role'
          || '|client_can_see|task_workspace_id')
     -- ALLOWED: four, each for a stated reason
     and (p.schemaname, p.tablename, p.policyname) not in (
       -- Reached only THROUGH a parent that has RLS of its own: the
       -- subquery `select id from clients` is evaluated as the caller, so
       -- for anon it returns no rows and the policy is false. The identity
       -- check is real, it just lives on the parent table.
       ('public', 'client_brands', 'client_brands all if client visible'),
       ('public', 'sections',      'sections all if project visible'),
       -- `with check (false)`. Nobody inserts, by design: invite_events is
       -- written by the backend on the service role, which bypasses RLS.
       ('public', 'invite_events', 'invite_events no direct insert'),
       -- `using (true)`, deliberately. It is the vendor category list -
       -- names like "Photographer" - and 096 says in as many words that it
       -- is left open because the list is not sensitive and the whole app
       -- reads it. It holds no client, money or contact data.
       ('public', 'vendor_categories', 'vendor_categories read')
     );

  if n > 0 then
    raise exception
      'rls: % policy(ies) are open to the public key and never ask who is '
      'asking: %. Either name an identity function in the predicate, or add '
      'it to the ALLOWED list in this file with a sentence saying why it is '
      'safe. The client-files bucket looked exactly like this for months.',
      n, bad;
  end if;
end $$;
