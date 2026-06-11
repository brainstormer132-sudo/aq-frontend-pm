-- ============================================================
-- 031 — Subtasks: ad_type_custom override field
--
-- When the user picks "Multi Service" as a subtask ad_type, they
-- can now type a custom label that replaces the standard Arabic
-- "خدمة متعددة" in the generated contract.
--
-- The override only kicks in when ad_type normalizes to
-- "multi service". For "Store Visit" / "Home Ad" / anything else
-- this column is ignored — those still use the AD_TYPE_MAP
-- translations.
-- ============================================================

alter table public.subtasks
  add column if not exists ad_type_custom text default '';

-- No index needed: this column is read alongside the subtask row,
-- never queried on its own.
