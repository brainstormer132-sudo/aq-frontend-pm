-- ============================================================
-- 046_client_tracking_access.sql
-- Fixes a silent hole in 045.
--
-- 045's client policy read public.pm_tasks inside the USING clause.
-- pm_tasks has its own RLS (008), keyed to workspace_members — and an
-- external portal client is not a workspace member. So the subquery
-- returned nothing and the policy denied every row: publishing appeared
-- to work, and the client saw an empty sheet forever.
--
-- Nothing in 045's own tests caught it because the fixture had RLS
-- disabled on pm_tasks. Verified here with it enabled.
--
-- The fix is a SECURITY DEFINER helper, which evaluates the ownership
-- check with the function owner's privileges instead of the caller's.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- ─── 1. Does this portal client own this campaign? ───────────────
-- SECURITY DEFINER so it can see pm_tasks and external_users regardless
-- of the caller's RLS. It returns only a boolean about the CALLER's own
-- access, so it leaks nothing.

create or replace function public.client_can_see_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.pm_tasks t
      join public.external_users eu on eu.client_id = t.client_id
     where t.id = p_task_id
       and eu.auth_user_id = auth.uid()
       and eu.role = 'client'
  );
$$;

revoke all on function public.client_can_see_task(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.client_can_see_task(uuid) to authenticated';
  end if;
end $$;

drop policy if exists "tracking_published_client_read" on public.tracking_rows_published;
create policy "tracking_published_client_read" on public.tracking_rows_published
  for select using (public.client_can_see_task(task_id));

-- ─── 2. The campaign list for the portal ─────────────────────────
-- A client cannot read pm_tasks at all, so they cannot discover which
-- campaigns have a sheet. This returns exactly the columns the portal
-- needs and nothing else — no budget, no internal status, no vendors.

create or replace function public.client_published_campaigns()
returns table (
  task_id      uuid,
  task_name    text,
  brand_name   text,
  published_at timestamptz,
  row_count    bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         coalesce(t.task_name, t.title),
         t.brand_name,
         t.tracking_published_at,
         (select count(*) from public.tracking_rows_published p where p.task_id = t.id)
    from public.pm_tasks t
    join public.external_users eu on eu.client_id = t.client_id
   where eu.auth_user_id = auth.uid()
     and eu.role = 'client'
     and t.tracking_published_at is not null
   order by t.tracking_published_at desc;
$$;

revoke all on function public.client_published_campaigns() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.client_published_campaigns() to authenticated';
  end if;
end $$;


-- ─── 3. Publish only client-safe columns ─────────────────────────
--
-- 045 published with `insert into ... select r.*`, which copied EVERY
-- column of tracking_rows — including price_excl, price_incl and the
-- vendor cost fields. RLS grants row access, not column access, so a
-- portal client could have read AQ's vendor pricing straight off the
-- REST API even though no UI showed it.
--
-- This restates publish with an explicit column list. It is fail-CLOSED
-- on purpose: a column added to tracking_rows later is NOT shared until
-- someone adds it here deliberately. If you add one, ask whether the
-- client should see it before you do.
--
-- Shared:     who, where, what, when, status, link.
-- Not shared: price_excl, price_incl, notes, contact_number,
--             license_plate_url — money, internal notes and PII.

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

  insert into public.tracking_rows_published (
    id, task_id, position,
    influencer_name, profile_link,
    platform, type_of_ad, content, product,
    shooting_date, posting_date, ad_status, ad_link,
    created_at, updated_at,
    published_at, published_by, source_row_id
  )
  select r.id, r.task_id, r.position,
         r.influencer_name, r.profile_link,
         r.platform, r.type_of_ad, r.content, r.product,
         r.shooting_date, r.posting_date, r.ad_status, r.ad_link,
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

-- Belt and braces: even if a future publish path copies them, the money
-- columns are not selectable by portal users.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke select (price_excl, price_incl) on public.tracking_rows_published from authenticated';
  end if;
end $$;
