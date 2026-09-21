-- ============================================================
-- 114_optional_groups.sql
-- An optional clause is a SECTION, not a block.
--
-- Siraj: "by default all legal requirement is recommended but they can choose
-- the ones they want to remove or edit from the app."
--
-- -- WHY THIS IS NEEDED AT ALL ---------------------------------------
--
-- The optional-clause machinery has been shipped since slice 9 and has NEVER
-- BEEN VISIBLE. legal.doc_template_block.optional exists, ContractFill draws a
-- checkbox per optional block, visibleBlocks drops the switched-off ones from
-- the fields, the preview, the print and the fingerprint - and not one block
-- in the seeded template is marked optional, so the card renders empty every
-- time. `grep -c optional` on supabase/seeds/109 returns 0. The feature was
-- complete and unreachable.
--
-- -- WHY A GROUP, AND NOT JUST THE FLAG -------------------------------
--
-- Because `optional` is per BLOCK and a clause is not one block. Section
-- five of the UGC contract - termination and refunds - is a heading, four
-- paragraphs and four bank-detail rows: NINE blocks. Marking them optional
-- one at a time gives nine checkboxes, each labelled with the first ninety
-- characters of its own text, for one decision. Nobody would use that.
--
-- optional_group names the decision; optional_label is what the checkbox
-- says. Every block sharing a group switches together. A block with the flag
-- and no group is still its own switch, which is what a one-block optional
-- clause should be.
--
-- -- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ---------------------
--
-- It does not mark anything optional. It cannot: the 098 freeze trigger makes
-- the blocks of a PUBLISHED version immutable, which is the whole point of
-- stamping a contract to a version. Flags go on a NEW version (v3), seeded
-- separately, and every contract already stamped to v2 keeps reading exactly
-- as it does today.
--
-- Adding columns is DDL and is not what the freeze guards - it guards the
-- content of a frozen version, and a column with a default of null/false
-- changes no existing block's meaning.
-- ============================================================

set search_path = legal, public;

alter table legal.doc_template_block
  add column if not exists optional_group text;

alter table legal.doc_template_block
  add column if not exists optional_label text;

-- The screen asks "which groups are in this version" on every contract load.
create index if not exists idx_legal_dtb_optgroup
  on legal.doc_template_block(version_id, optional_group)
  where optional_group is not null;

-- A group is only meaningful on a block that is actually optional, and a
-- labelled group with no name is a checkbox nothing can switch. Both are
-- author errors rather than user input, so they are refused outright rather
-- than tolerated and rendered oddly.
--
-- `optional_group is not null` is written out rather than left to btrim:
-- btrim(null) is NULL, `NULL <> ''` is NULL, and a CHECK constraint PASSES on
-- NULL. Without that clause a label with no group was accepted - which the
-- assertion suite caught and reading the constraint did not.
--
-- NOT VALID: existing rows are not re-checked, because a published version's
-- blocks cannot be updated to satisfy a constraint even if they wanted to -
-- the freeze would refuse. Everything written from here on is checked.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'dtb_optional_group_chk'
       and conrelid = 'legal.doc_template_block'::regclass
  ) then
    alter table legal.doc_template_block
      add constraint dtb_optional_group_chk
      check (
        (optional_group is null and optional_label is null)
        or (optional is true
            and optional_group is not null
            and btrim(optional_group) <> '')
      ) not valid;
  end if;
end $$;

comment on column legal.doc_template_block.optional_group is
  'Blocks sharing this name switch on and off together as one clause. Null means this block is its own switch. Only meaningful when optional is true.';
comment on column legal.doc_template_block.optional_label is
  'What the checkbox says for this group, e.g. the section heading. Read from the first block in the group that carries one.';
