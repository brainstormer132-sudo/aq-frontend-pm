-- ============================================================
-- 033 — Tasks: contract duration field
--
-- "Contract length" is now captured once, up front, when the task
-- is created — instead of being hand-edited on every generated
-- contract before payment.
--
-- Free text so it can hold a plain number of days ("30"), a range
-- ("60-90"), or any Arabic label ("شهر"). It feeds the {{ duration }}
-- Jinja keyword in every template. The Client Contract template
-- already references {{ duration }}; vendor templates get the
-- placeholder added in Word where the duration clause should read.
--
-- When left blank: vendor contracts render an empty {{ duration }};
-- client contracts keep their historic "شهر" fallback (handled in
-- generation.py, not here) so existing client contracts are unchanged.
-- ============================================================

alter table public.tasks
  add column if not exists duration text default '';

-- No index needed: this column is read alongside the task row,
-- never queried on its own.
