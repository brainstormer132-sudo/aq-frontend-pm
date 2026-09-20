-- ============================================================
-- 106_contract_source.sql
-- Where a contract came from.
--
-- The live contract app never asks anyone to type the sixteen fields of the
-- UGC agreement: contract-preview.js derives every one from the vendor, their
-- bank, the campaign and the booking. legal.contract has no link to any of
-- them, so a contract ported into the legal system would be sixteen fields to
-- retype, IBAN included - slower than the flow it replaces.
--
-- These four columns are that link. They are the SOURCE of a contract, not a
-- dependency of it: an issued contract is a document in its own right and must
-- survive its campaign being deleted, so every one is ON DELETE SET NULL. A
-- cascade here would do to contracts what finance_documents.pm_task_id already
-- does to invoices (audit 2026-09-20, item B15) - take the record away with
-- the row it was raised from.
--
-- Nothing is required: a contract raised from the Register with no booking
-- behind it stays perfectly valid, with all four null.
--
-- Idempotent. Run in staging, then prod. Then: notify pgrst.
-- ============================================================

alter table legal.contract
  add column if not exists pm_task_id      uuid   references public.pm_tasks(id)      on delete set null,
  add column if not exists subtask_id      uuid   references public.pm_tasks(id)      on delete set null,
  add column if not exists vendor_id       bigint references public.vendors(id)       on delete set null,
  add column if not exists bank_account_id bigint references public.bank_accounts(id) on delete set null;

comment on column legal.contract.pm_task_id is
  'The campaign this contract was raised from. SET NULL on delete: the contract outlives it.';
comment on column legal.contract.subtask_id is
  'The booking (vendor subtask) this contract covers.';

-- "Which contracts exist for this booking?" is the question the campaign page
-- asks on every render, so it gets an index; the others are for the registry.
create index if not exists idx_legal_contract_subtask on legal.contract(subtask_id);
create index if not exists idx_legal_contract_pm_task on legal.contract(pm_task_id);
create index if not exists idx_legal_contract_vendor  on legal.contract(vendor_id);
