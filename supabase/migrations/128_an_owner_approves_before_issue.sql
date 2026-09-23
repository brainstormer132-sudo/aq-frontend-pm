-- ============================================================
-- 128_an_owner_approves_before_issue.sql
-- Nothing is issued until an owner has said so.
--
-- Siraj: "contract needs to be signed by owners", and asked whether that
-- meant an approval step or a signature line on the paper, he chose BOTH.
-- This is the first half. The signature line is the second.
--
-- -- WHY A COLUMN AND A TRIGGER, NOT A CONVENTION --------------------
--
-- Issuing is the moment a draft becomes the agreement: the number is taken,
-- the values freeze (100), the fingerprint seals what was issued, and nothing
-- afterwards can change any of it without a correction (116). A rule that
-- important cannot live in a button's disabled state, because the button is
-- not what issues the contract - an update to legal.contract is, and anybody
-- with legal's role can write one.
--
-- -- THE PART THAT IS EASY TO MISS -----------------------------------
--
-- An approval has to be INVALIDATED BY ANY CHANGE. Otherwise the sequence
--
--     owner approves  ->  somebody edits the fee  ->  somebody issues
--
-- produces a contract the owner approved the wrong version of, with the
-- owner's name on the approval and nobody aware anything happened. So a
-- change to a draft's field values clears the approval and it has to be given
-- again.
--
-- "A change" means a value that ACTUALLY DIFFERS. The issue path itself
-- re-saves every field on its way out (see `persist` then `issue` in
-- hooks/use-legal), so clearing on any write at all would mean a contract
-- could never be issued: approving it and pressing Issue would clear the very
-- approval the trigger is about to check, one statement earlier.
--
-- Three keys are exempt, and each for a reason:
--
--   __aq_fingerprint  the seal, computed at issue, AFTER approval
--   __aq_issued_at    stamped at issue, same
--   id                the contract number, taken by reserve_contract_number
--                     at issue. The owner approved a draft knowing it had no
--                     number yet; the number arriving is not a change they
--                     need to look at again. It is not typed either - the
--                     fill screen says so and the register assigns it.
--
-- -- WHO APPROVES ----------------------------------------------------
--
-- OWNER ONLY. Not admin, and not legal. Siraj's words were "signed by
-- owners", and an approval that a second role can also give is not the
-- control he asked for - it is a formality with a wider door.
--
-- If that turns out to be too narrow in practice it is one word in
-- `array['owner']` below, and worth changing deliberately rather than
-- guessing now.
-- ============================================================

set search_path = legal, public;

-- 1. who approved, and when ----------------------------------------
alter table legal.contract
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

comment on column legal.contract.approved_at is
  'When an owner approved this draft for issue. Cleared by any change to the contract fields - see trg_contract_field_unapproves. Null means it cannot be issued.';
comment on column legal.contract.approved_by is
  'The owner who approved it. May be null where the approval came from a call with no JWT; the approval itself is approved_at.';

-- An actor without an approval is impossible; an approval with no named actor
-- is a real state - the same reasoning migration 120 wrote down for
-- deleted_by, after "both or neither" turned out to throw on every call where
-- auth.uid() is null rather than recording an unnamed one.
alter table legal.contract drop constraint if exists contract_approved_chk;
alter table legal.contract
  add constraint contract_approved_chk
  check (approved_by is null or approved_at is not null);

-- 2. the gate ------------------------------------------------------
create or replace function legal.enforce_approved() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
begin
  if new.status = 'issued' and coalesce(old.status, 'draft') <> 'issued' then
    if new.approved_at is null then
      raise exception
        'legal: this contract has not been approved by an owner, so it cannot be issued'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $fn$;

revoke all on function legal.enforce_approved() from public, authenticated, anon;

drop trigger if exists trg_contract_approved on legal.contract;
create trigger trg_contract_approved
  before update on legal.contract
  for each row execute function legal.enforce_approved();

-- 3. a change un-approves ------------------------------------------
--
-- On legal.contract_field, not on legal.contract: the values are what an
-- owner is approving, and they live in the child table.
create or replace function legal.unapprove_on_field_change() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
declare
  v_key    text := coalesce(new.key, old.key);
  v_cid    uuid := coalesce(new.contract_id, old.contract_id);
  v_status text;
begin
  -- Written BY the issue path, after the approval it would otherwise clear.
  if v_key in ('__aq_fingerprint', '__aq_issued_at', 'id') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- An upsert that writes the same value back is not a change. The issue
  -- path re-saves every field on its way out, so without this a contract
  -- could never be issued at all.
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return new;
  end if;

  select status into v_status from legal.contract where id = v_cid;
  -- Only a draft can be un-approved. An issued contract's fields are frozen
  -- by 100 anyway, and a cascade delete of its fields must not try to write
  -- to a row that is on its way out.
  if v_status = 'draft' then
    update legal.contract
       set approved_at = null, approved_by = null
     where id = v_cid and approved_at is not null;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $fn$;

revoke all on function legal.unapprove_on_field_change() from public, authenticated, anon;

drop trigger if exists trg_contract_field_unapproves on legal.contract_field;
create trigger trg_contract_field_unapproves
  after insert or update or delete on legal.contract_field
  for each row execute function legal.unapprove_on_field_change();

-- 4. giving and taking back the approval ---------------------------
--
-- SECURITY DEFINER because the role check is the point, and `legal` may
-- update a contract through RLS without being allowed to approve one.
create or replace function legal.approve_contract(p_contract_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = legal, public, pg_temp
as $$
declare
  v_ws     uuid;
  v_status text;
  v_at     timestamptz;
begin
  select workspace_id, status into v_ws, v_status
    from legal.contract where id = p_contract_id;
  if v_ws is null then
    raise exception 'legal: no such contract' using errcode = '22023';
  end if;
  if not public.has_role(v_ws, array['owner']) then
    raise exception 'legal: only an owner can approve a contract for issue'
      using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'legal: only a draft can be approved (this one is %)', v_status
      using errcode = '22023';
  end if;

  update legal.contract
     set approved_at = now(), approved_by = auth.uid()
   where id = p_contract_id
   returning approved_at into v_at;

  return v_at;
end;
$$;

create or replace function legal.unapprove_contract(p_contract_id uuid)
returns integer
language plpgsql
security definer
set search_path = legal, public, pg_temp
as $$
declare
  v_ws uuid;
  v_n  integer;
begin
  select workspace_id into v_ws from legal.contract where id = p_contract_id;
  if v_ws is null then
    return 0;
  end if;
  if not public.has_role(v_ws, array['owner']) then
    raise exception 'legal: only an owner can take back an approval'
      using errcode = '42501';
  end if;
  -- Only while it is still a draft. Taking the approval off an ISSUED
  -- contract would leave a document that exists, carries a number and a
  -- fingerprint, and claims nobody approved it - which is a worse record than
  -- either state on its own. An issued contract is corrected (116), not
  -- un-approved.
  update legal.contract
     set approved_at = null, approved_by = null
   where id = p_contract_id and status = 'draft' and approved_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function legal.approve_contract(uuid)   from public, anon;
revoke all on function legal.unapprove_contract(uuid) from public, anon;
grant execute on function legal.approve_contract(uuid)   to authenticated, service_role;
grant execute on function legal.unapprove_contract(uuid) to authenticated, service_role;

-- 5. prove it, rather than trust it --------------------------------
--
-- The role check cannot be exercised here - there is no JWT in the SQL
-- editor, so has_role is false and approve_contract would refuse whoever runs
-- this. Asserting that refusal would be a test of who ran the migration, not
-- of the code (the lesson 127 wrote down).
--
-- What IS exercised, against real rows and then rolled back, is everything
-- the role check is not: the gate, the un-approval, and the three exempt
-- keys - because the exemption is the part that would silently make issuing
-- impossible, and it would do so for every contract at once.
do $$
declare
  ws    uuid;
  tpl   uuid;
  ver   uuid;
  a     uuid;
  fired boolean;
begin
  select id into ws from public.workspaces limit 1;
  select v.id, v.template_id into ver, tpl
    from legal.doc_template_version v
    join legal.doc_template t on t.id = v.template_id
   where t.workspace_id = ws limit 1;
  if ws is null or ver is null then
    raise notice 'legal: no workspace or template version to probe against - skipping the checks';
    return;
  end if;

  begin
    insert into legal.contract (workspace_id, template_id, version_id, title, status)
    values (ws, tpl, ver, '__probe_approval__', 'draft') returning id into a;

    -- (a) an unapproved draft cannot be issued
    fired := false;
    begin
      update legal.contract set status = 'issued', contract_no = '__probe__' where id = a;
    exception when others then fired := true;
    end;
    if not fired then raise exception 'legal: an unapproved draft was issued'; end if;

    -- (b) approved, it can
    update legal.contract set approved_at = now() where id = a;
    update legal.contract set status = 'issued', contract_no = '__probe__' where id = a;
    if (select status from legal.contract where id = a) <> 'issued' then
      raise exception 'legal: an approved draft could not be issued';
    end if;

    -- (c) a field change on a DRAFT clears the approval
    update legal.contract set status = 'draft' where id = a;
    update legal.contract set approved_at = now(), approved_by = null where id = a;
    insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (a, ws, 'probe_field', 'one');
    if (select approved_at from legal.contract where id = a) is not null then
      raise exception 'legal: editing a draft did not clear its approval';
    end if;

    -- (d) ...and a real edit to an existing field does too
    update legal.contract set approved_at = now() where id = a;
    update legal.contract_field set value = 'two' where contract_id = a and key = 'probe_field';
    if (select approved_at from legal.contract where id = a) is not null then
      raise exception 'legal: changing a field did not clear the approval';
    end if;

    -- (e) THE ONE THAT WOULD BREAK EVERYTHING: writing the SAME value back
    --     is not a change, and the three keys the issue path writes are
    --     exempt. Without this, pressing Issue clears the approval one
    --     statement before the gate checks it, and nothing can ever be
    --     issued again.
    update legal.contract set approved_at = now() where id = a;
    update legal.contract_field set value = 'two' where contract_id = a and key = 'probe_field';
    if (select approved_at from legal.contract where id = a) is null then
      raise exception 'legal: re-saving an unchanged value cleared the approval';
    end if;

    insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (a, ws, '__aq_fingerprint', 'deadbeef'), (a, ws, '__aq_issued_at', 'now'), (a, ws, 'id', 'AQ-1');
    if (select approved_at from legal.contract where id = a) is null then
      raise exception 'legal: the number or the seal cleared the approval';
    end if;

    -- (f) and with the approval still standing, it issues
    update legal.contract set status = 'issued' where id = a;
    if (select status from legal.contract where id = a) <> 'issued' then
      raise exception 'legal: the full issue path did not go through';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: approval gates issue, a change clears it, and the issue path survives it';
  end;
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='legal' and table_name='contract'
--       and column_name in ('approved_by','approved_at'))                 as columns,
--   (select count(*) from pg_trigger where tgrelid='legal.contract'::regclass
--     and tgname='trg_contract_approved')                                 as gate,
--   (select count(*) from pg_trigger where tgrelid='legal.contract_field'::regclass
--     and tgname='trg_contract_field_unapproves')                         as unapproves,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname in
--       ('approve_contract','unapprove_contract'))                        as functions,
--   (select count(*) from legal.contract where approved_at is not null)   as approved_now
-- expected: 2 | 1 | 1 | 2 | 0
