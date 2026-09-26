-- ============================================================
-- 143_vendor_performance_is_rolled_up_in_the_database.sql
-- The screen stops downloading the company to draw a table.
--
-- -- WHAT IT DOES NOW -------------------------------------------------
--
-- To show one row per vendor, useVendorPerformanceLines:
--
--   1. fetches EVERY vendor booking in the workspace, a thousand at a time;
--   2. takes their ids, cuts them into chunks of 100, and fetches EVERY ad
--      line under each chunk with select('*') - three requests in flight;
--   3. flattens all of that into the browser and rolls it up there.
--
-- Siraj: "vendor performance takes genuinely 5 minutes to open". It does,
-- and the pager added earlier does not help at all: that limits what is
-- PAINTED, and the five minutes is spent before a single row is drawn.
--
-- -- WHAT IT DOES INSTEAD ---------------------------------------------
--
-- One call. Postgres does the group-by - it is a database, this is the
-- thing it is for - and hands back one row per vendor, already counted and
-- already sorted. Hundreds of rows instead of tens of thousands.
--
-- -- THE RULES ARE NOT REWRITTEN, THEY ARE TRANSLATED ------------------
--
-- Every rule below is lib/vendor-performance.ts, line for line:
--
--   cancelled  status = 'Cancelled'
--   delivered  status = 'Posted' OR posted_on is set
--   on-time    delivered, and both dates known, and posted <= due
--   late       delivered, and both dates known, and posted > due
--   posted     delivered, but one of the dates is missing
--   overdue    not delivered, due date known and before today
--   pending    anything else
--
--   ads            every line that is not cancelled
--   missing_proof  a delivered line with neither the tick nor a link
--   reliability    on_time / (on_time + late), null when nothing is judgeable
--   needs_chasing  overdue + missing_proof
--   owed / paid    summed per BOOKING, not per line - a booking's net is one
--                  number however many ads hang off it
--   outstanding    owed - paid, floored at zero: an overpayment is a typo
--
-- The order is the screen's order, and the last tie-break compares vendor
-- ids as TEXT on purpose. The TypeScript keys its map on a string, so "10"
-- sorts before "9" there; matching that exactly is what lets the two be
-- compared row for row. Fix it in both or neither.
--
-- -- SECURITY ---------------------------------------------------------
--
-- Not SECURITY DEFINER. It runs as the caller, so row-level security on
-- pm_tasks and vendor_ad_lines applies exactly as it does to the reads it
-- replaces. A function that aggregated past RLS would hand every
-- workspace's numbers to anyone who could call it.
-- ============================================================

drop function if exists public.vendor_performance_summary(uuid, date);

create function public.vendor_performance_summary(
  p_workspace_id uuid,
  p_today        date
)
returns table (
  vendor_id       bigint,
  ads             integer,
  delivered       integer,
  on_time         integer,
  late            integer,
  overdue         integer,
  pending         integer,
  missing_proof   integer,
  reliability_pct integer,
  needs_chasing   integer,
  last_posted_on  date,
  owed            numeric,
  paid            numeric,
  outstanding     numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  with booking as (
    select t.id, t.vendor_id, t.net_amount, t.vendor_payment_amount
      from public.pm_tasks t
     where t.workspace_id    = p_workspace_id
       and t.parent_task_id is not null
       and t.vendor_id      is not null
       and t.deleted_at     is null
  ),
  money as (
    select b.vendor_id,
           round(sum(coalesce(b.net_amount, 0)), 2)             as owed,
           round(sum(coalesce(b.vendor_payment_amount, 0)), 2)  as paid
      from booking b
     group by b.vendor_id
  ),
  judged as (
    select b.vendor_id,
           case
             when coalesce(l.status, '') = 'Cancelled' then 'cancelled'
             when l.status = 'Posted' or l.posted_on is not null then
               case
                 when l.posted_on is not null and l.due_date is not null then
                   case when l.posted_on <= l.due_date then 'on-time' else 'late' end
                 else 'posted'
               end
             when l.due_date is not null and p_today is not null
                  and l.due_date < p_today then 'overdue'
             else 'pending'
           end as state,
           l.posted_on,
           (coalesce(l.proof_of_posting_attached, false)
            or coalesce(btrim(l.proof_of_posting_link), '') <> '') as has_proof
      from public.vendor_ad_lines l
      join booking b on b.id = l.subtask_id
  ),
  rolled as (
    select j.vendor_id,
           count(*) filter (where j.state <> 'cancelled')                  as ads,
           count(*) filter (where j.state in ('on-time','late','posted'))  as delivered,
           count(*) filter (where j.state = 'on-time')                     as on_time,
           count(*) filter (where j.state = 'late')                        as late,
           count(*) filter (where j.state = 'overdue')                     as overdue,
           count(*) filter (where j.state = 'pending')                     as pending,
           count(*) filter (where j.state in ('on-time','late','posted')
                              and not j.has_proof)                         as missing_proof,
           max(j.posted_on) filter (where j.state in ('on-time','late','posted'))
                                                                           as last_posted_on
      from judged j
     group by j.vendor_id
  )
  select r.vendor_id,
         r.ads::integer,
         r.delivered::integer,
         r.on_time::integer,
         r.late::integer,
         r.overdue::integer,
         r.pending::integer,
         r.missing_proof::integer,
         case when (r.on_time + r.late) > 0
              then round(r.on_time::numeric * 100 / (r.on_time + r.late))::integer
              else null end                                      as reliability_pct,
         (r.overdue + r.missing_proof)::integer                   as needs_chasing,
         r.last_posted_on,
         coalesce(m.owed, 0)                                      as owed,
         coalesce(m.paid, 0)                                      as paid,
         greatest(0, coalesce(m.owed, 0) - coalesce(m.paid, 0))   as outstanding
    from rolled r
    left join money m on m.vendor_id = r.vendor_id
   order by (r.overdue + r.missing_proof) desc,
            case when (r.on_time + r.late) > 0
                 then round(r.on_time::numeric * 100 / (r.on_time + r.late))
                 else null end asc nulls last,
            r.ads desc,
            r.vendor_id::text asc;
$$;

grant execute on function public.vendor_performance_summary(uuid, date) to authenticated;

-- Prove it, rather than trust it. Structural only: the shape of the thing,
-- and that it is not SECURITY DEFINER. Whether its NUMBERS match
-- lib/vendor-performance.ts is not something a do-block can say, and it is
-- the only question that matters - tests/vendor-performance-sql.test.mjs
-- answers it by running both over the same randomised data and comparing
-- every field of every row.
do $$
declare
  n_def integer;
  n_cols integer;
begin
  select count(*) into n_def from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'vendor_performance_summary'
     and p.prosecdef;
  if n_def <> 0 then
    raise exception 'vendor_performance_summary is SECURITY DEFINER - it would aggregate past RLS';
  end if;

  select count(*) into n_cols
    from information_schema.parameters
   where specific_schema = 'public'
     and specific_name like 'vendor\_performance\_summary%'
     and parameter_mode = 'OUT';
  if n_cols <> 14 then
    raise exception 'vendor_performance_summary returns % columns, expected 14', n_cols;
  end if;

  raise notice 'vendor performance rolls up in the database now';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select count(*) from public.vendor_performance_summary(
--   (select id from public.workspaces limit 1), current_date);
