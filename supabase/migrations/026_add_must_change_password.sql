-- Migration 026: Add must_change_password to external_users
-- Run this in Supabase SQL Editor.
-- When an admin creates a portal account with a password, this flag is
-- set to true. The portal frontend should redirect to /change-password
-- until the user picks their own password.

ALTER TABLE public.external_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Verification:
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name   = 'external_users'
   AND column_name  = 'must_change_password';
