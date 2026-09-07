-- ============================================================
-- 040_package_ad.sql
-- Phase 5 — Package Ad: a run window and a sold quantity on the
-- parent campaign.
--
--   package_start_date / package_end_date  the window the whole
--     package runs for. Per-AD dates deliberately stay on
--     tracking_rows (shooting_date / posting_date) — this is the
--     package-level window, not a second per-ad scheduler.
--   ad_quantity  how many ads the package was sold as. The app tops
--     the campaign up to this many 'ad' subtasks; it never deletes,
--     because an existing ad may already carry a vendor, a budget and
--     a fired contract request.
--
-- These are MARKETING-half columns, so this migration also replaces
-- enforce_task_field_ownership() from 039 to police them. That
-- function is restated here in full and the trigger re-created, so
-- this file is safe to run whether or not 039 ran first.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

alter table public.pm_tasks
  add column if not exists package_start_date date,
  add column if not exists package_end_date   date,
  add column if not exists ad_quantity        integer;

-- Sanity: a package can't run backwards, and can't be sold as a
-- negative number of ads. NOT VALID so existing rows are never blocked.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_package_window_ck'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_package_window_ck
      check (
        package_start_date is null
        or package_end_date is null
        or package_end_date >= package_start_date
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_ad_quantity_ck'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_ad_quantity_ck
      check (ad_quantity is null or ad_quantity >= 0) not valid;
  end if;
end $$;

-- Index the ad-subtask lookup the top-up does on every save.
create index if not exists pm_tasks_parent_kind_idx
  on public.pm_tasks (parent_task_id, subtask_kind);

-- ── Field-ownership trigger, restated with the Package Ad columns ──
-- (supersedes the version in 039 — see that file for the full rationale)

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
    -- Package Ad (this migration)
    or (new.package_start_date     is distinct from old.package_start_date)
    or (new.package_end_date       is distinct from old.package_end_date)
    or (new.ad_quantity            is distinct from old.ad_quantity);

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
