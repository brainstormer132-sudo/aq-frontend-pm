-- 094_rollup_tags.sql
--
-- Fold the campaign's Asana tags (088) into pm_task_campaign_rollup.
--
-- The Finance menu read the rollup for one row per campaign AND then made a
-- SECOND full scan of pm_tasks just to get each campaign's tags (the tab
-- filter). On a workspace with thousands of campaigns that is two full scans
-- per open of the screen. Adding `tags` to the rollup lets the screen read the
-- campaigns once, and the tags inherit the rollup's cache.
--
-- CREATE OR REPLACE VIEW keeps every existing column in the same order and only
-- APPENDS `tags` at the end (Postgres requires this), so no consumer of the
-- other columns is affected. Re-runnable: CREATE OR REPLACE is idempotent.

create or replace view public.pm_task_campaign_rollup
with (security_invoker = 'on') as
 with line_money as (
   select l.subtask_id,
          sum((greatest(coalesce(l.quantity, 1), 1))::numeric
              * coalesce(l.unit_price, (0)::numeric))            as ads_total,
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
        ((parent.vendor_cost_override is not null) and (count(b.id) > 0)) as vendor_cost_overridden,
        parent.tags as tags
   from (public.pm_tasks parent
         left join booking b on ((b.parent_task_id = parent.id)))
  where (parent.parent_task_id is null)
  group by parent.id, parent.workspace_id, parent.title, parent.brand_name,
           parent.budget, parent.client_payment_status, parent.contract_status,
           parent.vendor_cost_override, parent.tags;

-- PostgREST caches the schema; tell it a column was added.
notify pgrst, 'reload schema';
