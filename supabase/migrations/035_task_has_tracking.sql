-- ============================================================
-- 035 — SUPERSEDED / no-op
--
-- Tracking sheets moved to the PM app. The contract-app tasks.has_tracking
-- column this migration used to add is no longer used. Left as a no-op to
-- keep numbering stable. PM-app tracking uses pm_tasks.has_tracking in its
-- own migration.
--
-- If you already ran the original 035, the unused column is harmless.
-- ============================================================

select 1;
