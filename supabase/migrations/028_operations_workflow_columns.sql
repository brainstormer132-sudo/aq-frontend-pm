-- ============================================================
-- 028 — Operations workflow columns + lookup tables
--
-- Mirrors the columns the AQ operations team uses today in the
-- monthly Asana export (Jun_26.xlsx). The PM-side pm_tasks table
-- already covered Asana's identity / dates / assignee / brand /
-- sales / approval stage; this migration adds the financial /
-- operations layer that lived only in Excel:
--
--   • Per-vendor (child pm_tasks) financial: price, net_amount,
--     aq_gross (computed = price - net_amount), platform, ad_type,
--     vendor_id link, vendor_payment_date / vendor_payment_amount.
--
--   • Per-campaign (parent pm_tasks) operations: source, client
--     category, quotation_no, quotation_breakdown, invoice_no,
--     client_payment_status / date / amount, contract_status text
--     (manual override; otherwise inferred from generated_contracts).
--
--   • Two lookup tables (task_sources, client_categories) so the
--     operations team can add new categories without code changes.
--
--   • View pm_task_campaign_rollup: per-parent Σ price / net / gross,
--     vendor_count, contracts_signed. Used by the campaign list view
--     so the UI can show the same totals row the team reads in Excel.
--
-- All changes are additive. No data is dropped. Safe to re-run via
-- `add column if not exists` and `create table if not exists`.
--
-- Run in Supabase SQL editor.
-- ============================================================

begin;

-- ─── 1. Lookup tables ────────────────────────────────────────────

create table if not exists public.task_sources (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz default now(),
  unique (workspace_id, name)
);
create index if not exists idx_task_sources_ws on public.task_sources(workspace_id);

create table if not exists public.client_categories (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz default now(),
  unique (workspace_id, name)
);
create index if not exists idx_client_categories_ws on public.client_categories(workspace_id);

-- RLS — same workspace-membership pattern used everywhere else.
alter table public.task_sources enable row level security;
alter table public.client_categories enable row level security;

drop policy if exists "task_sources_member_read" on public.task_sources;
create policy "task_sources_member_read" on public.task_sources
  for select using (
    public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account','member'])
  );
drop policy if exists "task_sources_admin_write" on public.task_sources;
create policy "task_sources_admin_write" on public.task_sources
  for all using (
    public.has_role(workspace_id, array['owner','admin'])
  ) with check (
    public.has_role(workspace_id, array['owner','admin'])
  );

drop policy if exists "client_categories_member_read" on public.client_categories;
create policy "client_categories_member_read" on public.client_categories
  for select using (
    public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account','member'])
  );
drop policy if exists "client_categories_admin_write" on public.client_categories;
create policy "client_categories_admin_write" on public.client_categories
  for all using (
    public.has_role(workspace_id, array['owner','admin'])
  ) with check (
    public.has_role(workspace_id, array['owner','admin'])
  );


-- ─── 2. pm_tasks additions ───────────────────────────────────────

-- Per-vendor financial / classification (these are set on CHILD pm_tasks,
-- one row per vendor assignment, parented by parent_task_id). The
-- pm_task_campaign_rollup view below sums them up to the parent.
alter table public.pm_tasks
  add column if not exists vendor_id              bigint references public.vendors(id) on delete set null,
  add column if not exists price                  numeric(14,2),
  add column if not exists net_amount             numeric(14,2),
  -- aq_gross is computed automatically. NEVER write to it from the app.
  -- If price or net_amount is NULL the result is NULL — the UI should
  -- treat that as "not yet entered" rather than 0.
  add column if not exists aq_gross               numeric(14,2) generated always as (price - net_amount) stored,
  add column if not exists platform               text,
  add column if not exists ad_type                text,
  add column if not exists vendor_payment_date    date,
  add column if not exists vendor_payment_amount  numeric(14,2);

-- Per-campaign operations (set on PARENT pm_tasks). Children inherit
-- visually via the rollup view; the actual values stay on the parent.
alter table public.pm_tasks
  add column if not exists source_id              uuid references public.task_sources(id) on delete set null,
  add column if not exists client_category_id     uuid references public.client_categories(id) on delete set null,
  add column if not exists quotation_no           text,
  -- "With Breakdown" / "Without Breakdown" — kept as text so ops can write
  -- whatever variant they need. Enum was overkill; only two real values.
  add column if not exists quotation_breakdown    text,
  add column if not exists invoice_no             text,
  -- "pending" / "paid" / "partial" — enum-ish but text for forward
  -- compatibility. The frontend renders a chip based on this string.
  add column if not exists client_payment_status  text,
  add column if not exists client_payment_date    date,
  add column if not exists client_payment_amount  numeric(14,2),
  -- Manual override for the operations team. Otherwise the UI infers
  -- the contract status by joining to generated_contracts.
  -- Common values from the Excel: "Pending", "On Process",
  -- "No Contract", "Signed".
  add column if not exists contract_status        text;

create index if not exists idx_pm_tasks_vendor_id          on public.pm_tasks(vendor_id);
create index if not exists idx_pm_tasks_source_id          on public.pm_tasks(source_id);
create index if not exists idx_pm_tasks_client_category_id on public.pm_tasks(client_category_id);


-- ─── 3. Per-campaign rollup view ─────────────────────────────────
--
-- One row per PARENT pm_task. Sums financial + counts across its child
-- vendor assignments. Lets the UI render the "Σ Prices: 262000 |
-- Σ Nets: 215000 | Σ AQ Gross: 47000" line directly without
-- aggregating in the app.

create or replace view public.pm_task_campaign_rollup as
select
  parent.id                              as parent_task_id,
  parent.workspace_id,
  parent.title,
  parent.brand_name,
  parent.budget                          as parent_total_amount,
  parent.client_payment_status,
  parent.contract_status,
  count(child.id)                        as vendor_count,
  count(child.id) filter (where child.status = 'done')  as vendors_done,
  coalesce(sum(child.price), 0)          as sum_prices,
  coalesce(sum(child.net_amount), 0)     as sum_nets,
  coalesce(sum(child.aq_gross), 0)       as sum_aq_gross,
  -- Variance vs. the parent's manually-entered Total Amount. Non-zero
  -- means someone forgot to update either the parent total or a child
  -- price — surface this in the UI so the operations team can spot
  -- data-entry mistakes the same way they currently do by re-checking
  -- the Excel manually.
  coalesce(sum(child.price), 0) - coalesce(parent.budget, 0)
                                         as price_vs_total_variance
from public.pm_tasks parent
left join public.pm_tasks child on child.parent_task_id = parent.id
where parent.parent_task_id is null  -- parents only
group by parent.id, parent.workspace_id, parent.title, parent.brand_name,
         parent.budget, parent.client_payment_status, parent.contract_status;


-- ─── 4. Notes for app code (do AFTER running this migration) ────
--
-- (a) Hooks in `hooks/use-workflow.ts`: add fetchers that read the new
--     columns and the rollup view. The existing `usePmTasks` hook
--     should select * + the new fields automatically; if it explicitly
--     lists columns, add the new ones there.
--
-- (b) Backend (`aq-backend`): the contract-maker doesn't touch
--     pm_tasks; it reads the legacy `tasks` / `subtasks` tables. So
--     this migration doesn't affect contract generation. The PM-side
--     Next.js app is the only consumer.
--
-- (c) UI surfaces to add:
--       • Task drawer: "Operations" section with the new fields
--       • Campaign view: roll-up row from pm_task_campaign_rollup
--       • Settings → Lookups: admin can add task_sources and
--         client_categories rows per workspace
--
-- (d) To seed initial values (run once per workspace, then add via UI):
--
--     insert into public.task_sources (workspace_id, name, position) values
--       ('<workspace-uuid>', 'AQ',       1),
--       ('<workspace-uuid>', 'Inf.',     2),
--       ('<workspace-uuid>', 'Referral', 3);
--
--     insert into public.client_categories (workspace_id, name, position) values
--       ('<workspace-uuid>', 'F&B',    1),
--       ('<workspace-uuid>', 'Retail', 2),
--       ('<workspace-uuid>', 'Beauty', 3),
--       ('<workspace-uuid>', 'Auto',   4),
--       ('<workspace-uuid>', 'Tech',   5);

commit;

-- ─── Verification queries — run after the migration ─────────────

-- New pm_tasks columns should all be present:
select column_name, data_type, is_generated
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'pm_tasks'
   and column_name in (
     'vendor_id', 'price', 'net_amount', 'aq_gross',
     'platform', 'ad_type',
     'vendor_payment_date', 'vendor_payment_amount',
     'source_id', 'client_category_id',
     'quotation_no', 'quotation_breakdown', 'invoice_no',
     'client_payment_status', 'client_payment_date', 'client_payment_amount',
     'contract_status'
   )
 order by column_name;
-- Expect 17 rows, with aq_gross having is_generated='ALWAYS'.

-- Lookup tables should exist:
select count(*) as task_sources_count   from public.task_sources;
select count(*) as client_categories_count from public.client_categories;

-- Rollup view should compile (even with zero data):
select count(*) as campaigns_count from public.pm_task_campaign_rollup;
