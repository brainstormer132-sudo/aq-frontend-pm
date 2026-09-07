-- ============================================================
-- 039_task_field_ownership.sql
-- Phase 4 — parent-as-source-of-truth: split the parent campaign
-- between sales and marketing, and enforce it in the database.
--
--   SALES half     task_name, title, client_id, legacy_client_id,
--                  brand_id, brand_name, sales_closer_id, description
--   MARKETING half priority, service_type_id, key_account_id, stage,
--                  status, completed_at, due_date, assignee_id,
--                  has_tracking, source_id, client_category_id,
--                  quotation_no, quotation_breakdown, invoice_no,
--                  client_payment_status/date/amount, contract_status
--   SHARED         budget — sales opens the number, both halves may
--                  revise it. Deliberately in NEITHER list below.
--
-- Postgres RLS is row-level, so a per-column rule needs a trigger.
-- This one only ever REJECTS; it never rewrites data.
--
-- Mirrored in the UI by canEditSales / canEditMarketing in
-- components/workflow/TaskDetailPanel.tsx. Change one, change the other.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
--
-- To disable in a hurry (nothing else depends on it):
--   drop trigger if exists trg_enforce_task_field_ownership on public.pm_tasks;
-- ============================================================

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
  -- The split is a PARENT-campaign concept. Subtasks are marketing's
  -- throughout, and the Phase 1 request flow writes to them as Ops.
  if new.parent_task_id is not null then
    return new;
  end if;

  -- No end-user session (service role, SQL editor, other triggers,
  -- backfills) → not our business.
  if auth.uid() is null then
    return new;
  end if;

  select wm.role into v_role
    from public.workspace_members wm
   where wm.workspace_id = new.workspace_id
     and wm.user_id = auth.uid();

  -- Unknown membership: leave it to RLS, which already decides whether
  -- this user may touch the row at all.
  if v_role is null then
    return new;
  end if;

  -- Owners and admins are exempt by design — they are the escape hatch
  -- when the split gets in the way of something real.
  if v_role in ('owner', 'admin') then
    return new;
  end if;

  -- Only the two halves are policed. Any other role (operations, member)
  -- is governed by RLS alone, exactly as before this migration.
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
    or (new.contract_status        is distinct from old.contract_status);

  if v_role = 'sales' then
    -- Sales may only revise their own half (plus the shared budget), and
    -- only on a campaign they raised.
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
