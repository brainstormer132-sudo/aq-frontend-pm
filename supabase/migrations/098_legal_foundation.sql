-- ============================================================
-- 098_legal_foundation.sql
-- Foundation for the in-app legal system (Milestone 1: editable, versioned
-- documents + a clause library). It adds:
--   * a 'legal' workspace role - widens the two role CHECKs, exactly like 085
--     added 'finance'. No existing row changes; nothing else is touched.
--   * a legal. schema with NARROWED default privileges, so a legal table added
--     next year cannot inherit the 002 over-grant (TRUNCATE/TRIGGER/REFERENCES
--     to anon/authenticated).
--   * doc_template -> doc_template_version -> doc_template_block, a clause
--     library, and a placeholder registry.
--   * a freeze trigger: once a version is published its blocks are immutable
--     and the version itself may only be retired (archived), never edited or
--     un-published. This is what stops "replace the DOCX" silently rewriting
--     the wording of contracts already issued.
--   * RLS on every table, gated to owner/admin/legal via has_role. Every table
--     carries workspace_id so its policy needs no join.
--
-- Idempotent (safe to run twice). Companion edits widen supabase/tests/020 and
-- /070 to cover the legal schema, so a future legal table without RLS, or an
-- over-grant into it, fails CI the same way public's would.
-- ============================================================

-- 1. the 'legal' role -------------------------------------------
do $$
begin
  alter table public.workspace_members drop constraint if exists workspace_members_role_check;
  alter table public.workspace_members add constraint workspace_members_role_check
    check (role = any (array['owner','admin','operations','sales','marketing','key_account','finance','legal','member']));
  alter table public.workspace_invites drop constraint if exists workspace_invites_role_check;
  alter table public.workspace_invites add constraint workspace_invites_role_check
    check (role = any (array['owner','admin','operations','sales','marketing','key_account','finance','legal','member']));
end $$;

-- 2. schema + narrowed default privileges -----------------------
create schema if not exists legal;
grant usage on schema legal to authenticated, service_role;
-- No blanket grant to anon/authenticated - each table grants only the four
-- row privileges it needs, and RLS gates the rows. service_role (the backend)
-- keeps full access and bypasses RLS.
alter default privileges in schema legal revoke all on tables from anon, authenticated;
alter default privileges in schema legal grant all on tables to service_role;
alter default privileges in schema legal grant usage, select on sequences to authenticated, service_role;

-- 3. tables -----------------------------------------------------
create table if not exists legal.doc_template (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  doc_kind     text not null check (doc_kind in ('vendor_contract','nda','client_contract','other')),
  name         text not null,
  description  text not null default '',
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_legal_doc_template_ws on legal.doc_template(workspace_id);

create table if not exists legal.doc_template_version (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references legal.doc_template(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version      integer not null,
  status       text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  published_by uuid,
  created_at   timestamptz not null default now(),
  unique (template_id, version),
  -- A draft has no publish date. Published AND archived both keep one, because
  -- archiving is retirement, not un-publishing. (Writing this as an equality -
  -- status='published' = published_at is not null - makes archival impossible,
  -- since an archived-but-once-published row keeps the date; this form allows
  -- the whole lifecycle.)
  constraint doc_tv_published_chk check (
    (status = 'draft' and published_at is null)
    or (status in ('published','archived') and published_at is not null)
  )
);
create index if not exists idx_legal_dtv_template on legal.doc_template_version(template_id);

create table if not exists legal.clause (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  title        text not null,
  category     text not null default '',
  block_type   text not null default 'p' check (block_type in ('title','h','p','li','kv','table','sig')),
  content      jsonb not null default '{}'::jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

create table if not exists legal.placeholder (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  label        text not null,
  source       text not null default '',
  data_type    text not null default 'text',
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

create table if not exists legal.doc_template_block (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references legal.doc_template_version(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  position     integer not null,
  block_type   text not null check (block_type in ('title','h','p','li','kv','table','sig','clause')),
  content      jsonb not null default '{}'::jsonb,
  optional     boolean not null default false,
  condition    text,
  clause_id    uuid references legal.clause(id) on delete set null,
  -- Deferrable so a whole reorder lands in one UPDATE without tripping the
  -- unique index mid-statement.
  constraint dtb_pos_uniq unique (version_id, position) deferrable initially deferred
);
create index if not exists idx_legal_dtb_version on legal.doc_template_block(version_id);

-- 4. the freeze: a published/archived version is immutable ------
create or replace function legal.enforce_version_freeze() returns trigger
  language plpgsql security definer set search_path = legal, public, pg_temp as $fn$
declare v_status text;
begin
  if tg_table_name = 'doc_template_version' then
    if tg_op = 'UPDATE' then
      if old.status = 'archived' then
        raise exception 'legal: an archived version is final and cannot be changed';
      elsif old.status = 'published' and new.status not in ('published','archived') then
        raise exception 'legal: a published version can only be archived, not edited or un-published';
      elsif old.status = 'published' and (new.template_id <> old.template_id or new.version <> old.version) then
        raise exception 'legal: a published version cannot be renumbered or re-parented';
      end if;
    elsif tg_op = 'DELETE' then
      if old.status <> 'draft' then
        raise exception 'legal: a published or archived version cannot be deleted, only archived';
      end if;
    end if;
    return case tg_op when 'DELETE' then old else new end;
  else
    -- doc_template_block: editable only while its version is a draft
    select status into v_status from legal.doc_template_version
      where id = coalesce(new.version_id, old.version_id);
    if v_status is distinct from 'draft' then
      raise exception 'legal: the blocks of a published version are frozen (version is %)', v_status;
    end if;
    return case tg_op when 'DELETE' then old else new end;
  end if;
end $fn$;

drop trigger if exists trg_freeze_version on legal.doc_template_version;
create trigger trg_freeze_version
  before update or delete on legal.doc_template_version
  for each row execute function legal.enforce_version_freeze();
drop trigger if exists trg_freeze_block on legal.doc_template_block;
create trigger trg_freeze_block
  before insert or update or delete on legal.doc_template_block
  for each row execute function legal.enforce_version_freeze();

-- 5. updated_at -------------------------------------------------
drop trigger if exists trg_dt_updated on legal.doc_template;
create trigger trg_dt_updated before update on legal.doc_template
  for each row execute function public.update_updated_at();
drop trigger if exists trg_clause_updated on legal.clause;
create trigger trg_clause_updated before update on legal.clause
  for each row execute function public.update_updated_at();

-- 6. grants + RLS (owner/admin/legal, staff-only) ---------------
do $$
declare t text;
begin
  foreach t in array array['doc_template','doc_template_version','doc_template_block','clause','placeholder']
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
