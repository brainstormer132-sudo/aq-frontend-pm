-- ============================================================
-- 096_linter_hardening.sql
-- Three low-risk items the Supabase advisor flagged (all WARN):
--   1. Pin search_path on 12 functions (stops search_path hijack on
--      SECURITY DEFINER functions; no behaviour change).
--   2. vendor_categories write/update/delete were USING (true) - any signed-in
--      user could edit the global category list. Gate to staff. The app only
--      READS this table (useVendorCategoriesLegacy), so no client flow breaks.
--   3. avatars_select allowed ANYONE (incl. anon) to LIST every file in the
--      public avatars bucket. Public <img> URLs work via bucket.public, not
--      this policy, so restrict the policy to authenticated - anon can no
--      longer enumerate, faces still render.
--
-- Safe to run twice. Run in staging, then prod. Then: notify pgrst.
-- ============================================================

-- 1. search_path -------------------------------------------------
alter function public.looks_like_email(text)          set search_path = public, pg_temp;
alter function public.normalise_profile_name()        set search_path = public, pg_temp;
alter function public.unnamed_member_label()          set search_path = public, pg_temp;
alter function public.update_updated_at()             set search_path = public, pg_temp;
alter function public.task_recovery_days()            set search_path = public, pg_temp;
alter function public.crm_deals_stage_change()        set search_path = public, pg_temp;
alter function public._pm_client_state(text)          set search_path = public, pg_temp;
alter function public.touch_vendor_ad_lines()         set search_path = public, pg_temp;
alter function public.sync_booking_money_from_lines() set search_path = public, pg_temp;
alter function public.pm_client_ledger()              set search_path = public, pg_temp;
alter function public.pm_vendor_ledger()              set search_path = public, pg_temp;
alter function public.pm_dashboard_summary(date, date, uuid) set search_path = public, pg_temp;

-- 2. vendor_categories: staff-only writes ------------------------
drop policy if exists "vendor_categories write"  on public.vendor_categories;
drop policy if exists "vendor_categories update" on public.vendor_categories;
drop policy if exists "vendor_categories delete" on public.vendor_categories;

create policy "vendor_categories write"  on public.vendor_categories
  for insert with check (public.is_staff());
create policy "vendor_categories update" on public.vendor_categories
  for update using (public.is_staff()) with check (public.is_staff());
create policy "vendor_categories delete" on public.vendor_categories
  for delete using (public.is_staff());
-- "vendor_categories read" (SELECT USING true) is left as-is: the list is not
-- sensitive and the whole app reads it.

-- 3. avatars_select: authenticated only --------------------------
drop policy if exists "avatars_select" on storage.objects;
create policy "avatars_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');