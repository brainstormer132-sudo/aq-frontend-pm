-- A portal client must not be able to read the money on a published sheet
-- — AND must still be able to read the sheet.
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
-- then grant back the safe ones. 071 does that.
--
-- THE SECOND BUG THIS FREEZES: the first version of this file had only
-- the negative half below, and it passed against a baseline that had no
-- grants in it at all — the dump had been taken with --no-privileges. A
-- test that passes because the thing it inspects is absent is worse than
-- no test, because it reports green. Hence the positive half: the safe
-- columns must actually be readable. Together, the two halves can only
-- both pass on a database where the grants exist AND are correct.

-- ── 1. The money is not readable ──────────────────────────────────
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

-- ── 2. The sheet is still readable ────────────────────────────────
--
-- This is the half that catches a baseline dumped without privileges, and
-- also catches an over-enthusiastic revoke that locks the client out of
-- their own tracking sheet. Both failures are silent from the SQL side:
-- the portal just shows an empty table.
do $$
declare
  missing text;
begin
  select string_agg(c, ', ')
    into missing
    from unnest(array[
      -- The 16 columns 071 grants back. This is the client's tracking
      -- sheet: who posted, on what, when, and the link to it.
      'id', 'task_id', 'position',
      'influencer_name', 'profile_link', 'platform', 'type_of_ad',
      'content', 'product',
      'shooting_date', 'posting_date', 'ad_status', 'ad_link',
      'created_at', 'updated_at', 'published_at'
      --
      -- Deliberately NOT here, and each for its own reason:
      --   price_excl, price_incl          the money
      --   subtask_id, ad_line_id,
      --   ad_line_seq, source_row_id,
      --   published_by                    our internal wiring
      --   license_plate_url,
      --   contact_number, notes           the influencer's, not ours to share
      --   is_event, guest,
      --   location, visit_time            event logistics — see the note below
    ]) as c
   where not exists (
     select 1
       from information_schema.column_privileges
      where table_schema = 'public'
        and table_name  = 'tracking_rows_published'
        and grantee     = 'authenticated'
        and privilege_type = 'SELECT'
        and column_name = c
   );

  if missing is not null then
    raise exception
      'A portal client cannot read these columns of '
      'tracking_rows_published: %. Either the grants were never applied '
      '(a baseline dumped with --no-privileges carries none, and then the '
      'negative assertion above passes for the wrong reason), or a revoke '
      'took away more than the money.', missing;
  end if;
end $$;

-- ── An open question, recorded here because this is where it was found ──
--
-- is_event / guest / location / visit_time are withheld from the client,
-- and it is not obvious that they should be. They are the event-logistics
-- block: whether this ad is an event, who the guest is, where it happens
-- and at what time. For a client running an event campaign, that is their
-- own event — arguably theirs to see.
--
-- They are withheld today because 071 granted the columns the sheet needed
-- and stopped, and these four sit next to license_plate_url and
-- contact_number, which are the influencer's private details and are
-- correctly withheld. Nobody has decided; the grouping decided.
--
-- Leaving them out is the safe default, so the assertion above freezes the
-- current behaviour rather than guessing. If the answer is that clients
-- should see them, that is a 075 migration granting the four and four more
-- lines in the list above — not a change to make quietly.

-- ── 3. The publish function does not copy the money across ────────
--
-- Two independent defences, because 046 relied on one and it was the one
-- that did not work.
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
