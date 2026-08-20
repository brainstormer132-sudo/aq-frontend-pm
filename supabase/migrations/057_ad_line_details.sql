-- ============================================================
-- 057_ad_line_details.sql
-- An ad line is a piece of work, not just a price row.
--
-- 056 gave a vendor subtask its ad lines so one contract could cover six
-- home ads, six store visits and a few free reminders. What it missed is
-- that those ads are not interchangeable: they land on different days, they
-- have their own briefs, and they finish at different times. Same person,
-- same contract, different work.
--
-- So each line gets its own due date, description and status. Everything
-- stays optional — a line that is only a price is still a legal line, which
-- matters because that is how 056's rows were written.
--
-- `status` uses the same vocabulary as the tracking sheet's ad_status
-- (migration 036) rather than inventing a second one for the same idea.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor.
-- ============================================================

begin;

alter table public.vendor_ad_lines
  add column if not exists due_date    date,
  add column if not exists description text,
  add column if not exists status      text not null default 'Not started';

-- Add the check separately: `add column if not exists` will not add a
-- constraint to a column that already exists, and running this twice must
-- not fail.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vendor_ad_lines_status_check'
       and conrelid = 'public.vendor_ad_lines'::regclass
  ) then
    alter table public.vendor_ad_lines
      add constraint vendor_ad_lines_status_check
      check (status in ('Not started', 'Scheduled', 'Shot', 'Posted', 'Cancelled'));
  end if;
end $$;

comment on column public.vendor_ad_lines.due_date is
  'When this particular ad is due. Lines under one booking often differ.';
comment on column public.vendor_ad_lines.description is
  'The brief for this ad specifically — not the booking as a whole.';

-- Due dates are looked up by day across a workspace, for the calendar.
create index if not exists idx_vendor_ad_lines_due
  on public.vendor_ad_lines (due_date)
  where due_date is not null;

commit;

-- ─── Verification ───────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'vendor_ad_lines'
   and column_name in ('due_date', 'description', 'status')
 order by column_name;
-- Expect three rows: date / text / text, all nullable except status.

select count(*) filter (where due_date is not null) as lines_with_a_date,
       count(*)                                     as lines_total
  from public.vendor_ad_lines;
