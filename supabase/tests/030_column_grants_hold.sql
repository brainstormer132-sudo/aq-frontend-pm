-- A portal client must not be able to read the money on a published sheet.
--
-- THE BUG THIS FREEZES: migration 046 wrote
--
--     revoke select (price_excl, price_incl)
--       on public.tracking_rows_published from authenticated;
--
-- and called it "belt and braces". It is a no-op. Postgres keeps
-- table-level and column-level SELECT as separate grants and permits the
-- read if EITHER is present — and the table-level grant from 002's
-- `alter default privileges` was still there. The revoke logged a warning
-- and changed nothing.
--
-- To protect a column you must revoke SELECT on the whole table first,
-- then grant back the safe ones. 071 does that. This asserts it stayed
-- done, because the failure is silent in both directions: nothing errors
-- when the protection is absent.

do $$
declare
  leaked text;
begin
  select string_agg(distinct column_name, ', ')
    into leaked
    from information_schema.column_privileges
   where table_schema = 'public'
     and table_name = 'tracking_rows_published'
     and grantee in ('anon', 'authenticated')
     and privilege_type = 'SELECT'
     and column_name in (
       'price_excl', 'price_incl',   -- what we charge
       'subtask_id',                  -- which vendor is behind which ad
       'ad_line_id', 'ad_line_seq',
       'notes', 'contact_number', 'license_plate_url',
       'published_by', 'source_row_id'
     );

  if leaked is not null then
    raise exception
      'A portal user can read these columns of tracking_rows_published: %. '
      'Revoke SELECT on the table and grant back only the client-safe '
      'columns — a column-level revoke on its own does nothing.', leaked;
  end if;
end $$;

-- And the publish function must not copy the money across in the first
-- place. Two independent defences, because 046 relied on one and it was
-- the one that did not work.
do $$
declare
  src text;
begin
  select prosrc into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publish_tracking_sheet';

  if src is null then
    raise exception 'publish_tracking_sheet() is missing.';
  end if;
  if position('r.price_excl' in src) > 0 or position('r.price_incl' in src) > 0 then
    raise exception
      'publish_tracking_sheet() copies price columns onto the client''s '
      'sheet. It must list its columns explicitly and leave the money out.';
  end if;
  if position('select r.*' in lower(src)) > 0 then
    raise exception
      'publish_tracking_sheet() uses `select r.*`, so every column added to '
      'tracking_rows in future is shared with the client automatically. '
      'List the columns.';
  end if;
end $$;
