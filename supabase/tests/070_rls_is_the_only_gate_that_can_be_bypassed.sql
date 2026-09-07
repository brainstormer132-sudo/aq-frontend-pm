-- No public role may hold a privilege that row-level security does not gate.
--
-- THE BUG THIS FREEZES: 002 wrote
--
--     alter default privileges in schema public grant all on tables
--       to anon, authenticated;
--
-- and `all` is seven privileges, not four. The result, visible in the first
-- baseline taken with privileges: `anon` held TRUNCATE on 40 tables and
-- `authenticated` on 48 — pm_tasks, clients, vendors, tracking_rows,
-- activity_log, all of them.
--
-- Every other over-grant in that set is caught by RLS, which is why they
-- had sat there harmlessly since 002 and why nobody noticed. TRUNCATE is
-- the exception: it does not visit rows, so no policy is consulted, and a
-- role holding it empties the table whatever the policies say. TRIGGER and
-- REFERENCES are the same shape — they attach behaviour to a table rather
-- than touching its rows.
--
-- 075 revokes all three and narrows the default privileges so new tables
-- do not inherit them. This is the assertion that says it stayed done,
-- because the failure mode is a table created next year picking the old
-- default back up in silence.

do $$
declare
  bad text;
begin
  select string_agg(format('%s.%s (%s to %s)',
                           table_schema, table_name, privilege_type, grantee),
                    e'\n  ' order by table_name, grantee, privilege_type)
    into bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES');

  if bad is not null then
    raise exception
      e'A public role holds a privilege row-level security does not gate:\n  %\n\n'
      'TRUNCATE does not visit rows, so no policy is consulted — the table '
      'is emptied whatever the policies say. TRIGGER and REFERENCES attach '
      'behaviour rather than touching rows. Revoke all three; see 075.', bad;
  end if;
end $$;

-- The same check one level up: the default privileges that produced it.
-- Revoking from the 51 tables that exist today and leaving the default in
-- place fixes the symptom and keeps the cause.
do $$
declare
  leftover text;
begin
  select string_agg(distinct a::text, ', ')
    into leftover
    from pg_default_acl d, unnest(d.defaclacl) a
   where d.defaclnamespace = 'public'::regnamespace
     and d.defaclobjtype = 'r'
     and (a::text like 'anon=%' or a::text like 'authenticated=%')
     -- D = TRUNCATE, t = TRIGGER, x = REFERENCES
     and a::text ~ '=[^/]*[Dtx]';

  if leftover is not null then
    raise exception
      'Default privileges in schema public still grant TRUNCATE, TRIGGER or '
      'REFERENCES to a public role (%). Every table created from now on '
      'would inherit them. See the `alter default privileges ... revoke` in '
      '075.', leftover;
  end if;
end $$;
