-- ============================================================
-- 123_import_generated_contracts.sql
-- The contract app's 707 documents, filed in Legal.
--
-- Siraj: "import all the data from the contract app ... we dont need the
-- contract app".
--
-- -- WHY external_doc AND NOT contract -------------------------------
--
-- public.generated_contracts is the contract app's OUTPUT table: a contract
-- number, the parties, an amount, and a path to a DOCX/PDF in storage. It has
-- no template, no version and no field values.
--
-- legal.contract cannot hold that. Everything the Register does - the print,
-- the fingerprint, the optional clauses, the supersede chain - is derived from
-- a version's blocks and the contract's field values, and these have neither.
-- Inventing a template version for 707 historical PDFs would put a
-- provenance on documents people actually signed that they do not have.
--
-- legal.external_doc (118) is the table written for exactly this: "an
-- agreement this app did not generate - filed so the register is complete. No
-- number, no version, no fingerprint: none of those mean anything for a
-- document we did not draft." It already carries `reference` for the source
-- system's own number.
--
-- -- THE NUMBERS, MEASURED NOT ASSUMED -------------------------------
--
--   707  rows
--   707  DISTINCT contract_id, 0 blank - the source id is a real key
--   644  have a file (every one of those has a DOCX; 597 also have a PDF)
--    63  have NEITHER and cannot be imported (see below)
--     4  contract_type values, all vendor payment variants:
--        after_pay_real 572, after_pay 71, after_payment 62, advance_pay 2
--   0    resolve to a workspace through their client, so the caller names it
--
-- -- THE 63 WITH NO FILE ---------------------------------------------
--
-- They are skipped, and the function says how many. external_doc.file_path is
-- NOT NULL on purpose - "the document IS the record" - and a register entry
-- pointing at nothing is worse than an absence, because it reads as evidence
-- that something was filed. legal.missing_generated_contracts() lists them so
-- somebody can go and find them.
--
-- -- IDEMPOTENT, AND UNDOABLE ----------------------------------------
--
-- Keyed on the source id with a unique index behind it, so running it twice
-- imports nothing the second time. Siraj's rule, learned from a Zoho import
-- that duplicated twelve clients nine times over by deduping through a capped
-- read.
--
-- `source` records where a row came from, so the undo can remove exactly what
-- this brought in and nothing a person filed by hand.
-- ============================================================

set search_path = legal, public;

-- 1. where a filed document came from -------------------------------

alter table legal.external_doc
  add column if not exists source text;

comment on column legal.external_doc.source is
  'Null for anything a person filed. ''contract_app'' for rows brought in by '
  'legal.import_generated_contracts, which is also what the undo deletes on.';

-- 2. the key that makes a re-run a no-op ----------------------------
--
-- Partial, because a hand-filed document may legitimately have no reference
-- and several of those must not collide with each other.

create unique index if not exists uq_legal_external_ws_reference
  on legal.external_doc (workspace_id, reference)
  where reference is not null and btrim(reference) <> '';

-- 3. the import ------------------------------------------------------

-- DROPPED FIRST, DELIBERATELY. `create or replace` CANNOT widen a function's
-- TABLE return - Postgres refuses with "cannot change return type of existing
-- function" - and it fails PARTWAY through a migration: the column, the index
-- and the other functions apply, the import silently stays on its old shape,
-- and the file still prints its closing notices. A half-applied migration
-- that reports success.
--
-- Found by re-running this file against a scratch database after widening the
-- return by one column. The signature check at the bottom is what makes it
-- impossible to miss next time.
drop function if exists legal.import_generated_contracts(uuid);

create function legal.import_generated_contracts(p_workspace_id uuid)
  returns table (imported bigint, already_there bigint, no_file bigint, no_reference bigint)
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_before bigint;
  v_after  bigint;
  v_nofile bigint;
  v_noref  bigint;
begin
  if auth.uid() is null
     or not public.has_role(p_workspace_id, array['owner','admin','legal']) then
    raise exception 'Only legal can import the contract app''s documents.'
      using errcode = '42501';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    raise exception 'No such workspace.' using errcode = '42704';
  end if;

  select count(*) into v_before
    from legal.external_doc where workspace_id = p_workspace_id;

  insert into legal.external_doc (
    workspace_id, title, doc_kind, party_name, reference,
    signed_on, expires_on, notes, file_path, file_name, source, created_at
  )
  select
    p_workspace_id,
    -- Non-blank is a CHECK. Vendor and brand when we have them, the source
    -- number when we have neither - never an empty title.
    coalesce(
      nullif(btrim(concat_ws(' - ', nullif(btrim(g.vendor_name), ''),
                                    nullif(btrim(g.brand_name), ''))), ''),
      'Contract ' || g.contract_id),
    -- All four contract_type values are vendor payment variants. Measured,
    -- not assumed: after_pay_real, after_pay, after_payment, advance_pay.
    'vendor_contract',
    coalesce(btrim(g.vendor_name), ''),
    btrim(g.contract_id),
    -- NOT generated_at. That is when the document was MADE; whether it came
    -- back signed is not recorded anywhere in the source, and null already
    -- means "on file, not signed", which is the honest answer.
    null,
    null,
    btrim(concat_ws(' ',
      'Imported from the contract app.',
      nullif('Type: ' || nullif(btrim(g.contract_type), '') || '.', 'Type: .'),
      nullif('Amount: ' || nullif(btrim(g.amount), '') || '.', 'Amount: .'),
      nullif('Generated ' || nullif(btrim(g.generated_at), '') || '.', 'Generated .'),
      nullif('By ' || nullif(btrim(g.generated_by), '') || '.', 'By .'))),
    -- PDF when there is one, DOCX otherwise. 597 have both, 644 have a DOCX,
    -- so the DOCX is the one that is nearly always there.
    coalesce(nullif(btrim(g.pdf_storage_path), ''), nullif(btrim(g.docx_storage_path), '')),
    regexp_replace(
      coalesce(nullif(btrim(g.pdf_storage_path), ''), nullif(btrim(g.docx_storage_path), '')),
      '^.*/', ''),
    'contract_app',
    -- The generation time, so the register reads in the order things happened
    -- rather than showing 644 documents all dated today. The index on this
    -- table is (workspace_id, created_at desc), so this IS the order.
    coalesce(
      (case when g.generated_at ~ '^\d{4}-\d{2}-\d{2}'
            then g.generated_at::timestamptz else null end),
      now())
  from public.generated_contracts g
  where coalesce(nullif(btrim(g.contract_id), ''), '') <> ''
    and coalesce(
          nullif(btrim(g.pdf_storage_path), ''),
          nullif(btrim(g.docx_storage_path), '')) is not null
  on conflict (workspace_id, reference)
    where reference is not null and btrim(reference) <> ''
    do nothing;

  select count(*) into v_after
    from legal.external_doc where workspace_id = p_workspace_id;

  select count(*) into v_nofile
    from public.generated_contracts g
   where coalesce(
           nullif(btrim(g.pdf_storage_path), ''),
           nullif(btrim(g.docx_storage_path), '')) is null;

  -- A row with no contract_id has nothing to key on, so it is skipped too.
  -- Counted rather than skipped quietly: a number that goes in no column is
  -- how an import comes to be trusted for something it did not do. It is
  -- zero in the real data - measured - and this is what would say so if that
  -- ever changed.
  select count(*) into v_noref
    from public.generated_contracts g
   where coalesce(nullif(btrim(g.contract_id), ''), '') = ''
     and coalesce(nullif(btrim(g.pdf_storage_path), ''),
                  nullif(btrim(g.docx_storage_path), '')) is not null;

  imported      := v_after - v_before;
  already_there := (select count(*) from public.generated_contracts g
                     where coalesce(nullif(btrim(g.pdf_storage_path), ''),
                                    nullif(btrim(g.docx_storage_path), '')) is not null
                       and coalesce(nullif(btrim(g.contract_id), ''), '') <> '')
                   - imported;
  no_file       := v_nofile;
  no_reference  := v_noref;
  return next;
end;
$fn$;

-- 4. the ones that could not come, by name --------------------------

create or replace function legal.missing_generated_contracts()
  returns table (contract_id text, vendor_name text, brand_name text, generated_at text)
  language sql stable security definer
  set search_path = legal, public, pg_temp
  as $fn$
  select g.contract_id, g.vendor_name, g.brand_name, g.generated_at
    from public.generated_contracts g
   where coalesce(nullif(btrim(g.pdf_storage_path), ''),
                  nullif(btrim(g.docx_storage_path), '')) is null
   order by g.generated_at;
$fn$;

-- 5. the wipe --------------------------------------------------------
--
-- Removes exactly what the import brought in, by `source`, and nothing a
-- person filed by hand. Siraj's rule: an import ships with a wipe file.

create or replace function legal.undo_generated_contracts_import(p_workspace_id uuid)
  returns bigint
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare n bigint;
begin
  if auth.uid() is null
     or not public.has_role(p_workspace_id, array['owner','admin']) then
    raise exception 'Only an owner can undo the import.' using errcode = '42501';
  end if;
  delete from legal.external_doc
   where workspace_id = p_workspace_id and source = 'contract_app';
  get diagnostics n = row_count;
  return n;
end;
$fn$;

revoke all on function legal.import_generated_contracts(uuid) from public;
revoke all on function legal.missing_generated_contracts() from public;
revoke all on function legal.undo_generated_contracts_import(uuid) from public;
grant execute on function legal.import_generated_contracts(uuid) to authenticated;
grant execute on function legal.missing_generated_contracts() to authenticated;
grant execute on function legal.undo_generated_contracts_import(uuid) to authenticated;

-- 6. prove the SELECT runs, before proving the guard refuses --------
--
-- The lesson from 122: plpgsql does not parse a body until it is called, and
-- the guard raises before the query is reached - so a refusal test proves
-- nothing about the query. This runs the real thing.

do $$
declare n bigint;
begin
  select count(*) into n from (
    select g.contract_id,
           coalesce(nullif(btrim(g.pdf_storage_path), ''),
                    nullif(btrim(g.docx_storage_path), '')) as f,
           btrim(concat_ws(' - ', nullif(btrim(g.vendor_name), ''),
                                  nullif(btrim(g.brand_name), ''))) as t,
           (case when g.generated_at ~ '^\d{4}-\d{2}-\d{2}'
                 then g.generated_at::timestamptz else null end) as at
      from public.generated_contracts g
  ) q;
  raise notice 'legal: the import query runs - % row(s) in generated_contracts', n;
end $$;

do $$
declare v_sig text;
begin
  begin
    perform * from legal.import_generated_contracts('00000000-0000-0000-0000-000000000000');
    raise exception 'legal: the import answered a caller with no session';
  exception
    when sqlstate '42501' then null;
  end;

  -- THE SIGNATURE, not just the existence. A function that is present but is
  -- the PREVIOUS version of itself is exactly what a failed `create or
  -- replace` leaves behind, and "does it exist" says yes to that.
  select pg_get_function_result(p.oid) into v_sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'legal' and p.proname = 'import_generated_contracts';
  if v_sig is null or position('no_reference' in v_sig) = 0 then
    raise exception 'legal: import_generated_contracts is the wrong shape: %',
      coalesce(v_sig, '(missing)');
  end if;

  raise notice 'legal: the import is in place, the right shape, and refuses an anonymous caller';
end $$;

notify pgrst, 'reload schema';

-- Run it (as yourself, in the SQL editor, with YOUR workspace id):
--   select * from legal.import_generated_contracts('<workspace id>');
-- Re-run it: imports 0, which is the point.
-- See what could not come:
--   select * from legal.missing_generated_contracts();
-- Undo the whole thing:
--   select legal.undo_generated_contracts_import('<workspace id>');
