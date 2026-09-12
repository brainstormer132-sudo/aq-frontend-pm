-- 082_client_credits.sql
--
-- Client credits, logged.
--
-- The money ledger caps a recorded payment bigger than the bill (money-ledger
-- clampPaid), because a per-row overpayment is usually a typo and must not make
-- a campaign read as owing less than nothing. But a real overpayment IS money
-- the client has with AQ. Siraj: surface it, but a person controls whether it
-- becomes a credit, and every change is logged.
--
-- So this is an append-only audit ledger: one row per credit event. A grant is
-- a positive amount; spending the credit is a negative amount. The client's
-- balance is the sum of their rows. Nothing is derived silently -- a row exists
-- only because somebody recorded it, and it records who and when.
--
-- Append-only on purpose: there is no update or delete policy, so the log
-- cannot be quietly rewritten. A mistaken entry is corrected by a compensating
-- entry, which is the honest audit trail.
--
-- Safe to re-run.

create table if not exists public.client_credits (
  id             uuid primary key default extensions.uuid_generate_v4(),
  workspace_id   uuid not null,
  client_id      uuid not null references public.clients(id) on delete cascade,
  -- Signed: positive adds credit (a grant), negative spends it (applied to work).
  amount         numeric(14,2) not null,
  reason         text not null default '',
  -- The campaign the credit came from, or was applied to, when there is one.
  source_task_id uuid,
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index if not exists idx_client_credits_client    on public.client_credits (client_id);
create index if not exists idx_client_credits_workspace on public.client_credits (workspace_id);

alter table public.client_credits enable row level security;

do $$
begin
  -- Readable by any workspace member: the balance is shown to sales.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'client_credits'
       and policyname = 'client_credits read by member'
  ) then
    create policy "client_credits read by member" on public.client_credits
      for select using (public.is_member_of(workspace_id));
  end if;

  -- A member records credits; the row keeps who did it. No update/delete
  -- policy, so the ledger is append-only.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'client_credits'
       and policyname = 'client_credits insert by member'
  ) then
    create policy "client_credits insert by member" on public.client_credits
      for insert with check (public.is_member_of(workspace_id));
  end if;
end $$;

grant select, insert on table public.client_credits to authenticated;
grant all           on table public.client_credits to service_role;

comment on table public.client_credits is
  'Append-only ledger of client credit events. Positive = grant, negative = use. Balance is the sum per client. A row exists only because a member recorded it (created_by/created_at); corrections are compensating entries, never edits.';
