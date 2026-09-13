-- 085_finance_role.sql
--
-- Adds a 'finance' workspace role so the finance team can be invited and given
-- a finance-scoped menu (quotations, invoices, liability). This ONLY widens the
-- allowed set on the two role CHECK constraints -- every existing row already
-- holds one of the old values, so nothing needs migrating and nothing breaks.
--
-- Roles after this: owner, admin, operations, sales, marketing, key_account,
-- finance, member.
--
-- 'finance' gets no RLS permissions here. Existing policies gate on explicit
-- has_role(...) arrays, so a finance member can do only what those arrays already
-- allow (i.e. nothing extra) until later migrations add finance where intended.
--
-- Idempotent: drop-if-exists then add, so a second run is a no-op.

do $$
begin
  alter table public.workspace_members drop constraint if exists workspace_members_role_check;
  alter table public.workspace_members
    add constraint workspace_members_role_check
    check (role = any (array[
      'owner','admin','operations','sales','marketing','key_account','finance','member'
    ]));

  alter table public.workspace_invites drop constraint if exists workspace_invites_role_check;
  alter table public.workspace_invites
    add constraint workspace_invites_role_check
    check (role = any (array[
      'owner','admin','operations','sales','marketing','key_account','finance','member'
    ]));
end $$;