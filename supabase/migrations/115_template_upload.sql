-- ============================================================
-- 115_template_upload.sql
-- Two more document kinds, and somewhere to keep the Word file.
--
-- Siraj: "in my vision we upload the template then a copy of it is added then
-- a popup apears asking what type of contract it is if its a influencer/ugc
-- client nda letter or model and based on that it gets blocks where you can
-- place in to simulate the {{ input }} from a list then it gets stored and
-- setup."
--
-- -- THE KINDS ------------------------------------------------------
--
-- 098 allowed four: vendor_contract, nda, client_contract, other. His list
-- needs two more - a letter and a model release - and renames one.
--
-- vendor_contract IS the influencer/UGC agreement. That is what the seeded
-- template has always been; "vendor" was our word for the other side, not
-- his. The KEY is deliberately left alone and only the LABEL changes, in
-- lib/legal.ts: renaming the key would mean rewriting every existing
-- template, every contract stamped to one, and the seeds - all so a string
-- nobody sees could read differently. The label is the part anybody sees.
--
-- -- THE FILE -------------------------------------------------------
--
-- "a copy of it is added". The .docx that was uploaded is kept and stays
-- downloadable from the template, because a parse can be subtly wrong and the
-- original is the only thing that settles it. Three columns rather than a
-- second table: it is at most one file per template, and a table would need
-- its own policies to say the same thing.
--
-- The bucket is PRIVATE. A template is AQ's own wording, and some of these
-- carry bank details in their boilerplate.
-- ============================================================

set search_path = legal, public;

-- 1. the kinds ----------------------------------------------------
--
-- Dropped and re-added rather than "add ... not valid": this constraint only
-- ever widens, so every existing row already satisfies the new one, and a
-- VALIDATED constraint is worth more than a skipped scan on a table with
-- single-digit rows.
--
-- The old one is found BY WHAT IT SAYS, not by its name. 098 wrote it as an
-- inline column check, so Postgres named it, and a migration that guesses an
-- auto-generated name and guesses wrong does not fail - `drop constraint if
-- exists` skips quietly, the narrow constraint survives, and the first person
-- to upload a letter gets a check violation nobody can explain. Every check
-- on this table that still mentions the old four is dropped, whatever it is
-- called.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'legal.doc_template'::regclass
       and contype = 'c'
       and conname <> 'doc_template_kind_chk'
       and pg_get_constraintdef(oid) like '%vendor_contract%'
  loop
    execute format('alter table legal.doc_template drop constraint %I', c.conname);
    raise notice 'dropped the old doc_kind check (%)', c.conname;
  end loop;

  if not exists (select 1 from pg_constraint
                  where conname = 'doc_template_kind_chk'
                    and conrelid = 'legal.doc_template'::regclass) then
    alter table legal.doc_template add constraint doc_template_kind_chk
      check (doc_kind in ('vendor_contract', 'client_contract', 'nda',
                          'letter', 'model', 'other'));
  end if;
end $$;

-- And then PROVE it, rather than trust it. Two rows are inserted and rolled
-- back inside a subtransaction: if anything still refuses 'letter' or 'model'
-- this raises here, in the migration, instead of in front of whoever uploads
-- the first one.
do $$
declare ws uuid;
begin
  select id into ws from public.workspaces limit 1;
  if ws is null then
    raise notice 'no workspace to test the kinds against - skipping the check';
    return;
  end if;
  begin
    insert into legal.doc_template (workspace_id, doc_kind, name)
    values (ws, 'letter', '__probe__'), (ws, 'model', '__probe__');
    raise exception 'rollback the probe' using errcode = 'restrict_violation';
  exception
    when restrict_violation then null;
    when check_violation then
      raise exception 'legal: doc_kind still refuses letter/model - an old check survived';
  end;
end $$;

comment on column legal.doc_template.doc_kind is
  'vendor_contract is the influencer/UGC agreement - the key is historical, the label lives in lib/legal.ts DOC_KINDS.';

-- 2. the uploaded file --------------------------------------------

alter table legal.doc_template add column if not exists source_path  text;
alter table legal.doc_template add column if not exists source_name  text;
alter table legal.doc_template add column if not exists source_bytes bigint;
alter table legal.doc_template add column if not exists imported_at  timestamptz;

-- A path with no name, or a name with no path, is half an upload - which is
-- what a failed save between the storage write and the row update looks like.
-- Refusing it means the screen can trust that a template either HAS its
-- original or does not, with nothing in between to explain.
--
-- NOT VALID: every existing template predates uploading and has both null,
-- so the scan would pass, but there is no reason to take it.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'doc_template_source_chk'
                    and conrelid = 'legal.doc_template'::regclass) then
    alter table legal.doc_template add constraint doc_template_source_chk
      check (
        (source_path is null and source_name is null)
        or (source_path is not null and btrim(source_path) <> ''
            and source_name is not null and btrim(source_name) <> '')
      ) not valid;
  end if;
end $$;

comment on column legal.doc_template.source_path is
  'Object path of the uploaded .docx in the legal-templates bucket. Null when the template was typed rather than imported.';
comment on column legal.doc_template.source_name is
  'The file name as it was uploaded, so the download is called what she sent.';
comment on column legal.doc_template.imported_at is
  'When the .docx was read into blocks. Null for a template that was typed.';

-- 3. where the file lives -----------------------------------------
--
-- Private, and both policies require a signed-in caller: a template is AQ's
-- own wording and some carry bank details in their boilerplate. Reads go
-- through a signed URL the app asks for per download.
insert into storage.buckets (id, name, public)
values ('legal-templates', 'legal-templates', false)
on conflict (id) do nothing;

drop policy if exists "legal-templates read"   on storage.objects;
drop policy if exists "legal-templates write"  on storage.objects;
drop policy if exists "legal-templates update" on storage.objects;
drop policy if exists "legal-templates delete" on storage.objects;

create policy "legal-templates read" on storage.objects for select
  to authenticated using (bucket_id = 'legal-templates');
create policy "legal-templates write" on storage.objects for insert
  to authenticated with check (bucket_id = 'legal-templates');
create policy "legal-templates update" on storage.objects for update
  to authenticated using (bucket_id = 'legal-templates');
create policy "legal-templates delete" on storage.objects for delete
  to authenticated using (bucket_id = 'legal-templates');

-- Verify:
-- select unnest(enum_range(null)) ;  -- n/a, it is a check constraint:
-- select pg_get_constraintdef(oid) from pg_constraint
--  where conname = 'doc_template_kind_chk';                      -- 6 kinds
-- select count(*) from information_schema.columns
--  where table_schema='legal' and table_name='doc_template'
--    and column_name in ('source_path','source_name','source_bytes','imported_at'); -- 4
-- select id, public from storage.buckets where id='legal-templates';  -- false
