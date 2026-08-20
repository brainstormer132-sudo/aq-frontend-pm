-- ============================================================
-- 061_closer_influencer_generic.sql
-- "An influencer closed it" — without naming which one.
--
-- 054 let the sales closer be an influencer by pointing at a row in
-- public.vendors. Correct, and unusable: the register holds hundreds of
-- influencers, so the picker became a list of hundreds of Arabic names to
-- scroll through for a field whose answer is nearly always "an influencer
-- brought them in" rather than a specific person to credit.
--
-- So the picker now offers one option, "Influencer", and this column
-- records it. `sales_closer_vendor_id` is left exactly where it is: rows
-- that already name a specific influencer keep naming them, and the picker
-- still shows that name for those rows so opening one cannot quietly
-- overwrite it.
--
-- Three states, at most one set:
--   sales_closer_id          a colleague
--   sales_closer_vendor_id   a named influencer (legacy; nothing new sets it)
--   sales_closer_influencer  an influencer, unnamed
--
-- Safe to run twice.
-- Run in the Supabase SQL editor. Run 054 first.
-- ============================================================

begin;

alter table public.pm_tasks
  add column if not exists sales_closer_influencer boolean not null default false;

comment on column public.pm_tasks.sales_closer_influencer is
  'An influencer closed this deal, unnamed. Exclusive with sales_closer_id and sales_closer_vendor_id.';

-- One closer, still. The 054 constraint covers the two id columns; this
-- covers the flag against both of them.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pm_tasks_closer_flag_alone'
       and conrelid = 'public.pm_tasks'::regclass
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_closer_flag_alone
      check (
        not sales_closer_influencer
        or (sales_closer_id is null and sales_closer_vendor_id is null)
      );
  end if;
end $$;

-- Counting "how many deals came in through influencers" is the whole reason
-- this field exists, and it now has to look at two columns.
create index if not exists idx_pm_tasks_closer_influencer
  on public.pm_tasks (workspace_id)
  where sales_closer_influencer;

commit;

-- ─── Verification ───────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'pm_tasks'
   and column_name like 'sales_closer%'
 order by column_name;
-- Expect three: sales_closer_id (uuid), sales_closer_influencer (boolean,
-- NOT NULL default false), sales_closer_vendor_id (bigint).

select count(*) filter (where sales_closer_id is not null)        as closed_by_team,
       count(*) filter (where sales_closer_vendor_id is not null) as closed_by_named_influencer,
       count(*) filter (where sales_closer_influencer)            as closed_by_influencer
  from public.pm_tasks;
-- closed_by_influencer is 0 straight after the migration. Rows that name an
-- influencer are NOT converted — the name they hold is worth more than the
-- consistency, and they still display it.
