-- Every view must be security_invoker.
--
-- THE BUG THIS FREEZES: `pm_task_campaign_rollup` served budget, client
-- prices, vendor cost and aq_gross for EVERY campaign in the database to
-- any portal user and to `anon`. Not their campaigns — all of them.
--
-- A view without `security_invoker` executes as its OWNER, and a table's
-- owner is exempt from that table's RLS unless FORCE ROW LEVEL SECURITY is
-- set. Nothing sets it. So pm_tasks' policy — which is correct, and which
-- everyone had read — was simply never consulted for anyone who asked
-- through the view.
--
-- This is the single most dangerous shape in the whole schema, because the
-- protection LOOKS present. The next view somebody adds will have the same
-- problem, and this is what will tell them.

do $$
declare
  bad text;
begin
  select string_agg(c.relname, ', ')
    into bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker%';

  if bad is not null then
    raise exception
      'These views run as their owner and therefore bypass RLS: %. '
      'Add: alter view public.<name> set (security_invoker = on);',
      bad;
  end if;
end $$;
