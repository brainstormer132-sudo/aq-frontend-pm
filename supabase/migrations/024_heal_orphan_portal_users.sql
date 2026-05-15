-- =============================================================================
-- 024 — Heal orphan portal auth users
-- =============================================================================
--
-- For every auth.users row that has no matching public.external_users row,
-- try to link it: invite-by-email first, then vendor.email, then
-- clients.company_email/contact_email, then the placeholder
-- "vendor-{id}@local.aqcreativity" / "client-{uuid}@local.aqcreativity"
-- format used by admin-create.
--
-- Safe to re-run.

do $$
declare
  au record;
  inv_row record;
  v_row   record;
  c_row   record;
  linked_count int := 0;
begin
  for au in
    select u.id, u.email
      from auth.users u
     where u.email is not null
       and not exists (
         select 1 from public.external_users eu where eu.auth_user_id = u.id
       )
  loop
    -- 1. Match by invite email.
    select i.role, i.vendor_id, i.client_id
      into inv_row
      from public.external_user_invites i
     where lower(i.email) = lower(au.email)
     order by i.accepted_at nulls last, i.created_at desc
     limit 1;

    if found and inv_row.role is not null then
      insert into public.external_users
        (auth_user_id, email, role, vendor_id, client_id)
      values (au.id, lower(au.email), inv_row.role, inv_row.vendor_id, inv_row.client_id)
      on conflict (auth_user_id) do nothing;
      linked_count := linked_count + 1;
      raise notice 'Linked % via invite (% -> %)',
        au.email, inv_row.role,
        coalesce(inv_row.vendor_id::text, inv_row.client_id::text);
      continue;
    end if;

    -- 2. Match by vendors.email
    select v.id as vid into v_row
      from public.vendors v
     where lower(coalesce(v.email,'')) = lower(au.email)
     limit 1;
    if found then
      insert into public.external_users
        (auth_user_id, email, role, vendor_id, client_id)
      values (au.id, lower(au.email), 'vendor', v_row.vid, null)
      on conflict (auth_user_id) do nothing;
      update public.vendors set invite_status = 'accepted' where id = v_row.vid;
      linked_count := linked_count + 1;
      raise notice 'Linked % via vendor.email (vendor %)', au.email, v_row.vid;
      continue;
    end if;

    -- 3. Match by clients.company_email or contact_email
    select c.id as cid into c_row
      from public.clients c
     where lower(coalesce(c.company_email,'')) = lower(au.email)
        or lower(coalesce(c.contact_email,''))  = lower(au.email)
     limit 1;
    if found then
      insert into public.external_users
        (auth_user_id, email, role, vendor_id, client_id)
      values (au.id, lower(au.email), 'client', null, c_row.cid)
      on conflict (auth_user_id) do nothing;
      update public.clients set invite_status = 'accepted' where id = c_row.cid;
      linked_count := linked_count + 1;
      raise notice 'Linked % via client email (client %)', au.email, c_row.cid;
      continue;
    end if;

    -- 4. Placeholder pattern: vendor-{id}@local.aqcreativity
    if au.email like 'vendor-%@local.aqcreativity' then
      begin
        insert into public.external_users
          (auth_user_id, email, role, vendor_id, client_id)
        select au.id, lower(au.email), 'vendor',
               nullif(replace(replace(au.email,'vendor-',''),'@local.aqcreativity',''),'')::bigint,
               null
        where exists (
          select 1 from public.vendors
           where id = nullif(replace(replace(au.email,'vendor-',''),'@local.aqcreativity',''),'')::bigint
        )
        on conflict (auth_user_id) do nothing;
        if found then
          linked_count := linked_count + 1;
          raise notice 'Linked % via vendor placeholder', au.email;
        end if;
      exception when others then
        raise notice 'Skipped vendor placeholder for % (%)', au.email, sqlerrm;
      end;
      continue;
    end if;

    -- 5. Placeholder pattern: client-{uuid}@local.aqcreativity
    if au.email like 'client-%@local.aqcreativity' then
      begin
        insert into public.external_users
          (auth_user_id, email, role, vendor_id, client_id)
        select au.id, lower(au.email), 'client', null,
               nullif(replace(replace(au.email,'client-',''),'@local.aqcreativity',''),'')::uuid
        where exists (
          select 1 from public.clients
           where id = nullif(replace(replace(au.email,'client-',''),'@local.aqcreativity',''),'')::uuid
        )
        on conflict (auth_user_id) do nothing;
        if found then
          linked_count := linked_count + 1;
          raise notice 'Linked % via client placeholder', au.email;
        end if;
      exception when others then
        raise notice 'Skipped client placeholder for % (%)', au.email, sqlerrm;
      end;
    end if;
  end loop;

  raise notice 'Done. Linked % auth user(s) to external_users.', linked_count;
end $$;

-- Verify after running:
--   select count(*) from auth.users u
--    where u.email is not null
--      and not exists (select 1 from public.external_users eu where eu.auth_user_id = u.id);
-- should return 0 (or only PM-side admin users).
