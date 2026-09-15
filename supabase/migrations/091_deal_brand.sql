-- 091_deal_brand.sql
--
-- A deal can name the brand the work is for.
--
-- Winning a deal hands it to the New Task form (lib/crm-sync.ts prefillFromDeal),
-- and that form's one remaining required field the deal could not fill was the
-- brand: marketing had to pick it again by hand on every won deal. A brand
-- belongs to a client (public.client_brands.client_id), and a deal already links
-- to a client (crm_deals.target_id when target_type = 'client'), so the brand the
-- deal is about is just one more thing sales can say up front.
--
-- ON DELETE SET NULL: retiring a brand must not delete the deal it appeared on -
-- the pipeline card outlives the brand record. Nullable: most deals have no brand
-- (vendor deals, early-stage deals, deals not yet tied to a client).
--
-- No RLS change: crm_deals already has its policies and this is one more column
-- under them. Idempotent: ADD COLUMN IF NOT EXISTS.

alter table public.crm_deals
  add column if not exists brand_id uuid references public.client_brands(id) on delete set null;