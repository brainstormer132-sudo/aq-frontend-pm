-- 084_signed_contracts.sql
--
-- Vendors and clients download a generated contract, sign it, and upload the
-- signed PDF back. Each upload is screened by an internal reviewer: it is
-- accepted, or rejected with a reason the uploader can see. A rejected upload
-- can be replaced by a corrected one, so every attempt is kept as its own row.
--
-- WHERE THE PIECES LIVE
-- ---------------------
--   * The signed PDF itself lives in storage; aq-backend writes it and puts
--     the object path in storage_path. generated_contracts already works this
--     way (pdf_storage_path / docx_storage_path).
--   * This table is the record of the upload and the review decision.
--   * The two review functions below are the ONLY way status changes from
--     'pending'. They are SECURITY DEFINER and refuse a caller who is not
--     staff, so a vendor or client cannot screen their own document even if
--     they reach the row.
--
-- contract_id is the same text id the portal already downloads by
-- (generated_contracts.contract_id). It is not a declared FK because
-- generated_contracts.contract_id carries no unique constraint and is owned by
-- the backend; contract_requests.generated_contract_id references it the same
-- loose way.
--
-- Idempotent: the table and its indexes/policies use IF NOT EXISTS, the
-- functions use CREATE OR REPLACE, so a second run is a no-op.

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_signatures (
  id                uuid primary key default extensions.uuid_generate_v4(),
  contract_id       text not null,
  workspace_id      uuid not null,
  uploaded_by       uuid,                       -- auth.users id of the external user
  uploader_role     text not null,
  storage_path      text not null,              -- signed PDF object path in storage
  original_filename text,
  content_type      text,
  byte_size         bigint,
  status            text not null default 'pending',
  rejection_reason  text,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),

  constraint contract_signatures_role_chk
    check (uploader_role in ('vendor', 'client')),
  constraint contract_signatures_status_chk
    check (status in ('pending', 'accepted', 'rejected')),
  -- A reason is present exactly when the upload is rejected, and never
  -- otherwise. This keeps "rejected with no reason" and "accepted but carrying
  -- a stale reason" both impossible.
  constraint contract_signatures_reason_chk
    check (
      (status = 'rejected') = (rejection_reason is not null and btrim(rejection_reason) <> '')
    )
);

comment on table public.contract_signatures is
  'Signed contracts uploaded by vendors/clients and the internal accept/reject decision on each. One row per upload attempt; rejected attempts are kept and can be superseded by a new upload.';
comment on column public.contract_signatures.contract_id is
  'generated_contracts.contract_id (text). Loosely referenced, like contract_requests.generated_contract_id.';
comment on column public.contract_signatures.storage_path is
  'Object path of the signed PDF in storage, written by aq-backend.';

-- Lookups: the portal reads by contract, the review queue reads by workspace.
create index if not exists contract_signatures_contract_idx
  on public.contract_signatures (contract_id, created_at desc);
create index if not exists contract_signatures_workspace_status_idx
  on public.contract_signatures (workspace_id, status, created_at desc);
create index if not exists contract_signatures_uploaded_by_idx
  on public.contract_signatures (uploaded_by);

-- At most one LIVE upload per contract. 'rejected' is not live, so a corrected
-- re-upload is allowed; two pending, or a second upload after acceptance, are
-- not. This is what makes "re-upload after rejection" safe without a race.
create unique index if not exists contract_signatures_one_live_uniq
  on public.contract_signatures (contract_id)
  where status in ('pending', 'accepted');

-- ---------------------------------------------------------------------------
-- 2. Row-level security.
--    External users (vendors/clients) see and create only their own rows.
--    Staff (any workspace member of the row's workspace) can read them all.
--    Nobody changes status directly: the review functions below do that.
-- ---------------------------------------------------------------------------
alter table public.contract_signatures enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='contract_signatures'
                   and policyname='contract_signatures select') then
    create policy "contract_signatures select" on public.contract_signatures
      for select using (
        public.is_member_of(workspace_id) or uploaded_by = auth.uid()
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='contract_signatures'
                   and policyname='contract_signatures insert') then
    -- The uploader inserts their own row (aq-backend, on service role, bypasses
    -- RLS anyway). status must start 'pending' and no decision may be smuggled
    -- in on insert.
    create policy "contract_signatures insert" on public.contract_signatures
      for insert with check (
        uploaded_by = auth.uid()
        and status = 'pending'
        and rejection_reason is null
        and reviewed_by is null
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The review decision. These are the only path from 'pending'.
-- ---------------------------------------------------------------------------

-- Accept. Idempotent: accepting an already-accepted row returns it unchanged.
-- Refuses a row that was rejected (the uploader must send a fresh one) and any
-- caller who is not staff.
create or replace function public.accept_signed_contract(p_id uuid)
  returns public.contract_signatures
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  row public.contract_signatures;
begin
  if not public.is_staff() then
    raise exception 'Only staff can review signed contracts';
  end if;

  select * into row from public.contract_signatures where id = p_id;
  if row.id is null then
    raise exception 'Signed contract % not found', p_id;
  end if;

  if row.status = 'accepted' then
    return row;                                  -- already done
  end if;
  if row.status = 'rejected' then
    raise exception 'Signed contract % was rejected; the uploader must send a corrected copy', p_id;
  end if;

  update public.contract_signatures
     set status           = 'accepted',
         rejection_reason = null,
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = p_id
   returning * into row;

  return row;
end $$;

-- Reject with a reason. The reason is required and is what the uploader sees.
-- Idempotent only in the sense that re-rejecting updates the reason; refuses an
-- already-accepted row and any non-staff caller.
create or replace function public.reject_signed_contract(p_id uuid, p_reason text)
  returns public.contract_signatures
  language plpgsql
  security definer
  set search_path to 'public'
as $$
declare
  row public.contract_signatures;
begin
  if not public.is_staff() then
    raise exception 'Only staff can review signed contracts';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A rejection needs a reason';
  end if;

  select * into row from public.contract_signatures where id = p_id;
  if row.id is null then
    raise exception 'Signed contract % not found', p_id;
  end if;

  if row.status = 'accepted' then
    raise exception 'Signed contract % was already accepted', p_id;
  end if;

  update public.contract_signatures
     set status           = 'rejected',
         rejection_reason = btrim(p_reason),
         reviewed_by      = auth.uid(),
         reviewed_at      = now()
   where id = p_id
   returning * into row;

  return row;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants. RLS still gates the table; the functions gate themselves.
-- ---------------------------------------------------------------------------
grant select, insert on public.contract_signatures to authenticated;
grant all    on public.contract_signatures to service_role;

grant execute on function public.accept_signed_contract(uuid)          to authenticated, service_role;
grant execute on function public.reject_signed_contract(uuid, text)    to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Realtime, so the review queue updates the moment a signed PDF lands.
--    Guarded: only if the supabase_realtime publication exists here.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public' and tablename='contract_signatures'
     ) then
    alter publication supabase_realtime add table public.contract_signatures;
  end if;
end $$;