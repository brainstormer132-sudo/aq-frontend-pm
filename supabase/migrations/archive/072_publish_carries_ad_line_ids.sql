-- 072_publish_carries_ad_line_ids.sql
--
-- A published sheet can now be traced back to the ads it came from.
--
-- ── WHAT THIS FIXES ───────────────────────────────────────────────
--
-- 063 added `ad_line_id`, `ad_line_seq` and `subtask_id` to BOTH
-- tracking_rows and tracking_rows_published. It did not touch
-- publish_tracking_sheet(), whose column list has been explicit since 046 —
-- so the three columns exist on the published table and have always been
-- null in it. Every published row lost the link to the ad that produced it.
--
-- 046 wrote that explicit list on purpose, and was right to: it replaced a
-- `select r.*` that copied price_excl and price_incl to clients. The list is
-- fail-CLOSED — a column added later is not shared until somebody adds it
-- here deliberately. This is that deliberate addition, for three columns and
-- no others.
--
-- ── WHY IT IS WORTH DOING ─────────────────────────────────────────
--
-- Traceability is currently one hop away rather than absent: `source_row_id`
-- is copied and points at the working row, which carries `ad_line_id`. That
-- hop breaks the moment the working row is deleted — and a published
-- snapshot exists precisely to outlive edits to the working sheet. After
-- this the snapshot describes itself.
--
-- ── WHY IT IS NOT A LEAK ──────────────────────────────────────────
--
-- The data lands in the table; the client still cannot read it.
--
-- 071 revoked SELECT on tracking_rows_published wholesale and granted back
-- exactly sixteen columns. These three are not among them, and this
-- migration does not add them — deliberately. `subtask_id` would let a
-- portal client work out which vendor booking each of their ads belongs to,
-- which is our commercial arrangement, not theirs.
--
-- So: internal traceability, no change to what a client can see. The
-- verification at the bottom asserts both halves.
--
-- Safe to run twice. Re-publishing an existing sheet fills the columns in;
-- sheets published before this keep their nulls until they are published
-- again, which is correct — this does not invent a link for a snapshot
-- taken before the link was recorded.

-- ───────────────────────────────────────────────────────────────────
-- 1. Publish, carrying the three ids
--
--    Everything else is 046's function unchanged: SECURITY DEFINER, the
--    same role check, delete-then-insert, and the same money columns still
--    absent. Restated in full rather than patched, because this is the
--    function that decides what a client sees and it should be readable in
--    one piece.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.publish_tracking_sheet(p_task_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_count     integer;
begin
  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;
  if v_workspace is null then
    raise exception 'No such task: %', p_task_id using errcode = '42704';
  end if;

  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then
    raise exception 'You do not have permission to publish this sheet.' using errcode = '42501';
  end if;

  delete from public.tracking_rows_published where task_id = p_task_id;

  -- Shared:     who, where, what, when, status, link, and now which ad.
  -- NOT shared: price_excl, price_incl, notes, contact_number,
  --             license_plate_url — money, internal notes and PII.
  --
  -- If you add a column here, ask whether the client should see it. Landing
  -- in this table is not the same as being readable — 071's column grants
  -- decide that — but the two lists should be reasoned about together.
  insert into public.tracking_rows_published (
    id, task_id, position,
    influencer_name, profile_link,
    platform, type_of_ad, content, product,
    shooting_date, posting_date, ad_status, ad_link,
    ad_line_id, ad_line_seq, subtask_id,
    created_at, updated_at,
    published_at, published_by, source_row_id
  )
  select r.id, r.task_id, r.position,
         r.influencer_name, r.profile_link,
         r.platform, r.type_of_ad, r.content, r.product,
         r.shooting_date, r.posting_date, r.ad_status, r.ad_link,
         r.ad_line_id, r.ad_line_seq, r.subtask_id,
         r.created_at, r.updated_at,
         now(), auth.uid(), r.id
    from public.tracking_rows r
   where r.task_id = p_task_id;

  get diagnostics v_count = row_count;

  update public.pm_tasks
     set tracking_published_at = now(),
         tracking_published_by = auth.uid()
   where id = p_task_id;

  return v_count;
end;
$$;

comment on column public.tracking_rows_published.ad_line_id is
  'The vendor_ad_lines row this ad came from. Internal only — not in the column grant a portal client holds (071).';
comment on column public.tracking_rows_published.subtask_id is
  'The vendor booking this ad belongs to. NEVER granted to a portal client: which vendor is behind which ad is our arrangement, not theirs.';

-- ───────────────────────────────────────────────────────────────────
-- 2. Re-assert the column grants
--
--    Belt and braces, and this time the braces work. 071 revoked
--    table-level SELECT and granted sixteen columns back; a `create or
--    replace function` cannot undo that, but restating it here means this
--    file is safe to run on a database where 071 has not been applied yet,
--    rather than quietly publishing three new columns into a table anyone
--    can read whole.
-- ───────────────────────────────────────────────────────────────────

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke select on public.tracking_rows_published from %I', r);
      execute format($f$
        grant select (
          id, task_id, position,
          influencer_name, profile_link,
          platform, type_of_ad, content, product,
          shooting_date, posting_date, ad_status, ad_link,
          created_at, updated_at, published_at
        ) on public.tracking_rows_published to %I
      $f$, r);
    end if;
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- Proof
-- ───────────────────────────────────────────────────────────────────

-- 1. The function now copies the three ids. Expect all three to be true.
select
  position('r.ad_line_id'  in prosrc) > 0 as copies_ad_line_id,
  position('r.ad_line_seq' in prosrc) > 0 as copies_ad_line_seq,
  position('r.subtask_id'  in prosrc) > 0 as copies_subtask_id
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'publish_tracking_sheet';

-- 2. And still does NOT copy the money. Expect both false.
select
  position('r.price_excl' in prosrc) > 0 as leaks_price_excl,
  position('r.price_incl' in prosrc) > 0 as leaks_price_incl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'publish_tracking_sheet';

-- 3. What a portal client may actually SELECT. Expect the same sixteen as
--    before: no ad_line_id, no subtask_id, no price columns.
select column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'tracking_rows_published'
   and grantee = 'authenticated'
   and privilege_type = 'SELECT'
 order by column_name;
