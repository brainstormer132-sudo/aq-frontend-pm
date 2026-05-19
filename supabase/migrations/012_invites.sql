-- ============================================================
-- 012_invites.sql
-- Per-user invite tokens for BOTH apps:
--   - pm_invites:        Supabase-auth users joining the PM workspace
--   - contract_invites:  legacy contract-app users (public.users table)
--
-- Both tables follow the same shape:
--   id, email, full_name, role, token (random, URL-safe),
--   created_by, created_at, expires_at, claimed_at, claimed_by_user_id
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── PM app invites (Supabase auth) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.pm_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email         text NOT NULL,
  full_name     text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner','admin','marketing','sales','key_account','member')),
  token         text NOT NULL UNIQUE,
  created_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  claimed_at    timestamptz,
  claimed_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Track whether we successfully emailed it (for audit / retries).
  email_sent_at timestamptz,
  email_error   text
);

CREATE INDEX IF NOT EXISTS pm_invites_workspace_idx ON public.pm_invites (workspace_id);
CREATE INDEX IF NOT EXISTS pm_invites_email_idx     ON public.pm_invites (lower(email));
CREATE INDEX IF NOT EXISTS pm_invites_token_idx     ON public.pm_invites (token);

ALTER TABLE public.pm_invites ENABLE ROW LEVEL SECURITY;

-- READ: anyone in the workspace can see invites (so the team list shows pending).
DROP POLICY IF EXISTS pm_invites_select ON public.pm_invites;
CREATE POLICY pm_invites_select ON public.pm_invites FOR SELECT
  TO authenticated USING (
    public.has_role(workspace_id, ARRAY['owner','admin','marketing','sales','key_account','member'])
  );

-- INSERT: only owner/admin can create invites.
DROP POLICY IF EXISTS pm_invites_insert ON public.pm_invites;
CREATE POLICY pm_invites_insert ON public.pm_invites FOR INSERT
  TO authenticated WITH CHECK (
    public.has_role(workspace_id, ARRAY['owner','admin'])
  );

-- UPDATE: owner/admin can rescind/reissue. The claim flow uses a SECURITY
-- DEFINER function below to mark the invite claimed, so members don't need
-- direct UPDATE access.
DROP POLICY IF EXISTS pm_invites_update ON public.pm_invites;
CREATE POLICY pm_invites_update ON public.pm_invites FOR UPDATE
  TO authenticated USING (
    public.has_role(workspace_id, ARRAY['owner','admin'])
  );

-- DELETE: owner/admin only.
DROP POLICY IF EXISTS pm_invites_delete ON public.pm_invites;
CREATE POLICY pm_invites_delete ON public.pm_invites FOR DELETE
  TO authenticated USING (
    public.has_role(workspace_id, ARRAY['owner','admin'])
  );

-- ── Public token lookup (no auth required to validate an invite) ──
-- The claim page needs to read an invite by token BEFORE the user is
-- authenticated. We expose a SECURITY DEFINER function rather than open
-- the table to anon.
CREATE OR REPLACE FUNCTION public.pm_invite_preview(p_token text)
RETURNS TABLE (
  email      text,
  full_name  text,
  role       text,
  expires_at timestamptz,
  claimed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email, full_name, role, expires_at, claimed_at
    FROM public.pm_invites
   WHERE token = p_token
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.pm_invite_preview(text) TO anon, authenticated;

-- ── Claim function: marks the invite claimed and inserts into
--    workspace_members. Run as the new authenticated user (auth.uid()).
CREATE OR REPLACE FUNCTION public.pm_invite_claim(p_token text)
RETURNS TABLE (workspace_id uuid, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite  public.pm_invites%ROWTYPE;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_invite
    FROM public.pm_invites
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_invite.claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite already claimed';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  -- Insert workspace membership (no-op if it already exists).
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
       VALUES (v_invite.workspace_id, v_user_id, v_invite.role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Mark claimed.
  UPDATE public.pm_invites
     SET claimed_at = now(),
         claimed_by = v_user_id
   WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.workspace_id, v_invite.role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pm_invite_claim(text) TO authenticated;


-- ── Contract-app invites (legacy public.users table) ────────
-- The contract maker uses its own custom-JWT auth against public.users.
-- These invites carry an email + role + token; backend's /api/auth/signup
-- consumes the token and creates a row in public.users.
CREATE TABLE IF NOT EXISTS public.contract_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  full_name     text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'member'
                CHECK (role IN ('admin','member')),
  token         text NOT NULL UNIQUE,
  created_by    text,    -- contract-app username (not a Supabase uuid)
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  claimed_at    timestamptz,
  claimed_by    text,    -- contract-app username when claimed
  email_sent_at timestamptz,
  email_error   text
);

CREATE INDEX IF NOT EXISTS contract_invites_token_idx ON public.contract_invites (token);
CREATE INDEX IF NOT EXISTS contract_invites_email_idx ON public.contract_invites (lower(email));

-- RLS off for now: the contract backend uses service-role key for everything,
-- and the PM app doesn't read this table.
ALTER TABLE public.contract_invites DISABLE ROW LEVEL SECURITY;


-- ── Verification ────────────────────────────────────────────
SELECT 'pm_invites'       AS table, count(*) AS rows FROM public.pm_invites
UNION ALL
SELECT 'contract_invites' AS table, count(*) AS rows FROM public.contract_invites;
-- Expect both 0 (newly created, empty).
