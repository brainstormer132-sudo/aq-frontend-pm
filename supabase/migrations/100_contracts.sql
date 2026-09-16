-- ============================================================
-- 100_contracts.sql
-- Contract instances: a contract is created FROM a published template version
-- and carries the filled-in field values. The New-Contract screen
-- reads the version's blocks, shows only the fields to fill, and writes their
-- values here. The contract is stamped with the EXACT version_id, so the
-- issued document is reproducible even after the template moves on.
--
--   * legal.contract        - one row per contract, stamped to a version.
--   * legal.contract_field  - the filled value per field key (unique per key).
--
-- A contract's field values are editable only while it is a `draft`; once it is
-- issued/signed they freeze (a signed document must not silently change). The
-- version it points at cannot be deleted (on delete restrict) so an issued
-- contract's source is never pulled out from under it.
--
-- Access stays owner/admin/legal (the legal section). The v1.0 spec wants
-- operations/finance to create contracts too - that broadening is the later
-- granular-permissions slice. Idempotent; 020/070 CI assertions already cover
-- the legal schema so these tables are checked automatically.
-- ============================================================

-- 1. contract ---------------------------------------------------
create table if not exists legal.contract (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  template_id  uuid not null references legal.doc_template(id) on delete restrict,
  version_id   uuid not null references legal.doc_template_version(id) on delete restrict,
  title        text not null default '',
  status       text not null default 'draft' check (status in ('draft','issued','signed','void')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_legal_contract_ws on legal.contract(workspace_id);
create index if not exists idx_legal_contract_tpl on legal.contract(template_id);
create index if not exists idx_legal_contract_ver on legal.contract(version_id);

create table if not exists legal.contract_field (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references legal.contract(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  value        text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (contract_id, key)
);
create index if not exists idx_legal_contract_field_c on legal.contract_field(contract_id);

-- 2. freeze: a non-draft contract's field values are immutable -----
create or replace function legal.enforce_contract_freeze() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
declare v_status text;
begin
  select status into v_status from legal.contract
    where id = coalesce(new.contract_id, old.contract_id);
  -- v_status NULL means the parent contract is itself being deleted (this row
  -- change is the ON DELETE CASCADE of its fields) - allow it. Only a live,
  -- non-draft contract freezes its fields.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'legal: the fields of a % contract are frozen', v_status;
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $fn$;

drop trigger if exists trg_contract_field_freeze on legal.contract_field;
create trigger trg_contract_field_freeze
  before insert or update or delete on legal.contract_field
  for each row execute function legal.enforce_contract_freeze();

-- 3. updated_at -------------------------------------------------
drop trigger if exists trg_contract_updated on legal.contract;
create trigger trg_contract_updated before update on legal.contract
  for each row execute function public.update_updated_at();
drop trigger if exists trg_contract_field_updated on legal.contract_field;
create trigger trg_contract_field_updated before update on legal.contract_field
  for each row execute function public.update_updated_at();

-- 4. grants + RLS (owner/admin/legal, staff-only) ---------------
do $$
declare t text;
begin
  foreach t in array array['contract','contract_field']
  loop
    execute format('alter table legal.%I enable row level security', t);
    execute format('grant select, insert, update, delete on legal.%I to authenticated', t);
    execute format('grant all on legal.%I to service_role', t);
    execute format('drop policy if exists %I on legal.%I', t || '_rw', t);
    execute format(
      'create policy %I on legal.%I for all to authenticated '
      'using (public.has_role(workspace_id, array[''owner'',''admin'',''legal''])) '
      'with check (public.has_role(workspace_id, array[''owner'',''admin'',''legal'']))',
      t || '_rw', t);
  end loop;
end $$;
