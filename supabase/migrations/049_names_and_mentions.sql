-- ============================================================
-- 049_names_and_mentions.sql
--
-- Two related things: stop showing people's email addresses as if they
-- were names, and notify someone when they're @mentioned in a comment.
--
-- THE NAME PROBLEM
-- Several profiles have an email address stored in full_name — the app
-- signs people up with `full_name: user_metadata.full_name || email`,
-- so anyone who never supplied a name got their address written in as
-- one. Every view then faithfully renders it, which is why the Team
-- workload panel reads "sbanjar@aqcreativity.com" instead of a person.
--
-- Fixing it in the UI would mean touching every view that renders a
-- name. Fixing it in the DATA fixes all of them at once, including the
-- ones nobody remembers exist. Siraj's call: each person sets their own
-- name, so until they do the profile reads "Unnamed member" — honest,
-- and no longer an address.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- ─── 1. A name is not an email address ───────────────────────────

create or replace function public.looks_like_email(p text)
returns boolean
language sql
immutable
as $$
  select p is not null and p ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

/** The placeholder shown until somebody sets a real name. */
create or replace function public.unnamed_member_label()
returns text
language sql
immutable
as $$ select 'Unnamed member'::text $$;

update public.profiles
   set full_name = public.unnamed_member_label()
 where public.looks_like_email(full_name);

-- Blank and whitespace-only names read as broken UI too.
update public.profiles
   set full_name = public.unnamed_member_label()
 where full_name is null or btrim(full_name) = '';

-- ─── 2. Stop it happening again ──────────────────────────────────
-- A signup that supplies no name must not smuggle the address in.
-- BEFORE INSERT OR UPDATE so neither path can reintroduce it.

create or replace function public.normalise_profile_name()
returns trigger
language plpgsql
as $$
begin
  if new.full_name is null
     or btrim(new.full_name) = ''
     or public.looks_like_email(new.full_name) then
    new.full_name := public.unnamed_member_label();
  else
    new.full_name := btrim(new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalise_profile_name on public.profiles;
create trigger trg_normalise_profile_name
  before insert or update of full_name on public.profiles
  for each row
  execute function public.normalise_profile_name();

-- ─── 3. Let people read their colleagues' names ──────────────────
-- Needed by the @mention picker. Returns names only — no emails, no
-- roles, nothing that isn't already on screen next to their avatar.

create or replace function public.workspace_member_names(p_workspace uuid)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name
    from public.workspace_members wm
    join public.profiles p on p.id = wm.user_id
   where wm.workspace_id = p_workspace
     and exists (
       select 1 from public.workspace_members me
        where me.workspace_id = p_workspace
          and me.user_id = auth.uid()
     )
   order by p.full_name;
$$;

revoke all on function public.workspace_member_names(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.workspace_member_names(uuid) to authenticated';
  end if;
end $$;

-- ─── 4. @mentions ────────────────────────────────────────────────
--
-- A mention is stored as `@[[<uuid>]]`, NOT as the person's name.
-- Storing the name would freeze it: rename someone and every comment
-- they were ever mentioned in would still show the old name. Resolving
-- the id at render time means the name is always current — the same
-- rule the rest of this app follows for client and brand.
--
-- The trigger extracts the ids and notifies. Doing it in the database
-- rather than the client means a mention can't go unsent because a
-- request was cut short, and there's exactly one implementation.

create or replace function public.notify_on_comment_mention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task    record;
  v_author  text;
  v_ids     uuid[];
begin
  -- Every uuid inside @[[...]], deduplicated.
  select array_agg(distinct m[1]::uuid) into v_ids
    from regexp_matches(
           coalesce(new.content, ''),
           '@\[\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]\]',
           'g'
         ) as m;

  if v_ids is null or array_length(v_ids, 1) is null then
    return new;
  end if;

  select t.id, t.workspace_id, coalesce(t.task_name, t.title) as name
    into v_task
    from public.pm_tasks t
   where t.id = new.task_id;

  if v_task.id is null then
    return new;
  end if;

  select p.full_name into v_author
    from public.profiles p where p.id = new.author_id;

  insert into public.notifications (user_id, type, title, body, link)
  select wm.user_id,
         'task_assigned',
         coalesce(v_author, 'Someone') || ' mentioned you',
         coalesce(v_task.name, 'a task'),
         '/dashboard/workflow?task=' || new.task_id::text
    from public.workspace_members wm
   where wm.workspace_id = v_task.workspace_id
     -- Only real members of the workspace. A stale id in the text is ignored
     -- rather than becoming an orphaned notification nobody can open.
     and wm.user_id = any(v_ids)
     -- Mentioning yourself in your own comment is not news.
     and wm.user_id is distinct from new.author_id;

  return new;
end;
$$;

drop trigger if exists trg_notify_on_comment_mention on public.comments;
create trigger trg_notify_on_comment_mention
  after insert on public.comments
  for each row
  execute function public.notify_on_comment_mention();

-- ─── 5. Report ───────────────────────────────────────────────────
do $$
declare
  v_unnamed integer;
  v_emails  integer;
begin
  select count(*) into v_unnamed
    from public.profiles where full_name = public.unnamed_member_label();
  select count(*) into v_emails
    from public.profiles where public.looks_like_email(full_name);

  raise notice '049: % profile(s) now read "Unnamed member" and need a real name.', v_unnamed;
  raise notice '049: % profile(s) still hold an email as a name (should be 0).', v_emails;
end $$;
