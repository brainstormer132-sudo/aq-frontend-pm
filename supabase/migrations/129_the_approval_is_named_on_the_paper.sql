-- ============================================================
-- 129_the_approval_is_named_on_the_paper.sql
-- The owner's name, frozen at the moment they approved it.
--
-- Siraj asked for "contract needs to be signed by owners" and chose BOTH: an
-- approval step in the app, and a signature line on the paper. 128 built the
-- step. This is what the paper needs from the database.
--
-- -- WHY A STORED NAME AND NOT A JOIN --------------------------------
--
-- 128 records approved_by as a uuid. A printed contract cannot carry a uuid,
-- so the name has to come from somewhere - and the obvious somewhere is a
-- join to public.profiles at print time. That is wrong, twice over:
--
--   1. A profile is EDITABLE. Somebody renames themselves, or an admin
--      corrects a spelling, and every contract that person ever approved
--      reprints under the new name. A document that changes what it says
--      about a past act is not a record of it.
--
--   2. People LEAVE. A profile row can be deleted, and then a reprint of a
--      contract that was properly approved in April prints an approval line
--      with nobody on it - or, worse, "Former member" - on a document that
--      is in force.
--
-- The name on a legal document is the name that was true when the act
-- happened. So it is copied into the contract row at approval time and never
-- touched again. This is the same reasoning as the fingerprint: the record is
-- of a moment, and a moment does not get to be re-derived later.
--
-- -- AND WHY IT MUST BE CLEARED TOGETHER WITH THE REST ---------------
--
-- Three places take an approval away - unapprove_contract, the field-change
-- trigger from 128, and nothing else. If any one of them forgets the name,
-- the row ends up saying "not approved" while still carrying the name of the
-- person who approved the version that no longer exists, and the next
-- approval by somebody else would print the wrong name if the write ever
-- raced. The CHECK constraint below makes forgetting it impossible rather
-- than merely discouraged.
-- ============================================================

set search_path = legal, public;

-- 1. the column ----------------------------------------------------
alter table legal.contract
  add column if not exists approved_name text;

comment on column legal.contract.approved_name is
  'The approving owner''s name AS IT WAS when they approved, copied from their profile by approve_contract. Printed on the contract. Never re-derived: a renamed or deleted profile must not change what an issued document says.';

-- 2. it cannot outlive the approval --------------------------------
alter table legal.contract drop constraint if exists contract_approved_chk;
alter table legal.contract
  add constraint contract_approved_chk
  check (
    (approved_by is null or approved_at is not null)
    and (approved_name is null or approved_at is not null)
  );

-- 3. approving copies the name -------------------------------------
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
  v_uid    uuid := auth.uid();
  v_name   text;
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

  -- Blank rather than null is what profiles.full_name defaults to (see
  -- lib/profile), so an empty name is stored as NULL and the paper prints a
  -- signing line with no name on it - which is honest - rather than a line
  -- with an empty string pretending to be one.
  if v_uid is not null then
    select nullif(btrim(coalesce(full_name, '')), '') into v_name
      from public.profiles where id = v_uid;
  end if;

  update legal.contract
     set approved_at = now(), approved_by = v_uid, approved_name = v_name
   where id = p_contract_id
   returning approved_at into v_at;

  return v_at;
end;
$$;

-- 4. taking it back takes the name too -----------------------------
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
  update legal.contract
     set approved_at = null, approved_by = null, approved_name = null
   where id = p_contract_id and status = 'draft' and approved_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function legal.approve_contract(uuid)   from public, anon;
revoke all on function legal.unapprove_contract(uuid) from public, anon;
grant execute on function legal.approve_contract(uuid)   to authenticated, service_role;
grant execute on function legal.unapprove_contract(uuid) to authenticated, service_role;

-- 5. and so does a change to the draft -----------------------------
--
-- Identical to 128 apart from the one added column. Repeated in full rather
-- than patched, because a trigger function is replaced whole and a reader
-- comparing 128 with 129 should see the difference, not have to reconstruct
-- it.
create or replace function legal.unapprove_on_field_change() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
declare
  v_key    text := coalesce(new.key, old.key);
  v_cid    uuid := coalesce(new.contract_id, old.contract_id);
  v_status text;
begin
  if v_key in ('__aq_fingerprint', '__aq_issued_at', 'id') then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return new;
  end if;

  select status into v_status from legal.contract where id = v_cid;
  if v_status = 'draft' then
    update legal.contract
       set approved_at = null, approved_by = null, approved_name = null
     where id = v_cid and approved_at is not null;
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $fn$;

revoke all on function legal.unapprove_on_field_change() from public, authenticated, anon;

drop trigger if exists trg_contract_field_unapproves on legal.contract_field;
create trigger trg_contract_field_unapproves
  after insert or update or delete on legal.contract_field
  for each row execute function legal.unapprove_on_field_change();

-- 6. prove it ------------------------------------------------------
--
-- The role check is not exercised, for the reason 127 and 128 both wrote
-- down: there is no JWT in the SQL editor, so the result would depend on who
-- ran the migration rather than on the code. What is exercised is the part
-- that would put a wrong name on a real document.
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
    values (ws, tpl, ver, '__probe_approved_name__', 'draft') returning id into a;

    -- (a) a name with no approval behind it cannot be stored at all
    fired := false;
    begin
      update legal.contract set approved_name = 'Nobody' where id = a;
    exception when others then fired := true;
    end;
    if not fired then
      raise exception 'legal: a contract carried an approver name with no approval';
    end if;

    -- (b) a change to the draft clears the NAME, not only the timestamp
    update legal.contract
       set approved_at = now(), approved_name = 'Siraj Qurunfulah' where id = a;
    insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (a, ws, 'probe_field', 'one');
    if (select approved_name from legal.contract where id = a) is not null then
      raise exception 'legal: editing a draft left the approver name on the row';
    end if;

    -- (c) and the three exempt keys still do not clear it, so the name
    --     survives the issue path that writes them
    update legal.contract
       set approved_at = now(), approved_name = 'Siraj Qurunfulah' where id = a;
    insert into legal.contract_field (contract_id, workspace_id, key, value)
    values (a, ws, '__aq_fingerprint', 'deadbeef'), (a, ws, 'id', 'AQ-1');
    if (select approved_name from legal.contract where id = a) is null then
      raise exception 'legal: the seal or the number cleared the approver name';
    end if;

    -- (d) end to end: it issues, and the name is still on it afterwards
    update legal.contract set status = 'issued', contract_no = '__probe__' where id = a;
    if (select approved_name from legal.contract where id = a
         and status = 'issued') is null then
      raise exception 'legal: the name did not survive being issued';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: the approver name is stored, cleared with the approval, and survives issue';
  end;
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='legal' and table_name='contract'
--       and column_name='approved_name')                                  as name_column,
--   (select count(*) from pg_constraint
--     where conrelid='legal.contract'::regclass
--       and conname='contract_approved_chk'
--       and pg_get_constraintdef(oid) like '%approved_name%')             as chk_covers_name,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname='approve_contract'
--       and pg_get_functiondef(p.oid) like '%approved_name%')             as approve_sets_it,
--   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='legal' and p.proname in
--       ('unapprove_contract','unapprove_on_field_change')
--       and pg_get_functiondef(p.oid) like '%approved_name = null%')      as clears_it,
--   (select count(*) from legal.contract where approved_name is not null) as named_now
-- expected: 1 | 1 | 1 | 2 | 0
