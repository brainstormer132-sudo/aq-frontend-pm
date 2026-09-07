# Asana import - dry run on `JED_Deals_26`

**7 Sep 2026.** Read-only pass over the CSV Siraj exported. Nothing built,
nothing written. This is the mapping and the decisions it needs.

## The file

One Asana project, `JED_Deals_26`, 1 Jan -> 6 Sep 2026.
**6,423 rows: 528 campaigns (parent tasks) and 5,895 vendor rows (subtasks).**
No third level - no subtask points at another subtask. 68 columns, 19 of them
empty in every row (`Month Of Quotation 2024/2025`, `AD Statues`, `Deal`,
`INF Rate (net)`, `Client Inv`, `Influencer Payment`, `Task Progress`,
`Priority`... - old fields nobody fills any more).

## Blocker - the Task IDs are gone

`Task ID` reads `1.2182E+15` on every row: **265 distinct values across
6,423 rows.** The file was opened and saved in Excel, which rounds Asana's
16-digit ids to scientific notation. That column is the only stable key in the
export, and it is the `asana_gid` the whole dedupe plan rests on.

Fix: export again and **do not open the CSV in Excel before uploading**. If it
has to be looked at first, open it via Excel's *Data -> From Text/CSV* with
`Task ID` set to Text, not by double-clicking the file.

What the missing ids cost, concretely:

- `Parent task` is the parent's **name**, not its id (that is how Asana
  exports even when the file is clean). **27 campaign names repeat** -
  `Ibrahim AlQurashi - Faisal AlGhazzawi - SC HA` x5, `Bareeq Silver - AQ` x4,
  `Gold Apple - AQ ( Alona )` x3, `Match - Faisal Al Ghazzawi - SC HA` x3 ...
  Their subtasks cannot be attributed by name alone. With real ids I can at
  least split them by `Created At` ordering; without ids they collapse.
- Four campaigns have a **blank name** and two are named *"Retrieving data.
  Wait a few seconds and try to cut or copy again."* - an Excel paste error
  that has been living in Asana as a task. Those six need cleaning in Asana
  or skipping.

Everything below was worked out from the mangled file and holds for the clean
one; only the ids change.

## Where each Asana column lands

### Campaign (parent -> `pm_tasks`, `parent_task_id is null`)

| Asana | AQ | Note |
|---|---|---|
| `Name` | `task_name` | |
| `Department Ctg.` | `task_service_types` | see vocabulary |
| `Sales` | `sales_closer_id` | 16 values; `Inf.`, `AQ Website`, `AQ IG` are not people |
| `Source` | `source_id` | `AQ` / `Inf.` -> AQ / Influencer. *Outsourced* never occurs |
| `Client Ctg` | `client_category_id` | via the client - `Real State` carries a non-breaking space |
| `Client Account Name` | `client_id` | 200 distinct, 199 after case-folding; **31 campaigns have no client** |
| `Brand Name ` | `brand_id` / `brand_name` | 287 distinct; 41 campaigns have none. A second column `Brand Name.` (389 rows) is an older duplicate field |
| `PIC Name / No. / Email` | `clients.signatory_*` | 3,168 / 2,545 / 596 rows filled; phone numbers carry Excel's leading `'` |
| `Platform.` | `platforms[]` | comma list, splits cleanly |
| `AD Type ` | `ad_type` | see vocabulary |
| `Approval stage` | `approval_stage` | see vocabulary |
| `Total Amount ` | `budget` | 485 campaigns. Of 354 that also have vendor prices, **306 equal sum of price; 48 do not** - the same budget-vs-breakdown gap the audit found, and the import will carry it in as-is |
| `Statues ` | `status` | see vocabulary |
| `Quotation No.` | `quotation_numbers[]` | lives on the **vendor rows** in Asana (5,689 of them). Rolled up distinct per campaign: 18 campaigns get more than one, max 4 |
| `Invoice No.` | `invoice_numbers[]` | same - 2,225 vendor rows, 5 campaigns get more than one |
| `Client Payment` | `client_payment_status` | see vocabulary |
| `Payment Date ` | `client_payment_date` | |
| `Paid Amount` | `client_paid_amount` | only 228 rows |
| `Contract ` | `contract_status` | `Signed & Attached` -> `signed_attached`; `No Contract`, `On Process`, `Pending`, `PO` |
| `Key Account Mangers` | - | 1,047 rows, 7 first names. **No field for this in AQ.** |
| `Packages` | - | 511 rows (`SMC - Customize`, `Event Requirements`...). No field. |
| `Tags`, `Notes`, `Links.` | comment / link | `Links.` is half URLs and half names |
| `Month`, `Section/Column`, `Projects` | - | derivable or meaningless |

### Vendor row (subtask -> `pm_tasks` booking + one `vendor_ad_lines` row)

| Asana | AQ |
|---|---|
| `Name` | booking title (auto-renamed once the vendor is set) |
| `Vendor Name` / `Other Vendor...` | `vendor_id` - **see the vendor problem** |
| `Platform.`, `AD Type ` | the ad line's `platform`, `ad_type` |
| `Due Date` | the ad line's `due_date` - 3,438 of 5,895 have one |
| `Price` | `unit_price` (qty 1) - 5,547 filled |
| `Net..` | `net_amount` - 5,511 filled |
| `AQ Gross Cal.` | not stored; computed |
| `Net. Payment` / `Net. Payment Date ` | `vendor_payment_status` / date |
| `Statues ` | the ad line's status |
| `AQ % (Net)`, `AQ % (Price)`, `Quo. Breakdown` | not stored; computed / dropped |

**Asana settles what `net_amount` means** - the audit's open finding 3.
On 5,266 rows with all three numbers, `Price - Net = AQ Gross Cal.` holds
**100% of the time**, and `AQ % (Net)` is `AQ Gross / Net`. So in Asana **Net
is the talent's fee** and AQ Gross is the margin - which is what
`rollupCampaignMoney` already assumes. 68 rows have Net above Price (a loss,
or a typo); the import keeps them and the campaign page will flag them.

## The vendor problem

`Vendor Name` is a dropdown with 67 real names plus two placeholders, `UGC`
(2,081 rows) and `Other Vendor...` (1,180 rows). When the placeholder is
chosen, the actual person is typed into `Other Vendor...` - free text, **1,319
distinct spellings, 1,129 after lower-casing** (`heba thabeet` x85 and
`heba thabet` x21 are the same person). Breakdown of the 5,895 vendor rows:

| | Rows | Distinct |
|---|---|---|
| Real name in `Vendor Name` | 2,595 | 67 |
| Placeholder, name in `Other Vendor...` | 2,383 | 1,279 raw |
| Placeholder, `Other Vendor...` empty | 917 | - (712 are `UGC`) |

So the vendor registry would gain ~1,100-1,300 names from this one project,
many of them one-booking influencers with no phone, no email, no category.
That is the registry's reality - the app already normalises drifted
`vendor_category` text - but it should be a decision, not a side-effect.

Options, cheapest first:

- **(a)** Import the 67 dropdown vendors as registry rows; put the
  `Other Vendor...` name on the booking as a text note (`vendor_name_text`,
  no `vendor_id`). Nothing in the registry you didn't already have. The
  vendor report and the contract path won't see those bookings.
- **(b)** Import all of them, with a case-and-whitespace fold so `heba thabeet`
  becomes one row, flagged `source = asana` for review.
- **(c)** (b) plus a match against the existing 495 registry vendors by folded
  name, so known people attach to their existing row.

I'd do **(c)**. The 917 rows with no name at all get a single placeholder
vendor per kind (`UGC - unnamed`, `Other - unnamed`) so the booking exists and
the money rolls up.

## Vocabulary - what the app doesn't have a word for

| Field | Asana values | AQ has | Needs a decision |
|---|---|---|---|
| Approval stage | Approved 4,821 ; Canceled 1,429 ; **No Reply By Client 66 ; Declined By Inf. 44 ; Declined By Client 2** ; Ready For Review 10 ; Hold 1 | ready_for_review ; changes_needed ; approved ; hold ; cancelled | the three "no / declined" reasons. Fold into *cancelled* and keep the reason as a note, or add them as stages? |
| Status | Done 3,736 ; Canceled 1,658 ; Pending 963 ; **On Going 56** | pending ; on_hold ; done ; cancelled | On Going -> pending |
| Client payment | Unpaid 3,391 ; Paid 2,142 ; **No Payment 730** ; Partial Paid 39 ; **Adjustment 16 ; Refund 2** | paid ; partial ; unpaid | No Payment != Unpaid (it means nothing is owed). Adjustment / Refund. |
| Vendor payment | Unpaid ; Paid ; No Payment 1,155 ; Partial Paid ; **Free Spot 7** | paid / partial / unpaid | same, plus Free Spot |
| Ad type | Store Visit 2,191 ; Home Ad 2,058 ; **Video 767** ; Multiservices 426 ; **Store Visit -Silent- 140 ; Reel 97 ; Home Ad -Silent- 96 ; Post 71 ; Story 65 ; Billboards 38 ; Usage Rights 28** | Home Ad ; Store Visit ; Multi Service | nine values with no home. `AD_TYPE_OPTIONS` keeps typed values as "(as typed)", so nothing is lost - but they won't group |
| Platform | TikTok ; SnapChat ; Instagram ; **Client 134 ; Off Line 38 ; Photoshoot 19** | 12 seeded platforms | three that aren't platforms |
| Department Ctg | Campaign 238 ; AD Hoc 85 ; Package AD 71 ; Social Media 35 ; Media Production 14 ; Event 14 ; **Commission 12** ; Sponsorship 8 ; Annual Contracts 8 ; BillBoard 5 ; **Proposal 5** ; Design 4 ; Branding 4 ; Deal 4 ; Paid Promotion 3 ; Invitation 3 ; ... | the seeded service types | whichever of these aren't seeded get created |
| Sales | 13 people ; **Inf. 214 ; AQ Website 79 ; AQ IG 2** | profiles; influencer allowed since 054 | Website / IG -> a "source" not a closer; leave closer blank? |

## Two audit findings this import trips immediately

1. **`'Unpaid'.includes('paid')`** (audit finding 2). 3,391 campaign rows and
   3,008 vendor rows arrive as `Unpaid`. Loaded today, the Collection ledger
   reports every one as fully paid. **That fix ships before the load, not
   after.**
2. **Vendor contracts quote the client's price** (finding 1). 5,511 rows
   arrive with a real `net_amount`. Once they're in, generating a contract
   from any of them puts the client price in front of the talent. Nobody
   should press *Request contract* on an imported booking until finding 1 is
   fixed.

## What I'd build

- `supabase/migrations/07x_asana_import.sql` - `asana_gid text` on
  `pm_tasks`, `clients`, `vendors`, `vendor_ad_lines`; partial unique index per
  table on `(workspace_id, asana_gid) where asana_gid is not null` - the same
  shape as 065 for Zoho. One `delete ... where asana_gid is not null` wipes it.
- `lib/asana-import.ts` - pure: parse CSV -> normalise vocabularies -> resolve
  parents -> fold vendor names -> produce insert batches. Tested against a
  fixture cut from this file. This is where every decision above becomes one
  line in a map.
- A loader that reads registries with `selectAllRows` (never the raw cap),
  matches clients/vendors by folded name, then inserts campaigns, bookings and
  ad lines in id batches of 100. Idempotent on `asana_gid`: rerun after a
  re-export and it updates rather than duplicates.
- A **dry-run report** the loader prints before it writes anything: counts,
  unmatched clients, unmatched vendors, unmapped values. This document is the
  first one of those, done by hand.

## Decisions needed before the build

1. Re-export with `Task ID` intact (blocker).
2. Vendor option (a) / (b) / (c).
3. Approval stage: fold the three "no / declined" values into cancelled, or
   add them.
4. Client payment: what `No Payment`, `Adjustment`, `Refund` mean in AQ.
5. Ad type: extend the app's list to the Asana one, or map (`Video`, `Reel`,
   `Post`, `Story` -> ?).
6. The 27 duplicate campaign names and the 6 junk-named ones - clean in Asana
   first, or import and flag.