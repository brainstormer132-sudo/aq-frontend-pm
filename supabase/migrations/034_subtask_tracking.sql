-- ============================================================
-- 034 — Subtasks: tracking-sheet fields
--
-- Each vendor subtask already IS one row of the campaign tracking
-- sheet (influencer, platform, ad type, price). These columns add
-- the execution/tracking fields the marketing team fills in as an
-- ad moves from planning to posted.
--
-- Always used:  content, product, shooting_date, posting_date,
--               ad_status, ad_link  (+ profile_link, tax prices)
-- Situational:
--   Store Visit → has_guest / guest_name, location, ad_time,
--                 is_event → license_plate_url (photo of plate)
--   Home Ad     → location, contact_number
--
-- Dates/times are kept as free text to match how the team enters
-- them in the sheet (ranges, "TBD", Hijri, etc.). ad_status default
-- 'Not started' mirrors the lifecycle:
--   Not started → Scheduled → Shot → Posted → Cancelled
-- ============================================================

alter table public.subtasks
  add column if not exists content         text    default '',
  add column if not exists product         text    default '',
  add column if not exists profile_link    text    default '',
  add column if not exists shooting_date   text    default '',
  add column if not exists posting_date    text    default '',
  add column if not exists ad_status       text    default 'Not started',
  add column if not exists ad_link         text    default '',
  add column if not exists location        text    default '',
  add column if not exists ad_time         text    default '',
  add column if not exists has_guest       boolean default false,
  add column if not exists guest_name      text    default '',
  add column if not exists is_event        boolean default false,
  add column if not exists license_plate_url text  default '',
  add column if not exists contact_number  text    default '',
  add column if not exists price_excl_tax  text    default '',
  add column if not exists price_incl_tax  text    default '';

-- No index needed: these columns are always read alongside the
-- subtask row (per-task), never queried on their own.
