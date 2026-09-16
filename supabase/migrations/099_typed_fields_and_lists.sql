-- ============================================================
-- 099_typed_fields_and_lists.sql
-- "Legal chooses, it does not write." Turns the placeholder registry into a
-- TYPED field registry and adds the managed lists (dropdown enumerations) the
-- fields draw from. From the v1.0 template spec (see
-- claude/aq-legal-template-spec-v1.md):
--   * every recurring value is a managed list;
--   * numbers are direct entry within a min/max;
--   * free text is only names / ID numbers / IBANs.
--
-- This migration is the DATA MODEL only. The typed-field form, the managed-list
-- editor, and the contract-fill screen come as frontend on top of it. Write
-- access stays gated to owner/admin/legal here; per-department management
-- (finance owns tax lists, operations owns operational lists) is a later
-- permissions slice - owner_dept is stored now as metadata for it.
--
-- Idempotent. The 020/070 CI assertions already cover the `legal` schema (098),
-- so the two new tables are checked for RLS and over-grants automatically.
-- ============================================================

-- 1. placeholder -> typed field --------------------------------
alter table legal.placeholder
  add column if not exists field_type    text    not null default 'text',
  add column if not exists required      boolean not null default false,
  add column if not exists default_value text    not null default '',
  add column if not exists num_min       numeric,
  add column if not exists num_max       numeric,
  add column if not exists list_id       uuid,
  add column if not exists owner_dept    text    not null default 'legal';

alter table legal.placeholder drop constraint if exists placeholder_field_type_chk;
alter table legal.placeholder add constraint placeholder_field_type_chk
  check (field_type in ('text','number','date','list','auto'));

alter table legal.placeholder drop constraint if exists placeholder_owner_dept_chk;
alter table legal.placeholder add constraint placeholder_owner_dept_chk
  check (owner_dept in ('legal','finance','operations','admin'));

-- A number field's bounds must be ordered when both are set.
alter table legal.placeholder drop constraint if exists placeholder_num_range_chk;
alter table legal.placeholder add constraint placeholder_num_range_chk
  check (num_min is null or num_max is null or num_min <= num_max);

-- 2. managed lists (dropdown enumerations) ----------------------
create table if not exists legal.managed_list (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  name         text not null,
  owner_dept   text not null default 'legal' check (owner_dept in ('legal','finance','operations','admin')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, key)
);
create index if not exists idx_legal_mlist_ws on legal.managed_list(workspace_id);

create table if not exists legal.managed_list_value (
  id           uuid primary key default gen_random_uuid(),
  list_id      uuid not null references legal.managed_list(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  value        text not null,
  label        text not null default '',
  position     integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (list_id, value)
);
create index if not exists idx_legal_mlistval_list on legal.managed_list_value(list_id);

-- The field's source list, now that managed_list exists. A deleted list just
-- unsets the reference (the field falls back to free entry) rather than
-- cascading the field away.
alter table legal.placeholder drop constraint if exists placeholder_list_id_fkey;
alter table legal.placeholder add constraint placeholder_list_id_fkey
  foreign key (list_id) references legal.managed_list(id) on delete set null;

-- 3. updated_at -------------------------------------------------
drop trigger if exists trg_mlist_updated on legal.managed_list;
create trigger trg_mlist_updated before update on legal.managed_list
  for each row execute function public.update_updated_at();

-- 4. grants + RLS (owner/admin/legal, staff-only) ---------------
do $$
declare t text;
begin
  foreach t in array array['managed_list','managed_list_value']
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
