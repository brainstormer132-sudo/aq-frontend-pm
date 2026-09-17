-- ============================================================
-- 101_date_alerts.sql
-- A date placeholder can carry an alert window on the registry: alert_days.
--   null       - the date is not alert-tracked.
--   0          - an expiry: the date must be today or later; a past date is
--                "expired" and blocks issuing the contract.
--   N (N > 0)  - a deadline: "expiring soon" when the date is within N days of
--                today; a past date is still "expired" and blocks issuing.
-- The New-Contract screen surfaces the alert and disables Issue while any
-- tracked date is expired. Advisory only - it does not touch the document text
-- or the fingerprint. Idempotent; 020/070 CI assertions already cover the
-- legal schema so nothing new needs a test-file change.
-- ============================================================

alter table legal.placeholder add column if not exists alert_days integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'placeholder_alert_days_nonneg') then
    alter table legal.placeholder
      add constraint placeholder_alert_days_nonneg check (alert_days is null or alert_days >= 0);
  end if;
end $$;
