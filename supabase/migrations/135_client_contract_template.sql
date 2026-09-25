-- ============================================================
-- 135_client_contract_template.sql
-- The client campaign contract, built from the Word document itself.
--
-- Siraj sent "Client INF Campaign Contract .docx" and chose: publish the
-- client template, then retire the old Contract Requests screen. This is the
-- template. It is seeded as a DRAFT - a legal document is published by a
-- person who has read it, not by a migration.
--
-- -- HOW IT WAS BUILT ------------------------------------------------
--
-- Generated from the .docx, not transcribed. Every paragraph below is the
-- document's own text, extracted from word/document.xml and written straight
-- into the SQL, so no Arabic passed through anybody's hands on the way. The
-- only edits are the blanks becoming merge fields, and each one is a literal
-- replacement that was asserted to have matched - a substitution that missed
-- would have failed the build rather than shipping a template with
-- "(-------)" still printed on it.
--
-- The second party's details are the FIRST party's own sentence with the
-- values swapped for fields. That keeps the Arabic connectives exactly as the
-- lawyer wrote them rather than as somebody guessed them.
--
-- -- WHY THE KEYS ARE PREFIXED CL_ ----------------------------------
--
-- legal.placeholder is unique on (workspace_id, key) - the registry is
-- workspace-wide, not per template. The vendor template already owns P2_NAME,
-- P2_CR and the rest, where "the second party" is the INFLUENCER. Here the
-- second party is the CLIENT COMPANY. Reusing those keys would give one
-- registry entry two meanings and one label that is wrong for one of them.
--
-- C_DATE and C_DAY are deliberately shared: "the date this contract was drawn
-- up" means the same thing in both, and it is already registered.
--
-- -- FOUR LABELS ARE MINE --------------------------------------------
--
-- Every label below is lifted from the document's own wording except four,
-- which the document never names: CL_REP, CL_TITLE, CL_ACTIVITY and
-- CL_AMOUNT_WORDS. They are short standard terms and they are the first thing
-- to change if the wording is not right - Settings, or the fields screen.
-- ============================================================

set search_path = legal, public;

do $seed$
declare
  v_ws  uuid;
  v_tpl uuid;
  v_ver uuid;
  v_n   integer;
begin
  -- The workspace that already owns a client contract template, else the only
  -- one there is. Resolved rather than hardcoded: this has to survive the move
  -- to a new Supabase project, where every id is different.
  select t.workspace_id into v_ws
    from legal.doc_template t
   where t.doc_kind = 'client_contract'
   limit 1;
  if v_ws is null then
    select count(*) into v_n from public.workspaces;
    if v_n <> 1 then
      raise exception 'seed: cannot tell which workspace to use (% workspaces, no client template)', v_n;
    end if;
    select id into v_ws from public.workspaces;
  end if;
  raise notice 'seeding the client contract into workspace %', v_ws;

  -- 1. the fields this template uses --------------------------
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CLT_ACC', 'حسابه في المنصة', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CLT_INF', 'المؤثر', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CLT_PLAT', 'المنصة', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CLT_QTY', 'عدد الإعلانات', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_ACTIVITY', 'نشاط الطرف الثاني', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_ADDR', 'العنوان', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_AMOUNT', 'مبلغ الحملة الاعلانية', '', 'number', 'number', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_AMOUNT_WORDS', 'المبلغ كتابة', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_CR', 'سجل تجاري رقم', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_DURATION', 'مدة العقد', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_NAME', 'الطرف الثاني', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_PRODUCTS', 'المنتجات التي يتم ترويجها', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_REP', 'الممثل', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_SIGNATORY', 'الطرف الثاني - التوقيع', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_TITLE', 'الصفة', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_UNI', 'الرقم الوطني الموحد', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_VAT', 'الرقم الضريبي', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'CL_ZIP', 'الرمز البريدي', '', 'text', 'text', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do update set
      label = excluded.label, data_type = excluded.data_type, field_type = excluded.field_type;

  -- C_DATE and C_DAY are SHARED with the vendor template - the date a
  -- contract was drawn up means the same thing in both. `do nothing` on
  -- conflict, so an existing registration keeps its own label and this only
  -- creates them where they are absent: a fresh Supabase project with no
  -- vendor seed in it, which is precisely where assuming they exist would
  -- leave a template printing {{ C_DATE }} on a signed contract. The labels
  -- here are the vendor seed's own, not new wording.
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_DATE', 'تاريخ التحرير (ميلادي)', '—', 'date', 'date', true, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do nothing;
  insert into legal.placeholder
    (workspace_id, key, label, source, data_type, field_type, required, default_value, num_min, num_max, list_id, owner_dept, alert_days)
    values (v_ws, 'C_DAY', 'اليوم', 'محسوب', 'auto', 'auto', false, '', null, null, null, 'legal', null)
    on conflict (workspace_id, key) do nothing;

  -- 2. the template ------------------------------------------
  select id into v_tpl from legal.doc_template
   where workspace_id = v_ws and doc_kind = 'client_contract'
   order by created_at limit 1;
  if v_tpl is null then
    insert into legal.doc_template (workspace_id, doc_kind, name, description)
      values (v_ws, 'client_contract', '"عقد حملة تسويقية"',
              'من ملف العقد الأصلي') returning id into v_tpl;
  end if;

  -- 3. the version -------------------------------------------
  --
  -- The next version number, as a DRAFT.
  --
  -- The guard keys on {{ CL_NAME }}, which ONLY a version generated by this
  -- file has. It used to key on the document's second line - and there was
  -- already a hand-made port of this same document in the database carrying
  -- that line, so the seed decided its work was done and silently did
  -- nothing. An idempotence check has to identify THIS version, not the
  -- document; otherwise any other port of the same contract disables it, and
  -- it does so while reporting success.
  --
  -- Two drafts side by side is the right outcome here, not a problem: the old
  -- port and this one, both visible in the editor, and a person picks which
  -- to publish.
  if exists (select 1 from legal.doc_template_version v
              join legal.doc_template_block b on b.version_id = v.id
             where v.template_id = v_tpl
               and b.content::text like '%CL_NAME%') then
    raise notice 'seed: this version is already present - nothing to do';
    return;
  end if;

  insert into legal.doc_template_version (template_id, workspace_id, version, status)
  select v_tpl, v_ws, coalesce(max(version), 0) + 1, 'draft'
    from legal.doc_template_version where template_id = v_tpl
  returning id into v_ver;
  raise notice 'seed: created version % as a draft', v_ver;

  -- 4. the document ------------------------------------------
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 1, 'title', '{"text": "\"عقد حملة تسويقية\""}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 2, 'p', '{"text": "الحمد لله وحده واما بعد:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 3, 'p', '{"text": "أنه في تاريخ {{ C_DATE }} م الموافق  ( {{ C_DAY }} ) حرر هذا العقد (يشار اليه \"بالعقد\") بين كل من:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 4, 'p', '{"text": "الطرف الأول: شركة رواد التأثير , سجل تجاري رقم ( 4030381472) , الرقم الوطني الموحد ( 7017229233) , الرقم الضريبي (  314899928700003) , العنوان : المملكة العربية السعودية , جدة , حي الفيصلية طريق المدينة المنورة فرعي , الرمز البريدي ( 23442) , و يمثلها الأستاذ / احمد قرنفلة بصفته المدير العام."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 5, 'p', '{"text": "الطرف الثاني:  {{ CL_NAME }}  , سجل تجاري رقم (  {{ CL_CR }} ) , الرقم الوطني الموحد (  {{ CL_UNI }} ) , الرقم الضريبي (   {{ CL_VAT }} ) , العنوان :  {{ CL_ADDR }}  , الرمز البريدي (  {{ CL_ZIP }} ) , و يمثلها الأستاذ /  {{ CL_REP }}  بصفته  {{ CL_TITLE }} ."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 6, 'p', '{"text": "تمهيد: حيث أن الطرف الأول شركة نشاطها تقديم خدمات تسويقية ودعاية وإعلان نيابةً عن الغير، والطرف الثاني {{ CL_ACTIVITY }}  ، ويرغب الطرف الأول بالاتفاق مع الطرف الثاني فيما يخص دعاية وإعلان، واتفق الطرفان على العمل والتعاون فيما بينهما حسب شروط وبنود هذه الاتفاقية."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 7, 'h', '{"text": "أولًا: يعتبر التمهيد جزءًا لا يتجزأ من هذا العقد:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 8, 'p', '{"text": "المنتجات التي يتم ترويجها: {{ CL_PRODUCTS }}"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 9, 'h', '{"text": "ثانيًا: المخرجات:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 10, 'p', '{"text": "أن يقوم الطرف الثاني بحجز حملة إعلانية كالتالي مع:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 11, 'table', '{"columns": [{"key": "CLT_INF", "label": "المؤثر"}, {"key": "CLT_PLAT", "label": "المنصة"}, {"key": "CLT_ACC", "label": "حسابه في المنصة"}, {"key": "CLT_QTY", "label": "عدد الإعلانات"}]}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 12, 'h', '{"text": "ثالثًا: تكلفة العمل وشروط الدفع:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 13, 'p', '{"text": "ان يسدد الطرف الثاني لـ الطرف الأول مبلغ الحملة الاعلانية مقدمًا وقدرها  ( {{ CL_AMOUNT }} )   ( {{ CL_AMOUNT_WORDS }} ) ريال سعودي غير شاملة الضريبة وذلك عن طريق التحويل المصرفي للحساب البنكي."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 14, 'p', '{"text": "سيتم سداد المبلغ عبر حوالة بنكية بالمعلومات التالية:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 15, 'kv', '{"label": "طريقة الدفع", "value": "حوالة بنكية"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 16, 'kv', '{"label": "اسم البنك", "value": "مصرف الإنماء"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 17, 'kv', '{"label": "اسم الحساب", "value": "شركة رواد التأثير"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 18, 'kv', '{"label": "رقم الحساب", "value": "68202707824000"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 19, 'kv', '{"label": "رقم الايبان", "value": "SA8505000068202707824000"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 20, 'h', '{"text": "رابعًا: إنهاء العقد او طلب تغيير في موضوع العقد:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 21, 'li', '{"text": "في حال رغبة \"الطرف الثاني\" في إنهاء \"العقد\" دون الإخلال بشروط هذا \"العقد\". يلتزم \"الطرف الثاني \" بسداد الفاتورة المستحقة حتى نهاية الشهر التعاقدي لتاريخ الإنهاء، بالإضافة إلى دفع أي مستحقات متبقية \"للطرف الاول\" (في حال زادت قيمة الإعلانات المقدمة \" بحسب الجدولة الشهرية المتفق عليها\" عن قيمة الفواتير الشهرية المدفوعة). مع التزام الطرف الثاني بدفع قيمة \" رسوم الخدمة اي تكاليف واتعاب الطرف الأول فقط\" بالإضافة نسبة 30% من قيمة المبلغ المتفق عليه."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 22, 'li', '{"text": "في حال رغب \"الطرف الاول\" في إنهاء \"العقد\" دون الإخلال بشروط هذا \"العقد\". يلتزم \"الطرف الاول\" بدفع أي مستحقات متبقية \"للطرف الثاني\" (في حال زادت قيمة الفواتير الشهرية المدفوعة عن قيمة الإعلانات المقدمة بحسب الجدولة الشهرية المتفق عليها)."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 23, 'li', '{"text": "في حال رغبة أحد الأسماء المتفق عليها من \"المؤثرين\" بإنهاء العقد المتفق عليه مع \"الطرف الاول\" لإعلانات \"الطرف الثاني\": يلتزم الطرف الأول بجلب \"مؤثر بديل بنفس التصنيف \" للطرف الثاني."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 24, 'li', '{"text": "لا يمكن طلب زيادة عدد الإعلانات المتفق عليها في \" امر توفير الخدمة الاعلانية\". حيث ان الأسعار المعطاة مرتبطة ارتباط كلي بعدد الإعلانات الكمي."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 25, 'li', '{"text": "في حال قيام \"الطرف الثاني\" بإنهاء العقد بعد سداد أي مبالغ مالية للطرف الأول , يحق للطرف الأول استخدام تلك المبالغ لتسوية أي مديونية قائمة على الطرف الثاني – ان وجدت-."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 26, 'h', '{"text": "خامساً: أحكام عامة:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 27, 'li', '{"text": "يحق لأي من الطرفين التصريح باسم وشعار الطرف الاخر بأنه متعاقد معه في حملاته التسويقية."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 28, 'li', '{"text": "للطرف الثاني الحق في استخدام الإعلان محل هذا العقد لغرض الترويج و التسويق عبر منصة \"سناب شات\" لمدة 6 اشهر من تاريخ العقد."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 29, 'li', '{"text": "بما ان الطرف الأول يعتبر مجرد وسيط وقناة تواصل بين الطرف الثاني والمؤثر وجميع القرارات المتخذة في تنفيذ الإعلان يتم طلبها والموافقة عليها من قبل الطرف الثاني والمؤثر.  فإن الطرف الأول غير مسؤول عن أي مخالفات تصدر من قبل الجهات الحكومية للطرف الثاني او المؤثر."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 30, 'li', '{"text": "يلتزم الطرف الثاني بالإفصاح عن المنتج التجاري المراد الإعلان عنه (مثال: مواد غذائية او ملبوسات) في بداية التعاقد ولا يحق له استخدام المساحة الاعلانية لمنتج مختلف تماما (مثال: مستحضرات طبية او أجهزة كهربائية ...الخ) الا بعد موافقة الطرف الاول."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 31, 'li', '{"text": "في حال كان الطرف الثاني يندرج تحت مظلة الهيئة العامة للغذاء والدواء:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 32, 'li', '{"text": "يلتزم الطرف الثاني بتقديم جميع المتطلبات المذكورة في \" الدليــــــل الاسترشادية لإعلانات الأفراد على شبكات التواصل الاجتماعي\" من هيئة الغذاء والدواء لكل منتج يريد الإعلان عنه. في حال عدم توفير جميع المتطلبات لمنتج معين، يحق للطرف الأول او المؤثر رفض تنفيذ الإعلان لمنتج لهذا المنتج مع بقاء سريان كامل العقد للمنتجات الأخرى المتوافقة مع الاحكام."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 33, 'li', '{"text": "يلتزم الطرف الثاني بتقديم الصيغة المقترحة للإعلان موقعة من الطرف الثاني. ويحق للطرف الأول او المؤثر رفض تنفيذ الإعلان في حال عدم الموافقة على صيغة الإعلان مع بقاء سريان كامل العقد للمنتجات الأخرى المتوافقة مع الاحكام."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 34, 'li', '{"text": "في حال لم يتمكن الطرف الثاني من استكمال المتطلبات المذكورة في \" الدليــــــل الاسترشادية لإعلانات الأفراد على شبكات التواصل الاجتماعي\" من هيئة الغذاء. يحق للطرف الأول طلب انهاء العقد."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 35, 'li', '{"text": "في حال حدوث \"القوة القاهرة\" ومن ذلك على سبيل المثال لا الحصر في الحالات التالية: حرب، حريق، فيضان، سيول، زلزال، تفجر، عصيان مدني، اعتداءات مسلحة، أعمال إرهابية، ثورة، حصار، حظر، وباء: لا يكون أي طرف مسؤولاً أمام الطرف الآخر عن أي تأخير أو إخلال في تنفيذ التزاماته بموجب هذا \"العقد\" نتيجة أي سبب أو أسباب خارجة عن إرادته، وعليه يتم تعليق التزام الطرف المتأثر في تنفيذ التزاماته بموجب \"العقد\" لمدة \"حدث القوة القاهرة وآثاره. بشرط أن يقوم الطرف المتأثر بإخطار الطرف الأخر كتابياً فور حدوث \"حدث القوة القاهرة\"."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 36, 'li', '{"text": "في حال عدم ارتباط حدث \"القوة القاهرة\" بوقت محدد، يجوز لاي من الطرفين فسخ هذا \"العقد\" تلقائياً عن طريق إخطار باقي الأطراف. مع الالتزام بسداد المستحقات المالية المستحقة قبل تاريخ إخطار الطرف الأخر. باستثناء بعض من حالات القوة القاهرة المرتبطة بالالتزامات المالية مثل \" اعلان الإفلاس\"."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 37, 'li', '{"text": "السرية: يتعهد \"الطرفان\" بأن أي إخلال أو تقصير او تسريب من قبل أحدهما يعطي \"الطرف الاخر\" كامل الأحقية في اتخاذ الإجراء المناسب لحماية حقوقه التعاقدية ومعلوماته الخاصة كما يقر الطرفان بسريان نظام عقوبات نشر الوثائق والمعلومات السرية وإفشائها على ما سيتم تبادله من معلومات لم يتم الافصاح عنها للعامة او نشرها من خلال تنفيذ بنود هذا العقد وأن يسري مفعول السرية حتى بعد انتهاء هذا العقد أو إلغائه لأي سبب من الأسباب."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 38, 'li', '{"text": "يخضع هذا \"العقد\" في تفسيره وتنفيذه وكافة جوانبه لأحكام الأنظمة المطبقة في المملكة العربية السعودية وإذا حدث أي نزاع بين الأطراف حول تطبيق أو تفسير أحد شروط أو أحكام هذا \"العقد\" وتعذر تسويته بالطرق الودية خلال ثلاثون (30) يوما من تاريخ إرسال أحد الأطراف إخطاراً بوجود نزاع حول هذا \"العقد\" فيتم إحالة النزاع إلى الجهة القضائية المختصة بمدينة جدة."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 39, 'li', '{"text": "الشروط الباطلة: إن بطلان أي بند من بنود هذا \"العقد\" لا يؤثر على بقية بنود \"العقد\" التي تظل سارية ومنتجة لأثارها بين \"الطرفين\"."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 40, 'h', '{"text": "سادساً: مدة العقد:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 41, 'p', '{"text": "اتفق الطرفان على ان يقوم الطرف الأول بتقديم جميع المحتوى المتفق عليه بعد موافقة الطرف الثاني على المحتوى خلال  \" {{ CL_DURATION }} \"  وبعد توقيع هذا العقد يكون نافذا الى حينه."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 42, 'h', '{"text": "سابعاً: الإخطار والمراسلات:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 43, 'p', '{"text": "تعتبر الموافقة الإلكترونية كافية في حدوث أي إشعار رسمي بين كل من الطرفين، وذلك يتضمن البريد الإلكتروني، والرسائل النصية، والرسائل من خلال تطبيق الواتساب، أو أي وسيلة اتصال حديثة. كما يجب أن يكون الرد خلال مدة أقصاها يومين من تاريخ الإرسال ويلتزم الطرف الثاني ببيان أن المحتوى الذي يتم تصويره من قبل مؤثر التواصل الاجتماعي هو إعلان التزاماً بضوابط الإعلانات في المملكة العربية السعودية."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 44, 'p', '{"text": "تم تحرير هذا العقد من نسختين، وتسليم كل طرف نسخة منه. وعليه جرى التوقيع:"}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 45, 'p', '{"text": "والله الموفق."}'::jsonb, false);
  insert into legal.doc_template_block (version_id, workspace_id, position, block_type, content, optional)
    values (v_ver, v_ws, 46, 'sig', '{"right": "الطرف الأول: احمد قرنفلة", "left": "الطرف الثاني: {{ CL_SIGNATORY }}"}'::jsonb, false);

  -- 5. prove it ----------------------------------------------
  select count(*) into v_n from legal.doc_template_block where version_id = v_ver;
  if v_n <> 46 then
    raise exception 'seed: expected 46 blocks, wrote %', v_n;
  end if;

  -- EVERY merge field in the wording is a registered field. An unregistered
  -- one prints as a literal {{ KEY }} on a signed contract and there is no
  -- box on the fill screen to put a value in - the failure is invisible until
  -- somebody is holding the paper.
  select count(*) into v_n
    from (select distinct m[1] as key
            from legal.doc_template_block b,
                 lateral regexp_matches(b.content::text, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') m
           where b.version_id = v_ver) u
   where not exists (select 1 from legal.placeholder p
                      where p.workspace_id = v_ws and p.key = u.key);
  if v_n > 0 then
    raise exception 'seed: % merge field(s) in the wording are not registered fields', v_n;
  end if;

  -- And nothing was published. A legal document is published by a person who
  -- has read it.
  if exists (select 1 from legal.doc_template_version
              where id = v_ver and status <> 'draft') then
    raise exception 'seed: the new version is not a draft';
  end if;

  raise notice 'seed: the client contract is in as a draft - read it, then press Publish';
end $seed$;

notify pgrst, 'reload schema';

-- Verify (paste this after running the migration):
-- select t.doc_kind, v.version, v.status, count(b.id) as blocks
--   from legal.doc_template t
--   join legal.doc_template_version v on v.template_id = t.id
--   left join legal.doc_template_block b on b.version_id = v.id
--  where t.doc_kind = 'client_contract'
--  group by 1, 2, 3 order by 2;

