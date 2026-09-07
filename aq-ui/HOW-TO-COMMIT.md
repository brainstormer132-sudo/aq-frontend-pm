# Two commits, ready to go

Both are made on top of **`origin/main` at `5d85bc9`** — your latest upload —
not on an older base. `npx tsc --noEmit` is silent and `npx next build`
compiles at each commit, separately.

```
35943a8  UI streamlining pass: eleven screens     40 files, +12799 −3815
d6d08b0  Remove the scaffold nothing reaches      25 files,        −5815
```

## ⚠️ Run migration 063 first

`supabase/migrations/063_tracking_ad_lines.sql` — Dashboard → SQL Editor →
paste → Run. The code selects the new columns, so **run it before this
deploys**, not after.

It also touches `tracking_rows_published`, on purpose:
`publish_tracking_sheet()` does `insert … select r.*`, which is positional, so
adding a column to one table and not the other breaks publishing for every
campaign. The migration ends with a check that raises if the counts ever
diverge.

## Getting them in — pick one

### If you have the repo cloned locally

```bash
cd aq-frontend-pm
git fetch origin && git checkout main && git pull
git pull /path/to/aq-ui-pass.bundle ui-pass
npx next build          # expect "Compiled successfully"
git push origin main
```

`aq-ui-pass.bundle` carries both commits with their messages and history.

### Or apply the patches

```bash
cd aq-frontend-pm
git am patches/0001-Remove-the-scaffold-nothing-reaches.patch
git am patches/0002-UI-streamlining-pass-eleven-screens.patch
```

### Or keep uploading through the web, as you have been

Then the deletions have to be done by hand — the web uploader can add files
but not remove them. `delete-dead-files.sh` in this folder does exactly the
25 removals of the first commit.

## What is in the second commit

**New** — 13 pure logic modules and 5 components:

```
lib/  all-tasks  attention  contracts  crm  inbox  money-ledger  new-task
      registry   settings   team       tracking   tracking-sync   triage
components/workflow/  AllTasksView  RegistryTable  SettingsView
                      TaskCalendarView  TeamView
supabase/migrations/  063_tracking_ad_lines.sql
```

**Gone** — replaced by the two new screens:

```
components/workflow/TeamSettingsPanel.tsx       → TeamView + SettingsView
components/workflow/OperationsLookupsPanel.tsx  → SettingsView
```

**Changed** — 19 files, including `hooks/use-workflow.ts`, which every screen
shares. That shared file is why this is one commit rather than eleven: split
per screen, the intermediate commits would not compile.

## What is not in either commit

`next-env.d.ts` — Next.js regenerates it, and the working copy differed only
in a dev-vs-build import path. Left alone deliberately.

## After it lands

Still open, in the order I would take them:

1. **Migration 062** (avatars bucket) and **052** (`unseed_proof_of_posting`)
   were never confirmed run.
2. The **contract download route** on `aq-backend`, then flip
   `CONTRACTS_CAN_DOWNLOAD` in `ContractsView.tsx` — Open is drawn disabled
   with the reason until it exists.
3. The Render deploy for the `{ID}` placeholder and the blank-brand fix.
4. **Variant C** — collapsing `tracking_rows` and `vendor_ad_lines` into one
   ad. B made their shapes agree; C stops the two copies existing.
5. Reports as editable drafts, and portal send with a server-side field
   allow-list.
