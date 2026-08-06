-- ============================================================
-- 041_notify_contract_request.sql
-- Phase 6 — tell Ops/admin when a contract request is raised.
--
-- Until now a contract_requests row appeared silently in the
-- Contracts view and nobody was told. This notifies every
-- owner / admin / operations member of the workspace on INSERT,
-- for BOTH client and vendor requests (the user's call).
--
-- Heads-up on volume: vendor requests auto-fire from
-- autoCreateContractRequestForSubtask whenever a subtask gets a
-- vendor AND a positive budget. A Package Ad sold as 20 ads will
-- therefore produce 20 vendor notifications as the ads are filled
-- in. If that turns out to be too noisy, narrow it to client
-- requests by adding to the guard below:
--
--     and new.request_kind = 'client'
--
-- Reuses the 'task_assigned' notification type so the enum on
-- public.notifications doesn't have to change — same trick as 038.
--
-- The link format matches what page.tsx now reads (Phase 2.5), so
-- these are clickable rather than dead ends.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
--
-- To disable:
--   drop trigger if exists trg_notify_on_contract_request on public.contract_requests;
-- ============================================================

create or replace function public.notify_on_contract_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label   text;
  v_subject text;
begin
  -- Workspace-less or task-less rows have nobody to notify and nowhere
  -- to point at, so skip them rather than writing a broken link.
  if new.workspace_id is null or new.pm_task_id is null then
    return new;
  end if;

  v_label := case
    when new.request_kind = 'client' then 'Client contract requested'
    when new.request_kind = 'vendor' then 'Vendor contract requested'
    else 'Contract requested'
  end;

  -- Most useful one-liner we can build from the row itself.
  v_subject := coalesce(
    nullif(concat_ws(' · ',
      nullif(new.brand_name, ''),
      nullif(coalesce(new.client_name, new.vendor_name), ''),
      case when new.amount is not null then 'SAR ' || trim(to_char(new.amount, 'FM999999999990.00')) end
    ), ''),
    'Open the campaign for details'
  );

  insert into public.notifications (user_id, type, title, body, link)
  select wm.user_id,
         'task_assigned',
         v_label,
         v_subject,
         '/dashboard/workflow?task=' || new.pm_task_id::text
    from public.workspace_members wm
   where wm.workspace_id = new.workspace_id
     and wm.role in ('owner', 'admin', 'operations')
     -- Don't ping the person who just raised it.
     and wm.user_id is distinct from new.requested_by;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_contract_request on public.contract_requests;
create trigger trg_notify_on_contract_request
  after insert on public.contract_requests
  for each row
  execute function public.notify_on_contract_request();
