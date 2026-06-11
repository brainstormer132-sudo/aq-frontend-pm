-- ============================================================
-- 029 — Vendor categories + per-category fields
--
-- Today `public.vendors.vendor_category` is a free-text column populated by
-- whatever string the form sends. We replace that with a real lookup table
-- (`vendor_categories`) so the same 11 categories are picked everywhere,
-- and add the base + per-category fields the team dictated:
--
--   Common base (added to vendors):
--     - category_id          → FK, single category per vendor
--     - id_number            → Saudi national ID / iqama (required for 9 cats)
--     - license_number       → already exists; relaxed to nullable
--                              (required only for Influencer + UGC)
--     - signatory_name       → who signs the contract
--     - contact_name         → contact person (may differ from `name`)
--     - vat_number           → optional VAT registration number
--     - details              → free-form notes (optional)
--     - bank info            → already in public.bank_accounts (unchanged)
--
--   Per-category optional fields (also on vendors — sparse, populated only
--   when the category needs them):
--     Logistics: location_link, short_address
--     Model:     age, gender
--     Rentals:   rental_type
--     Events:    event_opening, event_ceremony
--     Location:  location_type, location_link
--
-- The 11 seeded categories (key, label, requires_license):
--   influencer       (license)
--   ugc              (license)
--   props            (id)
--   makeup_artist    (id)
--   logistics        (id)
--   model            (id)
--   videographer     (id)
--   rentals          (id)
--   events           (id)
--   location         (id)
--   photographer     (id)
--
-- Vendors are EDITABLE at any time (no triggers locking fields).
-- Vendor can only be ONE category at a time (single FK, no junction table).
--
-- Run in Supabase SQL Editor.
-- ============================================================

-- ─── 1. vendor_categories lookup ────────────────────────────────────
create table if not exists public.vendor_categories (
  id                uuid primary key default gen_random_uuid(),
  key               text not null unique,           -- machine key (e.g. 'influencer')
  label             text not null,                  -- display label
  requires_license  boolean not null default false, -- true → use license_number, false → use id_number
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

create index if not exists idx_vendor_categories_sort
  on public.vendor_categories (sort_order, label);

alter table public.vendor_categories enable row level security;

drop policy if exists "vendor_categories read"   on public.vendor_categories;
drop policy if exists "vendor_categories write"  on public.vendor_categories;
drop policy if exists "vendor_categories update" on public.vendor_categories;
drop policy if exists "vendor_categories delete" on public.vendor_categories;

create policy "vendor_categories read"   on public.vendor_categories for select using (true);
create policy "vendor_categories write"  on public.vendor_categories for insert with check (true);
create policy "vendor_categories update" on public.vendor_categories for update using (true);
create policy "vendor_categories delete" on public.vendor_categories for delete using (true);

grant select, insert, update, delete on public.vendor_categories to anon, authenticated;


-- ─── 2. Seed the 11 categories ──────────────────────────────────────
-- ON CONFLICT (key) keeps this migration idempotent.
insert into public.vendor_categories (key, label, requires_license, sort_order) values
  ('influencer',     'Influencer',     true,  10),
  ('ugc',            'UGC',            true,  20),
  ('props',          'Props',          false, 30),
  ('makeup_artist',  'Makeup Artist',  false, 40),
  ('logistics',      'Logistics',      false, 50),
  ('model',          'Model',          false, 60),
  ('videographer',   'Videographer',   false, 70),
  ('rentals',        'Rentals',        false, 80),
  ('events',         'Events',         false, 90),
  ('location',       'Location',       false, 100),
  ('photographer',   'Photographer',   false, 110)
on conflict (key) do update
  set label            = excluded.label,
      requires_license = excluded.requires_license,
      sort_order       = excluded.sort_order;


-- ─── 3. Extend vendors with base + per-category columns ─────────────
alter table public.vendors
  -- base
  add column if not exists category_id      uuid references public.vendor_categories(id) on delete set null,
  add column if not exists id_number        text default '',
  add column if not exists signatory_name   text default '',
  add column if not exists contact_name     text default '',
  add column if not exists vat_number       text default '',
  add column if not exists details          text default '',
  -- per-category (sparse, optional)
  add column if not exists location_link    text default '',
  add column if not exists short_address    text default '',
  add column if not exists age              integer,
  add column if not exists gender           text default '',
  add column if not exists rental_type      text default '',
  add column if not exists event_opening    text default '',
  add column if not exists event_ceremony   text default '',
  add column if not exists location_type    text default '';

create index if not exists idx_vendors_category_id
  on public.vendors (category_id);


-- ─── 4. Relax license_number — only Influencer + UGC need it ────────
-- Old schema declared `license_number text NOT NULL`. With 9 of 11 categories
-- using id_number instead, we need to allow NULL/empty.
alter table public.vendors
  alter column license_number drop not null;

-- Also normalize: any row currently storing the literal string '' should
-- stay as '' (defaults are empty string, matching the rest of the table).
-- No update needed.


-- ─── 5. (Soft) backfill: try to map old vendor_category text → category_id
--      Best-effort, case-insensitive, alias-aware. Anything that doesn't
--      match is left null and the team can pick a category in the UI.
-- ────────────────────────────────────────────────────────────────────
update public.vendors v
   set category_id = vc.id
  from public.vendor_categories vc
 where v.category_id is null
   and v.vendor_category is not null
   and v.vendor_category <> ''
   and (
        lower(trim(v.vendor_category)) = lower(vc.key)
     or lower(trim(v.vendor_category)) = lower(vc.label)
     -- common alias variants we've seen in old data
     or (vc.key = 'makeup_artist'  and lower(trim(v.vendor_category)) in ('makeup','make-up','make up','makeup artists','makeup artist'))
     or (vc.key = 'ugc'            and lower(trim(v.vendor_category)) in ('ugc creator','user generated content'))
     or (vc.key = 'influencer'     and lower(trim(v.vendor_category)) in ('influencers'))
     or (vc.key = 'photographer'   and lower(trim(v.vendor_category)) in ('photo','photography'))
     or (vc.key = 'videographer'   and lower(trim(v.vendor_category)) in ('video','videography'))
     or (vc.key = 'events'         and lower(trim(v.vendor_category)) in ('event'))
     or (vc.key = 'rentals'        and lower(trim(v.vendor_category)) in ('rental'))
   );


-- ─── 6. Verification queries (run by hand after migration) ──────────
-- select key, label, requires_license, sort_order
--   from public.vendor_categories
--  order by sort_order;
--
-- select v.id, v.name, v.vendor_category, vc.label as resolved_category
--   from public.vendors v
--   left join public.vendor_categories vc on vc.id = v.category_id
--  order by v.id;
--
-- -- rows that still need a manual category pick:
-- select id, name, vendor_category
--   from public.vendors
--  where category_id is null
--  order by name;
