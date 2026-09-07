-- 069_one_source_for_booking_money.sql
--
-- One place decides what a booking is worth.
--
-- An influencer is priced per piece, so the ads under a booking carry the
-- money and the booking is their sum (067 added the per-ad columns; the
-- campaign page started using them). But `pm_tasks.price` is still written
-- by `syncBookingPriceFromAds()` after the fact, so the stored number is a
-- *cache* of the lines rather than a fact — correct only until somebody edits
-- a line and the sync has not run yet, or fails.
--
-- Everything except the campaign page reads that cache: the Dashboard, All
-- Tasks, the Data screen and the client-facing rollup all go through
-- `pm_task_campaign_rollup`. So the campaign page and the Dashboard could show
-- two different vendor costs for the same campaign and both be reading
-- honestly.
--
-- This replaces the view so it works the money out from the ad lines when the
-- ads are priced, and falls back to the booking's own price when they are not.
-- Same rule as the page, in one place, so nothing downstream has to know.
--
-- One column is added at the end — `vendor_cost`, which is the sum of the
-- nets unless somebody has typed a figure over it (068). `create or replace
-- view` allows appending, so every existing reader keeps working untouched.
--
-- A word on which number is which, because the campaign page had it backwards
-- until today and the arithmetic looked fine while being wrong:
--
--   price      — what the CLIENT is billed for that vendor's work
--   net_amount — what the VENDOR takes for doing it
--   aq_gross   — price − net_amount, what AQ keeps (028)
--
-- So sum_prices is revenue and sum_nets is cost. They are not two names for
-- the same money.
--
-- Safe to re-run.

create or replace view public.pm_task_campaign_rollup as
with line_money as (
  -- What each booking's ads add up to. A line at zero is an unpriced line,
  -- not free work, so `priced` is what decides whether the lines take over —
  -- exactly the rule bookingRows() applies on the page.
  select
    l.subtask_id,
    sum(greatest(coalesce(l.quantity, 1), 1) * coalesce(l.unit_price, 0)) as ads_total,
    sum(coalesce(l.net_amount, 0))                                       as ads_net,
    bool_or(coalesce(l.unit_price, 0) > 0)                               as priced,
    bool_or(l.net_amount is not null)                                    as has_net
  from public.vendor_ad_lines l
  where l.subtask_id is not null
  group by l.subtask_id
),
booking as (
  select
    child.parent_task_id,
    child.id,
    child.status,
    -- Priced ads win. Otherwise the booking keeps the number typed on it,
    -- which is every booking made before per-line pricing existed.
    case when coalesce(lm.priced, false) then lm.ads_total else child.price end
      as effective_price,
    case when coalesce(lm.priced, false) and coalesce(lm.has_net, false)
         then lm.ads_net else child.net_amount end
      as effective_net
  from public.pm_tasks child
  left join line_money lm on lm.subtask_id = child.id
  where child.parent_task_id is not null
)
select
  parent.id                              as parent_task_id,
  parent.workspace_id,
  parent.title,
  parent.brand_name,
  parent.budget                          as parent_total_amount,
  parent.client_payment_status,
  parent.contract_status,
  count(b.id)                            as vendor_count,
  count(b.id) filter (where b.status = 'done')          as vendors_done,
  coalesce(sum(b.effective_price), 0)    as sum_prices,
  coalesce(sum(b.effective_net), 0)      as sum_nets,
  -- Worked out here rather than summing the stored `aq_gross`, which is
  -- generated from price − net_amount on the booking and therefore knows
  -- nothing about the ads. An override (068) stands in for the sum here too,
  -- so the Dashboard cannot show a margin the campaign page disagrees with.
  coalesce(sum(b.effective_price), 0)
    - coalesce(parent.vendor_cost_override, sum(b.effective_net), 0)
                                         as sum_aq_gross,
  coalesce(sum(b.effective_price), 0) - coalesce(parent.budget, 0)
                                         as price_vs_total_variance,
  -- Appended, so existing readers are unaffected. What the vendors actually
  -- cost this campaign: the sum of their nets, unless somebody has agreed
  -- something the bookings cannot see and typed it instead.
  coalesce(parent.vendor_cost_override, sum(b.effective_net), 0)
                                         as vendor_cost,
  parent.vendor_cost_override is not null and count(b.id) > 0
                                         as vendor_cost_overridden
from public.pm_tasks parent
left join booking b on b.parent_task_id = parent.id
where parent.parent_task_id is null
group by parent.id, parent.workspace_id, parent.title, parent.brand_name,
         parent.budget, parent.client_payment_status, parent.contract_status,
         parent.vendor_cost_override;

comment on view public.pm_task_campaign_rollup is
  'One row per campaign. sum_prices is what the client is billed; vendor_cost is what the vendors take (sum of nets, or the typed override); sum_aq_gross is the difference. Booking money comes from the ad lines when they are priced and from the booking''s own figures when they are not — the same rule the campaign page applies, so the Dashboard and the page cannot disagree.';

-- ───────────────────────────────────────────────────────────────────
-- The view alone is not enough.
--
-- The Data screen and the money ledger do not read the view — they fetch
-- subtasks and sum `price` in the browser. Rewriting all of them to fetch ad
-- lines would make those screens load every line in the workspace to show one
-- total.
--
-- So the database keeps the booking in step itself. `syncBookingPriceFromAds()`
-- in the app did this from the client after the fact, which meant the number
-- was right only if that call happened and succeeded — a failed sync, a closed
-- tab, or a line edited by anything other than the ad card left it stale, and
-- nothing anywhere said so.
--
-- Now a line cannot change without its booking changing with it, whoever or
-- whatever edited it. Every existing reader becomes correct without knowing
-- anything about ad lines.
-- ───────────────────────────────────────────────────────────────────

create or replace function public.sync_booking_money_from_lines()
returns trigger
language plpgsql
as $$
declare
  targets uuid[];
  target  uuid;
  total  numeric(14,2);
  netsum numeric(14,2);
  priced boolean;
  hasnet boolean;
begin
  -- Both sides on an update, in case a line was moved between bookings.
  -- `foreach ... in array` takes an expression, not a subquery, so the array
  -- is built first and iterated after.
  select array_agg(distinct x)
    into targets
    from unnest(array[
      case when tg_op in ('UPDATE','DELETE') then old.subtask_id end,
      case when tg_op in ('UPDATE','INSERT') then new.subtask_id end
    ]) as x
   where x is not null;

  if targets is null then
    return null;
  end if;

  foreach target in array targets
  loop
    select
      coalesce(sum(greatest(coalesce(l.quantity, 1), 1) * coalesce(l.unit_price, 0)), 0),
      coalesce(sum(coalesce(l.net_amount, 0)), 0),
      coalesce(bool_or(coalesce(l.unit_price, 0) > 0), false),
      coalesce(bool_or(l.net_amount is not null), false)
      into total, netsum, priced, hasnet
      from public.vendor_ad_lines l
     where l.subtask_id = target;

    -- Unpriced lines leave the booking's own numbers alone. Zero is an
    -- unpriced line, not free work, and overwriting a typed 45,000 with a
    -- zero because nobody has costed the ads yet would be worse than useless.
    if priced then
      update public.pm_tasks
         set price = total,
             net_amount = case when hasnet then netsum else net_amount end
       where id = target
         and (price is distinct from total
              or (hasnet and net_amount is distinct from netsum));
    end if;
  end loop;

  return null;   -- AFTER trigger
end $$;

comment on function public.sync_booking_money_from_lines() is
  'Keeps pm_tasks.price and net_amount equal to the booking''s priced ad lines. Replaces the app-side syncBookingPriceFromAds(), which only ran when the ad card happened to call it.';

drop trigger if exists trg_sync_booking_money on public.vendor_ad_lines;
create trigger trg_sync_booking_money
after insert or update or delete on public.vendor_ad_lines
for each row execute function public.sync_booking_money_from_lines();

-- Backfill: every booking whose cached price has already drifted from its
-- priced lines. Without this the fix only applies to lines edited from now on.
with line_money as (
  select
    l.subtask_id,
    sum(greatest(coalesce(l.quantity, 1), 1) * coalesce(l.unit_price, 0)) as ads_total,
    sum(coalesce(l.net_amount, 0))                                       as ads_net,
    bool_or(coalesce(l.unit_price, 0) > 0)                               as priced,
    bool_or(l.net_amount is not null)                                    as has_net
  from public.vendor_ad_lines l
  where l.subtask_id is not null
  group by l.subtask_id
)
update public.pm_tasks t
   set price = lm.ads_total,
       net_amount = case when lm.has_net then lm.ads_net else t.net_amount end
  from line_money lm
 where lm.subtask_id = t.id
   and lm.priced
   and (t.price is distinct from lm.ads_total
        or (lm.has_net and t.net_amount is distinct from lm.ads_net));

-- ─── Verification ──────────────────────────────────────────────────
-- Any campaign where the view and the raw sum of child prices disagree is one
-- whose ads are priced and whose cached booking price has drifted. Expect
-- rows here on a live database; that drift is the reason for this migration.
select
  r.parent_task_id,
  r.sum_prices                    as from_the_ads,
  coalesce(raw.cached, 0)         as cached_on_bookings,
  r.sum_prices - coalesce(raw.cached, 0) as drift
from public.pm_task_campaign_rollup r
left join (
  select parent_task_id, sum(price) as cached
  from public.pm_tasks
  where parent_task_id is not null
  group by parent_task_id
) raw on raw.parent_task_id = r.parent_task_id
where r.sum_prices is distinct from coalesce(raw.cached, 0)
order by abs(r.sum_prices - coalesce(raw.cached, 0)) desc
limit 20;
