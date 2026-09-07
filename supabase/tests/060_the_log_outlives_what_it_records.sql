-- The audit log must not be deleted along with the thing it describes.
--
-- THE BUG THIS FREEZES: activity_log.task_id was `on delete cascade`.
-- Purging a task at 30 days would have taken the record of its own
-- deletion with it — the one entry you would want six months later,
-- destroyed by the event it exists to describe.

do $$
declare
  d char;
begin
  select confdeltype into d
    from pg_constraint
   where conrelid = 'public.activity_log'::regclass
     and contype = 'f'
     and pg_get_constraintdef(oid) like '%pm_tasks%';

  if d is null then
    raise exception 'activity_log has no foreign key to pm_tasks.';
  end if;
  if d = 'c' then
    raise exception
      'activity_log.task_id cascades on delete. Purging a task would delete '
      'the log entry describing the purge. It must be ON DELETE SET NULL, '
      'with the name kept on the entry.';
  end if;
end $$;

-- The log is append-only by omission: no UPDATE and no DELETE policy. If
-- somebody adds one, an entry can be quietly rewritten afterwards, and a
-- log that can be edited is not evidence of anything.
do $$
declare
  bad text;
begin
  select string_agg(polname, ', ') into bad
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'activity_log' and p.polcmd in ('w', 'd');
  if bad is not null then
    raise exception
      'activity_log has update/delete policies (%), so entries can be '
      'changed after the fact.', bad;
  end if;
end $$;
