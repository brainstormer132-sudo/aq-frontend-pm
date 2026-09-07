--
-- PostgreSQL database dump
--
--
-- AQ BASELINE.  The production schema as pg_dump found it (server 17.6),
-- WITH privileges: 357 GRANTs and 5 REVOKEs.  Do not re-dump this with
-- --no-privileges.  A privilege-less baseline rebuilds a database that
-- nobody can read, and it silently turns the grant assertions in
-- supabase/tests/ green, because they are phrased as "this must NOT be
-- granted" and nothing is.  See the long note in scripts/test-migrations.mjs.
--
-- It replaces migrations 001-074, kept in supabase/migrations/archive/ as
-- a changelog.  Those were never replayable from empty: 002 references a
-- column and a function that later files add.  Everything numbered above
-- 000 replays on top of this.
--
-- Three things were done to the raw dump, all of them mechanical:
--
--   * The \restrict / \unrestrict meta-commands pg_dump 17.11 emits are
--     removed. They are psql-17-only and make the file unreadable to any
--     older client.
--   * CREATE SCHEMA public gained IF NOT EXISTS, so the replay is not
--     order-sensitive about who creates the schema.
--   * The UTF-8 BOM and the CP437 mojibake that PowerShell's `Out-File
--     -Encoding utf8` introduced were undone. Next time redirect with
--     pg_dump's own --file= flag and neither happens.
--



-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: activity_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.activity_action AS ENUM (
    'created',
    'updated',
    'deleted',
    'completed',
    'assigned',
    'unassigned',
    'commented',
    'moved',
    'status_changed',
    'priority_changed'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'task_assigned',
    'task_completed',
    'comment_added',
    'mention',
    'due_soon',
    'project_invite'
);


--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_priority AS ENUM (
    'urgent',
    'high',
    'medium',
    'low',
    'none'
);


--
-- Name: task_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_stage AS ENUM (
    'draft',
    'pending_marketing',
    'in_progress',
    'awaiting_review',
    'completed'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'todo',
    'in_progress',
    'in_review',
    'done',
    'cancelled',
    'pending',
    'on_hold'
);


--
-- Name: _invite_accepted_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._invite_accepted_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  if old.accepted_at is null and new.accepted_at is not null then

    perform public._log_invite_event(

      new.id, new.workspace_id, new.email, new.role,

      'accepted', new.accepted_by,

      jsonb_build_object()

    );

  end if;

  return new;

end;

$$;


--
-- Name: _invite_revoked_trigger(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._invite_revoked_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  is_expired boolean;

begin

  is_expired := old.accepted_at is null and old.expires_at <= now();

  perform public._log_invite_event(

    null, old.workspace_id, old.email, old.role,

    case when is_expired then 'expired' else 'revoked' end,

    auth.uid(),

    jsonb_build_object(

      'original_invite_id', old.id,

      'was_accepted', old.accepted_at is not null

    )

  );

  return old;

end;

$$;


--
-- Name: _log_invite_event(uuid, uuid, text, text, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._log_invite_event(p_invite_id uuid, p_workspace_id uuid, p_email text, p_role text, p_action text, p_actor uuid, p_detail jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  insert into public.invite_events

    (invite_id, workspace_id, invite_email, invite_role, action, actor_id, detail)

  values

    (p_invite_id, p_workspace_id, p_email, p_role, p_action, p_actor, p_detail);

end;

$$;


--
-- Name: activity_feed(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activity_feed(p_workspace_id uuid, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, task_id uuid, action text, entity_name text, entity_kind text, details jsonb, user_id uuid, user_name text, created_at timestamp with time zone, task_exists boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select a.id, a.task_id, a.action, a.entity_name, a.entity_kind, a.details,

         a.user_id, p.full_name, a.created_at, a.task_id is not null

    from public.activity_log a

    left join public.profiles p on p.id = a.user_id

   where a.workspace_id = p_workspace_id

     and public.is_member_of(a.workspace_id)

   order by a.created_at desc

   limit greatest(1, least(coalesce(p_limit, 50), 500));

$$;


--
-- Name: add_workspace_owner_as_member(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_workspace_owner_as_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  insert into public.workspace_members (workspace_id, user_id, role)

  values (new.id, new.owner_id, 'owner')

  on conflict (workspace_id, user_id) do nothing;

  return new;

end;

$$;


--
-- Name: approve_pending_client(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_pending_client(p_id bigint) RETURNS TABLE(client_id uuid, was_already_approved boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  pc record;

  existing_client_id uuid;

  new_client_id uuid;

begin

  select * into pc from public.pending_clients where id = p_id;

  if pc.id is null then

    raise exception 'Pending client % not found', p_id;

  end if;



  -- Idempotency: if a clients row already references this pending row,

  -- return it instead of creating a duplicate.

  select id into existing_client_id

    from public.clients

    where pending_client_id = p_id

    limit 1;



  if existing_client_id is not null then

    update public.pending_clients

       set status = 'approved',

           reviewed_at = now()

     where id = p_id and status <> 'approved';

    return query select existing_client_id, true;

    return;

  end if;



  insert into public.clients (

    company_name, contact_name, contact_email, contact_phone,

    cr_number, vat_number, signatory_name, company_email,

    street, city, postcode, country, national_address,

    pending_client_id, invite_status, status

  ) values (

    pc.company_name,

    pc.signatory_name,

    coalesce(nullif(pc.company_email, ''), pc.email),

    pc.phone,

    pc.cr_number, pc.vat_number, pc.signatory_name, pc.company_email,

    pc.street, pc.city, pc.postcode, pc.country, pc.national_address,

    pc.id, 'pending_invite', 'active'

  )

  returning id into new_client_id;



  update public.pending_clients

     set status = 'approved',

         reviewed_at = now()

   where id = p_id;



  return query select new_client_id, false;

end;

$$;


--
-- Name: approve_pending_vendor(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_pending_vendor(p_id bigint) RETURNS TABLE(vendor_id bigint, was_already_approved boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  pv record;

  existing_vendor_id bigint;

  new_vendor_id bigint;

  normalized_iban text;

begin

  select * into pv from public.pending_vendors where id = p_id;

  if pv.id is null then

    raise exception 'Pending vendor % not found', p_id;

  end if;



  select id into existing_vendor_id

    from public.vendors

    where pending_vendor_id = p_id

    limit 1;



  if existing_vendor_id is not null then

    update public.pending_vendors

       set status = 'approved', reviewed_at = now()

     where id = p_id and status <> 'approved';

    return query select existing_vendor_id, true;

    return;

  end if;



  -- Bump the sequence past any existing max(id) before inserting.

  perform public.resync_vendor_sequence();



  insert into public.vendors (

    name, license_number, created_at,

    pending_vendor_id, email, phone, vendor_category, platforms,

    invite_status

  ) values (

    pv.full_name, pv.license_number, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),

    pv.id, pv.email, pv.phone, pv.vendor_category, pv.platforms,

    'pending_invite'

  )

  returning id into new_vendor_id;



  normalized_iban := upper(replace(coalesce(pv.iban, ''), ' ', ''));

  if normalized_iban <> '' then

    insert into public.bank_accounts (

      vendor_id, bank_name, account_name, iban, account_number, swift_code

    ) values (

      new_vendor_id,

      coalesce(nullif(pv.bank_name, ''), 'Unknown bank'),

      coalesce(nullif(pv.account_name, ''), pv.full_name),

      normalized_iban,

      coalesce(pv.account_number, ''),

      coalesce(pv.swift_code, '')

    );

  end if;



  update public.pending_vendors

     set status = 'approved', reviewed_at = now()

   where id = p_id;



  return query select new_vendor_id, false;

end;

$$;


--
-- Name: claim_workspace_invite(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_workspace_invite(invite_token text) RETURNS TABLE(workspace_id uuid, role text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inv record;

  caller_email text;

begin

  if auth.uid() is null then

    raise exception 'Not authenticated';

  end if;



  caller_email := lower(coalesce(auth.jwt()->>'email', ''));



  select *

  into inv

  from public.workspace_invites

  where token = invite_token

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



  if lower(inv.email) <> caller_email then

    raise exception 'This invite is for %, but you are signed in as %', inv.email, caller_email;

  end if;



  insert into public.profiles (id, full_name)

  values (auth.uid(), caller_email)

  on conflict (id) do nothing;



  insert into public.workspace_members (workspace_id, user_id, role)

  values (inv.workspace_id, auth.uid(), inv.role)

  on conflict (workspace_id, user_id) do update

    set role = excluded.role;



  update public.workspace_invites

  set accepted_at = now(), accepted_by = auth.uid()

  where id = inv.id;



  return query select inv.workspace_id, inv.role;

end;

$$;


--
-- Name: clear_task_notifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_task_notifications() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  delete from public.notifications

  where link like '%task=' || old.id::text || '%';

  return old;

end;

$$;


--
-- Name: client_can_see_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_can_see_task(p_task_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1

      from public.pm_tasks t

      join public.external_users eu on eu.client_id = t.client_id

     where t.id = p_task_id

       and eu.auth_user_id = auth.uid()

       and eu.role = 'client'

  );

$$;


--
-- Name: client_published_campaigns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.client_published_campaigns() RETURNS TABLE(task_id uuid, task_name text, brand_name text, published_at timestamp with time zone, row_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select t.id,

         coalesce(t.task_name, t.title),

         t.brand_name,

         t.tracking_published_at,

         (select count(*) from public.tracking_rows_published p where p.task_id = t.id)

    from public.pm_tasks t

    join public.external_users eu on eu.client_id = t.client_id

   where eu.auth_user_id = auth.uid()

     and eu.role = 'client'

     and t.tracking_published_at is not null

   order by t.tracking_published_at desc;

$$;


--
-- Name: consume_external_invite(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_external_invite(p_token text, p_auth_user_id uuid) RETURNS TABLE(out_external_user_id uuid, out_role text, out_vendor_id bigint, out_client_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inv public.external_user_invites%rowtype;

  eu_id uuid;

begin

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


--
-- Name: create_workspace_invite(uuid, text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_workspace_invite(ws_id uuid, invite_email text, invite_role text DEFAULT 'member'::text, expires_hours integer DEFAULT 24) RETURNS TABLE(id uuid, token text, email text, role text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  created public.workspace_invites%rowtype;

  hours integer;

begin

  if auth.uid() is null then

    raise exception 'Not authenticated';

  end if;



  if invite_role not in ('owner','admin','operations','sales','marketing','key_account','member') then

    raise exception 'Invalid role: %', invite_role;

  end if;



  if invite_role = 'owner' and not public.has_role(ws_id, array['owner']) then

    raise exception 'Only owners can invite another owner';

  end if;



  if not public.has_role(ws_id, array['owner','admin']) then

    raise exception 'Only owners and admins can invite teammates';

  end if;



  hours := coalesce(expires_hours, 24);

  if hours not in (1, 12, 24) then

    raise exception 'Invalid expires_hours: %', hours;

  end if;



  insert into public.workspace_invites (workspace_id, email, role, invited_by, expires_at)

  values (

    ws_id,

    lower(trim(invite_email)),

    invite_role,

    auth.uid(),

    now() + make_interval(hours => hours)

  )

  returning * into created;



  perform public._log_invite_event(

    created.id, created.workspace_id, created.email, created.role,

    'created', auth.uid(),

    jsonb_build_object('expires_hours', hours)

  );



  return query select created.id, created.token, created.email, created.role, created.expires_at;

end;

$$;


--
-- Name: crm_deals_stage_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.crm_deals_stage_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN

    NEW.stage_changed_at := now();

    IF NEW.stage IN ('won','lost') AND OLD.stage NOT IN ('won','lost') THEN

      NEW.closed_at := now();

    END IF;

    IF NEW.stage NOT IN ('won','lost') AND OLD.stage IN ('won','lost') THEN

      NEW.closed_at := NULL;

    END IF;

  END IF;

  NEW.updated_at := now();

  RETURN NEW;

END;

$$;


--
-- Name: current_external_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_external_user() RETURNS TABLE(id uuid, role text, vendor_id bigint, client_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select id, role, vendor_id, client_id

    from public.external_users

   where auth_user_id = auth.uid()

   limit 1;

$$;


--
-- Name: deleted_tasks(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deleted_tasks(p_workspace_id uuid) RETURNS TABLE(id uuid, task_name text, brand_name text, parent_task_id uuid, deleted_at timestamp with time zone, deleted_by uuid, deleted_by_name text, bookings bigint, days_left integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select t.id,

         coalesce(t.task_name, t.title),

         t.brand_name,

         t.parent_task_id,

         t.deleted_at,

         t.deleted_by,

         p.full_name,

         (select count(*) from public.pm_tasks c

           where c.parent_task_id = t.id and c.deleted_at is not null),

         greatest(0, public.task_recovery_days()

                     - extract(day from now() - t.deleted_at)::int)

    from public.pm_tasks t

    left join public.profiles p on p.id = t.deleted_by

   where t.workspace_id = p_workspace_id

     and t.deleted_at is not null

     and t.parent_task_id is null          -- campaigns; their bookings go with them

     and public.has_role(t.workspace_id, array['owner','admin'])

   order by t.deleted_at desc;

$$;


--
-- Name: enforce_task_field_ownership(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_task_field_ownership() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  insert into public.profiles (id, full_name, avatar_url)

  values (

    new.id,

    coalesce(new.raw_user_meta_data->>'full_name', new.email),

    new.raw_user_meta_data->>'avatar_url'

  )

  on conflict (id) do update

    set full_name = excluded.full_name,

        avatar_url = excluded.avatar_url;

  return new;

end;

$$;


--
-- Name: has_any_workspace(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_any_workspace() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (select 1 from public.workspaces);

$$;


--
-- Name: has_role(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(ws_id uuid, role_names text[]) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1 from public.workspace_members

    where workspace_id = ws_id

      and user_id = auth.uid()

      and role = any(role_names)

  );

$$;


--
-- Name: is_admin_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_of(ws_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1 from public.workspace_members

    where workspace_id = ws_id

      and user_id = auth.uid()

      and role in ('owner','admin')

  );

$$;


--
-- Name: is_manager_or_higher(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_manager_or_higher(ws_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1 from public.workspace_members

    where workspace_id = ws_id

      and user_id = auth.uid()

      and role in ('owner','admin','manager')

  );

$$;


--
-- Name: is_member_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_member_of(ws_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1 from public.workspace_members

    where workspace_id = ws_id and user_id = auth.uid()

  );

$$;


--
-- Name: is_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1 from public.workspace_members where user_id = auth.uid()

  );

$$;


--
-- Name: issue_external_invite(text, text, bigint, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_external_invite(p_email text, p_role text, p_vendor_id bigint, p_client_id uuid, p_actor uuid) RETURNS TABLE(out_id uuid, out_token text, out_email text, out_role text, out_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inserted public.external_user_invites%rowtype;

begin

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


--
-- Name: log_task_event(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_task_event(p_task_id uuid, p_action text, p_details jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_ws   uuid;

  v_name text;

  v_kind text;

begin

  select t.workspace_id,

         coalesce(t.task_name, t.title),

         case when t.parent_task_id is null then 'campaign' else 'booking' end

    into v_ws, v_name, v_kind

    from public.pm_tasks t

   where t.id = p_task_id;



  -- No workspace means no task — nothing to log, and nothing to shout

  -- about. A logger must never be the reason an action fails.

  if v_ws is null then return; end if;



  insert into public.activity_log

    (workspace_id, task_id, user_id, action, details, entity_name, entity_kind)

  values

    (v_ws, p_task_id, auth.uid(), p_action, coalesce(p_details, '{}'::jsonb), v_name, v_kind);

exception when others then

  -- Same rule, stated in code: logging is never allowed to break the thing

  -- it is describing.

  return;

end;

$$;


--
-- Name: looks_like_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.looks_like_email(p text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$

  select p is not null and p ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

$_$;


--
-- Name: normalise_profile_name(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalise_profile_name() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

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


--
-- Name: notify_on_comment_mention(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_comment_mention() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

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


--
-- Name: notify_on_contract_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_contract_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_label   text;

  v_subject text;

begin

  -- Workspace-less or task-less rows have nobody to notify and nowhere

  -- to point at, so skip them rather than writing a broken link.

  if new.workspace_id is null or new.pm_task_id is null then

    return new;

  end if;



  v_label := case

    when new.request_kind = 'client' then 'Client contract requested'

    when new.request_kind = 'vendor' then 'Vendor contract requested'

    else 'Contract requested'

  end;



  -- Most useful one-liner we can build from the row itself.

  v_subject := coalesce(

    nullif(concat_ws(' · ',

      nullif(new.brand_name, ''),

      nullif(coalesce(new.client_name, new.vendor_name), ''),

      case when new.amount is not null then 'SAR ' || trim(to_char(new.amount, 'FM999999999990.00')) end

    ), ''),

    'Open the campaign for details'

  );



  insert into public.notifications (user_id, type, title, body, link)

  select wm.user_id,

         'task_assigned',

         v_label,

         v_subject,

         '/dashboard/workflow?task=' || new.pm_task_id::text

    from public.workspace_members wm

   where wm.workspace_id = new.workspace_id

     and wm.role in ('owner', 'admin', 'operations')

     -- Don't ping the person who just raised it.

     and wm.user_id is distinct from new.requested_by;



  return new;

end;

$$;


--
-- Name: notify_on_document_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_document_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_task record;

begin

  select task_name, title, brand_name, budget

    into v_task

    from public.pm_tasks

   where id = new.pm_task_id;



  insert into public.notifications (user_id, type, title, body, link)

  select wm.user_id,

         'task_assigned',

         initcap(new.doc_kind) || ' requested',

         coalesce(

           nullif(concat_ws(' · ',

             nullif(coalesce(v_task.task_name, v_task.title), ''),

             nullif(v_task.brand_name, ''),

             case when v_task.budget is not null

                  then 'SAR ' || trim(to_char(v_task.budget, 'FM999999999990.00')) end

           ), ''),

           'Open the campaign for details'

         ),

         '/dashboard/workflow?task=' || new.pm_task_id::text

    from public.workspace_members wm

   where wm.workspace_id = new.workspace_id

     and wm.role in ('owner', 'admin', 'operations')

     and wm.user_id is distinct from new.requested_by;



  return new;

end;

$$;


--
-- Name: notify_on_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_on_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  if new.request_status = 'requested'

     and (old.request_status is distinct from new.request_status) then

    insert into public.notifications (user_id, type, title, body, link)

    select wm.user_id, 'task_assigned',

           coalesce(initcap(new.subtask_kind), 'Request') || ' requested',

           coalesce(new.task_name, new.title),

           '/dashboard/workflow?task=' || new.id::text

    from public.workspace_members wm

    where wm.workspace_id = new.workspace_id

      and wm.role in ('owner', 'admin', 'operations');

  end if;

  return new;

end;

$$;


--
-- Name: notify_role(uuid, text[], public.notification_type, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_role(ws_id uuid, role_names text[], n_type public.notification_type, n_title text, n_body text DEFAULT NULL::text, n_link text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  insert into public.notifications (user_id, type, title, body, link)

  select wm.user_id, n_type, n_title, n_body, n_link

  from public.workspace_members wm

  where wm.workspace_id = ws_id

    and wm.role = any(role_names);

end;

$$;


--
-- Name: on_pm_task_stage_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.on_pm_task_stage_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

begin

  -- New task or stage moved to pending_marketing → notify marketing role

  if (tg_op = 'INSERT' and new.stage = 'pending_marketing')

     or (tg_op = 'UPDATE' and new.stage = 'pending_marketing' and old.stage is distinct from 'pending_marketing') then

    perform public.notify_role(

      new.workspace_id,

      array['marketing','admin','owner']::text[],

      'task_assigned'::notification_type,

      'New task awaits triage',

      coalesce(new.task_name, new.title) || ' for ' || coalesce(new.brand_name, '(no brand)'),

      '/dashboard?task=' || new.id::text

    );

  end if;



  -- Stage moved to in_progress → notify the assigned key account

  if tg_op = 'UPDATE' and new.stage = 'in_progress' and old.stage is distinct from 'in_progress' and new.key_account_id is not null then

    insert into public.notifications (user_id, type, title, body, link)

    values (

      new.key_account_id,

      'task_assigned',

      'You are the key account on a new task',

      coalesce(new.task_name, new.title),

      '/dashboard?task=' || new.id::text

    );

  end if;



  -- Stage moved to completed → notify marketing

  if tg_op = 'UPDATE' and new.stage = 'completed' and old.stage is distinct from 'completed' then

    perform public.notify_role(

      new.workspace_id,

      array['marketing','admin','owner']::text[],

      'task_completed'::notification_type,

      'Task completed',

      coalesce(new.task_name, new.title) || ' for ' || coalesce(new.brand_name, '(no brand)'),

      '/dashboard?task=' || new.id::text

    );

  end if;



  return new;

end;

$$;


--
-- Name: publish_tracking_sheet(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.publish_tracking_sheet(p_task_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_workspace uuid;

  v_count     integer;

begin

  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;

  if v_workspace is null then

    raise exception 'No such task: %', p_task_id using errcode = '42704';

  end if;



  if auth.uid() is not null

     and not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then

    raise exception 'You do not have permission to publish this sheet.' using errcode = '42501';

  end if;



  delete from public.tracking_rows_published where task_id = p_task_id;



  -- Shared:     who, where, what, when, status, link, and now which ad.

  -- NOT shared: price_excl, price_incl, notes, contact_number,

  --             license_plate_url — money, internal notes and PII.

  --

  -- If you add a column here, ask whether the client should see it. Landing

  -- in this table is not the same as being readable — 071's column grants

  -- decide that — but the two lists should be reasoned about together.

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


--
-- Name: purge_deleted_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_deleted_tasks() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  r       record;

  v_count integer := 0;

begin

  -- Row by row, on purpose. A single DELETE would be one statement and no

  -- record of WHAT it removed — and a purge is the one event whose subject

  -- is guaranteed not to exist afterwards, so the log has to be written

  -- while the row is still there to describe.

  for r in

    select id from public.pm_tasks

     where deleted_at is not null

       and deleted_at < now() - make_interval(days => public.task_recovery_days())

       and parent_task_id is null        -- children go with the cascade

  loop

    perform public.log_task_event(r.id, 'purged', jsonb_build_object(

      'after_days', public.task_recovery_days()

    ));

    delete from public.pm_tasks where id = r.id;

    v_count := v_count + 1;

  end loop;



  -- Bookings deleted on their own, whose parent is still live.

  for r in

    select id from public.pm_tasks

     where deleted_at is not null

       and deleted_at < now() - make_interval(days => public.task_recovery_days())

  loop

    perform public.log_task_event(r.id, 'purged', jsonb_build_object(

      'after_days', public.task_recovery_days()

    ));

    delete from public.pm_tasks where id = r.id;

    v_count := v_count + 1;

  end loop;



  if v_count > 0 then

    raise notice 'purge_deleted_tasks: removed % task(s) past the recovery window', v_count;

  end if;

  return v_count;

end;

$$;


--
-- Name: record_invite_resend(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_invite_resend(invite_id uuid) RETURNS TABLE(resend_count integer, last_resent_at timestamp with time zone, cooldown_remaining_seconds integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inv public.workspace_invites%rowtype;

  remaining integer;

begin

  if auth.uid() is null then

    raise exception 'Not authenticated';

  end if;



  select * into inv

  from public.workspace_invites

  where id = invite_id

  for update;



  if inv.id is null then

    raise exception 'Invite not found';

  end if;



  if not public.has_role(inv.workspace_id, array['owner','admin']) then

    raise exception 'Only owners and admins can resend invites';

  end if;



  if inv.accepted_at is not null then

    raise exception 'Invite already accepted, cannot resend';

  end if;



  if inv.expires_at <= now() then

    raise exception 'Invite expired, cannot resend';

  end if;



  if inv.last_resent_at is not null then

    remaining := 60 - extract(epoch from (now() - inv.last_resent_at))::integer;

    if remaining > 0 then

      raise exception 'Please wait % seconds before resending', remaining;

    end if;

  end if;



  update public.workspace_invites

  set resend_count = coalesce(resend_count, 0) + 1,

      last_resent_at = now()

  where id = invite_id

  returning * into inv;



  perform public._log_invite_event(

    inv.id, inv.workspace_id, inv.email, inv.role,

    'resent', auth.uid(),

    jsonb_build_object('resend_count', inv.resend_count)

  );



  return query select inv.resend_count, inv.last_resent_at, 0;

end;

$$;


--
-- Name: record_invite_resend_failure(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_invite_resend_failure(invite_id uuid, reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inv public.workspace_invites%rowtype;

begin

  if auth.uid() is null then

    raise exception 'Not authenticated';

  end if;



  select * into inv

  from public.workspace_invites

  where id = invite_id;



  if inv.id is null then

    raise exception 'Invite not found';

  end if;



  if not public.has_role(inv.workspace_id, array['owner','admin']) then

    raise exception 'Only owners and admins can log resend failures';

  end if;



  perform public._log_invite_event(

    inv.id, inv.workspace_id, inv.email, inv.role,

    'resend_failed', auth.uid(),

    jsonb_build_object('reason', coalesce(reason, ''))

  );

end;

$$;


--
-- Name: reissue_external_invite(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reissue_external_invite(p_external_user_id uuid, p_actor uuid) RETURNS TABLE(out_id uuid, out_token text, out_email text, out_role text, out_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  eu       public.external_users%rowtype;

  inserted public.external_user_invites%rowtype;

begin

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


--
-- Name: reject_pending_client(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_pending_client(p_id bigint) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  update public.pending_clients

     set status = 'rejected', reviewed_at = now()

   where id = p_id;

$$;


--
-- Name: reject_pending_vendor(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_pending_vendor(p_id bigint) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  update public.pending_vendors

     set status = 'rejected', reviewed_at = now()

   where id = p_id;

$$;


--
-- Name: restore_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_task(p_task_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_workspace uuid;

  v_deleted   timestamptz;

  v_count     integer;

begin

  select workspace_id, deleted_at into v_workspace, v_deleted

    from public.pm_tasks where id = p_task_id;

  if v_workspace is null then

    raise exception 'No such task: %', p_task_id using errcode = '42704';

  end if;

  if v_deleted is null then return 0; end if;

  if auth.uid() is not null

     and not public.has_role(v_workspace, array['owner','admin']) then

    raise exception 'Only an owner or an admin can restore a task.' using errcode = '42501';

  end if;



  update public.pm_tasks

     set deleted_at = null, deleted_by = null

   where (

     id = p_task_id

     or (parent_task_id = p_task_id and deleted_at between v_deleted - interval '1 second'

                                                       and v_deleted + interval '1 second')

   );



  get diagnostics v_count = row_count;



  perform public.log_task_event(p_task_id, 'restored', jsonb_build_object(

    'rows', v_count,

    'deleted_at', v_deleted

  ));

  return v_count;

end;

$$;


--
-- Name: resync_vendor_sequence(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resync_vendor_sequence() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  seq_name text;

  max_id   bigint;

begin

  select pg_get_serial_sequence('public.vendors', 'id') into seq_name;

  if seq_name is null then return; end if;

  select coalesce(max(id), 0) into max_id from public.vendors;

  if max_id = 0 then

    execute format('select setval(%L, 1, false)', seq_name);

  else

    execute format('select setval(%L, %s, true)', seq_name, max_id);

  end if;

end $$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: soft_delete_task(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.soft_delete_task(p_task_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_workspace uuid;

  v_count     integer;

begin

  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;

  if v_workspace is null then

    raise exception 'No such task: %', p_task_id using errcode = '42704';

  end if;



  if auth.uid() is not null

     and not public.has_role(v_workspace, array['owner','admin']) then

    raise exception 'Only an owner or an admin can delete a task.' using errcode = '42501';

  end if;



  -- Logged BEFORE the stamp, while the task is still readable. Afterwards

  -- the SELECT policy hides it, and log_task_event is security definer for

  -- exactly this reason — but doing it in the readable order costs nothing

  -- and does not depend on that.

  perform public.log_task_event(p_task_id, 'deleted', jsonb_build_object(

    'bookings', (select count(*) from public.pm_tasks c

                  where c.parent_task_id = p_task_id and c.deleted_at is null),

    'recovery_days', public.task_recovery_days()

  ));



  update public.pm_tasks

     set deleted_at = now(), deleted_by = auth.uid()

   where (id = p_task_id or parent_task_id = p_task_id)

     and deleted_at is null;



  get diagnostics v_count = row_count;

  return v_count;

end;

$$;


--
-- Name: FUNCTION soft_delete_task(p_task_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.soft_delete_task(p_task_id uuid) IS 'Hide a task and its bookings. Returns how many rows were stamped. Recoverable for task_recovery_days().';


--
-- Name: sync_booking_money_from_lines(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_booking_money_from_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

declare

  targets uuid[];

  target  uuid;

  total  numeric(14,2);

  netsum numeric(14,2);

  priced boolean;

  hasnet boolean;

begin

  -- Both sides on an update, in case a line was moved between bookings.

  -- `foreach ... in array` takes an expression, not a subquery, so the array

  -- is built first and iterated after.

  select array_agg(distinct x)

    into targets

    from unnest(array[

      case when tg_op in ('UPDATE','DELETE') then old.subtask_id end,

      case when tg_op in ('UPDATE','INSERT') then new.subtask_id end

    ]) as x

   where x is not null;



  if targets is null then

    return null;

  end if;



  foreach target in array targets

  loop

    select

      coalesce(sum(greatest(coalesce(l.quantity, 1), 1) * coalesce(l.unit_price, 0)), 0),

      coalesce(sum(coalesce(l.net_amount, 0)), 0),

      coalesce(bool_or(coalesce(l.unit_price, 0) > 0), false),

      coalesce(bool_or(l.net_amount is not null), false)

      into total, netsum, priced, hasnet

      from public.vendor_ad_lines l

     where l.subtask_id = target;



    -- Unpriced lines leave the booking's own numbers alone. Zero is an

    -- unpriced line, not free work, and overwriting a typed 45,000 with a

    -- zero because nobody has costed the ads yet would be worse than useless.

    if priced then

      update public.pm_tasks

         set price = total,

             net_amount = case when hasnet then netsum else net_amount end

       where id = target

         and (price is distinct from total

              or (hasnet and net_amount is distinct from netsum));

    end if;

  end loop;



  return null;   -- AFTER trigger

end $$;


--
-- Name: FUNCTION sync_booking_money_from_lines(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_booking_money_from_lines() IS 'Keeps pm_tasks.price and net_amount equal to the booking''s priced ad lines. Replaces the app-side syncBookingPriceFromAds(), which only ran when the ad card happened to call it.';


--
-- Name: task_recovery_days(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_recovery_days() RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$ select 30 $$;


--
-- Name: task_workspace_id(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.task_workspace_id(t_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

  select workspace_id from public.pm_tasks where id = t_id;

$$;


--
-- Name: touch_vendor_ad_lines(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_vendor_ad_lines() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

begin

  new.updated_at = now();

  return new;

end $$;


--
-- Name: unnamed_member_label(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unnamed_member_label() RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ select 'Unnamed member'::text $$;


--
-- Name: unpublish_tracking_sheet(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unpublish_tracking_sheet(p_task_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  v_workspace uuid;

begin

  select workspace_id into v_workspace from public.pm_tasks where id = p_task_id;

  if auth.uid() is not null

     and not public.has_role(v_workspace, array['owner','admin','marketing','key_account','operations']) then

    raise exception 'You do not have permission to unpublish this sheet.' using errcode = '42501';

  end if;



  delete from public.tracking_rows_published where task_id = p_task_id;

  update public.pm_tasks

     set tracking_published_at = null, tracking_published_by = null

   where id = p_task_id;

end;

$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

begin

  new.updated_at = now();

  return new;

end;

$$;


--
-- Name: validate_external_invite(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_external_invite(p_token text) RETURNS TABLE(out_valid boolean, out_reason text, out_email text, out_role text, out_vendor_id bigint, out_client_id uuid, out_expires_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inv public.external_user_invites%rowtype;

begin

  select * into inv from public.external_user_invites where token = p_token limit 1;

  if inv.id is null then

    out_valid := false; out_reason := 'Invite not found';

    return next;

    return;

  end if;

  if inv.accepted_at is not null then

    out_valid := false; out_reason := 'Invite already used';

    out_email := inv.email; out_role := inv.role;

    out_vendor_id := inv.vendor_id; out_client_id := inv.client_id;

    out_expires_at := inv.expires_at;

    return next;

    return;

  end if;

  if inv.expires_at <= now() then

    out_valid := false; out_reason := 'Invite expired';

    out_email := inv.email; out_role := inv.role;

    out_vendor_id := inv.vendor_id; out_client_id := inv.client_id;

    out_expires_at := inv.expires_at;

    return next;

    return;

  end if;

  out_valid := true; out_reason := 'OK';

  out_email := inv.email; out_role := inv.role;

  out_vendor_id := inv.vendor_id; out_client_id := inv.client_id;

  out_expires_at := inv.expires_at;

  return next;

end;

$$;


--
-- Name: validate_workspace_invite(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_workspace_invite(invite_token text) RETURNS TABLE(valid boolean, reason text, email text, role text, workspace_name text, expires_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

declare

  inv record;

begin

  select wi.*, w.name as ws_name

  into inv

  from public.workspace_invites wi

  join public.workspaces w on w.id = wi.workspace_id

  where wi.token = invite_token

  limit 1;



  if inv.id is null then

    return query select false, 'Invite not found', null::text, null::text, null::text, null::timestamptz;

    return;

  end if;



  if inv.accepted_at is not null then

    return query select false, 'Invite already used', inv.email, inv.role, inv.ws_name, inv.expires_at;

    return;

  end if;



  if inv.expires_at <= now() then

    return query select false, 'Invite expired', inv.email, inv.role, inv.ws_name, inv.expires_at;

    return;

  end if;



  return query select true, 'OK', inv.email, inv.role, inv.ws_name, inv.expires_at;

end;

$$;


--
-- Name: vendor_is_trackable(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vendor_is_trackable(p_vendor_id bigint) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$

  select exists (

    select 1 from public.vendors v

     where v.id = p_vendor_id

       and lower(trim(coalesce(v.vendor_category, ''))) in (

         'influencer', 'ugc', 'ugc creator', 'user generated content'

       )

  );

$$;


--
-- Name: workspace_member_names(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_member_names(p_workspace uuid) RETURNS TABLE(id uuid, full_name text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$

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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    task_id uuid,
    user_id uuid,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    entity_name text,
    entity_kind text,
    CONSTRAINT activity_log_action_chk CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text, 'completed'::text, 'assigned'::text, 'unassigned'::text, 'commented'::text, 'moved'::text, 'status_changed'::text, 'priority_changed'::text, 'restored'::text, 'purged'::text, 'contract_requested'::text, 'contract_generated'::text, 'sheet_published'::text])))
);


--
-- Name: COLUMN activity_log.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activity_log.user_id IS 'Who did it. NULL means the system did — the nightly purge, or any other scheduled job.';


--
-- Name: COLUMN activity_log.entity_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activity_log.entity_name IS 'What the task was called when this happened. Kept because task_id goes null once the task is purged.';


--
-- Name: COLUMN activity_log.entity_kind; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.activity_log.entity_kind IS 'campaign | booking — which of the two a pm_tasks row was.';


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id bigint NOT NULL,
    actor_username text NOT NULL,
    action text NOT NULL,
    entity_type text DEFAULT ''::text,
    entity_id text DEFAULT ''::text,
    details text DEFAULT ''::text,
    created_at text
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bank_accounts (
    id bigint NOT NULL,
    vendor_id bigint NOT NULL,
    bank_name text NOT NULL,
    account_name text NOT NULL,
    iban text NOT NULL,
    account_number text DEFAULT ''::text,
    swift_code text DEFAULT ''::text
);


--
-- Name: bank_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.bank_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bank_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.bank_accounts_id_seq OWNED BY public.bank_accounts.id;


--
-- Name: client_brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_brands (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    client_id uuid NOT NULL,
    brand_name text NOT NULL,
    brand_logo_url text,
    description text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_categories (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: client_dedupe_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_dedupe_map (
    drop_id uuid NOT NULL,
    keep_id uuid NOT NULL,
    workspace_id uuid,
    company_name text,
    drop_created timestamp with time zone,
    keep_created timestamp with time zone,
    merged_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clients (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    company_name text NOT NULL,
    contact_name text,
    contact_email text,
    contact_phone text,
    industry text,
    notes text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    cr_number text DEFAULT ''::text,
    vat_number text DEFAULT ''::text,
    signatory_name text DEFAULT ''::text,
    company_email text DEFAULT ''::text,
    street text DEFAULT ''::text,
    city text DEFAULT ''::text,
    postcode text DEFAULT ''::text,
    country text DEFAULT ''::text,
    national_address text DEFAULT ''::text,
    pending_client_id bigint,
    invite_status text DEFAULT 'none'::text,
    zoho_customer_id text,
    client_category_id uuid,
    CONSTRAINT clients_invite_status_check CHECK ((invite_status = ANY (ARRAY['none'::text, 'pending_invite'::text, 'invite_sent'::text, 'accepted'::text, 'revoked'::text])))
);


--
-- Name: COLUMN clients.zoho_customer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.clients.zoho_customer_id IS 'Zoho Books contact_id this client maps to. Set via the CRM detail page so the Invoices tab can fetch invoices for the right customer.';


--
-- Name: comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    author_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: contract_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_completions (
    id bigint NOT NULL,
    task_id text NOT NULL,
    brand_name text DEFAULT ''::text,
    amount text DEFAULT '0'::text,
    contract_type text DEFAULT ''::text,
    status text DEFAULT ''::text,
    acceptance_status text DEFAULT 'pending'::text,
    pushed_at text,
    pushed_by text
);


--
-- Name: contract_completions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contract_completions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contract_completions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contract_completions_id_seq OWNED BY public.contract_completions.id;


--
-- Name: contract_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    token text NOT NULL,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    claimed_at timestamp with time zone,
    claimed_by text,
    email_sent_at timestamp with time zone,
    email_error text,
    CONSTRAINT contract_invites_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: contract_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    pm_task_id uuid,
    workspace_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    request_kind text NOT NULL,
    template_key text,
    brand_name text,
    amount numeric(14,2),
    notes text,
    client_name text,
    client_id_legacy text,
    pending_client_id bigint,
    cr_number text,
    vat_number text,
    signatory_name text,
    street text,
    city text,
    postcode text,
    country text,
    email text,
    phone text,
    pending_vendor_id bigint,
    vendor_id bigint,
    vendor_name text,
    vendor_category text,
    vendor_email text,
    vendor_phone text,
    bank_account_id bigint,
    bank_name text,
    account_name text,
    iban text,
    account_number text,
    swift_code text,
    license_number text,
    is_influencer boolean DEFAULT false,
    platforms text,
    ad_type text,
    qty text DEFAULT '1'::text,
    channel text,
    details text,
    status text DEFAULT 'pending'::text NOT NULL,
    generated_contract_id text,
    generated_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    contact_name text,
    platform_handle text,
    payment_terms text,
    payment_split_pct integer,
    payment_net_days integer,
    CONSTRAINT contract_requests_payment_net_days_chk CHECK (((payment_net_days IS NULL) OR ((payment_net_days >= 1) AND (payment_net_days <= 365)))),
    CONSTRAINT contract_requests_payment_split_chk CHECK (((payment_split_pct IS NULL) OR ((payment_split_pct >= 1) AND (payment_split_pct <= 99)))),
    CONSTRAINT contract_requests_payment_terms_chk CHECK (((payment_terms IS NULL) OR (payment_terms = ANY (ARRAY['split'::text, 'on_delivery'::text, 'in_advance'::text, 'net_days'::text])))),
    CONSTRAINT contract_requests_request_kind_check CHECK ((request_kind = ANY (ARRAY['client'::text, 'vendor'::text]))),
    CONSTRAINT contract_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'generated'::text, 'rejected'::text, 'cancelled'::text])))
);


--
-- Name: COLUMN contract_requests.signatory_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.signatory_name IS 'CLIENT contracts only. A vendor request leaves this null — an influencer has no signatory, and requiring one blocked every vendor contract.';


--
-- Name: COLUMN contract_requests.contact_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.contact_name IS 'The person behind the vendor — first and last name, as it should read on the contract. From vendors.contact_name.';


--
-- Name: COLUMN contract_requests.platform_handle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.platform_handle IS 'Their name ON the platform: the handle or profile the ads will be posted from. From vendors.platforms.';


--
-- Name: COLUMN contract_requests.payment_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.payment_terms IS 'split | on_delivery | in_advance | net_days. A snapshot of the booking''s terms at request time.';


--
-- Name: COLUMN contract_requests.payment_split_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.payment_split_pct IS 'For payment_terms = split: the percentage paid up front. 50 means 50/50.';


--
-- Name: COLUMN contract_requests.payment_net_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contract_requests.payment_net_days IS 'For payment_terms = net_days: how many days after delivery payment falls due.';


--
-- Name: crm_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_type text NOT NULL,
    target_id text NOT NULL,
    kind text DEFAULT 'note'::text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    author_id uuid,
    author_name text DEFAULT ''::text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_activities_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'call'::text, 'meeting'::text, 'email'::text, 'status_change'::text]))),
    CONSTRAINT crm_activities_target_type_check CHECK ((target_type = ANY (ARRAY['client'::text, 'vendor'::text])))
);


--
-- Name: crm_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_type text,
    target_id text,
    name text NOT NULL,
    value numeric DEFAULT 0 NOT NULL,
    currency_code text DEFAULT 'SAR'::text NOT NULL,
    stage text DEFAULT 'prospect'::text NOT NULL,
    probability integer,
    expected_close_date date,
    owner_id uuid,
    owner_name text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    stage_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_deals_probability_check CHECK (((probability >= 0) AND (probability <= 100))),
    CONSTRAINT crm_deals_stage_check CHECK ((stage = ANY (ARRAY['prospect'::text, 'qualified'::text, 'proposal'::text, 'negotiation'::text, 'won'::text, 'lost'::text]))),
    CONSTRAINT crm_deals_target_type_check CHECK ((target_type = ANY (ARRAY['client'::text, 'vendor'::text])))
);


--
-- Name: crm_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_type text,
    target_id text,
    deal_id uuid,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    due_at timestamp with time zone,
    assigned_to_id uuid,
    assigned_to_name text DEFAULT ''::text NOT NULL,
    completed_at timestamp with time zone,
    completed_by_id uuid,
    created_by_id uuid,
    created_by_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crm_tasks_target_type_check CHECK ((target_type = ANY (ARRAY['client'::text, 'vendor'::text])))
);


--
-- Name: document_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    pm_task_id uuid NOT NULL,
    doc_kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    document_number text,
    requested_by uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    issued_by uuid,
    issued_at timestamp with time zone,
    CONSTRAINT document_requests_doc_kind_check CHECK ((doc_kind = ANY (ARRAY['quotation'::text, 'invoice'::text]))),
    CONSTRAINT document_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'issued'::text, 'cancelled'::text])))
);


--
-- Name: external_user_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_user_invites (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    vendor_id bigint,
    client_id uuid,
    token text DEFAULT (replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text) || replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    reset_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT external_invites_role_link_chk CHECK ((((role = 'vendor'::text) AND (vendor_id IS NOT NULL)) OR ((role = 'client'::text) AND (client_id IS NOT NULL)))),
    CONSTRAINT external_user_invites_role_check CHECK ((role = ANY (ARRAY['vendor'::text, 'client'::text])))
);


--
-- Name: external_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_users (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    auth_user_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    vendor_id bigint,
    client_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    last_sign_in_at timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    CONSTRAINT external_users_role_check CHECK ((role = ANY (ARRAY['vendor'::text, 'client'::text]))),
    CONSTRAINT external_users_role_link_chk CHECK ((((role = 'vendor'::text) AND (vendor_id IS NOT NULL) AND (client_id IS NULL)) OR ((role = 'client'::text) AND (client_id IS NOT NULL) AND (vendor_id IS NULL))))
);


--
-- Name: generated_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_contracts (
    id bigint NOT NULL,
    contract_id text NOT NULL,
    task_id text,
    brand_name text DEFAULT ''::text,
    amount text DEFAULT '0'::text,
    contract_type text DEFAULT ''::text,
    generated_at text,
    generated_by text,
    docx_path text,
    pdf_path text,
    pdf_error text,
    client_id uuid,
    brand_id uuid,
    vendor_id bigint,
    vendor_name text DEFAULT ''::text,
    license_number text DEFAULT ''::text,
    docx_storage_path text,
    pdf_storage_path text
);


--
-- Name: generated_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.generated_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: generated_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.generated_contracts_id_seq OWNED BY public.generated_contracts.id;


--
-- Name: invite_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invite_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    invite_id uuid,
    workspace_id uuid NOT NULL,
    invite_email text NOT NULL,
    invite_role text NOT NULL,
    action text NOT NULL,
    actor_id uuid,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invite_events_action_check CHECK ((action = ANY (ARRAY['created'::text, 'resent'::text, 'accepted'::text, 'revoked'::text, 'expired'::text, 'role_changed'::text, 'resend_failed'::text])))
);


--
-- Name: labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.labels (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#6366f1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: managed_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managed_vendors (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    company_name text NOT NULL,
    contact_name text,
    contact_email text,
    contact_phone text,
    service_type text,
    industry text,
    address text,
    bank_name text,
    iban text,
    notes text,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: manager_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manager_clients (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    manager_id uuid NOT NULL,
    client_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type public.notification_type NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pending_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_clients (
    id bigint NOT NULL,
    company_name text NOT NULL,
    cr_number text DEFAULT ''::text,
    vat_number text DEFAULT ''::text,
    signatory_name text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    email text DEFAULT ''::text,
    company_email text DEFAULT ''::text,
    street text DEFAULT ''::text,
    city text DEFAULT ''::text,
    postcode text DEFAULT ''::text,
    country text DEFAULT ''::text,
    national_address text DEFAULT ''::text,
    permit_doc text DEFAULT ''::text,
    vat_doc text DEFAULT ''::text,
    national_address_doc text DEFAULT ''::text,
    status text DEFAULT 'pending'::text,
    submitted_at text,
    reviewed_at text
);


--
-- Name: pending_clients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pending_clients_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pending_clients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pending_clients_id_seq OWNED BY public.pending_clients.id;


--
-- Name: pending_vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_vendors (
    id bigint NOT NULL,
    full_name text NOT NULL,
    license_number text DEFAULT ''::text,
    email text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    address_1 text DEFAULT ''::text,
    address_2 text DEFAULT ''::text,
    address_3 text DEFAULT ''::text,
    iban text DEFAULT ''::text,
    bank_name text DEFAULT ''::text,
    account_name text DEFAULT ''::text,
    account_number text DEFAULT ''::text,
    swift_code text DEFAULT ''::text,
    license_expiry text,
    vendor_category text DEFAULT ''::text,
    platforms text DEFAULT ''::text,
    dropoff_locations text DEFAULT ''::text,
    status text DEFAULT 'pending'::text,
    submitted_at text,
    reviewed_at text
);


--
-- Name: pending_vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pending_vendors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pending_vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pending_vendors_id_seq OWNED BY public.pending_vendors.id;


--
-- Name: pm_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pm_tasks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    project_id uuid,
    section_id uuid,
    parent_task_id uuid,
    legacy_task_id text,
    client_id uuid,
    brand_id uuid,
    title text NOT NULL,
    description text,
    status public.task_status DEFAULT 'pending'::public.task_status,
    priority public.task_priority DEFAULT 'none'::public.task_priority,
    assignee_id uuid,
    creator_id uuid NOT NULL,
    due_date date,
    start_date date,
    "position" integer DEFAULT 0,
    completed_at timestamp with time zone,
    estimated_hours numeric(6,2),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    workspace_id uuid,
    task_name text,
    brand_name text,
    legacy_client_id text,
    sales_closer_id uuid,
    budget numeric(14,2),
    service_type_id uuid,
    key_account_id uuid,
    stage public.task_stage DEFAULT 'draft'::public.task_stage,
    vendor_id bigint,
    contract_request_id uuid,
    price numeric(14,2),
    net_amount numeric(14,2),
    aq_gross numeric(14,2) GENERATED ALWAYS AS ((price - net_amount)) STORED,
    platform text,
    ad_type text,
    vendor_payment_date date,
    vendor_payment_amount numeric(14,2),
    source_id uuid,
    client_category_id uuid,
    quotation_no text,
    quotation_breakdown text,
    invoice_no text,
    client_payment_status text,
    client_payment_date date,
    client_payment_amount numeric(14,2),
    contract_status text,
    has_tracking boolean DEFAULT false NOT NULL,
    subtask_kind text,
    request_status text DEFAULT 'not_requested'::text NOT NULL,
    requested_at timestamp with time zone,
    requested_by uuid,
    request_note text,
    package_start_date date,
    package_end_date date,
    ad_quantity integer,
    platforms text[] DEFAULT '{}'::text[] NOT NULL,
    ad_type_custom text,
    approval_stage text,
    quotation_numbers text[] DEFAULT '{}'::text[] NOT NULL,
    invoice_numbers text[] DEFAULT '{}'::text[] NOT NULL,
    net_payment_date date,
    tracking_published_at timestamp with time zone,
    tracking_published_by uuid,
    complexity text,
    media_type text,
    brand_logo_attached boolean DEFAULT false NOT NULL,
    keyword_excel_attached boolean DEFAULT false NOT NULL,
    data_issue_note text,
    insight_link text,
    insight_attached boolean DEFAULT false NOT NULL,
    deliverable_attached boolean DEFAULT false NOT NULL,
    proof_of_posting_attached boolean DEFAULT false NOT NULL,
    proof_of_posting_link text,
    sales_closer_vendor_id bigint,
    sales_closer_influencer boolean DEFAULT false NOT NULL,
    contract_length integer,
    contract_length_unit text,
    payment_terms text,
    payment_split_pct integer,
    payment_net_days integer,
    vendor_cost_override numeric(14,2),
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT pm_tasks_closer_flag_alone CHECK (((NOT sales_closer_influencer) OR ((sales_closer_id IS NULL) AND (sales_closer_vendor_id IS NULL)))),
    CONSTRAINT pm_tasks_contract_length_chk CHECK (((contract_length IS NULL) OR (contract_length > 0))),
    CONSTRAINT pm_tasks_contract_length_pair_chk CHECK (((contract_length IS NULL) = (contract_length_unit IS NULL))),
    CONSTRAINT pm_tasks_contract_length_unit_chk CHECK (((contract_length_unit IS NULL) OR (contract_length_unit = ANY (ARRAY['days'::text, 'weeks'::text, 'months'::text])))),
    CONSTRAINT pm_tasks_one_sales_closer CHECK (((sales_closer_id IS NULL) OR (sales_closer_vendor_id IS NULL))),
    CONSTRAINT pm_tasks_payment_net_days_chk CHECK (((payment_net_days IS NULL) OR ((payment_net_days >= 1) AND (payment_net_days <= 365)))),
    CONSTRAINT pm_tasks_payment_split_chk CHECK (((payment_split_pct IS NULL) OR ((payment_split_pct >= 1) AND (payment_split_pct <= 99)))),
    CONSTRAINT pm_tasks_payment_terms_chk CHECK (((payment_terms IS NULL) OR (payment_terms = ANY (ARRAY['split'::text, 'on_delivery'::text, 'in_advance'::text, 'net_days'::text])))),
    CONSTRAINT pm_tasks_vendor_cost_override_chk CHECK (((vendor_cost_override IS NULL) OR (vendor_cost_override >= (0)::numeric)))
);


--
-- Name: COLUMN pm_tasks.insight_attached; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.insight_attached IS 'Insight lives on the vendor subtask, not a subtask of its own.';


--
-- Name: COLUMN pm_tasks.deliverable_attached; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.deliverable_attached IS 'Campaign design / marketing strategy / visuals / blueprint 3D: is the file in yet?';


--
-- Name: COLUMN pm_tasks.sales_closer_vendor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.sales_closer_vendor_id IS 'Influencer who closed this deal (vendors.id). Mutually exclusive with sales_closer_id.';


--
-- Name: COLUMN pm_tasks.sales_closer_influencer; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.sales_closer_influencer IS 'An influencer closed this deal, unnamed. Exclusive with sales_closer_id and sales_closer_vendor_id.';


--
-- Name: COLUMN pm_tasks.contract_length; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.contract_length IS 'How long the contract runs. On a campaign row this is the client''s term; on a vendor subtask it is that vendor''s. Null = not recorded.';


--
-- Name: COLUMN pm_tasks.contract_length_unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.contract_length_unit IS 'days | weeks | months. Set together with contract_length or not at all.';


--
-- Name: COLUMN pm_tasks.payment_terms; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.payment_terms IS 'split | on_delivery | in_advance | net_days. On a vendor subtask these are that vendor''s terms; on a campaign they are the default.';


--
-- Name: COLUMN pm_tasks.payment_split_pct; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.payment_split_pct IS 'For payment_terms = split: the percentage paid up front. 50 means 50/50.';


--
-- Name: COLUMN pm_tasks.payment_net_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.payment_net_days IS 'For payment_terms = net_days: how many days after delivery payment falls due. 30, 60 and 90 are the usual ones.';


--
-- Name: COLUMN pm_tasks.vendor_cost_override; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.vendor_cost_override IS 'Typed instead of the sum of this campaign''s bookings. Null — the normal state — means the sum stands. Set only when somebody has agreed something the bookings cannot see.';


--
-- Name: COLUMN pm_tasks.deleted_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.deleted_at IS 'When this task was deleted. Non-null rows are invisible to every SELECT (see the RLS policy) and are purged 30 days later.';


--
-- Name: COLUMN pm_tasks.deleted_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pm_tasks.deleted_by IS 'Who deleted it. Kept so the bin can say whose mistake to undo.';


--
-- Name: vendor_ad_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_ad_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subtask_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    ad_type text NOT NULL,
    platform text,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,2) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date,
    description text,
    status text DEFAULT 'Not started'::text NOT NULL,
    proof_of_posting_link text,
    proof_of_posting_attached boolean DEFAULT false NOT NULL,
    posted_on date,
    legacy_total numeric(12,2),
    line_total numeric(12,2) GENERATED ALWAYS AS (((quantity)::numeric * unit_price)) STORED,
    quotation_no text,
    net_amount numeric(12,2),
    net_payment_date date,
    net_payment_status text,
    contract_request_id uuid,
    CONSTRAINT vendor_ad_lines_net_amount_chk CHECK (((net_amount IS NULL) OR (net_amount >= (0)::numeric))),
    CONSTRAINT vendor_ad_lines_net_payment_status_chk CHECK (((net_payment_status IS NULL) OR (net_payment_status = ANY (ARRAY['unpaid'::text, 'paid'::text, 'partial'::text, 'no_payment'::text, 'refund'::text, 'credit'::text, 'adjustment'::text])))),
    CONSTRAINT vendor_ad_lines_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT vendor_ad_lines_status_check CHECK ((status = ANY (ARRAY['Not started'::text, 'Scheduled'::text, 'Shot'::text, 'Posted'::text, 'Cancelled'::text]))),
    CONSTRAINT vendor_ad_lines_unit_price_check CHECK ((unit_price >= (0)::numeric))
);


--
-- Name: TABLE vendor_ad_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.vendor_ad_lines IS 'The individual ads inside one vendor subtask. One contract is written from all of them.';


--
-- Name: COLUMN vendor_ad_lines.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.quantity IS 'How many ads this line stands for. Multiplies the price.';


--
-- Name: COLUMN vendor_ad_lines.unit_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.unit_price IS 'The price of ONE ad on this line. Multiplied by quantity to get line_total. May be 0 — a free reminder is still part of the agreement.';


--
-- Name: COLUMN vendor_ad_lines.due_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.due_date IS 'When this particular ad is due. Lines under one booking often differ.';


--
-- Name: COLUMN vendor_ad_lines.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.description IS 'The brief for this ad specifically — not the booking as a whole.';


--
-- Name: COLUMN vendor_ad_lines.proof_of_posting_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.proof_of_posting_link IS 'Proof for THIS ad. The booking above may hold twelve of them, each posted on its own day.';


--
-- Name: COLUMN vendor_ad_lines.proof_of_posting_attached; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.proof_of_posting_attached IS 'Ticked when the file itself is filed somewhere other than a link.';


--
-- Name: COLUMN vendor_ad_lines.posted_on; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.posted_on IS 'When it actually went up — which is not always the day it was due.';


--
-- Name: COLUMN vendor_ad_lines.legacy_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.legacy_total IS 'What quantity × unit_price came to before 059. Kept so the repricing above can be checked, and can be dropped once it has been.';


--
-- Name: COLUMN vendor_ad_lines.quotation_no; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.quotation_no IS 'Quotation this single ad was quoted under. Ads on one booking can be quoted separately.';


--
-- Name: COLUMN vendor_ad_lines.net_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.net_amount IS 'What AQ nets on this ad. Null = not worked out yet, which is not the same as zero.';


--
-- Name: COLUMN vendor_ad_lines.contract_request_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vendor_ad_lines.contract_request_id IS 'The contract covering this ad. All the lines on a booking pointing at one request is a combined contract; different requests is a split. Null = this ad is not under contract yet.';


--
-- Name: pm_task_campaign_rollup; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.pm_task_campaign_rollup WITH (security_invoker='on') AS
 WITH line_money AS (
         SELECT l.subtask_id,
            sum(((GREATEST(COALESCE(l.quantity, 1), 1))::numeric * COALESCE(l.unit_price, (0)::numeric))) AS ads_total,
            sum(COALESCE(l.net_amount, (0)::numeric)) AS ads_net,
            bool_or((COALESCE(l.unit_price, (0)::numeric) > (0)::numeric)) AS priced,
            bool_or((l.net_amount IS NOT NULL)) AS has_net
           FROM public.vendor_ad_lines l
          WHERE (l.subtask_id IS NOT NULL)
          GROUP BY l.subtask_id
        ), booking AS (
         SELECT child.parent_task_id,
            child.id,
            child.status,
                CASE
                    WHEN COALESCE(lm.priced, false) THEN lm.ads_total
                    ELSE child.price
                END AS effective_price,
                CASE
                    WHEN (COALESCE(lm.priced, false) AND COALESCE(lm.has_net, false)) THEN lm.ads_net
                    ELSE child.net_amount
                END AS effective_net
           FROM (public.pm_tasks child
             LEFT JOIN line_money lm ON ((lm.subtask_id = child.id)))
          WHERE (child.parent_task_id IS NOT NULL)
        )
 SELECT parent.id AS parent_task_id,
    parent.workspace_id,
    parent.title,
    parent.brand_name,
    parent.budget AS parent_total_amount,
    parent.client_payment_status,
    parent.contract_status,
    count(b.id) AS vendor_count,
    count(b.id) FILTER (WHERE (b.status = 'done'::public.task_status)) AS vendors_done,
    COALESCE(sum(b.effective_price), (0)::numeric) AS sum_prices,
    COALESCE(sum(b.effective_net), (0)::numeric) AS sum_nets,
    (COALESCE(sum(b.effective_price), (0)::numeric) - COALESCE(parent.vendor_cost_override, sum(b.effective_net), (0)::numeric)) AS sum_aq_gross,
    (COALESCE(sum(b.effective_price), (0)::numeric) - COALESCE(parent.budget, (0)::numeric)) AS price_vs_total_variance,
    COALESCE(parent.vendor_cost_override, sum(b.effective_net), (0)::numeric) AS vendor_cost,
    ((parent.vendor_cost_override IS NOT NULL) AND (count(b.id) > 0)) AS vendor_cost_overridden
   FROM (public.pm_tasks parent
     LEFT JOIN booking b ON ((b.parent_task_id = parent.id)))
  WHERE (parent.parent_task_id IS NULL)
  GROUP BY parent.id, parent.workspace_id, parent.title, parent.brand_name, parent.budget, parent.client_payment_status, parent.contract_status, parent.vendor_cost_override;


--
-- Name: VIEW pm_task_campaign_rollup; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.pm_task_campaign_rollup IS 'One row per campaign. sum_prices is what the client is billed; vendor_cost is what the vendors take (sum of nets, or the typed override); sum_aq_gross is the difference. Booking money comes from the ad lines when they are priced and from the booking''s own figures when they are not — the same rule the campaign page applies, so the Dashboard and the page cannot disagree.';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    full_name text DEFAULT ''::text NOT NULL,
    avatar_url text,
    job_title text,
    timezone text DEFAULT 'UTC'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT 'blue'::text,
    status text DEFAULT 'active'::text,
    icon text DEFAULT '📁'::text,
    owner_id uuid,
    start_date date,
    due_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'on_hold'::text, 'completed'::text, 'archived'::text])))
);


--
-- Name: sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sections (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: service_type_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_type_steps (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    service_type_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: service_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_types (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid,
    name text NOT NULL,
    icon text DEFAULT '🎯'::text,
    description text,
    is_template boolean DEFAULT false,
    "position" integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: subtasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subtasks (
    id bigint NOT NULL,
    task_id text NOT NULL,
    lic_id text,
    vendor text DEFAULT ''::text,
    license_number text DEFAULT ''::text,
    iban text DEFAULT ''::text,
    channel text DEFAULT ''::text,
    platforms text DEFAULT ''::text,
    ad_type text DEFAULT 'Store Visit'::text,
    qty text DEFAULT '1'::text,
    details text DEFAULT ''::text,
    price text DEFAULT '0'::text,
    paid_at text,
    payment_note text DEFAULT ''::text,
    ad_type_custom text DEFAULT ''::text
);


--
-- Name: subtasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.subtasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: subtasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.subtasks_id_seq OWNED BY public.subtasks.id;


--
-- Name: task_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_assignments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid
);


--
-- Name: task_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_attachments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    uploader_id uuid,
    filename text NOT NULL,
    file_url text NOT NULL,
    file_size bigint,
    mime_type text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_labels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_labels (
    task_id uuid NOT NULL,
    label_id uuid NOT NULL
);


--
-- Name: task_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_members (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_by uuid,
    role text DEFAULT 'collaborator'::text NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_platforms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_platforms (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_service_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_service_types (
    task_id uuid NOT NULL,
    service_type_id uuid NOT NULL,
    "position" integer DEFAULT 0,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: task_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_sources (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id text NOT NULL,
    brand text NOT NULL,
    amount text DEFAULT '0'::text,
    contract_type text DEFAULT 'after_pay'::text,
    status text DEFAULT 'NEW'::text,
    notes text DEFAULT ''::text,
    end_date text,
    created_at text,
    updated_at text,
    duration text DEFAULT ''::text
);


--
-- Name: tracking_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracking_rows (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    influencer_name text DEFAULT ''::text NOT NULL,
    profile_link text DEFAULT ''::text,
    platform text DEFAULT ''::text,
    type_of_ad text DEFAULT ''::text,
    content text DEFAULT ''::text,
    product text DEFAULT ''::text,
    shooting_date date,
    posting_date date,
    ad_status text DEFAULT 'Not started'::text NOT NULL,
    ad_link text DEFAULT ''::text,
    price_excl numeric(12,2) DEFAULT 0 NOT NULL,
    price_incl numeric(12,2) DEFAULT 0 NOT NULL,
    is_event boolean DEFAULT false NOT NULL,
    guest text DEFAULT ''::text,
    location text DEFAULT ''::text,
    visit_time text DEFAULT ''::text,
    license_plate_url text DEFAULT ''::text,
    contact_number text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    ad_line_id uuid,
    ad_line_seq integer,
    subtask_id uuid
);


--
-- Name: tracking_rows_published; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracking_rows_published (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    task_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    influencer_name text DEFAULT ''::text NOT NULL,
    profile_link text DEFAULT ''::text,
    platform text DEFAULT ''::text,
    type_of_ad text DEFAULT ''::text,
    content text DEFAULT ''::text,
    product text DEFAULT ''::text,
    shooting_date date,
    posting_date date,
    ad_status text DEFAULT 'Not started'::text NOT NULL,
    ad_link text DEFAULT ''::text,
    price_excl numeric(12,2) DEFAULT 0 NOT NULL,
    price_incl numeric(12,2) DEFAULT 0 NOT NULL,
    is_event boolean DEFAULT false NOT NULL,
    guest text DEFAULT ''::text,
    location text DEFAULT ''::text,
    visit_time text DEFAULT ''::text,
    license_plate_url text DEFAULT ''::text,
    contact_number text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by uuid,
    source_row_id uuid,
    ad_line_id uuid,
    ad_line_seq integer,
    subtask_id uuid
);


--
-- Name: COLUMN tracking_rows_published.price_excl; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tracking_rows_published.price_excl IS 'NOT shared with the client. Protected by a column grant (071), not the no-op column revoke 046 attempted.';


--
-- Name: COLUMN tracking_rows_published.price_incl; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tracking_rows_published.price_incl IS 'NOT shared with the client. See price_excl.';


--
-- Name: COLUMN tracking_rows_published.ad_line_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tracking_rows_published.ad_line_id IS 'The vendor_ad_lines row this ad came from. Internal only — not in the column grant a portal client holds (071).';


--
-- Name: COLUMN tracking_rows_published.subtask_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tracking_rows_published.subtask_id IS 'The vendor booking this ad belongs to. NEVER granted to a portal client: which vendor is behind which ad is our arrangement, not theirs.';


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    username text NOT NULL,
    email text,
    full_name text,
    password_hash text NOT NULL,
    role text DEFAULT 'member'::text,
    profile_color text DEFAULT '#22c55e'::text,
    profile_icon text DEFAULT '👤'::text,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: vendor_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    requires_license boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vendor_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id bigint NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    file_size bigint DEFAULT 0 NOT NULL,
    mime_type text DEFAULT ''::text NOT NULL,
    uploaded_by uuid,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    slot text DEFAULT ''::text NOT NULL
);


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id bigint NOT NULL,
    name text NOT NULL,
    license_number text,
    created_at text,
    pending_vendor_id bigint,
    email text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    vendor_category text DEFAULT ''::text,
    platforms text DEFAULT ''::text,
    invite_status text DEFAULT 'none'::text,
    category_id uuid,
    id_number text DEFAULT ''::text,
    signatory_name text DEFAULT ''::text,
    contact_name text DEFAULT ''::text,
    vat_number text DEFAULT ''::text,
    details text DEFAULT ''::text,
    location_link text DEFAULT ''::text,
    short_address text DEFAULT ''::text,
    age integer,
    gender text DEFAULT ''::text,
    rental_type text DEFAULT ''::text,
    event_opening text DEFAULT ''::text,
    event_ceremony text DEFAULT ''::text,
    location_type text DEFAULT ''::text,
    CONSTRAINT vendors_invite_status_check CHECK ((invite_status = ANY (ARRAY['none'::text, 'pending_invite'::text, 'invite_sent'::text, 'accepted'::text, 'revoked'::text])))
);


--
-- Name: vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vendors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;


--
-- Name: workspace_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_invites (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    token text DEFAULT (replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text) || replace((extensions.uuid_generate_v4())::text, '-'::text, ''::text)) NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by uuid,
    resend_count integer DEFAULT 0 NOT NULL,
    last_resent_at timestamp with time zone,
    CONSTRAINT workspace_invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'sales'::text, 'marketing'::text, 'key_account'::text, 'member'::text])))
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'sales'::text, 'marketing'::text, 'key_account'::text, 'member'::text])))
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    logo_url text,
    owner_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: bank_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts ALTER COLUMN id SET DEFAULT nextval('public.bank_accounts_id_seq'::regclass);


--
-- Name: contract_completions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_completions ALTER COLUMN id SET DEFAULT nextval('public.contract_completions_id_seq'::regclass);


--
-- Name: generated_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts ALTER COLUMN id SET DEFAULT nextval('public.generated_contracts_id_seq'::regclass);


--
-- Name: pending_clients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_clients ALTER COLUMN id SET DEFAULT nextval('public.pending_clients_id_seq'::regclass);


--
-- Name: pending_vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_vendors ALTER COLUMN id SET DEFAULT nextval('public.pending_vendors_id_seq'::regclass);


--
-- Name: subtasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks ALTER COLUMN id SET DEFAULT nextval('public.subtasks_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vendors id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);


--
-- Name: activity_log activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_accounts bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: client_brands client_brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_brands
    ADD CONSTRAINT client_brands_pkey PRIMARY KEY (id);


--
-- Name: client_categories client_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_categories
    ADD CONSTRAINT client_categories_pkey PRIMARY KEY (id);


--
-- Name: client_categories client_categories_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_categories
    ADD CONSTRAINT client_categories_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: client_dedupe_map client_dedupe_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_dedupe_map
    ADD CONSTRAINT client_dedupe_map_pkey PRIMARY KEY (drop_id);


--
-- Name: clients clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pkey PRIMARY KEY (id);


--
-- Name: comments comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_pkey PRIMARY KEY (id);


--
-- Name: contract_completions contract_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_completions
    ADD CONSTRAINT contract_completions_pkey PRIMARY KEY (id);


--
-- Name: contract_completions contract_completions_task_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_completions
    ADD CONSTRAINT contract_completions_task_id_key UNIQUE (task_id);


--
-- Name: contract_invites contract_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_invites
    ADD CONSTRAINT contract_invites_pkey PRIMARY KEY (id);


--
-- Name: contract_invites contract_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_invites
    ADD CONSTRAINT contract_invites_token_key UNIQUE (token);


--
-- Name: contract_requests contract_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_pkey PRIMARY KEY (id);


--
-- Name: crm_activities crm_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_pkey PRIMARY KEY (id);


--
-- Name: crm_deals crm_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_pkey PRIMARY KEY (id);


--
-- Name: crm_tasks crm_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_pkey PRIMARY KEY (id);


--
-- Name: document_requests document_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_pkey PRIMARY KEY (id);


--
-- Name: external_user_invites external_user_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_user_invites
    ADD CONSTRAINT external_user_invites_pkey PRIMARY KEY (id);


--
-- Name: external_user_invites external_user_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_user_invites
    ADD CONSTRAINT external_user_invites_token_key UNIQUE (token);


--
-- Name: external_users external_users_auth_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_auth_user_id_key UNIQUE (auth_user_id);


--
-- Name: external_users external_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_pkey PRIMARY KEY (id);


--
-- Name: generated_contracts generated_contracts_contract_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts
    ADD CONSTRAINT generated_contracts_contract_id_key UNIQUE (contract_id);


--
-- Name: generated_contracts generated_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts
    ADD CONSTRAINT generated_contracts_pkey PRIMARY KEY (id);


--
-- Name: invite_events invite_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_events
    ADD CONSTRAINT invite_events_pkey PRIMARY KEY (id);


--
-- Name: labels labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);


--
-- Name: managed_vendors managed_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_vendors
    ADD CONSTRAINT managed_vendors_pkey PRIMARY KEY (id);


--
-- Name: manager_clients manager_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clients
    ADD CONSTRAINT manager_clients_pkey PRIMARY KEY (id);


--
-- Name: manager_clients manager_clients_workspace_id_manager_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clients
    ADD CONSTRAINT manager_clients_workspace_id_manager_id_client_id_key UNIQUE (workspace_id, manager_id, client_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: pending_clients pending_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_clients
    ADD CONSTRAINT pending_clients_pkey PRIMARY KEY (id);


--
-- Name: pending_vendors pending_vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_vendors
    ADD CONSTRAINT pending_vendors_pkey PRIMARY KEY (id);


--
-- Name: pm_tasks pm_tasks_ad_quantity_ck; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.pm_tasks
    ADD CONSTRAINT pm_tasks_ad_quantity_ck CHECK (((ad_quantity IS NULL) OR (ad_quantity >= 0))) NOT VALID;


--
-- Name: pm_tasks pm_tasks_approval_stage_ck; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.pm_tasks
    ADD CONSTRAINT pm_tasks_approval_stage_ck CHECK (((approval_stage IS NULL) OR (approval_stage = ANY (ARRAY['ready_for_review'::text, 'changes_needed'::text, 'approved'::text, 'hold'::text, 'cancelled'::text])))) NOT VALID;


--
-- Name: pm_tasks pm_tasks_complexity_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.pm_tasks
    ADD CONSTRAINT pm_tasks_complexity_check CHECK (((complexity IS NULL) OR (complexity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))) NOT VALID;


--
-- Name: pm_tasks pm_tasks_media_type_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.pm_tasks
    ADD CONSTRAINT pm_tasks_media_type_check CHECK (((media_type IS NULL) OR (media_type = ANY (ARRAY['Store Visit'::text, 'Store Visit -Silent-'::text, 'Home Ad'::text, 'Home Ad -Silent-'::text, 'Billboards'::text, 'Sponsorship'::text, 'Usage Rights'::text, 'Event Attending'::text, 'Paid promotion'::text, 'Logistics'::text, 'PhotoShot'::text, 'VideoShot'::text, 'Post'::text, 'Carousel Post'::text, 'Reel'::text, 'Story'::text, 'Video'::text, 'Live'::text, 'Media Production'::text, 'Quote Tweet'::text])))) NOT VALID;


--
-- Name: pm_tasks pm_tasks_package_window_ck; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.pm_tasks
    ADD CONSTRAINT pm_tasks_package_window_ck CHECK (((package_start_date IS NULL) OR (package_end_date IS NULL) OR (package_end_date >= package_start_date))) NOT VALID;


--
-- Name: pm_tasks pm_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: sections sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_pkey PRIMARY KEY (id);


--
-- Name: service_type_steps service_type_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_type_steps
    ADD CONSTRAINT service_type_steps_pkey PRIMARY KEY (id);


--
-- Name: service_type_steps service_type_steps_service_type_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_type_steps
    ADD CONSTRAINT service_type_steps_service_type_id_position_key UNIQUE (service_type_id, "position");


--
-- Name: service_types service_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_types
    ADD CONSTRAINT service_types_pkey PRIMARY KEY (id);


--
-- Name: subtasks subtasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_pkey PRIMARY KEY (id);


--
-- Name: task_assignments task_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_pkey PRIMARY KEY (id);


--
-- Name: task_assignments task_assignments_task_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_task_id_user_id_key UNIQUE (task_id, user_id);


--
-- Name: task_attachments task_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_pkey PRIMARY KEY (id);


--
-- Name: task_labels task_labels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_labels
    ADD CONSTRAINT task_labels_pkey PRIMARY KEY (task_id, label_id);


--
-- Name: task_members task_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_members
    ADD CONSTRAINT task_members_pkey PRIMARY KEY (id);


--
-- Name: task_members task_members_task_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_members
    ADD CONSTRAINT task_members_task_id_user_id_key UNIQUE (task_id, user_id);


--
-- Name: task_platforms task_platforms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_platforms
    ADD CONSTRAINT task_platforms_pkey PRIMARY KEY (id);


--
-- Name: task_platforms task_platforms_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_platforms
    ADD CONSTRAINT task_platforms_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: task_service_types task_service_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_service_types
    ADD CONSTRAINT task_service_types_pkey PRIMARY KEY (task_id, service_type_id);


--
-- Name: task_sources task_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_sources
    ADD CONSTRAINT task_sources_pkey PRIMARY KEY (id);


--
-- Name: task_sources task_sources_workspace_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_sources
    ADD CONSTRAINT task_sources_workspace_id_name_key UNIQUE (workspace_id, name);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tracking_rows tracking_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_rows
    ADD CONSTRAINT tracking_rows_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: vendor_ad_lines vendor_ad_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_ad_lines
    ADD CONSTRAINT vendor_ad_lines_pkey PRIMARY KEY (id);


--
-- Name: vendor_categories vendor_categories_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_categories
    ADD CONSTRAINT vendor_categories_key_key UNIQUE (key);


--
-- Name: vendor_categories vendor_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_categories
    ADD CONSTRAINT vendor_categories_pkey PRIMARY KEY (id);


--
-- Name: vendor_files vendor_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_files
    ADD CONSTRAINT vendor_files_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: workspace_invites workspace_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_pkey PRIMARY KEY (id);


--
-- Name: workspace_invites workspace_invites_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_token_key UNIQUE (token);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: activity_log_ws_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activity_log_ws_created_idx ON public.activity_log USING btree (workspace_id, created_at DESC);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);


--
-- Name: clients_workspace_zoho_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX clients_workspace_zoho_uniq ON public.clients USING btree (workspace_id, zoho_customer_id) WHERE (zoho_customer_id IS NOT NULL);


--
-- Name: contract_invites_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_invites_email_idx ON public.contract_invites USING btree (lower(email));


--
-- Name: contract_invites_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contract_invites_token_idx ON public.contract_invites USING btree (token);


--
-- Name: crm_activities_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_target_idx ON public.crm_activities USING btree (workspace_id, target_type, target_id, occurred_at DESC);


--
-- Name: crm_activities_workspace_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_activities_workspace_recent_idx ON public.crm_activities USING btree (workspace_id, occurred_at DESC);


--
-- Name: crm_deals_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_deals_owner_idx ON public.crm_deals USING btree (workspace_id, owner_id);


--
-- Name: crm_deals_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_deals_target_idx ON public.crm_deals USING btree (workspace_id, target_type, target_id);


--
-- Name: crm_deals_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_deals_workspace_idx ON public.crm_deals USING btree (workspace_id, stage, expected_close_date);


--
-- Name: crm_tasks_assignee_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_assignee_due_idx ON public.crm_tasks USING btree (workspace_id, assigned_to_id, completed_at, due_at);


--
-- Name: crm_tasks_deal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_deal_idx ON public.crm_tasks USING btree (workspace_id, deal_id);


--
-- Name: crm_tasks_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX crm_tasks_target_idx ON public.crm_tasks USING btree (workspace_id, target_type, target_id);


--
-- Name: document_requests_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_requests_open_idx ON public.document_requests USING btree (workspace_id, status) WHERE (status = 'pending'::text);


--
-- Name: document_requests_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_requests_task_idx ON public.document_requests USING btree (pm_task_id, doc_kind);


--
-- Name: generated_contracts_generated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_contracts_generated_at_idx ON public.generated_contracts USING btree (generated_at DESC);


--
-- Name: generated_contracts_task_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_contracts_task_id_idx ON public.generated_contracts USING btree (task_id);


--
-- Name: idx_activity_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_task ON public.activity_log USING btree (task_id);


--
-- Name: idx_activity_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_workspace ON public.activity_log USING btree (workspace_id);


--
-- Name: idx_audit_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_bank_accounts_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bank_accounts_vendor ON public.bank_accounts USING btree (vendor_id);


--
-- Name: idx_client_categories_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_client_categories_ws ON public.client_categories USING btree (workspace_id);


--
-- Name: idx_clients_invite_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_invite_status ON public.clients USING btree (invite_status);


--
-- Name: idx_clients_pending_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clients_pending_client_id ON public.clients USING btree (pending_client_id);


--
-- Name: idx_comments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_task ON public.comments USING btree (task_id);


--
-- Name: idx_contract_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_status ON public.contract_requests USING btree (status);


--
-- Name: idx_contract_requests_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_task ON public.contract_requests USING btree (pm_task_id);


--
-- Name: idx_contract_requests_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contract_requests_workspace ON public.contract_requests USING btree (workspace_id);


--
-- Name: idx_external_invites_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_invites_email ON public.external_user_invites USING btree (lower(email));


--
-- Name: idx_external_invites_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_invites_token ON public.external_user_invites USING btree (token);


--
-- Name: idx_external_users_auth_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_users_auth_user ON public.external_users USING btree (auth_user_id);


--
-- Name: idx_external_users_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_users_client ON public.external_users USING btree (client_id);


--
-- Name: idx_external_users_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_users_vendor ON public.external_users USING btree (vendor_id);


--
-- Name: idx_generated_contracts_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_contracts_at ON public.generated_contracts USING btree (generated_at DESC);


--
-- Name: idx_generated_contracts_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_contracts_brand_id ON public.generated_contracts USING btree (brand_id);


--
-- Name: idx_generated_contracts_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_contracts_client_id ON public.generated_contracts USING btree (client_id);


--
-- Name: idx_generated_contracts_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_contracts_task ON public.generated_contracts USING btree (task_id);


--
-- Name: idx_generated_contracts_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_contracts_vendor_id ON public.generated_contracts USING btree (vendor_id);


--
-- Name: idx_invite_events_invite; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_events_invite ON public.invite_events USING btree (invite_id);


--
-- Name: idx_invite_events_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invite_events_workspace ON public.invite_events USING btree (workspace_id, created_at DESC);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id) WHERE (read = false);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_pm_tasks_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_assignee ON public.pm_tasks USING btree (assignee_id);


--
-- Name: idx_pm_tasks_client_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_client_category_id ON public.pm_tasks USING btree (client_category_id);


--
-- Name: idx_pm_tasks_closer_influencer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_closer_influencer ON public.pm_tasks USING btree (workspace_id) WHERE sales_closer_influencer;


--
-- Name: idx_pm_tasks_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_due_date ON public.pm_tasks USING btree (due_date);


--
-- Name: idx_pm_tasks_key_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_key_account ON public.pm_tasks USING btree (key_account_id);


--
-- Name: idx_pm_tasks_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_project ON public.pm_tasks USING btree (project_id);


--
-- Name: idx_pm_tasks_sales_closer_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_sales_closer_vendor ON public.pm_tasks USING btree (sales_closer_vendor_id) WHERE (sales_closer_vendor_id IS NOT NULL);


--
-- Name: idx_pm_tasks_section; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_section ON public.pm_tasks USING btree (section_id);


--
-- Name: idx_pm_tasks_service_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_service_type ON public.pm_tasks USING btree (service_type_id);


--
-- Name: idx_pm_tasks_source_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_source_id ON public.pm_tasks USING btree (source_id);


--
-- Name: idx_pm_tasks_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_stage ON public.pm_tasks USING btree (stage);


--
-- Name: idx_pm_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_status ON public.pm_tasks USING btree (status);


--
-- Name: idx_pm_tasks_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_vendor_id ON public.pm_tasks USING btree (vendor_id);


--
-- Name: idx_pm_tasks_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pm_tasks_workspace ON public.pm_tasks USING btree (workspace_id);


--
-- Name: idx_service_type_steps_st; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_type_steps_st ON public.service_type_steps USING btree (service_type_id);


--
-- Name: idx_service_types_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_types_ws ON public.service_types USING btree (workspace_id);


--
-- Name: idx_subtasks_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subtasks_task ON public.subtasks USING btree (task_id);


--
-- Name: idx_task_attachments_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_attachments_task ON public.task_attachments USING btree (task_id);


--
-- Name: idx_task_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_members_user ON public.task_members USING btree (user_id);


--
-- Name: idx_task_platforms_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_platforms_ws ON public.task_platforms USING btree (workspace_id);


--
-- Name: idx_task_sources_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_task_sources_ws ON public.task_sources USING btree (workspace_id);


--
-- Name: idx_tracking_rows_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_rows_task ON public.tracking_rows USING btree (task_id);


--
-- Name: idx_vendor_ad_lines_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_ad_lines_due ON public.vendor_ad_lines USING btree (due_date) WHERE (due_date IS NOT NULL);


--
-- Name: idx_vendor_ad_lines_subtask; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_ad_lines_subtask ON public.vendor_ad_lines USING btree (subtask_id, "position");


--
-- Name: idx_vendor_ad_lines_unproven; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_ad_lines_unproven ON public.vendor_ad_lines USING btree (subtask_id) WHERE ((proof_of_posting_attached = false) AND (proof_of_posting_link IS NULL));


--
-- Name: idx_vendor_categories_sort; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_categories_sort ON public.vendor_categories USING btree (sort_order, label);


--
-- Name: idx_vendor_files_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_files_vendor_id ON public.vendor_files USING btree (vendor_id, uploaded_at DESC);


--
-- Name: idx_vendor_files_vendor_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendor_files_vendor_slot ON public.vendor_files USING btree (vendor_id, slot);


--
-- Name: idx_vendors_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_category_id ON public.vendors USING btree (category_id);


--
-- Name: idx_vendors_invite_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_invite_status ON public.vendors USING btree (invite_status);


--
-- Name: idx_vendors_pending_vendor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vendors_pending_vendor_id ON public.vendors USING btree (pending_vendor_id);


--
-- Name: idx_workspace_invites_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_invites_email ON public.workspace_invites USING btree (lower(email));


--
-- Name: idx_workspace_invites_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_invites_token ON public.workspace_invites USING btree (token);


--
-- Name: idx_workspace_invites_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_invites_workspace ON public.workspace_invites USING btree (workspace_id);


--
-- Name: idx_workspace_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_members_user ON public.workspace_members USING btree (user_id);


--
-- Name: idx_workspace_members_ws; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workspace_members_ws ON public.workspace_members USING btree (workspace_id);


--
-- Name: pm_tasks_contract_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_contract_request_idx ON public.pm_tasks USING btree (contract_request_id) WHERE (contract_request_id IS NOT NULL);


--
-- Name: pm_tasks_deleted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_deleted_at_idx ON public.pm_tasks USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: pm_tasks_invoice_numbers_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_invoice_numbers_idx ON public.pm_tasks USING gin (invoice_numbers);


--
-- Name: pm_tasks_parent_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_parent_kind_idx ON public.pm_tasks USING btree (parent_task_id, subtask_kind);


--
-- Name: pm_tasks_platforms_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_platforms_idx ON public.pm_tasks USING gin (platforms);


--
-- Name: pm_tasks_quotation_numbers_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_quotation_numbers_idx ON public.pm_tasks USING gin (quotation_numbers);


--
-- Name: pm_tasks_vendor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pm_tasks_vendor_id_idx ON public.pm_tasks USING btree (vendor_id) WHERE (vendor_id IS NOT NULL);


--
-- Name: tracking_rows_ad_line_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tracking_rows_ad_line_uniq ON public.tracking_rows USING btree (ad_line_id, ad_line_seq) WHERE (ad_line_id IS NOT NULL);


--
-- Name: tracking_rows_published_task_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tracking_rows_published_task_idx ON public.tracking_rows_published USING btree (task_id, "position");


--
-- Name: tracking_rows_subtask_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tracking_rows_subtask_idx ON public.tracking_rows USING btree (subtask_id);


--
-- Name: ux_vendor_files_storage_path; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ux_vendor_files_storage_path ON public.vendor_files USING btree (storage_path);


--
-- Name: vendor_ad_lines_contract_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendor_ad_lines_contract_request_idx ON public.vendor_ad_lines USING btree (contract_request_id) WHERE (contract_request_id IS NOT NULL);


--
-- Name: crm_deals crm_deals_stage_change_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER crm_deals_stage_change_trigger BEFORE UPDATE ON public.crm_deals FOR EACH ROW EXECUTE FUNCTION public.crm_deals_stage_change();


--
-- Name: workspaces on_workspace_created; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_workspace_created AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.add_workspace_owner_as_member();


--
-- Name: pm_tasks pm_task_stage_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pm_task_stage_change AFTER INSERT OR UPDATE OF stage ON public.pm_tasks FOR EACH ROW EXECUTE FUNCTION public.on_pm_task_stage_change();


--
-- Name: pm_tasks trg_clear_task_notifications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_clear_task_notifications AFTER DELETE ON public.pm_tasks FOR EACH ROW EXECUTE FUNCTION public.clear_task_notifications();


--
-- Name: pm_tasks trg_enforce_task_field_ownership; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_task_field_ownership BEFORE UPDATE ON public.pm_tasks FOR EACH ROW EXECUTE FUNCTION public.enforce_task_field_ownership();


--
-- Name: profiles trg_normalise_profile_name; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_normalise_profile_name BEFORE INSERT OR UPDATE OF full_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.normalise_profile_name();


--
-- Name: comments trg_notify_on_comment_mention; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_comment_mention AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment_mention();


--
-- Name: contract_requests trg_notify_on_contract_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_contract_request AFTER INSERT ON public.contract_requests FOR EACH ROW EXECUTE FUNCTION public.notify_on_contract_request();


--
-- Name: document_requests trg_notify_on_document_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_document_request AFTER INSERT ON public.document_requests FOR EACH ROW EXECUTE FUNCTION public.notify_on_document_request();


--
-- Name: pm_tasks trg_notify_on_request; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notify_on_request AFTER UPDATE OF request_status ON public.pm_tasks FOR EACH ROW EXECUTE FUNCTION public.notify_on_request();


--
-- Name: vendor_ad_lines trg_sync_booking_money; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_booking_money AFTER INSERT OR DELETE OR UPDATE ON public.vendor_ad_lines FOR EACH ROW EXECUTE FUNCTION public.sync_booking_money_from_lines();


--
-- Name: vendor_ad_lines trg_touch_vendor_ad_lines; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_vendor_ad_lines BEFORE UPDATE ON public.vendor_ad_lines FOR EACH ROW EXECUTE FUNCTION public.touch_vendor_ad_lines();


--
-- Name: client_brands update_client_brands_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_client_brands_updated_at BEFORE UPDATE ON public.client_brands FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: clients update_clients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: comments update_comments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: managed_vendors update_managed_vendors_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_managed_vendors_updated_at BEFORE UPDATE ON public.managed_vendors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: pm_tasks update_pm_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_pm_tasks_updated_at BEFORE UPDATE ON public.pm_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: profiles update_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: projects update_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: service_types update_service_types_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_service_types_updated_at BEFORE UPDATE ON public.service_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workspaces update_workspaces_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workspace_invites workspace_invites_accept_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_invites_accept_log AFTER UPDATE ON public.workspace_invites FOR EACH ROW EXECUTE FUNCTION public._invite_accepted_trigger();


--
-- Name: workspace_invites workspace_invites_revoke_log; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workspace_invites_revoke_log BEFORE DELETE ON public.workspace_invites FOR EACH ROW EXECUTE FUNCTION public._invite_revoked_trigger();


--
-- Name: activity_log activity_log_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: activity_log activity_log_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE SET NULL;


--
-- Name: activity_log activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: activity_log activity_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_log
    ADD CONSTRAINT activity_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: bank_accounts bank_accounts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bank_accounts
    ADD CONSTRAINT bank_accounts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: client_brands client_brands_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_brands
    ADD CONSTRAINT client_brands_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: client_categories client_categories_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_categories
    ADD CONSTRAINT client_categories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: clients clients_client_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_client_category_id_fkey FOREIGN KEY (client_category_id) REFERENCES public.client_categories(id) ON DELETE SET NULL;


--
-- Name: clients clients_pending_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_pending_client_id_fkey FOREIGN KEY (pending_client_id) REFERENCES public.pending_clients(id) ON DELETE SET NULL;


--
-- Name: clients clients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: clients clients_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT clients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: comments comments_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: comments comments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comments
    ADD CONSTRAINT comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: contract_completions contract_completions_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_completions
    ADD CONSTRAINT contract_completions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: contract_requests contract_requests_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.bank_accounts(id);


--
-- Name: contract_requests contract_requests_pm_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_pm_task_id_fkey FOREIGN KEY (pm_task_id) REFERENCES public.pm_tasks(id) ON DELETE SET NULL;


--
-- Name: contract_requests contract_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);


--
-- Name: contract_requests contract_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: contract_requests contract_requests_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: contract_requests contract_requests_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_requests
    ADD CONSTRAINT contract_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_activities crm_activities_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crm_activities crm_activities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_activities
    ADD CONSTRAINT crm_activities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_deals crm_deals_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crm_deals crm_deals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_deals
    ADD CONSTRAINT crm_deals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_assigned_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_completed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_completed_by_id_fkey FOREIGN KEY (completed_by_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: crm_tasks crm_tasks_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.crm_deals(id) ON DELETE CASCADE;


--
-- Name: crm_tasks crm_tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_tasks
    ADD CONSTRAINT crm_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: document_requests document_requests_pm_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_pm_task_id_fkey FOREIGN KEY (pm_task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: document_requests document_requests_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: external_user_invites external_user_invites_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_user_invites
    ADD CONSTRAINT external_user_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: external_user_invites external_user_invites_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_user_invites
    ADD CONSTRAINT external_user_invites_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: external_user_invites external_user_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_user_invites
    ADD CONSTRAINT external_user_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: external_user_invites external_user_invites_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_user_invites
    ADD CONSTRAINT external_user_invites_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: external_users external_users_auth_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: external_users external_users_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: external_users external_users_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_users
    ADD CONSTRAINT external_users_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: generated_contracts generated_contracts_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts
    ADD CONSTRAINT generated_contracts_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.client_brands(id) ON DELETE SET NULL;


--
-- Name: generated_contracts generated_contracts_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts
    ADD CONSTRAINT generated_contracts_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE SET NULL;


--
-- Name: generated_contracts generated_contracts_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts
    ADD CONSTRAINT generated_contracts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE SET NULL;


--
-- Name: generated_contracts generated_contracts_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_contracts
    ADD CONSTRAINT generated_contracts_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: invite_events invite_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_events
    ADD CONSTRAINT invite_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: invite_events invite_events_invite_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_events
    ADD CONSTRAINT invite_events_invite_id_fkey FOREIGN KEY (invite_id) REFERENCES public.workspace_invites(id) ON DELETE SET NULL;


--
-- Name: invite_events invite_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invite_events
    ADD CONSTRAINT invite_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: labels labels_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: managed_vendors managed_vendors_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_vendors
    ADD CONSTRAINT managed_vendors_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: manager_clients manager_clients_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clients
    ADD CONSTRAINT manager_clients_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id);


--
-- Name: manager_clients manager_clients_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clients
    ADD CONSTRAINT manager_clients_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;


--
-- Name: manager_clients manager_clients_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clients
    ADD CONSTRAINT manager_clients_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: manager_clients manager_clients_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manager_clients
    ADD CONSTRAINT manager_clients_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: pm_tasks pm_tasks_assignee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_client_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_client_category_id_fkey FOREIGN KEY (client_category_id) REFERENCES public.client_categories(id) ON DELETE SET NULL;


--
-- Name: pm_tasks pm_tasks_contract_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_contract_request_id_fkey FOREIGN KEY (contract_request_id) REFERENCES public.contract_requests(id) ON DELETE SET NULL;


--
-- Name: pm_tasks pm_tasks_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_key_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_key_account_id_fkey FOREIGN KEY (key_account_id) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_parent_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: pm_tasks pm_tasks_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: pm_tasks pm_tasks_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_sales_closer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_sales_closer_id_fkey FOREIGN KEY (sales_closer_id) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_sales_closer_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_sales_closer_vendor_id_fkey FOREIGN KEY (sales_closer_vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: pm_tasks pm_tasks_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE SET NULL;


--
-- Name: pm_tasks pm_tasks_service_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_service_type_id_fkey FOREIGN KEY (service_type_id) REFERENCES public.service_types(id);


--
-- Name: pm_tasks pm_tasks_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.task_sources(id) ON DELETE SET NULL;


--
-- Name: pm_tasks pm_tasks_tracking_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_tracking_published_by_fkey FOREIGN KEY (tracking_published_by) REFERENCES public.profiles(id);


--
-- Name: pm_tasks pm_tasks_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: pm_tasks pm_tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pm_tasks
    ADD CONSTRAINT pm_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);


--
-- Name: projects projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sections sections_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sections
    ADD CONSTRAINT sections_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: service_type_steps service_type_steps_service_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_type_steps
    ADD CONSTRAINT service_type_steps_service_type_id_fkey FOREIGN KEY (service_type_id) REFERENCES public.service_types(id) ON DELETE CASCADE;


--
-- Name: service_types service_types_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_types
    ADD CONSTRAINT service_types_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: subtasks subtasks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subtasks
    ADD CONSTRAINT subtasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: task_assignments task_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id);


--
-- Name: task_assignments task_assignments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: task_assignments task_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_assignments
    ADD CONSTRAINT task_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: task_attachments task_attachments_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: task_attachments task_attachments_uploader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_attachments
    ADD CONSTRAINT task_attachments_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: task_labels task_labels_label_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_labels
    ADD CONSTRAINT task_labels_label_id_fkey FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE CASCADE;


--
-- Name: task_labels task_labels_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_labels
    ADD CONSTRAINT task_labels_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: task_members task_members_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_members
    ADD CONSTRAINT task_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.profiles(id);


--
-- Name: task_members task_members_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_members
    ADD CONSTRAINT task_members_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: task_members task_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_members
    ADD CONSTRAINT task_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: task_platforms task_platforms_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_platforms
    ADD CONSTRAINT task_platforms_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: task_service_types task_service_types_service_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_service_types
    ADD CONSTRAINT task_service_types_service_type_id_fkey FOREIGN KEY (service_type_id) REFERENCES public.service_types(id) ON DELETE CASCADE;


--
-- Name: task_service_types task_service_types_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_service_types
    ADD CONSTRAINT task_service_types_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: task_sources task_sources_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_sources
    ADD CONSTRAINT task_sources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tracking_rows tracking_rows_ad_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_rows
    ADD CONSTRAINT tracking_rows_ad_line_id_fkey FOREIGN KEY (ad_line_id) REFERENCES public.vendor_ad_lines(id) ON DELETE SET NULL;


--
-- Name: tracking_rows_published tracking_rows_published_published_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_rows_published
    ADD CONSTRAINT tracking_rows_published_published_by_fkey FOREIGN KEY (published_by) REFERENCES public.profiles(id);


--
-- Name: tracking_rows tracking_rows_subtask_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_rows
    ADD CONSTRAINT tracking_rows_subtask_id_fkey FOREIGN KEY (subtask_id) REFERENCES public.pm_tasks(id) ON DELETE SET NULL;


--
-- Name: tracking_rows tracking_rows_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_rows
    ADD CONSTRAINT tracking_rows_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: vendor_ad_lines vendor_ad_lines_contract_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_ad_lines
    ADD CONSTRAINT vendor_ad_lines_contract_request_id_fkey FOREIGN KEY (contract_request_id) REFERENCES public.contract_requests(id) ON DELETE SET NULL;


--
-- Name: vendor_ad_lines vendor_ad_lines_subtask_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_ad_lines
    ADD CONSTRAINT vendor_ad_lines_subtask_id_fkey FOREIGN KEY (subtask_id) REFERENCES public.pm_tasks(id) ON DELETE CASCADE;


--
-- Name: vendor_files vendor_files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_files
    ADD CONSTRAINT vendor_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: vendor_files vendor_files_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_files
    ADD CONSTRAINT vendor_files_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE;


--
-- Name: vendors vendors_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.vendor_categories(id) ON DELETE SET NULL;


--
-- Name: vendors vendors_pending_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pending_vendor_id_fkey FOREIGN KEY (pending_vendor_id) REFERENCES public.pending_vendors(id) ON DELETE SET NULL;


--
-- Name: workspace_invites workspace_invites_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: workspace_invites workspace_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: workspace_invites workspace_invites_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_invites
    ADD CONSTRAINT workspace_invites_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspaces workspaces_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);


--
-- Name: activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_log activity_log insert by member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "activity_log insert by member" ON public.activity_log FOR INSERT WITH CHECK (public.is_member_of(workspace_id));


--
-- Name: activity_log activity_log select if ws member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "activity_log select if ws member" ON public.activity_log FOR SELECT USING (public.is_member_of(workspace_id));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: bank_accounts bank_accounts scoped read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bank_accounts scoped read" ON public.bank_accounts FOR SELECT USING ((public.is_staff() OR (EXISTS ( SELECT 1
   FROM public.external_users eu
  WHERE ((eu.auth_user_id = auth.uid()) AND (eu.role = 'vendor'::text) AND (eu.vendor_id = bank_accounts.vendor_id))))));


--
-- Name: bank_accounts bank_accounts staff write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "bank_accounts staff write" ON public.bank_accounts USING (public.is_staff()) WITH CHECK (public.is_staff());


--
-- Name: client_brands; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_brands ENABLE ROW LEVEL SECURITY;

--
-- Name: client_brands client_brands all if client visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "client_brands all if client visible" ON public.client_brands USING ((client_id IN ( SELECT clients.id
   FROM public.clients)));


--
-- Name: client_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: client_categories client_categories_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_categories_admin_write ON public.client_categories USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: client_categories client_categories_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY client_categories_member_read ON public.client_categories FOR SELECT USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'operations'::text, 'member'::text]));


--
-- Name: client_dedupe_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.client_dedupe_map ENABLE ROW LEVEL SECURITY;

--
-- Name: clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

--
-- Name: clients clients delete by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients delete by admin" ON public.clients FOR DELETE USING (public.is_admin_of(workspace_id));


--
-- Name: clients clients insert by member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients insert by member" ON public.clients FOR INSERT WITH CHECK (public.is_member_of(workspace_id));


--
-- Name: clients clients read all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients read all" ON public.clients FOR SELECT USING (true);


--
-- Name: clients clients select if ws member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients select if ws member" ON public.clients FOR SELECT USING (public.is_member_of(workspace_id));


--
-- Name: clients clients update by member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "clients update by member" ON public.clients FOR UPDATE USING (public.is_member_of(workspace_id));


--
-- Name: comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

--
-- Name: comments comments delete own or admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "comments delete own or admin" ON public.comments FOR DELETE USING (((auth.uid() = author_id) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text])));


--
-- Name: comments comments insert by author; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "comments insert by author" ON public.comments FOR INSERT WITH CHECK ((auth.uid() = author_id));


--
-- Name: comments comments select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "comments select" ON public.comments FOR SELECT USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: comments comments update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "comments update own" ON public.comments FOR UPDATE USING ((auth.uid() = author_id));


--
-- Name: contract_completions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_completions ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_completions contract_completions staff read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "contract_completions staff read" ON public.contract_completions FOR SELECT USING (public.is_staff());


--
-- Name: contract_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_invites contract_invites staff read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "contract_invites staff read" ON public.contract_invites FOR SELECT USING (public.is_staff());


--
-- Name: contract_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contract_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: contract_requests contract_requests delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "contract_requests delete" ON public.contract_requests FOR DELETE USING (((requested_by = auth.uid()) OR public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text])));


--
-- Name: contract_requests contract_requests insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "contract_requests insert" ON public.contract_requests FOR INSERT WITH CHECK (((auth.uid() = requested_by) AND public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text])));


--
-- Name: contract_requests contract_requests select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "contract_requests select" ON public.contract_requests FOR SELECT USING (public.is_member_of(workspace_id));


--
-- Name: contract_requests contract_requests update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "contract_requests update" ON public.contract_requests FOR UPDATE USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'key_account'::text]));


--
-- Name: crm_activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_activities crm_activities_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_delete ON public.crm_activities FOR DELETE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text])));


--
-- Name: crm_activities crm_activities_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_insert ON public.crm_activities FOR INSERT TO authenticated WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: crm_activities crm_activities_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_select ON public.crm_activities FOR SELECT TO authenticated USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: crm_activities crm_activities_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_activities_update ON public.crm_activities FOR UPDATE TO authenticated USING (((author_id = auth.uid()) OR public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text])));


--
-- Name: crm_deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_deals crm_deals_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_deals_delete ON public.crm_deals FOR DELETE TO authenticated USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: crm_deals crm_deals_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_deals_insert ON public.crm_deals FOR INSERT TO authenticated WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text]));


--
-- Name: crm_deals crm_deals_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_deals_select ON public.crm_deals FOR SELECT TO authenticated USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: crm_deals crm_deals_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_deals_update ON public.crm_deals FOR UPDATE TO authenticated USING (((owner_id = auth.uid()) OR public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text])));


--
-- Name: crm_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_tasks crm_tasks_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_tasks_delete ON public.crm_tasks FOR DELETE TO authenticated USING (((created_by_id = auth.uid()) OR public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text])));


--
-- Name: crm_tasks crm_tasks_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_tasks_insert ON public.crm_tasks FOR INSERT TO authenticated WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: crm_tasks crm_tasks_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_tasks_select ON public.crm_tasks FOR SELECT TO authenticated USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: crm_tasks crm_tasks_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY crm_tasks_update ON public.crm_tasks FOR UPDATE TO authenticated USING (((assigned_to_id = auth.uid()) OR (created_by_id = auth.uid()) OR public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text])));


--
-- Name: document_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: document_requests document_requests_staff_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_requests_staff_delete ON public.document_requests FOR DELETE USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'operations'::text]));


--
-- Name: document_requests document_requests_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_requests_staff_read ON public.document_requests FOR SELECT USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'operations'::text, 'member'::text]));


--
-- Name: document_requests document_requests_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_requests_staff_update ON public.document_requests FOR UPDATE USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'key_account'::text]));


--
-- Name: document_requests document_requests_staff_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_requests_staff_write ON public.document_requests FOR INSERT WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'operations'::text]));


--
-- Name: external_user_invites external_invites no direct update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "external_invites no direct update" ON public.external_user_invites FOR UPDATE USING (false);


--
-- Name: external_user_invites external_invites no direct write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "external_invites no direct write" ON public.external_user_invites FOR INSERT WITH CHECK (false);


--
-- Name: external_user_invites external_invites staff read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "external_invites staff read" ON public.external_user_invites FOR SELECT USING (public.is_staff());


--
-- Name: external_user_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_user_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: external_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_users ENABLE ROW LEVEL SECURITY;

--
-- Name: external_users external_users self read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "external_users self read" ON public.external_users FOR SELECT USING ((auth_user_id = auth.uid()));


--
-- Name: generated_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_contracts generated_contracts staff read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "generated_contracts staff read" ON public.generated_contracts FOR SELECT USING (public.is_staff());


--
-- Name: invite_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invite_events ENABLE ROW LEVEL SECURITY;

--
-- Name: invite_events invite_events no direct insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invite_events no direct insert" ON public.invite_events FOR INSERT WITH CHECK (false);


--
-- Name: invite_events invite_events read by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "invite_events read by admin" ON public.invite_events FOR SELECT USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

--
-- Name: labels labels all if ws member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "labels all if ws member" ON public.labels USING (public.is_member_of(workspace_id));


--
-- Name: managed_vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.managed_vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: managed_vendors managed_vendors all if ws member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "managed_vendors all if ws member" ON public.managed_vendors USING (public.is_member_of(workspace_id));


--
-- Name: manager_clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.manager_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: manager_clients manager_clients select if ws member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manager_clients select if ws member" ON public.manager_clients FOR SELECT USING (public.is_member_of(workspace_id));


--
-- Name: manager_clients manager_clients write by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "manager_clients write by admin" ON public.manager_clients USING (public.is_admin_of(workspace_id));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications select own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "notifications select own" ON public.notifications FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: notifications notifications update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "notifications update own" ON public.notifications FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: pending_clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: pending_vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pm_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: pm_tasks pm_tasks delete by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pm_tasks delete by admin" ON public.pm_tasks FOR DELETE USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: pm_tasks pm_tasks insert by role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pm_tasks insert by role" ON public.pm_tasks FOR INSERT WITH CHECK ((public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'sales'::text, 'marketing'::text]) AND (creator_id = auth.uid())));


--
-- Name: pm_tasks pm_tasks select role aware; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pm_tasks select role aware" ON public.pm_tasks FOR SELECT USING (((deleted_at IS NULL) AND (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text]) OR (assignee_id = auth.uid()) OR (creator_id = auth.uid()) OR (key_account_id = auth.uid()) OR (id IN ( SELECT task_members.task_id
   FROM public.task_members
  WHERE (task_members.user_id = auth.uid()))))));


--
-- Name: pm_tasks pm_tasks update by role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "pm_tasks update by role" ON public.pm_tasks FOR UPDATE USING (((deleted_at IS NULL) AND (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]) OR public.has_role(workspace_id, ARRAY['marketing'::text]) OR (public.has_role(workspace_id, ARRAY['sales'::text]) AND (stage = 'draft'::public.task_stage) AND (creator_id = auth.uid())) OR (key_account_id = auth.uid()) OR (assignee_id = auth.uid()))));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles insert own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles insert own" ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: profiles profiles select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles select" ON public.profiles FOR SELECT USING (true);


--
-- Name: profiles profiles update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE USING ((auth.uid() = id));


--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: projects projects delete by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "projects delete by admin" ON public.projects FOR DELETE USING (public.is_admin_of(workspace_id));


--
-- Name: projects projects insert by member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "projects insert by member" ON public.projects FOR INSERT WITH CHECK (public.is_member_of(workspace_id));


--
-- Name: projects projects select if ws member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "projects select if ws member" ON public.projects FOR SELECT USING (public.is_member_of(workspace_id));


--
-- Name: projects projects update by member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "projects update by member" ON public.projects FOR UPDATE USING (public.is_member_of(workspace_id));


--
-- Name: sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

--
-- Name: sections sections all if project visible; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "sections all if project visible" ON public.sections USING ((project_id IN ( SELECT projects.id
   FROM public.projects)));


--
-- Name: service_type_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_type_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: service_type_steps service_type_steps select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_type_steps select" ON public.service_type_steps FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.service_types s
  WHERE ((s.id = service_type_steps.service_type_id) AND ((s.workspace_id IS NULL) OR public.is_member_of(s.workspace_id))))));


--
-- Name: service_type_steps service_type_steps write admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_type_steps write admin" ON public.service_type_steps USING ((EXISTS ( SELECT 1
   FROM public.service_types s
  WHERE ((s.id = service_type_steps.service_type_id) AND (s.workspace_id IS NOT NULL) AND public.is_admin_of(s.workspace_id)))));


--
-- Name: service_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;

--
-- Name: service_types service_types select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_types select" ON public.service_types FOR SELECT USING (((workspace_id IS NULL) OR public.is_member_of(workspace_id)));


--
-- Name: service_types service_types write by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_types write by admin" ON public.service_types USING (((workspace_id IS NOT NULL) AND public.is_admin_of(workspace_id)));


--
-- Name: subtasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;

--
-- Name: subtasks subtasks staff read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subtasks staff read" ON public.subtasks FOR SELECT USING (public.is_staff());


--
-- Name: task_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_assignments task_assignments all by privileged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_assignments all by privileged" ON public.task_assignments USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'key_account'::text]));


--
-- Name: task_assignments task_assignments select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_assignments select" ON public.task_assignments FOR SELECT USING (((user_id = auth.uid()) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'key_account'::text])));


--
-- Name: task_assignments task_assignments select by task access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_assignments select by task access" ON public.task_assignments FOR SELECT USING (((user_id = auth.uid()) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'key_account'::text])));


--
-- Name: task_assignments task_assignments write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_assignments write" ON public.task_assignments USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'key_account'::text]));


--
-- Name: task_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: task_attachments task_attachments delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_attachments delete" ON public.task_attachments FOR DELETE USING (((auth.uid() = uploader_id) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text])));


--
-- Name: task_attachments task_attachments delete own or admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_attachments delete own or admin" ON public.task_attachments FOR DELETE USING (((auth.uid() = uploader_id) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text])));


--
-- Name: task_attachments task_attachments insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_attachments insert" ON public.task_attachments FOR INSERT WITH CHECK (((auth.uid() = uploader_id) AND public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text])));


--
-- Name: task_attachments task_attachments insert by task access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_attachments insert by task access" ON public.task_attachments FOR INSERT WITH CHECK (((auth.uid() = uploader_id) AND public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text])));


--
-- Name: task_attachments task_attachments select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_attachments select" ON public.task_attachments FOR SELECT USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: task_attachments task_attachments select by task access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_attachments select by task access" ON public.task_attachments FOR SELECT USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: task_labels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_labels ENABLE ROW LEVEL SECURITY;

--
-- Name: task_labels task_labels all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_labels all" ON public.task_labels USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: task_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_members ENABLE ROW LEVEL SECURITY;

--
-- Name: task_members task_members all by privileged; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_members all by privileged" ON public.task_members USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'key_account'::text]));


--
-- Name: task_members task_members select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_members select" ON public.task_members FOR SELECT USING (((user_id = auth.uid()) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'key_account'::text])));


--
-- Name: task_members task_members select by task access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_members select by task access" ON public.task_members FOR SELECT USING (((user_id = auth.uid()) OR public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'key_account'::text])));


--
-- Name: task_members task_members write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_members write" ON public.task_members USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'key_account'::text]));


--
-- Name: task_platforms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_platforms ENABLE ROW LEVEL SECURITY;

--
-- Name: task_platforms task_platforms_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_platforms_admin_write ON public.task_platforms USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: task_platforms task_platforms_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_platforms_member_read ON public.task_platforms FOR SELECT USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'operations'::text, 'member'::text]));


--
-- Name: task_service_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_service_types ENABLE ROW LEVEL SECURITY;

--
-- Name: task_service_types task_service_types select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_service_types select" ON public.task_service_types FOR SELECT USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: task_service_types task_service_types select by task access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_service_types select by task access" ON public.task_service_types FOR SELECT USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: task_service_types task_service_types write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_service_types write" ON public.task_service_types USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text]));


--
-- Name: task_service_types task_service_types write by triage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "task_service_types write by triage" ON public.task_service_types USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'marketing'::text]));


--
-- Name: task_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.task_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: task_sources task_sources_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_sources_admin_write ON public.task_sources USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: task_sources task_sources_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY task_sources_member_read ON public.task_sources FOR SELECT USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'operations'::text, 'member'::text]));


--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks tasks staff read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tasks staff read" ON public.tasks FOR SELECT USING (public.is_staff());


--
-- Name: tracking_rows_published tracking_published_client_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tracking_published_client_read ON public.tracking_rows_published FOR SELECT USING (public.client_can_see_task(task_id));


--
-- Name: tracking_rows_published tracking_published_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tracking_published_staff_read ON public.tracking_rows_published FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.pm_tasks t
  WHERE ((t.id = tracking_rows_published.task_id) AND public.has_role(t.workspace_id, ARRAY['owner'::text, 'admin'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'operations'::text, 'member'::text])))));


--
-- Name: tracking_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracking_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: tracking_rows tracking_rows select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tracking_rows select" ON public.tracking_rows FOR SELECT USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: tracking_rows tracking_rows write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "tracking_rows write" ON public.tracking_rows USING (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text])) WITH CHECK (public.has_role(public.task_workspace_id(task_id), ARRAY['owner'::text, 'admin'::text, 'operations'::text, 'marketing'::text, 'sales'::text, 'key_account'::text, 'member'::text]));


--
-- Name: tracking_rows_published; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracking_rows_published ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_ad_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_ad_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_ad_lines vendor_ad_lines_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_ad_lines_delete ON public.vendor_ad_lines FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.pm_tasks t
  WHERE (t.id = vendor_ad_lines.subtask_id))));


--
-- Name: vendor_ad_lines vendor_ad_lines_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_ad_lines_insert ON public.vendor_ad_lines FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.pm_tasks t
  WHERE (t.id = vendor_ad_lines.subtask_id))));


--
-- Name: vendor_ad_lines vendor_ad_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_ad_lines_select ON public.vendor_ad_lines FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.pm_tasks t
  WHERE (t.id = vendor_ad_lines.subtask_id))));


--
-- Name: vendor_ad_lines vendor_ad_lines_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_ad_lines_update ON public.vendor_ad_lines FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.pm_tasks t
  WHERE (t.id = vendor_ad_lines.subtask_id))));


--
-- Name: vendor_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_categories vendor_categories delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendor_categories delete" ON public.vendor_categories FOR DELETE USING (true);


--
-- Name: vendor_categories vendor_categories read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendor_categories read" ON public.vendor_categories FOR SELECT USING (true);


--
-- Name: vendor_categories vendor_categories update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendor_categories update" ON public.vendor_categories FOR UPDATE USING (true);


--
-- Name: vendor_categories vendor_categories write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendor_categories write" ON public.vendor_categories FOR INSERT WITH CHECK (true);


--
-- Name: vendor_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_files ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_files vendor_files scoped read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendor_files scoped read" ON public.vendor_files FOR SELECT USING ((public.is_staff() OR (EXISTS ( SELECT 1
   FROM public.external_users eu
  WHERE ((eu.auth_user_id = auth.uid()) AND (eu.role = 'vendor'::text) AND (eu.vendor_id = vendor_files.vendor_id))))));


--
-- Name: vendor_files vendor_files staff write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendor_files staff write" ON public.vendor_files USING (public.is_staff()) WITH CHECK (public.is_staff());


--
-- Name: vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: vendors vendors scoped read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendors scoped read" ON public.vendors FOR SELECT USING ((public.is_staff() OR (EXISTS ( SELECT 1
   FROM public.external_users eu
  WHERE ((eu.auth_user_id = auth.uid()) AND (eu.role = 'vendor'::text) AND (eu.vendor_id = vendors.id))))));


--
-- Name: vendors vendors staff write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "vendors staff write" ON public.vendors USING (public.is_staff()) WITH CHECK (public.is_staff());


--
-- Name: workspace_members wm delete by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wm delete by admin" ON public.workspace_members FOR DELETE USING (public.is_admin_of(workspace_id));


--
-- Name: workspace_members wm insert by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wm insert by admin" ON public.workspace_members FOR INSERT WITH CHECK (public.is_admin_of(workspace_id));


--
-- Name: workspace_members wm select if same ws; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wm select if same ws" ON public.workspace_members FOR SELECT USING (public.is_member_of(workspace_id));


--
-- Name: workspace_members wm update by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wm update by admin" ON public.workspace_members FOR UPDATE USING (public.is_admin_of(workspace_id));


--
-- Name: workspace_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_invites workspace_invites select by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace_invites select by admin" ON public.workspace_invites FOR SELECT USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: workspace_invites workspace_invites write by admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace_invites write by admin" ON public.workspace_invites USING (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text])) WITH CHECK (public.has_role(workspace_id, ARRAY['owner'::text, 'admin'::text]));


--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces workspaces insert by self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspaces insert by self" ON public.workspaces FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: workspaces workspaces insert first owner only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspaces insert first owner only" ON public.workspaces FOR INSERT WITH CHECK (((auth.uid() = owner_id) AND (NOT public.has_any_workspace())));


--
-- Name: workspaces workspaces select if owner or member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspaces select if owner or member" ON public.workspaces FOR SELECT USING (((auth.uid() = owner_id) OR public.is_member_of(id)));


--
-- Name: workspaces workspaces update by owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspaces update by owner" ON public.workspaces FOR UPDATE USING ((auth.uid() = owner_id));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION _invite_accepted_trigger(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._invite_accepted_trigger() TO anon;
GRANT ALL ON FUNCTION public._invite_accepted_trigger() TO authenticated;
GRANT ALL ON FUNCTION public._invite_accepted_trigger() TO service_role;


--
-- Name: FUNCTION _invite_revoked_trigger(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._invite_revoked_trigger() TO anon;
GRANT ALL ON FUNCTION public._invite_revoked_trigger() TO authenticated;
GRANT ALL ON FUNCTION public._invite_revoked_trigger() TO service_role;


--
-- Name: FUNCTION _log_invite_event(p_invite_id uuid, p_workspace_id uuid, p_email text, p_role text, p_action text, p_actor uuid, p_detail jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public._log_invite_event(p_invite_id uuid, p_workspace_id uuid, p_email text, p_role text, p_action text, p_actor uuid, p_detail jsonb) TO anon;
GRANT ALL ON FUNCTION public._log_invite_event(p_invite_id uuid, p_workspace_id uuid, p_email text, p_role text, p_action text, p_actor uuid, p_detail jsonb) TO authenticated;
GRANT ALL ON FUNCTION public._log_invite_event(p_invite_id uuid, p_workspace_id uuid, p_email text, p_role text, p_action text, p_actor uuid, p_detail jsonb) TO service_role;


--
-- Name: FUNCTION activity_feed(p_workspace_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.activity_feed(p_workspace_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.activity_feed(p_workspace_id uuid, p_limit integer) TO authenticated;


--
-- Name: FUNCTION add_workspace_owner_as_member(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.add_workspace_owner_as_member() TO anon;
GRANT ALL ON FUNCTION public.add_workspace_owner_as_member() TO authenticated;
GRANT ALL ON FUNCTION public.add_workspace_owner_as_member() TO service_role;


--
-- Name: FUNCTION approve_pending_client(p_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_pending_client(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.approve_pending_client(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.approve_pending_client(p_id bigint) TO service_role;


--
-- Name: FUNCTION approve_pending_vendor(p_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.approve_pending_vendor(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.approve_pending_vendor(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.approve_pending_vendor(p_id bigint) TO service_role;


--
-- Name: FUNCTION claim_workspace_invite(invite_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.claim_workspace_invite(invite_token text) TO anon;
GRANT ALL ON FUNCTION public.claim_workspace_invite(invite_token text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_workspace_invite(invite_token text) TO service_role;


--
-- Name: FUNCTION clear_task_notifications(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.clear_task_notifications() TO anon;
GRANT ALL ON FUNCTION public.clear_task_notifications() TO authenticated;
GRANT ALL ON FUNCTION public.clear_task_notifications() TO service_role;


--
-- Name: FUNCTION client_can_see_task(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_can_see_task(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION public.client_can_see_task(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.client_can_see_task(p_task_id uuid) TO service_role;


--
-- Name: FUNCTION client_published_campaigns(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.client_published_campaigns() TO anon;
GRANT ALL ON FUNCTION public.client_published_campaigns() TO authenticated;
GRANT ALL ON FUNCTION public.client_published_campaigns() TO service_role;


--
-- Name: FUNCTION consume_external_invite(p_token text, p_auth_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.consume_external_invite(p_token text, p_auth_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.consume_external_invite(p_token text, p_auth_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.consume_external_invite(p_token text, p_auth_user_id uuid) TO service_role;


--
-- Name: FUNCTION create_workspace_invite(ws_id uuid, invite_email text, invite_role text, expires_hours integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.create_workspace_invite(ws_id uuid, invite_email text, invite_role text, expires_hours integer) TO anon;
GRANT ALL ON FUNCTION public.create_workspace_invite(ws_id uuid, invite_email text, invite_role text, expires_hours integer) TO authenticated;
GRANT ALL ON FUNCTION public.create_workspace_invite(ws_id uuid, invite_email text, invite_role text, expires_hours integer) TO service_role;


--
-- Name: FUNCTION crm_deals_stage_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.crm_deals_stage_change() TO anon;
GRANT ALL ON FUNCTION public.crm_deals_stage_change() TO authenticated;
GRANT ALL ON FUNCTION public.crm_deals_stage_change() TO service_role;


--
-- Name: FUNCTION current_external_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_external_user() TO anon;
GRANT ALL ON FUNCTION public.current_external_user() TO authenticated;
GRANT ALL ON FUNCTION public.current_external_user() TO service_role;


--
-- Name: FUNCTION deleted_tasks(p_workspace_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.deleted_tasks(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.deleted_tasks(p_workspace_id uuid) TO authenticated;


--
-- Name: FUNCTION enforce_task_field_ownership(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_task_field_ownership() TO anon;
GRANT ALL ON FUNCTION public.enforce_task_field_ownership() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_task_field_ownership() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_any_workspace(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_any_workspace() TO anon;
GRANT ALL ON FUNCTION public.has_any_workspace() TO authenticated;
GRANT ALL ON FUNCTION public.has_any_workspace() TO service_role;


--
-- Name: FUNCTION has_role(ws_id uuid, role_names text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(ws_id uuid, role_names text[]) TO anon;
GRANT ALL ON FUNCTION public.has_role(ws_id uuid, role_names text[]) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(ws_id uuid, role_names text[]) TO service_role;


--
-- Name: FUNCTION is_admin_of(ws_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_admin_of(ws_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_admin_of(ws_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_admin_of(ws_id uuid) TO service_role;


--
-- Name: FUNCTION is_manager_or_higher(ws_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_manager_or_higher(ws_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_manager_or_higher(ws_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_manager_or_higher(ws_id uuid) TO service_role;


--
-- Name: FUNCTION is_member_of(ws_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_member_of(ws_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_member_of(ws_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_member_of(ws_id uuid) TO service_role;


--
-- Name: FUNCTION is_staff(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_staff() TO anon;
GRANT ALL ON FUNCTION public.is_staff() TO authenticated;
GRANT ALL ON FUNCTION public.is_staff() TO service_role;


--
-- Name: FUNCTION issue_external_invite(p_email text, p_role text, p_vendor_id bigint, p_client_id uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.issue_external_invite(p_email text, p_role text, p_vendor_id bigint, p_client_id uuid, p_actor uuid) TO anon;
GRANT ALL ON FUNCTION public.issue_external_invite(p_email text, p_role text, p_vendor_id bigint, p_client_id uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.issue_external_invite(p_email text, p_role text, p_vendor_id bigint, p_client_id uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION log_task_event(p_task_id uuid, p_action text, p_details jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_task_event(p_task_id uuid, p_action text, p_details jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_task_event(p_task_id uuid, p_action text, p_details jsonb) TO authenticated;


--
-- Name: FUNCTION looks_like_email(p text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.looks_like_email(p text) TO anon;
GRANT ALL ON FUNCTION public.looks_like_email(p text) TO authenticated;
GRANT ALL ON FUNCTION public.looks_like_email(p text) TO service_role;


--
-- Name: FUNCTION normalise_profile_name(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.normalise_profile_name() TO anon;
GRANT ALL ON FUNCTION public.normalise_profile_name() TO authenticated;
GRANT ALL ON FUNCTION public.normalise_profile_name() TO service_role;


--
-- Name: FUNCTION notify_on_comment_mention(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_on_comment_mention() TO anon;
GRANT ALL ON FUNCTION public.notify_on_comment_mention() TO authenticated;
GRANT ALL ON FUNCTION public.notify_on_comment_mention() TO service_role;


--
-- Name: FUNCTION notify_on_contract_request(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_on_contract_request() TO anon;
GRANT ALL ON FUNCTION public.notify_on_contract_request() TO authenticated;
GRANT ALL ON FUNCTION public.notify_on_contract_request() TO service_role;


--
-- Name: FUNCTION notify_on_document_request(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_on_document_request() TO anon;
GRANT ALL ON FUNCTION public.notify_on_document_request() TO authenticated;
GRANT ALL ON FUNCTION public.notify_on_document_request() TO service_role;


--
-- Name: FUNCTION notify_on_request(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_on_request() TO anon;
GRANT ALL ON FUNCTION public.notify_on_request() TO authenticated;
GRANT ALL ON FUNCTION public.notify_on_request() TO service_role;


--
-- Name: FUNCTION notify_role(ws_id uuid, role_names text[], n_type public.notification_type, n_title text, n_body text, n_link text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.notify_role(ws_id uuid, role_names text[], n_type public.notification_type, n_title text, n_body text, n_link text) TO anon;
GRANT ALL ON FUNCTION public.notify_role(ws_id uuid, role_names text[], n_type public.notification_type, n_title text, n_body text, n_link text) TO authenticated;
GRANT ALL ON FUNCTION public.notify_role(ws_id uuid, role_names text[], n_type public.notification_type, n_title text, n_body text, n_link text) TO service_role;


--
-- Name: FUNCTION on_pm_task_stage_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.on_pm_task_stage_change() TO anon;
GRANT ALL ON FUNCTION public.on_pm_task_stage_change() TO authenticated;
GRANT ALL ON FUNCTION public.on_pm_task_stage_change() TO service_role;


--
-- Name: FUNCTION publish_tracking_sheet(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.publish_tracking_sheet(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION public.publish_tracking_sheet(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.publish_tracking_sheet(p_task_id uuid) TO service_role;


--
-- Name: FUNCTION purge_deleted_tasks(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.purge_deleted_tasks() FROM PUBLIC;
GRANT ALL ON FUNCTION public.purge_deleted_tasks() TO service_role;


--
-- Name: FUNCTION record_invite_resend(invite_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.record_invite_resend(invite_id uuid) TO anon;
GRANT ALL ON FUNCTION public.record_invite_resend(invite_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.record_invite_resend(invite_id uuid) TO service_role;


--
-- Name: FUNCTION record_invite_resend_failure(invite_id uuid, reason text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.record_invite_resend_failure(invite_id uuid, reason text) TO anon;
GRANT ALL ON FUNCTION public.record_invite_resend_failure(invite_id uuid, reason text) TO authenticated;
GRANT ALL ON FUNCTION public.record_invite_resend_failure(invite_id uuid, reason text) TO service_role;


--
-- Name: FUNCTION reissue_external_invite(p_external_user_id uuid, p_actor uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reissue_external_invite(p_external_user_id uuid, p_actor uuid) TO anon;
GRANT ALL ON FUNCTION public.reissue_external_invite(p_external_user_id uuid, p_actor uuid) TO authenticated;
GRANT ALL ON FUNCTION public.reissue_external_invite(p_external_user_id uuid, p_actor uuid) TO service_role;


--
-- Name: FUNCTION reject_pending_client(p_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_pending_client(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.reject_pending_client(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.reject_pending_client(p_id bigint) TO service_role;


--
-- Name: FUNCTION reject_pending_vendor(p_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.reject_pending_vendor(p_id bigint) TO anon;
GRANT ALL ON FUNCTION public.reject_pending_vendor(p_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.reject_pending_vendor(p_id bigint) TO service_role;


--
-- Name: FUNCTION restore_task(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.restore_task(p_task_id uuid) TO authenticated;


--
-- Name: FUNCTION resync_vendor_sequence(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.resync_vendor_sequence() TO anon;
GRANT ALL ON FUNCTION public.resync_vendor_sequence() TO authenticated;
GRANT ALL ON FUNCTION public.resync_vendor_sequence() TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION soft_delete_task(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.soft_delete_task(p_task_id uuid) TO authenticated;


--
-- Name: FUNCTION sync_booking_money_from_lines(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_booking_money_from_lines() TO anon;
GRANT ALL ON FUNCTION public.sync_booking_money_from_lines() TO authenticated;
GRANT ALL ON FUNCTION public.sync_booking_money_from_lines() TO service_role;


--
-- Name: FUNCTION task_recovery_days(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.task_recovery_days() TO authenticated;


--
-- Name: FUNCTION task_workspace_id(t_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.task_workspace_id(t_id uuid) TO anon;
GRANT ALL ON FUNCTION public.task_workspace_id(t_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.task_workspace_id(t_id uuid) TO service_role;


--
-- Name: FUNCTION touch_vendor_ad_lines(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_vendor_ad_lines() TO anon;
GRANT ALL ON FUNCTION public.touch_vendor_ad_lines() TO authenticated;
GRANT ALL ON FUNCTION public.touch_vendor_ad_lines() TO service_role;


--
-- Name: FUNCTION unnamed_member_label(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.unnamed_member_label() TO anon;
GRANT ALL ON FUNCTION public.unnamed_member_label() TO authenticated;
GRANT ALL ON FUNCTION public.unnamed_member_label() TO service_role;


--
-- Name: FUNCTION unpublish_tracking_sheet(p_task_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.unpublish_tracking_sheet(p_task_id uuid) TO anon;
GRANT ALL ON FUNCTION public.unpublish_tracking_sheet(p_task_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.unpublish_tracking_sheet(p_task_id uuid) TO service_role;


--
-- Name: FUNCTION update_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;


--
-- Name: FUNCTION validate_external_invite(p_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_external_invite(p_token text) TO anon;
GRANT ALL ON FUNCTION public.validate_external_invite(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.validate_external_invite(p_token text) TO service_role;


--
-- Name: FUNCTION validate_workspace_invite(invite_token text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.validate_workspace_invite(invite_token text) TO anon;
GRANT ALL ON FUNCTION public.validate_workspace_invite(invite_token text) TO authenticated;
GRANT ALL ON FUNCTION public.validate_workspace_invite(invite_token text) TO service_role;


--
-- Name: FUNCTION vendor_is_trackable(p_vendor_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.vendor_is_trackable(p_vendor_id bigint) TO anon;
GRANT ALL ON FUNCTION public.vendor_is_trackable(p_vendor_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.vendor_is_trackable(p_vendor_id bigint) TO service_role;


--
-- Name: FUNCTION workspace_member_names(p_workspace uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.workspace_member_names(p_workspace uuid) TO anon;
GRANT ALL ON FUNCTION public.workspace_member_names(p_workspace uuid) TO authenticated;
GRANT ALL ON FUNCTION public.workspace_member_names(p_workspace uuid) TO service_role;


--
-- Name: TABLE activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.activity_log TO anon;
GRANT ALL ON TABLE public.activity_log TO authenticated;
GRANT ALL ON TABLE public.activity_log TO service_role;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO service_role;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: SEQUENCE audit_logs_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.audit_logs_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.audit_logs_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.audit_logs_id_seq TO service_role;


--
-- Name: TABLE bank_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.bank_accounts TO authenticated;
GRANT ALL ON TABLE public.bank_accounts TO service_role;


--
-- Name: SEQUENCE bank_accounts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.bank_accounts_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.bank_accounts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.bank_accounts_id_seq TO service_role;


--
-- Name: TABLE client_brands; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_brands TO anon;
GRANT ALL ON TABLE public.client_brands TO authenticated;
GRANT ALL ON TABLE public.client_brands TO service_role;


--
-- Name: TABLE client_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_categories TO anon;
GRANT ALL ON TABLE public.client_categories TO authenticated;
GRANT ALL ON TABLE public.client_categories TO service_role;


--
-- Name: TABLE client_dedupe_map; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.client_dedupe_map TO service_role;


--
-- Name: TABLE clients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.clients TO anon;
GRANT ALL ON TABLE public.clients TO authenticated;
GRANT ALL ON TABLE public.clients TO service_role;


--
-- Name: TABLE comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.comments TO anon;
GRANT ALL ON TABLE public.comments TO authenticated;
GRANT ALL ON TABLE public.comments TO service_role;


--
-- Name: TABLE contract_completions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contract_completions TO authenticated;
GRANT ALL ON TABLE public.contract_completions TO service_role;


--
-- Name: SEQUENCE contract_completions_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.contract_completions_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.contract_completions_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.contract_completions_id_seq TO service_role;


--
-- Name: TABLE contract_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contract_invites TO authenticated;
GRANT ALL ON TABLE public.contract_invites TO service_role;


--
-- Name: TABLE contract_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contract_requests TO anon;
GRANT ALL ON TABLE public.contract_requests TO authenticated;
GRANT ALL ON TABLE public.contract_requests TO service_role;


--
-- Name: TABLE crm_activities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crm_activities TO anon;
GRANT ALL ON TABLE public.crm_activities TO authenticated;
GRANT ALL ON TABLE public.crm_activities TO service_role;


--
-- Name: TABLE crm_deals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crm_deals TO anon;
GRANT ALL ON TABLE public.crm_deals TO authenticated;
GRANT ALL ON TABLE public.crm_deals TO service_role;


--
-- Name: TABLE crm_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.crm_tasks TO anon;
GRANT ALL ON TABLE public.crm_tasks TO authenticated;
GRANT ALL ON TABLE public.crm_tasks TO service_role;


--
-- Name: TABLE document_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_requests TO anon;
GRANT ALL ON TABLE public.document_requests TO authenticated;
GRANT ALL ON TABLE public.document_requests TO service_role;


--
-- Name: TABLE external_user_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_user_invites TO authenticated;
GRANT ALL ON TABLE public.external_user_invites TO service_role;


--
-- Name: TABLE external_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_users TO anon;
GRANT ALL ON TABLE public.external_users TO authenticated;
GRANT ALL ON TABLE public.external_users TO service_role;


--
-- Name: TABLE generated_contracts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.generated_contracts TO authenticated;
GRANT ALL ON TABLE public.generated_contracts TO service_role;


--
-- Name: SEQUENCE generated_contracts_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.generated_contracts_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.generated_contracts_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.generated_contracts_id_seq TO service_role;


--
-- Name: TABLE invite_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invite_events TO anon;
GRANT ALL ON TABLE public.invite_events TO authenticated;
GRANT ALL ON TABLE public.invite_events TO service_role;


--
-- Name: TABLE labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.labels TO anon;
GRANT ALL ON TABLE public.labels TO authenticated;
GRANT ALL ON TABLE public.labels TO service_role;


--
-- Name: TABLE managed_vendors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.managed_vendors TO anon;
GRANT ALL ON TABLE public.managed_vendors TO authenticated;
GRANT ALL ON TABLE public.managed_vendors TO service_role;


--
-- Name: TABLE manager_clients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.manager_clients TO anon;
GRANT ALL ON TABLE public.manager_clients TO authenticated;
GRANT ALL ON TABLE public.manager_clients TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE pending_clients; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.pending_clients TO anon;
GRANT ALL ON TABLE public.pending_clients TO authenticated;
GRANT ALL ON TABLE public.pending_clients TO service_role;


--
-- Name: SEQUENCE pending_clients_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.pending_clients_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.pending_clients_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.pending_clients_id_seq TO service_role;


--
-- Name: TABLE pending_vendors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.pending_vendors TO anon;
GRANT ALL ON TABLE public.pending_vendors TO authenticated;
GRANT ALL ON TABLE public.pending_vendors TO service_role;


--
-- Name: SEQUENCE pending_vendors_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.pending_vendors_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.pending_vendors_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.pending_vendors_id_seq TO service_role;


--
-- Name: TABLE pm_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pm_tasks TO anon;
GRANT ALL ON TABLE public.pm_tasks TO authenticated;
GRANT ALL ON TABLE public.pm_tasks TO service_role;


--
-- Name: TABLE vendor_ad_lines; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendor_ad_lines TO anon;
GRANT ALL ON TABLE public.vendor_ad_lines TO authenticated;
GRANT ALL ON TABLE public.vendor_ad_lines TO service_role;


--
-- Name: TABLE pm_task_campaign_rollup; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pm_task_campaign_rollup TO authenticated;
GRANT ALL ON TABLE public.pm_task_campaign_rollup TO service_role;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO anon;
GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sections TO anon;
GRANT ALL ON TABLE public.sections TO authenticated;
GRANT ALL ON TABLE public.sections TO service_role;


--
-- Name: TABLE service_type_steps; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_type_steps TO anon;
GRANT ALL ON TABLE public.service_type_steps TO authenticated;
GRANT ALL ON TABLE public.service_type_steps TO service_role;


--
-- Name: TABLE service_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_types TO anon;
GRANT ALL ON TABLE public.service_types TO authenticated;
GRANT ALL ON TABLE public.service_types TO service_role;


--
-- Name: TABLE subtasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subtasks TO authenticated;
GRANT ALL ON TABLE public.subtasks TO service_role;


--
-- Name: SEQUENCE subtasks_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.subtasks_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.subtasks_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.subtasks_id_seq TO service_role;


--
-- Name: TABLE task_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_assignments TO anon;
GRANT ALL ON TABLE public.task_assignments TO authenticated;
GRANT ALL ON TABLE public.task_assignments TO service_role;


--
-- Name: TABLE task_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_attachments TO anon;
GRANT ALL ON TABLE public.task_attachments TO authenticated;
GRANT ALL ON TABLE public.task_attachments TO service_role;


--
-- Name: TABLE task_labels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_labels TO anon;
GRANT ALL ON TABLE public.task_labels TO authenticated;
GRANT ALL ON TABLE public.task_labels TO service_role;


--
-- Name: TABLE task_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_members TO anon;
GRANT ALL ON TABLE public.task_members TO authenticated;
GRANT ALL ON TABLE public.task_members TO service_role;


--
-- Name: TABLE task_platforms; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_platforms TO anon;
GRANT ALL ON TABLE public.task_platforms TO authenticated;
GRANT ALL ON TABLE public.task_platforms TO service_role;


--
-- Name: TABLE task_service_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_service_types TO anon;
GRANT ALL ON TABLE public.task_service_types TO authenticated;
GRANT ALL ON TABLE public.task_service_types TO service_role;


--
-- Name: TABLE task_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.task_sources TO anon;
GRANT ALL ON TABLE public.task_sources TO authenticated;
GRANT ALL ON TABLE public.task_sources TO service_role;


--
-- Name: TABLE tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tasks TO authenticated;
GRANT ALL ON TABLE public.tasks TO service_role;


--
-- Name: TABLE tracking_rows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tracking_rows TO anon;
GRANT ALL ON TABLE public.tracking_rows TO authenticated;
GRANT ALL ON TABLE public.tracking_rows TO service_role;


--
-- Name: TABLE tracking_rows_published; Type: ACL; Schema: public; Owner: -
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.tracking_rows_published TO anon;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.tracking_rows_published TO authenticated;
GRANT ALL ON TABLE public.tracking_rows_published TO service_role;


--
-- Name: COLUMN tracking_rows_published.id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(id) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(id) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.task_id; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(task_id) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(task_id) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published."position"; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT("position") ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT("position") ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.influencer_name; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(influencer_name) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(influencer_name) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.profile_link; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(profile_link) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(profile_link) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.platform; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(platform) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(platform) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.type_of_ad; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(type_of_ad) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(type_of_ad) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.content; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(content) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(content) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.product; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(product) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(product) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.shooting_date; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(shooting_date) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(shooting_date) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.posting_date; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(posting_date) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(posting_date) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.ad_status; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ad_status) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(ad_status) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.ad_link; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(ad_link) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(ad_link) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.created_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(created_at) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(created_at) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.updated_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(updated_at) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(updated_at) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: COLUMN tracking_rows_published.published_at; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT(published_at) ON TABLE public.tracking_rows_published TO anon;
GRANT SELECT(published_at) ON TABLE public.tracking_rows_published TO authenticated;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: SEQUENCE users_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.users_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.users_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.users_id_seq TO service_role;


--
-- Name: TABLE vendor_categories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendor_categories TO anon;
GRANT ALL ON TABLE public.vendor_categories TO authenticated;
GRANT ALL ON TABLE public.vendor_categories TO service_role;


--
-- Name: TABLE vendor_files; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendor_files TO anon;
GRANT ALL ON TABLE public.vendor_files TO authenticated;
GRANT ALL ON TABLE public.vendor_files TO service_role;


--
-- Name: TABLE vendors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendors TO anon;
GRANT ALL ON TABLE public.vendors TO authenticated;
GRANT ALL ON TABLE public.vendors TO service_role;


--
-- Name: SEQUENCE vendors_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.vendors_id_seq TO anon;
GRANT SELECT,USAGE ON SEQUENCE public.vendors_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.vendors_id_seq TO service_role;


--
-- Name: TABLE workspace_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_invites TO anon;
GRANT ALL ON TABLE public.workspace_invites TO authenticated;
GRANT ALL ON TABLE public.workspace_invites TO service_role;


--
-- Name: TABLE workspace_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspace_members TO anon;
GRANT ALL ON TABLE public.workspace_members TO authenticated;
GRANT ALL ON TABLE public.workspace_members TO service_role;


--
-- Name: TABLE workspaces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.workspaces TO anon;
GRANT ALL ON TABLE public.workspaces TO authenticated;
GRANT ALL ON TABLE public.workspaces TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--


