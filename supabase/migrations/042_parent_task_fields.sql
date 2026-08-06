-- ============================================================
-- 042_parent_task_fields.sql
-- Parent task redesign, step 1 of 5 — schema only.
--
-- Brings the parent campaign in line with how the work is actually
-- run in Asana: platform(s), ad type, approval stage, repeatable
-- quotation / invoice numbers, net payment date, and a client
-- category that follows the client instead of being retyped.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
--
-- Pairs with the use-workflow.ts change that starts writing
-- status='pending' instead of 'todo'. Run this and deploy that
-- together; see section 6.
-- ============================================================

-- ─── 1. New parent columns ───────────────────────────────────────

alter table public.pm_tasks
  -- A campaign can run on several platforms at once.
  add column if not exists platforms          text[] not null default '{}',
  -- Required free text when ad_type is 'Multi Service'; the standard
  -- types (Home Ad / Store Visit) ignore it. Mirrors the contract app's
  -- subtasks.ad_type_custom from migration 031.
  add column if not exists ad_type_custom     text,
  add column if not exists approval_stage     text,
  -- Repeatable text boxes. Always at least one of each in the UI.
  -- Arrays rather than child tables: these carry no amount, date or
  -- file of their own — payment lives on the parent already.
  add column if not exists quotation_numbers  text[] not null default '{}',
  add column if not exists invoice_numbers    text[] not null default '{}',
  add column if not exists net_payment_date   date;

-- The client's category belongs to the CLIENT. pm_tasks.client_category_id
-- stays as the per-campaign value, but it now has a source to auto-fill from
-- instead of being picked by hand every time.
alter table public.clients
  add column if not exists client_category_id uuid
    references public.client_categories(id) on delete set null;

-- Approval stage is new, so nothing can violate this. NOT VALID anyway,
-- to keep the pattern consistent with 040.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pm_tasks_approval_stage_ck') then
    alter table public.pm_tasks
      add constraint pm_tasks_approval_stage_ck
      check (approval_stage is null or approval_stage in
        ('ready_for_review','changes_needed','approved','hold','cancelled'))
      not valid;
  end if;
end $$;

-- Searching by quotation or invoice number is the whole point of storing
-- them; without these, `= any(quotation_numbers)` is a sequential scan.
create index if not exists pm_tasks_quotation_numbers_idx on public.pm_tasks using gin (quotation_numbers);
create index if not exists pm_tasks_invoice_numbers_idx   on public.pm_tasks using gin (invoice_numbers);
create index if not exists pm_tasks_platforms_idx         on public.pm_tasks using gin (platforms);

-- ─── 2. Platform lookup ──────────────────────────────────────────
-- Same shape, RLS and admin-editable pattern as task_sources (028).

create table if not exists public.task_platforms (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz default now(),
  unique (workspace_id, name)
);
create index if not exists idx_task_platforms_ws on public.task_platforms(workspace_id);

alter table public.task_platforms enable row level security;

drop policy if exists "task_platforms_member_read" on public.task_platforms;
create policy "task_platforms_member_read" on public.task_platforms
  for select using (
    public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account','operations','member'])
  );
drop policy if exists "task_platforms_admin_write" on public.task_platforms;
create policy "task_platforms_admin_write" on public.task_platforms
  for all using (
    public.has_role(workspace_id, array['owner','admin'])
  ) with check (
    public.has_role(workspace_id, array['owner','admin'])
  );

-- Bug fix while we're here: 028 left 'operations' out of the read policies
-- for both existing lookups, so an Ops user saw "—" for Source and Client
-- Category on a campaign they were asked to work on. Read-only widening.
drop policy if exists "task_sources_member_read" on public.task_sources;
create policy "task_sources_member_read" on public.task_sources
  for select using (
    public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account','operations','member'])
  );
drop policy if exists "client_categories_member_read" on public.client_categories;
create policy "client_categories_member_read" on public.client_categories
  for select using (
    public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account','operations','member'])
  );

-- ─── 3. Seeds, per workspace, never duplicating ──────────────────

insert into public.task_sources (workspace_id, name, position)
select w.id, s.name, s.position
  from public.workspaces w
  cross join (values ('AQ', 1), ('Outsourced', 2), ('Influencer', 3)) as s(name, position)
 where not exists (
   select 1 from public.task_sources t
    where t.workspace_id = w.id and lower(t.name) = lower(s.name)
 );

insert into public.task_platforms (workspace_id, name, position)
select w.id, p.name, p.position
  from public.workspaces w
  cross join (values
    ('Instagram', 1), ('Snapchat', 2), ('TikTok', 3), ('X (Twitter)', 4),
    ('YouTube', 5), ('Google', 6), ('Billboard', 7), ('Website', 8),
    ('Print', 9), ('Radio', 10), ('Event', 11), ('Other', 12)
  ) as p(name, position)
 where not exists (
   select 1 from public.task_platforms t
    where t.workspace_id = w.id and lower(t.name) = lower(p.name)
 );

-- ─── 4. Fold the single number columns into the arrays ───────────
-- quotation_no / invoice_no are left in place, untouched, so nothing
-- reading them breaks. They stop being written once the new UI ships.

update public.pm_tasks
   set quotation_numbers = array[trim(quotation_no)]
 where quotation_no is not null
   and trim(quotation_no) <> ''
   and coalesce(array_length(quotation_numbers, 1), 0) = 0;

update public.pm_tasks
   set invoice_numbers = array[trim(invoice_no)]
 where invoice_no is not null
   and trim(invoice_no) <> ''
   and coalesce(array_length(invoice_numbers, 1), 0) = 0;

-- ─── 5. Normalise contract_status ────────────────────────────────
-- Free text today ("Pending", "On Process", "No Contract", "Signed").
-- Canonical set: no_contract | po | pending | on_process | done | signed_attached
-- Deliberately NO check constraint: the contract app may write this column
-- and a constraint here could break a flow outside this repo.

update public.pm_tasks
   set contract_status = case lower(trim(contract_status))
     when 'no contract'          then 'no_contract'
     when 'no_contract'          then 'no_contract'
     when 'po'                   then 'po'
     when 'purchase order'       then 'po'
     when 'pending'              then 'pending'
     when 'on process'           then 'on_process'
     when 'on_process'           then 'on_process'
     when 'in process'           then 'on_process'
     when 'done'                 then 'done'
     when 'signed'               then 'signed_attached'
     when 'signed and attached'  then 'signed_attached'
     when 'signed_attached'      then 'signed_attached'
     else contract_status
   end
 where contract_status is not null and trim(contract_status) <> '';

-- ─── 6. Task status vocabulary ───────────────────────────────────
-- todo → pending. New set: pending | on_hold | done | cancelled.
--
-- Safe to run before the app deploys: nothing in the codebase filters ON
-- 'todo' (only `= 'done'` and `<> 'done'`), so the worst case in the gap
-- is that newly created tasks read 'todo' until the new build is live.
--
-- NO check constraint yet, deliberately: use-workflow.ts still inserts
-- 'todo' until the paired deploy lands, and a constraint would break task
-- creation outright. Add it in a later migration once that's shipped.

update public.pm_tasks set status = 'pending' where status = 'todo';

alter table public.pm_tasks alter column status set default 'pending';

-- ─── 7. Field ownership — the new columns are marketing's ────────
-- Restates enforce_task_field_ownership() from 039/040 with the Package Ad
-- columns AND the new parent fields. Supersedes both. Safe standalone.

create or replace function public.enforce_task_field_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_touched_sales     boolean;
  v_touched_marketing boolean;
begin
  if new.parent_task_id is not null then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  select wm.role into v_role
    from public.workspace_members wm
   where wm.workspace_id = new.workspace_id
     and wm.user_id = auth.uid();

  if v_role is null then
    return new;
  end if;

  if v_role in ('owner', 'admin') then
    return new;
  end if;

  if v_role not in ('sales', 'marketing', 'key_account') then
    return new;
  end if;

  v_touched_sales :=
       (new.task_name        is distinct from old.task_name)
    or (new.title            is distinct from old.title)
    or (new.client_id        is distinct from old.client_id)
    or (new.legacy_client_id is distinct from old.legacy_client_id)
    or (new.brand_id         is distinct from old.brand_id)
    or (new.brand_name       is distinct from old.brand_name)
    or (new.sales_closer_id  is distinct from old.sales_closer_id)
    or (new.description      is distinct from old.description);

  v_touched_marketing :=
       (new.priority               is distinct from old.priority)
    or (new.service_type_id        is distinct from old.service_type_id)
    or (new.key_account_id         is distinct from old.key_account_id)
    or (new.stage                  is distinct from old.stage)
    or (new.status                 is distinct from old.status)
    or (new.completed_at           is distinct from old.completed_at)
    or (new.due_date               is distinct from old.due_date)
    or (new.assignee_id            is distinct from old.assignee_id)
    or (new.has_tracking           is distinct from old.has_tracking)
    or (new.source_id              is distinct from old.source_id)
    or (new.client_category_id     is distinct from old.client_category_id)
    or (new.quotation_no           is distinct from old.quotation_no)
    or (new.quotation_breakdown    is distinct from old.quotation_breakdown)
    or (new.invoice_no             is distinct from old.invoice_no)
    or (new.client_payment_status  is distinct from old.client_payment_status)
    or (new.client_payment_date    is distinct from old.client_payment_date)
    or (new.client_payment_amount  is distinct from old.client_payment_amount)
    or (new.contract_status        is distinct from old.contract_status)
    -- Package Ad (040)
    or (new.package_start_date     is distinct from old.package_start_date)
    or (new.package_end_date       is distinct from old.package_end_date)
    or (new.ad_quantity            is distinct from old.ad_quantity)
    -- Parent task redesign (this migration)
    or (new.platforms              is distinct from old.platforms)
    or (new.ad_type                is distinct from old.ad_type)
    or (new.ad_type_custom         is distinct from old.ad_type_custom)
    or (new.approval_stage         is distinct from old.approval_stage)
    or (new.quotation_numbers      is distinct from old.quotation_numbers)
    or (new.invoice_numbers        is distinct from old.invoice_numbers)
    or (new.net_payment_date       is distinct from old.net_payment_date);

  if v_role = 'sales' then
    if new.creator_id is distinct from auth.uid() then
      if v_touched_sales or v_touched_marketing then
        raise exception
          'Sales can only edit campaigns they created. Ask an admin to make this change.'
          using errcode = '42501';
      end if;
    elsif v_touched_marketing then
      raise exception
        'That field belongs to marketing. Sales owns the task name, client, brand, sales closer, description and budget.'
        using errcode = '42501';
    end if;

  else  -- marketing / key_account
    if v_touched_sales then
      raise exception
        'That field belongs to sales. Marketing owns everything on the campaign except the task name, client, brand, sales closer and description.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_task_field_ownership on public.pm_tasks;
create trigger trg_enforce_task_field_ownership
  before update on public.pm_tasks
  for each row
  execute function public.enforce_task_field_ownership();
