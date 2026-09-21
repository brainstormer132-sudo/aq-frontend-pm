-- ============================================================
-- 118_external_doc.sql
-- Agreements that were never made in this app.
--
-- Siraj, asked whether legal also needs to file paperwork the app did not
-- generate, chose yes: an office lease, an NDA somebody else drafted, a
-- client MSA signed before any of this existed. Her job description is
-- "dealing with everything relating to legal", and a register that holds
-- only what we typed here is a register she cannot trust as complete.
--
-- -- WHY THIS IS NOT A CONTRACT ROW -----------------------------------
--
-- legal.contract.version_id is NOT NULL and references a template version
-- ON DELETE RESTRICT. That is what makes an issued contract reproducible:
-- the exact wording it was stamped to can never be pulled out from under
-- it. An outside agreement has no template and never will, so putting one
-- in that table would mean either relaxing the column - destroying the
-- guarantee for every real contract - or inventing a fake version for it
-- to point at, which is a lie in the schema.
--
-- So it is its own table. It has no number, no fingerprint, no version and
-- no freeze, because none of those mean anything for a document we did not
-- draft. What it has is the FILE, and that is mandatory: an external
-- agreement with no document attached is a note, and there is a matter log
-- for notes.
--
-- -- THE BUCKET IS SHARED -----------------------------------------------
--
-- These go in `legal-signed` beside the signed counterparts from 117,
-- under their own `external/` prefix. One bucket rather than two because
-- the security profile is identical - private, signed URLs, staff only -
-- and a second set of four policies is a second set of four policies to
-- get wrong. The paths cannot collide: a contract's key starts with its
-- workspace and contract id, an external doc's with `external/`.
-- ============================================================

set search_path = legal, public;

-- 1. the table ----------------------------------------------------
create table if not exists legal.external_doc (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,

  title        text not null,
  -- The same six kinds the templates use (098 + 115), so one filter reads
  -- across both and a "how many NDAs do we have" question has one answer.
  doc_kind     text not null default 'other'
               check (doc_kind in ('vendor_contract', 'client_contract', 'nda',
                                   'letter', 'model', 'other')),
  -- The other side, as a name. NOT a foreign key to clients or vendors: the
  -- landlord on an office lease is neither, and forcing every counterparty
  -- into one of those two tables would mean creating fake vendor rows for
  -- companies nobody books.
  party_name   text not null default '',
  -- Their reference, when the document has one of its own. Ours never will:
  -- AQ's contract numbers are reserved at issue and this was not issued.
  reference    text,

  -- Null means "on file, not signed" - which is a real state (a draft
  -- somebody sent over) and not the same as "we do not know".
  signed_on    date,
  -- So this can feed the date alerts (101) later without a second migration.
  expires_on   date,
  notes        text not null default '',

  -- Mandatory. The document IS the record; see the header.
  file_path    text not null,
  file_name    text not null,
  file_bytes   bigint,

  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_legal_external_ws
  on legal.external_doc(workspace_id, created_at desc, id desc);
create index if not exists idx_legal_external_expiry
  on legal.external_doc(workspace_id, expires_on) where expires_on is not null;

comment on table legal.external_doc is
  'An agreement this app did not generate - filed so the register is complete. No number, no version, no fingerprint: none of those mean anything for a document we did not draft.';

-- 2. the rules ----------------------------------------------------
--
-- NOT VALID on all three: the table is new and empty, so there is nothing
-- to scan, and writing them as NOT VALID keeps the shape identical to the
-- constraints added to legal.contract in 115 and 116.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'external_doc_title_chk'
                    and conrelid = 'legal.external_doc'::regclass) then
    alter table legal.external_doc add constraint external_doc_title_chk
      check (btrim(title) <> '') not valid;
  end if;

  -- A path with no name, or either one blank, is half an upload - what a
  -- failure between the storage write and the insert looks like.
  if not exists (select 1 from pg_constraint
                  where conname = 'external_doc_file_chk'
                    and conrelid = 'legal.external_doc'::regclass) then
    alter table legal.external_doc add constraint external_doc_file_chk
      check (btrim(file_path) <> '' and btrim(file_name) <> '') not valid;
  end if;

  -- A document that expired before it was signed is a typo, and the moment
  -- to catch a typed date is while somebody is still looking at the form.
  if not exists (select 1 from pg_constraint
                  where conname = 'external_doc_dates_chk'
                    and conrelid = 'legal.external_doc'::regclass) then
    alter table legal.external_doc add constraint external_doc_dates_chk
      check (signed_on is null or expires_on is null or expires_on >= signed_on) not valid;
  end if;
end $$;

drop trigger if exists trg_external_doc_updated on legal.external_doc;
create trigger trg_external_doc_updated before update on legal.external_doc
  for each row execute function public.update_updated_at();

-- 3. grants + RLS -------------------------------------------------
--
-- The same audience as every other legal table: owner, admin, legal. An
-- office lease carries rent and a landlord's bank details, and a client MSA
-- carries commercial terms; neither is for the whole workspace.
alter table legal.external_doc enable row level security;
grant select, insert, update, delete on legal.external_doc to authenticated;
grant all on legal.external_doc to service_role;

drop policy if exists external_doc_rw on legal.external_doc;
create policy external_doc_rw on legal.external_doc for all to authenticated
  using (public.has_role(workspace_id, array['owner', 'admin', 'legal']))
  with check (public.has_role(workspace_id, array['owner', 'admin', 'legal']));

-- 4. prove it, rather than trust it -------------------------------
do $$
declare
  ws    uuid;
  a     uuid;
  fired boolean;
begin
  select id into ws from public.workspaces limit 1;
  if ws is null then
    raise notice 'no workspace to probe against - skipping the checks';
    return;
  end if;

  begin
    -- (a) a proper filing is accepted
    insert into legal.external_doc (workspace_id, title, doc_kind, party_name,
                                    file_path, file_name, signed_on, expires_on)
    values (ws, '__probe_lease__', 'other', 'A landlord',
            'external/x/lease.pdf', 'lease.pdf', date '2026-01-01', date '2027-01-01')
    returning id into a;

    -- (b) no file is refused - the document is the record
    fired := false;
    begin
      insert into legal.external_doc (workspace_id, title, file_path, file_name)
      values (ws, '__probe_nofile__', '  ', 'x.pdf');
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: an external doc with no file was accepted'; end if;

    -- (c) no title is refused
    fired := false;
    begin
      insert into legal.external_doc (workspace_id, title, file_path, file_name)
      values (ws, '   ', 'external/x/y.pdf', 'y.pdf');
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: an untitled external doc was accepted'; end if;

    -- (d) expiring before it was signed is a typo, caught here
    fired := false;
    begin
      insert into legal.external_doc (workspace_id, title, file_path, file_name,
                                      signed_on, expires_on)
      values (ws, '__probe_dates__', 'external/x/y.pdf', 'y.pdf',
              date '2026-06-01', date '2026-01-01');
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: an expiry before the signing date was accepted'; end if;

    -- (e) an unknown kind is refused
    fired := false;
    begin
      insert into legal.external_doc (workspace_id, title, doc_kind, file_path, file_name)
      values (ws, '__probe_kind__', 'invoice', 'external/x/y.pdf', 'y.pdf');
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: an unknown doc_kind was accepted'; end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: the external-document rules all hold';
  end;
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.tables
--     where table_schema='legal' and table_name='external_doc')          as tbl,
--   (select count(*) from pg_constraint
--     where conrelid='legal.external_doc'::regclass and contype='c')     as checks,
--   (select count(*) from pg_policies
--     where schemaname='legal' and tablename='external_doc')             as policies,
--   (select relrowsecurity from pg_class
--     where oid='legal.external_doc'::regclass)                          as rls_on,
--   (select count(*) from legal.external_doc)                            as filed;
-- expected: 1 | 4 | 1 | true | 0
