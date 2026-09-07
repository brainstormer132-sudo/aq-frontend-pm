-- 066_contract_length.sql
--
-- How long a contract runs for.
--
-- Siraj asked for "a cell for contract length" on the campaign page. It was
-- never a column: the duration lived only in the generated .docx, so the app
-- could show you that a contract was signed without being able to tell you
-- what it committed to or when it lapses.
--
-- Two columns rather than one free-text box, because "2 weeks" typed by one
-- person and "two weeks" by another cannot be compared, sorted, or added to a
-- date. A number and a unit can.
--
-- It goes on pm_tasks so BOTH sides get the same field: the campaign row
-- carries the client's contract length, and each vendor booking (a subtask,
-- same table) carries that vendor's. One field asked twice, not two.
--
-- Safe to re-run.

alter table public.pm_tasks
  add column if not exists contract_length      integer,
  add column if not exists contract_length_unit text;

-- Nullable on purpose: most historic rows have no recorded duration and
-- inventing one would be worse than admitting it is unknown. A zero-length
-- contract is not a thing, so anything at or below zero is refused rather
-- than stored and shown as "0 months".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_contract_length_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_contract_length_chk
      check (contract_length is null or contract_length > 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_contract_length_unit_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_contract_length_unit_chk
      check (contract_length_unit is null
             or contract_length_unit in ('days', 'weeks', 'months'));
  end if;

  -- A number with no unit is not a duration, and a unit with no number is not
  -- one either. Either both are set or neither is.
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_contract_length_pair_chk'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_contract_length_pair_chk
      check ((contract_length is null) = (contract_length_unit is null));
  end if;
end $$;

comment on column public.pm_tasks.contract_length is
  'How long the contract runs. On a campaign row this is the client''s term; on a vendor subtask it is that vendor''s. Null = not recorded.';
comment on column public.pm_tasks.contract_length_unit is
  'days | weeks | months. Set together with contract_length or not at all.';

-- Verification — expect two rows.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'pm_tasks'
   and column_name in ('contract_length', 'contract_length_unit')
 order by column_name;
