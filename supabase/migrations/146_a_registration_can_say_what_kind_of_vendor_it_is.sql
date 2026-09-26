-- ============================================================
-- 146_a_registration_can_say_what_kind_of_vendor_it_is.sql
-- The queue can carry the category, and everything the category asks for.
--
-- -- WHY -----------------------------------------------------------
--
-- Siraj: "remember that each vendor has different requirements".
--
-- The app has known this since migration 029. public.vendor_categories
-- carries requires_license, and components/workflow/VendorEditorModal
-- already switches the identity field on it: influencer and UGC give a
-- licence number, the other nine give a national ID. 029 also put a set of
-- per-category columns on public.vendors, and VendorEditorModal's
-- CategorySpecificFields shows exactly these and nothing else:
--
--   logistics          location_link, short_address
--   model              age, gender
--   rentals            rental_type
--   events             event_opening, event_ceremony
--   location           location_type, location_link
--   influencer / ugc   platforms   (already on pending_vendors)
--
-- public.pending_vendors carries NONE of it - not the per-category
-- columns, not vat_number, and not even category_id. So a vendor filling
-- in a public registration form could pick "Model", answer the two
-- questions that category exists to ask, and have both of them silently
-- dropped at the moment of approval. That is the same failure fbd0dd1
-- fixed for the email, the phone and the licence expiry, and it is worth
-- fixing before the form is built rather than after it.
--
-- category_id specifically: approvePendingVendor writes the legacy
-- free-text vendor_category and has never written category_id, so every
-- vendor born from a registration arrived with no lookup category at all
-- - which is what vendorCategoryKey's comment means by "plenty have
-- neither".
--
-- Nullable and no default throughout: these are new questions and every
-- existing row predates them.
--
-- -- THE GRANT, AND WHAT IT IS NOT ---------------------------------
--
-- 029 ended with `grant select, insert, update, delete on
-- public.vendor_categories to anon, authenticated` beside four policies
-- that all read `using (true)`. Read on its own that looks like a hole:
-- the public key could rewrite the category list.
--
-- IT IS NOT ONE, and the check before writing this said so. Migration 126
-- replaced all three write policies with `to authenticated` +
-- is_workspace_admin(), so anon has no policy for INSERT, UPDATE or
-- DELETE on this table and RLS refuses all three whatever the grant says.
-- 126 is the authority on who may change this list and this migration
-- does not touch its policies - recreating them here against is_staff()
-- would WIDEN them from owner-or-admin to any member of staff, and 126
-- exists precisely because this table is the switch that excuses the
-- contract rule.
--
-- What is left is a grant that outlived its policies. Revoking it costs
-- nothing, removes the second thing that would have to go wrong, and
-- stops the next person reading 029 reaching the same wrong conclusion
-- this comment did. SELECT stays: rendering that list is how the
-- registration form knows which questions to ask.
-- ============================================================

alter table public.pending_vendors
  add column if not exists category_id     uuid references public.vendor_categories(id) on delete set null,
  add column if not exists vat_number      text,
  add column if not exists location_link   text,
  add column if not exists short_address   text,
  add column if not exists age             integer,
  add column if not exists gender          text,
  add column if not exists rental_type     text,
  add column if not exists event_opening   text,
  add column if not exists event_ceremony  text,
  add column if not exists location_type   text;

comment on column public.pending_vendors.category_id is
  'The vendor_categories row the registration picked. approvePendingVendor copies it to vendors.category_id; vendor_category keeps the same key as free text, which is what vendorCategoryKey() reads first.';
comment on column public.pending_vendors.age is
  'Model category only. integer, to match vendors.age - a text column here would be a string posted into an integer and a refused insert.';

-- Belt and braces behind 126's policies, which already refuse anon.
revoke insert, update, delete on public.vendor_categories from anon;

-- Prove it, rather than trust it.
do $$
declare n integer;
declare bad text;
begin
  -- 1. Every new queue column exists, and every one of them has somewhere
  --    to land on vendors. A column with no home has only moved the gap
  --    one table along, which is what 145 was written to stop.
  select string_agg(c, ', ') into bad from unnest(array[
    'category_id', 'vat_number', 'location_link', 'short_address', 'age',
    'gender', 'rental_type', 'event_opening', 'event_ceremony', 'location_type'
  ]) as c
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'pending_vendors' and column_name = c)
      or not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vendors' and column_name = c);
  if bad is not null then
    raise exception 'registration: these have no queue column or no home in vendors: %', bad;
  end if;

  -- 2. age is a number on both sides, or the form posts a string into an
  --    integer and PostgREST refuses the whole insert - losing the entire
  --    registration, not one field.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and column_name = 'age'
     and table_name in ('vendors', 'pending_vendors')
     and data_type = 'integer';
  if n <> 2 then
    raise exception 'registration: age is not an integer on both tables (found % of 2)', n;
  end if;

  -- 3. The public key may read the category list and may not change it.
  --    Structural: what anon is GRANTED, not what one row allows today.
  select string_agg(privilege_type, ', ') into bad
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'vendor_categories'
     and grantee = 'anon' and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if bad is not null then
    raise exception 'registration: anon is still granted % on the category list', bad;
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'vendor_categories'
       and grantee = 'anon' and privilege_type = 'SELECT') then
    raise exception 'registration: anon cannot read the category list, so the form has no questions to ask';
  end if;

  -- 4. 126's rule is still the rule. Every way of CHANGING this table
  --    must still go through is_workspace_admin(); if a later migration
  --    ever relaxes that to is_staff() or to `true`, the exemption
  --    becomes easier to reach than the override it excuses, and this
  --    fails rather than letting it pass unnoticed.
  select count(*), string_agg(policyname, ', ') into n, bad
    from pg_policies
   where schemaname = 'public' and tablename = 'vendor_categories'
     and cmd <> 'SELECT'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%is_workspace_admin%';
  if n <> 0 then
    raise exception 'registration: % write policy(ies) on vendor_categories no longer ask is_workspace_admin(): %', n, bad;
  end if;

  raise notice 'registration: the queue can carry a category and what the category asks for';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'pending_vendors'
--    and column_name in ('category_id','vat_number','location_link','short_address',
--                        'age','gender','rental_type','event_opening',
--                        'event_ceremony','location_type')
--  order by 1;
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'vendor_categories'
--    and grantee in ('anon','authenticated') order by 1, 2;
