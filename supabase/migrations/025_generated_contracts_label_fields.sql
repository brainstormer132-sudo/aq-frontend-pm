-- 025 — add vendor_name + license_number to generated_contracts so the
-- new label "name - license - brand - contract_id" can be reconstructed
-- without a JOIN at download time.

alter table public.generated_contracts
  add column if not exists vendor_name    text default '',
  add column if not exists license_number text default '';

-- Backfill from subtasks for legacy rows.
update public.generated_contracts gc
   set vendor_name = coalesce(nullif(gc.vendor_name, ''), s.vendor),
       license_number = coalesce(nullif(gc.license_number, ''), s.license_number)
  from public.subtasks s
 where gc.task_id = s.task_id
   and (gc.vendor_name is null or gc.vendor_name = ''
        or gc.license_number is null or gc.license_number = '');
