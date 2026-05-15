-- =============================================================================
-- 022 — Auto-resync the vendors PK sequence on every insert path
-- =============================================================================
--
-- Problem: even after migration 019 reset the sequence once, drift keeps
-- happening because rows occasionally get inserted with explicit ids
-- (e.g. when a pending_vendors row is approved that already had a
-- forced id, or after a partial reset). Inserting a new vendor then
-- raises "duplicate key value violates unique constraint vendors_pkey".
--
-- Fix: call resync_vendor_sequence() at the top of every insert path so
-- drift is impossible — the sequence is bumped to max(id) + 1 before each
-- new insert.

-- 1. Re-define resync_vendor_sequence to actually run setval
create or replace function public.resync_vendor_sequence()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seq_name text;
  max_id   bigint;
begin
  select pg_get_serial_sequence('public.vendors', 'id') into seq_name;
  if seq_name is null then
    return;
  end if;
  select coalesce(max(id), 0) into max_id from public.vendors;
  -- setval(<seq>, <value>, true) means "next nextval() returns value+1".
  -- When max_id = 0 we set the sequence to 1 with is_called=false so the
  -- very first insert returns 1, not 2.
  if max_id = 0 then
    execute format('select setval(%L, 1, false)', seq_name);
  else
    execute format('select setval(%L, %s, true)', seq_name, max_id);
  end if;
end $$;

grant execute on function public.resync_vendor_sequence() to anon, authenticated, service_role;

-- 2. Bake the resync into approve_pending_vendor so the bridge can never
--    cause drift even when the row is forced.
create or replace function public.approve_pending_vendor(p_id bigint)
returns table (vendor_id bigint, was_already_approved boolean)
language plpgsql
security definer
set search_path = public
as $$
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

grant execute on function public.approve_pending_vendor(bigint) to anon, authenticated;

-- 3. One-shot: resync now so the next manual-create succeeds even before
--    any restart.
select public.resync_vendor_sequence();

-- Verification:
--   select pg_get_serial_sequence('public.vendors','id');
--   select last_value, is_called from <sequence-name>;
--   select max(id) from public.vendors;
