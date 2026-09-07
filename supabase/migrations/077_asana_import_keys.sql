-- Keys for the Asana import.
--
-- -- What this is --------------------------------------------------
--
-- The import in scripts/asana-import.mjs writes campaigns, bookings and ad
-- lines from an Asana CSV export. Each row keeps the Asana id it came from
-- so that a re-run after a fresh export UPDATES the row instead of adding
-- a second one - the exact failure the Zoho import had for four months
-- (claude/aq-zoho-import-fix.md) because it deduped through a read that
-- PostgREST truncated at 1000 rows. Here the database enforces it: the
-- unique index makes a duplicate an error, not a surprise.
--
-- Clients and vendors have no Asana id - they are dropdown values and free
-- text - so they carry `import_key`, 'asana:' + the folded name. Rows that
-- already existed and were merely matched by name do NOT get a key; that is
-- how 99_wipe.sql knows which rows are the import's to delete.
--
-- Partial indexes so hand-made rows (null key) can be as many as they like.

alter table public.pm_tasks       add column if not exists asana_gid  text;
alter table public.vendor_ad_lines add column if not exists asana_gid text;
alter table public.clients        add column if not exists import_key text;
alter table public.vendors        add column if not exists import_key text;

comment on column public.pm_tasks.asana_gid is
  'Asana task gid this row was imported from. Null for rows created in the app.';
comment on column public.vendor_ad_lines.asana_gid is
  'Asana task gid + '':1'' - the booking''s single line from the import.';
comment on column public.clients.import_key is
  '''asana:'' + folded company name, set only on rows the import CREATED. Matched rows keep null.';
comment on column public.vendors.import_key is
  '''asana:'' + folded vendor name, set only on rows the import CREATED. Matched rows keep null.';

create unique index if not exists pm_tasks_workspace_asana_gid_uniq
  on public.pm_tasks (workspace_id, asana_gid) where asana_gid is not null;

create unique index if not exists vendor_ad_lines_asana_gid_uniq
  on public.vendor_ad_lines (asana_gid) where asana_gid is not null;

create unique index if not exists clients_workspace_import_key_uniq
  on public.clients (workspace_id, import_key) where import_key is not null;

create unique index if not exists vendors_import_key_uniq
  on public.vendors (import_key) where import_key is not null;
