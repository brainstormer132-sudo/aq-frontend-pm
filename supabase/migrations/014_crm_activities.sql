-- ============================================================
-- 014_crm_activities.sql
-- CRM activity log — one row per "thing that happened" with a
-- client or vendor: a note, a call, a meeting, an email, or a
-- status change. Works as the foundation for the wider CRM:
-- last-contacted timestamps, dormant-account queries,
-- follow-up reminders all derive from this table.
--
-- Run in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Which entity this activity is about. We use a discriminator + free-text
  -- id so we can attach activities to either `clients` (uuid id) or `vendors`
  -- (bigint id) without two columns. The id is stored as text to bridge the
  -- type difference; queries cast as needed.
  target_type   text NOT NULL CHECK (target_type IN ('client', 'vendor')),
  target_id     text NOT NULL,
  -- Kind of activity, kept narrow so we can filter / icon them.
  kind          text NOT NULL DEFAULT 'note'
                CHECK (kind IN ('note', 'call', 'meeting', 'email', 'status_change')),
  body          text NOT NULL DEFAULT '',
  -- Who logged it.
  author_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name   text NOT NULL DEFAULT '',
  -- When the activity HAPPENED (may differ from created_at — e.g. logging
  -- a call after the fact). UI defaults to now().
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_activities_target_idx
  ON public.crm_activities (workspace_id, target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_workspace_recent_idx
  ON public.crm_activities (workspace_id, occurred_at DESC);

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

-- READ + INSERT for any workspace member. UPDATE/DELETE limited to the
-- author or a privileged role. Mirrors the pattern used by `comments`.
DROP POLICY IF EXISTS crm_activities_select ON public.crm_activities;
CREATE POLICY crm_activities_select ON public.crm_activities FOR SELECT
  TO authenticated USING (
    public.has_role(workspace_id,
      ARRAY['owner','admin','marketing','sales','key_account','member'])
  );

DROP POLICY IF EXISTS crm_activities_insert ON public.crm_activities;
CREATE POLICY crm_activities_insert ON public.crm_activities FOR INSERT
  TO authenticated WITH CHECK (
    public.has_role(workspace_id,
      ARRAY['owner','admin','marketing','sales','key_account','member'])
  );

DROP POLICY IF EXISTS crm_activities_update ON public.crm_activities;
CREATE POLICY crm_activities_update ON public.crm_activities FOR UPDATE
  TO authenticated USING (
    author_id = auth.uid()
    OR public.has_role(workspace_id, ARRAY['owner','admin','marketing'])
  );

DROP POLICY IF EXISTS crm_activities_delete ON public.crm_activities;
CREATE POLICY crm_activities_delete ON public.crm_activities FOR DELETE
  TO authenticated USING (
    author_id = auth.uid()
    OR public.has_role(workspace_id, ARRAY['owner','admin','marketing'])
  );

-- Verification
SELECT count(*) AS crm_activities_rows FROM public.crm_activities;
-- Expect 0 on a fresh install.
