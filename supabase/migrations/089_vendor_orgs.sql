-- 089_vendor_orgs.sql
--
-- Licence-holder organizations for talent.
--
-- Some talent perform under an ORGANIZATION's commercial licence (an agency or
-- company holds the CR/licence; several individual influencers work under it).
-- Today each talent is a standalone vendors row, so the agency's licence name,
-- number and VAT get retyped on every influencer and can drift. This adds a
-- shared licence-holder record and links talent to it.
--
-- On a vendor contract, when a talent has an org, the ORG is the licence-holding
-- party (the name on the licence, the CR/licence number, the VAT) and the
-- talent's own contact_name / platform handle name the performer beneath it. A
-- talent with no org behaves exactly as before (their own name is the party).
--
-- Mirrors the vendors table's access model: staff (any workspace member) read
-- and write; the service role bypasses for imports. No workspace_id column, same
-- as vendors (is_staff() is the gate). NOT granted to anon. Idempotent:
-- IF NOT EXISTS + guarded policies + ADD COLUMN IF NOT EXISTS, so a re-run is a
-- no-op.

create table if not exists public.vendor_orgs (
  id             uuid primary key default extensions.uuid_generate_v4(),
  name           text not null,          -- the organization's registered / licence name
  license_number text,                   -- the org's CR / licence number
  id_number      text default ''::text,  -- fallback identifier when there is no licence
  vat_number     text default ''::text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.vendor_orgs is
  'Licence-holder organizations (agencies/companies). Talent under an org licence link to it via vendors.org_id; on a vendor contract the org is the licence-holding party and the talent is named as the performer.';

create index if not exists vendor_orgs_name_idx on public.vendor_orgs (lower(name));

-- Link talent to their licence-holder org.
alter table public.vendors
  add column if not exists org_id uuid references public.vendor_orgs(id) on delete set null;
create index if not exists vendors_org_id_idx on public.vendors (org_id) where org_id is not null;

-- RLS: mirror vendors (staff read + write). Not granted to anon.
alter table public.vendor_orgs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='vendor_orgs'
                   and policyname='vendor_orgs staff read') then
    create policy "vendor_orgs staff read" on public.vendor_orgs
      for select using (public.is_staff());
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname='public' and tablename='vendor_orgs'
                   and policyname='vendor_orgs staff write') then
    create policy "vendor_orgs staff write" on public.vendor_orgs
      using      (public.is_staff())
      with check (public.is_staff());
  end if;
end $$;

grant select, insert, update, delete on public.vendor_orgs to authenticated;
grant all on public.vendor_orgs to service_role;