-- ============================================================
-- Fix: "permission denied for table workspaces" when creating
-- the first workspace.
-- ============================================================
-- Cause: the dashboard does
--   insert into workspaces ... .select().single()
--   then insert into workspace_members ...
--
-- The SELECT-after-INSERT runs BEFORE the membership row exists,
-- so the workspaces SELECT policy ("must be a member") rejects it.
--
-- Two fixes — apply both:
--   1. A trigger that auto-inserts the owner row in workspace_members
--      whenever a workspace is created. (Source of truth.)
--   2. A wider workspaces SELECT policy that also allows the owner,
--      independent of membership. (Defense in depth.)
--
-- Run this in Supabase SQL Editor.
-- ============================================================

-- 1. Trigger: auto-add the workspace owner to workspace_members.
create or replace function public.add_workspace_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_workspace_created on public.workspaces;
create trigger on_workspace_created
  after insert on public.workspaces
  for each row execute function public.add_workspace_owner_as_member();

-- 2. Allow the owner to read their workspace even if (somehow) the
-- workspace_members row isn't there yet. Belt and suspenders.
drop policy if exists "workspaces select if member"          on public.workspaces;
drop policy if exists "workspaces select if owner or member" on public.workspaces;
create policy "workspaces select if owner or member" on public.workspaces for select
  using (auth.uid() = owner_id or public.is_member_of(id));
