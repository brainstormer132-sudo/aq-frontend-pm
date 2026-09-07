-- ============================================================
-- 050_unseed_creative_steps.sql
--
-- Undoes one thing 048 did: it seeded "Campaign Design",
-- "Marketing Strategy" and "Visuals" onto EVERY service type, so the
-- triage list for Package Ad, Billboard, Social Media, Event and the
-- rest all grew three creative steps they don't need.
--
-- That was an over-reach on my part. Siraj asked for those three to
-- exist as subtask KINDS, not to be offered on every service type.
--
-- They remain fully available: the parent campaign's "+ Add subtask"
-- picker lists all six kinds regardless of the catalog, so any campaign
-- that genuinely needs a Campaign Design subtask can have one in two
-- clicks. This only stops them cluttering every triage list.
--
-- Analysis Report is NOT touched — that one was seeded onto Campaign
-- only, which is what was asked for.
--
-- Deletes catalogue entries only. Subtasks that already exist are rows
-- in pm_tasks and are left completely alone.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

do $$
declare
  v_before integer;
  v_after  integer;
begin
  select count(*) into v_before from public.service_type_steps;

  -- Matched on title AND the exact positions 048 used (20/21/22), so a
  -- step somebody created by hand at a different position survives.
  delete from public.service_type_steps
   where lower(trim(title)) in ('campaign design', 'marketing strategy', 'visuals')
     and position in (20, 21, 22);

  select count(*) into v_after from public.service_type_steps;
  raise notice '050: removed % seeded creative step(s).', v_before - v_after;
end $$;

-- What each service type offers now, for the record.
select st.name as service_type,
       coalesce(string_agg(sts.title, ', ' order by sts.position),
                '(none — subtasks added from the campaign)') as steps
  from public.service_types st
  left join public.service_type_steps sts on sts.service_type_id = st.id
 group by st.name
 order by st.name;
