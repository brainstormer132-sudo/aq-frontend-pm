-- ============================================================
-- 032 — Vendor files: slot column
--
-- The Design C upload modal organizes files by "slot" — the named
-- destination they belong to:
--
--   'license'              → identifier doc for Influencer + UGC
--   'id'                   → identifier doc for the other 9 categories
--   'bank:<bank_id>'       → confirmation doc tied to a specific
--                            bank_accounts row (multi-bank ready)
--   'headshot'             → optional, Model category
--   'equipment'            → optional, Rentals category
--   'location_photos'      → optional, Location category
--   ''                     → legacy / unassigned (pre-modal uploads)
--
-- We keep the column as plain text rather than an enum because the
-- list will grow and changing an enum requires a migration; this
-- keeps slot names cheap to add. The UI validates the set.
-- ============================================================

alter table public.vendor_files
  add column if not exists slot text not null default '';

-- A vendor can have many files in a slot (e.g. multiple photos of one
-- license), so this index is non-unique. Used by the modal's
-- "fetch the files for slot X on vendor Y" lookup.
create index if not exists idx_vendor_files_vendor_slot
  on public.vendor_files (vendor_id, slot);

-- No backfill needed — existing rows default to '' (legacy bucket).
-- The modal treats those as "general / other files" so they don't
-- vanish from the UI.
