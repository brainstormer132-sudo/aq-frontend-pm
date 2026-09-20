-- ============================================================
-- 104_rpc_hardening.sql
-- Audit 2026-09-20, section A. Ten SECURITY DEFINER functions in public were
-- granted to anon and carried no auth check, so anyone holding the publishable
-- anon key could call them over PostgREST:
--
--   issue_external_invite / reissue_external_invite - mint a portal login for
--     any vendor or client. consume_external_invite then bound the resulting
--     external_users row to whatever auth user id the CALLER passed, which
--     handed over that vendor's IBAN and files, or every campaign published
--     to that client.
--   approve_pending_client / approve_pending_vendor / reject_pending_* -
--     approve your own self-submitted registration into a live vendors +
--     bank_accounts row.
--   publish_tracking_sheet / unpublish_tracking_sheet - the role check read
--     "if auth.uid() is not null and not has_role(...)", so an UNAUTHENTICATED
--     call skipped it entirely: publish any campaign's working sheet to the
--     client-visible table, or wipe it.
--   notify_role - push an arbitrary title/body/link into every owner and admin
--     inbox (a phishing link inside the app).
--
-- Two changes, in this order:
--
--   1. Revoke EXECUTE from public/anon (and from authenticated where nothing
--      signed-in needs it). service_role keeps its own grant, so the FastAPI
--      contract backend and the Vercel crons are unaffected.
--        - publish/unpublish keep authenticated: the PM app calls them from
--          the browser (hooks/use-workflow.ts:1813,1820).
--        - issue/reissue/consume keep authenticated so the invite flow works
--          whether the backend uses the service key or forwards the staff
--          user's JWT; step 2 is what makes that safe.
--        - approve/reject pending and notify_role lose authenticated too:
--          nothing in the app calls them (the registration screens write the
--          pending_* tables directly, and on_pm_task_stage_change is SECURITY
--          DEFINER so its internal notify_role call is unaffected).
--
--   2. Add the auth check the bodies were missing, so the grant is not the only
--      thing standing between a portal account and a staff action. After step 1
--      anon cannot reach these at all, so "auth.uid() is null" now means a
--      service-role call and is allowed; a signed-in caller must be staff.
--
-- Function bodies are otherwise copied verbatim from 000_baseline.sql.
-- Idempotent (create or replace + revoke). Run in staging, then prod.
-- Then: notify pgrst.
-- ============================================================

-- 1. Grants ------------------------------------------------------

revoke execute on function public.issue_external_invite(text, text, bigint, uuid, uuid) from public, anon;
revoke execute on function public.reissue_external_invite(uuid, uuid)                    from public, anon;
revoke execute on function public.consume_external_invite(text, uuid)                    from public, anon;
revoke execute on function public.publish_tracking_sheet(uuid)                           from public, anon;
revoke execute on function public.unpublish_tracking_sheet(uuid)                         from public, anon;

revoke execute on function public.approve_pending_client(bigint) from public, anon, authenticated;
revoke execute on function public.approve_pending_vendor(bigint) from public, anon, authenticated;
revoke execute on function public.reject_pending_client(bigint)  from public, anon, authenticated;
revoke execute on function public.reject_pending_vendor(bigint)  from public, anon, authenticated;
revoke execute on function public.notify_role(uuid, text[], public.notification_type, text, text, text)
  from public, anon, authenticated;

-- 2. Missing auth checks -----------------------------------------

create or replace function public.issue_external_invite(p_email text, p_role text, p_vendor_id bigint, p_client_id uuid, p_actor uuid)
  returns table(out_id uuid, out_token text, out_email text, out_role text, out_expires_at timestamp with time zone)
  language plpgsql security definer
  set search_path to 'public'
  as $$
declare
  inserted public.external_user_invites%rowtype;
begin
  -- Added 104: a signed-in caller must be staff. A portal vendor/client is an
  -- auth user but not a workspace_member, so is_staff() is false for them.
  -- Null uid = service_role (anon lost EXECUTE above).
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Only staff can issue a portal invite.' using errcode = '42501';
  end if;

  if p_role not in ('vendor','client') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if p_role = 'vendor' and p_vendor_id is null then
    raise exception 'vendor_id is required for vendor invites';
  end if;
  if p_role = 'client' and p_client_id is null then
    raise exception 'client_id is required for client invites';
  end if;

  insert into public.external_user_invites (email, role, vendor_id, client_id, invited_by)
  values (lower(trim(p_email)), p_role, p_vendor_id, p_client_id, p_actor)
  returning * into inserted;

  if p_role = 'vendor' then
    update public.vendors set invite_status = 'invite_sent' where id = p_vendor_id;
  else
    update public.clients set invite_status = 'invite_sent' where id = p_client_id;
  end if;

  out_id         := inserted.id;
  out_token      := inserted.token;
  out_email      := inserted.email;
  out_role       := inserted.role;
  out_expires_at := inserted.expires_at;
  return next;
end;
$$;

create or replace function public.reissue_external_invite(p_external_user_id uuid, p_actor uuid)
  returns table(out_id uuid, out_token text, out_email text, out_role text, out_expires_at timestamp with time zone)
  language plpgsql security definer
  set search_path to 'public'
  as $$
declare
  eu       public.external_users%rowtype;
  inserted public.external_user_invites%rowtype;
begin
  -- Added 104: see issue_external_invite.
  if auth.uid() is not null and not public.is_staff() then
    raise exception 'Only staff can reissue a portal invite.' using errcode = '42501';
  end if;

  select * into eu from public.external_users where id = p_external_user_id;
  if eu.id is null then
    raise exception 'External user % not found', p_external_user_id;
  end if;

  update public.external_user_invites
     set expires_at = now()
   where lower(email) = lower(eu.email)
     and accepted_at is null
     and expires_at > now();

  insert into public.external_user_invites
    (email, role, vendor_id, client_id, invited_by, reset_count)
  values
    (eu.email, eu.role, eu.vendor_id, eu.client_id, p_actor, 1)
  returning * into inserted;

  if eu.role = 'vendor' then
    update public.vendors set invite_status = 'invite_sent' where id = eu.vendor_id;
  else
    update public.clients set invite_status = 'invite_sent' where id = eu.client_id;
  end if;

  out_id         := inserted.id;
  out_token      := inserted.token;
  out_email      := inserted.email;
  out_role       := inserted.role;
  out_expires_at := inserted.expires_at;
  return next;
end;
$$;

create or replace function public.consume_external_invite(p_token text, p_auth_user_id uuid)
  returns table(out_external_user_id uuid, out_role text, out_vendor_id bigint, out_client_id uuid)
  language plpgsql security definer
  set search_path to 'public'
  as $$
declare
  inv public.external_user_invites%rowtype;
  eu_id uuid;
begin
  -- Added 104: a signed-in caller may only bind the invite to THEMSELVES.
  -- Before this, any caller could pass any auth user id and take over the
  -- portal identity. Null uid = service_role (the backend claim endpoint).
  if auth.uid() is not null and p_auth_user_id is distinct from auth.uid() then
    raise exception 'An invite can only be claimed by the signed-in user.' using errcode = '42501';
  end if;

  select * into inv
    from public.external_user_invites
   where token = p_token
   for update;

  if inv.id is null then
    raise exception 'Invite not found';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Invite already used';
  end if;
  if inv.expires_at <= now() then
    raise exception 'Invite expired';
  end if;

  insert into public.external_users (auth_user_id, email, role, vendor_id, client_id)
  values (p_auth_user_id, lower(inv.email), inv.role, inv.vendor_id, inv.client_id)
  on conflict (auth_user_id) do update
    set role = excluded.role,
        vendor_id = excluded.vendor_id,
        client_id = excluded.client_id,
        email = excluded.email
  returning external_users.id into eu_id;

  update public.external_user_invites
     set accepted_at = now(),
         accepted_by = p_auth_user_id
   where id = inv.id;

  if inv.role = 'vendor' then
    update public.vendors set invite_status = 'accepted' where id = inv.vendor_id;
  else
    update public.clients set invite_status = 'accepted' where id = inv.client_id;
  end if;

  out_external_user_id := eu_id;
  out_role             := inv.role;
  out_vendor_id        := inv.vendor_id;
  out_client_id        := inv.client_id;
  return next;
end;
$$;

create or replace function public.publish_tracking_sheet(p_task_id uuid) returns integer
  language plpgsql security definer
  set search_path to 'public'
  as $$
declare
  v_workspace uuid;
  v_count     integer;
begin
  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;
  if v_workspace is null then
    raise exception 'No such task: %', p_task_id using errcode = '42704';
  end if;

  -- Changed 104: was "auth.uid() is not null and not has_role(...)", which
  -- SKIPPED the check for an unauthenticated caller. Publishing is a staff
  -- action from the browser only; nothing calls this with the service key.
  if auth.uid() is null
     or not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then
    raise exception 'You do not have permission to publish this sheet.' using errcode = '42501';
  end if;

  delete from public.tracking_rows_published where task_id = p_task_id;

  -- Shared:     who, where, what, when, status, link, and now which ad.
  -- NOT shared: price_excl, price_incl, notes, contact_number,
  --             license_plate_url - money, internal notes and PII.
  --
  -- If you add a column here, ask whether the client should see it. Landing
  -- in this table is not the same as being readable - 071's column grants
  -- decide that - but the two lists should be reasoned about together.
  insert into public.tracking_rows_published (
    id, task_id, position,
    influencer_name, profile_link,
    platform, type_of_ad, content, product,
    shooting_date, posting_date, ad_status, ad_link,
    ad_line_id, ad_line_seq, subtask_id,
    created_at, updated_at,
    published_at, published_by, source_row_id
  )
  select r.id, r.task_id, r.position,
         r.influencer_name, r.profile_link,
         r.platform, r.type_of_ad, r.content, r.product,
         r.shooting_date, r.posting_date, r.ad_status, r.ad_link,
         r.ad_line_id, r.ad_line_seq, r.subtask_id,
         r.created_at, r.updated_at,
         now(), auth.uid(), r.id
    from public.tracking_rows r
   where r.task_id = p_task_id;

  get diagnostics v_count = row_count;

  update public.pm_tasks
     set tracking_published_at = now(),
         tracking_published_by = auth.uid()
   where id = p_task_id;

  return v_count;
end;
$$;

create or replace function public.unpublish_tracking_sheet(p_task_id uuid) returns void
  language plpgsql security definer
  set search_path to 'public'
  as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;
  if v_workspace is null then
    raise exception 'No such task: %', p_task_id using errcode = '42704';
  end if;

  -- Changed 104: see publish_tracking_sheet.
  if auth.uid() is null
     or not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then
    raise exception 'You do not have permission to unpublish this sheet.' using errcode = '42501';
  end if;

  delete from public.tracking_rows_published where task_id = p_task_id;
  update public.pm_tasks
     set tracking_published_at = null, tracking_published_by = null
   where id = p_task_id;
end;
$$;
