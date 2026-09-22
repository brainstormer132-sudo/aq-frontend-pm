-- ============================================================
-- 123_import_generated_contracts.sql
-- The contract app's 707 documents, filed in Legal.
--
-- Siraj: "import all the data from the contract app ... we dont need the
-- contract app".
--
-- -- A SCRIPT, NOT A FUNCTION ----------------------------------------
--
-- The first three versions of this file wrapped the import in a SECURITY
-- DEFINER function with the guard every legal RPC carries. That was wrong
-- twice over.
--
-- It did not work: the Supabase SQL editor runs as `postgres` with no JWT, so
-- auth.uid() is null and the guard refused the only caller a one-off import
-- will ever have. Measured, after two wrong guesses about what the editor is:
--
--   current_user | session_user | is_superuser | uid  | role
--   postgres     | postgres     | off          | null | none
--
-- `postgres` on Supabase Cloud is NOT a superuser, so a superuser test does
-- not identify the editor either.
--
-- And it should not have worked. A function granted to `authenticated` is a
-- permanent surface every signed-in user can call, created solely to run one
-- import one time. There is nothing to guard here if there is nothing to
-- call: this is a script somebody with database access runs once, which is
-- the access that lets them write these rows by hand anyway.
--
-- -- WHY external_doc AND NOT contract -------------------------------
--
-- public.generated_contracts is the contract app's OUTPUT: a contract number,
-- the parties, an amount, and a path to a DOCX/PDF in storage. No template,
-- no version, no field values.
--
-- legal.contract cannot hold that. The print, the fingerprint, the optional
-- clauses and the supersede chain are all derived from a version's blocks and
-- the contract's own values, and these have neither. Inventing a template
-- version for 707 historical PDFs would put a provenance on documents people
-- actually signed that those documents do not have.
--
-- legal.external_doc (118) is the table written for exactly this: "an
-- agreement this app did not generate - filed so the register is complete."
--
-- -- THE NUMBERS, MEASURED BEFORE ANY OF THIS WAS WRITTEN ------------
--
--   707  rows, 707 DISTINCT contract_id, 0 blank - the source id is a key
--   644  have a file (every one has a DOCX; 597 also have a PDF)
--    63  have NEITHER and are skipped - file_path is NOT NULL on purpose,
--        and a register entry pointing at nothing reads as evidence that
--        something was filed
--     4  contract_type values, all vendor payment variants
--     0  resolve to a workspace through their client, so it is named below
--
-- -- HOW TO RUN IT ---------------------------------------------------
--
-- Replace the workspace id below, paste the whole thing into the SQL editor.
-- It runs in a transaction and the last statement is the summary. Running it
-- twice imports nothing the second time - that is what the unique index is
-- for. The undo is at the bottom, commented out.
-- ============================================================

begin;

-- The three functions the earlier versions of this file created. Dropped:
-- nothing should be able to call an import.
drop function if exists legal.import_generated_contracts(uuid);
drop function if exists legal.undo_generated_contracts_import(uuid);
drop function if exists legal.missing_generated_contracts();

-- Where a filed document came from. Null for anything a person filed by hand,
-- which is also what makes the undo safe.
alter table legal.external_doc
  add column if not exists source text;

-- The key that makes a re-run a no-op. Partial, because a hand-filed document
-- may legitimately have no reference and several of those must not collide.
create unique index if not exists uq_legal_external_ws_reference
  on legal.external_doc (workspace_id, reference)
  where reference is not null and btrim(reference) <> '';

insert into legal.external_doc (
  workspace_id, title, doc_kind, party_name, reference,
  signed_on, expires_on, notes, file_path, file_name, source, created_at
)
select
  '874c6670-29d9-48f1-97a4-ccbc0e54208b'::uuid,
  -- Non-blank is a CHECK. Vendor and brand when we have them, the source
  -- number when we have neither - never an empty title.
  coalesce(
    nullif(btrim(concat_ws(' - ', nullif(btrim(g.vendor_name), ''),
                                  nullif(btrim(g.brand_name), ''))), ''),
    'Contract ' || btrim(g.contract_id)),
  'vendor_contract',
  coalesce(btrim(g.vendor_name), ''),
  btrim(g.contract_id),
  -- NOT generated_at. That is when the document was MADE; whether it came
  -- back signed is recorded nowhere in the source, and null already means
  -- "on file, not signed" - the honest answer rather than a flattering one.
  null,
  null,
  btrim(concat_ws(' ',
    'Imported from the contract app.',
    nullif('Type: ' || nullif(btrim(g.contract_type), '') || '.', 'Type: .'),
    nullif('Amount: ' || nullif(btrim(g.amount), '') || '.', 'Amount: .'),
    nullif('Generated ' || nullif(btrim(g.generated_at), '') || '.', 'Generated .'),
    nullif('By ' || nullif(btrim(g.generated_by), '') || '.', 'By .'))),
  -- PDF when there is one, DOCX otherwise.
  coalesce(nullif(btrim(g.pdf_storage_path), ''), nullif(btrim(g.docx_storage_path), '')),
  regexp_replace(
    coalesce(nullif(btrim(g.pdf_storage_path), ''), nullif(btrim(g.docx_storage_path), '')),
    '^.*/', ''),
  'contract_app',
  -- The generation time, so the register reads in the order things happened.
  -- The index on this table is (workspace_id, created_at desc), so this IS
  -- the order; without it five months collapse into one afternoon.
  coalesce(
    (case when g.generated_at ~ '^\d{4}-\d{2}-\d{2}'
          then g.generated_at::timestamptz else null end),
    now())
from public.generated_contracts g
where coalesce(nullif(btrim(g.contract_id), ''), '') <> ''
  and coalesce(nullif(btrim(g.pdf_storage_path), ''),
               nullif(btrim(g.docx_storage_path), '')) is not null
on conflict (workspace_id, reference)
  where reference is not null and btrim(reference) <> ''
  do nothing;

-- The summary, LAST, because the SQL editor shows only the final result set.
select
  (select count(*) from legal.external_doc
    where workspace_id = '874c6670-29d9-48f1-97a4-ccbc0e54208b'::uuid
      and source = 'contract_app')                        as filed_from_contract_app,
  (select count(*) from public.generated_contracts)       as source_rows,
  (select count(*) from public.generated_contracts g
    where coalesce(nullif(btrim(g.pdf_storage_path), ''),
                   nullif(btrim(g.docx_storage_path), '')) is null)
                                                          as skipped_no_file,
  (select count(*) from public.generated_contracts g
    where coalesce(nullif(btrim(g.contract_id), ''), '') = ''
      and coalesce(nullif(btrim(g.pdf_storage_path), ''),
                   nullif(btrim(g.docx_storage_path), '')) is not null)
                                                          as skipped_no_reference;

commit;

-- The 63 that could not come, by name:
--
--   select g.contract_id, g.vendor_name, g.brand_name, g.generated_at
--     from public.generated_contracts g
--    where coalesce(nullif(btrim(g.pdf_storage_path), ''),
--                   nullif(btrim(g.docx_storage_path), '')) is null
--    order by g.generated_at
--
-- The undo - removes exactly what this brought in, by `source`, and nothing
-- anybody filed by hand:
--
--   delete from legal.external_doc
--    where workspace_id = '874c6670-29d9-48f1-97a4-ccbc0e54208b'
--      and source = 'contract_app'
