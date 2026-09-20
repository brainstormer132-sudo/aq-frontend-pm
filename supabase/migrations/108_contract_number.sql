-- ============================================================
-- 108_contract_number.sql
-- The contract number, issued by the database rather than typed.
--
-- The template's {{ id }} is the contract number. Until now it was a text
-- field somebody filled in, which is two problems: two people drafting at
-- once can pick the same number, and a number that is typed can be skipped,
-- so a gap in the register looks like a lost contract rather than a habit.
--
-- Shape: AQ-<year>-0001, restarting each January. The year is Riyadh's, not
-- UTC's - between midnight and 03:00 local on 1 January those disagree, and
-- the disagreement would put a January contract in last year's series.
--
-- WHEN a number is taken matters. Not at draft: a draft that is abandoned
-- would burn one and leave a hole. It is reserved as the last step before
-- issuing, by legal.reserve_contract_number, which:
--   * refuses anyone who is not owner/admin/legal, in the body and not only
--     on the grant (audit A1-A4)
--   * is idempotent - a contract that already has a number gets the same one
--     back, so a retry after a failed issue does not consume a second
--   * writes the number into contract_field 'id' as well as the contract
--     row, WHILE THE CONTRACT IS STILL A DRAFT. It has to be that order:
--     the freeze trigger (100_contracts.sql:52) refuses any field write once
--     the contract is issued, and the fingerprint is taken over the values,
--     so the number must be in place before the document is sealed.
--
-- The caller therefore: reserve -> recompute the fingerprint -> issue. The
-- number is part of what the fingerprint covers, which is the point.
--
-- Idempotent. Run in staging, then prod. Then: notify pgrst.
-- ============================================================

-- 1. where the number lives ---------------------------------------

alter table legal.contract
  add column if not exists contract_no text;

-- Unique per workspace, not globally: two workspaces each start at 0001.
-- Partial, so the many drafts with no number yet do not collide.
create unique index if not exists idx_legal_contract_no
  on legal.contract(workspace_id, contract_no)
  where contract_no is not null;

comment on column legal.contract.contract_no is
  'AQ-<year>-0001, assigned by legal.reserve_contract_number just before issue. Null while a draft.';

-- 2. the counter ---------------------------------------------------
-- One row per workspace per year. The increment is an upsert with RETURNING,
-- which takes a row lock, so two people issuing in the same second get
-- consecutive numbers rather than the same one.

create table if not exists legal.contract_counter (
  workspace_id uuid    not null references public.workspaces(id) on delete cascade,
  year         integer not null,
  last_n       integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, year)
);

alter table legal.contract_counter enable row level security;
grant select, insert, update on legal.contract_counter to authenticated;
grant all on legal.contract_counter to service_role;
-- No policy on purpose: the counter is only ever touched by the SECURITY
-- DEFINER function below, and RLS with no policy denies everything else.
-- Nobody gets to read the next number, or set it.

-- 3. reserve ------------------------------------------------------

create or replace function legal.reserve_contract_number(p_contract_id uuid)
  returns text
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_ws     uuid;
  v_status text;
  v_no     text;
  v_year   integer;
  v_n      integer;
begin
  select c.workspace_id, c.status, c.contract_no
    into v_ws, v_status, v_no
    from legal.contract c where c.id = p_contract_id;

  if v_ws is null then
    raise exception 'No such contract.' using errcode = '42704';
  end if;
  if auth.uid() is null
     or not public.has_role(v_ws, array['owner','admin','legal']) then
    raise exception 'Only legal can issue a contract number.' using errcode = '42501';
  end if;

  -- Already numbered: hand back the same one. A retry after a failed issue
  -- must not eat another number.
  if v_no is not null then
    return v_no;
  end if;

  if v_status is distinct from 'draft' then
    raise exception 'That contract is % and has no number; it was issued before numbering existed.', v_status
      using errcode = '22023';
  end if;

  v_year := extract(year from (now() at time zone 'Asia/Riyadh'))::integer;

  insert into legal.contract_counter (workspace_id, year, last_n)
  values (v_ws, v_year, 1)
  on conflict (workspace_id, year) do update
    set last_n = legal.contract_counter.last_n + 1, updated_at = now()
  returning last_n into v_n;

  v_no := 'AQ-' || v_year::text || '-' || lpad(v_n::text, 4, '0');

  update legal.contract set contract_no = v_no where id = p_contract_id;

  -- The document's own {{ id }}. Written while the contract is still a draft,
  -- because the freeze refuses field writes the moment it is issued.
  insert into legal.contract_field (contract_id, workspace_id, key, value)
  values (p_contract_id, v_ws, 'id', v_no)
  on conflict (contract_id, key) do update set value = excluded.value;

  return v_no;
end;
$fn$;

revoke all on function legal.reserve_contract_number(uuid) from public;
grant execute on function legal.reserve_contract_number(uuid) to authenticated;
