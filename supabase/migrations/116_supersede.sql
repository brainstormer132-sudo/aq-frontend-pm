-- ============================================================
-- 116_supersede.sql
-- Correcting a contract that has already gone out.
--
-- Siraj asked for "an edit after issued". This is not that, and the
-- difference is the whole design.
--
-- -- WHY NOT AN EDIT --------------------------------------------------
--
-- An issued contract's field values freeze (100_contracts.sql). Three things
-- rest on that freeze and all three are load-bearing:
--
--   * the contract NUMBER, reserved at issue and never re-used (108),
--   * the SHA-256 FINGERPRINT, taken over the version and the values, which
--     is what lets anybody prove months later that the copy in their hand is
--     the copy that was issued,
--   * and the plain fact that a document a vendor signed says today what it
--     said the day they signed it.
--
-- Unlocking an issued contract so a value can be retyped destroys all three
-- at once and leaves no trace that it happened. The vendor's copy and ours
-- would disagree, and the fingerprint - the one thing that could have caught
-- it - would have been recomputed to match the new text. That is not a
-- correction; that is a quiet rewrite of a signed agreement.
--
-- -- WHAT THIS IS INSTEAD ---------------------------------------------
--
-- A CORRECTION is a NEW contract that records which contract it replaces and
-- why. The original keeps its number, keeps its fingerprint, stays issued and
-- stays readable. The correction takes its own number and its own
-- fingerprint. Printing either one says what happened: the correction says
-- what it replaces, the original says it was replaced.
--
-- This is how it works on paper, and it is the only version that is honest
-- when somebody asks in a year which document was in force in March.
--
-- -- THE ARROW IS WRITTEN AT BIRTH AND NEVER MOVES ---------------------
--
-- supersedes_id is set when the correction row is inserted and can never be
-- changed afterwards. That single rule does a surprising amount of work: it
-- makes a cycle impossible to construct (a row can only ever point at a row
-- that already existed), it stops a correction being re-aimed at a different
-- original after the fact, and it means the chain you read today is the chain
-- that was written.
-- ============================================================

set search_path = legal, public;

-- 1. the arrow ----------------------------------------------------
--
-- on delete restrict: the original can never be deleted out from under its
-- correction. Deleting is only allowed on a draft anyway and an original is
-- by definition not a draft, so this should never fire - which is exactly
-- when a constraint is worth having.
alter table legal.contract
  add column if not exists supersedes_id    uuid references legal.contract(id) on delete restrict,
  add column if not exists supersede_reason text;

create index if not exists idx_legal_contract_supersedes
  on legal.contract(supersedes_id) where supersedes_id is not null;

comment on column legal.contract.supersedes_id is
  'The contract this one replaces. Set at insert and immutable - see the trigger below.';
comment on column legal.contract.supersede_reason is
  'Why it was corrected, in the operator''s own words. Required whenever supersedes_id is set.';

-- 2. a correction says why ----------------------------------------
--
-- Not optional, and not defaultable. "Superseded" with no reason is a record
-- that something was changed and no record of what - which is worse than
-- nothing, because it looks like an answer. The two columns move together:
-- an arrow with no reason, or a reason with no arrow, is refused.
--
-- NOT VALID: every row predating this migration has both null and satisfies
-- it, but there is no reason to spend the scan to prove that.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'contract_supersede_chk'
                    and conrelid = 'legal.contract'::regclass) then
    alter table legal.contract add constraint contract_supersede_chk
      check (
        (supersedes_id is null and supersede_reason is null)
        or (supersedes_id is not null
            and supersede_reason is not null and btrim(supersede_reason) <> '')
      ) not valid;
  end if;

  -- A contract cannot replace itself. Cheap, and the kind of thing an
  -- honest bug (an id variable reused) produces on a Friday.
  if not exists (select 1 from pg_constraint
                  where conname = 'contract_supersede_self_chk'
                    and conrelid = 'legal.contract'::regclass) then
    alter table legal.contract add constraint contract_supersede_self_chk
      check (supersedes_id is null or supersedes_id <> id) not valid;
  end if;
end $$;

-- 3. one live correction per contract -----------------------------
--
-- Two corrections of the same contract, both issued, both with their own
-- number, is two documents each claiming to be the one that replaced it. The
-- partial index makes that unrepresentable.
--
-- `void` is excluded so an abandoned correction can be withdrawn and another
-- started. A correction still in draft can simply be deleted, which is what
-- the Register already allows for any draft.
create unique index if not exists idx_legal_contract_one_correction
  on legal.contract(supersedes_id)
  where supersedes_id is not null and status <> 'void';

-- 4. the rules a check constraint cannot express -------------------
--
-- Three of them need to look at another row, so they live in a trigger:
--
--   * the correction and its original are in the SAME workspace. Without
--     this, a workspace could point at a contract it cannot even read, and
--     the screen would render a replacement notice naming a document that
--     does not exist as far as this workspace is concerned.
--   * you cannot supersede a DRAFT. A draft is editable - correcting it is
--     just typing in it. Superseding one would burn a contract number to
--     replace a document that never went anywhere.
--   * supersedes_id is IMMUTABLE. See the header: this is what makes a cycle
--     unconstructible and the chain trustworthy.
create or replace function legal.enforce_supersede() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
declare
  v_ws     uuid;
  v_status text;
begin
  if tg_op = 'UPDATE' and new.supersedes_id is distinct from old.supersedes_id then
    raise exception
      'legal: what a contract supersedes is fixed when it is created and cannot be changed'
      using errcode = '22023';
  end if;

  if new.supersedes_id is null then
    return new;
  end if;

  select c.workspace_id, c.status into v_ws, v_status
    from legal.contract c where c.id = new.supersedes_id;

  if v_ws is null then
    raise exception 'legal: the contract being superseded does not exist'
      using errcode = '42704';
  end if;
  if v_ws <> new.workspace_id then
    raise exception 'legal: a contract can only supersede one in the same workspace'
      using errcode = '42501';
  end if;
  if v_status = 'draft' then
    raise exception
      'legal: that contract is still a draft - edit it rather than superseding it'
      using errcode = '22023';
  end if;

  return new;
end $fn$;

revoke all on function legal.enforce_supersede() from public, authenticated, anon;

drop trigger if exists trg_contract_supersede on legal.contract;
create trigger trg_contract_supersede
  before insert or update on legal.contract
  for each row execute function legal.enforce_supersede();

-- 5. prove it, rather than trust it -------------------------------
--
-- Four probes, all rolled back. A migration that says it added a rule and
-- did not is worse than one that failed, because the rule is only discovered
-- to be missing by the thing it was supposed to prevent.
do $$
declare
  ws    uuid;
  tpl   uuid;
  ver   uuid;
  a     uuid;
  b     uuid;
  fired boolean;
begin
  select id into ws from public.workspaces limit 1;
  select v.id, v.template_id into ver, tpl
    from legal.doc_template_version v
    join legal.doc_template t on t.id = v.template_id
   where t.workspace_id = ws limit 1;
  if ws is null or ver is null then
    raise notice 'no workspace or template version to probe against - skipping the checks';
    return;
  end if;

  begin
    insert into legal.contract (workspace_id, template_id, version_id, title, status)
    values (ws, tpl, ver, '__probe_original__', 'issued') returning id into a;

    -- (a) a correction with no reason is refused
    fired := false;
    begin
      insert into legal.contract (workspace_id, template_id, version_id, title, supersedes_id)
      values (ws, tpl, ver, '__probe_no_reason__', a);
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: a correction with no reason was accepted'; end if;

    -- (b) a proper correction is accepted
    insert into legal.contract (workspace_id, template_id, version_id, title,
                                supersedes_id, supersede_reason)
    values (ws, tpl, ver, '__probe_correction__', a, 'the fee was wrong')
    returning id into b;

    -- (c) a SECOND live correction of the same contract is refused
    fired := false;
    begin
      insert into legal.contract (workspace_id, template_id, version_id, title,
                                  supersedes_id, supersede_reason)
      values (ws, tpl, ver, '__probe_second__', a, 'again');
    exception when unique_violation then fired := true;
    end;
    if not fired then raise exception 'legal: a second live correction was accepted'; end if;

    -- (d) the arrow cannot be moved afterwards
    fired := false;
    begin
      update legal.contract set supersedes_id = null where id = b;
    exception when others then fired := true;
    end;
    if not fired then raise exception 'legal: supersedes_id was changed after the fact'; end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: supersede rules all hold';
  end;
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='legal' and table_name='contract'
--       and column_name in ('supersedes_id','supersede_reason'))            as columns,
--   (select count(*) from pg_constraint
--     where conrelid='legal.contract'::regclass
--       and conname in ('contract_supersede_chk','contract_supersede_self_chk')) as checks,
--   (select count(*) from pg_indexes
--     where schemaname='legal' and indexname='idx_legal_contract_one_correction') as one_arrow,
--   (select count(*) from pg_trigger
--     where tgrelid='legal.contract'::regclass and tgname='trg_contract_supersede') as trg,
--   (select count(*) from legal.contract where supersedes_id is not null)   as corrections;
-- expected: 2 | 2 | 1 | 1 | 0
