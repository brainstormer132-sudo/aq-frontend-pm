# Asana import - built, verified, ready to run

**7 Sep 2026.** Follows `claude/aq-asana-import-dryrun.md`. Everything in
that doc's "What I'd build" list exists now and has been run end to end
against a scratch Postgres built from the repo's own migrations, with the
real `JED_Deals_26` export: **528 campaigns, 5,895 bookings, 5,895 ad
lines, 183 clients, 279 brands, 1,222 vendors** - loaded, loaded again
(nothing duplicated), wiped (nothing left but the rows that were there
before).

## The pieces

| File | What |
|---|---|
| `supabase/migrations/077_asana_import_keys.sql` | `asana_gid` on `pm_tasks` and `vendor_ad_lines`; `import_key` on `clients` and `vendors`; partial unique indexes on all four. **Run this first, once.** |
| `lib/asana-import.ts` | Pure. CSV parser, the Asana -> AQ vocabulary, parent resolution, vendor resolution, the plan, and the SQL renderer. 24 tests. |
| `scripts/asana-import.mjs` | `node scripts/asana-import.mjs <export.csv> [older.csv ...] --out out/asana-import`. Writes `report.md` and the SQL files. |
| `tests/asana-import.test.mjs` | The shapes Asana's export actually has, frozen. Runs under `npm test`. |
| `out/` | Where the SQL lands. **Git-ignored** - it is full of client names and phone numbers, and the repo is public. |

## Running it

```powershell
Set-Location "C:\Users\siraj\OneDrive - AQ Creativity\New folder (3)"
node scripts/asana-import.mjs "$env:USERPROFILE\Downloads\JED_Deals_26 (2).csv" "$env:USERPROFILE\Downloads\JED_Deals_26 (1).csv" --out out\asana-import
```

Two files because Asana only exports the fields currently shown on the
project, and the second export had lost `Contract`, `Packages` and
`Links`. The older export still had them; the script copies those columns
across after checking every row agrees on Name and Parent task. (The older
file's Task IDs are Excel-mangled - that does not matter, ids always come
from the first file.)

Then, in the Supabase SQL editor, **in name order**:

1. `077_asana_import_keys.sql` (the migration - once)
2. `out/asana-import/01_registries.sql`
3. `02_campaigns.sql`
4. `03_bookings_01_of_04.sql` ... `04_of_04`
5. `04_ad_lines_01_of_04.sql` ... `04_of_04`

Each file is one transaction, ends with a summary row (`in_file` vs
`in_db`), and refuses to run out of order - a bookings file raises if its
campaigns are not in yet, an ad-lines file raises if its bookings are not.
Re-running any file is safe: every write is `on conflict ... do update` on
the Asana id.

`99_wipe.sql` takes it all out - rows with `asana_gid` / `import_key` set.
Clients and vendors that already existed and were merely matched are left
alone, and so are their brands.

## What was verified on the scratch database

- **Matching, not duplicating.** A client seeded with the Zoho name
  an Arabic company name from Zoho and a vendor seeded as `Faisal Al Ghazzawi` (no
  hyphen) were both **reused**: 10 campaigns and 236 bookings attached to
  the existing rows, neither got a second copy, neither got `import_key`.
- **Second run changes nothing.** Counts identical, no new rows.
- **Money.** The `sync_booking_money_from_lines` trigger rolled every priced
  line into its booking (4,191 of 4,191), and the campaign rollup view
  agrees with Asana's own `Total Amount` on the first campaign
  (76,260 = sum of price; 58,260 AQ gross).
- **No notification storm.** Campaigns land at stage `in_progress` /
  `completed`, not `pending_marketing`, so `on_pm_task_stage_change` stays
  quiet. 0 notifications after 6,423 inserts.
- **Vocabulary landed where the app expects it**: approval `approved 404 |
  cancelled 98 | ready_for_review 10 | hold 1`; client payment `unpaid 235 |
  paid 215 | no_payment 53 | partial 17 | adjustment 3 | refund 2`; contract
  `no_contract 121 | signed_attached 83 | on_process 64 | po 42 | pending
  20`; ad-line status `Posted 3,427 | Cancelled 1,559 | Not started 899 |
  Scheduled 10`.
- Sales closer resolved for 236 campaigns by name; 84 flagged
  `sales_closer_influencer` from Asana's `Inf.`; key account and assignee
  resolve when the profile / auth user exists in the workspace.

## Decisions - mostly made by the app itself

The dry run listed six. Reading the real code closed four of them:

| | Decision | Outcome |
|---|---|---|
| 1 | Task IDs | Clean re-export received. Duplicate campaign names are resolved by **file order** (Asana writes subtasks under their parent; 5,892 of 5,895 sat directly beneath theirs, the other three named a unique parent). |
| 2 | Vendors | **(c)** - match the registry by folded name, create the rest with `import_key`, one placeholder per kind for the 917 nameless rows (`UGC - unnamed (Asana)`, `Vendor - unnamed (Asana)`). |
| 3 | Approval stage | The three "no / declined" values fold into `cancelled` (6 campaigns), and the original is written into the campaign description: *"Approval stage in Asana: Declined By Inf."* |
| 4 | Client payment | **Already in the app.** The campaign picker offers `unpaid | partial | paid | no_payment | refund | credit | adjustment` - Asana's values map one to one. `Free Spot` -> `no_payment`. |
| 5 | Ad type | **Already in the app.** `AD_TYPE_OPTIONS` has every Asana value. `Multiservices` -> `Multi Service`. |
| 6 | Junk names | Three campaigns import as `(untitled Asana task <gid>)`. Rename or delete them in the app. |

And the two audit findings the dry run said would trip: **both were fixed
on `main` before this was built** - `clientPaymentState` matches an exact
set now, and the contract request takes `lineTotals.net`. Nothing to wait
for.

## What lands where

Things AQ has no field for are not dropped - they go into the campaign's
`description` as plain lines: project name, folded approval stage, sales
channel (`AQ Website`, `AQ IG`), key account name, Packages, Tags, Links,
Notes. Search finds them; nothing has to be built to read them.

`Total Amount` -> `budget`. Vendor `Price` / `Net` -> the ad line's
`unit_price` / `net_amount` (one line per booking, quantity 1); the trigger
copies them up to the booking. Quotation and invoice numbers roll up from
the vendor rows onto the campaign's arrays, distinct, in order of first
appearance - 46 campaigns end up with more than one quotation number.

`created_at` is the Asana creation date, deliberately: the vendor report's
"Month of quotation" is the campaign's creation month, and it should say
January for a January deal.

## Things to know before you look at the result

- **One discount row.** `Alsoboh Hospitals - Disscount (53.285%)` has a
  price of -1,103,000 in Asana. Ad lines refuse negative prices, so the
  line is unpriced with a note, and the **booking** keeps the negative
  amount - the campaign rollup honours it. It is the only such row.
- **208 campaigns have no sales closer**, because Asana's `Sales` names a
  channel (`AQ Website`), an unmatched spelling, or nothing. The name is in
  the description; the profile match is by folded full name, so fixing a
  profile's name and re-running 02 fills them in.
- **Vendor registry grows by ~1,200 rows**, most of them one-booking
  influencers with no phone, email or category. `Vendors` will look
  different. Two spellings of one person stay two rows (`heba thabeet` x84,
  `heba thabet` x20 - top of `report.md`); merging them is a registry job,
  not an import guess.
- **Platforms** the app now knows: TikTok, Snapchat, Instagram, YouTube, X.
  Asana's `Client`, `Off Line`, `Photoshoot`, `AQ FEE`, `Commission` stay on
  the rows as typed and are not added to the lookup.
- **Service types** created if missing: whatever `Department Ctg.` says,
  with `Campaign` -> the existing *Influencers Campaign* and `BillBoard` ->
  *Billboards*. `Commission` (12), `Proposal` (5), `Gift` (1) and friends
  become service types because that is what Asana called them.
- Wiping leaves brands that were created under a **matched** client (the
  Zoho one), since `client_brands` has no key of its own. Five, on the
  scratch run. Harmless; delete by hand if unwanted.

## Next time

Export from Asana with all the fields you want visible on the project,
don't open the file in Excel, run the script, read `report.md`, run the
SQL. The rows update in place.

## Bugs the real data surfaced

Kept here as they come, one line each, with where the fix lives.

- **"null value in column price_excl of relation tracking_rows"** when
  making a sheet for an imported campaign. `plannedRowInput` left
  `price_excl` off rows whose ad line had no price, relying on the column
  default - but a PostgREST bulk insert fills a key that some rows have
  and others lack with an explicit null, and imported campaigns are the
  first with priced and unpriced lines side by side. It now always sends
  a number, 0 when nothing is agreed. `lib/tracking-sync.ts`,
  `tests/sheet.test.mjs`.
- Campaigns with two hundred vendors: `claude/aq-campaign-many-vendors.md`.
- Days with forty items on the calendar: `claude/aq-calendar-day-view.md`.
- **"Net is 14M in Asana, 9M in the app."** Two different things. Asana's
  Net is the talent's fee (13.6M for Done + Approved); the app's 9.35M was
  the *margin* - billed less vendor cost - and the report was calling it
  "AQ net". Renamed to **AQ margin** so the word "net" means one thing
  everywhere: what the vendor gets. "Vendors cost" also said "paid to
  vendors" when it is the agreed amount; paid is a different, smaller
  number. And the month chart now spans every month with data (Jan to
  Sep) instead of the last six, and fills the card. `lib/dashboard-data.ts`,
  `components/workflow/DataView.tsx`, `tests/money-vocab.test.mjs`.
- **Collection header over Liability rows** after switching back and forth
  on the Data view. The side, its rows, its totals and the rows on screen
  were three separate memos; now one, so they cannot come from different
  renders, and the table is keyed on the side so it is rebuilt rather than
  patched. Also: the vendor ledger is 4,000 rows after the import and was
  drawn in one go - now 200 at a time with *Show more* / *Show all*; the
  CSV still takes everything. `components/workflow/DataView.tsx`.
