-- ============================================================
-- 035 — Tasks: has_tracking flag
--
-- Tracking sheets are now their own page. A task opts in at
-- creation ("Create tracking sheet"); only tasks with
-- has_tracking = true appear on the Tracking page.
--
-- Default false so existing tasks stay off the page until the
-- owner enables it (Edit task → tick the box). The tracking data
-- itself lives on subtasks (migration 034) and is unaffected.
-- ============================================================

alter table public.tasks
  add column if not exists has_tracking boolean default false;
