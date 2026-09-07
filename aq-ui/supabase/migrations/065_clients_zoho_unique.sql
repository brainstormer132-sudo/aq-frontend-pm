-- 065_clients_zoho_unique.sql
--
-- Makes the duplicate-client bug structurally impossible.
--
-- The Zoho import identifies a client by `zoho_customer_id` — that is its real
-- identity from Zoho's side, and it is what the dedupe in `_run_import_job`
-- matches on. There has never been a constraint enforcing it, so when the
-- dedupe went blind (an unpaged select capped at 1000 rows), nothing at the
-- database level objected to the same Zoho customer being inserted nine times.
--
-- Run AFTER 064_dedupe_clients.sql. There is no ordering dependency with the
-- backend deploy — it is safe either side. If a duplicate ever slips through
-- again it now fails with a 409 for that one company, which `_do_one` catches
-- and reports in the job's error list: the import carries on and you find out,
-- instead of the row landing silently.
--
-- NOTE: deliberately NOT a unique index on `company_name`. Two real companies
-- can share a name — this workspace has `Brand Ripplr FZ LLC` under three
-- registrations, and two different Saudi companies both called
-- شركة عالم الاعمال الرائدة لخدمات الاعمال. A name index would reject them.
-- The Zoho id is the identity; the name is only a label.

-- ---------------------------------------------------------------------------
-- 1. Check before building, so a failure names the problem instead of coming
--    back as a bare "could not create unique index".
--
--    064 merges by NAME. Two rows can share a `zoho_customer_id` and still
--    have different names — if a company was renamed in Zoho while it sat in
--    the import's blind spot, the second run inserted it under the new name.
--    064 leaves those alone; they have to be merged by hand first.
-- ---------------------------------------------------------------------------
do $$
declare
  bad int;
  r   record;
begin
  select count(*) into bad from (
    select 1 from public.clients
    where zoho_customer_id is not null
    group by workspace_id, zoho_customer_id
    having count(*) > 1
  ) x;

  if bad > 0 then
    raise notice 'Cannot add the index yet — % Zoho customer(s) appear on more than one row:', bad;
    for r in
      select zoho_customer_id,
             count(*) as copies,
             string_agg(distinct company_name, '  ||  ') as names,
             string_agg(id::text, ', ' order by created_at) as ids
      from public.clients
      where zoho_customer_id is not null
      group by workspace_id, zoho_customer_id
      having count(*) > 1
      order by count(*) desc
    loop
      raise notice '  zoho %  (% copies)  names: %', r.zoho_customer_id, r.copies, r.names;
      raise notice '      ids: %', r.ids;
    end loop;
    raise exception
      'Merge those % duplicate Zoho id(s) first — same customer, different names, so 064 could not pair them. Nothing has been changed.',
      bad;
  end if;

  -- ---------------------------------------------------------------------
  -- 2. The constraint. Inside the same block on purpose: as two separate
  --    statements, a client that runs them independently would report the
  --    check's failure and then go on to attempt the index anyway, so the
  --    real message is buried under a second, uglier one.
  --
  --    Partial, because a client added by hand has no Zoho id and any number
  --    of them may have none. NULLs never collide in a unique index anyway;
  --    saying so in the predicate keeps the index small and the intent plain.
  -- ---------------------------------------------------------------------
  execute $ix$
    create unique index if not exists clients_workspace_zoho_uniq
      on public.clients (workspace_id, zoho_customer_id)
      where zoho_customer_id is not null
  $ix$;

  raise notice 'clients_workspace_zoho_uniq is in place — the same Zoho customer can no longer land twice.';
end $$;
