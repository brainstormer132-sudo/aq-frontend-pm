-- ============================================================
-- PM-app Tracking Sheet
-- ------------------------------------------------------------
-- A tracking sheet is opt-in per campaign. When a user selects the
-- "Tracking Sheet" subtask during Marketing triage, the parent
-- pm_task is flagged (has_tracking = true). The sheet itself is a
-- collection of tracking_rows (one row per ad / vendor deliverable),
-- edited from the task's "Tracking sheet" panel — it is NOT a
-- top-level sidebar view.
-- ============================================================

-- 1. Flag column on the campaign (parent task).
alter table public.pm_tasks
  add column if not exists has_tracking boolean not null default false;

-- 2. One row per ad / vendor deliverable in a campaign's tracking sheet.
create table if not exists public.tracking_rows (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.pm_tasks(id) on delete cascade,
  position int not null default 0,

  -- Vendor / influencer
  influencer_name text not null default '',
  profile_link text default '',

  -- Always-needed ad fields
  platform text default '',
  type_of_ad text default '',
  content text default '',
  product text default '',
  shooting_date date,
  posting_date date,
  ad_status text not null default 'Not started',   -- Not started | Scheduled | Shot | Posted | Cancelled
  ad_link text default '',

  -- Pricing (two columns: excl VAT, and incl 15% VAT)
  price_excl numeric(12,2) not null default 0,
  price_incl numeric(12,2) not null default 0,

  -- Situational — Store Visit
  is_event boolean not null default false,           -- gates the license-plate photo
  guest text default '',
  location text default '',
  visit_time text default '',
  license_plate_url text default '',                 -- required when is_event = true

  -- Situational — Home Ad
  contact_number text default '',

  notes text default '',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_tracking_rows_task on public.tracking_rows(task_id);

alter table public.tracking_rows enable row level security;

drop policy if exists "tracking_rows select" on public.tracking_rows;
drop policy if exists "tracking_rows write"  on public.tracking_rows;

-- Anyone with workspace access can read the sheet.
create policy "tracking_rows select" on public.tracking_rows for select
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );

-- Operational roles can add / edit / remove rows (data entry).
create policy "tracking_rows write" on public.tracking_rows for all
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  )
  with check (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','operations','marketing','sales','key_account','member'])
  );
