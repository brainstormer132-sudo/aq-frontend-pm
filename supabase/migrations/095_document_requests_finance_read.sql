-- 095_document_requests_finance_read.sql
--
-- Let the finance role SEE quotation / invoice requests.
--
-- The `finance` role was added in 085, AFTER the document_requests read policy
-- (baseline). That policy lists owner/admin/marketing/sales/key_account/
-- operations/member but NOT finance, so a finance user's SELECT on
-- document_requests returned zero rows - the Finance menu's Requests strip came
-- back empty for exactly the people it is for. This widens the read policy to
-- include finance. Read only; finance does not create or cancel requests.
--
-- Idempotent + atomic: ALTER the existing policy's USING in place (no drop, so
-- there is no window where nobody can read), or CREATE it if somehow absent.

do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'document_requests'
       and policyname = 'document_requests_staff_read'
  ) then
    alter policy document_requests_staff_read on public.document_requests
      using (public.has_role(workspace_id,
        array['owner','admin','marketing','sales','key_account','operations','member','finance']));
  else
    create policy document_requests_staff_read on public.document_requests
      for select using (public.has_role(workspace_id,
        array['owner','admin','marketing','sales','key_account','operations','member','finance']));
  end if;
end $$;

notify pgrst, 'reload schema';
