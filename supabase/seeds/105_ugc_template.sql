-- ============================================================
-- 105_ugc_template.sql   GENERATED - do not hand-edit.
--   node scripts/build-legal-seed.mjs
--
-- Ports the live "Rawad altathir UGC" contract into legal.*: 16 typed
-- fields and 42 blocks as version 1, published, in workspace
-- 874c6670-29d9-48f1-97a4-ccbc0e54208b.
--
-- Source: public/contracts/contract-template-ar.js
-- sha256: 5130d75593eb95433b4b23514fe452cad58f9f46d8307d081d3a612c74e77f81
--
-- Idempotent: fields upsert by key, the template and its blocks seed once,
-- and archiving already-archived versions is a no-op. Safe to run twice.
-- Run in staging, then prod. Then: notify pgrst.
-- ============================================================

set search_path = legal, public;

create or replace function legal._seed_field(
  p_ws uuid, p_key text, p_label text, p_type text, p_req boolean
) returns void language sql as $fn$
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required,
     default_value, num_min, num_max, list_id, owner_dept, alert_days)
  values (p_ws, p_key, p_label, '', 'text', p_type, p_req, '', null, null, null, 'legal', null)
  on conflict (workspace_id, key) do update
    set label = excluded.label, field_type = excluded.field_type, required = excluded.required;
$fn$;

do $seed$
declare
  v_ws  uuid := '874c6670-29d9-48f1-97a4-ccbc0e54208b';
  v_tpl uuid;
  v_ver uuid;
  n_arch integer;
begin
  if not exists (select 1 from public.workspaces where id = v_ws) then
    raise exception 'workspace % not found - check you are on the right database', v_ws;
  end if;

  -- 1. the field registry --------------------------------------
  perform legal._seed_field(v_ws, 'id', 'رقم العقد', 'text', false);
  perform legal._seed_field(v_ws, 'date', 'التاريخ', 'date', false);
  perform legal._seed_field(v_ws, 'day', 'اليوم', 'text', false);
  perform legal._seed_field(v_ws, 'license_name', 'اسم الطرف الثاني', 'text', true);
  perform legal._seed_field(v_ws, 'license_number', 'رقم الترخيص الإعلامي', 'text', true);
  perform legal._seed_field(v_ws, 'brand_name', 'المنتجات التي يتم ترويجها', 'text', true);
  perform legal._seed_field(v_ws, 'name_2', 'المؤثر', 'text', true);
  perform legal._seed_field(v_ws, 'platform_smart', 'المنصة', 'text', true);
  perform legal._seed_field(v_ws, 'channel_name', 'حسابه في المنصة', 'text', true);
  perform legal._seed_field(v_ws, 'ad_types', 'نوع الإعلان', 'text', true);
  perform legal._seed_field(v_ws, 'Amount_full', 'المبلغ', 'text', true);
  perform legal._seed_field(v_ws, 'duration', 'المدة بالأيام', 'text', true);
  perform legal._seed_field(v_ws, 'bank_name', 'اسم البنك', 'text', true);
  perform legal._seed_field(v_ws, 'account_name', 'اسم الحساب', 'text', true);
  perform legal._seed_field(v_ws, 'account_number', 'رقم الحساب', 'text', true);
  perform legal._seed_field(v_ws, 'iban', 'رقم الايبان', 'text', true);

  -- 2. the template and its one published version ---------------
  select id into v_tpl from legal.doc_template
   where workspace_id = v_ws and name = 'Rawad altathir UGC';
  if v_tpl is null then
    insert into legal.doc_template (workspace_id, doc_kind, name, description)
    values (v_ws, 'vendor_contract', 'Rawad altathir UGC',
            'Ported from public/contracts/contract-template-ar.js')
    returning id into v_tpl;
  end if;

  select id into v_ver from legal.doc_template_version
   where template_id = v_tpl and version = 1;
  if v_ver is null then
    -- Blocks are writable only while the version is a draft (098 freeze).
    insert into legal.doc_template_version (template_id, workspace_id, version, status)
    values (v_tpl, v_ws, 1, 'draft') returning id into v_ver;

    insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content)
    values
    (v_ver, v_ws, 1, 'p', '{"text":"{{ id }}"}'::jsonb),
    (v_ver, v_ws, 2, 'title', '{"text":"\" اتفاقية تسويق الكتروني\""}'::jsonb),
    (v_ver, v_ws, 3, 'p', '{"text":"الحمد لله وحده واما بعد:"}'::jsonb),
    (v_ver, v_ws, 4, 'p', '{"text":"أنه في تاريخ {{ date }} م. الموافق {{ day }} حررت هذه الاتفاقية (يشار اليها \"بالاتفاقية\") بين كل من:"}'::jsonb),
    (v_ver, v_ws, 5, 'p', '{"text":"الطرف الأول : شركة رواد التأثير , سجل تجاري رقم ( 4030381472) , الرقم الوطني الموحد ( 7017229233) , الرقم الضريبي ( 314899928700003) , العنوان : المملكة العربية السعودية , جدة , حي الفيصلية طريق المدينة المنورة فرعي , الرمز البريدي ( 23442) , و يمثلها الأستاذ / احمد قرنفلة بصفته المدير العام."}'::jsonb),
    (v_ver, v_ws, 6, 'p', '{"text":"الطرف الثاني: {{ license_name }} – رقم الترخيص الإعلامي ( {{ license_number }} )"}'::jsonb),
    (v_ver, v_ws, 7, 'p', '{"text":"تمهيد: حيث أن الطرف الاول شركة نشاطها تقديم خدمات تسويقية ودعاية وإعلان نيابةً عن الغير ، والطرف الثاني معلن في مواقع التواصل الاجتماعي. ويرغب الطرف الأول بالاتفاق مع الطرف الثاني فيما يخص دعاية واعلان."}'::jsonb),
    (v_ver, v_ws, 8, 'h', '{"text":"أولًا: يعتبر التمهيد جزءًا لا يتجزأ من هذه الاتفاقية:"}'::jsonb),
    (v_ver, v_ws, 9, 'p', '{"text":"المنتجات التي يتم ترويجها: {{ brand_name }}"}'::jsonb),
    (v_ver, v_ws, 10, 'h', '{"text":"ثانيًا: موضوع العقد:"}'::jsonb),
    (v_ver, v_ws, 11, 'p', '{"text":"بموجب هذا العقد اتفق الطرفان ان يقوم الطرف الاول بحجز خدمات على مواقع التواصل الاجتماعي على النحو التالي مع:"}'::jsonb),
    (v_ver, v_ws, 12, 'table', '{"columns":[{"key":"name_2","label":"المؤثر"},{"key":"platform_smart","label":"المنصة"},{"key":"channel_name","label":"حسابه في المنصة"},{"key":"ad_types","label":"نوع الإعلان"}]}'::jsonb),
    (v_ver, v_ws, 13, 'h', '{"text":"ثالثًا: الدفع:"}'::jsonb),
    (v_ver, v_ws, 14, 'p', '{"text":"ان يسدد الطرف الاول لـ الطرف الثاني مبلغ الاعلان وقدره {{ Amount_full }} غير شاملة الضريبة، وذلك عن طريق التحويل المصرفي للحساب البنكي وستكون الحوالة خلال {{ duration }} يوم بعد انتهاء الحملة الاعلانية."}'::jsonb),
    (v_ver, v_ws, 15, 'p', '{"text":"يقر الطرف الثاني بصحة البيانات البنكية المرسلة من قبله سواء كانت باسمه او باسم طرف ثالث , و يتحمل الطرف الثاني كامل المسؤولية عن اختيار الحساب البنكي , و بالتالي يعد أي تحويل يتم ابراءً لذمة الطرف الأول."}'::jsonb),
    (v_ver, v_ws, 16, 'p', '{"text":"سيتم التحويل بالمعلومات التالية:"}'::jsonb),
    (v_ver, v_ws, 17, 'kv', '{"label":"اسم البنك","value":"{{ bank_name }}"}'::jsonb),
    (v_ver, v_ws, 18, 'kv', '{"label":"اسم الحساب","value":"‎ {{ account_name }}"}'::jsonb),
    (v_ver, v_ws, 19, 'kv', '{"label":"رقم الحساب","value":"{{ account_number }}"}'::jsonb),
    (v_ver, v_ws, 20, 'kv', '{"label":"رقم الايبان","value":"{{ iban }}"}'::jsonb),
    (v_ver, v_ws, 21, 'h', '{"text":"رابعاً: شرو ط وأحكام:"}'::jsonb),
    (v_ver, v_ws, 22, 'li', '{"text":"-الالتزام بالتواريخ المتفق عليها وتطبيق المحتوى كاملاً كما هو مطلوب من قبل العميل وان يتم مشاركة المحتوى قبل نشره للتأكيد عليه من قبل العميل."}'::jsonb),
    (v_ver, v_ws, 23, 'li', '{"text":"- الشروط الباطلة: إن بطلان أي بند من بنود هذا \"العقد\" لا يؤثر على بقية بنود \"العقد\" التي تظل سارية ومنتجة لأثارها بين \"الطرفين\". الا اذا تبين ان احد المتعاقدين ما كان ليرضى بالعقد دون ذلك البند فله حق طلب ابطال العقد."}'::jsonb),
    (v_ver, v_ws, 24, 'li', '{"text":"- يجب ارسال إحصاءات الإعلان بعد نزوله:"}'::jsonb),
    (v_ver, v_ws, 25, 'li', '{"text":"- إحصاءات \" تيك توك\" , \" انستقرام بوست و رييل\" , لا تتجاوز 7 أيام من تاريخ نزول الإعلان."}'::jsonb),
    (v_ver, v_ws, 26, 'li', '{"text":"- إحصاءات \" انستقرام و سناب تشات ستوري\" لا تتجاوز 24 ساعة من تاريخ نزول الإعلان."}'::jsonb),
    (v_ver, v_ws, 27, 'h', '{"text":"خامساً: إنهاء العقد او طلب تغيير في موضوع العقد:"}'::jsonb),
    (v_ver, v_ws, 28, 'p', '{"text":"في حال رغب \"الطرف الثاني\" في انهاء العقد و يوجد منتجات مرسلة من قبل \"الطرف الأول\" يلتزم \"الطرف الثاني\" في ارجاعها مع تحمل قيمة الارجاع ان وجدت."}'::jsonb),
    (v_ver, v_ws, 29, 'p', '{"text":"في حال رغب \"الطرف الثاني\" في انهاء العقد و يوجد مبالغ تم دفعها \"للطرف الثاني\" من قبل \"الطرف الأول\" يلتزم \"الطرف الثاني\" في ارجاعها."}'::jsonb),
    (v_ver, v_ws, 30, 'p', '{"text":"لا يمكن \" للطرف الثاني\" طلب تقليل عدد الخدمات المتفق عليها في \" موضوع العقد \". حيث ان الأسعار المعطاة مرتبطة ارتباط كلي بعدد الخدمات الكمي."}'::jsonb),
    (v_ver, v_ws, 31, 'p', '{"text":"يتم ارجاع المبالغ عن طريق التحويل البنكي على حساب المؤسسة بالمعلومات التالية:"}'::jsonb),
    (v_ver, v_ws, 32, 'kv', '{"label":"البنك","value":"الانماء"}'::jsonb),
    (v_ver, v_ws, 33, 'kv', '{"label":"اسم الحساب","value":"شركة رواد التأثير"}'::jsonb),
    (v_ver, v_ws, 34, 'kv', '{"label":"رقم الحساب","value":"68202707824000"}'::jsonb),
    (v_ver, v_ws, 35, 'kv', '{"label":"رقم الايبان","value":"SA8505000068202707824000"}'::jsonb),
    (v_ver, v_ws, 36, 'h', '{"text":"سادساً: الإخطار والمراسلات:"}'::jsonb),
    (v_ver, v_ws, 37, 'p', '{"text":"تعتبر الموافقة الإلكترونية كافية في حدوث أي إشعار رسمي بين كل من الطرفين، وذلك يتضمن البريد الإلكتروني، والرسائل النصية، والرسائل من خلال تطبيق الواتساب، أو أي وسيلة اتصال حديثة. كما يجب أن يكون الرد خلال مدة أقصاها يومين من تاريخ الإرسال ويلتزم الطرفان ببيان أن المحتوى الذي يتم تصويره من قبل مؤثر التواصل الاجتماعي هو إعلان التزاماً بضوابط الإعلانات في المملكة العربية السعودية."}'::jsonb),
    (v_ver, v_ws, 38, 'h', '{"text":"سابعاً: النزاعات:"}'::jsonb),
    (v_ver, v_ws, 39, 'p', '{"text":"في حالة نشوء نزاع بين الطرفين \"لا سمح الله\" يلجأ لمحاكم المملكة العربية السعودية للفصل في هذا النزاع."}'::jsonb),
    (v_ver, v_ws, 40, 'p', '{"text":"تم تحرير هذا العقد من نسختين، وتسليم كل طرف نسخة منه. وعليه جرى التوقيع:"}'::jsonb),
    (v_ver, v_ws, 41, 'p', '{"text":"والله الموفق."}'::jsonb),
    (v_ver, v_ws, 42, 'sig', '{"right":"الطرف الأول:  احمد قرنفلة","left":"الطرف الثاني:"}'::jsonb);

    update legal.doc_template_version
       set status = 'published', published_at = now()
     where id = v_ver;
    raise notice 'seeded % blocks', 42;
  else
    raise notice 'version 1 already exists - blocks left alone';
  end if;

  -- 3. retire every other published vendor_contract -------------
  -- There is no unpublish or archive button in the UI, and the New-contract
  -- picker lists every published version, so the old 5-block stub would sit
  -- beside this one with only its name to tell them apart.
  update legal.doc_template_version v
     set status = 'archived'
   where v.workspace_id = v_ws
     and v.status = 'published'
     and v.id <> v_ver
     and v.template_id in (
       select id from legal.doc_template
        where workspace_id = v_ws and doc_kind = 'vendor_contract');
  get diagnostics n_arch = row_count;
  raise notice 'archived % other published vendor_contract version(s)', n_arch;
end
$seed$;

drop function if exists legal._seed_field(uuid, text, text, text, boolean);
