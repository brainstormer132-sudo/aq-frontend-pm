-- 093_record_advance.sql
--
-- Let finance record an advance from the Finance screen.
--
-- The pm_tasks UPDATE policy does not include the finance role (finance reads
-- campaigns but does not edit them), so a finance user cannot write the advance
-- columns directly. Rather than widen pm_tasks writes to finance for every
-- field, this is a narrow SECURITY DEFINER function that only ever touches the
-- four advance columns (092) and only for owner / admin / finance. It runs as
-- the table owner, so it is not blocked by the RLS gap; the role check inside
-- is the real gate.
--
-- Idempotent: CREATE OR REPLACE. Re-runnable.

create or replace function public.record_advance(
  p_task_id uuid,
  p_side text,          -- 'client' or 'vendor'
  p_amount numeric,     -- null clears the advance
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  -- The campaign (parent) this advance is for, and its workspace.
  select workspace_id into v_ws
    from public.pm_tasks
   where id = p_task_id and deleted_at is null and parent_task_id is null;
  if v_ws is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;

  -- Only owner / admin / finance may record an advance.
  if not public.has_role(v_ws, array['owner','admin','finance']) then
    raise exception 'not allowed to record an advance' using errcode = '42501';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'advance cannot be negative';
  end if;

  if p_side = 'client' then
    update public.pm_tasks
       set client_advance_amount = p_amount, client_advance_date = p_date
     where id = p_task_id;
  elsif p_side = 'vendor' then
    update public.pm_tasks
       set vendor_advance_amount = p_amount, vendor_advance_date = p_date
     where id = p_task_id;
  else
    raise exception 'side must be client or vendor';
  end if;
end;
$$;

revoke all on function public.record_advance(uuid, text, numeric, date) from public;
grant execute on function public.record_advance(uuid, text, numeric, date) to authenticated;
