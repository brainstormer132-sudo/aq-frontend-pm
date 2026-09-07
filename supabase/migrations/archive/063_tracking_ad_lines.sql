-- ============================================================
-- 063_tracking_ad_lines.sql
--
-- The tracking sheet becomes one row per AD, not one row per vendor.
--
-- Why
-- ---
-- tracking_rows and vendor_ad_lines hold the same ad in two tables:
-- influencer/vendor, platform, ad type, posting date, status, link and price
-- all overlap, and AD_STATUSES / AD_LINE_STATUSES are the same five words
-- declared in two files.
--
-- Worse, the two shapes disagreed. ensureTrackingRowForVendor() was idempotent
-- by vendor NAME, so a vendor booked for six home ads and six store visits got
-- twelve ad lines and exactly ONE sheet row — one posting date and one status
-- standing for twelve pieces on twelve different days. The sheet could not
-- describe a package booking, which is most of them.
--
-- What this does
-- --------------
-- Adds the link back to the booking:
--
--   ad_line_id   which vendor_ad_lines row this came from (null = typed here)
--   ad_line_seq  which of that line's `quantity` ads it is, 1-based
--   subtask_id   which booking, kept so the row still knows where it came
--                from after an ad line is deleted
--
-- A line of 4 Store Visits becomes four rows: (line, 1) … (line, 4). The
-- unique index is what makes seeding idempotent — re-running it can never
-- double a sheet.
--
-- Nothing is backfilled. Existing rows keep ad_line_id null and go on
-- behaving exactly as they do today; the app offers to add the ads that are
-- missing, one campaign at a time, showing what it will add first. Rewriting
-- live sheets in a migration is not worth the risk.
--
-- IMPORTANT: tracking_rows_published was created with `like tracking_rows`,
-- and publish_tracking_sheet() does `insert into tracking_rows_published
-- select r.*, now(), auth.uid(), r.id from tracking_rows r`. That is
-- positional. Adding a column to tracking_rows WITHOUT adding it to the
-- published table breaks publishing for every campaign. Both tables are
-- changed here, in the same order.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

begin;

-- ─── 1. The working sheet ────────────────────────────────────────

alter table public.tracking_rows
  add column if not exists ad_line_id  uuid
    references public.vendor_ad_lines(id) on delete set null,
  add column if not exists ad_line_seq integer,
  add column if not exists subtask_id  uuid
    references public.pm_tasks(id) on delete set null;

-- Seeding is idempotent because of this: one sheet row per ad, per line.
-- Partial, so the hand-typed rows (ad_line_id null) are unaffected.
create unique index if not exists tracking_rows_ad_line_uniq
  on public.tracking_rows (ad_line_id, ad_line_seq)
  where ad_line_id is not null;

create index if not exists tracking_rows_subtask_idx
  on public.tracking_rows (subtask_id);

-- ─── 2. The published snapshot ───────────────────────────────────
-- Same columns, same order. See the note above about `select r.*`.

alter table public.tracking_rows_published
  add column if not exists ad_line_id  uuid,
  add column if not exists ad_line_seq integer,
  add column if not exists subtask_id  uuid;

-- Deliberately no FK on the snapshot: it is a copy of what the client was
-- shown, and it has to survive the booking being deleted. tracking_rows'
-- own `on delete set null` already stops a deleted ad line taking a working
-- row with it.

-- ─── 3. Sanity ───────────────────────────────────────────────────
-- The column counts must match or publishing breaks. This raises loudly
-- rather than leaving it to be discovered by a client.

do $$
declare
  v_working   integer;
  v_published integer;
begin
  select count(*) into v_working
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tracking_rows';

  select count(*) into v_published
    from information_schema.columns
   where table_schema = 'public' and table_name = 'tracking_rows_published';

  -- The snapshot carries three extra columns of its own: published_at,
  -- published_by, source_row_id.
  if v_published <> v_working + 3 then
    raise exception
      'tracking_rows has % columns and tracking_rows_published has % (expected %). publish_tracking_sheet() would fail.',
      v_working, v_published, v_working + 3;
  end if;
end $$;

commit;
