-- 090_task_from_deal.sql
--
-- Link a campaign back to the CRM deal it was won from.
--
-- Winning a deal hands it to the New Task form (lib/crm-sync.ts prefillFromDeal).
-- Until now the created campaign kept no trace of the deal, so nobody could see
-- that a deal became a campaign, and the same deal could be dragged to Won twice
-- and spawn two campaigns for one sale. `pm_tasks.deal_id` closes both: it is the
-- one link, and the handoff can refuse a deal that already has a campaign.
--
-- ON DELETE SET NULL: deleting a deal must not delete the real campaign that came
-- out of it - the campaign outlives the pipeline card. Nullable: the vast
-- majority of campaigns are not from a deal.
--
-- No RLS change: pm_tasks already has its policies and this is one more column
-- under them. Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

alter table public.pm_tasks
  add column if not exists deal_id uuid references public.crm_deals(id) on delete set null;

-- Find "is this deal already a campaign?" without scanning: the handoff checks
-- it on every Won, and it is a partial index so it costs nothing on the millions
-- of campaigns that have no deal.
create index if not exists pm_tasks_deal_id_idx
  on public.pm_tasks (deal_id)
  where deal_id is not null;