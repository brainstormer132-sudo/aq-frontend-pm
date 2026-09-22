-- ============================================================
-- 119_template_archive.sql
-- Retiring a template, because deleting one mostly cannot exist.
--
-- Siraj: "also we cant delete any templates." He is right, and there are
-- three separate reasons, only one of which is a missing button.
--
-- 1. THERE IS NO BUTTON. Nothing in the Documents screen or the editor ever
--    removed a template - the only delete in the editor is on a block.
-- 2. THE SCHEMA REFUSES. legal.contract.template_id and version_id are both
--    ON DELETE RESTRICT (100). A template any contract was ever made from
--    cannot be deleted at all, and that is the point: an issued contract has
--    to stay reproducible or its number and its fingerprint mean nothing.
-- 3. THE FREEZE REFUSES. 098's trigger says in as many words that a
--    published or archived version "cannot be deleted, only archived", and
--    doc_template_version cascades from doc_template - so deleting a template
--    that has ever been published trips it too.
--
-- So the honest verb is RETIRE, and the schema has used that word since 098.
--
-- -- WHY A COLUMN ON THE TEMPLATE, AND NOT status='archived' -----------
--
-- Two reasons the version status cannot carry this:
--
--   * A template with only a DRAFT version cannot be archived that way at
--     all. doc_tv_published_chk requires archived => published_at is not
--     null, and a draft has no publish date. The imported-by-mistake
--     template - the exact case somebody wants gone - is that template.
--   * Archiving every version is IRREVERSIBLE. 098: "an archived version is
--     final and cannot be changed". Retiring a template from a list should
--     not be a one-way door; getting it wrong should cost one more click.
--
-- A column on the template is reversible, works on a draft, and leaves the
-- freeze alone. Nothing here touches a version, a block or a contract:
-- archiving changes what is OFFERED, never what was issued. A contract
-- already stamped to this template reads exactly as it does today, forever.
-- ============================================================

set search_path = legal, public;

alter table legal.doc_template
  add column if not exists archived_at timestamptz;

alter table legal.doc_template
  add column if not exists archived_by uuid;

-- Every list on the Documents screen and every contract picker asks for the
-- live ones, so that is the index. Partial, because the archived tail is read
-- only when somebody opens the drawer.
create index if not exists idx_legal_doc_template_live
  on legal.doc_template(workspace_id, doc_kind)
  where archived_at is null;

-- A person with no date is half a write - what an interrupted archive looks
-- like - and it would read as live while naming who retired it. NOT VALID
-- because every existing row has both columns null and satisfies it anyway;
-- written this way to keep the same shape as 115/116/118.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'doc_template_archived_chk'
                    and conrelid = 'legal.doc_template'::regclass) then
    alter table legal.doc_template add constraint doc_template_archived_chk
      check (archived_by is null or archived_at is not null) not valid;
  end if;
end $$;

comment on column legal.doc_template.archived_at is
  'When this template was retired. Null means live. Retiring hides it from the Documents list and the new-contract picker and changes nothing else - no version, no block and no issued contract is touched, and it can be restored.';
comment on column legal.doc_template.archived_by is
  'Who retired it. Only meaningful when archived_at is set; the CHECK refuses one without the other.';

-- Prove it, rather than trust it ----------------------------------
do $$
declare
  ws    uuid;
  t     uuid;
  fired boolean;
begin
  select id into ws from public.workspaces limit 1;
  if ws is null then
    raise notice 'no workspace to probe against - skipping the checks';
    return;
  end if;

  begin
    insert into legal.doc_template (workspace_id, doc_kind, name)
    values (ws, 'other', '__probe_archive__') returning id into t;

    -- (a) a fresh template is live
    if (select archived_at from legal.doc_template where id = t) is not null then
      raise exception 'legal: a new template came out archived';
    end if;

    -- (b) it can be retired, and it can be brought back. The second half is
    --     the whole reason this is a column and not a version status.
    update legal.doc_template set archived_at = now() where id = t;
    if (select archived_at from legal.doc_template where id = t) is null then
      raise exception 'legal: archiving a template did not take';
    end if;
    update legal.doc_template set archived_at = null, archived_by = null where id = t;
    if (select archived_at from legal.doc_template where id = t) is not null then
      raise exception 'legal: an archived template could not be restored';
    end if;

    -- (c) somebody with no date is refused
    fired := false;
    begin
      update legal.doc_template set archived_by = gen_random_uuid() where id = t;
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: archived_by with no archived_at was accepted'; end if;

    -- (d) a draft-only template can be retired, which version status cannot do
    insert into legal.doc_template_version (template_id, workspace_id, version, status)
    values (t, ws, 1, 'draft');
    update legal.doc_template set archived_at = now() where id = t;
    if (select status from legal.doc_template_version where template_id = t) <> 'draft' then
      raise exception 'legal: archiving a template changed one of its versions';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: the template-archive rules all hold';
  end;
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='legal' and table_name='doc_template'
--       and column_name in ('archived_at','archived_by'))             as cols,
--   (select count(*) from pg_constraint
--     where conname='doc_template_archived_chk')                      as chk,
--   (select count(*) from pg_indexes
--     where schemaname='legal' and indexname='idx_legal_doc_template_live') as idx,
--   (select count(*) from legal.doc_template where archived_at is not null) as archived_now;
-- expected: 2 | 1 | 1 | 0
