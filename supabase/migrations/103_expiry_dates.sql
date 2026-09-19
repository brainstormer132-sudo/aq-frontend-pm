-- 103_expiry_dates.sql
-- Track when a client's CR and a vendor's licence expire, so staff get an
-- "expiring soon / expired" flag. Idempotent.
alter table public.clients add column if not exists cr_expiry date;
alter table public.vendors add column if not exists license_expiry date;
