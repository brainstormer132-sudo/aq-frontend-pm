-- Remove the DB legal-system influencer template + its example draft + the
-- fields/lists seeded with it, from workspace AQ Creativity. Scoped and safe:
-- the workspace had 0 fields/0 lists before this seed, and only the template
-- named below is touched (the pre-existing 5-block template is left alone).
set search_path = legal, public;
do $rm$
declare v_ws uuid := '874c6670-29d9-48f1-97a4-ccbc0e54208b';
begin
  -- the freeze trigger blocks deleting a published version, so lift it briefly
  alter table legal.doc_template_version disable trigger trg_freeze_version;
  alter table legal.doc_template_block   disable trigger trg_freeze_block;

  delete from legal.contract
   where workspace_id = v_ws
     and template_id in (select id from legal.doc_template
                          where workspace_id = v_ws and name = 'عقد تسويق إلكتروني');

  delete from legal.doc_template
   where workspace_id = v_ws and name = 'عقد تسويق إلكتروني';   -- cascades version + 100 blocks

  alter table legal.doc_template_version enable trigger trg_freeze_version;
  alter table legal.doc_template_block   enable trigger trg_freeze_block;

  delete from legal.managed_list_value where workspace_id = v_ws;
  delete from legal.managed_list       where workspace_id = v_ws;
  delete from legal.placeholder        where workspace_id = v_ws;

  raise notice 'removed the legal-system influencer template, its draft, and its fields/lists';
end
$rm$;
