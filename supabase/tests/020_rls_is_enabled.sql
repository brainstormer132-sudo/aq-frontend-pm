-- Every table in public must have RLS enabled.
--
-- THE BUG THIS FREEZES: the contract-app tables (`users`, `tasks`,
-- `subtasks`, `generated_contracts`, `pending_vendors`, …) never had RLS
-- enabled at all. 002 said so in a comment — "RLS stays OFF on these, auth
-- happens at the API layer" — which was true until 021 created portal
-- users, who authenticate with a Supabase JWT and land in the SAME
-- `authenticated` role as staff. PostgREST is a second door the API layer
-- does not guard.
--
-- Result: `users.password_hash` was readable by anyone with the public
-- anon key.
--
-- A table added without RLS is the default-open case, so this asserts the
-- whole schema rather than a list. If a table genuinely needs to be open,
-- add it to the exceptions WITH a reason — the argument belongs in the
-- repository, not in somebody's memory.

do $$
declare
  bad text;
  -- Deliberate exceptions. Each needs a reason, and "we never got to it"
  -- is not one.
  allowed text[] := array[
    -- The registration queues. The public sign-up form inserts into these
    -- before the submitter has an account, and PostgREST returns the
    -- inserted row, which is checked against the SELECT policy — so a
    -- staff-only read policy turns every submission into a permission
    -- error. Documented in 071 section 3b. Closing this needs the form to
    -- send `Prefer: return=minimal`.
    'pending_vendors',
    'pending_clients'
  ];
begin
  select string_agg(tablename, ', ')
    into bad
    from pg_tables
   where schemaname = 'public'
     and not rowsecurity
     and not (tablename = any(allowed));

  if bad is not null then
    raise exception
      'These tables have Row Level Security switched OFF, so anyone with '
      'the public anon key can read them through PostgREST: %', bad;
  end if;
end $$;
