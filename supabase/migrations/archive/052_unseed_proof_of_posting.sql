-- ============================================================
-- 052_unseed_proof_of_posting.sql
--
-- "Proof of Posting" stops being a subtask.
--
-- Siraj: "proof of posting is already in parent we dont need it in
-- subtask form". He's right, and I flagged this as redundant when the
-- parent field was added and then left it in place anyway — the campaign
-- has carried proof_of_posting_attached / proof_of_posting_link since
-- migration 048, and the panel renders them on the parent only. The
-- catalogue step meant triage still spawned a subtask for the same
-- thing, so a campaign had two places to record one fact and no rule
-- about which one counted.
--
-- Removes the catalogue entry only. Subtasks that already exist are rows
-- in pm_tasks and are left completely alone — deleting somebody's work
-- to tidy a menu is not a trade I'm willing to make. They will simply
-- stop being created from here on.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

do $$
declare
  v_removed integer;
  v_orphans integer;
begin
  -- Matched on the title as it reads in the catalogue, with and without
  -- the "(for each ad)" qualifier, and tolerant of case and padding.
  -- Position is NOT constrained: unlike 050 this step has moved around,
  -- so pinning it to a number would miss it on some service types.
  with gone as (
    delete from public.service_type_steps
     where lower(trim(title)) in (
             'proof of posting',
             'proof of posting (for each ad)'
           )
    returning 1
  )
  select count(*) into v_removed from gone;

  raise notice '052: removed % "Proof of Posting" catalogue step(s).', v_removed;

  -- How many already-spawned subtasks are now orphaned from the catalogue.
  -- Reported, not touched, so nobody is surprised later.
  select count(*) into v_orphans
    from public.pm_tasks
   where parent_task_id is not null
     and lower(trim(title)) like '%proof of posting%';

  if v_orphans > 0 then
    raise notice
      '052: % existing "Proof of Posting" subtask(s) left in place. Delete them by hand if you want them gone.',
      v_orphans;
  end if;
end $$;

-- What each service type offers now, for the record.
select st.name as service_type,
       coalesce(string_agg(sts.title, ', ' order by sts.position),
                '(none — subtasks added from the campaign)') as steps
  from public.service_types st
  left join public.service_type_steps sts on sts.service_type_id = st.id
 group by st.name
 order by st.name;
