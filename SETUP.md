# AQ Creativity — Restart Kit

Two separate websites that share one Supabase backend:

- **Contract app** — FastAPI in `aq-backend/`, vanilla-JS UI in `aq-frontend/`. Custom JWT auth.
- **Project management app** — Next.js 14 in `New folder (3)/`. Supabase Auth.

This guide gets both running from a clean slate.

---

## Step 1 — Rotate the leaked Supabase key (do this first)

The publishable key currently in both `aq-backend/.env` and `New folder (3)/.env.local` was committed to OneDrive in plaintext. Rotate it before anything else:

1. Open <https://supabase.com/dashboard/project/wltvyywerzohibaoemtw/settings/api>
2. Click **Reset** next to the publishable / anon key. Copy the new value.
3. Paste it into:
   - `aq-backend/.env` → `SUPABASE_KEY=...`
   - `New folder (3)/.env.local` → `NEXT_PUBLIC_SUPABASE_ANON_KEY=...`

Until this is done, anyone with a copy of the old OneDrive folder can read and write your database.

---

## Step 2 — Wipe and rebuild the database

This drops every table in `public` and recreates clean schemas for both apps side-by-side.

1. Supabase Dashboard → **SQL Editor** → **New query**.
2. Open `New folder (3)/supabase/migrations/002_reset_and_full_schema.sql` in a text editor.
3. Copy the entire contents and paste into the SQL Editor.
4. Click **Run**. Should finish in a couple of seconds with "Success".
5. (Optional) If you also want to wipe sign-up accounts: **Authentication → Users**, delete them all from the UI. Or uncomment the `delete from auth.users;` line at the bottom of the SQL file before running.

After running, you'll have:

- **PM app tables:** `profiles`, `workspaces`, `workspace_members`, `projects`, `sections`, `pm_tasks`, `task_assignments`, `task_members`, `labels`, `task_labels`, `comments`, `activity_log`, `notifications`, `clients`, `client_brands`, `manager_clients`, `managed_vendors`
- **Contract app tables:** `users`, `tasks`, `subtasks`, `vendors`, `bank_accounts`, `pending_vendors`, `pending_clients`, `audit_logs`, `app_settings`, `generated_contracts`, `contract_completions`

The contract app uses table names like `tasks`; the PM app uses `pm_tasks`. They no longer collide.

---

## Step 3 — Restart the contract app (backend + UI)

```powershell
cd "C:\Users\siraj\OneDrive - AQ Creativity\aq-backend"
.\start.bat
```

In another PowerShell:

```powershell
cd "C:\Users\siraj\OneDrive - AQ Creativity\aq-frontend"
.\start.bat
```

Open <http://127.0.0.1:3000> → sign up fresh (first user becomes admin) → you're back in.

---

## Step 4 — Start the PM app for the first time

```powershell
cd "C:\Users\siraj\OneDrive - AQ Creativity\New folder (3)"
npm install
npm run dev
```

Open <http://localhost:3000> in a **different browser profile** (the contract UI also runs on 3000 — pick one or change ports).

> ### Port collision tip
> Both UIs default to port 3000. Either:
> - Stop the contract UI before starting the PM app, **or**
> - Run the PM app on a different port: `npx next dev -p 3001` and open <http://localhost:3001>

You'll land on `/auth`. Click **Create account**, sign up with a real email + password.

After sign-up, the `handle_new_user` trigger creates a `profiles` row automatically. You'll see a "Setup Workspace" screen — name it (default is "AQ Creativity"), click create. You're now in the dashboard.

---

## Step 5 — Walk through the PM app

What to verify works (roughly in this order):

1. **Auth** — Sign out, sign back in, refresh page (session should persist).
2. **Workspace setup** — Created your first workspace; you should be `owner` in `workspace_members`.
3. **Sidebar** — Loads with workspace name, project list (empty), Team / Contracts / Clients / Vendors links.
4. **Create a project** — Should appear in sidebar and trigger an `activity_log` row.
5. **Create a task** — Board view, drag between columns (drag may not work yet — list view is the safe path).
6. **List view + Calendar view** — Toggle each one; tasks should render in both.
7. **Comments** — Open task detail → leave a comment → reload page → comment persists.
8. **Team** — Invite isn't wired to email yet; the page should at least render the list of members.
9. **Contracts / Clients / Vendors tabs** — Read-only views of the legacy contract data + the new managed_vendors / clients tables. They should load empty (you just wiped everything).
10. **Realtime** — Open the same task in two tabs, comment in one, watch the other update without refresh.

If any page throws "relation does not exist" the migration didn't apply cleanly — re-run step 2.

If any page throws a 401/403 from Supabase, you forgot to update `NEXT_PUBLIC_SUPABASE_ANON_KEY` after rotation, or RLS is blocking — open the browser console and the message will tell you which table.

---

## Step 6 — Troubleshooting cheat sheet

| Symptom | Likely cause | Fix |
|---|---|---|
| `Cannot connect to Supabase` on auth page | `.env.local` missing or wrong | Re-check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Restart `npm run dev` after edits. |
| Auth page loops back to itself | Middleware redirect loop, usually stale cookies | Clear cookies for `localhost:3000`, restart dev server. |
| `relation "pm_tasks" does not exist` | Migration didn't run or ran against wrong project | Re-run `002_reset_and_full_schema.sql` in the right Supabase project. |
| `permission denied for table X` | RLS policy not letting `anon`/`authenticated` access | You're hitting a table the user isn't a member of. Make sure you've created and joined a workspace. |
| Contract app can't sign up after reset | `users` table has no rows — first signup is auto-admin | Just sign up; the route handles the empty case. |
| `Failed to fetch` on contract UI | Backend not running, or `localStorage.aq_api_base` cached an old port | Open browser console, run `localStorage.removeItem("aq_api_base"); location.reload();` |

---

## Step 7 — Decisions still open (for later, not today)

1. **Unify auth.** The contract app uses custom JWT; the PM app uses Supabase Auth. You currently have to log in twice. Future task: rewrite `aq-backend/app/core/auth.py` to verify Supabase JWTs and stop maintaining the contract-app `users` table.
2. **Lock down signup.** Both apps currently let anyone hit signup. Add an invite-code column on user creation, or remove signup entirely.
3. **Deploy.** Vercel for the PM app, a small VM (or Render/Fly) for the FastAPI backend. The contract UI is static and can sit on Vercel/Netlify too.

---

## Files this kit added or changed

- `New folder (3)/supabase/migrations/002_reset_and_full_schema.sql` — the full reset + rebuild script.
- `New folder (3)/.env.local` — Supabase URL + key (old key, replace after rotation).
- `New folder (3)/middleware.ts` — was empty; now actually redirects unauthenticated users to `/auth`.
- `New folder (3)/SETUP.md` — this file.

The old `001_initial_schema.sql` is now obsolete (it created a `tasks` table that collided with the contract app and was missing six tables the hooks need). You can leave it alongside `002` for history, or delete it — the new file is fully self-contained.
