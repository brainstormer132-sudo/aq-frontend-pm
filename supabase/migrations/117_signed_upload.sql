-- ============================================================
-- 117_signed_upload.sql
-- The signed copy comes back on paper. Put it somewhere.
--
-- Siraj: "add an upload signed contract to each task in case its external and
-- not within the app."
--
-- Nothing in this app signs anything. A contract is issued, printed, emailed
-- or handed over, and it comes back signed as a scan or a photo from a phone.
-- Until now there was nowhere to put that, which had two consequences:
--
--   * the signed copy lived in somebody's email, and
--   * legal.contract.status has allowed 'signed' since migration 100 and
--     NOTHING HAS EVER SET IT. The KPI on the Cases screen says so out loud:
--     "Signed: 0 - not tracked yet, signing is not built."
--
-- This is the other half. Uploading the signed copy IS the act of signing as
-- far as this app is concerned, because the file is the evidence and a status
-- with no evidence behind it is a checkbox somebody ticked.
--
-- -- THE INVARIANT ----------------------------------------------------
--
-- A contract is `signed` IF AND ONLY IF it has a signed file.
--
-- Both directions, as one CHECK. Without the forward direction you get a
-- contract marked signed with nothing to show for it - which is exactly the
-- state somebody will point at in a dispute. Without the reverse you get a
-- signed copy sitting in storage against a contract the register still calls
-- issued, so the checklist misses it.
--
-- Removing the file puts the contract back to `issued`, and that is not a
-- loophole: it is the only honest thing to do if the wrong file went up.
--
-- -- WHAT SIGNING DOES NOT DO -----------------------------------------
--
-- It does not unfreeze anything. The field values froze at issue (100) and
-- stay frozen; the fingerprint still covers what was issued; the number is
-- unchanged. A signed contract is an issued contract with its counterpart
-- attached. If the content is wrong, that is a correction (116), and a
-- correction can be signed in its turn.
-- ============================================================

set search_path = legal, public;

-- 1. the counterpart ----------------------------------------------
--
-- signed_on is the date ON THE DOCUMENT, which is the date that matters in a
-- dispute and is frequently not the day it was scanned. signed_recorded_at is
-- when it landed here. Keeping both means "we received it late" is visible
-- rather than quietly rewritten.
alter table legal.contract
  add column if not exists signed_path         text,
  add column if not exists signed_name         text,
  add column if not exists signed_bytes        bigint,
  add column if not exists signed_on           date,
  add column if not exists signed_recorded_at  timestamptz,
  add column if not exists signed_by           uuid;

comment on column legal.contract.signed_path is
  'Object path of the signed counterpart in the legal-signed bucket. Null unless status = signed.';
comment on column legal.contract.signed_on is
  'The date written on the signed document - not the day it was uploaded. See signed_recorded_at for that.';

-- 2. signed if and only if there is a signed copy -----------------
--
-- VALIDATED, not NOT VALID. Every existing row has status <> 'signed' and a
-- null path (nothing has ever set either), so the scan passes; and this is
-- the constraint the whole feature rests on, so it is worth proving against
-- the rows that are already there rather than only the ones to come.
--
-- A path with no name is half an upload - what a failure between the storage
-- write and the row update looks like - so those move together too.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'contract_signed_chk'
                    and conrelid = 'legal.contract'::regclass) then
    alter table legal.contract add constraint contract_signed_chk
      check (
        (signed_path is null and signed_name is null and status <> 'signed')
        or (signed_path is not null and btrim(signed_path) <> ''
            and signed_name is not null and btrim(signed_name) <> ''
            and status = 'signed')
      );
  end if;
end $$;

-- 3. you can only sign what was issued ----------------------------
--
-- A draft has no contract number and no fingerprint: both are taken at issue
-- (108, and the seal in lib/legal). Letting a draft jump straight to `signed`
-- would produce a signed agreement with no number on its face and nothing to
-- verify it against - and because the fields freeze on leaving draft, there
-- would be no way back to fix it.
--
-- Void is refused for the obvious reason: a withdrawn contract that somebody
-- then signs is a contradiction somebody has to resolve by hand, and it is
-- better resolved before the file is filed than after.
create or replace function legal.enforce_signed() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
begin
  if new.status = 'signed' and coalesce(old.status, 'draft') <> 'signed' then
    if old.status is distinct from 'issued' then
      raise exception
        'legal: only an issued contract can be signed (this one is %)', coalesce(old.status, 'new')
        using errcode = '22023';
    end if;
    if new.contract_no is null then
      raise exception 'legal: that contract has no number, so it was never properly issued'
        using errcode = '22023';
    end if;
    new.signed_recorded_at := coalesce(new.signed_recorded_at, now());
  end if;

  -- Unfiling the copy puts the contract back where it was. Narrowly: only
  -- when a path that WAS there is being cleared.
  --
  -- The first version of this fired on any row where the path was null and
  -- the status was signed, which quietly rewrote `status = 'signed'` with no
  -- file back to 'issued' - and so swallowed the exact case the CHECK above
  -- exists to refuse. The migration's own probe caught it. A trigger that
  -- silently corrects a caller instead of refusing it hides the caller's bug,
  -- which is worse than either outcome on its own.
  if old.signed_path is not null and new.signed_path is null then
    if new.status = 'signed' then new.status := 'issued'; end if;
    new.signed_name := null;
    new.signed_bytes := null;
    new.signed_on := null;
    new.signed_recorded_at := null;
    new.signed_by := null;
  end if;

  return new;
end $fn$;

revoke all on function legal.enforce_signed() from public, authenticated, anon;

drop trigger if exists trg_contract_signed on legal.contract;
create trigger trg_contract_signed
  before update on legal.contract
  for each row execute function legal.enforce_signed();

-- 4. where the file lives -----------------------------------------
--
-- PRIVATE, and every policy requires a signed-in caller. A signed contract
-- carries both parties' signatures, a fee, and frequently an IBAN. Reads go
-- through a signed URL the app asks for per download, the same way the
-- template bucket in 115 works.
insert into storage.buckets (id, name, public)
values ('legal-signed', 'legal-signed', false)
on conflict (id) do nothing;

drop policy if exists "legal-signed read"   on storage.objects;
drop policy if exists "legal-signed write"  on storage.objects;
drop policy if exists "legal-signed update" on storage.objects;
drop policy if exists "legal-signed delete" on storage.objects;

create policy "legal-signed read" on storage.objects for select
  to authenticated using (bucket_id = 'legal-signed');
create policy "legal-signed write" on storage.objects for insert
  to authenticated with check (bucket_id = 'legal-signed');
create policy "legal-signed update" on storage.objects for update
  to authenticated using (bucket_id = 'legal-signed');
create policy "legal-signed delete" on storage.objects for delete
  to authenticated using (bucket_id = 'legal-signed');

-- 5. prove it, rather than trust it -------------------------------
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
    raise notice 'no workspace or template version to probe against - skipping the checks';
    return;
  end if;

  begin
    insert into legal.contract (workspace_id, template_id, version_id, title, status)
    values (ws, tpl, ver, '__probe_signed__', 'draft') returning id into a;

    -- (a) a draft cannot be signed, however the file arrives
    fired := false;
    begin
      update legal.contract
         set status = 'signed', signed_path = 'x/y.pdf', signed_name = 'y.pdf'
       where id = a;
    exception when others then fired := true;
    end;
    if not fired then raise exception 'legal: a draft was allowed to be signed'; end if;

    -- (b) signed with no file is refused
    update legal.contract set status = 'issued', contract_no = '__probe__' where id = a;
    fired := false;
    begin
      update legal.contract set status = 'signed' where id = a;
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: signed with no file was accepted'; end if;

    -- (c) a file with no signed status is refused
    fired := false;
    begin
      update legal.contract set signed_path = 'x/y.pdf', signed_name = 'y.pdf' where id = a;
    exception when check_violation then fired := true;
    end;
    if not fired then raise exception 'legal: a signed file was accepted on an issued contract'; end if;

    -- (d) the pair together is accepted, and stamps when it was filed
    update legal.contract
       set status = 'signed', signed_path = 'x/y.pdf', signed_name = 'y.pdf'
     where id = a;
    if (select signed_recorded_at from legal.contract where id = a) is null then
      raise exception 'legal: filing a signed copy did not record when';
    end if;

    -- (e) clearing the path puts it back to issued
    update legal.contract set signed_path = null where id = a;
    if (select status from legal.contract where id = a) <> 'issued' then
      raise exception 'legal: removing the signed copy left it marked signed';
    end if;

    raise exception 'rollback the probes' using errcode = 'restrict_violation';
  exception
    when restrict_violation then
      raise notice 'legal: the signed-copy rules all hold';
  end;
end $$;

-- Verify (paste this after running the migration):
-- select
--   (select count(*) from information_schema.columns
--     where table_schema='legal' and table_name='contract'
--       and column_name like 'signed%')                                   as columns,
--   (select count(*) from pg_constraint
--     where conrelid='legal.contract'::regclass
--       and conname = 'contract_signed_chk')                              as chk,
--   (select count(*) from pg_trigger
--     where tgrelid='legal.contract'::regclass and tgname='trg_contract_signed') as trg,
--   (select public from storage.buckets where id='legal-signed')          as bucket_public,
--   (select count(*) from legal.contract where status = 'signed')         as signed_now;
-- expected: 6 | 1 | 1 | false | 0
