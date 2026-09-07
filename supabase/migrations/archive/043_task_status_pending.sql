-- ============================================================
-- 043_task_status_pending.sql
-- pm_tasks.status is a Postgres ENUM (task_status), not text.
-- Migration 042 assumed text and failed on:
--     update public.pm_tasks set status = 'pending' ...
--   → ERROR 22P02: invalid input value for enum task_status: "pending"
--
-- ⚠️ RUN PART 1 FIRST, ON ITS OWN, RIGHT NOW.
--
-- The deployed app already inserts status='pending' (commit a138bc0),
-- so until the enum accepts that value, creating a task, triaging a
-- campaign, adding a subtask and topping up Package Ads all fail.
-- PART 1 fixes that in seconds and needs no deploy.
--
-- Postgres will not let a new enum value be USED in the same
-- transaction that adds it, and the Supabase SQL editor runs a script
-- as one transaction. Hence two parts, run separately. Running PART 2
-- in the same go raises "unsafe use of new value of enum type".
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- PART 1 — select these lines, Run, and stop. Idempotent.
-- ─────────────────────────────────────────────────────────────

alter type public.task_status add value if not exists 'pending';
alter type public.task_status add value if not exists 'on_hold';
alter type public.task_status add value if not exists 'cancelled';

-- What the enum holds now — 'todo' and 'done' should still be there,
-- plus the three above. Nothing is ever removed from an enum.
select enumlabel as task_status_values
  from pg_enum
  join pg_type on pg_type.oid = pg_enum.enumtypid
 where pg_type.typname = 'task_status'
 order by enumsortorder;


-- ─────────────────────────────────────────────────────────────
-- PART 2 — only after PART 1 has been Run. Idempotent.
--
-- 'todo' stays in the enum forever (Postgres can't drop a value), it
-- just stops being used. No check constraint: harmless, and adding one
-- would mean a table rewrite for no benefit.
-- ─────────────────────────────────────────────────────────────

update public.pm_tasks set status = 'pending' where status = 'todo';

alter table public.pm_tasks alter column status set default 'pending';

select status, count(*) as rows
  from public.pm_tasks
 group by status
 order by 2 desc;
