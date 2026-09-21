-- ============================================================
-- 113_legal_matters.sql
-- The Legal Registry: disputes, cases and lawsuits, with a log.
--
-- Siraj: "I need the legal registry to keep law suits and cases and problems
-- that could arise and become law suits from the app in one place and statuses
-- and a log", and "any cases or law suits need to be logged and followed
-- through until won or loss", covering "vendors not being paid and clients who
-- have not paid with warnings".
--
-- Called a MATTER, not a case: `case` is a reserved word in SQL and would need
-- quoting at every mention. Matter is also what this is - the sidebar's old
-- Matters slot became Tasks, and the word comes back where it belongs.
--
-- -- WHAT IS NOT IN HERE, AND WHY ------------------------------------
--
-- The "problems that could arise" are NOT rows in this table. Who owes what is
-- already answered by lib/money-ledger.ts (clientLedger / vendorLedger) from
-- pm_tasks and the rollup, and the rule for what counts as owed - completed
-- campaigns only - lives there. Copying that into rows here would mean a cron,
-- a second definition of "overdue", and two numbers that disagree by Tuesday.
--
-- So the Registry screen DERIVES the warnings from the ledger every time it
-- loads, and a row appears in this table only when somebody acts on one. The
-- ledger stays the single answer to "what is owed"; this table answers "what
-- are we doing about it".
--
-- `source_key` is what stops the same problem being raised twice: the screen
-- sets it when opening a matter from a derived warning, and can then show that
-- warning as already handled rather than offering it again.
--
-- -- WHY THE PARTY IS SNAPSHOTTED -------------------------------------
--
-- party_name is not null and is written at creation, even though client_id /
-- vendor_id are there too. A matter must still say who it was against after
-- the client record is deleted or merged - a lawsuit outlives a CRM row, and
-- both foreign keys are ON DELETE SET NULL for exactly that reason.
--
-- -- WHY THE LOG CANNOT BE SKIPPED ------------------------------------
--
-- "followed through until won or loss" is enforced, not asked for: a trigger
-- writes a matter_event on every status change, so there is no way to move a
-- matter to won, lost or filed without leaving a dated trace of who did it.
-- The same trigger stamps and clears closed_at, so a closed matter cannot sit
-- with an open date on it.
-- ============================================================

set search_path = legal, public;

-- 1. the matter ----------------------------------------------------

create table if not exists legal.matter (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  title         text not null,

  -- The other side. Exactly one of the two ids is meaningful, and which one is
  -- party_type - not "whichever is not null", because a deleted client sets
  -- client_id to null and the matter is still against a client.
  party_type    text not null check (party_type in ('client','vendor')),
  client_id     uuid   references public.clients(id) on delete set null,
  vendor_id     bigint references public.vendors(id) on delete set null,
  party_name    text not null default '',

  kind          text not null default 'other'
                check (kind in ('client_unpaid','vendor_unpaid','breach','content','other')),

  -- open      - raised, nothing sent yet
  -- warned    - a warning has gone out
  -- escalated - with a lawyer, or a formal demand
  -- filed     - a lawsuit exists
  -- won / lost / settled / dropped - closed
  status        text not null default 'open'
                check (status in ('open','warned','escalated','filed',
                                  'won','lost','settled','dropped')),

  -- What is in dispute. Null when it is not about money.
  amount        numeric(14,2),

  -- Where it came from, all optional and all ON DELETE SET NULL.
  pm_task_id    uuid   references public.pm_tasks(id) on delete set null,
  contract_id   uuid   references legal.contract(id) on delete set null,

  -- The derived warning this was raised from, so the screen does not offer it
  -- again. Unique per workspace when set; see the header.
  source_key    text,

  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  outcome       text not null default '',

  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- The id that is set must match the party_type, and the other must be null.
  -- Written to survive ON DELETE SET NULL: both-null is legal, which is a
  -- matter whose party record was deleted, and party_name still names them.
  constraint matter_party_chk check (
    (party_type = 'client' and vendor_id is null)
    or (party_type = 'vendor' and client_id is null)
  ),

  -- not null alone is not enough: the column has a default of '', so a direct
  -- insert that omits it would satisfy NOT NULL and leave a matter that cannot
  -- say who it is against. Found by dropping the NOT NULL and watching the
  -- suite still pass.
  constraint matter_party_name_chk check (btrim(party_name) <> '')
);

create index if not exists idx_legal_matter_ws
  on legal.matter(workspace_id, opened_at desc, id desc);
create index if not exists idx_legal_matter_client
  on legal.matter(client_id) where client_id is not null;
create index if not exists idx_legal_matter_vendor
  on legal.matter(vendor_id) where vendor_id is not null;
-- Open matters are what the screen leads with, and they are the minority.
create index if not exists idx_legal_matter_open
  on legal.matter(workspace_id, status)
  where status in ('open','warned','escalated','filed');
create unique index if not exists uq_legal_matter_source
  on legal.matter(workspace_id, source_key) where source_key is not null;

alter table legal.matter enable row level security;
grant select, insert, update, delete on legal.matter to authenticated;
grant all on legal.matter to service_role;

drop policy if exists matter_rw on legal.matter;
create policy matter_rw on legal.matter
  using (public.has_role(workspace_id, array['owner','admin','legal']))
  with check (public.has_role(workspace_id, array['owner','admin','legal']));

drop trigger if exists trg_matter_updated on legal.matter;
create trigger trg_matter_updated before update on legal.matter
  for each row execute function public.update_updated_at();

-- 2. the log -------------------------------------------------------

create table if not exists legal.matter_event (
  id           uuid primary key default gen_random_uuid(),
  matter_id    uuid not null references legal.matter(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  at           timestamptz not null default now(),
  actor        uuid,
  kind         text not null default 'note'
               check (kind in ('note','warning','call','email','letter',
                               'meeting','filed','hearing','payment','status')),
  body         text not null default '',
  -- Only a status event carries these.
  from_status  text,
  to_status    text,
  amount       numeric(14,2),
  created_at   timestamptz not null default now()
);

create index if not exists idx_legal_matter_event_m
  on legal.matter_event(matter_id, at desc, id desc);

alter table legal.matter_event enable row level security;
grant select, insert, update, delete on legal.matter_event to authenticated;
grant all on legal.matter_event to service_role;

drop policy if exists matter_event_rw on legal.matter_event;
create policy matter_event_rw on legal.matter_event
  using (public.has_role(workspace_id, array['owner','admin','legal']))
  with check (public.has_role(workspace_id, array['owner','admin','legal']));

-- 3. the status trail, which is not optional -------------------------
--
-- A trigger rather than an RPC, so it holds however the row is updated -
-- including a direct PATCH from the browser, which is how the screen saves.
-- SECURITY DEFINER because the event insert must not be re-filtered by the
-- policy above under a caller who could update the matter but, mid-migration
-- or mid-role-change, not insert the event; a status change that silently
-- failed to log would be worse than a refused update.

create or replace function legal.log_matter_status()
  returns trigger
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_closed constant text[] := array['won','lost','settled','dropped'];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Closing stamps the date; reopening clears it. Never left to the caller:
  -- a matter marked won with no closed_at cannot be reported on.
  if new.status = any(v_closed) then
    if new.closed_at is null then new.closed_at := now(); end if;
  else
    new.closed_at := null;
  end if;

  insert into legal.matter_event (matter_id, workspace_id, actor, kind,
                                  from_status, to_status, body)
  values (new.id, new.workspace_id, auth.uid(), 'status',
          old.status, new.status,
          case when new.status = any(v_closed) and new.outcome <> ''
               then new.outcome else '' end);
  return new;
end;
$fn$;

drop trigger if exists trg_matter_status on legal.matter;
create trigger trg_matter_status before update on legal.matter
  for each row execute function legal.log_matter_status();

-- The opening entry, so every matter's log starts where the matter does.
create or replace function legal.log_matter_opened()
  returns trigger
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
begin
  insert into legal.matter_event (matter_id, workspace_id, actor, kind,
                                  to_status, body, amount)
  values (new.id, new.workspace_id, coalesce(new.created_by, auth.uid()),
          'status', new.status, 'Opened.', new.amount);
  return new;
end;
$fn$;

drop trigger if exists trg_matter_opened on legal.matter;
create trigger trg_matter_opened after insert on legal.matter
  for each row execute function legal.log_matter_opened();

-- 4. raising one, and logging against it ------------------------------
--
-- SECURITY DEFINER with the check in the BODY, not only on the grant
-- (audit A1-A4): anon must not be able to reach these at all, and a
-- workspace member who is not legal must be refused by the function itself.

create or replace function legal.open_matter(
  p_workspace_id uuid,
  p_title        text,
  p_party_type   text,
  p_party_name   text,
  p_client_id    uuid    default null,
  p_vendor_id    bigint  default null,
  p_kind         text    default 'other',
  p_amount       numeric default null,
  p_pm_task_id   uuid    default null,
  p_contract_id  uuid    default null,
  p_source_key   text    default null
) returns uuid
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_id uuid;
begin
  if auth.uid() is null
     or not public.has_role(p_workspace_id, array['owner','admin','legal']) then
    raise exception 'Only legal can open a matter.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'A matter needs a title.' using errcode = '22023';
  end if;
  if p_party_type not in ('client','vendor') then
    raise exception 'A matter is against a client or a vendor.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_party_name), '') = '' then
    raise exception 'A matter needs the name of the other party.' using errcode = '22023';
  end if;

  insert into legal.matter (workspace_id, title, party_type, party_name,
                            client_id, vendor_id, kind, amount,
                            pm_task_id, contract_id, source_key, created_by)
  values (p_workspace_id, btrim(p_title), p_party_type, btrim(p_party_name),
          case when p_party_type = 'client' then p_client_id end,
          case when p_party_type = 'vendor' then p_vendor_id end,
          coalesce(p_kind, 'other'), p_amount,
          p_pm_task_id, p_contract_id, nullif(btrim(coalesce(p_source_key,'')), ''),
          auth.uid())
  returning id into v_id;

  return v_id;
end;
$fn$;

create or replace function legal.log_matter_event(
  p_matter_id uuid,
  p_kind      text,
  p_body      text default '',
  p_amount    numeric default null,
  p_at        timestamptz default null
) returns uuid
  language plpgsql security definer
  set search_path = legal, public, pg_temp
  as $fn$
declare
  v_ws uuid;
  v_id uuid;
begin
  select workspace_id into v_ws from legal.matter where id = p_matter_id;
  if v_ws is null then
    raise exception 'No such matter.' using errcode = 'P0002';
  end if;
  if auth.uid() is null
     or not public.has_role(v_ws, array['owner','admin','legal']) then
    raise exception 'Only legal can write to a matter.' using errcode = '42501';
  end if;
  if p_kind = 'status' then
    raise exception 'Status entries are written by the trigger, not by hand.'
      using errcode = '22023';
  end if;

  insert into legal.matter_event (matter_id, workspace_id, at, actor, kind, body, amount)
  values (p_matter_id, v_ws, coalesce(p_at, now()), auth.uid(),
          coalesce(p_kind, 'note'), coalesce(p_body, ''), p_amount)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function legal.open_matter(uuid, text, text, text, uuid, bigint,
                                         text, numeric, uuid, uuid, text) from public, anon;
grant execute on function legal.open_matter(uuid, text, text, text, uuid, bigint,
                                            text, numeric, uuid, uuid, text) to authenticated;

revoke all on function legal.log_matter_event(uuid, text, text, numeric, timestamptz)
  from public, anon;
grant execute on function legal.log_matter_event(uuid, text, text, numeric, timestamptz)
  to authenticated;

comment on table legal.matter is
  'A dispute, case or lawsuit, against one client or one vendor. The problems that could become one are derived from the money ledger and are not rows here - see the file header.';
comment on table legal.matter_event is
  'The log. Every status change is written here by a trigger, so a matter cannot reach won or lost without a dated trail.';
