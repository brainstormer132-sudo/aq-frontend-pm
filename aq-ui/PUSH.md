# The push — you have to run it

I can't do it from here. Two separate blockers, both real:

**1. This sandbox has no write access to your repo.** Reads work because it's
public; the push is refused by the proxy:

```
remote: access denied by the git proxy: brainstormer132-sudo/aq-frontend-pm
is not in this session's authorized repository set, so the proxy will not
inject a credential for it.
```

If you add the repo to the session's sources, a future session can push.

**2. I shouldn't drive git on your laptop through the file bridge.** It can
create files but not delete them, and git lives or dies by `.git/index.lock`.
Running `git status` there did leave two locks — I moved both into
`New folder (3)/_to_delete/`, so git works again. **Delete that folder.** But
an `add`/`commit`/`pull` would jam the repo the same way, worse.

---

## Before anything: your clone and GitHub have diverged

```
your local main   bf05bba  "Point contract app at our own backend (aq-backend-pp7m)"
GitHub  main      5d85bc9  15 commits ahead — your web uploads
```

Your clone last fetched **5 August**. Everything you've uploaded through the
GitHub web UI since then is on `origin/main` and not in your working copy.

You also have **37 uncommitted local changes**, and some are in files my commit
also touches:

```
app/dashboard/workflow/page.tsx
components/workflow/NewTaskForm.tsx
components/workflow/TaskDetailPanel.tsx
hooks/use-workflow.ts
```

I don't know whether those are real work or stale copies from before you
uploaded, so I haven't touched them. Decide that first — everything below
assumes you have.

---

## The commands

My two commits sit on top of `5d85bc9`, so bring your clone up to that first.

```bash
cd "/c/Users/siraj/OneDrive - AQ Creativity/New folder (3)"

rm -rf _to_delete                 # the lock files I moved out

git stash -u                      # park the 37 local changes
git fetch origin
git checkout main
git reset --hard origin/main      # now at 5d85bc9, matching GitHub

git pull "aq-ui/aq-ui-pass.bundle" ui-pass

npx next build                    # expect "Compiled successfully"
git push origin main
```

Then look at what you stashed and decide what still matters:

```bash
git stash show -p stash@{0} | less
git stash pop      # only if you want it back — expect conflicts
```

### If you'd rather not touch your working copy

Clone fresh beside it and push from there:

```bash
cd "/c/Users/siraj/OneDrive - AQ Creativity"
git clone https://github.com/brainstormer132-sudo/aq-frontend-pm.git aq-push
cd aq-push
git pull "../New folder (3)/aq-ui/aq-ui-pass.bundle" ui-pass
npx install && npx next build
git push origin main
```

Nothing in your existing folder changes, and you can delete `aq-push` after.

---

## After it lands

**Run `supabase/migrations/063_tracking_ad_lines.sql`** — Dashboard → SQL
Editor → paste → Run. The code selects columns it adds, so it goes **before**
Vercel picks the deploy up, not after.

Then check the tracking sheet on one campaign: the banner should say how many
booked ads are missing, and adding them should give one row per ad.
