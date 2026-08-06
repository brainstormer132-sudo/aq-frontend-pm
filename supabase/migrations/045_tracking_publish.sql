-- ============================================================
-- 045_tracking_publish.sql
-- Two tracking sheets: the internal one you work in, and a published
-- copy the client sees.
--
--   tracking_rows            the live working sheet (unchanged, internal)
--   tracking_rows_published  a snapshot, replaced each time someone
--                            presses "Publish to client"
--
-- Snapshot rather than a per-row visible flag, so half-finished edits
-- never leak: the client sees exactly what was published and nothing
-- else until it's published again.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- ─── 1. The published copy ───────────────────────────────────────
-- LIKE keeps this in step with tracking_rows automatically — any column
-- added there later is picked up by re-running this file, rather than
-- needing a hand-maintained mirror of 20-odd columns.

create table if not exists public.tracking_rows_published (
  like public.tracking_rows including defaults
);

alter table public.tracking_rows_published
  add column if not exists published_at   timestamptz not null default now(),
  add column if not exists published_by   uuid references public.profiles(id),
  -- Which working row this came from. Null once the original is deleted —
  -- the published copy deliberately survives, because the client may have
  -- already been shown it.
  add column if not exists source_row_id  uuid;

create index if not exists tracking_rows_published_task_idx
  on public.tracking_rows_published (task_id, position);

-- When was each campaign last published, and by whom.
alter table public.pm_tasks
  add column if not exists tracking_published_at timestamptz,
  add column if not exists tracking_published_by uuid references public.profiles(id);

-- ─── 2. Publish ──────────────────────────────────────────────────
-- Replace-all inside one transaction, so the client never sees a
-- half-written sheet even if this is pressed twice quickly.

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

  -- Only staff who can edit the campaign may publish to a client.
  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then
    raise exception 'You do not have permission to publish this sheet.' using errcode = '42501';
  end if;

  delete from public.tracking_rows_published where task_id = p_task_id;

  insert into public.tracking_rows_published
  select r.*, now(), auth.uid(), r.id
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

-- Withdraw: clears the published copy so the client sees nothing.
create or replace function public.unpublish_tracking_sheet(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;
  if auth.uid() is not null
     and not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then
    raise exception 'You do not have permission to unpublish this sheet.' using errcode = '42501';
  end if;

  delete from public.tracking_rows_published where task_id = p_task_id;
  update public.pm_tasks
     set tracking_published_at = null, tracking_published_by = null
   where id = p_task_id;
end;
$$;

-- ─── 3. Who can read the published sheet ─────────────────────────

alter table public.tracking_rows_published enable row level security;

-- Staff: same workspace as the campaign.
drop policy if exists "tracking_published_staff_read" on public.tracking_rows_published;
create policy "tracking_published_staff_read" on public.tracking_rows_published
  for select using (
    exists (
      select 1 from public.pm_tasks t
       where t.id = tracking_rows_published.task_id
         and public.has_role(t.workspace_id,
             array['owner','admin','marketing','sales','key_account','operations','member'])
    )
  );

-- The client, through the external portal: only their own campaigns, and
-- only the published copy. The working sheet stays invisible to them.
drop policy if exists "tracking_published_client_read" on public.tracking_rows_published;
create policy "tracking_published_client_read" on public.tracking_rows_published
  for select using (
    exists (
      select 1
        from public.pm_tasks t
        join public.external_users eu on eu.client_id = t.client_id
       where t.id = tracking_rows_published.task_id
         and eu.user_id = auth.uid()
         and eu.role = 'client'
    )
  );

-- Writes go through the two functions above only. Guarded because these
-- roles are Supabase-specific and absent on a plain Postgres.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke insert, update, delete on public.tracking_rows_published from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke insert, update, delete on public.tracking_rows_published from authenticated';
  end if;
end $$;

-- ─── 4. Which vendors belong in a tracking sheet ─────────────────
-- Influencer and UGC vendors are the ones whose work the client tracks.
-- vendor_categories.key is the canonical value (029); vendors.vendor_category
-- is free text that drifted, so match loosely — the same way 029 does.

create or replace function public.vendor_is_trackable(p_vendor_id bigint)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.vendors v
     where v.id = p_vendor_id
       and lower(trim(coalesce(v.vendor_category, ''))) in (
         'influencer', 'ugc', 'ugc creator', 'user generated content'
       )
  );
$$;

-- ─── 5. What's there now ─────────────────────────────────────────

select t.id as task_id,
       t.task_name,
       (select count(*) from public.tracking_rows r where r.task_id = t.id)            as working_rows,
       (select count(*) from public.tracking_rows_published p where p.task_id = t.id)  as published_rows,
       t.tracking_published_at
  from public.pm_tasks t
 where t.has_tracking
 order by t.created_at desc;
