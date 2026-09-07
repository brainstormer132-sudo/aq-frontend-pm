-- Invite duration controls + operations role downgrade.
--
-- Run after 016_invite_only_pm_accounts.sql.
-- Operations remains a valid role, but behaves close to member:
-- dashboard / team / assigned work only, not triage/admin/global workflow.

drop function if exists public.create_workspace_invite(uuid, text, text);

create or replace function public.create_workspace_invite(
  ws_id uuid,
  invite_email text,
  invite_role text default 'member',
  expires_hours integer default 24
)
returns table (
  id uuid,
  token text,
  email text,
  role text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.workspace_invites%rowtype;
  safe_hours integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if invite_role not in ('owner','admin','operations','sales','marketing','key_account','member') then
    raise exception 'Invalid role: %', invite_role;
  end if;

  if expires_hours not in (1, 12, 24) then
    raise exception 'Invite expiry must be 1, 12, or 24 hours';
  end if;
  safe_hours := expires_hours;

  if invite_role = 'owner' and not public.has_role(ws_id, array['owner']) then
    raise exception 'Only owners can invite another owner';
  end if;

  if not public.has_role(ws_id, array['owner','admin']) then
    raise exception 'Only owners and admins can invite teammates';
  end if;

  insert into public.workspace_invites (workspace_id, email, role, invited_by, expires_at)
  values (ws_id, lower(trim(invite_email)), invite_role, auth.uid(), now() + make_interval(hours => safe_hours))
  returning * into created;

  return query select created.id, created.token, created.email, created.role, created.expires_at;
end;
$$;

grant execute on function public.create_workspace_invite(uuid, text, text, integer) to authenticated;

-- pm_tasks: operations no longer has global task access or edit powers.
drop policy if exists "pm_tasks select role aware" on public.pm_tasks;
drop policy if exists "pm_tasks insert by role" on public.pm_tasks;
drop policy if exists "pm_tasks update by role" on public.pm_tasks;
drop policy if exists "pm_tasks delete by admin" on public.pm_tasks;

create policy "pm_tasks select role aware" on public.pm_tasks for select
  using (
    public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account'])
    or assignee_id    = auth.uid()
    or creator_id     = auth.uid()
    or key_account_id = auth.uid()
    or id in (select task_id from public.task_members where user_id = auth.uid())
  );

create policy "pm_tasks insert by role" on public.pm_tasks for insert
  with check (
    public.has_role(workspace_id, array['owner','admin','sales','marketing'])
    and creator_id = auth.uid()
  );

create policy "pm_tasks update by role" on public.pm_tasks for update
  using (
    public.has_role(workspace_id, array['owner','admin'])
    or public.has_role(workspace_id, array['marketing'])
    or (public.has_role(workspace_id, array['sales']) and stage = 'draft' and creator_id = auth.uid())
    or key_account_id = auth.uid()
    or assignee_id = auth.uid()
  );

create policy "pm_tasks delete by admin" on public.pm_tasks for delete
  using (public.has_role(workspace_id, array['owner','admin']));

-- task member/assignment management: operations removed from privileged list.
drop policy if exists "task_members select by task access" on public.task_members;
drop policy if exists "task_members all by privileged" on public.task_members;
create policy "task_members select by task access" on public.task_members for select
  using (
    user_id = auth.uid()
    or public.has_role(public.task_workspace_id(task_id), array['owner','admin','marketing','key_account'])
  );
create policy "task_members all by privileged" on public.task_members for all
  using (public.has_role(public.task_workspace_id(task_id), array['owner','admin','marketing','key_account']));

drop policy if exists "task_assignments select by task access" on public.task_assignments;
drop policy if exists "task_assignments all by privileged" on public.task_assignments;
create policy "task_assignments select by task access" on public.task_assignments for select
  using (
    user_id = auth.uid()
    or public.has_role(public.task_workspace_id(task_id), array['owner','admin','marketing','key_account'])
  );
create policy "task_assignments all by privileged" on public.task_assignments for all
  using (public.has_role(public.task_workspace_id(task_id), array['owner','admin','marketing','key_account']));

-- Multi-service task links: operations cannot triage/write service links.
drop policy if exists "task_service_types select by task access" on public.task_service_types;
drop policy if exists "task_service_types write by triage" on public.task_service_types;
create policy "task_service_types select by task access" on public.task_service_types for select
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','marketing','sales','key_account','member'])
  );
create policy "task_service_types write by triage" on public.task_service_types for all
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','marketing'])
  );

-- Attachments/comments cleanup: operations no longer has admin cleanup rights.
drop policy if exists "task_attachments select by task access" on public.task_attachments;
drop policy if exists "task_attachments insert by task access" on public.task_attachments;
drop policy if exists "task_attachments delete own or admin" on public.task_attachments;
create policy "task_attachments select by task access" on public.task_attachments for select
  using (
    public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','marketing','sales','key_account','member'])
  );
create policy "task_attachments insert by task access" on public.task_attachments for insert
  with check (
    auth.uid() = uploader_id
    and public.has_role(public.task_workspace_id(task_id),
      array['owner','admin','marketing','sales','key_account','member'])
  );
create policy "task_attachments delete own or admin" on public.task_attachments for delete
  using (
    auth.uid() = uploader_id
    or public.has_role(public.task_workspace_id(task_id), array['owner','admin'])
  );

drop policy if exists "comments delete own or admin" on public.comments;
create policy "comments delete own or admin" on public.comments for delete
  using (
    auth.uid() = author_id
    or public.has_role(public.task_workspace_id(task_id), array['owner','admin'])
  );

-- Contract request queue: operations no longer manages/generates requests.
drop policy if exists "contract_requests insert" on public.contract_requests;
drop policy if exists "contract_requests update" on public.contract_requests;
drop policy if exists "contract_requests delete" on public.contract_requests;

create policy "contract_requests insert" on public.contract_requests for insert
  with check (
    auth.uid() = requested_by
    and public.has_role(workspace_id, array['owner','admin','marketing','sales','key_account'])
  );
create policy "contract_requests update" on public.contract_requests for update
  using (public.has_role(workspace_id, array['owner','admin','marketing','key_account']));
create policy "contract_requests delete" on public.contract_requests for delete
  using (
    requested_by = auth.uid()
    or public.has_role(workspace_id, array['owner','admin'])
  );

-- Optional verification:
-- select proname, pronargs from pg_proc where proname = 'create_workspace_invite';
