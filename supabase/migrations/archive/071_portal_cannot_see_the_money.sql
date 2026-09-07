-- 071_portal_cannot_see_the_money.sql
--
-- Portal users can currently read AQ's margin, every vendor's IBAN, and the
-- contract app's password hashes. This closes that.
--
-- ── WHY THIS EXISTS ────────────────────────────────────────────────
--
-- Most of this schema was written when "has a Supabase JWT" meant "works at
-- AQ". Migration 002 says so out loud, above the contract-app tables:
--
--     -- (RLS stays OFF on these — auth happens at the API layer)
--
-- and 021 repeats it for vendors and bank accounts:
--
--     -- The ACTUAL scoping happens in the FastAPI portal endpoints, not in
--     -- RLS. ... narrow it later when we move auth into RLS proper.
--
-- That was true until 021 itself created external_users. A portal vendor or
-- client now signs in with a Supabase JWT and lands in the SAME `authenticated`
-- Postgres role as staff — and PostgREST is a second door the FastAPI
-- endpoints do not guard. Anyone who can open the portal can query the REST
-- API directly with the public anon key.
--
-- This is "later".
--
-- ── WHAT WAS ACTUALLY EXPOSED ─────────────────────────────────────
--
-- Verified by reproducing each one on Postgres 16, not by reading:
--
-- 1. `pm_task_campaign_rollup` handed over budget, client prices, vendor
--    costs and aq_gross for EVERY campaign in the database — to any portal
--    user, and to `anon`. pm_tasks' own RLS was never consulted: a view
--    without `security_invoker` runs as its OWNER, and the owner of a table
--    is exempt from that table's RLS unless FORCE ROW LEVEL SECURITY is set.
--    Nothing sets it. So RLS on pm_tasks was doing nothing for anyone who
--    asked through the view.
--
-- 2. `revoke select (price_excl, price_incl) ... from authenticated` in 046
--    is a no-op. Postgres keeps table-level and column-level SELECT as
--    separate grants and allows the read if EITHER is present; the
--    table-level grant from 002's `alter default privileges` was still
--    there, so the revoke logged a warning and changed nothing. 046's
--    comment calls it "belt and braces". Only the braces — the explicit
--    column list in publish_tracking_sheet() — were ever holding.
--
-- 3. The contract-app tables have RLS that was never enabled at all, and
--    002 grants select/insert/update/delete on every table to `anon` and
--    `authenticated` by default. `subtasks.price` and `subtasks.iban` are
--    vendor cost data any CLIENT could read; `tasks.amount` and
--    `generated_contracts.amount` are client billing any VENDOR could read;
--    `users.password_hash` was readable by anyone at all.
--
-- 4. `external_user_invites` is `for select using (true)`, granted to anon.
--    Every unclaimed invite token was listable, so a stranger could claim a
--    portal account for any vendor or client and walk in through the front.
--
-- 5. `bank_accounts` is `using (true)`: any vendor could read every other
--    vendor's IBAN.
--
-- ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────
--
-- `vendors`, `clients`, `client_brands` and `vendor_files` are also
-- `using (true)`. They are NOT touched here, because 020 and 021 both claim
-- an anon-key consumer ("the contract maker uses the anon key"). Nothing in
-- this repo does that any more — public/contracts/app.js goes through the
-- FastAPI backend — but a live integration that nobody wrote down would go
-- down silently, and "the vendor list is browsable" is a smaller problem
-- than "registration stopped working". Those come next, once that claim has
-- been checked against production.
--
-- ── SAFETY ────────────────────────────────────────────────────────
--
-- The FastAPI backend authenticates with the SERVICE ROLE key
-- (app/core/supabase.py: `SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY`), and
-- service_role bypasses RLS entirely. Nothing the backend does is affected
-- by anything below.
--
-- BEFORE RUNNING, CONFIRM: SUPABASE_SERVICE_ROLE_KEY is set in the Render
-- environment for aq-backend. If the backend is falling back to the anon
-- key, section 4 will break portal invites.
--
-- Safe to run twice.


-- ───────────────────────────────────────────────────────────────────
-- 0. Who is staff?
--
--    Not "has a JWT" — that now includes vendors and clients. Staff is a
--    row in workspace_members. SECURITY DEFINER so it can read that table
--    without tripping its own RLS, and it answers only about the caller,
--    so it leaks nothing.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members where user_id = auth.uid()
  );
$$;

revoke all on function public.is_staff() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.is_staff() to authenticated';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 1. The rollup view stops being a way around RLS
--
--    THE BIG ONE. With security_invoker the view is evaluated as the
--    CALLER, so pm_tasks' existing policy applies: staff see their
--    workspace's campaigns exactly as before, portal users and anon see
--    nothing. No policy is added and none is changed — the policy that was
--    always there simply starts being consulted.
-- ───────────────────────────────────────────────────────────────────

-- security_invoker arrived in Postgres 15. Fail loudly rather than leaving
-- the hole open with a green tick above it.
do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'This server is Postgres %, and security_invoker views need 15+. '
      'pm_task_campaign_rollup CANNOT be secured this way here — the view '
      'has to be replaced by a SECURITY DEFINER function that filters on '
      'has_role(), the way client_published_campaigns() does. Do not skip '
      'this: the view is currently readable by anyone with the anon key.',
      current_setting('server_version');
  end if;
end $$;

alter view public.pm_task_campaign_rollup set (security_invoker = on);

-- NOTE — one intended behaviour change. The view now sums only the
-- campaigns and bookings the CALLER can see, because that is what
-- evaluating pm_tasks' policy means. For owner/admin/marketing/sales/
-- key_account that is the whole workspace and nothing moves. For a role
-- that only sees tasks assigned to it, a rollup total may drop to match
-- what that person is actually allowed to know — which is the correct
-- number for them, and was previously being over-reported.

-- Nothing outside a workspace has any business here either way.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.pm_task_campaign_rollup from anon';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 2. Real column protection on the published sheet
--
--    Column grants only bite once the table-level grant is gone. So: take
--    SELECT away wholesale, then hand back exactly the columns the client
--    portal reads — the same list PortalCampaigns.tsx asks for, plus the
--    keys it needs to join and order.
--
--    Fail-closed, like publish_tracking_sheet(): a column added later is
--    NOT readable until somebody adds it here on purpose.
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

comment on column public.tracking_rows_published.price_excl is
  'NOT shared with the client. Protected by a column grant (071), not the no-op column revoke 046 attempted.';
comment on column public.tracking_rows_published.price_incl is
  'NOT shared with the client. See price_excl.';


-- ───────────────────────────────────────────────────────────────────
-- 3. The contract-app tables get RLS
--
--    002 left these open on the reasoning that auth happened at the API
--    layer. It does — for the API. It does not for PostgREST.
--
--    Everything here is read by the FastAPI backend on the service role,
--    which bypasses RLS. Three of them are ALSO read by the PM app in the
--    browser as staff (generated_contracts, pending_vendors,
--    pending_clients), so those get a staff read policy. The rest get
--    nothing, which means nothing outside service_role can touch them.
-- ───────────────────────────────────────────────────────────────────

-- 3a. Staff can read; nobody else can.
do $$
declare
  t text;
begin
  foreach t in array array[
    'generated_contracts', 'contract_completions', 'contract_invites',
    'tasks', 'subtasks'
  ] loop
    if exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "%s staff read" on public.%I', t, t);
      execute format(
        'create policy "%s staff read" on public.%I for select using (public.is_staff())', t, t);
      -- Writes stay with the backend and the SECURITY DEFINER approval
      -- functions. No write policy = no writes for anon or authenticated.
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format('revoke all on public.%I from anon', t);
      end if;
    end if;
  end loop;
end $$;

-- 3b. pending_vendors and pending_clients are NOT locked down here, and
--     that is a deliberate hole left open.
--
--     They carry an IBAN and a CR number, so a portal user can read the
--     registration queue — a real leak, and the next thing to fix.
--
--     But the vendor and client sign-up forms POST into them from outside
--     this repo, before the submitter has any account, and PostgREST's
--     default `Prefer: return=representation` makes an insert RETURN the
--     row it just wrote. RETURNING is evaluated against the SELECT policy,
--     so a staff-only read policy turns every submission into a permission
--     error — the form would fail while looking, from here, like it worked.
--
--     Column grants cannot help either: staff and portal users share the
--     `authenticated` role, so the only thing that can tell them apart is
--     RLS, which is exactly what breaks the insert.
--
--     The fix needs one fact this migration cannot check: whether the
--     sign-up form sends `return=minimal`, or can be changed to. Once it
--     does, the same block as 3a applies to both tables. Until then, a
--     browsable registration queue is a smaller problem than a sign-up
--     form that silently stops accepting vendors.

-- 3c. Nobody but service_role. `users.password_hash` is the reason this
--     block exists; the rest are internal trails with no browser reader.
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'app_settings', 'audit_logs', 'client_dedupe_map'
  ] loop
    if exists (
      select 1 from pg_tables where schemaname = 'public' and tablename = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      -- No policy at all. RLS on with no policy denies every row to every
      -- role except service_role and the table owner, which is the point.
      execute format('revoke all on public.%I from public', t);
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute format('revoke all on public.%I from anon', t);
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute format('revoke all on public.%I from authenticated', t);
      end if;
    end if;
  end loop;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 4. Invite tokens stop being listable
--
--    `for select using (true)` plus a grant to anon meant
--    /rest/v1/external_user_invites?select=* returned every unclaimed
--    token. A token is a bearer credential: listing them is handing out
--    portal accounts.
--
--    Validation and claiming both run through the FastAPI backend on the
--    service role (routers/external_invites.py), and through the
--    SECURITY DEFINER RPCs 021 created, so neither needs this grant.
-- ───────────────────────────────────────────────────────────────────

drop policy if exists "external_invites read by token" on public.external_user_invites;

-- Staff can see the invites they administer. Nobody else reads this table
-- through PostgREST at all.
drop policy if exists "external_invites staff read" on public.external_user_invites;
create policy "external_invites staff read" on public.external_user_invites
  for select using (public.is_staff());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.external_user_invites from anon';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- 5. A vendor's IBAN is their own
--
--    `using (true)` let any signed-in vendor read every other vendor's
--    bank details. The portal gets banks from /external-portal/me on the
--    service role, so scoping this breaks nothing.
-- ───────────────────────────────────────────────────────────────────

drop policy if exists "bank_accounts broad read"   on public.bank_accounts;
drop policy if exists "bank_accounts broad write"  on public.bank_accounts;
drop policy if exists "bank_accounts broad update" on public.bank_accounts;
drop policy if exists "bank_accounts broad delete" on public.bank_accounts;
drop policy if exists "bank_accounts scoped read"  on public.bank_accounts;

create policy "bank_accounts scoped read" on public.bank_accounts
  for select using (
    public.is_staff()
    or exists (
      select 1 from public.external_users eu
       where eu.auth_user_id = auth.uid()
         and eu.role = 'vendor'
         and eu.vendor_id = bank_accounts.vendor_id
    )
  );

drop policy if exists "bank_accounts staff write" on public.bank_accounts;
create policy "bank_accounts staff write" on public.bank_accounts
  for all using (public.is_staff()) with check (public.is_staff());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.bank_accounts from anon';
  end if;
end $$;


-- ───────────────────────────────────────────────────────────────────
-- Proof
-- ───────────────────────────────────────────────────────────────────

-- Should be one row, reloptions containing security_invoker=on.
select c.relname, c.reloptions
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'pm_task_campaign_rollup';

-- Should list ONLY the safe columns — no price_excl, no price_incl.
select column_name
  from information_schema.column_privileges
 where table_schema = 'public'
   and table_name = 'tracking_rows_published'
   and grantee = 'authenticated'
   and privilege_type = 'SELECT'
 order by column_name;

-- Expected result: EXACTLY two rows — pending_vendors and pending_clients,
-- the carve-out explained in 3b. Any other table listed here is a bug in
-- this migration; an empty result means 3b was closed by a later one.
select tablename as "still open, should be only the two pending_* queues"
  from pg_tables
 where schemaname = 'public'
   and tablename in (
     'users', 'tasks', 'subtasks', 'generated_contracts',
     'contract_completions', 'contract_invites', 'pending_vendors',
     'pending_clients', 'app_settings', 'audit_logs', 'client_dedupe_map')
   and not rowsecurity;
