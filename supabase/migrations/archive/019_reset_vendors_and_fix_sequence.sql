-- Reset vendors to zero AND fix the PK sequence so new vendors don't crash
-- with "duplicate key value violates unique constraint vendors_pkey".
--
-- Root cause: at some point rows were inserted into public.vendors with
-- explicit ids (probably from an early seed/import), but the underlying
-- bigserial sequence was not bumped. Postgres' nextval() then handed out
-- ids that already existed.
--
-- This migration:
--   1. Drops dependent rows (bank_accounts) to keep referential integrity.
--   2. Truncates vendors.
--   3. Restarts whichever sequence backs vendors.id from 1.
--   4. Repeats the fix for related sequences so next inserts are clean.
--
-- Run in Supabase SQL Editor.

-- 1. Wipe bank_accounts first (FK to vendors.id, ON DELETE behaviour varies).
truncate table public.bank_accounts restart identity cascade;

-- 2. Wipe vendors. RESTART IDENTITY resets any owned sequence to 1.
truncate table public.vendors restart identity cascade;

-- 3. Belt-and-suspenders: even if the sequence wasn't owned by the column
--    (e.g., it was created manually), force it back to 1.
do $$
declare
  seq_name text;
begin
  select pg_get_serial_sequence('public.vendors', 'id') into seq_name;
  if seq_name is not null then
    execute format('alter sequence %s restart with 1', seq_name);
  end if;

  select pg_get_serial_sequence('public.bank_accounts', 'id') into seq_name;
  if seq_name is not null then
    execute format('alter sequence %s restart with 1', seq_name);
  end if;
end $$;

-- 4. Resync helper — call this any time you suspect drift again.
--    Sets the vendor sequence to max(id) + 1 so the next insert is safe
--    even if rows were inserted with explicit ids.
create or replace function public.resync_vendor_sequence()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seq_name text;
  max_id bigint;
begin
  select pg_get_serial_sequence('public.vendors', 'id') into seq_name;
  if seq_name is null then
    raise notice 'No sequence backs public.vendors.id';
    return;
  end if;
  select coalesce(max(id), 0) into max_id from public.vendors;
  execute format('select setval(%L, %s, true)', seq_name, greatest(max_id, 1));
end $$;

grant execute on function public.resync_vendor_sequence() to authenticated, service_role;

-- Verification:
-- select count(*) from public.vendors;          -- expect 0
-- select count(*) from public.bank_accounts;    -- expect 0
-- select pg_get_serial_sequence('public.vendors','id');
-- select last_value from <sequence-name-from-above>;
-- after creating a vendor in the UI:
-- select id, name from public.vendors order by id;
