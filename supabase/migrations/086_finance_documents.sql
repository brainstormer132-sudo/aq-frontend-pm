-- 086_finance_documents.sql
--
-- Records the quotations and invoices the finance team generates for a campaign.
-- The DOCUMENT itself lives in Zoho (Zoho is the system of record: numbering,
-- VAT, the bilingual template, and -- for invoices -- ZATCA compliance). This
-- table is the app's link to it: which campaign, which Zoho document, its number
-- and PDF, where it stands, and -- for quotations -- the client's accept/reject
-- decision made in our portal.
--
-- One row per document. A campaign can have several over time (a re-issued
-- quotation, then an invoice); the latest non-void row of a kind is the current
-- one. No one-live constraint on purpose -- quotations legitimately get revised.
--
-- Client acceptance (kind='quotation') is added in a later migration together
-- with the external-user read policy; here the table is staff-only.
--
-- Idempotent: IF NOT EXISTS + guarded policies, so a second run is a no-op.

create table if not exists public.finance_documents (
  id                uuid primary key default extensions.uuid_generate_v4(),
  workspace_id      uuid not null,
  pm_task_id        uuid not null references public.pm_tasks(id) on delete cascade,
  kind              text not null,

  -- Zoho linkage
  zoho_document_id  text,                 -- Zoho estimate_id / invoice_id
  document_number   text,                 -- EST-#### / INV-####
  pdf_url           text,                 -- Zoho-hosted PDF (or a cached path)
  amount            numeric(14,2),        -- total incl VAT, as generated
  currency          text not null default 'SAR',
  breakdown         boolean,              -- with/without breakdown, snapshot

  -- lifecycle
  status            text not null default 'draft',

  -- client acceptance (quotations; decision recorded here, flow added later)
  accepted_at       timestamptz,
  accepted_by       uuid,                 -- external_users auth uid
  rejection_reason  text,
  reviewed_at       timestamptz,

  -- audit
  created_by        uuid,                 -- workspace member who generated it
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint finance_documents_kind_chk
    check (kind in ('quotation', 'invoice')),
  constraint finance_documents_status_chk
    check (status in ('draft', 'generated', 'sent', 'accepted', 'rejected', 'void')),
  -- a reason is present exactly when rejected
  constraint finance_documents_reason_chk
    check (
      (status = 'rejected') = (rejection_reason is not null and btrim(rejection_reason) <> '')
    )
);

comment on table public.finance_documents is
  'Quotations/invoices generated for a campaign. The document lives in Zoho; this row links it (number, pdf, status) and records client acceptance for quotations.';

create index if not exists finance_documents_task_idx
  on public.finance_documents (pm_task_id, kind, created_at desc);
create index if not exists finance_documents_queue_idx
  on public.finance_documents (workspace_id, kind, status, created_at desc);
-- One app row per Zoho document (guards a double-link if a create is retried).
create unique index if not exists finance_documents_zoho_uniq
  on public.finance_documents (zoho_document_id)
  where zoho_document_id is not null;

-- ---------------------------------------------------------------------------
-- RLS. Money is sensitive: read for the finance-facing roles, write for the
-- ones who own the document (owner/admin/finance). aq-backend on the service
-- role bypasses RLS for the actual Zoho-driven writes; the constraints above
-- still hold it to valid states.
-- ---------------------------------------------------------------------------
alter table public.finance_documents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='finance_documents'
                   and policyname='finance_documents select') then
    create policy "finance_documents select" on public.finance_documents
      for select using (
        public.has_role(workspace_id, array['owner','admin','sales','key_account','finance'])
      );
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='finance_documents'
                   and policyname='finance_documents write') then
    create policy "finance_documents write" on public.finance_documents
      for all
      using      (public.has_role(workspace_id, array['owner','admin','finance']))
      with check (public.has_role(workspace_id, array['owner','admin','finance']));
  end if;
end $$;

grant select, insert, update on public.finance_documents to authenticated;
grant all on public.finance_documents to service_role;

-- Realtime so the finance queue updates the moment a document is generated.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime'
         and schemaname='public' and tablename='finance_documents'
     ) then
    alter publication supabase_realtime add table public.finance_documents;
  end if;
end $$;