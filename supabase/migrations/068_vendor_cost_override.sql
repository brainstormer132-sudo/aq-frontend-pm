-- 068_vendor_cost_override.sql
--
-- "vendors cost should be automatic but still not locked it can be edited"
--
-- The campaign page adds the bookings up and shows the total. That is right
-- almost always, and wrong exactly when somebody has agreed something the
-- bookings do not know about — a package price, a rebate, a vendor absorbing
-- a reshoot. So the total needs a way to be overruled that says on its face
-- that it has been, and offers the way back.
--
-- Null is the normal state and means "use the sum". A number here means a
-- person deliberately typed one, and the page shows both: what the bookings
-- come to, and what somebody decided instead.
--
-- The campaign page has been writing this column since the money bar landed;
-- it was never created, so every edit came back as
--   "Could not find the 'vendor_cost_override' column of 'pm_tasks'".
--
-- Safe to re-run.

alter table public.pm_tasks
  add column if not exists vendor_cost_override numeric(14,2);

do $$
begin
  -- A negative vendor cost is a typo, not a credit. Money coming back is a
  -- payment status, the same rule 067 applied to per-ad nets.
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_vendor_cost_override_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_vendor_cost_override_chk
      check (vendor_cost_override is null or vendor_cost_override >= 0);
  end if;
end $$;

comment on column public.pm_tasks.vendor_cost_override is
  'Typed instead of the sum of this campaign''s bookings. Null — the normal state — means the sum stands. Set only when somebody has agreed something the bookings cannot see.';

-- ─── Verification ──────────────────────────────────────────────────
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'pm_tasks'
   and column_name  = 'vendor_cost_override';
