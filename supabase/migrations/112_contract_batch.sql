-- ============================================================
-- 112_contract_batch.sql
-- A task: shared terms once, many vendors, one contract each.
--
-- Siraj: "make duration when creating the task and per task Ill add multiple
-- vendors so you need to fix that ... add a add multiple vendors and then i
-- edit them and add the vendor i want so it auto creates for example 100
-- contracts with the price the ad type and platform".
--
-- This is the shape the contract app already has. createSubtasksBulk
-- (public/contracts/app.js:1974) creates N rows carrying the ad type, price
-- and platforms they have in common and leaves the vendor blank, because a
-- campaign is booked before anybody knows which influencers will take it:
-- "I want to add 20 vendors at the same time and then edit later to add the
-- vendor name and data." The rows have to exist first and fill in as the
-- names come back.
--
-- A VENDOR CONTRACT IS ONE PER VENDOR (see 109 and row_source 'fields'), so
-- the batch is a grouping of contracts, not a contract listing vendors. What
-- is shared - brand, date, duration, price, ad type, platform - is COPIED onto
-- each contract's own fields at creation, not referenced. Two reasons:
--   * an issued contract's values are frozen and its fingerprint is over them;
--     a shared row that could still move would make the seal a lie.
--   * each contract is then editable on its own. Siraj expects exactly that:
--     the shared terms are a starting point, and one influencer who negotiated
--     a different price is edited on their own contract without touching the
--     other ninety-nine.
--
-- Idempotent. Run in staging, then prod. Then: notify pgrst.
-- ============================================================

set search_path = legal, public;

-- 1. the batch ----------------------------------------------------

create table if not exists legal.contract_batch (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text not null,
  -- What every contract in the batch was created with. Kept for the screen to
  -- show and to seed the next vendor added later; NOT the source of truth for
  -- any contract, which carries its own copy. See the header.
  shared       jsonb not null default '{}'::jsonb,
  version_id   uuid references legal.doc_template_version(id) on delete set null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_legal_batch_ws on legal.contract_batch(workspace_id, created_at desc);

alter table legal.contract_batch enable row level security;
grant select, insert, update, delete on legal.contract_batch to authenticated;
grant all on legal.contract_batch to service_role;

drop policy if exists contract_batch_rw on legal.contract_batch;
create policy contract_batch_rw on legal.contract_batch
  using (public.has_role(workspace_id, array['owner','admin','legal']))
  with check (public.has_role(workspace_id, array['owner','admin','legal']));

drop trigger if exists trg_batch_updated on legal.contract_batch;
create trigger trg_batch_updated before update on legal.contract_batch
  for each row execute function public.update_updated_at();

-- 2. which batch a contract belongs to ------------------------------
-- ON DELETE SET NULL: deleting the batch must never take signed contracts
-- with it. They stop being grouped; they do not stop existing.

alter table legal.contract
  add column if not exists batch_id uuid references legal.contract_batch(id) on delete set null;

create index if not exists idx_legal_contract_batch on legal.contract(batch_id)
  where batch_id is not null;

comment on column legal.contract.batch_id is
  'The task this contract was raised with. Null for a contract raised on its own.';

-- 3. create the batch and its contracts -----------------------------
--
-- SECURITY DEFINER because legal.* RLS is staff-only and this has to insert
-- into contract and contract_field in one go; the permission check is in the
-- body, not only on the grant (audit A1-A4).
--
-- p_batch_id null  -> create a new batch from p_title / p_shared.
-- p_batch_id given -> add p_count more contracts to that batch, using the
--                     batch's own stored shared values, so a vendor added a
--                     week later gets the same terms as the first ninety-nine.

create or replace function legal.create_contract_batch(
  p_workspace_id uuid,
  p_title        text,
  p_count        integer,
  p_shared       jsonb default '{}'::jsonb,
  p_version_id   uuid    default null,
  p_batch_id     uuid    default null
) returns uuid
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_batch  uuid;
  v_ver    uuid;
  v_tpl    uuid;
  v_shared jsonb;
  v_title  text;
  v_n      integer;
  v_start  integer;
  v_id     uuid;
  i        integer;
  k        text;
  v        text;
begin
  if auth.uid() is null
     or not public.has_role(p_workspace_id, array['owner','admin','legal']) then
    raise exception 'Only legal can raise a batch of contracts.' using errcode = '42501';
  end if;

  -- A hundred is the contract app's own ceiling (app.js:1986). It is not a
  -- performance limit so much as a typo limit: nobody means 1000.
  if p_count is null or p_count < 1 or p_count > 200 then
    raise exception 'How many? Between 1 and 200.' using errcode = '22023';
  end if;

  if p_batch_id is not null then
    select b.id, b.shared, b.version_id, b.title
      into v_batch, v_shared, v_ver, v_title
      from legal.contract_batch b
     where b.id = p_batch_id and b.workspace_id = p_workspace_id;
    if v_batch is null then
      raise exception 'No such task in this workspace.' using errcode = '42704';
    end if;
  else
    v_title := nullif(btrim(coalesce(p_title, '')), '');
    if v_title is null then
      raise exception 'A task needs a name.' using errcode = '22023';
    end if;
    v_shared := coalesce(p_shared, '{}'::jsonb);
    v_ver := p_version_id;
  end if;

  -- Which template version these contracts are stamped to. Resolved once for
  -- the whole batch: a hundred contracts in one task must be the same
  -- document, or the register cannot say what the task agreed to.
  if v_ver is null then
    -- Counted first: a plain SELECT INTO takes the first row and reports
    -- ROW_COUNT 1 even when several matched, so it would quietly pick one of
    -- two templates rather than saying the workspace is ambiguous.
    select count(*) into v_n
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'vendor_contract';
    if v_n = 0 then
      raise exception 'No published vendor contract template in this workspace.' using errcode = '42704';
    elsif v_n > 1 then
      raise exception 'More than one published vendor contract template (%); archive the ones you do not want, or pass a version id.', v_n
        using errcode = '21000';
    end if;
    select ver.id into v_ver
      from legal.doc_template_version ver
      join legal.doc_template t on t.id = ver.template_id
     where ver.workspace_id = p_workspace_id
       and ver.status = 'published'
       and t.doc_kind = 'vendor_contract';
  else
    if not exists (select 1 from legal.doc_template_version ver
                    where ver.id = v_ver
                      and ver.workspace_id = p_workspace_id
                      and ver.status = 'published') then
      raise exception 'That template version is not published in this workspace.' using errcode = '42501';
    end if;
  end if;

  select ver.template_id into v_tpl
    from legal.doc_template_version ver where ver.id = v_ver;

  if v_batch is null then
    insert into legal.contract_batch (workspace_id, title, shared, version_id, created_by)
    values (p_workspace_id, v_title, v_shared, v_ver, auth.uid())
    returning id into v_batch;
    v_start := 0;
  else
    -- Numbering continues rather than restarting, so "Rabea tea - 14" is the
    -- fourteenth contract in the task whenever it was added.
    select count(*) into v_start from legal.contract c where c.batch_id = v_batch;
    -- A later add must not silently stamp a different version than the first.
    update legal.contract_batch set version_id = coalesce(version_id, v_ver)
     where id = v_batch;
  end if;

  for i in 1 .. p_count loop
    insert into legal.contract (workspace_id, template_id, version_id, title, status, batch_id)
    values (p_workspace_id, v_tpl, v_ver,
            v_title || ' - ' || (v_start + i)::text, 'draft', v_batch)
    returning id into v_id;

    -- The shared terms, copied. Each contract owns its values from here.
    for k, v in select key, value #>> '{}' from jsonb_each(v_shared) loop
      if v is not null and v <> '' then
        insert into legal.contract_field (contract_id, workspace_id, key, value)
        values (v_id, p_workspace_id, k, v)
        on conflict (contract_id, key) do update set value = excluded.value;
      end if;
    end loop;
  end loop;

  return v_batch;
end;
$fn$;

revoke all on function legal.create_contract_batch(uuid, text, integer, jsonb, uuid, uuid) from public;
grant execute on function legal.create_contract_batch(uuid, text, integer, jsonb, uuid, uuid) to authenticated;
