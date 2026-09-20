-- ============================================================
-- 110_legal_contract_lists.sql   GENERATED - do not hand-edit.
--   node scripts/build-legal-lists.mjs
--
-- The platform and the ad type become chosen, not typed - and Arabic.
--
-- Siraj: "platform should be a drop down chosabel list", "ad type should be
-- drop down", "all arabic except price (number) and the channel name". Both
-- fields are already enumerations everywhere else in this app; typing them
-- free-hand into a contract is how the same ad type ends up spelled three
-- ways in one register.
--
-- The managed list's VALUE prints into the contract and its LABEL is what the
-- dropdown shows. Both are Arabic here. The price keeps its formatted number
-- and the template's own currency word; the channel name stays free text,
-- because a handle is a handle in any language.
--
-- These six are the contract's own words, from clauses 25-26 of
-- contract-template-ar.js, not a translation choice:
--   platform Instagram
--   platform TikTok
--   platform Snapchat
--   ad type Post
--   ad type Reel
--   ad type Story
-- The rest are ordinary Arabic for the term and can be changed on the Manage
-- lists screen without a migration.
--
-- Per workspace, and only where the legal field registry exists, so this is a
-- no-op on a workspace that has never opened Legal.
--
-- Idempotent: lists upsert on (workspace_id, key), values on (list_id, value),
-- and re-pointing a field at the list it already has changes nothing.
-- Run in staging, then prod. Then: notify pgrst.
--
-- NOTE ON EXISTING DRAFTS: a value already typed into one of these two fields
-- that is not in the list will now fail validation and block Issue until it is
-- re-chosen. That is the point of the change. No contract has been issued at
-- the time of writing, and an issued contract's fields are frozen and its
-- fingerprint is over the stored values - neither of which this touches.
-- ============================================================

set search_path = legal, public;

do $lists$
declare
  v_ws   uuid;
  v_list uuid;
  i      integer;
  n_ex   integer;
  -- The platform list, Arabic. Index-aligned with plat_en below.
  plat_ar text[] := array[
    'انستقرام',
    'تيك توك',
    'سناب تشات',
    'إكس',
    'يوتيوب',
    'فيسبوك',
    'لينكد إن',
    'إعلان خارجي'
  ];
  -- The English term each one came from, used only to spot a workspace's own
  -- task_platforms entry that is NOT one of these, so a platform an admin
  -- added by hand is carried over rather than silently dropped.
  plat_en text[] := array[
    'Instagram',
    'TikTok',
    'Snapchat',
    'X',
    'YouTube',
    'Facebook',
    'LinkedIn',
    'Outdoor'
  ];
  ad_ar text[] := array[
    'زيارة متجر',
    'زيارة متجر - صامتة',
    'إعلان منزلي',
    'إعلان منزلي - صامت',
    'لوحات إعلانية',
    'رعاية',
    'حقوق الاستخدام',
    'حضور فعالية',
    'ترويج مدفوع',
    'خدمات لوجستية',
    'تصوير فوتوغرافي',
    'تصوير فيديو',
    'بوست',
    'بوست متعدد الصور',
    'رييل',
    'ستوري',
    'فيديو',
    'بث مباشر',
    'إنتاج إعلامي',
    'إعادة نشر مع تعليق',
    'خدمات متعددة'
  ];
begin
  for v_ws in
    select distinct p.workspace_id from legal.placeholder p
     where p.key in ('platform_smart', 'ad_types')
  loop
    -- ---- platforms ------------------------------------------------
    insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'platforms', 'Platforms', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name
    returning id into v_list;

    for i in 1 .. array_length(plat_ar, 1) loop
      insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
      values (v_list, v_ws, plat_ar[i], plat_ar[i], i, true)
      on conflict (list_id, value) do nothing;
    end loop;

    -- Anything this workspace uses that is not one of the known eight, kept
    -- verbatim: guessing at the Arabic for a platform somebody typed in is
    -- worse than leaving it as they wrote it. Legal can rename it on the
    -- Manage lists screen.
    insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    select v_list, v_ws, btrim(tp.name), btrim(tp.name),
           100 + tp."position", true
      from public.task_platforms tp
     where tp.workspace_id = v_ws
       and coalesce(btrim(tp.name), '') <> ''
       and not (tp.name = any (plat_en))
    on conflict (list_id, value) do nothing;
    get diagnostics n_ex = row_count;
    if n_ex > 0 then
      raise notice 'workspace %: carried over % platform(s) not in the known list', v_ws, n_ex;
    end if;

    update legal.placeholder
       set field_type = 'list', list_id = v_list
     where workspace_id = v_ws and key = 'platform_smart';

    -- ---- ad types -------------------------------------------------
    insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'ad_types', 'Ad types', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name
    returning id into v_list;

    for i in 1 .. array_length(ad_ar, 1) loop
      insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
      values (v_list, v_ws, ad_ar[i], ad_ar[i], i, true)
      on conflict (list_id, value) do nothing;
    end loop;

    update legal.placeholder
       set field_type = 'list', list_id = v_list
     where workspace_id = v_ws and key = 'ad_types';

    raise notice 'workspace %: platform + ad type lists wired', v_ws;
  end loop;
end
$lists$;
