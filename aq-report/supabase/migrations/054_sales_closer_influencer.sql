-- ============================================================
-- 054_sales_closer_influencer.sql
-- The sales closer can be an influencer, not only an AQ team member.
--
-- `sales_closer_id` is a FK to public.profiles — an account in this
-- workspace. That is right when a colleague closed the deal and useless
-- when an influencer brought the client in, which happens often enough
-- that people were writing it in the description instead, where nothing
-- can count it.
--
-- Influencers already exist as rows in public.vendors (bigserial id), so
-- this adds a second, mutually exclusive column rather than inventing a
-- parallel person table:
--
--   sales_closer_id         → profiles(id)   a colleague
--   sales_closer_vendor_id  → vendors(id)    an influencer
--
-- Exactly one of them is set, enforced by a CHECK. Two columns for one
-- idea is a smell, so the app never exposes both: one picker lists
-- colleagues and influencers together, writes whichever column applies and
-- clears the other. The alternative — a text discriminator plus a text id —
-- would have given up the foreign keys, and a closer who no longer exists
-- is exactly the kind of dangling reference the FK is there to prevent.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor.
-- ============================================================

begin;

alter table public.pm_tasks
  add column if not exists sales_closer_vendor_id bigint
  references public.vendors(id) on delete set null;

comment on column public.pm_tasks.sales_closer_vendor_id is
  'Influencer who closed this deal (vendors.id). Mutually exclusive with sales_closer_id.';

create index if not exists idx_pm_tasks_sales_closer_vendor
  on public.pm_tasks (sales_closer_vendor_id)
  where sales_closer_vendor_id is not null;

-- One closer, not two. Every existing row has a null vendor closer, so the
-- constraint is valid on arrival — no NOT VALID needed, and no legacy row
-- can be rejected by it.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'pm_tasks_one_sales_closer'
       and conrelid = 'public.pm_tasks'::regclass
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_one_sales_closer
      check (sales_closer_id is null or sales_closer_vendor_id is null);
  end if;
end $$;

commit;

-- ─── Verification ───────────────────────────────────────────────
select count(*) as rows_with_two_closers
  from public.pm_tasks
 where sales_closer_id is not null
   and sales_closer_vendor_id is not null;
-- Expect 0 — and the constraint means it cannot become anything else.

select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'pm_tasks'
   and column_name in ('sales_closer_id', 'sales_closer_vendor_id')
 order by column_name;
-- Expect both, uuid and bigint.
