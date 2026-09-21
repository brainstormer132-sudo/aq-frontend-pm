-- ============================================================
-- 111_legal_list_labels.sql   GENERATED - do not hand-edit.
--   node scripts/build-legal-lists.mjs
--
-- Two corrections to 110.
--
-- 1. THE LABEL IS ENGLISH. Siraj: "make platform in english but it gets
--    translated into arabic". 110 set label and value both to Arabic, which
--    was a misread of the same sentence that got the value right: the LABEL is
--    what the operator picks from, the VALUE is what prints into the contract.
--    So the dropdown reads Instagram / TikTok / Reel, and the document still
--    says انستقرام / تيك توك / رييل. Matched on the Arabic value, so a
--    value legal has since renamed by hand is left alone.
--
-- 2. legal.placeholder.allow_other. A list field that also accepts a value of
--    its own - "add an other in case there is something specific". Set on
--    platform_smart and ad_types. Default false, so every other list stays
--    closed and an off-list value there is still an error.
--
-- Carried-over platforms from a workspace's own task_platforms are NOT in the
-- pair list, so their label stays whatever it was - there is no English term
-- to restore, they were English to begin with.
--
-- Idempotent. Run in staging, then prod. Then: notify pgrst.
-- ============================================================

set search_path = legal, public;

alter table legal.placeholder
  add column if not exists allow_other boolean not null default false;

comment on column legal.placeholder.allow_other is
  'A list field that also takes an off-list value the operator types. Only meaningful when field_type = list.';

update legal.placeholder
   set allow_other = true
 where key in ('platform_smart', 'ad_types')
   and allow_other is distinct from true;

do $labels$
declare
  r record;
  n integer := 0;
begin
  for r in
    select * from (values
    ('انستقرام', 'Instagram'),
    ('تيك توك', 'TikTok'),
    ('سناب تشات', 'Snapchat'),
    ('إكس', 'X'),
    ('يوتيوب', 'YouTube'),
    ('فيسبوك', 'Facebook'),
    ('لينكد إن', 'LinkedIn'),
    ('إعلان خارجي', 'Outdoor'),
    ('زيارة متجر', 'Store Visit'),
    ('زيارة متجر - صامتة', 'Store Visit -Silent-'),
    ('إعلان منزلي', 'Home Ad'),
    ('إعلان منزلي - صامت', 'Home Ad -Silent-'),
    ('لوحات إعلانية', 'Billboards'),
    ('رعاية', 'Sponsorship'),
    ('حقوق الاستخدام', 'Usage Rights'),
    ('حضور فعالية', 'Event Attending'),
    ('ترويج مدفوع', 'Paid promotion'),
    ('خدمات لوجستية', 'Logistics'),
    ('تصوير فوتوغرافي', 'PhotoShot'),
    ('تصوير فيديو', 'VideoShot'),
    ('بوست', 'Post'),
    ('بوست متعدد الصور', 'Carousel Post'),
    ('رييل', 'Reel'),
    ('ستوري', 'Story'),
    ('فيديو', 'Video'),
    ('بث مباشر', 'Live'),
    ('إنتاج إعلامي', 'Media Production'),
    ('إعادة نشر مع تعليق', 'Quote Tweet'),
    ('خدمات متعددة', 'Multi Service')
    ) as t(ar, en)
  loop
    update legal.managed_list_value v
       set label = r.en
      from legal.managed_list l
     where l.id = v.list_id
       and l.key in ('platforms', 'ad_types')
       and v.value = r.ar
       and v.label is distinct from r.en;
    n := n + 1;
  end loop;
  raise notice 'checked % label pairs', n;
end
$labels$;
