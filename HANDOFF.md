# Handoff — AQ Creativity contract + PM platform

**Read this first.** This is the running brief for any new Claude session picking up Siraj's work. Updated 2026-05-20.

---

## Who you're working with

**Siraj Qurunfulah** at AQ Creativity. Email: `SirajQurunfulah@aqcreativity.com`. Solo operator-style — he ships fast, pushes to prod after each batch of changes, and expects you to take the work seriously because it's a real business tool, not a toy.

His style:
- **Iterative.** He'll say "lets do more of a 5 till 4" mid-task — interpret loosely, follow his examples not his labels.
- **Risk-aware on data.** Before any destructive migration or bulk import he asks "are you 100% sure nothing is going to be wrong" — when he says that, slow down and verify in writing what could break.
- **Wants the code shipped.** Don't stop at "here's the plan" — write the files, give him the SQL to paste into Supabase, tell him the exact `git add / commit / push` command.
- **Will tell you when the UI didn't change.** OneDrive sync issues cause this a lot — believe him if he says a change didn't land, and re-verify.

---

## The three (now four) codebases

All under `C:\Users\siraj\OneDrive - AQ Creativity\`:

1. **`aq-backend/`** — FastAPI on Render. Handles contract PDF/DOCX generation (LibreOffice headless), Supabase Storage uploads, Zoho Books integration, contract-maker auth/invites.
2. **`aq-frontend/`** — the original static contract-maker SPA (deployed to Vercel as the contracts site).
3. **`New folder (3)/`** — the Next.js 16 PM app (deployed on Vercel). This is where most current work happens — CRM, tasks, clients/vendors, brands, invoices, dashboards.
4. **`Shared/`** — shared docs/assets folder, mostly for handoffs and reference material.

`Aq creativity new website buildings/` is the project's root folder in Cowork — that's the workspace name, but the active code lives in the four siblings above.

**The two products Siraj is building toward:**
- A contract-making website (the contract-maker SPA + backend gen).
- A task/project management website (the Next.js PM app), which has grown to include CRM, deals, follow-ups, analytics.

---

## Stack & conventions

**Backend (`aq-backend`)**
- FastAPI, Python. Supabase REST client via helpers `sb_select`, `sb_insert`, `sb_update`, `sb_delete` (in `app/supabase_client.py`).
- LibreOffice headless converts DOCX → PDF. **Slow and intermittent on Linux.** Constants in `app/services/generation.py`: `PDF_CONVERSION_ATTEMPTS = 3`, `PDF_CONVERSION_TIMEOUT_S = 45`. Worst case = 135s, inside browser tolerance.
- Generation loop in `app/routers/contracts.py` **tolerates partial batch failures** — collects `render_errors[]` and only raises 500 if ALL subtasks fail.
- `POST /contracts/{contract_id}/regenerate` re-runs a single contract by looking up source task+subtask. Client auto-heals 404 downloads by calling this.
- Storage bucket: `contracts` (private), keyed by `storage_path` column on the contracts table.
- Zoho Books: OAuth tokens via env vars (region-aware), `app/integrations/zoho_books.py` handles refresh + invoice/customer fetch.

**Frontend — PM app (`New folder (3)`)**
- Next.js 16 with `@supabase/ssr`. Pages: `app/workflow/page.tsx` is the main shell, sidebar in `components/workflow/WorkflowSidebar.tsx`.
- All Supabase calls go through `hooks/use-workflow.ts` — one giant file (~1755 lines) with every hook, type, and mutation in the system.
- CSS: utility classes `aq-card`, `aq-input`, `aq-select`, `aq-textarea`, `aq-btn aq-btn-primary|secondary|ghost|danger`, `aq-badge aq-badge-success|warning|info|muted|error`. Tokens in `styles/globals.css`.
- Auth screens: `components/auth/SplitAuthLayout.tsx` + `AnimatedAQLogo.tsx` (SVG centerline trace → crossfade to filled logo, plays once, respects `prefers-reduced-motion`).
- Theme: `data-theme="dark"` on `<html>`, persisted to localStorage. Init script must run **before** first render to avoid flash.

**Frontend — contract maker (`aq-frontend`, served via `New folder (3)/public/contracts/`)**
- Vanilla JS + HTML. `index.html` + `app.js` + `styles-tasks.css` + `styles-theme.css`.
- Cache-buster pattern on imports: `app.js?v=YYYYMMDD-tag`.
- Sidebar is collapsible (`.app-shell.sidebar-collapsed`), theme toggle persists to localStorage.
- Auto-retry on contract gen: 2 attempts, 3s delay, transient-error detection (`failed to fetch|networkerror|timeout|502|503|504`).
- Download 404 → auto-call `/regenerate` → retry download.

**Supabase conventions everywhere**
- Multi-tenancy via `workspaces` table. Every domain table has `workspace_id` + RLS.
- RLS uses `public.has_role(workspace_id, ARRAY['owner','admin','marketing','sales','key_account','member'])`.
- Discriminator pattern for polymorphic links: `target_type text CHECK (target_type IN ('client','vendor'))` + `target_id text`. Used in `crm_activities`, `crm_deals`, `crm_tasks`.
- Migrations in `New folder (3)/supabase/migrations/`, numbered sequentially. Latest is **025_crm_deals_tasks.sql**.

---

## Where work just stopped (2026-05-20)

**Just shipped: CRM phase 1–3** — full sales pipeline + follow-up tasks + analytics. Files created or modified this session:

| File | Purpose |
|---|---|
| `supabase/migrations/025_crm_deals_tasks.sql` | `crm_deals` + `crm_tasks` tables, RLS, stage-change trigger |
| `hooks/use-workflow.ts` (lines 1563–1755 appended) | `DealStage`, `DEAL_STAGES`, `CrmDeal`, `CrmTask`, `useCrmDeals`, `useCrmTasks`, all mutations |
| `components/workflow/DealsKanban.tsx` (NEW) | 6-column drag-and-drop pipeline, owner filter, search, stuck/overdue badges |
| `components/workflow/DealEditor.tsx` (NEW) | Slide-over deal editor |
| `components/workflow/CrmTasksView.tsx` (NEW) | Follow-up list grouped Overdue / Today / Week / Later / No date / Done, Mine vs All |
| `components/workflow/CrmTaskEditor.tsx` (NEW) | Slide-over task editor with deal + contact linking |
| `components/workflow/CrmAnalytics.tsx` (NEW) | Pipeline stats, stage funnel, owner leaderboard, activity report w/ weekly sparkline, follow-up health, stuck deals |
| `components/workflow/CrmView.tsx` | Added `deals`, `tasks`, `analytics` mode tabs |

**What Siraj still needs to do to make it live:**
1. Open Supabase SQL editor → paste & run `supabase/migrations/025_crm_deals_tasks.sql`.
2. `cd "New folder (3)" && git add -A && git commit -m "CRM phase 1-3: deals pipeline + tasks + analytics" && git push` — Vercel auto-deploys.

**Verify after deploy:** open the PM app → CRM tab → you should see 5 mode tabs (Dashboard, Contacts, Deals, Tasks, Analytics). Drag a deal between columns and confirm `stage_changed_at` updates in the row.

---

## Older pending items (still in the queue)

- **Task #67** — Siraj to add Zoho env vars to Render (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_DC`, `ZOHO_ORG_ID`) and apply migration `016_zoho_customer_id.sql`. Without these, the client Invoices tab and "Import from Zoho" button error out.
- **Task #40** — Email portal credentials when admin creates a portal account. Backend route exists; no email is sent yet. Need Resend (or whichever email provider is wired) call after `manual_create_client` / portal-account creation.

---

## Hard-won gotchas — read before you make any of these mistakes

**OneDrive sync truncation.** This will burn you. The Linux mount inside the Cowork sandbox (`/sessions/<id>/mnt/...`) lags behind OneDrive on Windows. The `Read` tool reads through Windows directly and sees the live file. `bash`/`tsc` against the mount sees a stale snapshot.

- Symptom: `tsc` complains a hook isn't exported when `Read` clearly shows it's there.
- Don't trust file sizes from `wc -l` over the mount. Cross-check with `Read`.
- When in doubt, re-`Write` the file to force a sync.

**Migration ordering.** Latest is 025. Don't reuse a number — always +1.

**Contract generation is slow & flaky.** LibreOffice on Linux is the bottleneck. Don't extend the timeout — extend the retry surface (server-side partial tolerance + client-side auto-retry + regenerate endpoint) instead. Past attempts at 8×90s timeouts blew browser limits.

**Zoho imports can duplicate.** Check `zoho_customer_id` on `clients` before inserting. The "reset all clients" flow Siraj asked for went through `zoho_customer_id` uniqueness.

**Logo animation is geometry-sensitive.** If you touch `AnimatedAQLogo.tsx`, the A-apex Y must be ~2100 (not 1850 — that causes a "snap" because of the miter spike). Circle goes from (3547, 3730) at 5 o'clock to (4070, 3207) at 4 o'clock going through bottom→left→top→right. Siraj iterated on this 9+ times — don't accidentally undo it.

**He calls "counterclockwise" what is sometimes clockwise.** Follow his examples, not his label.

**File paths are case- and space-sensitive.** "New folder (3)" with the literal space and parens. Always quote in bash.

---

## File-handling rules Siraj relies on

- Final deliverables go to a folder he selected. For PM app code: `C:\Users\siraj\OneDrive - AQ Creativity\New folder (3)\...`. For contract-maker: `aq-frontend/` or the corresponding `New folder (3)/public/contracts/`.
- Never write to `/sessions/<id>/mnt/outputs/` and call it done — he can't see that.
- `computer://` links so he can click to view. He prefers "View your X" phrasing, not "Download".
- Don't write README or `.md` docs unless asked (this handoff doc is asked-for).
- Don't add emojis unless he asks or uses them first.

---

## How to start your next session

1. Read this file.
2. Check Cowork tasks list — Tasks #67, #40 are the oldest unresolved; #1–#75 are mostly done.
3. Ask Siraj what he wants to work on. He often picks up where he left off, but sometimes pivots.
4. **Use `AskUserQuestion` for anything underspecified.** Don't guess audience, scope, or "build all" vs "phase 1 only".
5. **Use `TaskCreate` / `TaskUpdate` aggressively** — the task list is rendered as a widget for him.
6. **Before writing a hook or component, `Grep` `use-workflow.ts` first** — chances are something similar already exists.
7. **Before claiming a build passes, sanity-check by Reading the files**, not by trusting `tsc` against the mount.

---

## Useful greps to orient yourself fast

```
# Find a hook
Grep "export function use" hooks/use-workflow.ts

# Find a route
Grep "@router\.(get|post|put|delete)" aq-backend/app/routers/

# Find a CSS token
Grep "^\.aq-" styles/globals.css

# Find a migration touching a table
Grep -i "create table.*<name>" supabase/migrations/
```

---

That's the brief. Siraj is in good shape — pipeline, tasks, analytics are all wired and waiting on the migration + push.
