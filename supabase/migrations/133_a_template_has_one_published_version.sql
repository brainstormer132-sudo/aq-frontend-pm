-- ============================================================
-- 133_a_template_has_one_published_version.sql
-- Publishing a version has never retired the one before it.
--
-- Found while checking why raising a vendor contract refused. The vendor
-- template has ONE template row and FOUR published versions - 5, 6, 7 and 8,
-- all published on 22 September - because `publish` in hooks/use-legal does
-- exactly one thing:
--
--   update doc_template_version set status='published' where id = <this one>
--
-- and nothing anywhere demotes the version it replaces. Versions 1 to 4 are
-- archived because somebody archived them by hand.
--
-- -- WHY THAT BROKE SOMETHING ELSE ENTIRELY ---------------------------
--
-- create_contract_from_booking (107) resolves the template by COUNTING the
-- published versions, and refuses when there is more than one:
--
--   'More than one published vendor contract template (%); archive the ones
--    you do not want, or pass a version id.'
--
-- That refusal is right - picking one of four wordings at random for a legal
-- document is worse than failing - but it means raising a vendor contract
-- from a campaign has been impossible since the second publish. Nobody found
-- it because the button that used it was the little-used "Draft", while the
-- button everybody pressed wrote a request to the contract app instead.
-- Migration 131 and 132 moved that button onto this path, which is how it
-- surfaced.
--
-- -- WHY A TRIGGER AND NOT A FIX IN THE BUTTON ------------------------
--
-- "At most one published version per template" is an invariant, not a step.
-- Written in the publish handler it holds only for callers who remember it,
-- and it is two statements - so two people publishing at once still leave
-- two published. In the database it holds for every path there will ever be,
-- including the SQL editor.
--
-- BEFORE, not AFTER, because the partial unique index below is checked as
-- each row is written: an AFTER trigger would demote the old version only
-- after the new one had already collided with it.
--
-- The index is the proof. The trigger is what makes the proof easy to
-- satisfy - publishing demotes, rather than failing and asking somebody to
-- go and tidy up first.
-- ============================================================

set search_path = legal, public;

-- 1. publishing retires the version it replaces --------------------
create or replace function legal.one_published_version() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
begin
  if new.status <> 'published' then
    return new;
  end if;
  -- Archived, not draft: the version being replaced WAS published, contracts
  -- were issued against it, and 098's check requires an archived row to keep
  -- its published_at. Sending it back to draft would also make its blocks
  -- editable again - rewriting the wording of contracts already signed.
  update legal.doc_template_version v
     set status = 'archived'
   where v.template_id = new.template_id
     and v.id <> new.id
     and v.status = 'published';
  return new;
end $fn$;

revoke all on function legal.one_published_version() from public, authenticated, anon;

-- 2. the four that are already standing ----------------------------
--
-- Keep the HIGHEST version number, archive the rest. Not the newest by
-- created_at: two versions published in the same minute have the same date
-- and no order, while the version number is the order the editor gave them.
do $$
declare n integer;
begin
  with keep as (
    select distinct on (template_id) id
      from legal.doc_template_version
     where status = 'published'
     order by template_id, version desc
  )
  update legal.doc_template_version v
     set status = 'archived'
   where v.status = 'published'
     and v.id not in (select id from keep);
  get diagnostics n = row_count;
  raise notice 'legal: archived % superseded published version(s)', n;
end $$;

-- 3. and it cannot happen again ------------------------------------
drop trigger if exists trg_one_published_version on legal.doc_template_version;
create trigger trg_one_published_version
  before insert or update on legal.doc_template_version
  for each row execute function legal.one_published_version();

create unique index if not exists legal_dtv_one_published
  on legal.doc_template_version (template_id)
  where status = 'published';

-- 4. prove it ------------------------------------------------------
--
-- Behaviourally, against a real template, rolled back. This one CAN be
-- exercised here - unlike a role check, it does not depend on who is running
-- it, which is the distinction 127 wrote down.
do $$
declare
  tpl   uuid;
  ws    uuid;
  old_v uuid;
  new_v uuid;
  n     integer;
begin
  select v.template_id, v.workspace_id, v.id into tpl, ws, old_v
    from legal.doc_template_version v
   where v.status = 'published'
   order by v.created_at desc limit 1;
  if tpl is null then
    raise notice 'legal: no published version to probe against - skipping';
    return;
  end if;

  begin
    insert into legal.doc_template_version
      (template_id, workspace_id, version, status, published_at)
    select tpl, ws, coalesce(max(version), 0) + 1, 'published', now()
      from legal.doc_template_version where template_id = tpl
    returning id into new_v;

    -- (a) exactly one published version survives
    select count(*) into n from legal.doc_template_version
     where template_id = tpl and status = 'published';
    if n <> 1 then
      raise exception 'legal: % published versions after publishing one more', n;
    end if;

    -- (b) and it is the new one
    if (select status from legal.doc_template_version where id = new_v) <> 'published' then
      raise exception 'legal: the version just published is not the published one';
    end if;

    -- (c) the one it replaced is archived, NOT deleted and NOT back to draft.
    --     Draft would make its blocks editable again - rewriting the wording
    --     of contracts already issued against it.
    if (select status from legal.doc_template_version where id = old_v) <> 'archived' then
      raise exception 'legal: the superseded version did not end up archived';
    end if;

    -- (d) publishing the SAME row twice is not a way to archive itself
    update legal.doc_template_version set status = 'published' where id = new_v;
    if (select status from legal.doc_template_version where id = new_v) <> 'published' then
      raise exception 'legal: re-publishing a version archived it';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: publishing a version retires the one before it, and only that one';
  end;
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select t.doc_kind, v.status, count(*) as versions
--   from legal.doc_template t
--   join legal.doc_template_version v on v.template_id = t.id
--  group by 1, 2 order by 1, 2;
-- vendor_contract / published must be exactly 1.
