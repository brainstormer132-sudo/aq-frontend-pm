-- A deleted task must be hidden by the POLICY, not by the queries.
--
-- pm_tasks is read from around sixty places. A soft delete whose filter
-- lives in the callers is one forgotten `where deleted_at is null` away
-- from showing somebody a campaign that was deleted last week — and the
-- query that forgets will be one written next year by someone who never
-- read 073.
--
-- Putting the filter in the policy means there is no filter to forget.
-- This asserts it is still there.

do $$
declare
  q text;
begin
  select pg_get_expr(polqual, polrelid) into q
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'pm_tasks' and p.polname = 'pm_tasks select role aware';
  if q is null then
    raise exception 'The pm_tasks select policy is missing.';
  end if;
  if position('deleted_at' in q) = 0 then
    raise exception
      'The pm_tasks SELECT policy does not mention deleted_at, so deleted '
      'tasks are visible to every query in the app.';
  end if;

  select pg_get_expr(polqual, polrelid) into q
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'pm_tasks' and p.polname = 'pm_tasks update by role';
  if position('deleted_at' in coalesce(q, '')) = 0 then
    raise exception
      'The pm_tasks UPDATE policy does not mention deleted_at, so a task in '
      'the recycle bin can still be edited.';
  end if;
end $$;
