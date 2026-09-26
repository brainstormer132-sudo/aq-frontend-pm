-- ============================================================
-- 142_the_signatory_title_exists_in_a_file.sql
-- A column that has been live since 18 September gets a migration.
--
-- -- HOW IT WAS FOUND ------------------------------------------------
--
-- scripts/schema-drift.mjs, on its first run against production:
--
--   public.clients | COLUMNS DIFFER | files 30 | live 31
--   clients | signatory_title | IN LIVE, NOT IN THE FILES | | text
--
-- It shipped on 18 September as a hand-run ALTER through PROD_URL,
-- alongside a backend change and a frontend change, and the note written
-- at the time says in as many words that the column "must land before the
-- backend deploy, else client create/update 500s on the unknown column".
-- That sentence is exactly what would have happened to the NEW Supabase
-- project: built from these files, it would not have had the column, and
-- saving a client would have failed on the first day.
--
-- Eight places in this app touch it - the client edit form, the new-client
-- form, the details panel, and ClientsView's create and update paths - and
-- the contract generator falls back to the general-manager wording when it
-- is empty.
--
-- -- WHY IT IS WRITTEN THIS WAY ---------------------------------------
--
-- Four idempotent steps rather than one ADD COLUMN, because the point is
-- to make the two sides AGREE, and the live column's nullability was never
-- recorded anywhere this could read. Adding the column only would leave
-- the files saying one thing and the database another, which is the same
-- class of problem this migration exists to close.
--
-- NOT NULL DEFAULT '' rather than nullable: every reader treats it as a
-- string and falls back on empty. A null would mean the same thing as ''
-- with an extra way to get it wrong.
-- ============================================================

alter table public.clients
  add column if not exists signatory_title text;

alter table public.clients
  alter column signatory_title set default '';

update public.clients set signatory_title = '' where signatory_title is null;

alter table public.clients
  alter column signatory_title set not null;

-- Prove it, rather than trust it. Structural, so it holds on an empty
-- database and a full one alike.
do $$
declare
  n_col  integer;
  n_null integer;
  v_def  text;
begin
  select count(*) into n_col from information_schema.columns
   where table_schema = 'public' and table_name = 'clients'
     and column_name = 'signatory_title' and data_type = 'text';
  if n_col <> 1 then
    raise exception 'clients: signatory_title is not there as text (found %)', n_col;
  end if;

  select count(*) into n_null from information_schema.columns
   where table_schema = 'public' and table_name = 'clients'
     and column_name = 'signatory_title' and is_nullable = 'YES';
  if n_null <> 0 then
    raise exception 'clients: signatory_title is still nullable';
  end if;

  select column_default into v_def from information_schema.columns
   where table_schema = 'public' and table_name = 'clients'
     and column_name = 'signatory_title';
  if v_def is null or v_def not like '''''%' then
    raise exception 'clients: signatory_title has no empty-string default (got %)', v_def;
  end if;

  raise notice 'clients: the signatory title is a column in a file now';
end $$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'clients'
--    and column_name = 'signatory_title';
-- expected: one row - text, NO, ''::text
