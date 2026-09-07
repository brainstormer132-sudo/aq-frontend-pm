-- Take TRUNCATE, TRIGGER and REFERENCES away from the two public roles.
--
-- ── What this is ──────────────────────────────────────────────────
--
-- Found by taking the first baseline WITH privileges and reading what was
-- actually in it. `anon` holds TRUNCATE on 40 tables and `authenticated`
-- on 48 — including pm_tasks, clients, vendors, tracking_rows,
-- tracking_rows_published and activity_log.
--
-- Nobody granted that. It is the tail of 002's
--
--     alter default privileges in schema public grant all on tables
--       to anon, authenticated;
--
-- and `all` means all: SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER,
-- REFERENCES. Four of those seven were meant.
--
-- ── Why it matters more than the others ───────────────────────────
--
-- The INSERT / UPDATE / DELETE grants look worse and are not, because
-- **row-level security gates them**, and 020_rls_is_enabled.sql asserts RLS
-- is on for every table in the schema. Without a permissive write policy
-- for the role, those grants do nothing.
--
-- **TRUNCATE is not gated by RLS.** Postgres applies policies per row, and
-- TRUNCATE does not visit rows — it drops the whole heap. A role holding
-- TRUNCATE empties the table regardless of every policy on it. The same is
-- true of TRIGGER (attach code to a table you do not own) and REFERENCES
-- (point a foreign key at one).
--
-- So this is the one grant in the set where the RLS layer underneath is
-- not there to catch it.
--
-- ── How bad is it today ───────────────────────────────────────────
--
-- Not live, and worth saying so plainly rather than overstating it.
-- PostgREST has no TRUNCATE verb, so the anon key on its own cannot reach
-- it over HTTPS, and `anon` is nologin — it is only ever assumed through
-- `authenticator`. It is a loaded gun in a locked drawer.
--
-- It becomes live the moment anything holds a direct Postgres connection
-- as one of these roles, and it costs one migration to unload. That is a
-- good trade at any odds.
--
-- ── Blast radius of this migration ────────────────────────────────
--
-- None expected. PostgREST issues SELECT, INSERT, UPDATE and DELETE and
-- nothing else; the app has never truncated a table, created a trigger, or
-- declared a foreign key at runtime, and could not — those are DDL. If
-- something does break, it is doing something it should not be.

do $$
declare
  t record;
begin
  for t in
    select schemaname, tablename
      from pg_tables
     where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, trigger, references on table %I.%I from anon, authenticated',
      t.schemaname, t.tablename);
  end loop;
end $$;

-- And stop it coming back on the next table anyone creates. The default
-- privileges are still in force and still say `all`; this narrows them to
-- the four that are actually used and actually gated.
--
-- The FOR ROLE matters and is easy to get wrong: a default-privilege entry
-- belongs to the role that created it, and a bare
--
--     alter default privileges in schema public revoke ...
--
-- only touches YOUR OWN entries. In this database the entry was created by
-- `supabase_admin`, so a bare revoke run as `postgres` succeeds, changes
-- nothing, and leaves you believing it is fixed. Hence the loop: whoever
-- owns an entry, revoke from that entry.
do $$
declare
  d record;
begin
  for d in
    select distinct defaclrole::regrole::text as owner
      from pg_default_acl
     where defaclnamespace = 'public'::regnamespace
       and defaclobjtype = 'r'
  loop
    begin
      execute format(
        'alter default privileges for role %s in schema public '
        'revoke truncate, trigger, references on tables from anon, authenticated',
        d.owner);
    exception when insufficient_privilege then
      raise warning
        'Could not narrow the default privileges owned by %. You must be a '
        'member of that role to change its defaults. The tables are already '
        'fixed above; without this, a table created LATER inherits TRUNCATE '
        'again. Run this part as %.', d.owner, d.owner;
    end;
  end loop;
end $$;

-- Views are covered by the same default privileges and have the same
-- exposure through the same route.
do $$
declare
  v record;
begin
  for v in
    select schemaname, viewname from pg_views where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, trigger, references on table %I.%I from anon, authenticated',
      v.schemaname, v.viewname);
  end loop;
end $$;

comment on schema public is
  'App schema. anon and authenticated hold SELECT/INSERT/UPDATE/DELETE only; '
  'every one of those is gated by row-level security. TRUNCATE, TRIGGER and '
  'REFERENCES are revoked (075) because RLS does not gate them.';
