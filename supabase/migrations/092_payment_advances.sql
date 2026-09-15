-- 092_payment_advances.sql
--
-- Advance payments: money that moves before a campaign completes.
--
-- The ledgers (Collection / Liability) hold completed campaigns only - "only
-- completed campaigns are money owed". An advance is the exception: a client
-- pays part up front, or we pay a vendor a deposit, before the campaign is
-- done. Finance wants that recorded and shown in its own Advanced section
-- (lib/finance.ts payment sections), separate from the final settlement, so
-- the completed-only totals stay clean.
--
-- These are recorded DISTINCTLY from client_payment_amount / vendor_payment_amount
-- (which are the eventual settlement) - an advance has its own amount and date.
-- Nullable, no default: the vast majority of campaigns have no advance.
--
-- No RLS change: pm_tasks already has its policies and these are four more
-- columns under them. Idempotent: ADD COLUMN IF NOT EXISTS.

alter table public.pm_tasks
  add column if not exists client_advance_amount numeric(14,2);
alter table public.pm_tasks
  add column if not exists client_advance_date date;
alter table public.pm_tasks
  add column if not exists vendor_advance_amount numeric(14,2);
alter table public.pm_tasks
  add column if not exists vendor_advance_date date;