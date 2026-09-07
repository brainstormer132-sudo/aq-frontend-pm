-- ============================================================
-- 034 — SUPERSEDED / no-op
--
-- Tracking sheets were moved out of the Contract Suite app and into
-- the PM app, so the subtask tracking columns this migration used to
-- add are no longer used by the contract app. Left as a no-op to keep
-- the migration numbering stable. The PM-app tracking lives in its own
-- migration (tracking_rows + pm_tasks.has_tracking).
--
-- If you already ran the original 034, the extra subtask columns are
-- harmless and can be left in place.
-- ============================================================

select 1;
