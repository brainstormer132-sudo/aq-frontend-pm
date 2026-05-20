-- ============================================================
-- 025_crm_deals_tasks.sql
-- CRM phase 1: sales pipeline (deals) + follow-up tasks.
--
-- crm_deals  → one row per opportunity. Has a stage, a value, an
--              optional close date, an owner, and an optional link
--              to the contact (client/vendor) it belongs to.
-- crm_tasks  → "next action" items. Can be linked to a contact, a
--              deal, or stand alone. Has a due date and assignee so
--              they can show up in the user's Inbox.
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ─── Deals ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_deals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Optional contact link (same discriminator pattern as crm_activities).
  target_type           text CHECK (target_type IN ('client','vendor')),
  target_id             text,
  -- Deal essentials.
  name                  text NOT NULL,
  value                 numeric NOT NULL DEFAULT 0,
  currency_code         text NOT NULL DEFAULT 'SAR',
  stage                 text NOT NULL DEFAULT 'prospect'
                        CHECK (stage IN (
                          'prospect','qualified','proposal',
                          'negotiation','won','lost'
                        )),
  probability           int CHECK (probability BETWEEN 0 AND 100),
  expected_close_date   date,
  -- Ownership + book-keeping.
  owner_id              uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_name            text NOT NULL DEFAULT '',
  notes                 text NOT NULL DEFAULT '',
  -- Time the stage last changed — drives "stuck deals" reporting.
  stage_changed_at      timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_deals_workspace_idx
  ON public.crm_deals (workspace_id, stage, expected_close_date);
CREATE INDEX IF NOT EXISTS crm_deals_target_idx
  ON public.crm_deals (workspace_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS crm_deals_owner_idx
  ON public.crm_deals (workspace_id, owner_id);

-- ─── Tasks / follow-ups ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_tasks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Optional linkages — any combination, or none (a standalone reminder).
  target_type           text CHECK (target_type IN ('client','vendor')),
  target_id             text,
  deal_id               uuid REFERENCES public.crm_deals(id) ON DELETE CASCADE,
  -- The thing to do.
  title                 text NOT NULL,
  description           text NOT NULL DEFAULT '',
  due_at                timestamptz,
  -- Assignment + completion.
  assigned_to_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to_name      text NOT NULL DEFAULT '',
  completed_at          timestamptz,
  completed_by_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Audit.
  created_by_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name       text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_tasks_assignee_due_idx
  ON public.crm_tasks (workspace_id, assigned_to_id, completed_at, due_at);
CREATE INDEX IF NOT EXISTS crm_tasks_target_idx
  ON public.crm_tasks (workspace_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS crm_tasks_deal_idx
  ON public.crm_tasks (workspace_id, deal_id);

-- ─── RLS for crm_deals ─────────────────────────────────────────────
ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_deals_select ON public.crm_deals;
CREATE POLICY crm_deals_select ON public.crm_deals FOR SELECT
  TO authenticated USING (
    public.has_role(workspace_id,
      ARRAY['owner','admin','marketing','sales','key_account','member'])
  );

DROP POLICY IF EXISTS crm_deals_insert ON public.crm_deals;
CREATE POLICY crm_deals_insert ON public.crm_deals FOR INSERT
  TO authenticated WITH CHECK (
    public.has_role(workspace_id,
      ARRAY['owner','admin','marketing','sales','key_account'])
  );

DROP POLICY IF EXISTS crm_deals_update ON public.crm_deals;
CREATE POLICY crm_deals_update ON public.crm_deals FOR UPDATE
  TO authenticated USING (
    owner_id = auth.uid()
    OR public.has_role(workspace_id, ARRAY['owner','admin','marketing','sales'])
  );

DROP POLICY IF EXISTS crm_deals_delete ON public.crm_deals;
CREATE POLICY crm_deals_delete ON public.crm_deals FOR DELETE
  TO authenticated USING (
    public.has_role(workspace_id, ARRAY['owner','admin'])
  );

-- ─── RLS for crm_tasks ─────────────────────────────────────────────
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_tasks_select ON public.crm_tasks;
CREATE POLICY crm_tasks_select ON public.crm_tasks FOR SELECT
  TO authenticated USING (
    public.has_role(workspace_id,
      ARRAY['owner','admin','marketing','sales','key_account','member'])
  );

DROP POLICY IF EXISTS crm_tasks_insert ON public.crm_tasks;
CREATE POLICY crm_tasks_insert ON public.crm_tasks FOR INSERT
  TO authenticated WITH CHECK (
    public.has_role(workspace_id,
      ARRAY['owner','admin','marketing','sales','key_account','member'])
  );

DROP POLICY IF EXISTS crm_tasks_update ON public.crm_tasks;
CREATE POLICY crm_tasks_update ON public.crm_tasks FOR UPDATE
  TO authenticated USING (
    assigned_to_id = auth.uid()
    OR created_by_id = auth.uid()
    OR public.has_role(workspace_id, ARRAY['owner','admin','marketing','sales'])
  );

DROP POLICY IF EXISTS crm_tasks_delete ON public.crm_tasks;
CREATE POLICY crm_tasks_delete ON public.crm_tasks FOR DELETE
  TO authenticated USING (
    created_by_id = auth.uid()
    OR public.has_role(workspace_id, ARRAY['owner','admin'])
  );

-- ─── Auto-update stage_changed_at when stage moves ─────────────────
CREATE OR REPLACE FUNCTION public.crm_deals_stage_change() RETURNS trigger AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
    IF NEW.stage IN ('won','lost') AND OLD.stage NOT IN ('won','lost') THEN
      NEW.closed_at := now();
    END IF;
    IF NEW.stage NOT IN ('won','lost') AND OLD.stage IN ('won','lost') THEN
      NEW.closed_at := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS crm_deals_stage_change_trigger ON public.crm_deals;
CREATE TRIGGER crm_deals_stage_change_trigger
  BEFORE UPDATE ON public.crm_deals
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_deals_stage_change();

-- ─── Verification ──────────────────────────────────────────────────
SELECT count(*) AS crm_deals_rows FROM public.crm_deals;
SELECT count(*) AS crm_tasks_rows FROM public.crm_tasks;
-- Expect 0 each on fresh install.
