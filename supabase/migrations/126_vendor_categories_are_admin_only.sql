-- ============================================================
-- 126_vendor_categories_are_admin_only.sql
-- The exemption must be harder to reach than the rule it excuses.
--
-- Migration 125 put `requires_contract` on public.vendor_categories, so that
-- categories which genuinely never have a contract - rentals, locations - can
-- be excused once instead of overridden every week.
--
-- That made the table's existing policies a problem:
--
--   vendor_categories read   SELECT using (true)
--   vendor_categories write  INSERT with check (true)
--   vendor_categories update UPDATE using (true)
--   vendor_categories delete DELETE using (true)
--
-- `using (true)` is every signed-in person. Before 125 that was a lookup
-- table of eleven labels and the worst case was a typo. After 125 it is the
-- switch that turns a rule off - and anybody stopped by the contract rule
-- could excuse the whole category in one update, silently, instead of using
-- the code and appearing in the log.
--
-- An exemption that is easier to reach than the override defeats the
-- override. So: reading stays open, and CHANGING becomes owner-or-admin.
--
-- -- WHY THE PREDICATE IS NOT has_role() ----------------------------
--
-- has_role(ws_id, roles) needs a workspace and this table has no
-- workspace_id - it is global, shared by every workspace in the project. The
-- honest predicate is therefore "owner or admin ANYWHERE", written out
-- rather than borrowed from a function that would need a workspace invented
-- to call it.
--
-- -- WHY THIS BREAKS NOTHING ----------------------------------------
--
-- Measured before writing: `from('vendor_categories')` appears twice in the
-- whole app (hooks/use-workflow.ts 4800 and 5216) and both are `.select`.
-- NOTHING in this app has ever written to this table - the rows were seeded
-- by migration and edited by hand. The Settings screen that edits
-- requires_contract is owner-and-admin-only anyway, which is where this
-- predicate came from.
--
-- service_role is unaffected: it bypasses RLS entirely, so the backend and
-- any seed script keep working.
-- ============================================================

-- One predicate, named once, so the four policies cannot drift apart.
create or replace function public.is_workspace_admin() returns boolean
  language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
     where user_id = auth.uid()
       and role in ('owner', 'admin')
  );
$$;

comment on function public.is_workspace_admin() is
  'True when the caller is an owner or admin of ANY workspace. For global lookup tables that carry no workspace_id and so cannot use has_role().';

revoke all on function public.is_workspace_admin() from public, anon;
grant execute on function public.is_workspace_admin() to authenticated, service_role;

-- Reading stays open to everybody: the vendor form renders this list, and a
-- category picker that is empty for most of the company is a worse failure
-- than a label somebody should not have edited.
drop policy if exists "vendor_categories read"   on public.vendor_categories;
create policy "vendor_categories read" on public.vendor_categories
  for select using (true);

drop policy if exists "vendor_categories write"  on public.vendor_categories;
create policy "vendor_categories write" on public.vendor_categories
  for insert to authenticated with check (public.is_workspace_admin());

drop policy if exists "vendor_categories update" on public.vendor_categories;
create policy "vendor_categories update" on public.vendor_categories
  for update to authenticated
  using (public.is_workspace_admin())
  with check (public.is_workspace_admin());

drop policy if exists "vendor_categories delete" on public.vendor_categories;
create policy "vendor_categories delete" on public.vendor_categories
  for delete to authenticated using (public.is_workspace_admin());

-- Prove it, rather than trust it.
--
-- No session here, so is_workspace_admin() is false - which means this CAN
-- test the half that says no, by trying the write as `authenticated`. The
-- half that says yes is tested on a scratch database with the membership
-- stubbed, because there is no way to be an admin from the SQL editor.
do $$
declare
  n     integer;
  fired boolean := false;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'vendor_categories';
  if n <> 4 then
    raise exception 'vendor_categories: expected four policies, found %', n;
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'vendor_categories'
     and cmd in ('UPDATE', 'INSERT', 'DELETE')
     and coalesce(qual, with_check) like '%is_workspace_admin%';
  if n <> 3 then
    raise exception
      'vendor_categories: % of the three write policies mention is_workspace_admin, not 3', n;
  end if;

  -- And reading is still open, which is the half that would be easy to
  -- break while tightening the other three.
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'vendor_categories'
     and cmd = 'SELECT' and qual = 'true';
  if n <> 1 then
    raise exception 'vendor_categories: reading is no longer open to everybody';
  end if;

  raise notice 'vendor_categories: reading is open, changing is owner or admin only';
end $$;

-- Verify (paste this after running the migration):
-- select policyname, cmd, coalesce(qual, with_check) as predicate
--   from pg_policies
--  where schemaname = 'public' and tablename = 'vendor_categories'
--  order by policyname
-- expected: read = true; write, update and delete = is_workspace_admin()
