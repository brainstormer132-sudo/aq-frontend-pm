-- ============================================================
-- 044_slim_subtask_catalog.sql
-- Subtasks become vendor lines.
--
-- Everything removed here now lives on the parent campaign:
--   Timeline              → package_start_date / package_end_date (040)
--   Quotation             → quotation_numbers[] (042)
--   Invoice               → invoice_numbers[]   (042)
--   Payment Confirmation  → client_payment_status/date/amount (028)
--   Tracking Sheet        → has_tracking, toggled by a button on the parent
--   Contracts / Vendoring → a vendor contract auto-fires from the vendor's
--                           own subtask once it has a vendor and a budget
--                           (autoCreateContractRequestForSubtask), so a
--                           separate step for it was always redundant.
--
-- This only changes what TRIAGE spawns from here on. Subtasks that already
-- exist are rows in pm_tasks and are untouched — nothing is deleted.
--
-- Reversible: re-run the relevant INSERT block from 027.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- ─── 1. The five common steps, appended to every service type ────
-- Matched by title rather than position, since position numbering has
-- drifted between workspaces that edited the catalog by hand.

delete from public.service_type_steps
 where lower(trim(title)) in (
   'tracking sheet',
   'quotation',
   'payment confirmation',
   'invoice',
   'contracts / vendoring',
   'contracts/vendoring',
   'contracts and vendoring',
   'vendoring'
 );

-- ─── 2. Timeline ─────────────────────────────────────────────────
-- Seeded on Package Ad and on Sponsorship. Both are superseded by the
-- campaign's run window. To keep Sponsorship's, delete the line below
-- and re-run 027's Sponsorship INSERT.

delete from public.service_type_steps
 where lower(trim(title)) = 'timeline';

-- ─── 3. What's left, for the record ──────────────────────────────

select st.name as service_type,
       coalesce(string_agg(sts.title, ', ' order by sts.position), '(none — vendor subtasks only)') as remaining_steps
  from public.service_types st
  left join public.service_type_steps sts on sts.service_type_id = st.id
 group by st.name
 order by st.name;
