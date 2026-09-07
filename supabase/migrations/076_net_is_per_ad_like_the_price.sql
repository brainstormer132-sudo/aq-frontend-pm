-- The vendor's fee is per ad, so multiply it by the quantity — the same as
-- the price already was.
--
-- ── The bug ───────────────────────────────────────────────────────
--
-- `sync_booking_money_from_lines()` and `pm_task_campaign_rollup` both did
-- this, on the same rows, in the same aggregate:
--
--     sum(greatest(coalesce(l.quantity,1),1) * coalesce(l.unit_price,0))  -- ×qty
--     sum(coalesce(l.net_amount, 0))                                      -- not
--
-- One field multiplied by the quantity and its sibling not. Both are per-ad
-- figures: `unit_price` is documented as "the price of ONE ad on this line",
-- and aq-price-is-not-net.md settles `net_amount` as "what the vendor takes
-- for that one ad".
--
-- A line of quantity 6, unit price 1,500, net 700 therefore stored
-- price 9,000 against a vendor cost of 700, and `aq_gross` — a generated
-- column, so it inherited the error silently — read 8,300. The truth is
-- 4,200 of cost and 4,800 of gross. The overstatement scales with quantity:
-- a twelve-piece package reports 11/12 of the vendor cost as margin.
--
-- Nobody spotted it because both figures are plausible and neither is
-- checked against anything. The project note even records the belief that
-- "they add up, and the trigger enforces that" — the trigger did not.
--
-- ── What this changes ─────────────────────────────────────────────
--
-- Three things, and the third is the one to read carefully:
--
--   1. The trigger multiplies the net by the quantity.
--   2. The rollup view does the same, so the Dashboard and the campaign page
--      cannot disagree. lib/campaign-page.ts is fixed in the same commit.
--   3. A BACKFILL, which rewrites stored money on real bookings.
--
-- The backfill only touches bookings whose lines are priced and carry a net,
-- and only where the recomputed figure actually differs. Rows where every
-- line is quantity 1 are untouched, because for them nothing changed. It
-- prints what it moved.
--
-- Safe to run twice: the second run finds nothing to change.

begin;

-- ── 1. The trigger ────────────────────────────────────────────────

create or replace function public.sync_booking_money_from_lines()
returns trigger
language plpgsql
as $$
declare
  targets uuid[];
  target  uuid;
  total   numeric(14,2);
  netsum  numeric(14,2);
  priced  boolean;
  hasnet  boolean;
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
      -- ×quantity, the same as the price. This is the fix.
      coalesce(sum(greatest(coalesce(l.quantity, 1), 1) * coalesce(l.net_amount, 0)), 0),
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
  'Keeps pm_tasks.price and net_amount equal to the booking''s priced ad lines. '
  'Both figures are per-ad and both are multiplied by quantity — 076 fixed the '
  'net, which was summed flat and so understated every multi-quantity vendor '
  'cost, silently inflating aq_gross.';

-- ── 2. The rollup view ────────────────────────────────────────────
--
-- `create or replace view` allows appending columns, not reordering or
-- retyping them, so the column list below is unchanged from 069 + 071.
-- security_invoker stays on: without it this view runs as its owner, and an
-- owner is exempt from its own RLS — which is how it served every campaign's
-- margin to anon before 071.

create or replace view public.pm_task_campaign_rollup
with (security_invoker = 'on') as
 with line_money as (
   select l.subtask_id,
          sum((greatest(coalesce(l.quantity, 1), 1))::numeric
              * coalesce(l.unit_price, (0)::numeric))            as ads_total,
          -- ×quantity, matching the trigger and lib/campaign-page.ts.
          sum((greatest(coalesce(l.quantity, 1), 1))::numeric
              * coalesce(l.net_amount, (0)::numeric))            as ads_net,
          bool_or((coalesce(l.unit_price, (0)::numeric) > (0)::numeric)) as priced,
          bool_or((l.net_amount is not null))                    as has_net
     from public.vendor_ad_lines l
    where (l.subtask_id is not null)
    group by l.subtask_id
 ), booking as (
   select child.parent_task_id,
          child.id,
          child.status,
          case when coalesce(lm.priced, false) then lm.ads_total
               else child.price end                              as effective_price,
          case when (coalesce(lm.priced, false) and coalesce(lm.has_net, false))
               then lm.ads_net
               else child.net_amount end                         as effective_net
     from (public.pm_tasks child
           left join line_money lm on ((lm.subtask_id = child.id)))
    where (child.parent_task_id is not null)
 )
 select parent.id as parent_task_id,
        parent.workspace_id,
        parent.title,
        parent.brand_name,
        parent.budget as parent_total_amount,
        parent.client_payment_status,
        parent.contract_status,
        count(b.id) as vendor_count,
        count(b.id) filter (where (b.status = 'done'::public.task_status)) as vendors_done,
        coalesce(sum(b.effective_price), (0)::numeric) as sum_prices,
        coalesce(sum(b.effective_net), (0)::numeric) as sum_nets,
        (coalesce(sum(b.effective_price), (0)::numeric)
         - coalesce(parent.vendor_cost_override, sum(b.effective_net), (0)::numeric)) as sum_aq_gross,
        (coalesce(sum(b.effective_price), (0)::numeric)
         - coalesce(parent.budget, (0)::numeric)) as price_vs_total_variance,
        coalesce(parent.vendor_cost_override, sum(b.effective_net), (0)::numeric) as vendor_cost,
        ((parent.vendor_cost_override is not null) and (count(b.id) > 0)) as vendor_cost_overridden
   from (public.pm_tasks parent
         left join booking b on ((b.parent_task_id = parent.id)))
  where (parent.parent_task_id is null)
  group by parent.id, parent.workspace_id, parent.title, parent.brand_name,
           parent.budget, parent.client_payment_status, parent.contract_status,
           parent.vendor_cost_override;

-- ── 3. The backfill ───────────────────────────────────────────────
--
-- Every stored net that the old flat sum got wrong. Reported, not silent:
-- this moves real money figures on real bookings and you should see how much.

do $$
declare
  r         record;
  moved     int := 0;
  delta_sum numeric(14,2) := 0;
begin
  for r in
    select t.id,
           t.title,
           t.net_amount                                            as was,
           coalesce(sum(greatest(coalesce(l.quantity,1),1)
                        * coalesce(l.net_amount,0)), 0)::numeric(14,2) as now_
      from public.pm_tasks t
      join public.vendor_ad_lines l on l.subtask_id = t.id
     group by t.id, t.title, t.net_amount
    having bool_or(coalesce(l.unit_price,0) > 0)      -- priced lines only
       and bool_or(l.net_amount is not null)          -- and a net worked out
       and t.net_amount is distinct from
           coalesce(sum(greatest(coalesce(l.quantity,1),1)
                        * coalesce(l.net_amount,0)), 0)::numeric(14,2)
  loop
    update public.pm_tasks set net_amount = r.now_ where id = r.id;
    moved := moved + 1;
    delta_sum := delta_sum + (r.now_ - coalesce(r.was, 0));
    raise notice 'booking % (%): vendor cost % -> %', r.id, r.title, r.was, r.now_;
  end loop;

  raise notice '076 backfill: % booking(s) corrected, vendor cost up by % in total '
               '(AQ gross falls by the same amount — it was overstated).',
               moved, delta_sum;
end $$;

commit;

-- ── 4. The comment that said the opposite ─────────────────────────
--
-- Not cosmetic. `vendor_ad_lines.net_amount` was commented "What AQ nets on
-- this ad", and the UI field above it read "Net on this ad" — while
-- aq_gross is GENERATED AS (price - net_amount) and the rollup's vendor_cost
-- is the sum of nets. The code has always meant the vendor's fee; the two
-- things a person reads before typing said AQ's margin.
--
-- Nothing here can catch somebody answering the wrong question, so the
-- question has to be asked properly. The label is now "Vendor's fee, per ad".

comment on column public.vendor_ad_lines.net_amount is
  'What the VENDOR takes for ONE ad on this line — multiplied by quantity, '
  'exactly as unit_price is. NOT what AQ nets: aq_gross is (price - net_amount), '
  'so this is the cost side. Null = not worked out yet, which is not zero, and '
  'a vendor contract cannot be written from null.';

comment on column public.pm_tasks.net_amount is
  'What the VENDOR takes for the whole booking. Kept in step with the ad '
  'lines by sync_booking_money_from_lines() when they are priced.';
