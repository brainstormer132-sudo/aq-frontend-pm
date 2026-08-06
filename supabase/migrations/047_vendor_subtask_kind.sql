-- ============================================================
-- 047_vendor_subtask_kind.sql
--
-- The subtask catalogue collapses to one kind: Vendor.
--
-- Quotation, invoice and payment confirmation moved onto the parent task
-- (migration 042). Contracts / vendoring became a request fired from the
-- vendor subtask itself. The tracking sheet became a button on the parent
-- (migrations 045/046). What is actually left for a subtask to be is one
-- vendor on the campaign — which is what 'ad' always meant in practice.
--
-- So: rename 'ad' -> 'vendor', and retire the rest from the picker. This
-- migration only renames. It does NOT delete rows of the retired kinds:
-- a workspace may have live quotation or contract subtasks mid-flight, and
-- the UI still renders them (LEGACY_SUBTASK_KIND_LABELS in use-workflow.ts).
-- They simply can no longer be created.
--
-- Run in Supabase: Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ============================================================

-- ─── 1. The kind itself ──────────────────────────────────────────
-- subtask_kind is text, not an enum (migration 038), so this is a plain update.

update public.pm_tasks
   set subtask_kind = 'vendor'
 where subtask_kind = 'ad';

-- ─── 2. Auto-generated titles ────────────────────────────────────
-- ensureVendorSubtasks names rows "Vendor 1", "Vendor 2", … Rows spawned
-- before this migration read "Ad 1", "Ad 2", …  Rename ONLY those exact
-- machine-generated shapes; a title somebody typed by hand is left alone,
-- and so is "{brand} — {vendor}", which is already correct.
--
-- The same guard lives in isAutoVendorTitle() on the client, so a row that
-- slipped through here still renames itself when its vendor is next set.

update public.pm_tasks
   set title = 'Vendor ' || substring(title from '^Ad (\d+)$')
 where parent_task_id is not null
   and subtask_kind = 'vendor'
   and title ~ '^Ad \d+$';

update public.pm_tasks
   set title = 'Vendor'
 where parent_task_id is not null
   and subtask_kind = 'vendor'
   and title = 'Ad';

-- ─── 3. Keep the step catalogue in line ──────────────────────────
-- 044 already removed Quotation / Invoice / Contracts / Payment Confirmation
-- / Tracking Sheet / Timeline from service_type_steps. Anything titled "Ad"
-- that survived should read "Vendor" so triage and the panel agree.
--
-- NB: the step's label column is `title`, not `name` — `name` is on
-- service_types. See 044, which deletes from this table by title.

update public.service_type_steps
   set title = 'Vendor'
 where lower(trim(title)) = 'ad';

-- ─── 4. Report ───────────────────────────────────────────────────
do $$
declare
  v_vendor  integer;
  v_legacy  integer;
begin
  select count(*) into v_vendor
    from public.pm_tasks where subtask_kind = 'vendor';
  select count(*) into v_legacy
    from public.pm_tasks
   where subtask_kind in ('quotation','invoice','contract','payment','tracking');

  raise notice '047: % vendor subtask(s).', v_vendor;
  if v_legacy > 0 then
    raise notice '047: % retired-kind subtask(s) left in place (still readable, no longer creatable).', v_legacy;
  end if;
end $$;
