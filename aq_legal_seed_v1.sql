-- ============================================================
-- seed_influencer_template_v1.sql
-- Seeds the v1.0 influencer marketing contract into legal.*:
--   31 managed lists, 112 typed fields, 1 template (v1, published),
--   100 blocks (20 clauses + parties + preamble + outputs table).
-- Idempotent: lists/fields upsert by key; template+blocks seed once
-- (skipped if version 1 already exists), so re-running never trips the
-- published-version freeze. Resolves the single workspace, or raises.
-- ============================================================
set search_path = legal, public;
do $seed$
declare
  v_ws   uuid;
  v_n    integer;
  v_tpl  uuid;
  v_ver  uuid;
  v_list uuid;
begin
  v_ws := '874c6670-29d9-48f1-97a4-ccbc0e54208b';  -- AQ Creativity (live workspace)
  if not exists (select 1 from public.workspaces where id = v_ws) then
    raise exception 'seed: target workspace % not found', v_ws;
  end if;
  raise notice 'seeding legal template into workspace %', v_ws;

  -- 1. managed lists + values ---------------------------------
  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'contract_types', 'أنواع عقود المؤثرين', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مقدم الدفع', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مؤجل الدفع', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مجزأ', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'company_signatories', 'موقّعو الشركة', 'admin')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'أحمد قرنفلة — المدير العام', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'party_kind', 'صفة المتعاقد', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'فرد', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'منشأة', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'id_types', 'أنواع الهوية', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'هوية وطنية', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'إقامة', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'جواز سفر', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'nationalities', 'الجنسيات', 'admin')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'قائمة الدول المعتمدة', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'cities', 'المدن', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'جدة', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الرياض', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الدمام', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مكة', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'المدينة', '', 4, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الخبر', '', 5, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, '…', '', 6, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'product_categories', 'فئات المنتجات', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'أغذية ومشروبات', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مكمّلات غذائية', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مستحضرات تجميل', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'أجهزة طبية', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'أدوية', '', 4, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'خدمات مالية', '', 5, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'تجزئة وأزياء', '', 6, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'عقار', '', 7, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'سياحة وضيافة', '', 8, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'تقنية', '', 9, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'أخرى', '', 10, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'regulators', 'الجهات الرقابية', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الهيئة العامة للغذاء والدواء', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'البنك المركزي السعودي', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'وزارة الصحة', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'وزارة التجارة', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'لا ينطبق', '', 4, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'platforms', 'المنصات', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'إنستغرام', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'تيك توك', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'سناب شات', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'يوتيوب', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'إكس', '', 4, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'لينكدإن', '', 5, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'ad_types', 'أنواع الإعلانات', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'بوست', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'ريلز', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'ستوري', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'فيديو يوتيوب', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'بث مباشر', '', 4, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'تغطية فعالية', '', 5, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'content_languages', 'لغات المحتوى', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'عربي', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'إنجليزي', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مختلط', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'influencer_directory', 'دليل المؤثرين', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'يُقرأ من سجل الموردين', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'payment_modes', 'أساليب الدفع', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مقدم بالكامل', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مؤجل بعد النشر', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مجزأ (مقدم + رصيد)', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'advance_timing', 'مواعيد الدفعة المقدمة', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'قبل النشر', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'خلال (ن) أيام من التوقيع', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'payment_methods', 'وسائل الدفع', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'حوالة بنكية', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'محفظة إلكترونية', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'banks', 'البنوك', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مصرف الإنماء', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الأهلي السعودي', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الراجحي', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الرياض', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'البلاد', '', 4, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, '…', '', 5, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'currencies', 'العملات', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'ريال سعودي', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'دولار أمريكي', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'درهم إماراتي', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'يورو', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'vat_forms', 'صيغ الضريبة', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'تُضاف ضريبة القيمة المضافة بالنسبة النظامية المقررة', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'المبلغ شامل ضريبة القيمة المضافة', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'لا تنطبق', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'vat_status', 'حالة التسجيل الضريبي', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مسجل', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'غير مسجل', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'tax_residency', 'الإقامة الضريبية', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مقيم في المملكة', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'غير مقيم', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'wht_rates', 'نسب الاستقطاع', 'finance')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'لا ينطبق', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'بالنسبة النظامية المقررة', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'نسبة محددة (ن%)', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'license_start', 'بداية الترخيص', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'من تاريخ النشر', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'من تاريخ العقد', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'geo_scopes', 'النطاقات الجغرافية', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'المملكة العربية السعودية', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'دول الخليج', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الشرق الأوسط', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'عالمي', '', 3, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'dispute_modes', 'آليات فض النزاع', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'المحكمة التجارية', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'التحكيم', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'jurisdiction_cities', 'المدن القضائية', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'جدة', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الرياض', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'الدمام', '', 2, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'arbitration_centers', 'مراكز التحكيم', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'المركز السعودي للتحكيم التجاري', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'signature_modes', 'أساليب التوقيع', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'توقيع إلكتروني عبر المنصة', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'توقيع ورقي', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'products_brands', 'المنتجات والعلامات', 'operations')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'yes_no', 'نعم / لا', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'نعم', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'لا', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'on_off', 'مفعّل / غير مفعّل', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'مفعّل', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'غير مفعّل', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  insert into legal.managed_list (workspace_id, key, name, owner_dept)
    values (v_ws, 'includes_excludes', 'يشمل / لا يشمل', 'legal')
    on conflict (workspace_id, key) do update set name = excluded.name, owner_dept = excluded.owner_dept
    returning id into v_list;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'يشمل', '', 0, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;
  insert into legal.managed_list_value (list_id, workspace_id, value, label, position, active)
    values (v_list, v_ws, 'لا يشمل', '', 1, true)
    on conflict (list_id, value) do update set position = excluded.position, active = true;

  -- 2. typed field registry ----------------------------------
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_NO', 'رقم العقد', 'تسلسل النظام', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_DATE', 'تاريخ التحرير (ميلادي)', '—', 'date', 'date', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_HIJRI', 'التاريخ الهجري', 'محسوب', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_DAY', 'اليوم', 'محسوب', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_TYPE', 'نوع العقد', 'أنواع عقود المؤثرين', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'contract_types'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_NAME', 'اسم الشركة', 'إعدادات الشركة', 'auto', 'auto', false, 'شركة رواد التأثير', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_CR', 'السجل التجاري', 'إعدادات الشركة', 'auto', 'auto', false, '4030381472', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_UNI', 'الرقم الوطني الموحد', 'إعدادات الشركة', 'auto', 'auto', false, '7017229233', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_VAT', 'الرقم الضريبي', 'إعدادات الشركة', 'auto', 'auto', false, '314899928700003', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_ADDR', 'العنوان', 'إعدادات الشركة', 'auto', 'auto', false, 'المملكة العربية السعودية، جدة، حي الفيصلية، طريق المدينة المنورة الفرعي', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_ZIP', 'الرمز البريدي', 'إعدادات الشركة', 'auto', 'auto', false, '23442', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_REP', 'الممثل النظامي', 'موقّعو الشركة', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'company_signatories'), 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_TITLE', 'صفة الممثل', 'سجل الموقّع', 'auto', 'auto', false, 'المدير العام', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_BANK', 'بنك الشركة', 'إعدادات الشركة', 'auto', 'auto', false, '', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_ACCNAME', 'اسم حساب الشركة', 'إعدادات الشركة', 'auto', 'auto', false, '', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_ACCNO', 'رقم حساب الشركة', 'إعدادات الشركة', 'auto', 'auto', false, '', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P1_IBAN', 'آيبان الشركة', 'إعدادات الشركة', 'auto', 'auto', false, '', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_TYPE', 'صفة الطرف الثاني', 'صفة المتعاقد', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'party_kind'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_NAME', 'الاسم الرباعي أو الاسم التجاري', '—', 'text', 'text', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_NAT', 'الجنسية', 'الجنسيات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'nationalities'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_IDTYPE', 'نوع الهوية', 'أنواع الهوية', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'id_types'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_IDNO', 'رقم الهوية', '—', 'text', 'text', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_DOB', 'تاريخ الميلاد', '—', 'date', 'date', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_CITY', 'المدينة', 'المدن', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'cities'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_DIST', 'الحي', '—', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_ZIP', 'الرمز البريدي', '—', 'number', 'number', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_MAIL', 'البريد الإلكتروني', '—', 'text', 'text', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_PHONE', 'الجوال', '—', 'text', 'text', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_CR', 'السجل التجاري', '—', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_UNI', 'الرقم الوطني الموحد', '—', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_VATNO', 'الرقم الضريبي', '—', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_REP', 'الممثل النظامي وصفته', '—', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'P2_POA', 'سند التفويض', '—', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_LIC', 'رقم التصريح الإعلاني', '—', 'text', 'text', true, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_LICEXP', 'تاريخ انتهاء التصريح', '—', 'date', 'date', true, '', null, null, null, 'finance', 30)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_VATST', 'حالة التسجيل في القيمة المضافة', 'حالة التسجيل الضريبي', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'vat_status'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_VATNO', 'رقم التسجيل الضريبي', '—', 'text', 'text', false, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_RES', 'الإقامة الضريبية', 'الإقامة الضريبية', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'tax_residency'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_WHT', 'نسبة ضريبة الاستقطاع', 'نسب الاستقطاع', 'list', 'list', false, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'wht_rates'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'RG_NOTIFYH', 'مهلة الإخطار بإيقاف التصريح', '—', 'number', 'number', true, '24', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PR_ITEMS', 'المنتجات محل الترويج', 'المنتجات والعلامات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'products_brands'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PR_CAT', 'الفئة النظامية', 'فئات المنتجات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'product_categories'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PR_REG', 'الجهة الرقابية', 'محسوب من الفئة', 'auto', 'auto', false, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_INF', 'المؤثر (عمود)', 'دليل المؤثرين', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'influencer_directory'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_PLAT', 'المنصة (عمود)', 'المنصات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'platforms'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_ACC', 'الحساب (عمود)', 'سجل المؤثر', 'auto', 'auto', false, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_TYPE', 'نوع الإعلان (عمود)', 'أنواع الإعلانات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'ad_types'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_QTY', 'العدد (عمود)', '—', 'number', 'number', true, '', 1, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_DUR', 'المدة بالثواني (عمود)', '—', 'number', 'number', false, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_LANG', 'اللغة (عمود)', 'لغات المحتوى', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'content_languages'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_DRAFT', 'تاريخ تسليم المسودة (عمود)', '—', 'date', 'date', true, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_PUB', 'تاريخ ووقت النشر (عمود)', '—', 'date', 'date', true, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_KEEP', 'مدة البقاء (عمود)', '—', 'number', 'number', true, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_PRICE', 'السعر (عمود)', '—', 'number', 'number', true, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OT_TOTAL', 'الإجمالي', 'مجموع الصفوف', 'auto', 'auto', false, '', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_MODE', 'أسلوب الدفع', 'أساليب الدفع', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'payment_modes'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_ADVPCT', 'نسبة الدفعة المقدمة', '—', 'number', 'number', false, '50', 0, 100, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_ADVWHEN', 'موعد الدفعة المقدمة', 'مواعيد الدفعة المقدمة', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'advance_timing'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_ADVDAYS', 'عدد أيام الدفعة المقدمة', '—', 'number', 'number', false, '5', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_BALDAYS', 'موعد سداد الرصيد', '—', 'number', 'number', false, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_AMT', 'قيمة الإعلان', 'إجمالي الجدول', 'auto', 'auto', false, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_WORDS', 'المبلغ كتابةً', 'محسوب', 'auto', 'auto', false, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_CUR', 'العملة', 'العملات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'currencies'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_VATTXT', 'صيغة معالجة الضريبة', 'صيغ الضريبة', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'vat_forms'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_METHOD', 'وسيلة الدفع', 'وسائل الدفع', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'payment_methods'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_BANK', 'اسم البنك', 'البنوك', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'banks'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_ACCNAME', 'اسم صاحب الحساب', '—', 'text', 'text', true, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_ACCNO', 'رقم الحساب', '—', 'text', 'text', true, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_IBAN', 'رقم الآيبان', '—', 'text', 'text', true, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_THIRD', 'الحساب باسم طرف ثالث', 'نعم / لا', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'yes_no'), 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_REFDAYS', 'مهلة رد المبالغ', '—', 'number', 'number', true, '5', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PY_REFPCT', 'غرامة التأخر في الرد', '—', 'number', 'number', false, '', null, null, null, 'finance', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_STATPOST', 'مهلة إحصاءات المنشورات', '—', 'number', 'number', true, '7', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_STATSTORY', 'مهلة إحصاءات القصص', '—', 'number', 'number', true, '24', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_KEEPPOST', 'مدة بقاء المنشور', '—', 'number', 'number', true, '30', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_KEEPSTORY', 'مدة بقاء القصة', '—', 'number', 'number', true, '24', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_DISCSEC', 'مدة الإفصاح الشفهي', '—', 'number', 'number', true, '10', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_FIX', 'مهلة تصحيح المحتوى', '—', 'number', 'number', true, '24', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_REV', 'عدد جولات التعديل', '—', 'number', 'number', true, '2', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_EXCL', 'تفعيل بند الحصرية', 'مفعّل / غير مفعّل', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'on_off'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_EXCLCAT', 'فئة المنافسة', 'فئات المنتجات', 'list', 'list', false, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'product_categories'), 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_EXCLB', 'مدة الحصرية قبل النشر', '—', 'number', 'number', false, '7', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'OP_EXCLA', 'مدة الحصرية بعد النشر', '—', 'number', 'number', false, '7', null, null, null, 'operations', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'US_PLAT', 'المنصات المصرح بها', 'المنصات', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'platforms'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'US_MON', 'مدة الترخيص', '—', 'number', 'number', true, '6', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'US_START', 'بداية احتساب المدة', 'بداية الترخيص', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'license_start'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'US_GEO', 'النطاق الجغرافي', 'النطاقات الجغرافية', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'geo_scopes'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'US_PAID', 'الترويج المدفوع', 'يشمل / لا يشمل', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'includes_excludes'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'US_SUB', 'حق التنازل للعميل', 'نعم / لا', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'yes_no'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PN_LATE', 'غرامة التأخير اليومية', '—', 'number', 'number', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PN_LATEMAX', 'الحد الأقصى لغرامة التأخير', '—', 'number', 'number', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PN_NOPUB', 'تعويض عدم النشر', '—', 'number', 'number', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PN_DEL', 'تعويض الحذف المبكر', '—', 'number', 'number', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'PN_STAT', 'غرامة تأخر الإحصاءات', '—', 'number', 'number', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CF_YEARS', 'مدة السرية', '—', 'number', 'number', true, '5', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CF_DESTROY', 'مهلة الإعادة أو الإتلاف', '—', 'number', 'number', true, '30', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'FM_NOTIFY', 'مهلة إخطار القوة القاهرة', '—', 'number', 'number', true, '48', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'FM_TERM', 'مدة جواز الفسخ', '—', 'number', 'number', true, '30', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'NT_P1MAIL', 'بريد الطرف الأول', 'إعدادات الشركة', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'NT_P1PHONE', 'جوال الطرف الأول', 'إعدادات الشركة', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'NT_P2MAIL', 'بريد الطرف الثاني', 'من P2.MAIL', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'NT_P2PHONE', 'جوال الطرف الثاني', 'من P2.PHONE', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'NT_REPLY', 'مهلة الرد على الإخطار', '—', 'number', 'number', true, '2', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'NT_CHG', 'مهلة الإخطار بتغيير العنوان', '—', 'number', 'number', true, '5', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'DS_AMIC', 'مهلة التسوية الودية', '—', 'number', 'number', true, '30', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'DS_MODE', 'آلية فض النزاع', 'آليات فض النزاع', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'dispute_modes'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'DS_CITY', 'مدينة الاختصاص', 'المدن القضائية', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'jurisdiction_cities'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'DS_CENTER', 'مركز التحكيم', 'مراكز التحكيم', 'list', 'list', false, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'arbitration_centers'), 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'DS_ARBNO', 'عدد المحكّمين', '—', 'number', 'number', false, '1', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'SG_MODE', 'أسلوب التوقيع', 'أساليب التوقيع', 'list', 'list', true, '', null, null, (select id from legal.managed_list where workspace_id = v_ws and key = 'signature_modes'), 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'SG_COPIES', 'عدد النسخ', '—', 'number', 'number', true, '2', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'SG_P1', 'موقّع الطرف الأول', 'من P1.REP', 'auto', 'auto', false, '', null, null, null, 'admin', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, source = excluded.source, data_type = excluded.data_type,
      field_type = excluded.field_type, required = excluded.required,
      default_value = excluded.default_value, num_min = excluded.num_min,
      num_max = excluded.num_max, list_id = excluded.list_id,
      owner_dept = excluded.owner_dept, alert_days = excluded.alert_days;

  -- 3. template + version 1 (seed once) -----------------------
  select id into v_tpl from legal.doc_template
    where workspace_id = v_ws and name = 'عقد تسويق إلكتروني' limit 1;
  if v_tpl is null then
    insert into legal.doc_template (workspace_id, doc_kind, name, description)
      values (v_ws, 'vendor_contract', 'عقد تسويق إلكتروني', 'قالب عقد المؤثرين v1.0 - حقول منتقاة ولوائح معتمدة') returning id into v_tpl;
  end if;

  select id into v_ver from legal.doc_template_version where template_id = v_tpl and version = 1;
  if v_ver is not null then
    raise notice 'template version 1 already present (%), leaving blocks untouched', v_ver;
  else
    insert into legal.doc_template_version (template_id, workspace_id, version, status)
      values (v_tpl, v_ws, 1, 'draft') returning id into v_ver;

    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 1, 'title', '{"text": "عقد تسويق إلكتروني"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 2, 'p', '{"text": "رقم العقد {{ C_NO }}"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 3, 'p', '{"text": "الحمد لله وحده وبعد:"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 4, 'p', '{"text": "أنه في تاريخ {{ C_DATE }} م، الموافق {{ C_HIJRI }} هـ، يوم {{ C_DAY }} ، حُرر هذا العقد (يشار إليه بـ«العقد») بين كل من:"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 5, 'h', '{"text": "الطرف الأول"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 6, 'p', '{"text": "{{ P1_NAME }} ، سجل تجاري رقم ( {{ P1_CR }} )، الرقم الوطني الموحد ( {{ P1_UNI }} )، الرقم الضريبي ( {{ P1_VAT }} )، العنوان: {{ P1_ADDR }} ، الرمز البريدي ( {{ P1_ZIP }} )، ويمثلها الأستاذ/ {{ P1_REP }} بصفته {{ P1_TITLE }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 7, 'h', '{"text": "الطرف الثاني"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 8, 'p', '{"text": "{{ P2_TYPE }} : {{ P2_NAME }} ، الجنسية {{ P2_NAT }} ، بموجب {{ P2_IDTYPE }} رقم ( {{ P2_IDNO }} )، تاريخ الميلاد {{ P2_DOB }} ، العنوان: {{ P2_CITY }} — {{ P2_DIST }} ، الرمز البريدي ( {{ P2_ZIP }} )، البريد الإلكتروني {{ P2_MAIL }} ، الجوال {{ P2_PHONE }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 9, 'p', '{"text": "وإن كان منشأة: السجل التجاري رقم ( {{ P2_CR }} )، الرقم الوطني الموحد ( {{ P2_UNI }} )، الرقم الضريبي ( {{ P2_VATNO }} )، ويمثلها {{ P2_REP }} بموجب {{ P2_POA }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 10, 'p', '{"text": "ويقر الطرف الثاني بأنه حاصل على تصريح ممارسة الإعلان الصادر من الهيئة العامة للإعلام رقم ( {{ RG_LIC }} ) وساري حتى {{ RG_LICEXP }} ؛ وأنه {{ RG_VATST }} في ضريبة القيمة المضافة برقم ( {{ RG_VATNO }} )؛ وأنه {{ RG_RES }} في المملكة لأغراض ضريبة الدخل."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 11, 'p', '{"text": "تمهيد: حيث إن الطرف الأول شركة نشاطها تقديم خدمات تسويقية ودعاية وإعلان نيابةً عن الغير، والطرف الثاني معلن في مواقع التواصل الاجتماعي، ويرغب الطرف الأول بالاتفاق مع الطرف الثاني فيما يخص دعاية وإعلان."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 12, 'h', '{"text": "أولًا: يعتبر التمهيد جزءًا لا يتجزأ من هذا العقد"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 13, 'p', '{"text": "المنتجات التي يتم ترويجها: {{ PR_ITEMS }} — الفئة النظامية {{ PR_CAT }} ، الجهة الرقابية {{ PR_REG }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 14, 'h', '{"text": "ثانيًا: موضوع العقد"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 15, 'p', '{"text": "بموجب هذا العقد اتفق الطرفان أن يقوم الطرف الأول بحجز خدمات على مواقع التواصل الاجتماعي، ويلتزم الطرف الثاني بتنفيذها شخصيًا ومن الحسابات المسمّاة حصرًا، على النحو التالي:"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 16, 'table', '{"columns": [{"key": "OT_INF", "label": "المؤثر (عمود)"}, {"key": "OT_PLAT", "label": "المنصة (عمود)"}, {"key": "OT_ACC", "label": "الحساب (عمود)"}, {"key": "OT_TYPE", "label": "نوع الإعلان (عمود)"}, {"key": "OT_QTY", "label": "العدد (عمود)"}, {"key": "OT_DUR", "label": "المدة بالثواني (عمود)"}, {"key": "OT_LANG", "label": "اللغة (عمود)"}, {"key": "OT_DRAFT", "label": "تاريخ تسليم المسودة (عمود)"}, {"key": "OT_PUB", "label": "تاريخ ووقت النشر (عمود)"}, {"key": "OT_KEEP", "label": "مدة البقاء (عمود)"}, {"key": "OT_PRICE", "label": "السعر (عمود)"}]}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 17, 'p', '{"text": "ولا يكون أي تعديل على هذا الجدول نافذًا إلا بملحق خطي موقّع من الطرفين."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 18, 'h', '{"text": "ثالثًا: المقابل والدفع"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 19, 'p', '{"text": "أن يسدد الطرف الأول للطرف الثاني مبلغًا وقدره ( {{ PY_AMT }} ) {{ PY_WORDS }} {{ PY_CUR }} ، {{ PY_VATTXT }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 20, 'p', '{"text": "(1) أسلوب الدفع: {{ PY_MODE }} ، بنسبة دفعة مقدمة قدرها ( {{ PY_ADVPCT }} )، تُسدد {{ PY_ADVWHEN }} خلال ( {{ PY_ADVDAYS }} ) أيام، ويُسدد الرصيد خلال ( {{ PY_BALDAYS }} ) يومًا من تاريخ النشر."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 21, 'p', '{"text": "(2) الفاتورة: يلتزم الطرف الثاني — إن كان مسجلًا في ضريبة القيمة المضافة — بإصدار فاتورة ضريبية إلكترونية مستوفية للاشتراطات النظامية قبل التحويل، ولا يستحق أي مبلغ قبل إصدارها."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 22, 'p', '{"text": "(3) ضريبة الاستقطاع: إذا كان الطرف الثاني غير مقيم في المملكة، يحق للطرف الأول خصم ضريبة الاستقطاع بنسبة ( {{ RG_WHT }} ) وفق النظام المعمول به وتوريدها للجهة المختصة، ويُعد ذلك سدادًا صحيحًا ومبرئًا لذمته بكامل قيمة الخصم."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 23, 'p', '{"text": "(4) الحساب البنكي: يتم التحويل عبر {{ PY_METHOD }} بالبيانات التالية: البنك {{ PY_BANK }} ، اسم الحساب {{ PY_ACCNAME }} ، رقم الحساب {{ PY_ACCNO }} ، الآيبان {{ PY_IBAN }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 24, 'p', '{"text": "ويجب أن يكون الحساب باسم الطرف الثاني؛ وحالة كونه باسم طرف ثالث ( {{ PY_THIRD }} ) يلتزم بتقديم تفويض خطي موقّع منه ومن صاحب الحساب، ويتحمل وحده كامل المسؤولية عن اختيار الحساب، ويُعد أي تحويل إبراءً لذمة الطرف الأول."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 25, 'p', '{"text": "(5) المقاصة: للطرف الأول إجراء المقاصة بين ما يستحقه قِبل الطرف الثاني بموجب هذا العقد أو أي عقد آخر بينهما."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 26, 'h', '{"text": "رابعًا: التصريح الإعلاني والإفصاح"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 27, 'p', '{"text": "يلتزم الطرف الثاني بتجديد تصريحه الإعلاني طوال مدة العقد، وبإخطار الطرف الأول خلال ( {{ RG_NOTIFYH }} ) ساعة بأي إيقاف أو إلغاء أو عدم تجديد. ويُعد سريان التصريح شرطًا جوهريًا؛ وعدم سريانه يخوّل الطرف الأول فسخ العقد فورًا واسترداد كامل المبالغ المدفوعة خلال ( {{ PY_REFDAYS }} ) أيام عمل."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 28, 'p', '{"text": "الإفصاح الإعلاني: يلتزم الطرف الثاني بأن يُظهر بوضوح وبشكل بارز أن المحتوى إعلان مدفوع، وذلك بـ: وسم #إعلان في مقدمة النص المصاحب لا في نهايته؛ وتفعيل أداة الإفصاح عن الشراكة المدفوعة المتاحة في المنصة إن وُجدت؛ وذكر شفهي في أول ( {{ OP_DISCSEC }} ) ثوانٍ في المحتوى المرئي. ويحظر إزالة الإفصاح أو تعديله بعد النشر، ويتحمل الطرف الثاني وحده أي غرامة أو إجراء تتخذه الجهات المختصة بسبب الإخلال به، ويعوّض عنها الطرف الأول وعميله."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 29, 'h', '{"text": "خامسًا: المحتوى المحظور والادعاءات"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 30, 'p', '{"text": "يلتزم الطرف الثاني بألا يتضمن المحتوى الإعلاني:"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 31, 'li', '{"text": "أي ادعاء طبي أو علاجي أو وعد بنتيجة مضمونة، أو مقارنة بمنتج منافس بالاسم؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 32, 'li', '{"text": "أي ادعاء يخالف البيانات المعتمدة للمنتج؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 33, 'li', '{"text": "ما يخالف الآداب العامة أو لائحة الذوق العام أو النظام العام في المملكة؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 34, 'li', '{"text": "ما يمس الأشخاص أو الجهات أو يتضمن قذفًا أو تشهيرًا بما يخالف نظام مكافحة جرائم المعلوماتية؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 35, 'li', '{"text": "محتوى مولّدًا أو معدّلًا بالذكاء الاصطناعي يحاكي شخصًا حقيقيًا أو صوته دون إفصاح صريح."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 36, 'p', '{"text": "وللطرف الأول رفض المحتوى قبل النشر دون أن يُعد ذلك إخلالًا منه، ويلتزم الطرف الثاني بالتعديل خلال ( {{ OP_FIX }} ) ساعة، وتشمل قيمة العقد ( {{ OP_REV }} ) جولتي تعديل."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 37, 'h', '{"text": "سادسًا: مدة بقاء الإعلان وحظر الحذف المبكر"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 38, 'p', '{"text": "يلتزم الطرف الثاني بإبقاء المحتوى منشورًا وظاهرًا للعامة على الحساب المتفق عليه مدة لا تقل عن ( {{ OP_KEEPPOST }} ) يومًا للمنشورات والريلز، و( {{ OP_KEEPSTORY }} ) ساعة كاملة للقصص."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 39, 'p', '{"text": "ويحظر خلال هذه المدة الحذف أو الأرشفة أو الإخفاء أو تقييد التعليقات أو تعديل النص المصاحب أو تحويل الحساب إلى خاص. وفي حال المخالفة يلتزم برد كامل قيمة البند خلال ( {{ PY_REFDAYS }} ) أيام عمل، بالإضافة إلى تعويض اتفاقي قدره ( {{ PN_DEL }} ) من قيمة البند."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 40, 'h', '{"text": "سابعًا: الحصرية وعدم الإعلان للمنافسين"}'::jsonb, true);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 41, 'p', '{"text": "{{ OP_EXCL }}"}'::jsonb, true);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 42, 'p', '{"text": "يلتزم الطرف الثاني بعدم نشر أي محتوى إعلاني لمنتج أو علامة منافسة ضمن فئة {{ OP_EXCLCAT }} ، خلال ( {{ OP_EXCLB }} ) أيام سابقة و( {{ OP_EXCLA }} ) أيام لاحقة لتاريخ النشر، وعلى المنصات ذاتها."}'::jsonb, true);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 43, 'p', '{"text": "والمقصود بالمنافس كل من يقدّم منتجًا أو خدمة بديلة لنفس الغرض الاستهلاكي، وعند الشك يُرجع للطرف الأول كتابةً قبل التعاقد. وتقتصر الحصرية على ما ذُكر ولا تقيّد نشاط الطرف الثاني فيما عداه."}'::jsonb, true);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 44, 'h', '{"text": "ثامنًا: حقوق الاستخدام والملكية الفكرية"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 45, 'p', '{"text": "يمنح الطرف الثاني الطرف الأول — مع حق التنازل من الباطن لعميل الطرف الأول ( {{ US_SUB }} ) — ترخيصًا غير حصري، غير قابل للإلغاء خلال مدته، لاستخدام المادة الإعلانية على النحو التالي:"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 46, 'li', '{"text": "المنصات المصرح بها: {{ US_PLAT }} ؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 47, 'li', '{"text": "المدة: ( {{ US_MON }} ) أشهر، تبدأ {{ US_START }} ؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 48, 'li', '{"text": "النطاق الجغرافي: {{ US_GEO }} ؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 49, 'li', '{"text": "الترويج المدفوع: {{ US_PAID }} الإعلانات المدفوعة والترويج من حساب العلامة."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 50, 'p', '{"text": "وما زاد على ذلك يستلزم اتفاقًا خطيًا ومقابلًا إضافيًا. ويحتفظ الطرف الثاني بحقوقه الأدبية على المصنّف، ولا يجوز تعديل المحتوى بما يخل بمضمونه أو يسيء إليه."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 51, 'h', '{"text": "تاسعًا: الإحصاءات وصحتها وضمان التفاعل"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 52, 'p', '{"text": "يلتزم الطرف الثاني بتزويد الطرف الأول بإحصاءات الأداء خلال ( {{ OP_STATPOST }} ) أيام من نشر المنشورات والريلز، و( {{ OP_STATSTORY }} ) ساعة من نشر القصص، وذلك على النحو التالي:"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 53, 'li', '{"text": "لقطات شاشة أصلية غير معدّلة من لوحة التحليلات الرسمية للمنصة، تُظهر اسم الحساب والتاريخ ضمن اللقطة ذاتها؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 54, 'li', '{"text": "وللطرف الأول طلب التحقق عبر مشاركة الشاشة المباشرة أو صلاحية اطلاع مؤقتة على لوحة التحليلات؛"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 55, 'li', '{"text": "وعدم التسليم خلال المدة يخوّل الطرف الأول حبس أي مستحقات متبقية وفرض غرامة تأخير قدرها ( {{ PN_STAT }} ) عن كل يوم تأخير."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 56, 'p', '{"text": "ويقر الطرف الثاني ويضمن أن متابعي حساباته وتفاعلهم حقيقيون، وأنه لم يقم ولن يقوم — بنفسه أو بواسطة غيره — بشراء متابعين أو مشاهدات أو تفاعل، ولا باستخدام برامج آلية أو مجموعات تبادل تفاعل. وثبوت خلاف ذلك يُعد إخلالًا جوهريًا يخوّل الطرف الأول فسخ العقد واسترداد كامل المبالغ والمطالبة بالتعويض."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 57, 'h', '{"text": "عاشرًا: التنفيذ الشخصي وعدم التنازل"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 58, 'p', '{"text": "يُعد هذا العقد قائمًا على الاعتبار الشخصي للطرف الثاني، ويلتزم بتنفيذ المحتوى بنفسه ونشره من الحساب المسمّى في جدول المخرجات حصرًا. ولا يجوز له التنازل عن العقد كليًا أو جزئيًا، ولا التعاقد من الباطن، ولا الاستعانة بوكالة أو مدير أعمال لتنفيذ الالتزام، إلا بموافقة خطية مسبقة من الطرف الأول. ويلتزم بإخطار الطرف الأول فورًا بأي إيقاف أو حظر أو اختراق يطرأ على الحساب المسمّى."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 59, 'h', '{"text": "حادي عشر: التأخير والشرط الجزائي"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 60, 'p', '{"text": "(1) التأخر عن موعد النشر: غرامة قدرها ( {{ PN_LATE }} ) من قيمة البند عن كل يوم تأخير، بحد أقصى ( {{ PN_LATEMAX }} ) من قيمته."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 61, 'p', '{"text": "(2) عدم النشر كليًا: رد كامل قيمة البند خلال ( {{ PY_REFDAYS }} ) أيام عمل، مع تعويض اتفاقي قدره ( {{ PN_NOPUB }} ) جبرًا للضرر تجاه العميل."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 62, 'p', '{"text": "(3) نشر محتوى مخالف للمعتمد: يلتزم بالتصحيح وإعادة النشر على نفقته خلال ( {{ OP_FIX }} ) ساعة، وإلا سرى حكم الفقرة (2)."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 63, 'p', '{"text": "(4) لا تُخلّ هذه الجزاءات بحق الطرف الأول في المطالبة بالتعويض عن الضرر الفعلي إذا جاوز قيمة الشرط الجزائي."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 64, 'h', '{"text": "ثاني عشر: إنهاء العقد أو طلب تغيير في موضوعه"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 65, 'p', '{"text": "في حال رغب الطرف الثاني في إنهاء العقد ويوجد منتجات مرسلة من قبل الطرف الأول، يلتزم بإرجاعها مع تحمل قيمة الإرجاع إن وجدت. وإن وجدت مبالغ مدفوعة له، يلتزم بإرجاعها."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 66, 'p', '{"text": "ولا يمكن للطرف الثاني طلب تقليل عدد الخدمات المتفق عليها، حيث إن الأسعار المعطاة مرتبطة ارتباطًا كليًا بعدد الخدمات الكمي."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 67, 'p', '{"text": "(4) المهلة: يتم رد المبالغ خلال ( {{ PY_REFDAYS }} ) أيام عمل من تاريخ الإخطار، ويستحق عنها بعد ذلك ( {{ PY_REFPCT }} ) شهريًا مقابل التأخر في الرد."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 68, 'p', '{"text": "(5) الإنهاء الفوري من الطرف الأول دون تعويض وباسترداد كامل المبالغ، في أي من الحالات: انتهاء أو إيقاف التصريح الإعلاني؛ إيقاف أو حظر الحساب المسمّى؛ نشر محتوى مخالف للبند (خامسًا)؛ ثبوت تفاعل مصطنع؛ صدور ما يسيء لسمعة العلامة التجارية من الطرف الثاني."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 69, 'p', '{"text": "(6) تعذّر التنفيذ لسبب لا يد لأحد فيه (حذف الحساب أو حظره قبل النشر): يُفسخ البند وتُرد قيمته كاملة دون تعويض لأي من الطرفين."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 70, 'p', '{"text": "(7) المقاصة: للطرف الأول استيفاء المبالغ المستحقة له خصمًا من أي مستحقات للطرف الثاني لديه بموجب أي عقد آخر."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 71, 'p', '{"text": "ويتم إرجاع المبالغ على حساب الشركة: البنك {{ P1_BANK }} ، اسم الحساب {{ P1_ACCNAME }} ، رقم الحساب {{ P1_ACCNO }} ، الآيبان {{ P1_IBAN }} ."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 72, 'h', '{"text": "ثالث عشر: السرية"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 73, 'p', '{"text": "يلتزم الطرف الثاني بعدم إفشاء أي من: قيمة المقابل المتفق عليه، اسم العميل النهائي، المحتوى الإعلاني قبل نشره، خطة الحملة، أو أي معلومة تجارية اطّلع عليها بسبب هذا العقد."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 74, 'p', '{"text": "ويسري هذا الالتزام طوال مدة العقد ولمدة ( {{ CF_YEARS }} ) سنوات بعد انتهائه أو إلغائه لأي سبب. ويُستثنى ما كان معلومًا للعامة دون مخالفة، وما يُفصح عنه بموجب أمر من جهة مختصة بشرط إخطار الطرف الأول مسبقًا بالقدر الممكن نظامًا. وعند انتهاء العقد يلتزم بإتلاف أو إعادة ما بحوزته من مواد خلال ( {{ CF_DESTROY }} ) يومًا."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 75, 'h', '{"text": "رابع عشر: حماية البيانات الشخصية"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 76, 'p', '{"text": "يلتزم الطرفان بأحكام نظام حماية البيانات الشخصية ولائحته التنفيذية فيما يتعلق بأي بيانات شخصية يتم تبادلها أو معالجتها بسبب هذا العقد. ويقر الطرف الثاني بموافقته على استخدام اسمه وصورته والمواد المتعلقة به في حدود الترخيص الممنوح في البند (ثامنًا) فقط. ولا يجوز لأي طرف نقل البيانات الشخصية خارج المملكة أو استخدامها لغير غرض هذا العقد، ولا جمع بيانات جمهور المنصة لأغراض تسويقية مستقلة."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 77, 'h', '{"text": "خامس عشر: القوة القاهرة"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 78, 'p', '{"text": "لا يُسأل أي طرف عن التأخر أو الإخلال الناشئ عن حدث خارج عن إرادته، ومن ذلك على سبيل المثال لا الحصر: الحرب، الحريق، الفيضان، الزلزال، الأوبئة، الاضطرابات، قرارات الجهات المختصة، أو توقف المنصة أو تغيّر سياساتها أو حظر الحساب لسبب لا يد للطرف الثاني فيه."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 79, 'p', '{"text": "ويلتزم الطرف المتأثر بالإخطار الكتابي خلال ( {{ FM_NOTIFY }} ) ساعة من وقوع الحدث، ويُعلَّق الالتزام مدة استمرار الحدث وآثاره. وإذا تجاوز الحدث ( {{ FM_TERM }} ) يومًا جاز لأي من الطرفين فسخ العقد بإخطار كتابي مع تسوية المستحقات عن الجزء المنفّذ فعلًا ورد ما زاد. ولا تُعد الالتزامات المالية المستحقة قبل الحدث معلّقة به."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 80, 'h', '{"text": "سادس عشر: طبيعة العلاقة"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 81, 'p', '{"text": "العلاقة بين الطرفين علاقة تعاقد مدني مستقل، ولا ينشأ عنها بأي حال علاقة عمل أو وكالة أو شراكة أو مشروع مشترك. ولا يستحق الطرف الثاني أي حقوق عمالية أو مكافأة نهاية خدمة أو تأمينات اجتماعية أو إجازات، ويتحمل وحده التزاماته النظامية والضريبية والتأمينية. ولا يملك أي طرف تمثيل الآخر أو إلزامه تجاه الغير إلا بتفويض خطي صريح."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 82, 'h', '{"text": "سابع عشر: الإخطار والمراسلات والتوقيع الإلكتروني"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 83, 'p', '{"text": "تعتبر الموافقة الإلكترونية كافية في حدوث أي إشعار رسمي بين الطرفين، وذلك يتضمن البريد الإلكتروني والرسائل النصية والرسائل من خلال تطبيق الواتساب أو أي وسيلة اتصال حديثة."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 84, 'p', '{"text": "(1) عناوين الإخطار المعتمدة: الطرف الأول {{ NT_P1MAIL }} — {{ NT_P1PHONE }} ؛ الطرف الثاني {{ NT_P2MAIL }} — {{ NT_P2PHONE }} . ويلتزم كل طرف بإخطار الآخر بأي تغيير خلال ( {{ NT_CHG }} ) أيام، وإلا اعتُبر الإرسال على العنوان الأخير منتجًا لأثره."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 85, 'p', '{"text": "(2) يُعد عدم الرد خلال ( {{ NT_REPLY }} ) يومي عمل من تاريخ الإرسال موافقة ضمنية على ما تضمنه الإخطار."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 86, 'p', '{"text": "(3) التوقيع الإلكتروني: يتفق الطرفان على أن التوقيع الإلكتروني والتعاقد عبر المنصة الإلكترونية للطرف الأول له الحجية ذاتها المقررة للتوقيع الخطي، وتُعد سجلات المنصة ومحاضر التوقيع الإلكترونية حجة بما ورد فيها."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 87, 'h', '{"text": "ثامن عشر: الشروط الباطلة"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 88, 'p', '{"text": "إن بطلان أي بند من بنود هذا «العقد» لا يؤثر على بقية بنود «العقد» التي تظل سارية ومنتجة لآثارها بين «الطرفين». إلا إذا تبين أن أحد المتعاقدين ما كان ليرضى بالعقد دون ذلك البند فله حق طلب إبطال العقد."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 89, 'h', '{"text": "تاسع عشر: النزاعات والاختصاص"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 90, 'p', '{"text": "يخضع هذا العقد في تفسيره وتنفيذه للأنظمة المعمول بها في المملكة العربية السعودية. وعند نشوء أي نزاع يسعى الطرفان لتسويته وديًا خلال ( {{ DS_AMIC }} ) يومًا من تاريخ الإخطار الكتابي بوجوده؛ فإن تعذّر، يُحال إلى {{ DS_MODE }} بمدينة {{ DS_CITY }} {{ DS_CENTER }} ، وعدد المحكّمين ( {{ DS_ARBNO }} )، ولغة الإجراءات العربية."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 91, 'h', '{"text": "عشرون: الأحكام الختامية"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 92, 'li', '{"text": "كامل الاتفاق: يمثل هذا العقد وملاحقه كامل ما اتفق عليه الطرفان، ويلغي كل تفاهم أو عرض أو مراسلة سابقة بشأن موضوعه."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 93, 'li', '{"text": "التعديل: لا يكون أي تعديل نافذًا إلا بملحق خطي موقّع من الطرفين."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 94, 'li', '{"text": "الملاحق: جدول المخرجات وقائمة المنتجات جزء لا يتجزأ من العقد."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 95, 'li', '{"text": "عدم التنازل عن الحقوق: تسامح أحد الطرفين في المطالبة بحق لا يُعد تنازلًا عنه ولا عن حقوق لاحقة."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 96, 'li', '{"text": "اللغة: حُرر بالعربية، وهي المعتمدة عند الاختلاف مع أي ترجمة."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 97, 'li', '{"text": "النسخ: ( {{ SG_COPIES }} ) نسختان أصليتان، أو نسخة إلكترونية موقّعة إلكترونيًا لها الحجية ذاتها."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 98, 'p', '{"text": "تم تحرير هذا العقد وتسليم كل طرف نسخة منه. وعليه جرى التوقيع، والله الموفق."}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 99, 'p', '{"text": "أسلوب التوقيع: {{ SG_MODE }}"}'::jsonb, false);
    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
      values (v_ver, v_ws, 100, 'p', '{"text": "الطرف الأول: {{ SG_P1 }} التوقيع: ________________ الطرف الثاني: {{ P2_NAME }} التوقيع: ________________"}'::jsonb, false);

    update legal.doc_template_version set status = 'published', published_at = now()
      where id = v_ver;
    raise notice 'seeded 100 blocks and published version 1';
  end if;
end
$seed$;
