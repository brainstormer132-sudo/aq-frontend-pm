-- 083_ad_line_bank.sql
--
-- A bank account per ad line.
--
-- Siraj: *"a vendor could use a different bank account per ad"*. A vendor
-- contract carries exactly one bank, and the app already lets a booking be
-- sent as one combined contract or one contract per line. So the bank sits
-- on the line: a combined contract uses the vendor's default bank as before,
-- and a per-line contract uses whatever bank that line points at.
--
-- Nullable, and null means "the vendor's default" - which is exactly what
-- every existing line already gets, so nothing changes for work already
-- booked. ON DELETE SET NULL: removing a bank account must not take the ad
-- line with it; the line simply falls back to the default.
--
-- Safe to re-run.

alter table public.vendor_ad_lines
  add column if not exists bank_account_id bigint
    references public.bank_accounts(id) on delete set null;

comment on column public.vendor_ad_lines.bank_account_id is
  'Which of the vendor''s bank accounts this ad is paid to. Null = the vendor''s default. Used when a booking is contracted per line; a combined contract uses the default.';
