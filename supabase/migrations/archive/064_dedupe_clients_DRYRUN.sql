-- 064 DRY RUN — changes nothing. Read-only.
--
-- Run this in the Supabase SQL editor BEFORE 064_dedupe_clients.sql and read
-- the three result sets. If the headline numbers look wrong, stop.

-- ---------------------------------------------------------------------------
-- 1. The headline. What the merge would do.
-- ---------------------------------------------------------------------------
with plan as (
  select
    workspace_id,
    company_name,
    count(*)                                    as copies,
    (array_agg(id order by created_at, id))[1]  as keep_id,
    min(created_at)                             as oldest,
    max(created_at)                             as newest
  from public.clients
  group by workspace_id, company_name
  having count(*) > 1
     and count(distinct nullif(btrim(cr_number), '')) <= 1
)
select
  (select count(*) from public.clients)                as client_rows_now,
  (select count(*) from plan)                          as duplicated_names,
  (select coalesce(sum(copies - 1), 0) from plan)      as rows_to_delete,
  (select count(*) from public.clients)
    - (select coalesce(sum(copies - 1), 0) from plan)  as client_rows_after;

-- ---------------------------------------------------------------------------
-- 2. Every duplicated name, and whether the merge will touch it.
--
--    `verdict` is the whole point of this result set. A name carrying two
--    different commercial registrations is two real companies wearing one
--    name, not a duplicate — merging those would delete a company. The
--    migration skips them, and they stay duplicated until a person decides.
-- ---------------------------------------------------------------------------
select
  case when count(distinct nullif(btrim(cr_number), '')) > 1
       then 'LEFT ALONE — two CRs, look at this'
       else 'merge' end                                as verdict,
  company_name,
  count(*)                                            as copies,
  (array_agg(id order by created_at, id))[1]          as survives,
  min(created_at)                                     as oldest,
  max(created_at)                                     as newest,
  count(distinct nullif(btrim(cr_number), ''))        as distinct_crs,
  string_agg(distinct nullif(btrim(cr_number), ''), ' | ') as the_crs
from public.clients
group by workspace_id, company_name
having count(*) > 1
order by count(distinct nullif(btrim(cr_number), '')) desc, count(*) desc;

-- ---------------------------------------------------------------------------
-- 3. What is attached to the rows that would be deleted. These are the
--    references the merge has to move; if it did not, campaigns would lose
--    their client and brands would be deleted outright.
-- ---------------------------------------------------------------------------
with plan as (
  select
    c.id as drop_id,
    (array_agg(c.id) over ())[1] as ignore_me
  from public.clients c
  join (
    select workspace_id, company_name,
           (array_agg(id order by created_at, id))[1] as keep_id
    from public.clients
    group by workspace_id, company_name
    having count(*) > 1
       and count(distinct nullif(btrim(cr_number), '')) <= 1
  ) s
    on  c.company_name is not distinct from s.company_name
    and c.workspace_id is not distinct from s.workspace_id
  where c.id <> s.keep_id
)
select 'pm_tasks.client_id (NO foreign key — would silently dangle)' as what,
       count(*) as rows_to_repoint
  from public.pm_tasks t where t.client_id in (select drop_id from plan)
union all
select 'client_brands (cascade — these brands would be DELETED)',
       count(*) from public.client_brands b where b.client_id in (select drop_id from plan)
union all
select 'manager_clients (cascade)',
       count(*) from public.manager_clients m where m.client_id in (select drop_id from plan)
union all
select 'generated_contracts.client_id (would be set to null)',
       count(*) from public.generated_contracts g where g.client_id in (select drop_id from plan)
union all
select 'external_users.client_id (portal logins, would be set to null)',
       count(*) from public.external_users e where e.client_id in (select drop_id from plan);
