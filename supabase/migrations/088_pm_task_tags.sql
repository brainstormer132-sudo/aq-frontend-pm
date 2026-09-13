-- 088_pm_task_tags.sql
--
-- Store the Asana tags on the task so the app can filter on them. Until now
-- the import only wrote them into the campaign's description text ("Tags:
-- #Transaction"), which nothing could query. The Finance menu needs to show
-- only campaigns carrying a given tag (#quotation, #requotation, #invoice,
-- #transaction), so tags have to be real, indexable data.
--
-- text[], not a join table: tags are a short, flat list per task, read far
-- more than written, and always as a set-membership test ("does this campaign
-- have #quotation"). A GIN index makes `tags @> array['quotation']` fast.
--
-- Populated by the Asana import (lib/asana-import.ts renderCampaigns), so it
-- fills in on the next import or hourly sync; existing rows start empty ('{}'),
-- which reads as "no tags" everywhere and is the correct default.
--
-- Idempotent: add-column-if-not-exists + create-index-if-not-exists.

alter table public.pm_tasks
  add column if not exists tags text[] not null default '{}'::text[];

comment on column public.pm_tasks.tags is
  'Asana tag names on this task (e.g. #quotation, #invoice, #transaction), '
  'as imported. Used by the Finance menu to show only tasks carrying a tag. '
  'Compared case-insensitively and with a leading # ignored in app code.';

create index if not exists pm_tasks_tags_gin
  on public.pm_tasks using gin (tags);