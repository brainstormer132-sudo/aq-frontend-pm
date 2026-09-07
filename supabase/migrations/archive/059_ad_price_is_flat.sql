-- ============================================================
-- 059_ad_price_is_flat.sql
-- One price per ad. Not a unit price.
--
-- 056 priced an ad line the way an invoice line works: a unit price times a
-- quantity, with the product generated as line_total. In practice nobody
-- books that way here — a vendor quotes "this ad, 1,500", and the person
-- entering it then has to decide whether 1,500 goes in the unit column or
-- the total column. Two boxes for one number is two ways to be wrong, and
-- the wrong one lands in a contract.
--
-- So `unit_price` is now simply the price of that ad, flat. `line_total` is
-- kept — every reader in the app and every report selects it — but it is now
-- generated as the price itself rather than a product, so the two can never
-- disagree.
--
-- `quantity` stays. It is what makes the contract say "6 × Home Ad" instead
-- of "Home Ad", and it no longer touches the money.
--
-- Existing rows: a line with quantity 1 (all of them, since the dialog only
-- ever created quantity-1 rows) is unchanged. A line someone had entered as
-- quantity 6 × 1,500 would drop from 9,000 to 1,500, so those are repriced
-- to their old total below rather than silently losing money.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor. Run 056–058 first.
-- ============================================================

begin;

-- Keep what the old formula said before the formula changes. A generated
-- column cannot be read after it is dropped, so this has to happen first.
alter table public.vendor_ad_lines
  add column if not exists legacy_total numeric(12,2);

update public.vendor_ad_lines
   set legacy_total = quantity * unit_price
 where legacy_total is null;

alter table public.vendor_ad_lines drop column if exists line_total;

alter table public.vendor_ad_lines
  add column line_total numeric(12,2) generated always as (unit_price) stored;

-- Anything that was priced per unit keeps the money it had.
update public.vendor_ad_lines
   set unit_price = legacy_total
 where quantity > 1
   and legacy_total is not null
   and legacy_total <> unit_price;

comment on column public.vendor_ad_lines.unit_price is
  'The price of THIS ad, flat. Not multiplied by quantity. May be 0 — a free reminder is still part of the agreement.';
comment on column public.vendor_ad_lines.quantity is
  'How many pieces this line stands for, for the contract wording. Does not affect the price.';
comment on column public.vendor_ad_lines.legacy_total is
  'What quantity × unit_price came to before 059. Kept so the repricing above can be checked, and can be dropped once it has been.';

commit;

-- ─── Verification ───────────────────────────────────────────────
select column_name, data_type, is_generated, generation_expression
  from information_schema.columns
 where table_schema = 'public' and table_name = 'vendor_ad_lines'
   and column_name in ('unit_price', 'quantity', 'line_total')
 order by column_name;
-- Expect line_total generated ALWAYS, expression `unit_price`.

select count(*)                                          as lines_total,
       count(*) filter (where quantity > 1)              as multi_piece_lines,
       count(*) filter (where line_total <> legacy_total) as repriced,
       sum(line_total)                                   as money_now,
       sum(legacy_total)                                 as money_before
  from public.vendor_ad_lines;
-- money_now and money_before must match. If they do not, stop and say so —
-- a booking has quietly changed value.
