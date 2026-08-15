-- ============================================================
-- 051_ad_types_and_edit_rights.sql
--
-- Two things.
--
-- 1. THE REAL AD TYPES. 048 constrained media_type to six invented values
--    (Home Ad, Store Visit, IG Reel, IG Post, IG Story, TikTok Video).
--    The actual list is twenty, from AQ's own chips. Without widening the
--    CHECK, every new value would be rejected on save.
--
-- 2. EDIT RIGHTS. The sales-vs-marketing field split is replaced with a
--    plain role rule: MEMBERS cannot edit a parent campaign; everyone else
--    can edit anything on it.
--
--    Siraj: "keep the lock ... key accounts can change so can marketing
--    admins and so on only members cant edit parent task". The old trigger
--    refused sales the right to touch a budget and marketing the right to
--    fix a client name, which is what "no need to be that strict" was
--    about. Subtasks were never covered and still aren't.
--
-- Run in Supabase: Dashboard → SQL Editor → paste → Run. Idempotent.
-- ============================================================

-- ─── 1. Ad types ─────────────────────────────────────────────────

alter table public.pm_tasks drop constraint if exists pm_tasks_media_type_check;

alter table public.pm_tasks
  add constraint pm_tasks_media_type_check
  check (media_type is null or media_type in (
    'Store Visit', 'Store Visit -Silent-',
    'Home Ad', 'Home Ad -Silent-',
    'Billboards', 'Sponsorship', 'Usage Rights',
    'Event Attending', 'Paid promotion', 'Logistics',
    'PhotoShot', 'VideoShot',
    'Post', 'Carousel Post', 'Reel', 'Story',
    'Video', 'Live', 'Media Production', 'Quote Tweet'
  ))
  not valid;

-- Rows saved under the old vocabulary. IG Reel / IG Post / IG Story / TikTok
-- Video map onto the real names; Home Ad and Store Visit already match.
update public.pm_tasks set media_type = 'Reel'  where media_type = 'IG Reel';
update public.pm_tasks set media_type = 'Post'  where media_type = 'IG Post';
update public.pm_tasks set media_type = 'Story' where media_type = 'IG Story';
update public.pm_tasks set media_type = 'Video' where media_type = 'TikTok Video';

-- ad_type is deliberately left as free text: it has always held whatever
-- ops typed (e.g. "VideoShot"), and constraining it now would reject
-- history for no benefit. The UI offers the list; the column accepts more.

-- ─── 2. Only members are locked out of the parent ────────────────
--
-- Supersedes the field-ownership trigger restated in 039 → 040 → 042 → 048.
-- Same trigger name, so this replaces it outright.

create or replace function public.enforce_task_field_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- Subtasks have never been restricted. Vendors, reports and deliverables
  -- are worked on by whoever is doing the work.
  if new.parent_task_id is not null then
    return new;
  end if;

  -- Service role, triggers and migrations run without a session user.
  if auth.uid() is null then
    return new;
  end if;

  select wm.role into v_role
    from public.workspace_members wm
   where wm.workspace_id = new.workspace_id
     and wm.user_id = auth.uid();

  -- Not a member of this workspace: RLS already handles that. Nothing to add.
  if v_role is null then
    return new;
  end if;

  -- The whole rule, now. Owner, admin, marketing, sales, key_account and
  -- operations may all edit a campaign freely — including each other's
  -- fields, which is the point of the change.
  if v_role = 'member' then
    raise exception
      'Members can work on subtasks but cannot edit the campaign itself. Ask a key account or an admin.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_task_field_ownership on public.pm_tasks;
create trigger trg_enforce_task_field_ownership
  before update on public.pm_tasks
  for each row
  execute function public.enforce_task_field_ownership();

-- ─── 3. Report ───────────────────────────────────────────────────
do $$
declare
  v_legacy integer;
begin
  select count(*) into v_legacy
    from public.pm_tasks
   where media_type in ('IG Reel', 'IG Post', 'IG Story', 'TikTok Video');
  raise notice '051: % row(s) still on the old media vocabulary (should be 0).', v_legacy;
end $$;
