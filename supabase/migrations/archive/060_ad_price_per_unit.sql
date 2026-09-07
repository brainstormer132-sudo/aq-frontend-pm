-- ============================================================
-- 060_ad_price_per_unit.sql
-- Back to a price per ad, times a quantity. Undoes 059.
--
-- 059 made `unit_price` the flat price of a whole line, because a vendor
-- quotes "this ad, 1,500" and two boxes for one number is two ways to be
-- wrong. In use it turned out worse: a line of 4 Store Visits at 5,000.66
-- read as 5,000 for all four, and the number people actually hold in their
-- head is the per-ad rate. Siraj asked for the per-unit price back.
--
-- So `line_total` is generated as `quantity * unit_price` again, exactly as
-- 056 had it.
--
-- ─── The money ──────────────────────────────────────────────────
-- This changes what a row is worth, and that is the point: a line of 4 at
-- 5,000.66 is meant to become 20,002.64. But rows that 059 REPRICED must not
-- be inflated on the way back.
--
-- 059 recorded `legacy_total` (what quantity × unit_price came to before it
-- ran) and then, for rows with quantity > 1, set unit_price = legacy_total.
-- Those rows are put back by dividing: unit_price = legacy_total / quantity,
-- so quantity × unit_price lands on exactly the number they had before 059.
--
-- Rows created AFTER 059 have legacy_total null and are left alone — they
-- were entered as flat prices and will now multiply, which is what was
-- asked for. The verification at the bottom lists them so they can be
-- checked by eye.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor. Run 056–059 first.
-- ============================================================

begin;

alter table public.vendor_ad_lines drop column if exists line_total;

alter table public.vendor_ad_lines
  add column line_total numeric(12,2) generated always as (quantity * unit_price) stored;

-- Put back only the rows 059 repriced: it set unit_price = legacy_total, so
-- those are the ones where the two still match. Guarded on legacy_total being
-- present, which is only true of rows that existed when 059 ran.
update public.vendor_ad_lines
   set unit_price = round(legacy_total / quantity, 2)
 where quantity > 1
   and legacy_total is not null
   and unit_price = legacy_total;

comment on column public.vendor_ad_lines.unit_price is
  'The price of ONE ad on this line. Multiplied by quantity to get line_total. May be 0 — a free reminder is still part of the agreement.';
comment on column public.vendor_ad_lines.quantity is
  'How many ads this line stands for. Multiplies the price.';

commit;

-- ─── Verification ───────────────────────────────────────────────
select column_name, is_generated, generation_expression
  from information_schema.columns
 where table_schema = 'public' and table_name = 'vendor_ad_lines'
   and column_name = 'line_total';
-- Expect generation_expression = (quantity * unit_price).

-- Rows that existed before 059: their totals must match what they were then.
select count(*)                                            as pre_059_rows,
       count(*) filter (where line_total <> legacy_total)  as drifted,
       sum(legacy_total)                                   as money_before_059,
       sum(line_total)                                     as money_now
  from public.vendor_ad_lines
 where legacy_total is not null;
-- drifted must be 0, and the two sums must match. If not, stop and say so.

-- Rows entered since 059, as flat prices. These DO change value — check them.
select id, subtask_id, ad_type, quantity, unit_price, line_total
  from public.vendor_ad_lines
 where legacy_total is null and quantity > 1
 order by subtask_id, position;
-- Each of these is now worth quantity × unit_price instead of unit_price.
-- If any of them was entered as a whole-line price, divide it by hand.
