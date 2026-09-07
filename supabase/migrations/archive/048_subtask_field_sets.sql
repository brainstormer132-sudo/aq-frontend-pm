-- ============================================================
-- 048_subtask_field_sets.sql
--
-- Subtasks get real shapes. Until now every subtask rendered the same
-- generic form; from here each kind carries only the cells it needs.
--
--   vendor            + insight link / attached
--   analysis_report     complexity, media type, brand-logo flag,
--                       keyword-excel flag, data-issue note
--                       (brand, campaign name and platforms are read
--                        from the parent, not stored again)
--   campaign_design   ) status + due date + attached-or-not.
--   marketing_strategy) Nothing else, on purpose.
--   visuals           )
--   blueprint_3d      )
--
-- On the PARENT: proof of posting (attached-or-not + a link).
--
-- `subtask_kind` is plain text, so the new kinds need no DDL — only the
-- columns below, plus the ownership trigger restated to cover them.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- ─── 1. Columns ──────────────────────────────────────────────────

alter table public.pm_tasks
  -- Analysis report (subtask rows)
  add column if not exists complexity             text,
  add column if not exists media_type             text,
  add column if not exists brand_logo_attached    boolean not null default false,
  add column if not exists keyword_excel_attached boolean not null default false,
  add column if not exists data_issue_note        text,
  -- Insight, which rides along with the vendor subtask rather than
  -- being a subtask of its own (Siraj's call).
  add column if not exists insight_link           text,
  add column if not exists insight_attached       boolean not null default false,
  -- The four simple deliverables share one flag; which deliverable it
  -- refers to is already carried by subtask_kind.
  add column if not exists deliverable_attached   boolean not null default false,
  -- Proof of posting (parent rows)
  add column if not exists proof_of_posting_attached boolean not null default false,
  add column if not exists proof_of_posting_link     text;

comment on column public.pm_tasks.deliverable_attached is
  'Campaign design / marketing strategy / visuals / blueprint 3D: is the file in yet?';
comment on column public.pm_tasks.insight_attached is
  'Insight lives on the vendor subtask, not a subtask of its own.';

-- ─── 2. Vocabularies ─────────────────────────────────────────────
-- NOT VALID so existing rows are never re-checked. New writes are.
-- Both allow NULL: a field nobody has filled in yet is not an error.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_complexity_check'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_complexity_check
      check (complexity is null or complexity in ('low', 'medium', 'high'))
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pm_tasks_media_type_check'
  ) then
    alter table public.pm_tasks
      add constraint pm_tasks_media_type_check
      check (media_type is null or media_type in (
        'Home Ad', 'Store Visit', 'IG Reel', 'IG Post', 'IG Story', 'TikTok Video'
      ))
      not valid;
  end if;
end $$;

-- ─── 3. Field ownership ──────────────────────────────────────────
--
-- Restates enforce_task_field_ownership() from 039 → 040 → 042 with the
-- proof-of-posting columns. Supersedes all three; safe standalone.
--
-- Only the PARENT columns are listed. The trigger returns early for
-- subtasks (`parent_task_id is not null`), so the analysis-report and
-- deliverable columns are deliberately absent — they only ever live on
-- child rows, and adding them here would be dead code that reads as if
-- it were doing something.

create or replace function public.enforce_task_field_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_touched_sales     boolean;
  v_touched_marketing boolean;
begin
  if new.parent_task_id is not null then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  select wm.role into v_role
    from public.workspace_members wm
   where wm.workspace_id = new.workspace_id
     and wm.user_id = auth.uid();

  if v_role is null then
    return new;
  end if;

  if v_role in ('owner', 'admin') then
    return new;
  end if;

  if v_role not in ('sales', 'marketing', 'key_account') then
    return new;
  end if;

  v_touched_sales :=
       (new.task_name        is distinct from old.task_name)
    or (new.title            is distinct from old.title)
    or (new.client_id        is distinct from old.client_id)
    or (new.legacy_client_id is distinct from old.legacy_client_id)
    or (new.brand_id         is distinct from old.brand_id)
    or (new.brand_name       is distinct from old.brand_name)
    or (new.sales_closer_id  is distinct from old.sales_closer_id)
    or (new.description      is distinct from old.description);

  v_touched_marketing :=
       (new.priority               is distinct from old.priority)
    or (new.service_type_id        is distinct from old.service_type_id)
    or (new.key_account_id         is distinct from old.key_account_id)
    or (new.stage                  is distinct from old.stage)
    or (new.status                 is distinct from old.status)
    or (new.completed_at           is distinct from old.completed_at)
    or (new.due_date               is distinct from old.due_date)
    or (new.assignee_id            is distinct from old.assignee_id)
    or (new.has_tracking           is distinct from old.has_tracking)
    or (new.source_id              is distinct from old.source_id)
    or (new.client_category_id     is distinct from old.client_category_id)
    or (new.quotation_no           is distinct from old.quotation_no)
    or (new.quotation_breakdown    is distinct from old.quotation_breakdown)
    or (new.invoice_no             is distinct from old.invoice_no)
    or (new.client_payment_status  is distinct from old.client_payment_status)
    or (new.client_payment_date    is distinct from old.client_payment_date)
    or (new.client_payment_amount  is distinct from old.client_payment_amount)
    or (new.contract_status        is distinct from old.contract_status)
    -- Package Ad (040)
    or (new.package_start_date     is distinct from old.package_start_date)
    or (new.package_end_date       is distinct from old.package_end_date)
    or (new.ad_quantity            is distinct from old.ad_quantity)
    -- Parent task redesign (042)
    or (new.platforms              is distinct from old.platforms)
    or (new.ad_type                is distinct from old.ad_type)
    or (new.ad_type_custom         is distinct from old.ad_type_custom)
    or (new.approval_stage         is distinct from old.approval_stage)
    or (new.quotation_numbers      is distinct from old.quotation_numbers)
    or (new.invoice_numbers        is distinct from old.invoice_numbers)
    or (new.net_payment_date       is distinct from old.net_payment_date)
    -- Proof of posting (this migration)
    or (new.proof_of_posting_attached is distinct from old.proof_of_posting_attached)
    or (new.proof_of_posting_link     is distinct from old.proof_of_posting_link);

  if v_role = 'sales' then
    if new.creator_id is distinct from auth.uid() then
      if v_touched_sales or v_touched_marketing then
        raise exception
          'Sales can only edit campaigns they created. Ask an admin to make this change.'
          using errcode = '42501';
      end if;
    elsif v_touched_marketing then
      raise exception
        'That field belongs to marketing. Sales owns the task name, client, brand, sales closer and description.'
        using errcode = '42501';
    end if;

  else  -- marketing / key_account
    if v_touched_sales then
      raise exception
        'That field belongs to sales. Marketing owns everything on the campaign except the task name, client, brand, sales closer and description.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_task_field_ownership on public.pm_tasks;
create trigger trg_enforce_task_field_ownership
  before update on public.pm_tasks
  for each row
  execute function public.enforce_task_field_ownership();

-- ─── 4. Catalog: the steps these kinds correspond to ─────────────
--
-- 044 stripped the catalog down. These four are the deliverables Siraj
-- named, seeded per service type so triage can offer them. Matched by
-- title so re-running never duplicates.
--
-- Nothing is pre-selected at triage any more (the UI change that ships
-- with this migration), so seeding a step only makes it *offerable*.

-- Insight stops being a step. It is now two cells on the vendor subtask
-- (insight_link + insight_attached), because an insight is about a
-- specific vendor's work, not about the campaign as a whole. Existing
-- Insight SUBTASKS are rows in pm_tasks and are left alone; this only
-- stops triage spawning new ones.
delete from public.service_type_steps
 where lower(trim(title)) = 'insight';

do $$
declare
  r record;
begin
  for r in
    select st.id as service_type_id, st.name as service_type_name
      from public.service_types st
  loop
    -- Analysis Report belongs to Campaign only, per Siraj.
    if lower(trim(r.service_type_name)) = 'campaign' then
      insert into public.service_type_steps (service_type_id, title, position)
      select r.service_type_id, 'Analysis Report', 10
       where not exists (
         select 1 from public.service_type_steps s
          where s.service_type_id = r.service_type_id
            and lower(trim(s.title)) = 'analysis report'
       );
    end if;

    -- Campaign Design / Marketing Strategy / Visuals were ALSO seeded here
    -- onto every service type. That was wrong — it put three creative steps
    -- in the triage list for Billboard, Event, Social Media and everything
    -- else. Removed (see 050, which cleans up the rows this already made).
    --
    -- They still exist as subtask KINDS and are one click away from the
    -- parent's "+ Add subtask" picker on any campaign that needs them.
    null;
  end loop;
end $$;

-- ─── 5. Quotation / invoice requests ─────────────────────────────
--
-- The parent campaign gets "Request quotation" and "Request invoice"
-- buttons beside the existing client-contract request.
--
-- Deliberately NOT folded into contract_requests: that table drives the
-- Contracts view, a template_key, and a FastAPI generation pipeline that
-- produces a signed PDF. A quotation request is a note to Finance, not a
-- contract to generate. Widening request_kind would have dragged every
-- quotation into the contracts queue.
--
-- Also deliberately lean. Client, brand, CR/VAT and amount are NOT
-- snapshotted here — they are read live from the parent task, the same
-- no-double-entry rule the rest of the campaign form follows. A request
-- that says "SAR 40,000" when the campaign now says 45,000 is worse than
-- no number at all.

create table if not exists public.document_requests (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  pm_task_id     uuid not null references public.pm_tasks(id) on delete cascade,
  doc_kind       text not null check (doc_kind in ('quotation', 'invoice')),
  status         text not null default 'pending'
                   check (status in ('pending', 'issued', 'cancelled')),
  note           text,
  /** Filled in when Finance issues it; mirrors into the parent's number list. */
  document_number text,
  requested_by   uuid,
  requested_at   timestamptz not null default now(),
  issued_by      uuid,
  issued_at      timestamptz
);

create index if not exists document_requests_task_idx
  on public.document_requests (pm_task_id, doc_kind);
create index if not exists document_requests_open_idx
  on public.document_requests (workspace_id, status)
  where status = 'pending';

alter table public.document_requests enable row level security;

-- Keyed on the row's OWN workspace_id, not a subquery into pm_tasks.
-- 045 learned that lesson the hard way: a policy that reads another
-- RLS-protected table evaluates that table's policies too.
drop policy if exists "document_requests_staff_read" on public.document_requests;
create policy "document_requests_staff_read" on public.document_requests
  for select using (
    public.has_role(workspace_id,
      array['owner','admin','marketing','sales','key_account','operations','member'])
  );

drop policy if exists "document_requests_staff_write" on public.document_requests;
create policy "document_requests_staff_write" on public.document_requests
  for insert with check (
    public.has_role(workspace_id,
      array['owner','admin','marketing','sales','key_account','operations'])
  );

drop policy if exists "document_requests_staff_update" on public.document_requests;
create policy "document_requests_staff_update" on public.document_requests
  for update using (
    public.has_role(workspace_id, array['owner','admin','operations','marketing','key_account'])
  );

drop policy if exists "document_requests_staff_delete" on public.document_requests;
create policy "document_requests_staff_delete" on public.document_requests
  for delete using (
    public.has_role(workspace_id, array['owner','admin','operations'])
  );

-- Tell Ops when one is raised. Same shape and the same reused
-- 'task_assigned' notification type as 041, so no enum change.
create or replace function public.notify_on_document_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  select task_name, title, brand_name, budget
    into v_task
    from public.pm_tasks
   where id = new.pm_task_id;

  insert into public.notifications (user_id, type, title, body, link)
  select wm.user_id,
         'task_assigned',
         initcap(new.doc_kind) || ' requested',
         coalesce(
           nullif(concat_ws(' · ',
             nullif(coalesce(v_task.task_name, v_task.title), ''),
             nullif(v_task.brand_name, ''),
             case when v_task.budget is not null
                  then 'SAR ' || trim(to_char(v_task.budget, 'FM999999999990.00')) end
           ), ''),
           'Open the campaign for details'
         ),
         '/dashboard/workflow?task=' || new.pm_task_id::text
    from public.workspace_members wm
   where wm.workspace_id = new.workspace_id
     and wm.role in ('owner', 'admin', 'operations')
     and wm.user_id is distinct from new.requested_by;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_document_request on public.document_requests;
create trigger trg_notify_on_document_request
  after insert on public.document_requests
  for each row
  execute function public.notify_on_document_request();

-- ─── 6. Report ───────────────────────────────────────────────────
do $$
declare
  v_cols integer;
begin
  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'pm_tasks'
     and column_name in (
       'complexity','media_type','brand_logo_attached','keyword_excel_attached',
       'data_issue_note','insight_link','insight_attached','deliverable_attached',
       'proof_of_posting_attached','proof_of_posting_link'
     );
  raise notice '048: % of 10 new columns present.', v_cols;
end $$;
