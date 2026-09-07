-- Invite tokens must not be readable by anon.
--
-- THE BUG THIS FREEZES: `create policy "external_invites read by token" on
-- external_user_invites for select using (true)` plus a grant to anon
-- meant /rest/v1/external_user_invites?select=* returned every unclaimed
-- token. A token is a bearer credential — listing them is handing out
-- portal accounts to whoever asks, with no password needed.

do $$
declare
  n int;
begin
  select count(*) into n
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'external_user_invites'
     and grantee = 'anon'
     and privilege_type = 'SELECT';
  if n > 0 then
    raise exception
      'anon can SELECT external_user_invites — every unclaimed invite token '
      'is listable, which is an account-takeover path into the portal.';
  end if;

  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'external_user_invites'
       and p.polcmd = 'r'
       and pg_get_expr(p.polqual, p.polrelid) = 'true'
  ) then
    raise exception
      'external_user_invites has a `using (true)` select policy. Tokens are '
      'credentials; validation goes through the backend on the service role.';
  end if;
end $$;
