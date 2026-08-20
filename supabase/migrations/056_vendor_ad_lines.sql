-- ============================================================
-- 056_vendor_ad_lines.sql
-- The ads inside one vendor booking.
--
-- A Package Ad is sold as one booking with several ads in it: six home ads,
-- six store visits, and often a few reminders that cost nothing. Today a
-- vendor subtask carries ONE ad_type and ONE price, so that shape has to be
-- flattened into a single line — and the contract then says "1 × ad" for
-- twelve pieces of work.
--
-- So: a vendor subtask gets a list of ad lines. One contract still comes out
-- of the subtask, but it is written from all of them.
--
-- Notes on the shape:
--
--   • `quantity` defaults to 1 and must be positive. Six home ads can be one
--     line with quantity 6 or six lines of 1 — both are legal, because
--     people write their bookings both ways.
--   • `unit_price` may be **zero**. A reminder that costs nothing is still
--     part of what was agreed and still belongs in the contract; forcing a
--     price above zero would push it out of the document entirely.
--   • `line_total` is generated, so the number in the contract cannot drift
--     from the number in the row.
--   • Deleting the subtask deletes its lines (ON DELETE CASCADE) — they have
--     no meaning without it.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor.
-- ============================================================

begin;

create table if not exists public.vendor_ad_lines (
  id            uuid primary key default gen_random_uuid(),
  subtask_id    uuid not null references public.pm_tasks(id) on delete cascade,
  position      int  not null default 0,
  ad_type       text not null,
  platform      text,
  quantity      int  not null default 1 check (quantity > 0),
  unit_price    numeric(12,2) not null default 0 check (unit_price >= 0),
  line_total    numeric(12,2) generated always as (quantity * unit_price) stored,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.vendor_ad_lines is
  'The individual ads inside one vendor subtask. One contract is written from all of them.';
comment on column public.vendor_ad_lines.unit_price is
  'May be 0 — a free reminder is still part of the agreement.';

create index if not exists idx_vendor_ad_lines_subtask
  on public.vendor_ad_lines (subtask_id, position);

-- keep updated_at honest
create or replace function public.touch_vendor_ad_lines()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_vendor_ad_lines on public.vendor_ad_lines;
create trigger trg_touch_vendor_ad_lines
  before update on public.vendor_ad_lines
  for each row execute function public.touch_vendor_ad_lines();

-- ─── Row level security ─────────────────────────────────────────
-- A line is readable and writable by whoever may read and write the subtask
-- it hangs off. Rather than restate the rule, ask pm_tasks: the workspace
-- membership check already lives there, and two copies of a permission rule
-- is how they drift apart.
alter table public.vendor_ad_lines enable row level security;

drop policy if exists vendor_ad_lines_select on public.vendor_ad_lines;
create policy vendor_ad_lines_select on public.vendor_ad_lines for select
  to authenticated using (
    exists (select 1 from public.pm_tasks t where t.id = subtask_id)
  );

drop policy if exists vendor_ad_lines_insert on public.vendor_ad_lines;
create policy vendor_ad_lines_insert on public.vendor_ad_lines for insert
  to authenticated with check (
    exists (select 1 from public.pm_tasks t where t.id = subtask_id)
  );

drop policy if exists vendor_ad_lines_update on public.vendor_ad_lines;
create policy vendor_ad_lines_update on public.vendor_ad_lines for update
  to authenticated using (
    exists (select 1 from public.pm_tasks t where t.id = subtask_id)
  );

drop policy if exists vendor_ad_lines_delete on public.vendor_ad_lines;
create policy vendor_ad_lines_delete on public.vendor_ad_lines for delete
  to authenticated using (
    exists (select 1 from public.pm_tasks t where t.id = subtask_id)
  );

-- Changes should reach other people's screens like everything else.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'vendor_ad_lines'
     )
  then
    alter publication supabase_realtime add table public.vendor_ad_lines;
  end if;
end $$;

commit;

-- ─── Verification ───────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'vendor_ad_lines'
 order by ordinal_position;

select count(*) as lines_so_far from public.vendor_ad_lines;
-- Expect 0 on a fresh install.
