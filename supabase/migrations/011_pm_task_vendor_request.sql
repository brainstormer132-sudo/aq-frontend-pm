-- ============================================================
-- 011_pm_task_vendor_request.sql
-- Adds:
--   1. pm_tasks.vendor_id      → FK to legacy vendors table.
--      Used per-subtask (one vendor per subtask) so that the contract
--      request flow can populate vendor data automatically.
--   2. pm_tasks.contract_request_id → FK to contract_requests.
--      Tracks which subtask spawned which contract request, so the
--      auto-send flow only fires once per subtask.
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1. Vendor link (subtasks)
ALTER TABLE public.pm_tasks
  ADD COLUMN IF NOT EXISTS vendor_id bigint
  REFERENCES public.vendors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pm_tasks_vendor_id_idx
  ON public.pm_tasks (vendor_id)
  WHERE vendor_id IS NOT NULL;

-- 2. Contract-request link (subtasks)
-- Use a uuid since contract_requests.id is uuid in the existing schema.
ALTER TABLE public.pm_tasks
  ADD COLUMN IF NOT EXISTS contract_request_id uuid
  REFERENCES public.contract_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pm_tasks_contract_request_idx
  ON public.pm_tasks (contract_request_id)
  WHERE contract_request_id IS NOT NULL;

-- 3. Verification
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'pm_tasks'
   AND column_name IN ('vendor_id', 'contract_request_id')
 ORDER BY column_name;
-- Expect 2 rows: contract_request_id (uuid) and vendor_id (bigint).
