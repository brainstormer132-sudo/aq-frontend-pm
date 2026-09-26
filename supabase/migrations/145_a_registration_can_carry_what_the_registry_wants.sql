-- ============================================================
-- 145_a_registration_can_carry_what_the_registry_wants.sql
-- The queue can hold the fields that stop a new record being born
-- incomplete.
--
-- -- HOW THIS WAS FOUND -----------------------------------------------
--
-- Before writing the registration form, the obvious question is which
-- fields it should ask for - and the app already answers it. lib/registry
-- has said for months what it considers a gap:
--
--   vendorGaps:  bank details / IBAN, SIGNATORY, ID OR LICENCE
--   clientGaps:  signatory, VAT number, CR number, address
--
-- public.pending_clients can carry all of its four. public.pending_vendors
-- cannot carry two of its three: it has no signatory_name and no
-- id_number. So a vendor registration, however carefully filled in, has
-- always produced a registry row with "signatory" and possibly "ID or
-- licence" already listed as missing - work created at the moment of
-- approval, for somebody to chase later.
--
-- The client side gains signatory_title for the same reason: migration 142
-- put it on public.clients because the client contract prints it, and the
-- contract falls back to a hard-coded default when it is empty. Asking
-- once, at registration, is the whole point of "fewer manual fields".
--
-- Nullable and no default, because these are new questions on a form that
-- has not been built yet and every existing row predates them. An empty
-- string and a NULL both mean "not answered" here, and the gap functions
-- above already treat them the same.
-- ============================================================

alter table public.pending_vendors
  add column if not exists signatory_name text,
  add column if not exists id_number      text;

alter table public.pending_clients
  add column if not exists signatory_title text;

comment on column public.pending_vendors.signatory_name is
  'Who signs for the vendor. vendorGaps() lists a vendor without one as incomplete.';
comment on column public.pending_vendors.id_number is
  'National ID, for a vendor who is a person rather than a licensed company. vendorGaps() accepts either this or a licence number.';
comment on column public.pending_clients.signatory_title is
  'The signatory''s role, printed on the client contract (142). Empty falls back to the general-manager default.';

-- Prove it, rather than trust it.
do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'pending_vendors'  and column_name in ('signatory_name', 'id_number'))
       or (table_name = 'pending_clients'  and column_name = 'signatory_title'));
  if n <> 3 then
    raise exception 'registration: expected 3 new queue columns, found %', n;
  end if;

  -- Every one of them must have somewhere to land when the row is
  -- approved, or this migration has only moved the gap one table along.
  select count(*) into n from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'vendors' and column_name in ('signatory_name', 'id_number'))
       or (table_name = 'clients' and column_name = 'signatory_title'));
  if n <> 3 then
    raise exception 'registration: only % of the 3 have a home in vendors/clients', n;
  end if;

  raise notice 'registration: the queue can now carry a signatory and an id';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select table_name, column_name from information_schema.columns
--  where table_schema = 'public'
--    and ((table_name = 'pending_vendors' and column_name in ('signatory_name','id_number'))
--      or (table_name = 'pending_clients' and column_name = 'signatory_title'))
--  order by 1, 2;
