-- ============================================================
-- 058_ad_line_proof.sql
-- Proof of posting belongs to the post.
--
-- It started on the campaign, where one tick had to speak for six
-- influencers. Aug 2026 moved it down to the vendor subtask, which was
-- better and still not right: an influencer booked for six home ads and six
-- store visits posts twelve times, on twelve days. One link on the booking
-- says "some of it happened" and nothing about which.
--
-- So it moves one level further, onto the ad line — the thing that was
-- actually posted. The columns on pm_tasks are left exactly where they are:
-- a vendor booked for a single piece of work has no lines, and its proof
-- still lives on the subtask.
--
-- Nothing is migrated upward or downward. A booking whose proof sits on the
-- subtask keeps it there; splitting one link across twelve ads would be a
-- guess, and a guess recorded as evidence is worse than a blank.
--
-- Safe to run twice.
-- Run in the Supabase SQL editor. Run 057 first.
-- ============================================================

begin;

alter table public.vendor_ad_lines
  add column if not exists proof_of_posting_link     text,
  add column if not exists proof_of_posting_attached boolean not null default false,
  add column if not exists posted_on                 date;

comment on column public.vendor_ad_lines.proof_of_posting_link is
  'Proof for THIS ad. The booking above may hold twelve of them, each posted on its own day.';
comment on column public.vendor_ad_lines.proof_of_posting_attached is
  'Ticked when the file itself is filed somewhere other than a link.';
comment on column public.vendor_ad_lines.posted_on is
  'When it actually went up — which is not always the day it was due.';

-- "Which ads are still missing proof" is the question the campaign panel
-- asks on every open, across every line of every vendor on it.
create index if not exists idx_vendor_ad_lines_unproven
  on public.vendor_ad_lines (subtask_id)
  where proof_of_posting_attached = false and proof_of_posting_link is null;

commit;

-- ─── Verification ───────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'vendor_ad_lines'
   and column_name in ('proof_of_posting_link', 'proof_of_posting_attached', 'posted_on')
 order by column_name;
-- Expect three rows. proof_of_posting_attached is NOT NULL default false;
-- the other two are nullable.

select count(*)                                                as lines_total,
       count(*) filter (where proof_of_posting_attached
                           or proof_of_posting_link is not null) as with_proof
  from public.vendor_ad_lines;
-- Expect with_proof = 0 straight after the migration: nothing is copied down
-- from the bookings, on purpose.
